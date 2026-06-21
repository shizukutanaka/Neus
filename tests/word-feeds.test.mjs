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
// Two flavors: keyword-search feeds embed the encoded query verbatim;
// tag/topic feeds (Qiita, Zenn) slugify the term (lowercase, hyphenated).
const tagSlug = (q) => encodeURIComponent(decodeURIComponent(q).trim().toLowerCase().replace(/\s+/g, '-'));
const SEARCH_FEEDS = {
  news:   { label: 'Google News', build: (q, lang) => { const hl = lang === 'ja' ? 'ja' : 'en-US', gl = lang === 'ja' ? 'JP' : 'US', ceid = lang === 'ja' ? 'JP:ja' : 'US:en'; return `https://news.google.com/rss/search?q=${q}&hl=${hl}&gl=${gl}&ceid=${ceid}`; } },
  reddit: { label: 'Reddit',      build: (q) => `https://www.reddit.com/search.rss?q=${q}&sort=new` },
  hn:     { label: 'Hacker News',  build: (q) => `https://hnrss.org/newest?q=${q}&count=30` },
  arxiv:  { label: 'arXiv',        build: (q) => `https://export.arxiv.org/api/query?search_query=all:${q}&sortBy=submittedDate&sortOrder=descending&max_results=30` },
};
const TAG_FEEDS = {
  qiita:  { label: 'Qiita', build: (q) => `https://qiita.com/tags/${tagSlug(q)}/feed` },
  zenn:   { label: 'Zenn',  build: (q) => `https://zenn.dev/topics/${tagSlug(q)}/feed` },
};
const WORD_FEEDS = { ...SEARCH_FEEDS, ...TAG_FEEDS };

const wikiUrl = (term, lang) => `https://${lang || 'en'}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent((term || '').trim().replace(/\s+/g, '_'))}`;

describe('WORD_FEEDS builders — search feeds', () => {
  it('embeds the encoded query verbatim in every search feed', () => {
    const q = encodeURIComponent('quantum computing');
    expect(q).toBe('quantum%20computing');
    for (const key of Object.keys(SEARCH_FEEDS)) {
      const url = SEARCH_FEEDS[key].build(q, 'en');
      expect(url, `${key} dropped the encoded query`).toContain('quantum%20computing');
      expect(url.startsWith('https://')).toBe(true);
      expect(() => new URL(url)).not.toThrow();
    }
  });

  it('encodes Japanese terms safely', () => {
    const q = encodeURIComponent('量子コンピュータ');
    const url = SEARCH_FEEDS.news.build(q, 'ja');
    expect(url).toContain(q);
    expect(() => new URL(url)).not.toThrow();
  });

  it('Google News localizes hl/gl/ceid by language', () => {
    expect(SEARCH_FEEDS.news.build('x', 'ja')).toContain('hl=ja&gl=JP&ceid=JP:ja');
    expect(SEARCH_FEEDS.news.build('x', 'en')).toContain('hl=en-US&gl=US&ceid=US:en');
  });

  it('targets the expected hosts', () => {
    expect(new URL(SEARCH_FEEDS.news.build('x', 'en')).hostname).toBe('news.google.com');
    expect(new URL(SEARCH_FEEDS.reddit.build('x')).hostname).toBe('www.reddit.com');
    expect(new URL(SEARCH_FEEDS.hn.build('x')).hostname).toBe('hnrss.org');
    expect(new URL(SEARCH_FEEDS.arxiv.build('x')).hostname).toBe('export.arxiv.org');
  });
});

describe('WORD_FEEDS builders — Qiita / Zenn tag feeds', () => {
  // Qiita and Zenn expose tag/topic Atom feeds, NOT keyword-search RSS.
  // The watchword is mapped to a tag slug; non-existent tags 404 and surface
  // through lastErrors as http_404 (honest "no such tag" signal).
  it('produces a tag-feed URL on the canonical host/path', () => {
    expect(TAG_FEEDS.qiita.build(encodeURIComponent('rust'))).toBe('https://qiita.com/tags/rust/feed');
    expect(TAG_FEEDS.zenn.build(encodeURIComponent('rust'))).toBe('https://zenn.dev/topics/rust/feed');
  });
  it('lowercases the term and joins multi-word terms with hyphens', () => {
    expect(TAG_FEEDS.qiita.build(encodeURIComponent('WebGPU'))).toBe('https://qiita.com/tags/webgpu/feed');
    expect(TAG_FEEDS.qiita.build(encodeURIComponent('Machine Learning'))).toBe('https://qiita.com/tags/machine-learning/feed');
    expect(TAG_FEEDS.zenn.build(encodeURIComponent('Next JS'))).toBe('https://zenn.dev/topics/next-js/feed');
  });
  it('round-trips Japanese tags through percent-encoding without corruption', () => {
    const ja = encodeURIComponent('機械学習');
    const url = TAG_FEEDS.qiita.build(ja);
    expect(url.startsWith('https://qiita.com/tags/')).toBe(true);
    expect(decodeURIComponent(new URL(url).pathname.split('/')[2])).toBe('機械学習');
  });
  it('produces a parseable URL for empty / whitespace input (graceful, not crash)', () => {
    // The collector still surfaces this as a 404 from the platform.
    expect(() => new URL(TAG_FEEDS.qiita.build(encodeURIComponent('   ')))).not.toThrow();
    expect(() => new URL(TAG_FEEDS.zenn.build(encodeURIComponent('')))).not.toThrow();
  });
  it('targets the expected hosts', () => {
    expect(new URL(TAG_FEEDS.qiita.build('x')).hostname).toBe('qiita.com');
    expect(new URL(TAG_FEEDS.zenn.build('x')).hostname).toBe('zenn.dev');
  });
});

describe('WORD_FEEDS source-drift guard (index.html)', () => {
  it('declares qiita and zenn as collectable sources', () => {
    expect(html).toContain('qiita: {label:');
    expect(html).toContain('zenn:  {label:');
    expect(html).toContain('https://qiita.com/tags/');
    expect(html).toContain('https://zenn.dev/topics/');
  });
  it('exposes opt-in toggles in the watchword modal (default off, like arXiv)', () => {
    expect(html).toContain('id="wsrc-qiita"');
    expect(html).toContain('id="wsrc-zenn"');
    // Defaults: the literal default-sources object must NOT enable them
    expect(html).toContain('arxiv:false,qiita:false,zenn:false');
  });
  it('the per-word modal source list includes both', () => {
    expect(html).toContain("{key:'qiita',label:'Qiita'}");
    expect(html).toContain("{key:'zenn',label:'Zenn'}");
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

describe('SourceFailTracker word-source guard', () => {
  // Mirrors the guard added to the inbound.error subscriber
  const isWordSource = (id) => typeof id === 'string' && id.startsWith('word:');
  it('skips auto-disable bookkeeping for synthetic word sources', () => {
    expect(isWordSource('word:abc-123')).toBe(true);
    expect(isWordSource('rss-source-uuid')).toBe(false);
    expect(isWordSource(undefined)).toBe(false);
  });
  it('index.html guards the inbound.error handler against word: ids', () => {
    expect(html).toContain("source.id.startsWith('word:')");
  });
});

describe('Wikipedia language fallback order', () => {
  // Mirrors fetchWiki: try [word.lang, 'en'] de-duplicated
  const langOrder = (lang) => [...new Set([lang || 'en', 'en'])];
  it('tries the localized language first, then English', () => {
    expect(langOrder('ja')).toEqual(['ja', 'en']);
  });
  it('does not duplicate when already English', () => {
    expect(langOrder('en')).toEqual(['en']);
    expect(langOrder(undefined)).toEqual(['en']);
  });
});

describe('source drift guard (index.html / _worker.js)', () => {
  it('index.html declares the expected feed hosts', () => {
    for (const frag of ['news.google.com/rss/search', 'reddit.com/search.rss', 'hnrss.org/newest', 'export.arxiv.org/api/query', 'rest_v1/page/summary', 'qiita.com/tags/', 'zenn.dev/topics/']) {
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
