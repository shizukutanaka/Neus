// Neus — disabled-still-open prompt (Socratic feature)
//
// Found via a fifth round of Socratic self-examination of the product's own feature set.
// The inquiry model forces epistemic honesty at every turn — you must state a falsifier,
// you get nagged for concluding without one, you get nagged for flip-flopping — but none of
// that pressure ever checked word.enabled. Disabling collection (enabled=false) has no effect
// on the verdict, so a user could quietly stop investigating while leaving the verdict at
// 'open' forever, sidestepping every other honesty prompt without ever making the explicit,
// honest choice the 'suspended' status exists to represent ("we could not conclude").

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// Mirrors the disabled-still-open check inside socraticPrompts in index.html.
function disabledStillOpenPrompt(word, n) {
  const verdict = word.verdict?.status || 'open';
  if (word.enabled === false && verdict === 'open' && n > 0) {
    return { key: 'disabled-still-open', ja: '収集を無効化したが、探究はまだ探究中のまま。再開するか、保留として記録すべきか?', en: 'Collection is disabled, yet the verdict remains open. Resume the inquiry, or record it as suspended?' };
  }
  return null;
}

describe('disabled-still-open prompt (modeled)', () => {
  it('fires when collection is disabled, verdict is still open, and evidence exists', () => {
    const p = disabledStillOpenPrompt({ enabled: false, verdict: { status: 'open' } }, 5);
    expect(p).not.toBeNull();
    expect(p.key).toBe('disabled-still-open');
  });
  it('does not fire while the word is still enabled', () => {
    expect(disabledStillOpenPrompt({ enabled: true, verdict: { status: 'open' } }, 5)).toBeNull();
    expect(disabledStillOpenPrompt({ verdict: { status: 'open' } }, 5)).toBeNull(); // enabled defaults to true/undefined
  });
  it('does not fire when the verdict has been explicitly settled (suspended/answered/converging)', () => {
    expect(disabledStillOpenPrompt({ enabled: false, verdict: { status: 'suspended' } }, 5)).toBeNull();
    expect(disabledStillOpenPrompt({ enabled: false, verdict: { status: 'answered' } }, 5)).toBeNull();
    expect(disabledStillOpenPrompt({ enabled: false, verdict: { status: 'converging' } }, 5)).toBeNull();
  });
  it('does not fire for a disabled word with no collected evidence (nothing to reflect on)', () => {
    expect(disabledStillOpenPrompt({ enabled: false, verdict: { status: 'open' } }, 0)).toBeNull();
  });
});

describe('disabled-still-open wiring (index.html)', () => {
  it('checks word.enabled directly, a dimension no other prompt in the function references', () => {
    expect(html).toContain("if(word.enabled===false&&verdict==='open'&&n>0)out.push({key:'disabled-still-open'");
  });
  it('is registered inside contradictionPrompts, one of the tier-helpers socraticPrompts aggregates into its 3-prompt cap', () => {
    const fnStart = html.indexOf('function contradictionPrompts(word,events){');
    const fnEnd = html.indexOf('return out;', fnStart);
    const idx = html.indexOf("key:'disabled-still-open'", fnStart);
    expect(fnStart).toBeGreaterThan(-1);
    expect(fnEnd).toBeGreaterThan(fnStart);
    expect(idx).toBeGreaterThan(fnStart);
    expect(idx).toBeLessThan(fnEnd);
  });
});
