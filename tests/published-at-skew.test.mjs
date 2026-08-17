// Neus — フィード申告 publishedAt の未来日付によるランキング占有 (round 42)
//
// `publishedAt` は第三者(配信元)が値を決められるのに、ランキングでは強い重みを持つ:
//   - DIGEST の鮮度加点は `Math.max(0, now-publishedAt)` を使うため、未来日付は age=0 に
//     clamp され **常に最大点** を取り続ける
//   - タグ/単語ビューは `(publishedAt||timestamp)` の降順なので、未来日付は **恒久的に先頭**
//
// 実測(修正前、Node):
//   recency 加点  25.0 = 直前に公開された正当な項目
//   recency 加点  25.0 = **1年後の日付を申告したスパム**(永続的に同点=最大)
//   recency 加点  12.5 = 6時間前の正当な項目
//   recency 加点   3.1 = 18時間前の正当な項目
//   並び順        スパムが先頭、以降に正当な項目
//
// つまり配信側が日付を未来にするだけで利用者のダイジェスト上位を占有できる(RSS の既知手法)。
// 対策: 時計ずれ許容(publishedAtMaxSkewMs)を超える未来日付は「不明」= undefined として扱う。
// now に clamp しないのは本プロジェクトの publishedAt 非捏造規約に従うため — 実際の公開日時が
// 不明なら値を作らず、消費側の `||timestamp`(取得時刻)へ委ねる。

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

const CONFIG = { publishedAtMaxSkewMs: 60 * 60 * 1000 };
// Mirrors sanePublishedAt in index.html.
function sanePublishedAt(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return undefined;
  if (ms > Date.now() + CONFIG.publishedAtMaxSkewMs) return undefined;
  return ms;
}
const HALF_LIFE_MS = 6 * 60 * 60 * 1000;
const recencyBoost = (ev, now) => 25 * Math.pow(0.5, Math.max(0, now - (ev.publishedAt || ev.timestamp)) / HALF_LIFE_MS);

describe('sanePublishedAt', () => {
  const now = Date.now();
  it('accepts a normal past date', () => {
    const d = now - 3 * 60 * 60 * 1000;
    expect(sanePublishedAt(d)).toBe(d);
  });
  it('accepts a date within the clock-skew tolerance', () => {
    const d = now + 30 * 60 * 1000; // +30min, inside the 1h allowance
    expect(sanePublishedAt(d)).toBe(d);
  });
  it('rejects a date beyond the tolerance', () => {
    expect(sanePublishedAt(now + 3 * 60 * 60 * 1000)).toBeUndefined();
  });
  it('rejects the far-future spam case', () => {
    expect(sanePublishedAt(now + 365 * 24 * 60 * 60 * 1000)).toBeUndefined();
  });
  it('rejects NaN from an unparseable date string', () => {
    expect(sanePublishedAt(Date.parse('not a date'))).toBeUndefined();
  });
  it('rejects non-numeric and infinite input', () => {
    expect(sanePublishedAt(undefined)).toBeUndefined();
    expect(sanePublishedAt('2020-01-01')).toBeUndefined();
    expect(sanePublishedAt(Infinity)).toBeUndefined();
  });
  it('keeps very old dates (they sort last, which is harmless and honest)', () => {
    expect(sanePublishedAt(0)).toBe(0);
  });
  it('does NOT rewrite the value to now (non-fabrication convention)', () => {
    // Returning `now` would invent a publication time we do not know.
    expect(sanePublishedAt(now + 365 * 24 * 60 * 60 * 1000)).not.toBe(now);
  });
});

describe('the ranking capture this prevents', () => {
  const now = Date.now();
  const mk = (publishedAt) => ({ publishedAt: sanePublishedAt(publishedAt), timestamp: now });

  it('a far-future item no longer holds maximum recency forever', () => {
    const spam = mk(now + 365 * 24 * 60 * 60 * 1000);
    const aged = mk(now - 18 * 60 * 60 * 1000);
    // Falls back to ingestion time, so it is treated as "just fetched", not "maximally fresh forever".
    expect(spam.publishedAt).toBeUndefined();
    expect(recencyBoost(spam, now)).toBeCloseTo(25, 1); // same as any just-ingested item
    expect(recencyBoost(aged, now)).toBeLessThan(5);
  });

  it('a future-dated item can no longer outrank a genuinely newer one', () => {
    // Before the fix the spam item sorted first permanently, because its raw future
    // timestamp exceeded every honest date.
    const spam = mk(now + 365 * 24 * 60 * 60 * 1000);
    const honest = mk(now - 60 * 1000);
    const key = (e) => e.publishedAt || e.timestamp;
    expect(key(spam)).toBeLessThanOrEqual(now);
    expect(key(spam) - key(honest)).toBeLessThan(24 * 60 * 60 * 1000);
  });

  it('honest recency ordering is preserved', () => {
    const fresh = mk(now - 60 * 1000);
    const mid = mk(now - 6 * 60 * 60 * 1000);
    const old = mk(now - 18 * 60 * 60 * 1000);
    expect(recencyBoost(fresh, now)).toBeGreaterThan(recencyBoost(mid, now));
    expect(recencyBoost(mid, now)).toBeGreaterThan(recencyBoost(old, now));
  });
});

describe('wiring (index.html)', () => {
  it('declares the skew tolerance', () => {
    expect(html).toContain('publishedAtMaxSkewMs:60*60*1000,');
  });
  it('defines the validator', () => {
    expect(html).toContain('function sanePublishedAt(ms){');
    expect(html).toContain('if(ms>Date.now()+CONFIG.publishedAtMaxSkewMs)return undefined;');
  });
  it('is applied on the RSS/Atom parse path', () => {
    expect(html).toContain('publishedAt:pubDate?sanePublishedAt(Date.parse(pubDate)):undefined,');
  });
  it('is applied on the JSON (Qiita) parse path', () => {
    expect(html).toContain('publishedAt:sanePublishedAt(Date.parse(it.created_at)),');
  });
  it('no parse path still trusts a raw Date.parse for publishedAt', () => {
    expect(html).not.toContain('publishedAt:Date.parse(');
    expect(html).not.toContain('publishedAt:pubDate?Date.parse(pubDate)||undefined:undefined,');
  });
});
