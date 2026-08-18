// Neus — バックアップ復元の事前検証を型まで厳しくする (round 52)
//
// 復元は「既存データを全消去してから書き込む」ため、検証は**消す前**に置かれている
// (ソース中のコメントもそう明記している)。ところが `validEvent` は
//   `!ev||typeof ev.id!=='string'||!ev.content||!ev.source||!ev.state||!ev.meta`
// という **truthy 判定**しかしておらず、次を全て通していた:
//   - `content` が文字列や配列でもオブジェクトの代わりに通る(`!"abc"` は false)
//   - **`timestamp` を一切見ていない** — 欠落・null・文字列・{} が全て通る
//
// `timestamp` は全ビューの並び順・ダイジェストの24時間窓・再浮上スコアを支える値で、
// 数値でないと比較が NaN になる。実測(修正前):
//   validEvent({... timestamp:'2020-01-01'}) -> true
//   validEvent({... timestamp:null})         -> true
//   validEvent({... timestamp 欠落})          -> true
//   → 並び順が不定、resurface スコアが NaN
// しかも復元後は元データが残っていないので、**壊れた状態から戻せない**。
// 「消す前に形を検証する」という設計意図に、実装が追いついていなかった。

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// Mirrors validEvent / validWord in index.html.
const safeHref = (u) => (typeof u === 'string' && /^https?:/i.test(u) ? u : '#');
const isObj = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
const validEvent = (ev) => {
  if (!isObj(ev) || typeof ev.id !== 'string' || !ev.id) return false;
  if (!isObj(ev.content) || !isObj(ev.source) || !isObj(ev.state) || !isObj(ev.meta)) return false;
  if (!Number.isFinite(ev.timestamp)) return false;
  if (ev.publishedAt !== undefined && !Number.isFinite(ev.publishedAt)) return false;
  if (ev.content.title !== undefined && typeof ev.content.title !== 'string') return false;
  if (ev.url) ev.url = safeHref(ev.url);
  return true;
};
const validWord = (w) => {
  if (!isObj(w) || typeof w.id !== 'string' || !w.id || typeof w.normalized !== 'string') return false;
  if (w.createdAt !== undefined && !Number.isFinite(w.createdAt)) return false;
  if (w.wiki !== undefined && !isObj(w.wiki)) return false;
  if (w.wiki) { if (w.wiki.url) w.wiki.url = safeHref(w.wiki.url); if (w.wiki.thumbnail) w.wiki.thumbnail = safeHref(w.wiki.thumbnail); }
  return true;
};

const good = () => ({
  id: 'e1', timestamp: 1_700_000_000_000,
  content: { title: 'a title' }, source: { name: 's' }, state: {}, meta: {},
});

describe('validEvent — a real backup still restores', () => {
  it('accepts a well-formed event', () => expect(validEvent(good())).toBe(true));
  it('accepts an event with no title (feeds may omit it)', () => {
    const ev = good(); delete ev.content.title;
    expect(validEvent(ev)).toBe(true);
  });
  it('accepts publishedAt when absent or numeric', () => {
    expect(validEvent({ ...good(), publishedAt: undefined })).toBe(true);
    expect(validEvent({ ...good(), publishedAt: 1_700_000_000_000 })).toBe(true);
  });
  it('sanitises a javascript: URL rather than rejecting the whole restore', () => {
    const ev = { ...good(), url: 'javascript:alert(1)' };
    expect(validEvent(ev)).toBe(true);
    expect(ev.url).toBe('#');
  });
});

describe('validEvent — malformed timestamps are now rejected', () => {
  // Every one of these was ACCEPTED before round 52, then produced NaN comparisons.
  it.each([
    ['string date', '2020-01-01'],
    ['null', null],
    ['object', {}],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['numeric string', '1700000000000'],
  ])('rejects timestamp given as %s', (_label, ts) => {
    expect(validEvent({ ...good(), timestamp: ts })).toBe(false);
  });

  it('rejects an event with no timestamp at all', () => {
    const ev = good(); delete ev.timestamp;
    expect(validEvent(ev)).toBe(false);
  });

  it('rejects a non-finite publishedAt', () => {
    expect(validEvent({ ...good(), publishedAt: 'yesterday' })).toBe(false);
    expect(validEvent({ ...good(), publishedAt: NaN })).toBe(false);
  });
});

describe('validEvent — containers must actually be objects', () => {
  it.each(['content', 'source', 'state', 'meta'])('rejects a string in place of %s', (field) => {
    expect(validEvent({ ...good(), [field]: 'oops' })).toBe(false);
  });
  it.each(['content', 'source', 'state', 'meta'])('rejects an array in place of %s', (field) => {
    expect(validEvent({ ...good(), [field]: [] })).toBe(false);
  });
  it('rejects a non-string title', () => {
    expect(validEvent({ ...good(), content: { title: 42 } })).toBe(false);
  });
  it('rejects an empty or missing id', () => {
    expect(validEvent({ ...good(), id: '' })).toBe(false);
    const ev = good(); delete ev.id;
    expect(validEvent(ev)).toBe(false);
  });
});

describe('validWord', () => {
  const w = () => ({ id: 'w1', normalized: 'rust' });
  it('accepts a well-formed word', () => expect(validWord(w())).toBe(true));
  it('rejects a non-object wiki', () => expect(validWord({ ...w(), wiki: 'x' })).toBe(false));
  it('rejects a non-finite createdAt', () => expect(validWord({ ...w(), createdAt: 'now' })).toBe(false));
  it('sanitises wiki URLs in place', () => {
    const x = { ...w(), wiki: { url: 'javascript:1', thumbnail: 'https://ok/img.png' } };
    expect(validWord(x)).toBe(true);
    expect(x.wiki.url).toBe('#');
    expect(x.wiki.thumbnail).toBe('https://ok/img.png');
  });
});

describe('wiring (index.html)', () => {
  it('validation still runs BEFORE the destructive clear', () => {
    // Anchor on the CALL SITE, not `replaceAll({events` — that substring also matches the
    // Store method definition far earlier in the file, which would make this assert nothing.
    const validateAt = html.indexOf('const validEvent=(ev)=>{');
    const callAt = html.indexOf('await Store.replaceAll({events:dump.events');
    expect(validateAt, 'validEvent defined').toBeGreaterThan(-1);
    expect(callAt, 'restore call site found').toBeGreaterThan(-1);
    expect(validateAt, 'validation must precede the destructive restore').toBeLessThan(callAt);
    // and the guard itself must sit between them
    expect(html.indexOf('if(!dump.events.every(validEvent))')).toBeLessThan(callAt);
  });
  it('checks timestamp finiteness', () => {
    expect(html).toContain('if(!Number.isFinite(ev.timestamp))return false;');
  });
  it('uses a real object test rather than a truthy check', () => {
    expect(html).toContain("const isObj=(o)=>o!==null&&typeof o==='object'&&!Array.isArray(o);");
    expect(html).toContain('if(!isObj(ev.content)||!isObj(ev.source)||!isObj(ev.state)||!isObj(ev.meta))return false;');
  });
  it('a malformed backup is refused wholesale, not partially applied', () => {
    expect(html).toContain('if(!dump.events.every(validEvent))');
  });
});
