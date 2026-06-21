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
// Three flavors: keyword-search RSS feeds embed the encoded query verbatim;
// Qiita uses the official JSON REST API v2 (full-text search via /json);
// Zenn uses a tag/topic Atom feed (no official search API), slugified.
// Zenn topic normalization (no hyphens; lowercase alphanumeric + Japanese, separators stripped).
const zennSlug = (q) => encodeURIComponent(decodeURIComponent(q).trim().toLowerCase().replace(/[^a-z0-9ぁ-んァ-ヶ一-龠ー]+/g, ''));
const SEARCH_FEEDS = {
  news:   { label: 'Google News', build: (q, lang) => { const hl = lang === 'ja' ? 'ja' : 'en-US', gl = lang === 'ja' ? 'JP' : 'US', ceid = lang === 'ja' ? 'JP:ja' : 'US:en'; return `https://news.google.com/rss/search?q=${q}&hl=${hl}&gl=${gl}&ceid=${ceid}`; } },
  reddit: { label: 'Reddit',      build: (q) => `https://www.reddit.com/search.rss?q=${q}&sort=new` },
  hn:     { label: 'Hacker News',  build: (q) => `https://hnrss.org/newest?q=${q}&count=30` },
  arxiv:  { label: 'arXiv',        build: (q) => `https://export.arxiv.org/api/query?search_query=all:${q}&sortBy=submittedDate&sortOrder=descending&max_results=30` },
  hatena: { label: 'Hatena',      build: (q) => `https://b.hatena.ne.jp/search/text?q=${q}&sort=recent&mode=rss` },
};
// Qiita: JSON full-text search via the official REST API v2 (ADR-0017), routed through /json.
const JSON_FEEDS = {
  qiita: { label: 'Qiita', kind: 'json',
    build: (q) => `https://qiita.com/api/v2/items?query=${q}&per_page=20`,
    parse: (text) => JSON.parse(text).map(it => ({ title: it.title || '(untitled)', link: it.url, summary: (it.body || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 500), publishedAt: Date.parse(it.created_at) || undefined, author: it.user?.id || '' })) },
};
// Zenn: tag/topic Atom feed (no official search API), routed through /rss.
const TAG_FEEDS = {
  zenn: { label: 'Zenn', build: (q) => `https://zenn.dev/topics/${zennSlug(q)}/feed` },
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
    expect(new URL(SEARCH_FEEDS.hatena.build('x')).hostname).toBe('b.hatena.ne.jp');
  });
});

describe('Hatena Bookmark search feed (cross-platform JP aggregator)', () => {
  // Full-text search RSS across the whole Japanese web's bookmarked links,
  // complementing single-platform Qiita/Zenn. Reuses /rss (no Worker change).
  it('builds a full-text search RSS URL sorted by recency', () => {
    expect(SEARCH_FEEDS.hatena.build(encodeURIComponent('rust'))).toBe('https://b.hatena.ne.jp/search/text?q=rust&sort=recent&mode=rss');
  });
  it('passes the query verbatim (multiword + Japanese) and requests RSS', () => {
    expect(SEARCH_FEEDS.hatena.build(encodeURIComponent('Machine Learning'))).toContain('q=Machine%20Learning');
    expect(SEARCH_FEEDS.hatena.build(encodeURIComponent('機械学習'))).toContain('q=%E6%A9%9F%E6%A2%B0%E5%AD%A6%E7%BF%92');
    expect(SEARCH_FEEDS.hatena.build('x')).toContain('mode=rss');
  });
  it('produces a parseable URL for empty input (graceful, not crash)', () => {
    expect(() => new URL(SEARCH_FEEDS.hatena.build(encodeURIComponent('')))).not.toThrow();
  });
});

describe('Qiita JSON search feed (official REST API v2)', () => {
  it('builds a query-search API URL (full-text, not tag-limited)', () => {
    expect(JSON_FEEDS.qiita.build(encodeURIComponent('rust'))).toBe('https://qiita.com/api/v2/items?query=rust&per_page=20');
  });
  it('passes the raw query verbatim (search engine handles case/multiword)', () => {
    expect(JSON_FEEDS.qiita.build(encodeURIComponent('Machine Learning'))).toContain('query=Machine%20Learning');
    expect(JSON_FEEDS.qiita.build(encodeURIComponent('機械学習'))).toContain('query=%E6%A9%9F%E6%A2%B0%E5%AD%A6%E7%BF%92');
  });
  it('targets qiita.com (must be on the Worker /json allowlist)', () => {
    expect(new URL(JSON_FEEDS.qiita.build('x')).hostname).toBe('qiita.com');
  });
  it('parses the API item array into normalized raw events', () => {
    const sample = JSON.stringify([
      { title: 'Rust入門', url: 'https://qiita.com/a/items/1', body: '# H\nRust is <b>great</b>.   ', created_at: '2026-01-02T03:04:05+09:00', user: { id: 'alice' } },
      { title: 'Async', url: 'https://qiita.com/a/items/2', body: '', created_at: 'not-a-date', user: null },
    ]);
    const raws = JSON_FEEDS.qiita.parse(sample);
    expect(raws).toHaveLength(2);
    expect(raws[0]).toMatchObject({ title: 'Rust入門', link: 'https://qiita.com/a/items/1', author: 'alice' });
    expect(raws[0].summary).toBe('# H Rust is great.');            // HTML stripped, whitespace collapsed
    expect(raws[0].publishedAt).toBe(Date.parse('2026-01-02T03:04:05+09:00'));
    expect(raws[1].publishedAt).toBeUndefined();                   // unparseable date -> undefined (no fabrication)
    expect(raws[1].author).toBe('');                              // missing user handled
  });
  it('caps the summary length and tolerates a missing title', () => {
    const sample = JSON.stringify([{ url: 'u', body: 'x'.repeat(900), created_at: '', user: { id: 'b' } }]);
    const r = JSON_FEEDS.qiita.parse(sample)[0];
    expect(r.title).toBe('(untitled)');
    expect(r.summary.length).toBe(500);
  });
  it('throws on malformed JSON so the collector records a parse error', () => {
    expect(() => JSON_FEEDS.qiita.parse('not json')).toThrow();
  });
});

describe('Zenn tag feed (no official search API)', () => {
  it('produces a topic-feed URL on the canonical host/path', () => {
    expect(TAG_FEEDS.zenn.build(encodeURIComponent('rust'))).toBe('https://zenn.dev/topics/rust/feed');
  });
  it('strips dots/spaces to a concatenated lowercase token (topics like nextjs)', () => {
    expect(TAG_FEEDS.zenn.build(encodeURIComponent('Next.js'))).toBe('https://zenn.dev/topics/nextjs/feed');
    expect(TAG_FEEDS.zenn.build(encodeURIComponent('Node.js'))).toBe('https://zenn.dev/topics/nodejs/feed');
    expect(TAG_FEEDS.zenn.build(encodeURIComponent('Machine Learning'))).toBe('https://zenn.dev/topics/machinelearning/feed');
  });
  it('never produces a hyphen in the slug', () => {
    for (const term of ['Next.js', 'Machine Learning', 'create react app']) {
      expect(decodeURIComponent(new URL(TAG_FEEDS.zenn.build(encodeURIComponent(term))).pathname)).not.toContain('-');
    }
  });
  it('round-trips Japanese topics through percent-encoding without corruption', () => {
    const url = TAG_FEEDS.zenn.build(encodeURIComponent('機械学習'));
    expect(decodeURIComponent(new URL(url).pathname.split('/')[2])).toBe('機械学習');
  });
  it('produces a parseable URL for empty / whitespace input (graceful, not crash)', () => {
    expect(() => new URL(TAG_FEEDS.zenn.build(encodeURIComponent('   ')))).not.toThrow();
    expect(() => new URL(TAG_FEEDS.zenn.build(encodeURIComponent('')))).not.toThrow();
  });
  it('targets zenn.dev', () => {
    expect(new URL(TAG_FEEDS.zenn.build('x')).hostname).toBe('zenn.dev');
  });
});

describe('WORD_FEEDS source-drift guard (index.html)', () => {
  it('declares qiita (JSON search), zenn (tag feed) and hatena (search RSS) as collectable sources', () => {
    expect(html).toContain("qiita: {label:'Qiita', kind:'json',");
    expect(html).toContain('https://qiita.com/api/v2/items?query=');
    expect(html).toContain('zenn:  {label:');
    expect(html).toContain('https://zenn.dev/topics/');
    expect(html).toContain("hatena:{label:'Hatena',");
    expect(html).toContain('https://b.hatena.ne.jp/search/text?q=');
  });
  it('routes JSON-kind feeds through /json and RSS feeds through /rss', () => {
    expect(html).toContain("`${CONFIG.proxy}/${isJson?'json':'rss'}?url=${encodeURIComponent(feedUrl)}`");
    expect(html).toContain('isJson?feed.parse(body).map(raw=>({raw,source})):RSSPoller.parseFeed(body,source)');
  });
  it('exposes opt-in toggles in the watchword modal (default off, like arXiv)', () => {
    expect(html).toContain('id="wsrc-qiita"');
    expect(html).toContain('id="wsrc-zenn"');
    expect(html).toContain('id="wsrc-hatena"');
    // Defaults: the literal default-sources object must NOT enable them
    expect(html).toContain('arxiv:false,qiita:false,zenn:false,hatena:false');
  });
  it('the per-word modal source list includes all three', () => {
    expect(html).toContain("{key:'qiita',label:'Qiita'}");
    expect(html).toContain("{key:'zenn',label:'Zenn'}");
    expect(html).toContain("{key:'hatena',label:'Hatena'}");
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
    for (const frag of ['news.google.com/rss/search', 'reddit.com/search.rss', 'hnrss.org/newest', 'export.arxiv.org/api/query', 'rest_v1/page/summary', 'qiita.com/api/v2/items', 'zenn.dev/topics/', 'b.hatena.ne.jp/search/text']) {
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
