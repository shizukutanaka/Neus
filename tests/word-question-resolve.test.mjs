// Neus — Watchword question-resolution tests
// The Socratic arc is aporia -> elenchus -> resolution. Previously a question
// could only be deleted (erasing the proof one once did not know), and the
// "answered, yet open questions remain" prompt could only be silenced by
// deletion. Resolution marks a question done (resolvedAt) while keeping it on
// the record; the prompt now counts only OPEN questions.
// Mirrors openQuestions / socraticPrompts logic in index.html.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// ===== Mirror =====
const openQuestions = (word) => (word.questions || []).filter(q => !q.resolvedAt);

describe('openQuestions', () => {
  it('returns only questions without resolvedAt', () => {
    const word = { questions: [
      { id: 'a', text: 'q1' },
      { id: 'b', text: 'q2', resolvedAt: 123 },
      { id: 'c', text: 'q3', resolvedAt: null },
    ] };
    expect(openQuestions(word).map(q => q.id)).toEqual(['a', 'c']);
  });
  it('handles a missing questions array', () => {
    expect(openQuestions({})).toEqual([]);
  });
  it('treats resolvedAt:0 as resolved-falsey (still open)', () => {
    // resolvedAt is a timestamp; 0 is falsey so the question is open. Acceptable
    // because Date.now() is never 0 in practice.
    expect(openQuestions({ questions: [{ id: 'a', text: 'q', resolvedAt: 0 }] })).toHaveLength(1);
  });
});

// The "questions-remain" prompt must use OPEN questions, not all questions —
// otherwise resolving (vs deleting) could never silence the contradiction.
describe('questions-remain counts only open questions', () => {
  function questionsRemainFires(word) {
    const verdict = word.verdict?.status || 'open';
    return verdict === 'answered' && openQuestions(word).length > 0;
  }
  it('fires when an answered verdict has an unresolved question', () => {
    expect(questionsRemainFires({ verdict: { status: 'answered' }, questions: [{ id: 'a', text: 'q' }] })).toBe(true);
  });
  it('is silenced once every question is resolved (not deleted)', () => {
    expect(questionsRemainFires({ verdict: { status: 'answered' }, questions: [{ id: 'a', text: 'q', resolvedAt: 1 }] })).toBe(false);
  });
});

describe('question-resolution wiring (index.html)', () => {
  it('declares the openQuestions helper', () => {
    expect(html).toContain('const openQuestions=(word)=>(word.questions||[]).filter(q=>!q.resolvedAt)');
  });
  it('socraticPrompts uses openQs for the questions-remain prompt', () => {
    expect(html).toContain('const openQs=openQuestions(word)');
    expect(html).toContain("verdict==='answered'&&openQs.length>0");
  });
  it('renders a resolve toggle next to each question', () => {
    expect(html).toContain('class="word-q-resolve');
    expect(html).toContain('data-wact="resolveq"');
  });
  it('orders open questions before resolved ones', () => {
    expect(html).toContain('[...qsAll.filter(q=>!q.resolvedAt),...qsAll.filter(q=>q.resolvedAt)]');
  });
  it('handles resolveq as a toggle on resolvedAt', () => {
    expect(html).toContain("act==='resolveq'");
    expect(html).toContain('q.resolvedAt=q.resolvedAt?null:Date.now()');
  });
  it('strikes through resolved question text and styles the marker', () => {
    expect(html).toContain('class="word-q-done"');
    expect(html).toContain('.word-q-done{text-decoration:line-through');
    expect(html).toContain('.word-q-resolve.resolved{');
  });
  it('dossier separates open from resolved questions', () => {
    expect(html).toContain('const openQs=qs.filter(q=>!q.resolvedAt),doneQs=qs.filter(q=>q.resolvedAt)');
    expect(html).toContain('解決済み');
  });
  it('resolvedAt rides along in the questions array (import/JSON round-trip)', () => {
    // questions are persisted as-is, so resolvedAt survives wordFromImport/toWordJson
    expect(html).toContain('questions:Array.isArray(w.questions)?w.questions:[]');
    expect(html).toContain('questions:word.questions||[]');
  });
});
