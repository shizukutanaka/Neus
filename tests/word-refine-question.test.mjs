// Neus — Watchword question-refinement tests (the question is provisional)
// Socratic premise challenged: "the question is fixed once asked." Dialogues
// repeatedly reveal the original question was confused and must be reformulated;
// refining it is progress. refineQuestion edits the note and preserves prior
// formulations as a trail. Mirrors refineQuestion in index.html.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// ===== Mirrored from refineQuestion in index.html =====
function refineQuestion(word, newText) {
  const text = (newText || '').trim();
  const cur = (word.note || '').trim();
  if (!text || text === cur) return null; // no change
  const history = [...(word.questionHistory || [])];
  if (cur) history.push({ text: cur, at: Date.now() });
  return { note: text, questionHistory: history.slice(-5) };
}

describe('refineQuestion', () => {
  it('returns null when the text is unchanged', () => {
    expect(refineQuestion({ note: 'Is it ready?' }, 'Is it ready?')).toBeNull();
    expect(refineQuestion({ note: 'Is it ready?' }, '  Is it ready?  ')).toBeNull();
  });

  it('returns null for empty input (cannot erase the question to nothing)', () => {
    expect(refineQuestion({ note: 'Is it ready?' }, '')).toBeNull();
    expect(refineQuestion({ note: 'Is it ready?' }, '   ')).toBeNull();
  });

  it('sets the new question and pushes the old one into history', () => {
    const patch = refineQuestion({ note: 'Is it ready?' }, 'Is it production-ready at scale?');
    expect(patch.note).toBe('Is it production-ready at scale?');
    expect(patch.questionHistory).toHaveLength(1);
    expect(patch.questionHistory[0].text).toBe('Is it ready?');
  });

  it('sets the question from empty without adding a history entry', () => {
    const patch = refineQuestion({ note: '' }, 'What is it?');
    expect(patch.note).toBe('What is it?');
    expect(patch.questionHistory).toEqual([]);
  });

  it('accumulates a trail across successive refinements', () => {
    let word = { note: 'q1', questionHistory: [] };
    word = { ...word, ...refineQuestion(word, 'q2') };
    word = { ...word, ...refineQuestion(word, 'q3') };
    expect(word.note).toBe('q3');
    expect(word.questionHistory.map(h => h.text)).toEqual(['q1', 'q2']);
  });

  it('caps history at the five most recent formulations', () => {
    let word = { note: 'q0', questionHistory: [] };
    for (let i = 1; i <= 8; i++) word = { ...word, ...refineQuestion(word, 'q' + i) };
    expect(word.questionHistory).toHaveLength(5);
    // oldest dropped, newest retained
    expect(word.questionHistory[0].text).toBe('q3');
    expect(word.questionHistory.at(-1).text).toBe('q7');
    expect(word.note).toBe('q8');
  });

  it('trims surrounding whitespace on the new formulation', () => {
    const patch = refineQuestion({ note: 'a' }, '  b  ');
    expect(patch.note).toBe('b');
  });
});

describe('question-refinement wiring (index.html)', () => {
  it('declares refineQuestion', () => {
    expect(html).toContain('function refineQuestion');
  });
  it('renders an editable note with a refine affordance and hidden input', () => {
    expect(html).toContain('data-wact="refineq"');
    expect(html).toContain('data-wact="saveq"');
    expect(html).toContain('data-rqinput=');
    expect(html).toContain('class="word-refine"');
  });
  it('shows a revision badge when the question has history', () => {
    expect(html).toContain('class="word-revised"');
  });
  it('persists questionHistory on the word object', () => {
    expect(html).toContain('questionHistory:[]');
  });
  it('submits the refine input on Enter', () => {
    expect(html).toContain("e.target.closest('input[data-rqinput]')");
    expect(html).toContain('button[data-wact="saveq"]');
  });
  it('includes the 問いの変遷 section and frontmatter in the dossier', () => {
    expect(html).toContain('## 問いの変遷');
    expect(html).toContain('question_revisions:');
  });
});
