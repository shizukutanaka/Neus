// Neus — WordCollector feed-URL builder tests
// Mirrors WORD_FEEDS in index.html and guards against source drift.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');
const worker = readFileSync(join(__dirname, '..', '_worker.js'), 'utf8');

// ===== Pure builders mirrored from WORD_FEEDS in index.html =====
const WORD_FEEDS = {
  news:   { label: 'Google News', build: (q, lang) => { const hl = lang === 'ja' ? 'ja' : 'en-US', gl = lang === 'ja' ? 'JP' : 'US', ceid = lang === 'ja' ? 'JP:ja' : 'US:en'; return `https://news.google.com/rss/search?q=${q}&hl=${hl}&gl=${gl}&ceid=${ceid}`; } },
  reddit: { label: 'Reddit',      build: (q) => `https://www.reddit.com/search.rss?q=${q}&sort=new` },
  hn:     { label: 'Hacker News',  build: (q) => `https://hnrss.org/newest?q=${q}&count=30` },
  arxiv:  { label: 'arXiv',        build: (q) => `https://export.arxiv.org/api/query?search_query=all:${q}&sortBy=submittedDate&sortOrder=descending&max_results=30` },
};

const wikiUrl = (term, lang) => `https://${lang || 'en'}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent((term || '').trim().replace(/\s+/g, '_'))}`;

describe('WORD_FEEDS builders', () => {
  it('encodes the query term for every source', () => {
    const q = encodeURIComponent('quantum computing');
    expect(q).toBe('quantum%20computing');
    for (const key of Object.keys(WORD_FEEDS)) {
      const url = WORD_FEEDS[key].build(q, 'en');
      expect(url).toContain('quantum%20computing');
      expect(url.startsWith('https://')).toBe(true);
      // Must be parseable as a URL
      expect(() => new URL(url)).not.toThrow();
    }
  });

  it('encodes Japanese terms safely', () => {
    const q = encodeURIComponent('量子コンピュータ');
    const url = WORD_FEEDS.news.build(q, 'ja');
    expect(url).toContain(q);
    expect(() => new URL(url)).not.toThrow();
  });

  it('Google News localizes hl/gl/ceid by language', () => {
    expect(WORD_FEEDS.news.build('x', 'ja')).toContain('hl=ja&gl=JP&ceid=JP:ja');
    expect(WORD_FEEDS.news.build('x', 'en')).toContain('hl=en-US&gl=US&ceid=US:en');
  });

  it('targets the expected hosts', () => {
    expect(new URL(WORD_FEEDS.news.build('x', 'en')).hostname).toBe('news.google.com');
    expect(new URL(WORD_FEEDS.reddit.build('x')).hostname).toBe('www.reddit.com');
    expect(new URL(WORD_FEEDS.hn.build('x')).hostname).toBe('hnrss.org');
    expect(new URL(WORD_FEEDS.arxiv.build('x')).hostname).toBe('export.arxiv.org');
  });
});

describe('Wikipedia summary URL', () => {
  it('builds a REST summary URL for the chosen language', () => {
    expect(wikiUrl('WebGPU', 'en')).toBe('https://en.wikipedia.org/api/rest_v1/page/summary/WebGPU');
  });
  it('underscores and encodes multi-word titles', () => {
    expect(wikiUrl('quantum computing', 'ja')).toBe('https://ja.wikipedia.org/api/rest_v1/page/summary/quantum_computing');
  });
});

describe('source drift guard (index.html / _worker.js)', () => {
  it('index.html declares the expected feed hosts', () => {
    for (const frag of ['news.google.com/rss/search', 'reddit.com/search.rss', 'hnrss.org/newest', 'export.arxiv.org/api/query', 'rest_v1/page/summary']) {
      expect(html, `missing feed host: ${frag}`).toContain(frag);
    }
  });
  it('index.html collects words via the /rss and /json proxy endpoints', () => {
    expect(html).toContain('/rss?url=');
    expect(html).toContain('/json?url=');
  });
  it('worker exposes /json gated by a Wikipedia/Wikimedia allowlist', () => {
    expect(worker).toContain("path === '/json'");
    expect(worker).toMatch(/wikipedia\\?\.org\|wikimedia\\?\.org/);
    expect(worker).toContain('host_not_allowed');
  });
});
