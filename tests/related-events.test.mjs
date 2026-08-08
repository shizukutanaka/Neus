// Neus — RELATED ITEMS / associative trail (round 33, first-principles 段階5「接続」)
//
// Bush の Memex(1945)が提示した「連想の小径(associative trail)」— 分類ではなく意味的な近さで
// 情報同士を辿れること — と、Luhmann の Zettelkasten が同型の構造を持つこと。"serendipity" に
// 見えるものは実際には意味的関係が導いた必然とされる。Neus は収集も検索も持っていたが、
// 「いま読んでいる物」から「手元の関連物」へ辿る経路が無く、能動的に検索語を思いつけた時しか
// 繋がらなかった(FEATURE-AUDIT §1-3 の "類似するが別の記事" を繋ぐ機構の不在)。
//
// 設計上の要: `links[]` へは書き込まない。§1-3 が ADR ゲートにしているのは links[] の意味論変更
// (現在は「同一記事の別URL」)であり、ここは Falsifier Watch と同じく描画時に導出するだけ。
// データモデルは不変で、永続的な関連リンク生成は引き続き ADR 待ちのまま。

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// Mirrors relatedEvents in index.html against a stubbed FTSIndex/Store.
function makeRelated({ hits, store, limit = 3 }) {
  return async function relatedEvents(ev) {
    if (!ev || !ev.content || !ev.content.title) return [];
    const linked = new Set(ev.links || []);
    const out = [];
    for (const h of hits) {
      if (out.length >= limit) break;
      if (h.id === ev.id || h.id.startsWith('word:')) continue;
      const other = store[h.id];
      if (!other || other.state.archived || linked.has(other.url)) continue;
      out.push({ ev: other, score: h.score });
    }
    return out;
  };
}
const mkEv = (id, title, extra = {}) => ({
  id, url: `https://example.com/${id}`, content: { title },
  source: { name: 'src' }, state: {}, meta: {}, ...extra,
});

describe('relatedEvents — derived associative trail (modeled)', () => {
  const self = mkEv('self', 'WebGPU compute shaders');

  it('returns nothing for an event with no title', async () => {
    const rel = makeRelated({ hits: [{ id: 'a', score: 0.9 }], store: { a: mkEv('a', 'x') } });
    expect(await rel({ content: {} })).toEqual([]);
    expect(await rel(null)).toEqual([]);
  });

  it('surfaces other events that share distinctive terms', async () => {
    const store = { a: mkEv('a', 'WebGPU rendering'), b: mkEv('b', 'WebGPU pipelines') };
    const rel = makeRelated({ hits: [{ id: 'a', score: 0.8 }, { id: 'b', score: 0.6 }], store });
    expect((await rel(self)).map(r => r.ev.id)).toEqual(['a', 'b']);
  });

  it('never returns the source event itself', async () => {
    const store = { self, a: mkEv('a', 'WebGPU rendering') };
    const rel = makeRelated({ hits: [{ id: 'self', score: 1 }, { id: 'a', score: 0.8 }], store });
    expect((await rel(self)).map(r => r.ev.id)).toEqual(['a']);
  });

  it('excludes word: hits — FTSIndex indexes words alongside events', async () => {
    const store = { a: mkEv('a', 'WebGPU rendering') };
    const rel = makeRelated({ hits: [{ id: 'word:w1', score: 0.95 }, { id: 'a', score: 0.7 }], store });
    expect((await rel(self)).map(r => r.ev.id)).toEqual(['a']);
  });

  it('excludes archived events (they were deliberately put away)', async () => {
    const store = { a: mkEv('a', 'WebGPU rendering', { state: { archived: true } }), b: mkEv('b', 'WebGPU pipelines') };
    const rel = makeRelated({ hits: [{ id: 'a', score: 0.9 }, { id: 'b', score: 0.5 }], store });
    expect((await rel(self)).map(r => r.ev.id)).toEqual(['b']);
  });

  it('excludes items already linked as the same article (dedup links[])', async () => {
    // links[] currently means "another URL for the same article" — showing those as
    // "related" would be a tautology, so they are filtered out.
    const dup = mkEv('dup', 'WebGPU compute shaders');
    const withLink = { ...self, links: [dup.url] };
    const rel = makeRelated({ hits: [{ id: 'dup', score: 1 }, { id: 'b', score: 0.6 }], store: { dup, b: mkEv('b', 'WebGPU pipelines') } });
    expect((await rel(withLink)).map(r => r.ev.id)).toEqual(['b']);
  });

  it('respects the limit so the trail stays a trail, not a pile', async () => {
    const store = {}; const hits = [];
    for (let i = 0; i < 10; i++) { store['e' + i] = mkEv('e' + i, 'WebGPU ' + i); hits.push({ id: 'e' + i, score: 0.9 - i * 0.01 }); }
    expect(await makeRelated({ hits, store, limit: 3 }).call(null, self)).toHaveLength(3);
  });

  it('tolerates hits whose event is missing from the store (deleted since indexing)', async () => {
    const rel = makeRelated({ hits: [{ id: 'gone', score: 0.9 }, { id: 'a', score: 0.7 }], store: { a: mkEv('a', 'WebGPU rendering') } });
    expect((await rel(self)).map(r => r.ev.id)).toEqual(['a']);
  });

  it('preserves the ranking order given by the index', async () => {
    const store = { a: mkEv('a', 'A'), b: mkEv('b', 'B'), c: mkEv('c', 'C') };
    const rel = makeRelated({ hits: [{ id: 'c', score: 0.9 }, { id: 'a', score: 0.7 }, { id: 'b', score: 0.5 }], store });
    expect((await rel(self)).map(r => r.ev.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('RELATED wiring (index.html)', () => {
  it('declares the limit constant', () => {
    expect(html).toContain('relatedMax:3,');
  });
  it('reuses FTSIndex.search rather than adding a new similarity implementation', () => {
    expect(html).toContain('async function relatedEvents(ev,limit=CONFIG.relatedMax){');
    expect(html).toContain('for(const h of FTSIndex.search(ev.content.title,limit*5)){');
  });
  it('filters self, word hits, archived, and already-linked duplicates', () => {
    expect(html).toContain("if(h.id===ev.id||h.id.startsWith('word:'))continue;");
    expect(html).toContain('if(!other||other.state.archived||linked.has(other.url))continue;');
  });
  it('does NOT write to links[] — the data-model gate (FEATURE-AUDIT 1-3) stays closed', () => {
    // The whole point: relatedness is derived at render time, never persisted.
    const fn = html.slice(html.indexOf('async function relatedEvents'), html.indexOf('async function relatedEvents') + 700);
    expect(fn).not.toContain('putEvent');
    expect(fn).not.toContain('links.push');
    expect(fn).not.toContain('links=[');
  });
  it('renders into the detail modal and degrades gracefully on failure', () => {
    expect(html).toContain('const rel=await relatedEvents(ev);');
    expect(html).toContain("}catch(err){console.warn('[relatedEvents]',err);}");
    expect(html).toContain('${summary}${snippet}${vaultHtml}${relatedHtml}');
  });
  it('escapes interpolated title/source (XSS hygiene)', () => {
    expect(html).toContain('data-related-id="${escapeAttr(r.id)}">${escapeHtml(r.content.title)}');
    expect(html).toContain('<span class="vault-score">${escapeHtml(r.source.name)}</span>');
  });
  it('lets the user actually walk the trail (click opens the related item)', () => {
    expect(html).toContain("const rel=e.target.closest('[data-related-id]');");
    expect(html).toContain('Store.getEvent(rel.dataset.relatedId).then(next=>{if(next)openDetailModal(next);})');
  });
  it('has bilingual DICT entries', () => {
    expect((html.match(/'detail\.related':/g) || []).length).toBe(2);
  });
});
