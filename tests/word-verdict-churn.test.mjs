// Neus — Verdict churn detection (Socratic feature)
//
// Found via a Socratic self-examination of the product's own feature set: verdictHistory
// records every verdict transition (the dialectic trail — "how did your conclusion change
// over time"), but nothing ever read it back to the inquirer. cognitiveShift compares only
// the single prior-belief-vs-current-verdict pair; a word that flip-flopped answered → open
// → answered → suspended several times got no reflection on the oscillation itself, only on
// its endpoints. This closes that gap: 3+ recorded transitions (at least two full reversals)
// surface a prompt asking whether the churn reflects genuinely unstable evidence or
// inconsistent criteria.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// Mirrors the verdict-churn check inside socraticPrompts in index.html.
function verdictChurnPrompt(word) {
  const history = word.verdictHistory || [];
  if (history.length < 3) return null;
  return {
    key: 'verdict-churn',
    ja: `裁決を${history.length}回変更した。基準は一貫しているか、それとも証拠が本当に不安定なのか?`,
    en: `Verdict changed ${history.length} times. Is your criteria consistent, or is the evidence genuinely unstable?`,
  };
}

describe('verdict-churn prompt (modeled)', () => {
  it('does not fire with no verdict history', () => {
    expect(verdictChurnPrompt({})).toBeNull();
    expect(verdictChurnPrompt({ verdictHistory: [] })).toBeNull();
  });
  it('does not fire for a single settled verdict (1 transition, no churn)', () => {
    expect(verdictChurnPrompt({ verdictHistory: [{ status: 'open', note: '', at: 1 }] })).toBeNull();
  });
  it('does not fire for one reversal (2 transitions — a normal re-examine, not churn)', () => {
    const hist = [{ status: 'open', note: '', at: 1 }, { status: 'answered', note: '', at: 2 }];
    expect(verdictChurnPrompt({ verdictHistory: hist })).toBeNull();
  });
  it('fires at 3+ recorded transitions (at least two full reversals)', () => {
    const hist = [
      { status: 'open', note: '', at: 1 },
      { status: 'answered', note: '', at: 2 },
      { status: 'open', note: '', at: 3 },
    ];
    const p = verdictChurnPrompt({ verdictHistory: hist });
    expect(p).not.toBeNull();
    expect(p.key).toBe('verdict-churn');
    expect(p.ja).toContain('3回');
    expect(p.en).toContain('3 times');
  });
  it('scales the message to however many transitions are actually recorded (capped at HISTORY_CAP=5)', () => {
    const hist = Array.from({ length: 5 }, (_, i) => ({ status: 'open', note: '', at: i }));
    const p = verdictChurnPrompt({ verdictHistory: hist });
    expect(p.ja).toContain('5回');
  });
});

describe('verdict-churn wiring (index.html)', () => {
  it('reads verdictHistory.length inside socraticPrompts', () => {
    expect(html).toContain("if((word.verdictHistory||[]).length>=3)out.push({key:'verdict-churn'");
  });
  it('includes both language variants of the churn message', () => {
    expect(html).toContain('裁決を${word.verdictHistory.length}回変更した');
    expect(html).toContain('Verdict changed ${word.verdictHistory.length} times');
  });
  it('is registered inside contradictionPrompts, one of the tier-helpers socraticPrompts aggregates into its 3-prompt cap', () => {
    // Anchor: the churn check must live inside contradictionPrompts (round 27 split
    // socraticPrompts' ~20 conditions into 5 tier-scoped helpers), not some unrelated function.
    const fnStart = html.indexOf('function contradictionPrompts(word,events){');
    const fnEnd = html.indexOf('return out;', fnStart);
    const churnIdx = html.indexOf("key:'verdict-churn'", fnStart);
    expect(fnStart).toBeGreaterThan(-1);
    expect(fnEnd).toBeGreaterThan(fnStart);
    expect(churnIdx).toBeGreaterThan(fnStart);
    expect(churnIdx).toBeLessThan(fnEnd);
  });
});
