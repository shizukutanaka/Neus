// Neus — Core utility unit tests
// Coverage target: ≥ 80% (goal.md §2.3)

import { describe, it, expect, beforeEach } from 'vitest';
import { loadFunctions, evaluate, extractFunction, extractConst } from './helpers/from-source.mjs';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// ===== The real functions, pulled out of index.html =====
//
// round 94: these used to be hand-copied mirrors, and the header claimed they were the
// production functions. `tokenize` had not been one since round 37, when the real one gained
// CJK script-boundary segmentation. The copy still did the old whitespace-only split:
//
//   tokenize('Rustの所有権とライフタイム入門')
//     mirror -> ["rustの所有権とライフタイム入門"]        one undifferentiated token
//     real   -> ["rust","所有権","ライフタイム","入門"]
//
// Every test here stayed green for 56 rounds because they compared the copy against itself,
// using English input where the two happen to agree. Exactly the hazard round 66 found in the
// OPML mirror, and the reason `tests/helpers/from-source.mjs` exists.
//
// So the copies are gone. These bindings are evaluated out of index.html, which means a change
// to the implementation changes what these tests exercise.

const { normalizeUrl, jaccard } = loadFunctions(['normalizeUrl', 'jaccard']);
const { tokenize } = evaluate(
  [extractConst('CJK_RE'), extractFunction('charKind'),
   extractFunction('scriptRuns'), extractFunction('tokenize')].join('\n'), ['tokenize']);

// escapeHtml
const HE = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => HE[c]);

// ngrams is nested inside the FTSIndex IIFE, hence the indent, and reads CONFIG.ftsGram.
const { ngrams } = evaluate(extractFunction('ngrams', '  '), ['ngrams'], { CONFIG: { ftsGram: 2 } });

// FTSIndex (in-memory, synchronous for testing)
function buildFTSIndex() {
  const index = new Map(); const eventGrams = new Map();
  function add(id, text) {
    const grams = ngrams(text);
    eventGrams.set(id, grams);
    for (const g of grams) { let s = index.get(g); if (!s) index.set(g, s = new Set()); s.add(id); }
  }
  function search(query, limit = 100) {
    const qGrams = ngrams(query); if (qGrams.size === 0) return [];
    const counts = new Map();
    for (const g of qGrams) { const s = index.get(g); if (!s) continue; for (const id of s) counts.set(id, (counts.get(id) || 0) + 1); }
    return [...counts.entries()].map(([id, hits]) => ({ id, score: hits / qGrams.size })).filter(r => r.score >= 0.4).sort((a, b) => b.score - a.score).slice(0, limit);
  }
  return { add, search, size: () => index.size };
}

// The OPML mirror that used to live here was deleted in round 66. It had drifted from the real
// implementation in two ways nobody noticed, because a mirror is only checked against itself:
// its build() still emitted the pre-rename product name, and it lacked the escapeAttr/dateCreated
// the real build() has. Coverage moved to tests/browser-opml-parse.spec.mjs, which evaluates the
// real functions out of index.html in a real browser — see tests/helpers/from-source.mjs.

// ===== TESTS =====

describe('normalizeUrl', () => {
  it('strips utm_source', () => {
    const url = 'https://example.com/post?utm_source=twitter&id=1';
    expect(normalizeUrl(url)).toBe('https://example.com/post?id=1');
  });
  it('strips hash', () => {
    expect(normalizeUrl('https://example.com/page#section')).toBe('https://example.com/page');
  });
  it('strips fbclid', () => {
    expect(normalizeUrl('https://example.com/?fbclid=abc123')).toBe('https://example.com/');
  });
  it('preserves non-tracking params', () => {
    expect(normalizeUrl('https://example.com/?page=2&sort=asc')).toBe('https://example.com/?page=2&sort=asc');
  });
  it('returns original on invalid URL', () => {
    expect(normalizeUrl('not-a-url')).toBe('not-a-url');
  });
});

describe('dedup key uses the normalized URL (pipeline entry)', () => {
  // inbound.fetched hashes sha256(normalizeUrl(raw.link)+'|'+title), so the same article
  // fetched via different feeds (tracking params, fragment) collapses to one dedup key.
  it('collapses tracking-param and fragment variants to one key', () => {
    const a = normalizeUrl('https://ex.com/a?utm_source=x&id=1');
    const b = normalizeUrl('https://ex.com/a?id=1#top');
    expect(a).toBe(b);                 // identical normalized key -> identical hash -> dedup
    expect(a).toBe('https://ex.com/a?id=1');
  });
  it('keeps genuinely different URLs distinct', () => {
    expect(normalizeUrl('https://ex.com/a')).not.toBe(normalizeUrl('https://ex.com/b'));
  });
});

describe('jaccard', () => {
  it('returns 1.0 for identical sets', () => {
    const A = new Set(['a', 'b', 'c']);
    expect(jaccard(A, new Set(['a', 'b', 'c']))).toBe(1);
  });
  it('returns 0.0 for disjoint sets', () => {
    expect(jaccard(new Set(['a']), new Set(['b']))).toBe(0);
  });
  it('returns 0.0 for both empty', () => {
    expect(jaccard(new Set(), new Set())).toBe(0);
  });
  it('returns 0.5 for half overlap', () => {
    const A = new Set(['a', 'b']); const B = new Set(['b', 'c']);
    expect(jaccard(A, B)).toBeCloseTo(1/3, 5);
  });
  it('detects near-duplicate titles (≥0.8)', () => {
    const a = new Set(tokenize('Breaking: New AI Model Released Today'));
    const b = new Set(tokenize('Breaking New AI Model Released Today'));
    expect(jaccard(a, b)).toBeGreaterThanOrEqual(0.8);
  });
});

describe('dedup comparison window cap (ADR-0019)', () => {
  // recentEvents() walks the timestamp index with a 'prev' (descending) cursor, so the
  // array it resolves is already newest-first. Capping via slice(0, N) therefore keeps the
  // temporally-closest candidates — where real duplicates cluster — not an arbitrary cutoff.
  const dedupCompareMax = 300;
  const fakeRecent = (n) => Array.from({ length: n }, (_, i) => ({ id: `e${i}`, timestamp: 1000 - i }));

  it('leaves the candidate list untouched when under the cap', () => {
    const recent = fakeRecent(50);
    expect(recent.slice(0, dedupCompareMax)).toHaveLength(50);
  });
  it('caps the candidate list at dedupCompareMax when the window is fuller', () => {
    const recent = fakeRecent(1000);
    const capped = recent.slice(0, dedupCompareMax);
    expect(capped).toHaveLength(dedupCompareMax);
  });
  it('keeps the newest-first ordering after capping (most recent, not arbitrary, candidates survive)', () => {
    const recent = fakeRecent(1000);
    const capped = recent.slice(0, dedupCompareMax);
    expect(capped[0].id).toBe('e0');                       // newest
    expect(capped[capped.length - 1].id).toBe('e299');     // 300th-newest
    expect(capped.some(e => e.id === 'e999')).toBe(false); // oldest, correctly dropped
  });
});

describe('dedup comparison window cap wiring (index.html)', () => {
  it('declares dedupCompareMax alongside the existing dedup config', () => {
    expect(html).toContain('dedupTitleThreshold:0.8, dedupWindowMs:24*60*60*1000, dedupCompareMax:300');
  });
  it('passes the cap into recentEvents itself (round 28: the cursor now stops early instead of reading the whole window then slicing)', () => {
    expect(html).toContain('const recent=await Store.recentEvents(CONFIG.dedupWindowMs,CONFIG.dedupCompareMax);');
    expect(html).toContain('async recentEvents(windowMs,cap=Infinity){');
    expect(html).toContain('if(!c||results.length>=cap)return resolve(results);');
  });
});

describe('tokenize', () => {
  it('splits English text', () => {
    expect(tokenize('Hello World')).toEqual(['hello', 'world']);
  });
  it('filters short words (< 2 chars)', () => {
    expect(tokenize('a is ok')).toEqual(['is', 'ok']);
  });
  it('handles empty/null', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize(null)).toEqual([]);
  });
  it('strips punctuation', () => {
    expect(tokenize('hello, world!')).toEqual(['hello', 'world']);
  });
  it('handles CJK (passes through)', () => {
    const result = tokenize('人工知能 AI モデル');
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('escapeHtml', () => {
  it('escapes < and >', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
  });
  it('escapes &', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });
  it('escapes quotes', () => {
    expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;');
  });
  it('handles numbers', () => {
    expect(escapeHtml(42)).toBe('42');
  });
  it('no double-escaping', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });
});

describe('ngrams', () => {
  it('produces 2-grams', () => {
    const g = ngrams('hello', 2);
    expect(g.has('he')).toBe(true);
    expect(g.has('el')).toBe(true);
    expect(g.has('lo')).toBe(true);
  });
  it('handles short string', () => {
    expect(ngrams('a', 2).has('a')).toBe(true);
  });
  it('case-normalizes', () => {
    const g = ngrams('HELLO', 2);
    expect(g.has('he')).toBe(true);
  });
  it('returns empty Set for empty input', () => {
    expect(ngrams('', 2).size).toBe(0);
  });
});

describe('FTSIndex', () => {
  let fts;
  beforeEach(() => { fts = buildFTSIndex(); });

  it('adds and searches a document', () => {
    fts.add('ev1', 'rust programming language systems');
    const results = fts.search('rust');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toBe('ev1');
  });

  it('returns empty for no match', () => {
    fts.add('ev1', 'kubernetes cluster orchestration');
    expect(fts.search('python')).toHaveLength(0);
  });

  it('ranks higher match score first', () => {
    fts.add('ev1', 'rust programming language');
    fts.add('ev2', 'rust language compiler systems low level');
    const results = fts.search('rust language');
    expect(results[0].score).toBeGreaterThanOrEqual(results[1]?.score ?? 0);
  });

  it('handles 1000 events under 100ms', () => {
    for (let i = 0; i < 1000; i++) {
      fts.add(`ev${i}`, `kubernetes docker container ${i % 10 === 0 ? 'rust' : 'go'} cloud`);
    }
    const t0 = Date.now();
    fts.search('rust kubernetes');
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(100);
  });
});

describe('Worker security', () => {
  const PRIVATE_HOST_RE = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|169\.254\.|0\.0\.0\.0)/i;

  it('blocks localhost', () => {
    expect(PRIVATE_HOST_RE.test('localhost')).toBe(true);
  });
  it('blocks 127.0.0.1', () => {
    expect(PRIVATE_HOST_RE.test('127.0.0.1')).toBe(true);
  });
  it('blocks 10.x.x.x', () => {
    expect(PRIVATE_HOST_RE.test('10.0.0.1')).toBe(true);
  });
  it('blocks 192.168.x.x', () => {
    expect(PRIVATE_HOST_RE.test('192.168.1.1')).toBe(true);
  });
  it('allows public IPs', () => {
    expect(PRIVATE_HOST_RE.test('8.8.8.8')).toBe(false);
    expect(PRIVATE_HOST_RE.test('news.ycombinator.com')).toBe(false);
  });
});
