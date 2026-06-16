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

describe('signalGaps — fetch errors vs silence (a blind spot is not a void)', () => {
  it('classifies a failed source as errored, not silent', () => {
    const w = { sources: { news: true, arxiv: true }, wiki: null, lastErrors: { 'Google News': 'http_503' } };
    const { active, silent, errored } = signalGaps(w, [ev('arXiv')]);
    expect(active).toEqual(['arXiv']);
    expect(silent).toEqual([]); // News did NOT produce items, but it errored — not silence
    expect(errored).toEqual([{ label: 'Google News', error: 'http_503' }]);
  });

  it('keeps a genuinely-empty source in silent while a failed one moves to errored', () => {
    const w = { sources: { news: true, reddit: true }, wiki: null, lastErrors: { 'Reddit': 'network' } };
    const { silent, errored } = signalGaps(w, []);
    expect(silent).toEqual(['Google News']);          // enabled, no items, no error
    expect(errored).toEqual([{ label: 'Reddit', error: 'network' }]); // enabled, failed
  });

  it('reports a Wikipedia fetch failure distinctly from an un-fetched extract', () => {
    const w = { sources: { wikipedia: true }, wiki: null, lastErrors: { 'Wikipedia': 'fetch' } };
    const { silent, errored } = signalGaps(w, []);
    expect(silent).toEqual([]);
    expect(errored).toEqual([{ label: 'Wikipedia', error: 'fetch' }]);
  });

  it('returns an empty errored array when lastErrors is absent', () => {
    const w = { sources: { news: true }, wiki: null };
    expect(signalGaps(w, []).errored).toEqual([]);
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
  it('classifies sources into active / silent / errored', () => {
    expect(html).toContain('const active=[],silent=[],errored=[]');
    expect(html).toContain('const errs=word.lastErrors||{}');
  });
  it('records per-source errors on the word during collection', () => {
    expect(html).toContain("word.lastErrors=Object.keys(errors).length?errors:null");
    expect(html).toContain("errors[label]='network'");
    expect(html).toContain("errors[label]=`http_${res.status}`");
    expect(html).toContain("errors[label]='parse'");
  });
  it('renders a distinct fetch-failed line in the WORDS view', () => {
    expect(html).toContain('class="word-err"');
    expect(html).toContain('gaps.errored.length');
  });
});
