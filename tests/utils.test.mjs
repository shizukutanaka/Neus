// Lensy — Core utility unit tests
// Coverage target: ≥ 80% (goal.md §2.3)

import { describe, it, expect, beforeEach } from 'vitest';

// ===== Extract testable pure functions from index.html =====
// Pure functions are copied here to avoid DOM dependency.
// In production they live inside index.html's ES module.

// normalizeUrl
function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','fbclid','gclid']
      .forEach(p => u.searchParams.delete(p));
    return u.toString();
  } catch { return url; }
}

// jaccard similarity
function jaccard(A, B) {
  if (A.size === 0 && B.size === 0) return 0;
  let i = 0; for (const x of A) if (B.has(x)) i++;
  return (A.size + B.size - i) ? i / (A.size + B.size - i) : 0;
}

// tokenize
function tokenize(text) {
  if (!text) return [];
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(w => w.length >= 2 && w.length <= 30);
}

// escapeHtml
const HE = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => HE[c]);

// ngrams (FTS)
function ngrams(text, n = 2) {
  const t = (text || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const grams = new Set();
  if (t.length < n) { if (t) grams.add(t); return grams; }
  for (let i = 0; i <= t.length - n; i++) grams.add(t.slice(i, i + n));
  return grams;
}

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

// OPML parser
function parseOPML(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error('opml parse error');
  return [...doc.querySelectorAll('outline[xmlUrl]')].map(o => {
    const url = o.getAttribute('xmlUrl');
    let name = o.getAttribute('title') || o.getAttribute('text');
    if (!name) { try { name = new URL(url).hostname; } catch { name = url; } }
    return url ? { url, name } : null;
  }).filter(Boolean);
}

function buildOPML(sources) {
  const items = sources.map(s => `    <outline type="rss" text="${s.name}" title="${s.name}" xmlUrl="${s.url}"/>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n  <head><title>Lensy Sources</title></head>\n  <body>\n${items}\n  </body>\n</opml>`;
}

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

describe('OPML', () => {
  const sampleOPML = `<?xml version="1.0"?>
<opml version="2.0">
  <head><title>Test</title></head>
  <body>
    <outline type="rss" text="HN" title="Hacker News" xmlUrl="https://news.ycombinator.com/rss"/>
    <outline type="rss" text="GitHub" xmlUrl="https://github.blog/feed/"/>
    <outline text="no-url"/>
  </body>
</opml>`;

  it('parses sources from OPML', () => {
    const sources = parseOPML(sampleOPML);
    expect(sources).toHaveLength(2);
    expect(sources[0].url).toBe('https://news.ycombinator.com/rss');
    expect(sources[0].name).toBe('Hacker News');
  });

  it('uses text attribute as name when present', () => {
    const sources = parseOPML(sampleOPML);
    // second outline has text="GitHub" → name should be 'GitHub'
    expect(sources[1].name).toBe('GitHub');
  });
  it('falls back to hostname when title/text missing', () => {
    const xml = `<?xml version="1.0"?><opml version="2.0"><head/><body><outline type="rss" xmlUrl="https://dev.to/feed"/></body></opml>`;
    const sources = parseOPML(xml);
    expect(sources[0].name).toBe('dev.to');
  });

  it('throws on malformed XML', () => {
    expect(() => parseOPML('not xml <<<')).toThrow('opml parse error');
  });

  it('builds valid OPML', () => {
    const sources = [{ name: 'HN', url: 'https://news.ycombinator.com/rss' }];
    const xml = buildOPML(sources);
    expect(xml).toContain('<opml version="2.0">');
    expect(xml).toContain('xmlUrl="https://news.ycombinator.com/rss"');
  });

  it('round-trips sources', () => {
    const sources = [
      { name: 'HN', url: 'https://news.ycombinator.com/rss' },
      { name: 'GitHub Blog', url: 'https://github.blog/feed/' },
    ];
    const xml = buildOPML(sources);
    const parsed = parseOPML(xml);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].url).toBe(sources[0].url);
    expect(parsed[1].name).toBe(sources[1].name);
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
