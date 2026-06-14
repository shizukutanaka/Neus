// Neus — WordExporter dossier tests
// Mirrors wordSlug + WordExporter.toDossier in index.html.

import { describe, it, expect } from 'vitest';

const isoDate = (ms) => new Date(ms).toISOString();
const wordSlug = (s) => (s || 'word').trim().toLowerCase().replace(/[^a-z0-9ぁ-んァ-ヶ一-龠ー]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'word';

// Mirrored from WordExporter.toDossier
function toDossier(word, events) {
  const fm = ['---', `term: ${word.term}`, `lang: ${word.lang || 'en'}`, `generated_at: ${isoDate(0)}`, `items: ${events.length}`, '---'].join('\n');
  const parts = [fm, '', `# ${word.term}`, ''];
  if (word.wiki?.extract) {
    parts.push('## 定義', '', word.wiki.extract, '');
    if (word.wiki.url) parts.push(`[Wikipedia](${word.wiki.url})`, '');
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
  return parts.join('\n');
}

const mkEvent = (o) => ({ source: { name: o.src }, content: { title: o.title, snippet: o.snippet || '' }, url: o.url, publishedAt: o.publishedAt });

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
});
