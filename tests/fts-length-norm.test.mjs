// Neus — FTS document-length normalization (round 34)
//
// 問題: 従来のスコアは「クエリのIDF質量をどれだけ被覆したか」だけで、文書長を考慮していなかった。
// 長い文書ほど異なりgramを多く持つため、クエリのgramを偶然含む確率が上がり、短く的確な文書と
// 同点(どちらも1.0)になってしまう — IR で長く知られた長文バイアス。BM25 が b 項を持つのは
// まさにこれを補正するためで、b=0.75 が慣用既定値(BM11=1 は長文を過度に罰し、BM15=0 は無補正)。
//
// 本実装が採用するのは「長文ペナルティ」側のみ。score は UI に "match NN%" として表示され、
// 既存テストも 0〜1 と「完全一致=1.0」を保証しているため、短文ボーナスで 1.0 を超えさせない。
// → dl <= avgdl では係数はちょうど 1.0、平均より長い文書だけが単調に減点される。
//
// 重要度: search() は全文検索だけでなく round 33 の関連アイテム(relatedEvents)の土台でもある。
// 長文バイアスを放置すると、冗長な1件があらゆる記事の「関連」に出現するハブ(雑音)になる。

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// Mirror of FTSIndex scoring with length normalization (stays in sync via the anchors below).
function makeIndex(gramSize = 2, scoreMin = 0) {
  const index = new Map(), docGrams = new Map(), docLen = new Map();
  let totalLen = 0;
  const ngrams = (text) => {
    const t = (text || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const g = new Set();
    if (t.length < gramSize) { if (t) g.add(t); return g; }
    for (let i = 0; i <= t.length - gramSize; i++) g.add(t.slice(i, i + gramSize));
    return g;
  };
  const setLen = (id, n) => { const p = docLen.get(id); if (p !== undefined) totalLen -= p; docLen.set(id, n); totalLen += n; };
  function add(id, text) {
    const grams = ngrams(text);
    docGrams.set(id, grams); setLen(id, grams.size);
    for (const g of grams) { let s = index.get(g); if (!s) index.set(g, s = new Set()); s.add(id); }
  }
  function search(query) {
    const qGrams = ngrams(query);
    if (qGrams.size === 0) return [];
    const N = docGrams.size || 1;
    const counts = new Map();
    let qTotalIdf = 0;
    for (const g of qGrams) {
      const s = index.get(g); if (!s) continue;
      const df = s.size;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      qTotalIdf += idf;
      for (const id of s) counts.set(id, (counts.get(id) || 0) + idf);
    }
    if (qTotalIdf === 0) return [];
    const docs = docLen.size || 1, avgdl = (totalLen / docs) || 1, B = 0.75;
    return [...counts.entries()]
      .map(([id, acc]) => {
        const dl = docLen.get(id);
        const norm = dl === undefined ? 1 : 1 / (1 - B + B * Math.max(1, dl / avgdl));
        return { id, score: (acc / qTotalIdf) * norm };
      })
      .filter(r => r.score >= scoreMin)
      .sort((a, b) => b.score - a.score);
  }
  return { add, search };
}

describe('FTS length normalization — the long-document bias fix', () => {
  it('ranks a short precise document above a long sprawling one containing the same query', () => {
    const idx = makeIndex();
    idx.add('short', 'rust ownership');
    // Same query terms present, but buried in a much longer document.
    idx.add('long', 'rust ownership ' + 'plus a great deal of additional unrelated commentary '.repeat(6));
    const r = idx.search('rust ownership');
    expect(r[0].id).toBe('short');
    expect(r.find(x => x.id === 'long').score).toBeLessThan(r[0].score);
  });

  it('does NOT boost short documents above 1.0 (score stays a valid "match %")', () => {
    const idx = makeIndex();
    idx.add('tiny', 'rust');
    idx.add('big', 'rust ' + 'padding text here '.repeat(20));
    for (const r of idx.search('rust')) {
      expect(r.score).toBeLessThanOrEqual(1.0001);
      expect(r.score).toBeGreaterThan(0);
    }
  });

  it('keeps an exact match at 1.0 when the corpus is uniform (no spurious penalty)', () => {
    const idx = makeIndex();
    idx.add('a', 'rust programming');
    expect(idx.search('rust')[0].score).toBeCloseTo(1.0, 5);
  });

  it('applies no penalty at or below average length (factor is exactly 1)', () => {
    const idx = makeIndex();
    idx.add('a', 'alpha beta gamma');
    idx.add('b', 'alpha beta gamma'); // identical lengths -> both at avgdl
    const r = idx.search('alpha beta gamma');
    expect(r[0].score).toBeCloseTo(1.0, 5);
    expect(r[1].score).toBeCloseTo(1.0, 5);
  });

  it('penalty grows monotonically among documents that exceed the average', () => {
    // NOTE: "length" here is the count of DISTINCT grams, so merely repeating the same
    // words does not lengthen a document — only genuinely new vocabulary does. That is a
    // desirable property: an article that repeats a phrase is not "sprawling".
    // Because the factor is penalty-only, anything at or below avgdl sits at exactly 1.0;
    // monotonicity is therefore a statement about documents ABOVE the average. Several
    // short filler docs keep avgdl low so both test documents are above it.
    const filler = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const words = (n) => Array.from({ length: n }, (_, i) => filler.slice(i % 30, (i % 30) + 4) + i).join(' ');
    const idx = makeIndex();
    for (let i = 0; i < 12; i++) idx.add('pad' + i, 'kubernetes operator');
    idx.add('mid', 'kubernetes operator ' + words(15));
    idx.add('huge', 'kubernetes operator ' + words(90));
    const byId = Object.fromEntries(idx.search('kubernetes operator').map(r => [r.id, r.score]));
    expect(byId.pad0).toBeCloseTo(1.0, 5);            // at/below average -> untouched
    expect(byId.mid).toBeLessThan(byId.pad0);          // above average -> penalized
    expect(byId.huge).toBeLessThan(byId.mid);          // further above -> penalized more
  });

  it('a sprawling document cannot become a hub in related-items ranking', () => {
    // Why this matters beyond search: relatedEvents() ranks with the same scorer, so an
    // unnormalized long document would surface as "related" to almost everything.
    const filler = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const words = (n) => Array.from({ length: n }, (_, i) => filler.slice(i % 30, (i % 30) + 4) + i).join(' ');
    const idx = makeIndex();
    idx.add('focused', 'webgpu shaders');
    idx.add('sprawl', 'webgpu shaders ' + words(80));
    for (let i = 0; i < 5; i++) idx.add('other' + i, 'unrelated topic ' + i);
    expect(idx.search('webgpu shaders')[0].id).toBe('focused');
  });

  it('still returns nothing for a query sharing no grams with the corpus', () => {
    const idx = makeIndex();
    idx.add('a', 'rust programming');
    expect(idx.search('qqqq')).toEqual([]);
  });

  it('rare-term discrimination (the pre-existing IDF behaviour) is preserved', () => {
    const idx = makeIndex();
    idx.add('rare', 'rust memory safety');
    for (let i = 0; i < 8; i++) idx.add('common' + i, 'the the the general news item ' + i);
    expect(idx.search('rust')[0].id).toBe('rare');
  });
});

describe('FTS length normalization wiring (index.html)', () => {
  it('tracks per-document length and a running total in the index', () => {
    expect(html).toContain('const docLen=new Map();let totalLen=0;');
    expect(html).toContain('function setLen(id,n){const p=docLen.get(id);if(p!==undefined)totalLen-=p;docLen.set(id,n);totalLen+=n;}');
    expect(html).toContain('function delLen(id){const p=docLen.get(id);if(p!==undefined){totalLen-=p;docLen.delete(id);}}');
  });
  it('maintains length on every mutation path (add/remove/addWord/removeWord)', () => {
    expect(html).toContain('eventGrams.set(ev.id,grams);setLen(ev.id,grams.size);');
    expect(html).toContain('eventGrams.delete(eid);delLen(eid);');
    expect(html).toContain("wordGrams.set(w.id,grams);setLen('word:'+w.id,grams.size);");
    expect(html).toContain("wordGrams.delete(wid);delLen('word:'+wid);");
  });
  it('resets length tracking on rebuild (otherwise the average leaks across rebuilds)', () => {
    expect(html).toContain('index.clear();eventGrams.clear();wordGrams.clear();docLen.clear();totalLen=0;');
  });
  it('applies BM25 b=0.75 as a penalty-only factor', () => {
    expect(html).toContain('const docs=docLen.size||1;const avgdl=(totalLen/docs)||1;const B=0.75;');
    expect(html).toContain('const norm=dl===undefined?1:1/(1-B+B*Math.max(1,dl/avgdl));');
    // Math.max(1, ...) is what makes it penalty-only: no boost below average length.
    expect(html).toContain('return{id,score:(acc/qTotalIdf)*norm};');
  });
  it('removed the unused maxScore map (dead code found during this review)', () => {
    expect(html).not.toContain('const maxScore=new Map();');
  });
  it('leaves the IDF formula itself unchanged', () => {
    expect(html).toContain('const idf=Math.log(1+(N-df+0.5)/(df+0.5));');
  });
});
