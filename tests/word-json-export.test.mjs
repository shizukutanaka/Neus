// Neus — Watchword JSON-export completeness tests
// The Markdown dossier carries the full inquiry, but the JSON export used to
// drop note / priorBelief / verdict / questions / questionHistory / sources /
// timestamps — so a JSON export silently lost inquiry state. toWordJson is the
// complete, self-describing structured record. Mirrors toWordJson in index.html.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// ===== Minimal mirrors of analysis dependencies (kept trivial/deterministic) =====
function verdictOf(word) { return word.verdict?.status || 'open'; }
function priorBeliefOf(word) { return word.priorBelief || 'curious'; }
const PRIOR_DIRECTION = { certain: 'affirm', skeptical: 'deny', curious: 'open', agnostic: 'open' };
const VERDICT_DIRECTION = { answered: 'affirm', converging: 'affirm', suspended: 'deny', open: 'open' };
const SETTLED_VERDICTS = new Set(['answered', 'suspended']);
function cognitiveShift(word) {
  const prior = priorBeliefOf(word), verdict = verdictOf(word);
  const priorDir = PRIOR_DIRECTION[prior] || 'open';
  const verdictDir = VERDICT_DIRECTION[verdict] || 'open';
  const concluded = SETTLED_VERDICTS.has(verdict);
  const shifted = priorDir !== 'open' && verdictDir !== 'open' && priorDir !== verdictDir;
  return { prior, verdict, concluded, shifted };
}
const stub = { tierBreakdown: () => [], signalGaps: () => ({ active: [], silent: [] }), relatedWords: () => [], verdictStale: () => 0, socraticPrompts: () => [], newSinceReview: () => [] };

// ===== Mirrored from toWordJson in index.html =====
function toWordJson(word, events, others = []) {
  const shift = cognitiveShift(word);
  return {
    app: 'neus', kind: 'word-dossier', schema: 2, exportedAt: new Date().toISOString(),
    word: {
      term: word.term, normalized: word.normalized, lang: word.lang || 'en',
      note: word.note || '', questionHistory: word.questionHistory || [],
      priorBelief: priorBeliefOf(word),
      verdict: { status: verdictOf(word), note: word.verdict?.note || '' }, verdictAt: word.verdictAt || null,
      questions: word.questions || [],
      sources: word.sources || {}, enabled: word.enabled !== false,
      createdAt: word.createdAt || null, reviewedAt: word.reviewedAt || null,
      lastCollectedAt: word.lastCollectedAt || null, lastFetched: word.lastFetched || 0,
      wiki: word.wiki || null,
    },
    analysis: {
      tiers: stub.tierBreakdown(), gaps: stub.signalGaps(), related: stub.relatedWords(),
      cognitiveShift: { prior: shift.prior, verdict: shift.verdict, concluded: shift.concluded, shifted: shift.shifted },
      reexamine: stub.verdictStale(), prompts: stub.socraticPrompts().map(p => p.key),
      unreviewed: stub.newSinceReview().length,
    },
    items: events,
  };
}

const fullWord = {
  term: 'WebGPU', normalized: 'webgpu', lang: 'en',
  note: 'Is it production-ready?', questionHistory: [{ text: 'Is it ready?', at: 1 }],
  priorBelief: 'skeptical',
  verdict: { status: 'converging', note: 'leaning yes' }, verdictAt: 1234,
  questions: [{ id: 'q1', text: 'Driver support?', createdAt: 2 }],
  sources: { wikipedia: true, news: true }, enabled: true,
  createdAt: 10, reviewedAt: 20, lastCollectedAt: 30, lastFetched: 7,
  wiki: { title: 'WebGPU', extract: 'A web GPU API' },
};

describe('toWordJson — completeness', () => {
  const out = toWordJson(fullWord, [{ id: 'e1' }]);

  it('preserves the inquiry fields that the old export dropped', () => {
    expect(out.word.note).toBe('Is it production-ready?');
    expect(out.word.priorBelief).toBe('skeptical');
    expect(out.word.verdict).toEqual({ status: 'converging', note: 'leaning yes' });
    expect(out.word.verdictAt).toBe(1234);
    expect(out.word.questions).toHaveLength(1);
    expect(out.word.questionHistory).toHaveLength(1);
    expect(out.word.sources).toEqual({ wikipedia: true, news: true });
  });

  it('preserves lifecycle timestamps and counters', () => {
    expect(out.word.createdAt).toBe(10);
    expect(out.word.reviewedAt).toBe(20);
    expect(out.word.lastCollectedAt).toBe(30);
    expect(out.word.lastFetched).toBe(7);
  });

  it('carries identity, wiki, and the collected items', () => {
    expect(out.word.term).toBe('WebGPU');
    expect(out.word.normalized).toBe('webgpu');
    expect(out.word.wiki.title).toBe('WebGPU');
    expect(out.items).toEqual([{ id: 'e1' }]);
  });

  it('includes a derived analysis block and a schema version', () => {
    expect(out.schema).toBe(2);
    expect(out.analysis).toBeTruthy();
    // skeptical(deny) → converging(affirm): a reversal underway, but converging is in-progress
    // (not terminal), so concluded=false while shifted=true.
    expect(out.analysis.cognitiveShift).toEqual({ prior: 'skeptical', verdict: 'converging', concluded: false, shifted: true });
  });

  it('fills safe defaults for a bare word', () => {
    const bare = toWordJson({ term: 'x', normalized: 'x' }, []);
    expect(bare.word.note).toBe('');
    expect(bare.word.priorBelief).toBe('curious');
    expect(bare.word.verdict).toEqual({ status: 'open', note: '' });
    expect(bare.word.questions).toEqual([]);
    expect(bare.word.questionHistory).toEqual([]);
    expect(bare.word.lastFetched).toBe(0);
    expect(bare.word.enabled).toBe(true);
  });

  it('marks a disabled word as not enabled', () => {
    expect(toWordJson({ term: 'x', normalized: 'x', enabled: false }, []).word.enabled).toBe(false);
  });
});

describe('JSON-export wiring (index.html)', () => {
  it('declares toWordJson and routes downloadJson through it', () => {
    expect(html).toContain('toWordJson(word,events,others)');
    expect(html).toContain('this.toWordJson(word,events,others)');
  });
  it('bumps the export schema and includes an analysis block', () => {
    expect(html).toContain('schema:2');
    expect(html).toContain('analysis:{');
  });
  it('exports the previously-dropped inquiry fields', () => {
    expect(html).toContain('priorBelief:priorBeliefOf(word)');
    expect(html).toContain('questionHistory:word.questionHistory||[]');
    expect(html).toContain('verdict:{status:verdictOf(word)');
  });
});
