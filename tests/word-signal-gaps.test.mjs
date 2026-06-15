// Neus — Watchword "signal gaps" tests (aporia / knowing what you don't know)
// Enabled sources that returned nothing are information too: they mark the
// boundary of the inquiry. Mirrors feedLabelOf / signalGaps in index.html.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

const WORD_FEEDS = { news: { label: 'Google News' }, reddit: { label: 'Reddit' }, hn: { label: 'Hacker News' }, arxiv: { label: 'arXiv' } };
const feedLabelOf = (name) => ((name || '').split('·').pop() || '').trim();
function signalGaps(word, events) {
  const present = new Set(events.map(e => feedLabelOf(e.source?.name)));
  const active = [], silent = [];
  if (word.sources?.wikipedia) (word.wiki?.extract ? active : silent).push('Wikipedia');
  for (const key of Object.keys(WORD_FEEDS)) {
    if (!word.sources?.[key]) continue;
    (present.has(WORD_FEEDS[key].label) ? active : silent).push(WORD_FEEDS[key].label);
  }
  return { active, silent };
}

const ev = (label) => ({ source: { name: `WebGPU · ${label}` } });

describe('feedLabelOf', () => {
  it('extracts the feed label from a word event source name', () => {
    expect(feedLabelOf('WebGPU · Google News')).toBe('Google News');
    expect(feedLabelOf('量子 · arXiv')).toBe('arXiv');
  });
  it('returns the whole string when there is no separator', () => {
    expect(feedLabelOf('Some Blog')).toBe('Some Blog');
    expect(feedLabelOf('')).toBe('');
  });
});

describe('signalGaps', () => {
  const word = { sources: { wikipedia: true, news: true, reddit: true, hn: true, arxiv: true }, wiki: { extract: 'def' } };

  it('separates enabled sources into those that produced items and those that were silent', () => {
    const { active, silent } = signalGaps(word, [ev('Google News'), ev('Reddit')]);
    expect(active).toContain('Google News');
    expect(active).toContain('Reddit');
    expect(active).toContain('Wikipedia'); // wiki has an extract -> active
    expect(silent).toEqual(['Hacker News', 'arXiv']);
  });

  it('treats Wikipedia as silent when enabled but no extract was fetched', () => {
    const w = { sources: { wikipedia: true, arxiv: true }, wiki: null };
    const { active, silent } = signalGaps(w, [ev('arXiv')]);
    expect(active).toEqual(['arXiv']);
    expect(silent).toEqual(['Wikipedia']);
  });

  it('ignores sources that were never enabled', () => {
    const w = { sources: { news: true }, wiki: null };
    const { active, silent } = signalGaps(w, []);
    expect(active).toEqual([]);
    expect(silent).toEqual(['Google News']);
    // arXiv/Reddit/HN/Wikipedia are not enabled, so they are neither active nor silent
    expect(silent).not.toContain('arXiv');
  });

  it('reports no silence when every enabled source produced something', () => {
    const w = { sources: { news: true, arxiv: true }, wiki: null };
    const { silent } = signalGaps(w, [ev('Google News'), ev('arXiv')]);
    expect(silent).toEqual([]);
  });
});

describe('signal-gap wiring (index.html)', () => {
  it('declares signalGaps and gates it on a prior collection', () => {
    expect(html).toContain('function signalGaps');
    expect(html).toContain('word.lastCollectedAt&&gaps.silent.length');
  });
  it('surfaces the gap in both the WORDS view and the dossier', () => {
    expect(html).toContain('class="word-gap"');
    expect(html).toContain('## 空白');
  });
});
