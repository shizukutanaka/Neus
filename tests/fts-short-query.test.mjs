// Neus — CJK single-character search returned nothing (round 28 audit)
//
// Documents are indexed as 2-grams (CONFIG.ftsGram=2). ngrams() maps a query shorter than
// the gram size to a single sub-gram-size token, which by construction never exists in the
// index — so a single-kanji query (本, 国, ...), a perfectly legitimate Japanese search,
// always returned zero results. Fixed with searchShort(): scan the indexed grams for those
// CONTAINING the query as a substring, union their posting sets, and rank by how many
// distinct matching grams each document contains (a frequency proxy). Being a presence
// search, it does not apply the ftsScoreMin relative cutoff.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// Mirrors ngrams + searchShort from FTSIndex in index.html.
function ngrams(text, n = 2) {
  const t = (text || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const grams = new Set();
  if (t.length < n) { if (t) grams.add(t); return grams; }
  for (let i = 0; i <= t.length - n; i++) grams.add(t.slice(i, i + n));
  return grams;
}
function buildIndex(docs) { // docs: {id: text}
  const index = new Map();
  for (const [id, text] of Object.entries(docs)) {
    for (const g of ngrams(text)) {
      let s = index.get(g); if (!s) index.set(g, s = new Set());
      s.add(id);
    }
  }
  return index;
}
function searchShort(index, q, limit = 100) {
  const counts = new Map();
  for (const [g, ids] of index) {
    if (!g.includes(q)) continue;
    for (const id of ids) counts.set(id, (counts.get(id) || 0) + 1);
  }
  let max = 0; for (const c of counts.values()) if (c > max) max = c;
  if (max === 0) return [];
  return [...counts.entries()].map(([id, c]) => ({ id, score: c / max })).sort((a, b) => b.score - a.score).slice(0, limit);
}

describe('searchShort single-character fallback (modeled)', () => {
  const index = buildIndex({
    a: '日本の技術ニュース',       // contains 本 in 日本/本の
    b: 'Rust本を読む',             // contains 本 in t本/本を
    c: 'WebGPU performance news',  // no 本
  });
  it('finds documents containing a single kanji that the 2-gram path structurally missed', () => {
    // The old path: ngrams('本') = {'本'} — a 1-gram that no document's index contains.
    expect(index.get('本')).toBeUndefined();
    const hits = searchShort(index, '本');
    expect(hits.map(h => h.id).sort()).toEqual(['a', 'b']);
  });
  it('does not match documents lacking the character', () => {
    expect(searchShort(index, '本').some(h => h.id === 'c')).toBe(false);
  });
  it('ranks by distinct-gram count (frequency proxy), top hit normalized to 1', () => {
    const idx2 = buildIndex({ many: '本の本屋で本を買う', once: 'この本' });
    const hits = searchShort(idx2, '本');
    expect(hits[0].id).toBe('many');
    expect(hits[0].score).toBe(1);
    expect(hits[1].score).toBeLessThan(1);
    expect(hits[1].score).toBeGreaterThan(0);
  });
  it('works for single latin characters too', () => {
    const hits = searchShort(index, 'x');
    expect(hits).toEqual([]); // no x anywhere — and no crash
  });
  it('returns [] when nothing matches', () => {
    expect(searchShort(index, '龍')).toEqual([]);
  });
  it('respects the result limit', () => {
    const big = {};
    for (let i = 0; i < 30; i++) big['d' + i] = `本${i}`;
    expect(searchShort(buildIndex(big), '本', 10)).toHaveLength(10);
  });
});

describe('searchShort wiring (index.html)', () => {
  it('search() routes sub-gram-length queries to searchShort', () => {
    expect(html).toContain("const q=(query||'').toLowerCase().replace(/\\s+/g,' ').trim();");
    expect(html).toContain('if(q&&q.length<CONFIG.ftsGram)return searchShort(q,limit);');
  });
  it('declares searchShort scanning grams by substring inclusion', () => {
    expect(html).toContain('function searchShort(q,limit){');
    expect(html).toContain('if(!g.includes(q))continue;');
  });
  it('normalizes scores against the max count and slices to limit', () => {
    expect(html).toContain('return[...counts.entries()].map(([id,c])=>({id,score:c/max})).sort((a,b)=>b.score-a.score).slice(0,limit);');
  });
  it('the normal >=ftsGram path is unchanged (BM25-style IDF scoring intact)', () => {
    expect(html).toContain('const qGrams=ngrams(query);if(qGrams.size===0)return[];');
    expect(html).toContain('const idf=Math.log(1+(N-df+0.5)/(df+0.5));');
  });
});
