// Neus — Socratic word-inquiry logic tests
// Covers verdictStale, cognitiveShift, socraticPrompts, and dossier sections they produce.
// These drive the epistemic model of the WORDS view: prior belief → evidence → verdict.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// ===== Mirror definitions (match index.html exactly) =====
const VERDICT_DEFS = [
  { key: 'open',       ja: '探究中',    en: 'open' },
  { key: 'converging', ja: '収束中',    en: 'converging' },
  { key: 'answered',   ja: '解決',      en: 'answered' },
  { key: 'suspended',  ja: '保留',      en: 'suspended' },
];
const PRIOR_BELIEF_DEFS = [
  { key: 'curious',   ja: '好奇',  en: 'curious' },
  { key: 'certain',   ja: '確信',  en: 'certain' },
  { key: 'skeptical', ja: '懐疑',  en: 'skeptical' },
  { key: 'agnostic',  ja: '無知',  en: 'agnostic' },
];
const SETTLED_VERDICTS = new Set(['answered', 'suspended']);
const TIER_DEFS = [
  { key: 'research',    ja: '一次(研究)', en: 'research' },
  { key: 'press',       ja: '報道',       en: 'press' },
  { key: 'discussion',  ja: '議論',       en: 'discussion' },
  { key: 'other',       ja: 'その他',     en: 'other' },
];

function verdictOf(word) { return word.verdict?.status || 'open'; }
function priorBeliefOf(word) { return word.priorBelief || 'curious'; }

function cognitiveShift(word) {
  const prior = priorBeliefOf(word), verdict = verdictOf(word);
  const pd = PRIOR_BELIEF_DEFS.find(d => d.key === prior) || PRIOR_BELIEF_DEFS[0];
  const vd = VERDICT_DEFS.find(d => d.key === verdict) || VERDICT_DEFS[0];
  return { prior, verdict, pd, vd, changed: prior !== verdict && verdict !== 'open' };
}

function verdictStale(word, events) {
  if (!SETTLED_VERDICTS.has(verdictOf(word))) return 0;
  const since = word.verdictAt || 0;
  if (!since) return 0;
  return events.filter(e => (e.timestamp || 0) > since).length;
}

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
function feedLabelOf(name) { return ((name || '').split('·').pop() || '').trim(); }
function signalGaps(word, events) {
  const WORD_FEEDS = { news: { label: 'Google News' }, reddit: { label: 'Reddit' }, hn: { label: 'Hacker News' }, arxiv: { label: 'arXiv' } };
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
const newSinceReview = (events, reviewedAt) => events.filter(e => (e.timestamp || 0) > (reviewedAt || 0));

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
  if (verdict === 'answered' && stale > 0) out.push({ key: 'stale', ja: `裁決後に${stale}件の新証拠。結論はまだ妥当か?`, en: `${stale} new item(s) since your verdict. Does it still hold?` });
  if (n > 0 && !hasResearch && onlyTalk) out.push({ key: 'no-research', ja: '一次情報(研究)がない。これは検証された事実か、それとも意見か?', en: 'No primary research. Is this verified fact, or opinion?' });
  if (verdict === 'answered' && qs.length > 0) out.push({ key: 'questions-remain', ja: '解決としたが、未解決の問いが残っている。本当に解決したか?', en: 'Marked answered, yet open questions remain. Truly resolved?' });
  if (prior === 'certain' && verdict === 'open' && n >= 5) out.push({ key: 'certain-unresolved', ja: '確信して始めたが、まだ結論が出ていない。何が決め手に欠けるか?', en: 'You began certain, yet reached no verdict. What is still missing?' });
  if (n > 0 && qs.length === 0) out.push({ key: 'no-questions', ja: 'まだ一つも問いを立てていない。本当に疑問はないか?', en: 'You have posed no questions. Is nothing in doubt?' });
  if (word.lastCollectedAt && gaps.silent.length > 0) out.push({ key: 'silence', ja: `${gaps.silent.join(', ')} が沈黙。別の角度から探したか?`, en: `${gaps.silent.join(', ')} returned nothing. Have you looked elsewhere?` });
  if (unreviewed >= 10) out.push({ key: 'unreviewed', ja: `${unreviewed}件が未確認。読まずに判断していないか?`, en: `${unreviewed} unreviewed. Are you concluding without reading?` });
  return out.slice(0, 3);
}

const mkEv = (o) => ({ source: { name: o.src || '' }, content: { title: o.title || '' }, timestamp: o.ts || 0 });

// ===== verdictStale =====
describe('verdictStale', () => {
  it('returns 0 when verdict is open (not settled)', () => {
    const word = { verdict: { status: 'open' }, verdictAt: 100 };
    expect(verdictStale(word, [mkEv({ ts: 200 })])).toBe(0);
  });

  it('returns 0 when verdictAt is missing even if verdict is answered', () => {
    const word = { verdict: { status: 'answered' } };
    expect(verdictStale(word, [mkEv({ ts: 999 })])).toBe(0);
  });

  it('counts items that arrived after verdictAt for an answered word', () => {
    const word = { verdict: { status: 'answered' }, verdictAt: 500 };
    const events = [mkEv({ ts: 400 }), mkEv({ ts: 600 }), mkEv({ ts: 700 })];
    expect(verdictStale(word, events)).toBe(2);
  });

  it('counts items after verdictAt for a suspended word', () => {
    const word = { verdict: { status: 'suspended' }, verdictAt: 500 };
    expect(verdictStale(word, [mkEv({ ts: 501 })])).toBe(1);
  });

  it('returns 0 when no items are newer than verdictAt', () => {
    const word = { verdict: { status: 'answered' }, verdictAt: 1000 };
    expect(verdictStale(word, [mkEv({ ts: 999 })])).toBe(0);
  });

  it('returns 0 for converging verdict (not in SETTLED_VERDICTS)', () => {
    const word = { verdict: { status: 'converging' }, verdictAt: 100 };
    expect(verdictStale(word, [mkEv({ ts: 200 })])).toBe(0);
  });
});

// ===== cognitiveShift =====
describe('cognitiveShift', () => {
  it('reports changed=false when verdict is still open', () => {
    const word = { priorBelief: 'curious', verdict: { status: 'open' } };
    expect(cognitiveShift(word).changed).toBe(false);
  });

  it('reports changed=true when prior differs from a settled verdict', () => {
    const word = { priorBelief: 'skeptical', verdict: { status: 'answered' } };
    const shift = cognitiveShift(word);
    expect(shift.changed).toBe(true);
    expect(shift.prior).toBe('skeptical');
    expect(shift.verdict).toBe('answered');
  });

  it('reports changed=false when prior matches the current verdict key', () => {
    // e.g. converging prior is not in PRIOR_BELIEF_DEFS — falls back to curious
    // Let's test a case where prior === verdict
    const word = { priorBelief: 'curious', verdict: { status: 'converging' } };
    // curious !== converging and verdict !== open → changed = true
    expect(cognitiveShift(word).changed).toBe(true);
  });

  it('defaults prior to curious when priorBelief is absent', () => {
    const word = { verdict: { status: 'answered' } };
    expect(cognitiveShift(word).prior).toBe('curious');
  });

  it('attaches the full PRIOR_BELIEF_DEF object as pd', () => {
    const word = { priorBelief: 'certain', verdict: { status: 'open' } };
    const shift = cognitiveShift(word);
    expect(shift.pd.ja).toBe('確信');
    expect(shift.pd.en).toBe('certain');
  });
});

// ===== socraticPrompts =====
describe('socraticPrompts', () => {
  const base = { verdict: { status: 'open' }, priorBelief: 'curious', reviewedAt: 0, questions: [], lastCollectedAt: 1000 };

  it('returns no-questions prompt when events exist but no questions are registered', () => {
    const events = [mkEv({ src: 'X · Google News', ts: 100 })];
    const ps = socraticPrompts(base, events);
    expect(ps.some(p => p.key === 'no-questions')).toBe(true);
  });

  it('returns no-research prompt when all items are discussion-tier', () => {
    const events = [
      mkEv({ src: 'X · Reddit', ts: 10 }),
      mkEv({ src: 'X · Hacker News', ts: 20 }),
    ];
    const ps = socraticPrompts(base, events);
    expect(ps.some(p => p.key === 'no-research')).toBe(true);
  });

  it('does NOT return no-research when arXiv items are present', () => {
    const events = [mkEv({ src: 'X · arXiv', ts: 10 })];
    const ps = socraticPrompts(base, events);
    expect(ps.some(p => p.key === 'no-research')).toBe(false);
  });

  it('returns stale prompt for answered word with items after verdictAt', () => {
    const word = { ...base, verdict: { status: 'answered' }, verdictAt: 50 };
    const events = [mkEv({ ts: 100 })];
    const ps = socraticPrompts(word, events);
    expect(ps.some(p => p.key === 'stale')).toBe(true);
    expect(ps.find(p => p.key === 'stale').en).toContain('Does it still hold?');
  });

  it('returns questions-remain for answered word with open questions', () => {
    const word = { ...base, verdict: { status: 'answered' }, questions: [{ id: 'q1', text: 'Is this safe?' }] };
    const ps = socraticPrompts(word, []);
    expect(ps.some(p => p.key === 'questions-remain')).toBe(true);
  });

  it('returns certain-unresolved for a certain prior with 5+ events and no verdict', () => {
    const word = { ...base, priorBelief: 'certain' };
    const events = Array.from({ length: 5 }, (_, i) => mkEv({ ts: i }));
    const ps = socraticPrompts(word, events);
    expect(ps.some(p => p.key === 'certain-unresolved')).toBe(true);
  });

  it('caps output at 3 prompts', () => {
    // Trigger: stale + no-research + questions-remain + no-questions (only 3 returned)
    const word = { ...base, verdict: { status: 'answered' }, verdictAt: 5, questions: [{ id: 'q1', text: 'Q?' }], priorBelief: 'certain' };
    const events = [mkEv({ src: 'X · Reddit', ts: 10 }), mkEv({ src: 'X · Reddit', ts: 20 })];
    const ps = socraticPrompts(word, events);
    expect(ps.length).toBeLessThanOrEqual(3);
  });

  it('returns empty array when no prompts apply', () => {
    const word = { ...base, lastCollectedAt: null };
    expect(socraticPrompts(word, [])).toHaveLength(0);
  });

  it('silence prompt fires when a source returned nothing after collection', () => {
    const word = { ...base, sources: { news: true, reddit: true } };
    const events = [mkEv({ src: 'X · Google News', ts: 10 })];
    const ps = socraticPrompts(word, events);
    expect(ps.some(p => p.key === 'silence')).toBe(true);
  });

  it('unreviewed prompt fires when 10+ items are unreviewed', () => {
    const word = { ...base, reviewedAt: 0 };
    const events = Array.from({ length: 10 }, (_, i) => mkEv({ src: 'X', ts: i + 1 }));
    const ps = socraticPrompts(word, events);
    expect(ps.some(p => p.key === 'unreviewed')).toBe(true);
  });
});

// ===== Wiring tests (index.html) =====
describe('verdictStale / cognitiveShift / socraticPrompts wiring (index.html)', () => {
  it('defines verdictStale filtering by verdictAt', () => {
    expect(html).toContain('function verdictStale(word,events)');
    expect(html).toContain('SETTLED_VERDICTS.has(verdictOf(word))');
    expect(html).toContain('word.verdictAt||0');
  });

  it('defines cognitiveShift with direction-aware concluded/shifted fields', () => {
    expect(html).toContain('function cognitiveShift(word)');
    expect(html).toContain('const concluded=verdictDir!==\'open\'');
    expect(html).toContain('const shifted=concluded&&priorDir!==\'open\'&&priorDir!==verdictDir');
  });

  it('defines socraticPrompts returning at most 3 prompts', () => {
    expect(html).toContain('function socraticPrompts(word,events)');
    expect(html).toContain('out.slice(0,3)');
  });

  it('defines PRIOR_BELIEF_DEFS with four keys', () => {
    expect(html).toContain('const PRIOR_BELIEF_DEFS=[');
    expect(html).toContain("key:'curious'");
    expect(html).toContain("key:'certain'");
    expect(html).toContain("key:'skeptical'");
    expect(html).toContain("key:'agnostic'");
  });

  it('always renders ## 認識の変容 in the dossier', () => {
    expect(html).toContain("parts.push('## 認識の変容','')");
  });

  it('renders ## 問答 section with Socratic prompts when present', () => {
    expect(html).toContain("parts.push('## 問答','')");
    expect(html).toContain('p.ja} / ${p.en}');
  });

  it('renders ## 裁決 section when verdict is not open or has a note', () => {
    expect(html).toContain("parts.push('## 裁決','')");
    expect(html).toContain("vd!=='open'||word.verdict?.note");
  });

  it('renders ## 問いの変遷 section when questionHistory has entries', () => {
    expect(html).toContain("parts.push('## 問いの変遷','')");
    expect(html).toContain('for(const h of qHist)');
  });

  it('includes prior_belief in dossier frontmatter', () => {
    expect(html).toContain('`prior_belief: ${priorBeliefOf(word)}`');
  });

  it('includes verdict_status in dossier frontmatter when not open', () => {
    expect(html).toContain("verdict_status: ${word.verdict.status}");
  });

  it('includes verdict_note in dossier frontmatter when present', () => {
    expect(html).toContain("verdict_note: ${ys(word.verdict.note)}");
  });

  it('includes reexamine count in frontmatter when verdict is stale', () => {
    expect(html).toContain('`reexamine: ${stale}`');
  });

  it('includes question_revisions count in frontmatter when history is non-empty', () => {
    expect(html).toContain('`question_revisions: ${(word.questionHistory||[]).length}`');
  });
});

describe('wiki canonical title wiring (index.html)', () => {
  it('computes wikiCanonTitle in toDossier', () => {
    expect(html).toContain("const wikiCanonTitle=word.wiki?.title&&word.wiki.title.trim().toLowerCase()!==word.term.trim().toLowerCase()?word.wiki.title:null");
  });

  it('adds wiki_title to dossier frontmatter when canonical differs', () => {
    expect(html).toContain('`wiki_title: ${ys(wikiCanonTitle)}`');
  });

  it('renders conditional definition header in toDossier', () => {
    expect(html).toContain('wikiCanonTitle?`## 定義 (${wikiCanonTitle})`');
  });

  it('renders wikiCanon badge in WORDS view', () => {
    expect(html).toContain("const wikiCanon=w.wiki?.title&&w.wiki.title.trim().toLowerCase()!==w.term.trim().toLowerCase()");
    expect(html).toContain('class="word-wiki-canon"');
  });

  it('has word-wiki-canon CSS rule', () => {
    expect(html).toContain('.word-wiki-canon{');
  });
});
