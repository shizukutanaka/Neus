// Neus — WordExporter dossier tests
// Mirrors wordSlug + WordExporter.toDossier in index.html.

import { describe, it, expect } from 'vitest';

const isoDate = (ms) => new Date(ms).toISOString();
const wordSlug = (s) => (s || 'word').trim().toLowerCase().replace(/[^a-z0-9ぁ-んァ-ヶ一-龠ー]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'word';
const WORD_FEEDS = { news: {}, reddit: {}, hn: {}, arxiv: {} };
// Mirrored from newSinceReview in index.html
const newSinceReview = (events, reviewedAt) => events.filter(e => (e.timestamp || 0) > (reviewedAt || 0));

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
function toDossier(word, events) {
  const srcList = ['wikipedia', ...Object.keys(WORD_FEEDS)].filter(k => word.sources?.[k]).join(', ') || '-';
  const fresh = newSinceReview(events, word.reviewedAt);
  const fm = ['---', `term: ${word.term}`, `lang: ${word.lang || 'en'}`, word.note ? `intent: ${word.note}` : null, `generated_at: ${isoDate(0)}`, `items: ${events.length}`, `unreviewed: ${fresh.length}`, `sources: ${srcList}`, word.lastCollectedAt ? `last_collected: ${isoDate(word.lastCollectedAt)}` : null, '---'].filter(Boolean).join('\n');
  const parts = [fm, '', `# ${word.term}`, ''];
  if (word.note) parts.push(`> ${word.note}`, '');
  if (word.wiki?.extract) {
    parts.push('## 定義', '', word.wiki.extract, '');
    if (word.wiki.url) parts.push(`[Wikipedia](${word.wiki.url})`, '');
  }
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
    expect(md.startsWith('---\nterm: WebGPU\nlang: en')).toBe(true);
    expect(md).toContain('items: 2');
  });

  it('includes the Wikipedia definition section and link', () => {
    const md = toDossier(word, events);
    expect(md).toContain('## 定義');
    expect(md).toContain('WebGPU is a web graphics API.');
    expect(md).toContain('[Wikipedia](https://en.wikipedia.org/wiki/WebGPU)');
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

  it('lists enabled sources in the frontmatter', () => {
    const w = { ...word, sources: { wikipedia: true, news: true, arxiv: true, reddit: false } };
    const md = toDossier(w, events);
    expect(md).toContain('sources: wikipedia, news, arxiv');
  });

  it('records last_collected in the frontmatter when present', () => {
    const w = { ...word, lastCollectedAt: Date.parse('2026-01-03T00:00:00Z') };
    expect(toDossier(w, events)).toContain('last_collected: 2026-01-03T00:00:00.000Z');
    expect(toDossier(word, events)).not.toContain('last_collected:');
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
    expect(md).toContain('intent: production-ready?');
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
