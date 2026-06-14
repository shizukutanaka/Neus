// Neus — FTS IDF-weighted scoring tests
// Validates BM25-inspired IDF weighting (arxiv: BM25-V 2603.05781, Hybrid Search 2508.01405)
// Rare grams should outweigh common grams; score normalized to 0..1.

import { describe, it, expect } from 'vitest';

// === Mirror of FTSIndex search scoring (IDF-weighted) ===
function makeIndex() {
  const index = new Map();       // gram -> Set<id>
  const eventGrams = new Map();  // id -> Set<gram>
  const N = 3; // gram size

  function ngrams(text) {
    const t = (text || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const grams = new Set();
    if (t.length < N) { if (t) grams.add(t); return grams; }
    for (let i = 0; i <= t.length - N; i++) grams.add(t.slice(i, i + N));
    return grams;
  }
  function add(id, text) {
    const grams = ngrams(text);
    eventGrams.set(id, grams);
    for (const g of grams) {
      let s = index.get(g);
      if (!s) index.set(g, s = new Set());
      s.add(id);
    }
  }
  function search(query, scoreMin = 0.1) {
    const qGrams = ngrams(query);
    if (qGrams.size === 0) return [];
    const Ndocs = eventGrams.size || 1;
    const counts = new Map();
    let qTotalIdf = 0;
    for (const g of qGrams) {
      const s = index.get(g);
      if (!s) continue;
      const df = s.size;
      const idf = Math.log(1 + (Ndocs - df + 0.5) / (df + 0.5));
      qTotalIdf += idf;
      for (const id of s) counts.set(id, (counts.get(id) || 0) + idf);
    }
    if (qTotalIdf === 0) return [];
    return [...counts.entries()]
      .map(([id, acc]) => ({ id, score: acc / qTotalIdf }))
      .filter(r => r.score >= scoreMin)
      .sort((a, b) => b.score - a.score);
  }
  return { add, search, index, eventGrams };
}

describe('FTS IDF-weighted search', () => {
  it('finds an exact match with score 1.0', () => {
    const idx = makeIndex();
    idx.add('a', 'rust programming');
    const r = idx.search('rust');
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].id).toBe('a');
    expect(r[0].score).toBeCloseTo(1.0, 5);
  });

  it('returns empty for non-matching query', () => {
    const idx = makeIndex();
    idx.add('a', 'rust programming');
    expect(idx.search('zzzznonexistent')).toEqual([]);
  });

  it('rare term ranks the rare document on top', () => {
    const idx = makeIndex();
    for (let i = 0; i < 8; i++) idx.add('common' + i, 'programming tutorial ' + i);
    idx.add('rare', 'programming webassembly');
    const r = idx.search('programming webassembly');
    expect(r[0].id).toBe('rare');
  });

  it('common term yields lower per-doc discrimination than rare term', () => {
    const idx = makeIndex();
    for (let i = 0; i < 9; i++) idx.add('c' + i, 'the article ' + i);
    idx.add('rare', 'the rust');
    // 'rust' is rare → high IDF; searching it isolates the rare doc
    const rustHits = idx.search('rust');
    expect(rustHits.length).toBe(1);
    expect(rustHits[0].id).toBe('rare');
    // 'the' is common → matches many docs
    const theHits = idx.search('the');
    expect(theHits.length).toBeGreaterThan(5);
  });

  it('score is normalized to 0..1 range', () => {
    const idx = makeIndex();
    idx.add('a', 'machine learning models');
    idx.add('b', 'deep learning networks');
    for (const r of idx.search('learning models')) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1.0001);
    }
  });

  it('partial query match scores below full match', () => {
    const idx = makeIndex();
    idx.add('full', 'alpha beta gamma');
    idx.add('partial', 'alpha xyz');
    const r = idx.search('alpha beta gamma');
    const full = r.find(x => x.id === 'full');
    const partial = r.find(x => x.id === 'partial');
    expect(full.score).toBeGreaterThan(partial ? partial.score : 0);
  });

  it('IDF is always non-negative (no negative scores)', () => {
    const idx = makeIndex();
    // single doc — df === N, IDF formula must stay positive
    idx.add('only', 'singleton document here');
    const r = idx.search('singleton');
    expect(r[0].score).toBeGreaterThan(0);
  });
});
