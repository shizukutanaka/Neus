// Neus — Watchword cognitive-shift tests
// cognitiveShift(word) compares the user's prior epistemic stance (priorBelief,
// from PRIOR_BELIEF_DEFS: 'curious'/'certain'/'skeptical'/'agnostic') against the
// inquiry verdict (from VERDICT_DEFS: 'open'/'converging'/'answered'/'suspended').
// These key namespaces never overlap, so the old `prior !== verdict` comparison was
// always true — firing "changed" for every non-open verdict regardless of direction.
// The fix: map both to shared epistemic directions ('affirm'/'deny'/'open') before
// comparing. Only a committed prior contradicted by the outcome counts as "shifted".
// Mirrors cognitiveShift / PRIOR_DIRECTION / VERDICT_DIRECTION in index.html.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// ===== Mirror =====
const PRIOR_DIRECTION = { certain: 'affirm', skeptical: 'deny', curious: 'open', agnostic: 'open' };
const VERDICT_DIRECTION = { answered: 'affirm', converging: 'affirm', suspended: 'deny', open: 'open' };
const SETTLED_VERDICTS = new Set(['answered', 'suspended']);
function cognitiveShift(word) {
  const prior = (word.priorBelief || 'curious');
  const verdict = (word.verdict?.status || 'open');
  const priorDir = PRIOR_DIRECTION[prior] || 'open';
  const verdictDir = VERDICT_DIRECTION[verdict] || 'open';
  // concluded = TERMINAL verdict only; converging is in-progress, not concluded.
  const concluded = SETTLED_VERDICTS.has(verdict);
  // shifted = directional contradiction, independent of terminality (skeptical→converging counts).
  const shifted = priorDir !== 'open' && verdictDir !== 'open' && priorDir !== verdictDir;
  return { prior, verdict, concluded, shifted };
}

describe('cognitiveShift — direction mapping', () => {
  it('concluded=false when verdict is open', () => {
    expect(cognitiveShift({ priorBelief: 'certain', verdict: { status: 'open' } }).concluded).toBe(false);
  });
  it('concluded=true when verdict is answered', () => {
    expect(cognitiveShift({ priorBelief: 'curious', verdict: { status: 'answered' } }).concluded).toBe(true);
  });
  it('concluded=false when verdict is converging (in-progress, not terminal)', () => {
    expect(cognitiveShift({ priorBelief: 'curious', verdict: { status: 'converging' } }).concluded).toBe(false);
  });
  it('concluded=true when verdict is suspended', () => {
    expect(cognitiveShift({ priorBelief: 'curious', verdict: { status: 'suspended' } }).concluded).toBe(true);
  });
});

describe('cognitiveShift — shifted (committed prior contradicted by outcome)', () => {
  it('certain → suspended is shifted (certainty humbled)', () => {
    expect(cognitiveShift({ priorBelief: 'certain', verdict: { status: 'suspended' } }).shifted).toBe(true);
  });
  it('skeptical → answered is shifted (doubt overcome)', () => {
    expect(cognitiveShift({ priorBelief: 'skeptical', verdict: { status: 'answered' } }).shifted).toBe(true);
  });
  it('skeptical → converging is shifted', () => {
    expect(cognitiveShift({ priorBelief: 'skeptical', verdict: { status: 'converging' } }).shifted).toBe(true);
  });
});

describe('cognitiveShift — NOT shifted (confirmed or open prior)', () => {
  it('certain → answered is not shifted (prior confirmed)', () => {
    expect(cognitiveShift({ priorBelief: 'certain', verdict: { status: 'answered' } }).shifted).toBe(false);
  });
  it('certain → converging is not shifted', () => {
    expect(cognitiveShift({ priorBelief: 'certain', verdict: { status: 'converging' } }).shifted).toBe(false);
  });
  it('skeptical → suspended is not shifted (skepticism confirmed)', () => {
    expect(cognitiveShift({ priorBelief: 'skeptical', verdict: { status: 'suspended' } }).shifted).toBe(false);
  });
  it('curious → answered is not shifted (open prior has no direction to contradict)', () => {
    expect(cognitiveShift({ priorBelief: 'curious', verdict: { status: 'answered' } }).shifted).toBe(false);
  });
  it('agnostic → answered is not shifted (open prior has no direction to contradict)', () => {
    expect(cognitiveShift({ priorBelief: 'agnostic', verdict: { status: 'answered' } }).shifted).toBe(false);
  });
  it('curious → open is not shifted and not concluded', () => {
    const r = cognitiveShift({ priorBelief: 'curious', verdict: { status: 'open' } });
    expect(r.concluded).toBe(false);
    expect(r.shifted).toBe(false);
  });
});

describe('cognitiveShift wiring (index.html)', () => {
  it('declares PRIOR_DIRECTION and VERDICT_DIRECTION constants', () => {
    expect(html).toContain("const PRIOR_DIRECTION={certain:'affirm',skeptical:'deny',curious:'open',agnostic:'open'}");
    expect(html).toContain("const VERDICT_DIRECTION={answered:'affirm',converging:'affirm',suspended:'deny',open:'open'}");
  });
  it('cognitiveShift uses direction-aware comparison (concluded / shifted)', () => {
    expect(html).toContain('const priorDir=PRIOR_DIRECTION[prior]||\'open\'');
    expect(html).toContain('const verdictDir=VERDICT_DIRECTION[verdict]||\'open\'');
    // concluded is terminal-only (SETTLED_VERDICTS), NOT every non-open verdict —
    // converging is in-progress and must not be marked concluded.
    expect(html).toContain('const concluded=SETTLED_VERDICTS.has(verdict)');
    expect(html).toContain('const shifted=priorDir!==\'open\'&&verdictDir!==\'open\'&&priorDir!==verdictDir');
  });
  it('no longer marks converging as concluded (verdictDir!==open is gone)', () => {
    // The old `concluded=verdictDir!=='open'` swept converging in as a conclusion.
    expect(html).not.toContain('const concluded=verdictDir!==\'open\'');
  });
  it('no longer uses the buggy prior!==verdict comparison', () => {
    // The old broken `changed:prior!==verdict&&verdict!=='open'` must be gone
    expect(html).not.toContain('changed:prior!==verdict&&verdict!==\'open\'');
  });
  it('card shiftLine shows the arrow when concluded OR shifted (converging reversal surfaces)', () => {
    expect(html).toContain('(shift.concluded||shift.shifted)?');
    expect(html).not.toContain('shift.changed?');
  });
  it('card shiftLine adds shifted CSS class when shifted', () => {
    expect(html).toContain("shift.shifted?' shifted':''");
  });
  it('dossier 認識の変容 uses concluded and annotates shift type in JA/EN', () => {
    expect(html).toContain('if(shift.concluded)');
    expect(html).toContain('[認識の逆転 / epistemic shift]');
    expect(html).toContain('[先入観の確証 / prior confirmed]');
  });
  it('dossier marks a converging reversal as in-progress, not concluded', () => {
    // skeptical→converging is shifted but NOT concluded: it must read "shift emerging",
    // never "prior confirmed" (the inquiry has not ended).
    expect(html).toContain('else if(shift.shifted)');
    expect(html).toContain('[逆転の兆し / shift emerging]');
  });
  it('JSON export uses concluded and shifted instead of changed', () => {
    expect(html).toContain('concluded:shift.concluded,shifted:shift.shifted');
    expect(html).not.toContain('changed:shift.changed');
  });
  it('defines CSS for .word-shift.shifted', () => {
    expect(html).toContain('.word-shift.shifted .word-shift-verdict{');
  });
});

describe('socraticPrompts — new shift-aware prompts (index.html)', () => {
  it('declares shifted-from-certain prompt (certain → suspended)', () => {
    expect(html).toContain("key:'shifted-from-certain'");
    expect(html).toContain("prior==='certain'&&verdict==='suspended'");
  });
  it('declares shifted-from-skeptical prompt (skeptical → answered/converging)', () => {
    expect(html).toContain("key:'shifted-from-skeptical'");
    expect(html).toContain("prior==='skeptical'&&(verdict==='answered'||verdict==='converging')");
  });
  it('declares confirmed-certain prompt (confirmation bias warning)', () => {
    expect(html).toContain("key:'confirmed-certain'");
    expect(html).toContain("prior==='certain'&&(verdict==='answered'||verdict==='converging')&&!word.falsifier");
  });
  it('shift-aware prompts use the shift object from cognitiveShift', () => {
    expect(html).toContain('const shift=cognitiveShift(word)');
    expect(html).toContain('if(shift.shifted&&prior===');
  });
});
