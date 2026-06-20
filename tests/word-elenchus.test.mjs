// Neus — Watchword elenchus tests (the system as Socratic interlocutor)
// Socratic premise challenged: "the inquiry is a monologue — you ask, the
// sources answer." The elenchus is cross-examination: Socrates threw
// questions back to expose contradictions and gaps in the inquirer's own
// position. socraticPrompts examines the inquiry's structure and returns
// probing questions for the user. Mirrors socraticPrompts in index.html.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// ===== Minimal mirrors of the dependencies (kept tiny and deterministic) =====
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
  return TIER_DEFS.filter(d => counts.get(d.key)).map(d => ({ tier: d.key, count: counts.get(d.key) }));
}
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
const newSinceReview = (events, reviewedAt) => events.filter(e => (e.timestamp || 0) > (reviewedAt || 0));
function verdictOf(word) { return word.verdict?.status || 'open'; }
const SETTLED_VERDICTS = new Set(['answered', 'suspended']);
function verdictStale(word, events) {
  if (!SETTLED_VERDICTS.has(verdictOf(word))) return 0;
  const since = word.verdictAt || 0;
  if (!since) return 0;
  return events.filter(e => (e.timestamp || 0) > since).length;
}
function priorBeliefOf(word) { return word.priorBelief || 'curious'; }

// ===== Mirrored from socraticPrompts in index.html =====
function socraticPrompts(word, events) {
  const out = [];
  const n = events.length;
  const tiers = tierBreakdown(events);
  const hasResearch = tiers.some(t => t.tier === 'research');
  const onlyTalk = tiers.length > 0 && tiers.every(t => t.tier === 'discussion' || t.tier === 'other');
  const gaps = signalGaps(word, events);
  const stale = verdictStale(word, events);
  const verdict = verdictOf(word);
  const prior = priorBeliefOf(word);
  const unreviewed = newSinceReview(events, word.reviewedAt).length;
  const qs = (word.questions || []);
  if (verdict === 'answered' && stale > 0) out.push({ key: 'stale' });
  if (n > 0 && !hasResearch && onlyTalk) out.push({ key: 'no-research' });
  if (verdict === 'answered' && qs.length > 0) out.push({ key: 'questions-remain' });
  if (prior === 'certain' && verdict === 'open' && n >= 5) out.push({ key: 'certain-unresolved' });
  if (n > 0 && qs.length === 0 && !word.note) out.push({ key: 'no-questions' });
  if (word.lastCollectedAt && gaps.silent.length > 0) out.push({ key: 'silence' });
  if (unreviewed >= 10) out.push({ key: 'unreviewed' });
  return out.slice(0, 3);
}

const ev = (label, ts = 0) => ({ source: { name: `W · ${label}` }, timestamp: ts });
const keys = (w, e) => socraticPrompts(w, e).map(p => p.key);

describe('socraticPrompts', () => {
  it('returns nothing for a fresh word with no evidence and no state', () => {
    expect(socraticPrompts({}, [])).toEqual([]);
  });

  it('challenges a settled verdict when new evidence has arrived', () => {
    const w = { verdict: { status: 'answered' }, verdictAt: 100, questions: [{ id: 'a' }] };
    expect(keys(w, [ev('Google News', 200)])).toContain('stale');
  });

  it('challenges discussion-only evidence as opinion, not fact', () => {
    const w = {};
    expect(keys(w, [ev('Reddit'), ev('Hacker News')])).toContain('no-research');
  });

  it('does NOT raise no-research when arXiv (primary) is present', () => {
    const w = {};
    expect(keys(w, [ev('Reddit'), ev('arXiv')])).not.toContain('no-research');
  });

  it('flags answered verdicts that still carry open questions', () => {
    const w = { verdict: { status: 'answered' }, questions: [{ id: 'q1' }] };
    expect(keys(w, [ev('Google News')])).toContain('questions-remain');
  });

  it('confronts a "certain" prior that never reached a verdict', () => {
    const w = { priorBelief: 'certain' };
    const five = [ev('Google News'), ev('Google News'), ev('Google News'), ev('arXiv'), ev('arXiv')];
    expect(keys(w, five)).toContain('certain-unresolved');
  });

  it('prods when evidence exists but no questions were ever posed', () => {
    expect(keys({}, [ev('arXiv')])).toContain('no-questions');
  });

  it('surfaces source silence after a collection has run', () => {
    const w = { lastCollectedAt: 1, sources: { news: true, arxiv: true } };
    expect(keys(w, [ev('Google News')])).toContain('silence'); // arXiv silent
  });

  it('warns about a large backlog of unreviewed items', () => {
    const w = { reviewedAt: 0, questions: [{ id: 'x' }] };
    const many = Array.from({ length: 12 }, () => ev('arXiv', 5));
    expect(keys(w, many)).toContain('unreviewed');
  });

  it('caps the number of prompts at three', () => {
    // construct a word that trips many rules at once
    const w = { verdict: { status: 'answered' }, verdictAt: 1, questions: [{ id: 'q' }], lastCollectedAt: 1, sources: { news: true, arxiv: true }, reviewedAt: 0 };
    const many = Array.from({ length: 12 }, () => ev('Reddit', 5));
    expect(socraticPrompts(w, many).length).toBeLessThanOrEqual(3);
  });
});

describe('elenchus wiring (index.html)', () => {
  it('declares socraticPrompts', () => {
    expect(html).toContain('function socraticPrompts');
  });
  it('renders the elenchus block in the WORDS view', () => {
    expect(html).toContain('class="word-elenchus"');
    expect(html).toContain('socraticPrompts(w,items)');
  });
  it('includes the 問答 section in the dossier', () => {
    expect(html).toContain('## 問答');
    expect(html).toContain('socraticPrompts(word,events)');
  });
  it('localizes the elenchus label', () => {
    expect(html).toContain("'word.elenchus'");
    expect(html).toContain('Elenchus (questions for you)');
  });
});
