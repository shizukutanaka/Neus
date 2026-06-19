// Neus — Watchword verdict-history (dialectic) tests
// The Socratic method is the recorded trace of how a conclusion changed under
// refutation. The verdict pill cycles status, but each transition was being
// overwritten — discarding the very thing inquiry exists to record.
// verdictTransition (mirror of refineQuestion) appends each departing verdict
// to verdictHistory so the dialectic is preserved, exported, and reversible.
// Mirrors verdictTransition / VERDICT_DEFS in index.html.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// ===== Mirror =====
const VERDICT_DEFS = [
  { key: 'open', ja: '探究中', en: 'open' },
  { key: 'converging', ja: '収束中', en: 'converging' },
  { key: 'answered', ja: '解決', en: 'answered' },
  { key: 'suspended', ja: '保留', en: 'suspended' },
];
function verdictOf(word) { return word.verdict?.status || 'open'; }
function verdictTransition(word, newStatus) {
  const cur = verdictOf(word);
  if (newStatus === cur) return null;
  const history = [...(word.verdictHistory || [])];
  history.push({ status: cur, note: word.verdict?.note || '', at: word.verdictAt || null });
  return { verdict: { status: newStatus, note: word.verdict?.note || '' }, verdictAt: Date.now(), verdictHistory: history.slice(-8) };
}

describe('verdictTransition — dialectic recording', () => {
  it('returns null when the status is unchanged', () => {
    expect(verdictTransition({ verdict: { status: 'open' } }, 'open')).toBeNull();
    expect(verdictTransition({}, 'open')).toBeNull(); // default verdict is open
  });

  it('records the departing verdict (status, note, at) into history', () => {
    const word = { verdict: { status: 'open', note: 'leaning yes' }, verdictAt: 1000, verdictHistory: [] };
    const p = verdictTransition(word, 'converging');
    expect(p.verdict.status).toBe('converging');
    expect(p.verdictHistory).toEqual([{ status: 'open', note: 'leaning yes', at: 1000 }]);
  });

  it('carries the current note forward to the new verdict', () => {
    const word = { verdict: { status: 'converging', note: 'because X' }, verdictAt: 2000 };
    const p = verdictTransition(word, 'answered');
    expect(p.verdict.note).toBe('because X');
  });

  it('accumulates a full chain across multiple transitions', () => {
    let word = { verdict: { status: 'open', note: '' }, verdictAt: 1, verdictHistory: [] };
    for (const next of ['converging', 'answered']) {
      const p = verdictTransition(word, next);
      word = { ...word, ...p };
    }
    expect(word.verdict.status).toBe('answered');
    expect(word.verdictHistory.map(h => h.status)).toEqual(['open', 'converging']);
  });

  it('caps history at the most recent 8 entries', () => {
    const long = Array.from({ length: 8 }, (_, i) => ({ status: 'open', note: String(i), at: i }));
    const word = { verdict: { status: 'answered', note: 'n' }, verdictAt: 99, verdictHistory: long };
    const p = verdictTransition(word, 'open');
    expect(p.verdictHistory).toHaveLength(8);
    // oldest (status '0') dropped, newest appended is the departing 'answered'
    expect(p.verdictHistory[0].note).toBe('1');
    expect(p.verdictHistory[7].status).toBe('answered');
  });

  it('defaults a missing verdict to open when recording', () => {
    const p = verdictTransition({ verdictHistory: [] }, 'converging');
    expect(p.verdictHistory).toEqual([{ status: 'open', note: '', at: null }]);
  });
});

describe('verdict-history wiring (index.html)', () => {
  it('declares the verdictTransition pure helper', () => {
    expect(html).toContain('function verdictTransition(word,newStatus)');
    expect(html).toContain('history.slice(-8)');
  });
  it('setverd uses verdictTransition to cycle the verdict', () => {
    expect(html).toContain("act==='setverd'");
    expect(html).toContain('verdictTransition(word,nextVerdict(verdictOf(word)))');
  });
  it('reexamine uses verdictTransition and captures a lossless prior snapshot', () => {
    expect(html).toContain('const prevVerdict={...word.verdict},prevAt=word.verdictAt||null,prevHistory=[...(word.verdictHistory||[])]');
    expect(html).toContain("verdictTransition(word,'open')");
  });
  it('renders a verdict trail in the WORDS card', () => {
    expect(html).toContain('class="word-vtrail"');
    expect(html).toContain('word-vtrail-arrow');
  });
  it('defines CSS for the verdict trail', () => {
    expect(html).toContain('.word-vtrail{');
  });
  it('wordFromImport preserves verdictHistory', () => {
    expect(html).toContain('verdictHistory:Array.isArray(w.verdictHistory)?w.verdictHistory:[]');
  });
  it('toWordJson exports verdictHistory for lossless round-trip', () => {
    expect(html).toContain('verdictHistory:word.verdictHistory||[]');
  });
  it('toDossier renders a 裁決の変遷 section and verdict_revisions frontmatter', () => {
    expect(html).toContain('## 裁決の変遷');
    expect(html).toContain('verdict_revisions: ${(word.verdictHistory||[]).length}');
  });
  it('new words are created with an empty verdictHistory', () => {
    expect(html).toContain('verdictHistory:[],falsifier:\'\',questions:[],questionHistory:[]');
  });
});
