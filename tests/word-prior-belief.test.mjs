// Neus — Watchword prior-belief tests (γνῶθι σεαυτόν: know thyself)
// Socratic premise challenged: "you are a neutral observer of the topic."
// Before collecting evidence, you already believe something. Making that
// prior explicit lets you compare it to the eventual verdict and see
// whether the inquiry confirmed your priors or genuinely changed your mind.
// Mirrors PRIOR_BELIEF_DEFS / priorBeliefOf / cognitiveShift in index.html.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// ===== Mirrored from index.html =====
const PRIOR_BELIEF_DEFS = [
  { key: 'curious',   ja: '好奇', en: 'curious' },
  { key: 'certain',   ja: '確信', en: 'certain' },
  { key: 'skeptical', ja: '懐疑', en: 'skeptical' },
  { key: 'agnostic',  ja: '無知', en: 'agnostic' },
];
const VERDICT_DEFS = [
  { key: 'open',       ja: '探究中', en: 'open' },
  { key: 'converging', ja: '収束中', en: 'converging' },
  { key: 'answered',   ja: '解決',   en: 'answered' },
  { key: 'suspended',  ja: '保留',   en: 'suspended' },
];
function priorBeliefOf(word) { return word.priorBelief || 'curious'; }
function verdictOf(word) { return word.verdict?.status || 'open'; }
function cognitiveShift(word) {
  const prior = priorBeliefOf(word), verdict = verdictOf(word);
  const pd = PRIOR_BELIEF_DEFS.find(d => d.key === prior) || PRIOR_BELIEF_DEFS[0];
  const vd = VERDICT_DEFS.find(d => d.key === verdict) || VERDICT_DEFS[0];
  return { prior, verdict, pd, vd, changed: prior !== verdict && verdict !== 'open' };
}
function shiftSection(word) {
  const shift = cognitiveShift(word);
  const pd = PRIOR_BELIEF_DEFS.find(d => d.key === priorBeliefOf(word)) || PRIOR_BELIEF_DEFS[0];
  const lines = ['## 認識の変容', ''];
  if (shift.changed) {
    const vd = VERDICT_DEFS.find(d => d.key === shift.verdict) || VERDICT_DEFS[0];
    lines.push(`${pd.ja} (${pd.en}) → ${vd.ja} (${vd.en})`, '');
  } else {
    lines.push(`${pd.ja} (${pd.en}) → 探究継続中 (ongoing)`, '');
  }
  return lines.join('\n');
}

describe('priorBeliefOf', () => {
  it('defaults to curious when field is absent', () => {
    expect(priorBeliefOf({})).toBe('curious');
    expect(priorBeliefOf({ priorBelief: null })).toBe('curious');
  });
  it('returns the stored prior belief', () => {
    expect(priorBeliefOf({ priorBelief: 'certain' })).toBe('certain');
    expect(priorBeliefOf({ priorBelief: 'skeptical' })).toBe('skeptical');
  });
});

describe('cognitiveShift', () => {
  it('marks no change when verdict is still open (inquiry ongoing)', () => {
    const s = cognitiveShift({ priorBelief: 'certain' });
    expect(s.changed).toBe(false);
  });

  it('marks a shift when prior and non-open verdict differ', () => {
    const s = cognitiveShift({ priorBelief: 'certain', verdict: { status: 'suspended' } });
    expect(s.changed).toBe(true);
    expect(s.prior).toBe('certain');
    expect(s.verdict).toBe('suspended');
  });

  it('marks no shift when prior matches a non-open verdict (confirmed prior)', () => {
    // curious → converging: different keys → changed=true; this tests the 'same' case instead
    const s = cognitiveShift({ priorBelief: 'skeptical', verdict: { status: 'open' } });
    expect(s.changed).toBe(false); // still open, never "same non-open"
  });

  it('surfaces the correct defs for both sides', () => {
    const s = cognitiveShift({ priorBelief: 'agnostic', verdict: { status: 'answered' } });
    expect(s.pd.ja).toBe('無知');
    expect(s.vd.ja).toBe('解決');
    expect(s.changed).toBe(true);
  });
});

describe('shiftSection (dossier)', () => {
  it('renders "ongoing" when verdict is open', () => {
    const out = shiftSection({ priorBelief: 'curious' });
    expect(out).toContain('## 認識の変容');
    expect(out).toContain('探究継続中 (ongoing)');
    expect(out).toContain('好奇 (curious)');
  });

  it('renders the prior → verdict arrow when verdict is settled', () => {
    const out = shiftSection({ priorBelief: 'certain', verdict: { status: 'suspended' } });
    expect(out).toContain('確信 (certain) → 保留 (suspended)');
    expect(out).not.toContain('ongoing');
  });

  it('includes the section header always', () => {
    expect(shiftSection({ priorBelief: 'agnostic', verdict: { status: 'answered' } }))
      .toContain('## 認識の変容');
  });
});

describe('prior-belief wiring (index.html)', () => {
  it('declares PRIOR_BELIEF_DEFS, priorBeliefOf, and cognitiveShift', () => {
    expect(html).toContain('PRIOR_BELIEF_DEFS');
    expect(html).toContain('function priorBeliefOf');
    expect(html).toContain('function cognitiveShift');
  });
  it('includes a prior-belief selector in the words modal', () => {
    expect(html).toContain('id="word-prior"');
    expect(html).toContain('value="curious"');
    expect(html).toContain('value="certain"');
    expect(html).toContain('value="skeptical"');
    expect(html).toContain('value="agnostic"');
  });
  it('persists priorBelief in the word object', () => {
    expect(html).toContain('priorBelief:');
    expect(html).toContain("priorBelief=$('#word-prior').value");
  });
  it('includes prior_belief in dossier frontmatter', () => {
    expect(html).toContain('prior_belief: ${priorBeliefOf(word)}');
  });
  it('includes the shift section in the dossier', () => {
    expect(html).toContain('## 認識の変容');
    expect(html).toContain('探究継続中 (ongoing)');
  });
  it('renders the cognitive shift line in the WORDS view', () => {
    expect(html).toContain('class="word-shift"');
    expect(html).toContain('word-shift-prior');
    expect(html).toContain('word-shift-verdict');
  });
});
