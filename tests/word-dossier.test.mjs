// Neus — WordExporter dossier tests
// Mirrors wordSlug + WordExporter.toDossier in index.html.

import { describe, it, expect } from 'vitest';

const isoDate = (ms) => new Date(ms).toISOString();
const wordSlug = (s) => (s || 'word').trim().toLowerCase().replace(/[^a-z0-9ぁ-んァ-ヶ一-龠ー]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'word';
const WORD_FEEDS = { news: { label: 'Google News' }, reddit: { label: 'Reddit' }, hn: { label: 'Hacker News' }, arxiv: { label: 'arXiv' } };
// Mirrored from newSinceReview in index.html
const newSinceReview = (events, reviewedAt) => events.filter(e => (e.timestamp || 0) > (reviewedAt || 0));

// Mirrored from feedLabelOf / signalGaps in index.html
const feedLabelOf = (name) => ((name || '').split('·').pop() || '').trim();
function signalGaps(word, events) {
  const present = new Set(events.map(e => feedLabelOf(e.source?.name)));
  const errs = word.lastErrors || {};
  const active = [], silent = [], errored = [];
  const classify = (label, has) => { if (errs[label]) errored.push({ label, error: errs[label] }); else if (has) active.push(label); else silent.push(label); };
  if (word.sources?.wikipedia) classify('Wikipedia', !!word.wiki?.extract);
  for (const key of Object.keys(WORD_FEEDS)) {
    if (!word.sources?.[key]) continue;
    classify(WORD_FEEDS[key].label, present.has(WORD_FEEDS[key].label));
  }
  return { active, silent, errored };
}

// Mirrored from relatedWords in index.html
function relatedWords(items, others) {
  const hay = items.map(e => `${e.content?.title || ''} ${e.content?.snippet || ''}`).join('\n').toLowerCase();
  if (!hay.trim()) return [];
  const res = [];
  for (const ow of others) {
    const n = (ow.normalized || '').toLowerCase();
    const isAscii = /^[\x00-\x7f]+$/.test(n);
    if (n.length < (isAscii ? 3 : 2)) continue;
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = isAscii ? new RegExp(`\\b${esc}\\b`, 'g') : new RegExp(esc, 'g');
    const m = hay.match(re);
    if (m && m.length) res.push({ term: ow.term, normalized: ow.normalized, count: m.length });
  }
  return res.sort((a, b) => b.count - a.count).slice(0, 6);
}

// Mirrored from sourceTier / tierBreakdown in index.html
const TIER_DEFS = [
  { key: 'research', ja: '一次(研究)', en: 'research' },
  { key: 'press', ja: '報道', en: 'press' },
  { key: 'discussion', ja: '議論', en: 'discussion' },
  { key: 'other', ja: 'その他', en: 'other' },
];
function sourceTier(name) {
  const label = ((name || '').split('·').pop() || '').trim().toLowerCase();
  if (label.includes('arxiv')) return 'research';
  if (label.includes('reddit') || label.includes('hacker')) return 'discussion';
  if (label.includes('news')) return 'press';
  return 'other';
}
function tierBreakdown(events) {
  const counts = new Map();
  for (const ev of events) { const k = sourceTier(ev.source?.name); counts.set(k, (counts.get(k) || 0) + 1); }
  return TIER_DEFS.filter(d => counts.get(d.key)).map(d => ({ tier: d.key, ja: d.ja, en: d.en, count: counts.get(d.key) }));
}

// Mirrored from WordExporter.aggregateTags
function aggregateTags(events) {
  const counts = new Map();
  for (const ev of events) {
    for (const tg of [...(ev.meta?.autoTags || []), ...(ev.meta?.userTags || [])]) {
      if (!tg || tg.startsWith('word:')) continue;
      counts.set(tg, (counts.get(tg) || 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
}

// Mirrored from WordExporter.toDossier
const ys = s => '"' + String(s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
function toDossier(word, events, others = []) {
  const srcList = [...(word.sources?.wikipedia ? ['Wikipedia'] : []), ...Object.keys(WORD_FEEDS).filter(k => word.sources?.[k]).map(k => WORD_FEEDS[k].label)].join(', ') || '-';
  const fresh = newSinceReview(events, word.reviewedAt);
  const gaps = signalGaps(word, events);
  const showGaps = !!word.lastCollectedAt && gaps.silent.length > 0;
  const showErrors = !!word.lastCollectedAt && gaps.errored.length > 0;
  const related = relatedWords(events, others);
  const wikiCanonTitle = word.wiki?.title && word.wiki.title.trim().toLowerCase() !== word.term.trim().toLowerCase() ? word.wiki.title : null;
  const fm = ['---', `term: ${ys(word.term)}`, `lang: ${word.lang || 'en'}`, wikiCanonTitle ? `wiki_title: ${ys(wikiCanonTitle)}` : null, word.note ? `intent: ${ys(word.note)}` : null, `generated_at: ${isoDate(0)}`, `items: ${events.length}`, `unreviewed: ${fresh.length}`, `sources: ${srcList}`, showGaps ? `silent: ${gaps.silent.join(', ')}` : null, showErrors ? `failed: ${gaps.errored.map(e => e.label).join(', ')}` : null, related.length ? `related: ${related.map(r => r.normalized).join(', ')}` : null, word.lastCollectedAt ? `last_collected: ${isoDate(word.lastCollectedAt)}` : null, '---'].filter(Boolean).join('\n');
  const parts = [fm, '', `# ${word.term}`, ''];
  if (word.note) parts.push(`> ${word.note}`, '');
  if (word.wiki?.extract) {
    parts.push(wikiCanonTitle ? `## 定義 (${wikiCanonTitle})` : '## 定義', '', word.wiki.extract, '');
    if (word.wiki.thumbnail) parts.push(`![thumbnail](${word.wiki.thumbnail})`);
    if (word.wiki.url) parts.push(`[Wikipedia](${word.wiki.url})`, '');
  }
  const tiers = tierBreakdown(events);
  if (tiers.length) {
    parts.push('## 出所', '');
    for (const tb of tiers) parts.push(`- ${tb.ja} (${tb.en}): ${tb.count}`);
    parts.push('');
  }
  if (showGaps) parts.push('## 空白', '', `有効だが0件: ${gaps.silent.join(', ')}`, '');
  if (showErrors) parts.push('## 死角', '', `取得失敗: ${gaps.errored.map(e => `${e.label} (${e.error})`).join(', ')}`, '_(沈黙ではなく取得不能。別経路で確認が必要)_', '');
  if (related.length) parts.push('## 関連', '', related.map(r => `- ${r.term} (${r.count})`).join('\n'), '');
  if (fresh.length) {
    parts.push(`## 新着 (${fresh.length})`, '');
    for (const ev of fresh) {
      const d = ev.publishedAt ? isoDate(ev.publishedAt).slice(0, 10) : '';
      parts.push(`- [${ev.content.title}](${ev.url || ''})${d ? ` — ${d}` : ''}`);
    }
    parts.push('');
  }
  parts.push(`## 収集アイテム (${events.length})`, '');
  const groups = new Map();
  for (const ev of events) { const k = ev.source.name || 'other'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(ev); }
  for (const [name, list] of groups) {
    parts.push(`### ${name}`, '');
    for (const ev of list) {
      const d = ev.publishedAt ? isoDate(ev.publishedAt).slice(0, 10) : '';
      parts.push(`- [${ev.content.title}](${ev.url || ''})${d ? ` — ${d}` : ''}`);
      if (ev.content.snippet) parts.push(`  - ${ev.content.snippet.slice(0, 200)}`);
    }
    parts.push('');
  }
  const tags = aggregateTags(events);
  if (tags.length) {
    parts.push('## タグ', '', tags.map(([t, n]) => `- ${t} (${n})`).join('\n'), '');
  }
  return parts.join('\n');
}

const mkEvent = (o) => ({ source: { name: o.src }, content: { title: o.title, snippet: o.snippet || '' }, url: o.url, publishedAt: o.publishedAt, timestamp: o.timestamp, meta: { autoTags: o.autoTags || [], userTags: o.userTags || [] } });

describe('wordSlug', () => {
  it('slugifies ASCII terms', () => expect(wordSlug('Web GPU!!')).toBe('web-gpu'));
  it('keeps Japanese characters', () => expect(wordSlug('量子コンピュータ')).toBe('量子コンピュータ'));
  it('falls back to "word" for empty input', () => expect(wordSlug('')).toBe('word'));
});

describe('WordExporter.toDossier', () => {
  const word = { term: 'WebGPU', lang: 'en', normalized: 'webgpu', wiki: { extract: 'WebGPU is a web graphics API.', url: 'https://en.wikipedia.org/wiki/WebGPU' } };
  const events = [
    mkEvent({ src: 'Google News', title: 'WebGPU ships', url: 'https://ex.com/a', publishedAt: Date.parse('2026-01-02'), snippet: 'A summary.' }),
    mkEvent({ src: 'Hacker News', title: 'Show HN: WebGPU demo', url: 'https://ex.com/b', publishedAt: Date.parse('2026-01-01') }),
  ];

  it('emits YAML frontmatter with term/lang/item count', () => {
    const md = toDossier(word, events);
    expect(md.startsWith('---\nterm: "WebGPU"\nlang: en')).toBe(true);
    expect(md).toContain('items: 2');
  });

  it('includes the Wikipedia definition section and link', () => {
    const md = toDossier(word, events);
    expect(md).toContain('## 定義');
    expect(md).toContain('WebGPU is a web graphics API.');
    expect(md).toContain('[Wikipedia](https://en.wikipedia.org/wiki/WebGPU)');
  });

  it('includes a thumbnail image line when wiki.thumbnail is set', () => {
    const w = { ...word, wiki: { ...word.wiki, thumbnail: 'https://upload.wikimedia.org/thumb/x.png' } };
    const md = toDossier(w, events);
    expect(md).toContain('![thumbnail](https://upload.wikimedia.org/thumb/x.png)');
  });

  it('omits the thumbnail line when wiki.thumbnail is absent', () => {
    const md = toDossier(word, events);
    expect(md).not.toContain('![thumbnail]');
  });

  it('adds wiki_title to frontmatter when article title differs from registered term', () => {
    const w = { ...word, term: 'GPT', normalized: 'gpt', wiki: { ...word.wiki, title: 'Generative pre-trained transformer' } };
    const md = toDossier(w, events);
    expect(md).toContain('wiki_title: "Generative pre-trained transformer"');
  });

  it('omits wiki_title from frontmatter when title matches term (case-insensitive)', () => {
    const w = { ...word, wiki: { ...word.wiki, title: 'webgpu' } };
    const md = toDossier(w, events);
    expect(md).not.toContain('wiki_title:');
  });

  it('uses the canonical title in the definition section header when it differs', () => {
    const w = { ...word, term: 'GPT', normalized: 'gpt', wiki: { ...word.wiki, title: 'Generative pre-trained transformer' } };
    const md = toDossier(w, events);
    expect(md).toContain('## 定義 (Generative pre-trained transformer)');
    expect(md).not.toContain('## 定義\n');
  });

  it('uses plain ## 定義 when article title matches the registered term', () => {
    const md = toDossier(word, events);
    expect(md).toContain('## 定義\n');
  });

  it('groups items by source and links each item', () => {
    const md = toDossier(word, events);
    expect(md).toContain('### Google News');
    expect(md).toContain('### Hacker News');
    expect(md).toContain('- [WebGPU ships](https://ex.com/a) — 2026-01-02');
    expect(md).toContain('  - A summary.');
  });

  it('omits the definition section when no wiki summary', () => {
    const md = toDossier({ term: 'X', lang: 'ja', normalized: 'x' }, []);
    expect(md).not.toContain('## 定義');
    expect(md).toContain('## 収集アイテム (0)');
  });

  it('lists enabled sources in the frontmatter using display labels (same namespace as silent/failed)', () => {
    // Storage keys (wikipedia/news/arxiv) and display labels (Wikipedia/Google News/arXiv) must
    // not be mixed in the same YAML document. sources: uses labels, matching silent: and failed:.
    const w = { ...word, sources: { wikipedia: true, news: true, arxiv: true, reddit: false } };
    const md = toDossier(w, events);
    expect(md).toContain('sources: Wikipedia, Google News, arXiv');
    expect(md).not.toContain('sources: wikipedia, news, arxiv');
  });

  it('records last_collected in the frontmatter when present', () => {
    const w = { ...word, lastCollectedAt: Date.parse('2026-01-03T00:00:00Z') };
    expect(toDossier(w, events)).toContain('last_collected: 2026-01-03T00:00:00.000Z');
    expect(toDossier(word, events)).not.toContain('last_collected:');
  });

  it('quotes term containing a colon so YAML stays valid', () => {
    const w = { term: 'Node.js: v18', lang: 'en', normalized: 'nodejs v18' };
    const md = toDossier(w, []);
    expect(md).toContain('term: "Node.js: v18"');
    expect(md).not.toMatch(/^term: Node\.js: v18$/m);
  });

  it('quotes intent (note) containing a newline', () => {
    const w = { ...word, note: 'line one\nline two' };
    const md = toDossier(w, []);
    expect(md).toContain('intent: "line one\\nline two"');
    expect(md).not.toContain('intent: line one');
  });
});

describe('WordExporter.aggregateTags', () => {
  const events = [
    mkEvent({ src: 'A', title: 't1', autoTags: ['word:webgpu', 'watch:ai', 'graphics'] }),
    mkEvent({ src: 'B', title: 't2', autoTags: ['watch:ai'], userTags: ['fav'] }),
  ];

  it('counts tags across items, excluding word: tags', () => {
    const tags = aggregateTags(events);
    expect(tags).toEqual([['watch:ai', 2], ['graphics', 1], ['fav', 1]]);
    expect(tags.some(([t]) => t.startsWith('word:'))).toBe(false);
  });

  it('renders a タグ section in the dossier', () => {
    const md = toDossier({ term: 'WebGPU', lang: 'en', normalized: 'webgpu' }, events);
    expect(md).toContain('## タグ');
    expect(md).toContain('- watch:ai (2)');
  });

  it('omits the タグ section when no non-word tags exist', () => {
    const md = toDossier({ term: 'X', lang: 'en', normalized: 'x' }, [mkEvent({ src: 'A', title: 't', autoTags: ['word:x'] })]);
    expect(md).not.toContain('## タグ');
  });
});

// A word is a question, and the value is the delta since last review (Socratic reframe).
describe('newSinceReview', () => {
  const events = [
    mkEvent({ src: 'A', title: 'old', timestamp: 100 }),
    mkEvent({ src: 'A', title: 'new', timestamp: 300 }),
  ];
  it('returns only items collected after the review timestamp', () => {
    expect(newSinceReview(events, 200).map(e => e.content.title)).toEqual(['new']);
  });
  it('treats a missing reviewedAt as "everything is new"', () => {
    expect(newSinceReview(events, undefined)).toHaveLength(2);
  });
});

describe('WordExporter.toDossier — intent + delta', () => {
  const word = { term: 'WebGPU', lang: 'en', normalized: 'webgpu', note: 'production-ready?', reviewedAt: 200 };
  const events = [
    mkEvent({ src: 'News', title: 'old item', url: 'https://ex.com/o', publishedAt: Date.parse('2026-01-01'), timestamp: 100 }),
    mkEvent({ src: 'News', title: 'fresh item', url: 'https://ex.com/n', publishedAt: Date.parse('2026-01-03'), timestamp: 300 }),
  ];

  it('records the intent (question) in frontmatter and as a blockquote', () => {
    const md = toDossier(word, events);
    expect(md).toContain('intent: "production-ready?"');
    expect(md).toContain('> production-ready?');
  });

  it('counts and lists only unreviewed items in the 新着 section', () => {
    const md = toDossier(word, events);
    expect(md).toContain('unreviewed: 1');
    expect(md).toContain('## 新着 (1)');
    expect(md).toContain('- [fresh item](https://ex.com/n) — 2026-01-03');
    // The reviewed (old) item is absent from 新着 but still present in 収集アイテム
    expect(md.split('## 収集アイテム')[0]).not.toContain('old item');
    expect(md).toContain('- [old item](https://ex.com/o)');
  });

  it('omits the 新着 section and reports zero when all items are reviewed', () => {
    const md = toDossier({ ...word, reviewedAt: 9999 }, events);
    expect(md).toContain('unreviewed: 0');
    expect(md).not.toContain('## 新着');
  });

  it('omits intent lines when the word has no note', () => {
    const md = toDossier({ term: 'X', lang: 'en', normalized: 'x', reviewedAt: 0 }, []);
    expect(md).not.toContain('intent:');
    expect(md).not.toMatch(/^> /m);
  });
});

// Episteme vs doxa: not all collected information carries equal weight (Socratic reframe).
describe('sourceTier', () => {
  it('classifies feeds into epistemic tiers by label suffix', () => {
    expect(sourceTier('WebGPU · arXiv')).toBe('research');
    expect(sourceTier('WebGPU · Google News')).toBe('press');
    expect(sourceTier('WebGPU · Reddit')).toBe('discussion');
    expect(sourceTier('WebGPU · Hacker News')).toBe('discussion');
  });
  it('ranks discussion before press so "Hacker News" is not mistaken for press', () => {
    expect(sourceTier('X · Hacker News')).not.toBe('press');
  });
  it('falls back to "other" for unknown sources', () => {
    expect(sourceTier('Some Blog')).toBe('other');
    expect(sourceTier('')).toBe('other');
  });
});

describe('tierBreakdown', () => {
  const events = [
    mkEvent({ src: 'WebGPU · arXiv', title: 'paper' }),
    mkEvent({ src: 'WebGPU · Google News', title: 'press a' }),
    mkEvent({ src: 'WebGPU · Google News', title: 'press b' }),
    mkEvent({ src: 'WebGPU · Reddit', title: 'thread' }),
    mkEvent({ src: 'WebGPU · Hacker News', title: 'hn' }),
  ];
  it('counts items per tier in research > press > discussion order', () => {
    expect(tierBreakdown(events)).toEqual([
      { tier: 'research', ja: '一次(研究)', en: 'research', count: 1 },
      { tier: 'press', ja: '報道', en: 'press', count: 2 },
      { tier: 'discussion', ja: '議論', en: 'discussion', count: 2 },
    ]);
  });
  it('omits empty tiers', () => {
    expect(tierBreakdown([mkEvent({ src: 'WebGPU · arXiv', title: 'p' })])).toEqual([
      { tier: 'research', ja: '一次(研究)', en: 'research', count: 1 },
    ]);
  });
  it('renders a 出所 section in the dossier', () => {
    const md = toDossier({ term: 'WebGPU', lang: 'en', normalized: 'webgpu', reviewedAt: 0 }, events);
    expect(md).toContain('## 出所');
    expect(md).toContain('- 一次(研究) (research): 1');
    expect(md).toContain('- 報道 (press): 2');
    expect(md).toContain('- 議論 (discussion): 2');
  });
});

// Knowing what you don't know (aporia): enabled sources that returned nothing.
describe('WordExporter.toDossier — signal gaps', () => {
  const events = [mkEvent({ src: 'WebGPU · Google News', title: 'press' })];

  it('records silent sources in frontmatter and a 空白 section after collection', () => {
    const word = { term: 'WebGPU', lang: 'en', normalized: 'webgpu', reviewedAt: 0, lastCollectedAt: 1000, sources: { news: true, arxiv: true, reddit: true } };
    const md = toDossier(word, events);
    expect(md).toContain('silent: Reddit, arXiv');
    expect(md).toContain('## 空白');
    expect(md).toContain('有効だが0件: Reddit, arXiv');
  });

  it('stays silent about gaps before the first collection (no lastCollectedAt)', () => {
    const word = { term: 'WebGPU', lang: 'en', normalized: 'webgpu', reviewedAt: 0, sources: { news: true, arxiv: true } };
    const md = toDossier(word, events);
    expect(md).not.toContain('## 空白');
    expect(md).not.toContain('silent:');
  });

  it('omits the 空白 section when every enabled source produced items', () => {
    const word = { term: 'WebGPU', lang: 'en', normalized: 'webgpu', reviewedAt: 0, lastCollectedAt: 1000, sources: { news: true } };
    const md = toDossier(word, events);
    expect(md).not.toContain('## 空白');
  });
});

// Words are not islands (Socratic dialectic): mutual reference across the inquiry.
describe('WordExporter.toDossier — related words', () => {
  const word = { term: 'WebGPU', lang: 'en', normalized: 'webgpu', reviewedAt: 0 };
  const events = [mkEvent({ src: 'News', title: 'WebGPU vs WebGL', snippet: 'also wgpu' })];
  const others = [{ term: 'WebGL', normalized: 'webgl' }, { term: 'wgpu', normalized: 'wgpu' }];

  it('records related words in frontmatter and a 関連 section', () => {
    const md = toDossier(word, events, others);
    expect(md).toContain('related: webgl, wgpu');
    expect(md).toContain('## 関連');
    expect(md).toContain('- WebGL (1)');
    expect(md).toContain('- wgpu (1)');
  });

  it('omits relatedness when no other word is mentioned', () => {
    const md = toDossier(word, events, [{ term: 'Vulkan', normalized: 'vulkan' }]);
    expect(md).not.toContain('## 関連');
    expect(md).not.toContain('related:');
  });

  it('defaults to no relatedness when others is not supplied', () => {
    expect(toDossier(word, events)).not.toContain('## 関連');
  });
});

describe('toDossier — 死角 (fetch failures as blind spots)', () => {
  const baseWord = { term: 'X', normalized: 'x', lang: 'en', sources: { news: true, reddit: true }, wiki: null, lastCollectedAt: Date.now() };

  it('adds a failed: line to frontmatter when a source errored', () => {
    const w = { ...baseWord, lastErrors: { 'Google News': 'http_503' } };
    const md = toDossier(w, []);
    expect(md).toContain('failed: Google News');
  });

  it('renders ## 死角 section with error codes', () => {
    const w = { ...baseWord, lastErrors: { 'Reddit': 'network' } };
    const md = toDossier(w, []);
    expect(md).toContain('## 死角');
    expect(md).toContain('Reddit (network)');
    expect(md).toContain('沈黙ではなく取得不能');
  });

  it('omits 死角 when no errors occurred', () => {
    expect(toDossier(baseWord, [])).not.toContain('## 死角');
    expect(toDossier(baseWord, [])).not.toContain('failed:');
  });

  it('omits 死角 when lastCollectedAt is not set (no collection yet)', () => {
    const w = { ...baseWord, lastCollectedAt: null, lastErrors: { 'Reddit': 'network' } };
    expect(toDossier(w, [])).not.toContain('## 死角');
  });

  it('lists multiple failed sources', () => {
    const w = { ...baseWord, lastErrors: { 'Google News': 'parse', 'Reddit': 'http_404' } };
    const md = toDossier(w, []);
    expect(md).toContain('Google News (parse)');
    expect(md).toContain('Reddit (http_404)');
  });
});

