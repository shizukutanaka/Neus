// Neus — Watchword overview tests (the inquiry at a glance)
// With verdicts, re-examination flags, pending elenchus prompts, and unreviewed
// backlogs accumulating per word, the WORDS view needs a top-level summary.
// wordsOverview is a pure aggregator. Mirrors wordsOverview in index.html.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// ===== Mirrored dependencies (trimmed to what the aggregator needs) =====
function verdictOf(word) { return word.verdict?.status || 'open'; }
const SETTLED_VERDICTS = new Set(['answered', 'suspended']);
function verdictStale(word, events) {
  if (!SETTLED_VERDICTS.has(verdictOf(word))) return 0;
  const since = word.verdictAt || 0;
  if (!since) return 0;
  return events.filter(e => (e.timestamp || 0) > since).length;
}
const newSinceReview = (events, reviewedAt) => events.filter(e => (e.timestamp || 0) > (reviewedAt || 0));
// socraticPrompts is complex; for overview tests we only need "has any prompt".
// Replicate the single rule that's easy to trigger deterministically: evidence
// present but no questions posed -> at least one prompt.
function socraticPrompts(word, events) {
  return (events.length > 0 && (word.questions || []).length === 0) ? [{ key: 'no-questions' }] : [];
}

// ===== Mirrored from wordsOverview in index.html =====
function wordsOverview(words, all) {
  const o = { total: words.length, answered: 0, open: 0, reexamine: 0, unreviewed: 0, prompts: 0, uncollected: 0 };
  for (const w of words) {
    const v = verdictOf(w);
    if (v === 'answered') o.answered++;
    if (v === 'open') o.open++;
    const tag = 'word:' + w.normalized;
    const items = all.filter(e => (e.meta.autoTags || []).includes(tag) && !e.state.archived);
    if (verdictStale(w, items) > 0) o.reexamine++;
    o.unreviewed += newSinceReview(items, w.reviewedAt).length;
    if (socraticPrompts(w, items).length > 0) o.prompts++;
    if (!w.lastCollectedAt) o.uncollected++;
  }
  return o;
}

const item = (norm, ts = 0, archived = false) => ({ meta: { autoTags: ['word:' + norm] }, state: { archived }, timestamp: ts });

describe('wordsOverview', () => {
  it('returns a zeroed summary for no words', () => {
    expect(wordsOverview([], [])).toEqual({ total: 0, answered: 0, open: 0, reexamine: 0, unreviewed: 0, prompts: 0, uncollected: 0 });
  });

  it('counts verdict distribution (answered / open)', () => {
    const words = [
      { normalized: 'a', verdict: { status: 'answered' }, lastCollectedAt: 1, questions: [{}] },
      { normalized: 'b', verdict: { status: 'open' }, lastCollectedAt: 1, questions: [{}] },
      { normalized: 'c', verdict: { status: 'converging' }, lastCollectedAt: 1, questions: [{}] },
    ];
    const ov = wordsOverview(words, []);
    expect(ov.total).toBe(3);
    expect(ov.answered).toBe(1);
    expect(ov.open).toBe(1);
  });

  it('flags words whose settled verdict has new evidence', () => {
    const words = [{ normalized: 'a', verdict: { status: 'answered' }, verdictAt: 100, lastCollectedAt: 1, questions: [{}] }];
    const all = [item('a', 200)];
    expect(wordsOverview(words, all).reexamine).toBe(1);
  });

  it('sums unreviewed items across words', () => {
    const words = [
      { normalized: 'a', reviewedAt: 0, lastCollectedAt: 1, questions: [{}] },
      { normalized: 'b', reviewedAt: 50, lastCollectedAt: 1, questions: [{}] },
    ];
    const all = [item('a', 10), item('a', 20), item('b', 10), item('b', 100)];
    // a: both after 0 -> 2; b: only ts100 after 50 -> 1
    expect(wordsOverview(words, all).unreviewed).toBe(3);
  });

  it('counts words that have at least one pending prompt', () => {
    const words = [
      { normalized: 'a', lastCollectedAt: 1, questions: [] }, // has item + no questions -> prompt
      { normalized: 'b', lastCollectedAt: 1, questions: [{}] }, // has questions -> no prompt (by our rule)
    ];
    const all = [item('a', 1), item('b', 1)];
    expect(wordsOverview(words, all).prompts).toBe(1);
  });

  it('counts words never collected', () => {
    const words = [
      { normalized: 'a', lastCollectedAt: null, questions: [{}] },
      { normalized: 'b', lastCollectedAt: 5, questions: [{}] },
    ];
    expect(wordsOverview(words, []).uncollected).toBe(1);
  });

  it('ignores archived items when counting', () => {
    const words = [{ normalized: 'a', reviewedAt: 0, lastCollectedAt: 1, questions: [{}] }];
    const all = [item('a', 10), item('a', 20, true)];
    expect(wordsOverview(words, all).unreviewed).toBe(1);
  });
});

describe('overview wiring (index.html)', () => {
  it('declares wordsOverview', () => {
    expect(html).toContain('function wordsOverview');
  });
  it('renders an overview strip in the WORDS view', () => {
    expect(html).toContain('class="word-overview"');
    expect(html).toContain('wordsOverview(sorted,all)');
    expect(html).toContain('return suggestHtml+header+overview+sections.join');
  });
  it('highlights re-examination as an alert chip', () => {
    expect(html).toContain('word-ov-chip ov-alert');
  });
});
