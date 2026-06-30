// Neus — Watchword "signal gaps" tests (aporia / knowing what you don't know)
// Enabled sources that returned nothing are information too: they mark the
// boundary of the inquiry. Mirrors feedLabelOf / signalGaps in index.html.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

const WORD_FEEDS = { news: { label: 'Google News' }, reddit: { label: 'Reddit' }, hn: { label: 'Hacker News' }, arxiv: { label: 'arXiv' }, zenn: { label: 'Zenn' }, hatena: { label: 'Hatena' }, github: { label: 'GitHub' } };
const feedLabelOf = (name) => ((name || '').split('·').pop() || '').trim();
function signalGaps(word, events) {
  const present = new Set(events.map(e => feedLabelOf(e.source?.name)));
  const errs = word.lastErrors || {};
  const active = [], silent = [], errored = [];
  // Zenn and GitHub use topic feeds: 404 means "no matching topic" (by design), not a fetch failure.
  const topicFeeds = new Set([WORD_FEEDS.zenn.label, WORD_FEEDS.github.label]);
  const classify = (label, has) => {
    const err = errs[label];
    if (err && !(topicFeeds.has(label) && err === 'http_404')) errored.push({ label, error: err });
    else if (has) active.push(label);
    else silent.push(label);
  };
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

  it('treats a Zenn 404 as silence (no matching topic), not a blind spot', () => {
    // Zenn returns 404 when no topic matches the term (by design, ADR-0017). That is
    // "no signal for this term", not an unreachable source — so it belongs in silent.
    const w = { sources: { zenn: true }, wiki: null, lastErrors: { 'Zenn': 'http_404' } };
    const { silent, errored } = signalGaps(w, []);
    expect(silent).toEqual(['Zenn']);
    expect(errored).toEqual([]);
  });

  it('still treats a Zenn non-404 failure (e.g. network) as a real error', () => {
    const w = { sources: { zenn: true }, wiki: null, lastErrors: { 'Zenn': 'network' } };
    const { silent, errored } = signalGaps(w, []);
    expect(silent).toEqual([]);
    expect(errored).toEqual([{ label: 'Zenn', error: 'network' }]);
  });

  it('treats a GitHub 404 as silence (no matching topic), not a blind spot', () => {
    // GitHub Topics Atom feed returns 404 when no topic matches the slug — same design as Zenn.
    const w = { sources: { github: true }, wiki: null, lastErrors: { 'GitHub': 'http_404' } };
    const { silent, errored } = signalGaps(w, []);
    expect(silent).toEqual(['GitHub']);
    expect(errored).toEqual([]);
  });

  it('still treats a GitHub non-404 failure as a real error', () => {
    const w = { sources: { github: true }, wiki: null, lastErrors: { 'GitHub': 'network' } };
    const { silent, errored } = signalGaps(w, []);
    expect(silent).toEqual([]);
    expect(errored).toEqual([{ label: 'GitHub', error: 'network' }]);
  });

  it('does not extend the 404-as-silence exception to non-topic sources', () => {
    // Only topic-feed sources (Zenn, GitHub) get the 404-as-silence treatment;
    // a 404 from a search-feed source is a genuine failure.
    const w = { sources: { news: true }, wiki: null, lastErrors: { 'Google News': 'http_404' } };
    const { silent, errored } = signalGaps(w, []);
    expect(silent).toEqual([]);
    expect(errored).toEqual([{ label: 'Google News', error: 'http_404' }]);
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
  it('uses a topicFeeds Set to unify Zenn and GitHub 404-as-silence logic', () => {
    expect(html).toContain('const topicFeeds=new Set([WORD_FEEDS.zenn.label,WORD_FEEDS.github.label])');
    expect(html).toContain('topicFeeds.has(label)&&err===\'http_404\'');
  });
  it('records per-source errors on the word during collection', () => {
    // fetchFeed returns a typed error per source; _collectOne records it as errors[label].
    expect(html).toContain("word.lastErrors=Object.keys(errors).length?errors:null");
    expect(html).toContain("return{label,source,error:'network'}");
    expect(html).toContain("return{label,source,error:`http_${res.status}`}");
    expect(html).toContain("return{label,source,error:'parse'}");
    expect(html).toContain("errors[r.label]=r.error");
  });
  it('records Wikipedia failure even when a stale cached extract exists', () => {
    // Old code: `else if(!word.wiki?.extract)errors['Wikipedia']='fetch'` — if cached
    // extract was present, the failure was suppressed and signalGaps showed Wikipedia green.
    // Fixed: always record the failure; signalGaps checks word.wiki separately.
    expect(html).toContain("else errors['Wikipedia']='fetch'");
    expect(html).not.toContain("else if(!word.wiki?.extract)errors['Wikipedia']='fetch'");
  });
  it('renders a distinct fetch-failed line in the WORDS view', () => {
    expect(html).toContain('class="word-err"');
    expect(html).toContain('gaps.errored.length');
  });
});
