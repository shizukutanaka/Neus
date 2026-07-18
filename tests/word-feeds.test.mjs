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
  hatena: { label: 'Hatena',      build: (q) => `https://b.hatena.ne.jp/search/text?q=${q}&sort=recent&users=3&safe=on&mode=rss` },
};
// Qiita: JSON full-text search via the official REST API v2 (ADR-0017), routed through /json.
// Mirror of index.html: prefer rendered_body (HTML) over body (Markdown); strip tags then
// decode entities (textarea trick works under jsdom, matching RSSPoller.decodeEntities).
const decodeEntities = (s) => { if (!s || s.indexOf('&') < 0) return s; const ta = document.createElement('textarea'); ta.innerHTML = s; return ta.value; };
// Shared engagement -> score helper (mirror of index.html engagementScore).
const engagementScore = (n) => 50 + Math.min(25, Math.round(Math.log10((n || 0) + 1) * 12));
const JSON_FEEDS = {
  qiita: { label: 'Qiita', kind: 'json',
    build: (q) => `https://qiita.com/api/v2/items?query=${q}&per_page=30`,
    parse: (text) => { const d = JSON.parse(text); return Array.isArray(d) ? d.map(it => ({ title: it.title || '(untitled)', link: it.url, summary: decodeEntities((it.rendered_body || it.body || '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim().slice(0, 500), publishedAt: Date.parse(it.created_at) || undefined, author: it.user?.id || '', tags: (it.tags || []).map(t => t && t.name).filter(Boolean), score: engagementScore(it.likes_count) })) : []; } },
};
// Zenn: tag/topic Atom feed (no official search API), routed through /rss.
// GitHub: Topics Atom feed (github.com/topics/{slug}.atom), routed through /rss.
// GitHub slug: lowercase alphanumeric + hyphens ("Next.js" -> "next-js", "machine learning" -> "machine-learning").
const githubSlug = (q) => decodeURIComponent(q).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const TAG_FEEDS = {
  zenn:   { label: 'Zenn',   build: (q) => `https://zenn.dev/topics/${zennSlug(q)}/feed` },
  github: { label: 'GitHub', build: (q) => `https://github.com/topics/${encodeURIComponent(githubSlug(q))}.atom` },
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
  it('builds a full-text search RSS URL sorted by recency with a 3-bookmark quality floor + safe search', () => {
    expect(SEARCH_FEEDS.hatena.build(encodeURIComponent('rust'))).toBe('https://b.hatena.ne.jp/search/text?q=rust&sort=recent&users=3&safe=on&mode=rss');
  });
  it('applies users=3 to exclude 1-2 bookmark noise (serves the "broadly bookmarked" role)', () => {
    expect(SEARCH_FEEDS.hatena.build('x')).toContain('users=3');
  });
  it('applies safe=on to exclude adult content (clean default for a web-wide aggregator)', () => {
    expect(SEARCH_FEEDS.hatena.build('x')).toContain('safe=on');
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

describe('engagementScore — shared signal-to-score curve', () => {
  it('returns 50 at zero/absent signal (parity with other sources)', () => {
    expect(engagementScore(0)).toBe(50);
    expect(engagementScore(undefined)).toBe(50);
    expect(engagementScore(null)).toBe(50);
  });
  it('boosts logarithmically and caps at +25', () => {
    expect(engagementScore(9)).toBe(62);     // log10(10)=1 -> +12
    expect(engagementScore(99)).toBe(74);    // log10(100)=2 -> +24
    expect(engagementScore(999)).toBe(75);   // +36 -> capped at +25
    expect(engagementScore(1e9)).toBe(75);   // stays capped
  });
  it('is monotonic non-decreasing in the signal', () => {
    let prev = -1;
    for (const n of [0, 1, 5, 20, 80, 300, 5000]) { const s = engagementScore(n); expect(s).toBeGreaterThanOrEqual(prev); prev = s; }
  });
  it('Qiita likes and Hatena bookmarks map through the same curve', () => {
    // A Qiita item with 99 likes and a Hatena item with 99 bookmarks get the same score.
    const qiitaScore = JSON_FEEDS.qiita.parse(JSON.stringify([{ url: 'u', created_at: '', user: { id: 'a' }, likes_count: 99 }]))[0].score;
    expect(qiitaScore).toBe(engagementScore(99));
  });
});

describe('Qiita JSON search feed (official REST API v2)', () => {
  it('builds a query-search API URL (full-text, not tag-limited)', () => {
    expect(JSON_FEEDS.qiita.build(encodeURIComponent('rust'))).toBe('https://qiita.com/api/v2/items?query=rust&per_page=30');
  });
  it('requests 30 items per page (parity with HN/arXiv coverage, same 1-request rate cost)', () => {
    expect(JSON_FEEDS.qiita.build('x')).toContain('per_page=30');
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
      { title: 'Rust入門', url: 'https://qiita.com/a/items/1', rendered_body: '<h1>H</h1><p>Rust is <b>great</b>.</p>   ', body: '# H\nRust is **great**.', created_at: '2026-01-02T03:04:05+09:00', user: { id: 'alice' } },
      { title: 'Async', url: 'https://qiita.com/a/items/2', rendered_body: '', body: '', created_at: 'not-a-date', user: null },
    ]);
    const raws = JSON_FEEDS.qiita.parse(sample);
    expect(raws).toHaveLength(2);
    expect(raws[0]).toMatchObject({ title: 'Rust入門', link: 'https://qiita.com/a/items/1', author: 'alice' });
    expect(raws[0].summary).toBe('HRust is great.');             // tags stripped (no space injection — correct for JP prose)
    expect(raws[0].publishedAt).toBe(Date.parse('2026-01-02T03:04:05+09:00'));
    expect(raws[1].publishedAt).toBeUndefined();                   // unparseable date -> undefined (no fabrication)
    expect(raws[1].author).toBe('');                              // missing user handled
  });
  it('prefers rendered_body (HTML) over body (Markdown) so summaries are not markdown noise', () => {
    // Regression: stripping HTML tags from the Markdown `body` left # * ` [text](url) in
    // the snippet. Use rendered_body (real HTML) so the stripped result is clean prose.
    const sample = JSON.stringify([{ title: 'T', url: 'u', rendered_body: '<p>clean prose here</p>', body: '## clean `prose` **here** [x](y)', created_at: '', user: { id: 'a' } }]);
    const r = JSON_FEEDS.qiita.parse(sample)[0];
    expect(r.summary).toBe('clean prose here');
    expect(r.summary).not.toContain('#');
    expect(r.summary).not.toContain('`');
    expect(r.summary).not.toContain('[x]');
  });
  it('decodes HTML entities AFTER stripping tags (so &lt;x&gt; is not lost as a fake tag)', () => {
    const sample = JSON.stringify([{ title: 'T', url: 'u', rendered_body: '<p>a &amp; b &lt;tag&gt; c</p>', created_at: '', user: { id: 'a' } }]);
    expect(JSON_FEEDS.qiita.parse(sample)[0].summary).toBe('a & b <tag> c');
  });
  it('falls back to body when rendered_body is absent', () => {
    const sample = JSON.stringify([{ title: 'T', url: 'u', body: 'plain body text', created_at: '', user: { id: 'a' } }]);
    expect(JSON_FEEDS.qiita.parse(sample)[0].summary).toBe('plain body text');
  });
  it('surfaces the article tags as raw.tags (for autoTag enrichment)', () => {
    const sample = JSON.stringify([{ title: 'T', url: 'u', created_at: '', user: { id: 'a' }, tags: [{ name: 'Rust' }, { name: 'WebAssembly' }] }]);
    expect(JSON_FEEDS.qiita.parse(sample)[0].tags).toEqual(['Rust', 'WebAssembly']);
  });
  it('defaults to an empty tag list when the item has none', () => {
    const sample = JSON.stringify([{ title: 'T', url: 'u', created_at: '', user: { id: 'a' } }]);
    expect(JSON_FEEDS.qiita.parse(sample)[0].tags).toEqual([]);
  });
  it('derives a gentle engagement score from likes_count (log-scaled, capped at +25)', () => {
    const score = (likes) => JSON_FEEDS.qiita.parse(JSON.stringify([{ url: 'u', created_at: '', user: { id: 'a' }, likes_count: likes }]))[0].score;
    expect(score(0)).toBe(50);     // no likes -> parity with other sources
    expect(score(9)).toBe(62);     // log10(10)=1 -> +12
    expect(score(99)).toBe(74);    // log10(100)=2 -> +24
    expect(score(99999)).toBe(75); // capped at +25
  });
  it('defaults the score to 50 when likes_count is absent', () => {
    const sample = JSON.stringify([{ title: 'T', url: 'u', created_at: '', user: { id: 'a' } }]);
    expect(JSON_FEEDS.qiita.parse(sample)[0].score).toBe(50);
  });
  it('caps the summary length and tolerates a missing title', () => {
    const sample = JSON.stringify([{ url: 'u', rendered_body: 'x'.repeat(900), created_at: '', user: { id: 'b' } }]);
    const r = JSON_FEEDS.qiita.parse(sample)[0];
    expect(r.title).toBe('(untitled)');
    expect(r.summary.length).toBe(500);
  });
  it('throws on malformed JSON so the collector records a parse error', () => {
    expect(() => JSON_FEEDS.qiita.parse('not json')).toThrow();
  });
  it('returns no items for a valid-but-non-array body (e.g. an error object) instead of throwing', () => {
    // Qiita rate-limit/errors are normally non-200 (handled before parse), but a 200 with a
    // non-array body must not throw a TypeError mislabeled as a parse error.
    expect(JSON_FEEDS.qiita.parse('{"message":"rate limit","type":"rate_limit_exceeded"}')).toEqual([]);
    expect(JSON_FEEDS.qiita.parse('null')).toEqual([]);
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

describe('GitHub Topics Atom feed', () => {
  it('produces a .atom topic URL on the canonical host/path', () => {
    expect(TAG_FEEDS.github.build(encodeURIComponent('webgpu'))).toBe('https://github.com/topics/webgpu.atom');
  });
  it('joins words with hyphens (GitHub topic convention)', () => {
    expect(TAG_FEEDS.github.build(encodeURIComponent('machine learning'))).toBe('https://github.com/topics/machine-learning.atom');
  });
  it('strips dots to hyphens ("Next.js" -> "next-js")', () => {
    expect(TAG_FEEDS.github.build(encodeURIComponent('Next.js'))).toBe('https://github.com/topics/next-js.atom');
    expect(TAG_FEEDS.github.build(encodeURIComponent('Node.js'))).toBe('https://github.com/topics/node-js.atom');
  });
  it('strips leading and trailing hyphens from the slug', () => {
    const url = TAG_FEEDS.github.build(encodeURIComponent('.foo.'));
    const slug = decodeURIComponent(new URL(url).pathname.split('/')[2].replace('.atom', ''));
    expect(slug).toBe('foo');
    expect(slug).not.toMatch(/^-|-$/);
  });
  it('produces a parseable URL for empty / whitespace input (graceful, not crash)', () => {
    expect(() => new URL(TAG_FEEDS.github.build(encodeURIComponent('')))).not.toThrow();
    expect(() => new URL(TAG_FEEDS.github.build(encodeURIComponent('   ')))).not.toThrow();
  });
  it('targets github.com', () => {
    expect(new URL(TAG_FEEDS.github.build('x')).hostname).toBe('github.com');
  });
  it('the path ends in .atom', () => {
    expect(new URL(TAG_FEEDS.github.build(encodeURIComponent('rust'))).pathname.endsWith('.atom')).toBe(true);
  });
});

describe('language-aware default sources (modeled)', () => {
  // Mirror of defaultSources() in index.html.
  const defaultSources = (lang) => lang === 'ja'
    ? { wikipedia: true, news: true, reddit: false, hn: false, arxiv: false, qiita: true, zenn: true, hatena: true, github: false }
    : { wikipedia: true, news: true, reddit: true, hn: true, arxiv: false, qiita: false, zenn: false, hatena: false, github: false };

  it('enables the Japanese sources by default for ja users', () => {
    const ja = defaultSources('ja');
    expect(ja.qiita).toBe(true);
    expect(ja.zenn).toBe(true);
    expect(ja.hatena).toBe(true);
  });
  it('drops English-centric Reddit/HN for ja users', () => {
    const ja = defaultSources('ja');
    expect(ja.reddit).toBe(false);
    expect(ja.hn).toBe(false);
  });
  it('keeps the original English defaults for en users (JP sources off)', () => {
    const en = defaultSources('en');
    expect(en).toEqual({ wikipedia: true, news: true, reddit: true, hn: true, arxiv: false, qiita: false, zenn: false, hatena: false, github: false });
  });
  it('GitHub is off by default for both languages (topic-only, English slugs only)', () => {
    expect(defaultSources('ja').github).toBe(false);
    expect(defaultSources('en').github).toBe(false);
  });
  it('always enables the universal sources (Wikipedia + Google News)', () => {
    for (const lang of ['ja', 'en']) {
      expect(defaultSources(lang).wikipedia).toBe(true);
      expect(defaultSources(lang).news).toBe(true);
    }
  });
  it('declares the same source keys regardless of language', () => {
    expect(Object.keys(defaultSources('ja')).sort()).toEqual(Object.keys(defaultSources('en')).sort());
  });
});

describe('language-aware defaults wiring (index.html)', () => {
  it('defines defaultSources() switching on currentLang', () => {
    expect(html).toContain('function defaultSources()');
    expect(html).toContain("return currentLang==='ja'");
    expect(html).toContain('{wikipedia:true,news:true,reddit:false,hn:false,arxiv:false,qiita:true,zenn:true,hatena:true,github:false}');
  });
  it('word creation and import use defaultSources() (no hardcoded literal)', () => {
    expect(html).toContain('sources:defaultSources()');
    expect(html).not.toContain('sources:{wikipedia:true,news:true,reddit:true,hn:true,arxiv:false,qiita:false,zenn:false,hatena:false,github:false}');
  });
  it('the words modal syncs its source checkboxes to the language default on open', () => {
    expect(html).toContain("const ds=defaultSources();for(const k of Object.keys(ds)){const cb=$('#wsrc-'+k);if(cb)cb.checked=ds[k];}");
  });
});

describe('WORD_FEEDS source-drift guard (index.html)', () => {
  it('declares qiita (JSON search), zenn (tag feed), hatena (search RSS) and github (topic Atom) as collectable sources', () => {
    expect(html).toContain("qiita: {label:'Qiita', kind:'json',");
    expect(html).toContain('https://qiita.com/api/v2/items?query=');
    expect(html).toContain('zenn:  {label:');
    expect(html).toContain('https://zenn.dev/topics/');
    expect(html).toContain("hatena:{label:'Hatena',");
    expect(html).toContain('https://b.hatena.ne.jp/search/text?q=');
    expect(html).toContain("github:{label:'GitHub',");
    expect(html).toContain('https://github.com/topics/');
  });
  it('routes JSON-kind feeds through /json and RSS feeds through /rss', () => {
    expect(html).toContain("`${CONFIG.proxy}/${isJson?'json':'rss'}?url=${encodeURIComponent(feedUrl)}`");
    expect(html).toContain('isJson?feed.parse(body).map(raw=>({raw,source})):RSSPoller.parseFeed(body,source)');
  });
  it('Qiita parse prefers rendered_body and decodes entities via the shared helper', () => {
    expect(html).toContain('RSSPoller.decodeEntities((it.rendered_body||it.body||\'\').replace(/<[^>]+>/g,\'\'))');
    expect(html).toContain('return{fetchOne,fetchAll,parseFeed,decodeEntities}');
  });
  it('Qiita parse derives an engagement score and the handler honors raw.score', () => {
    expect(html).toContain('score:engagementScore(it.likes_count)');
    expect(html).toContain('score:typeof raw.score===\'number\'?raw.score:50');
  });
  it('shares one engagementScore helper and parseFeed reads Hatena bookmark count', () => {
    expect(html).toContain('function engagementScore(n){return 50+Math.min(25,Math.round(Math.log10((n||0)+1)*12));}');
    expect(html).toContain("const bmc=Number(get('hatena\\\\:bookmarkcount'))||0;");
    expect(html).toContain('...(bmc>0?{score:engagementScore(bmc)}:{}),');
  });
  it('exposes opt-in toggles in the watchword modal (default off, like arXiv)', () => {
    expect(html).toContain('id="wsrc-qiita"');
    expect(html).toContain('id="wsrc-zenn"');
    expect(html).toContain('id="wsrc-hatena"');
    expect(html).toContain('id="wsrc-github"');
    // Defaults: the literal default-sources object must NOT enable them
    expect(html).toContain('arxiv:false,qiita:false,zenn:false,hatena:false,github:false');
  });
  it('the per-word modal source list includes all four specialist sources', () => {
    expect(html).toContain("{key:'qiita',label:'Qiita'}");
    expect(html).toContain("{key:'zenn',label:'Zenn'}");
    expect(html).toContain("{key:'hatena',label:'Hatena'}");
    expect(html).toContain("{key:'github',label:'GitHub'}");
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
    for (const frag of ['news.google.com/rss/search', 'reddit.com/search.rss', 'hnrss.org/newest', 'export.arxiv.org/api/query', 'rest_v1/page/summary', 'qiita.com/api/v2/items', 'zenn.dev/topics/', 'b.hatena.ne.jp/search/text', 'github.com/topics/']) {
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
