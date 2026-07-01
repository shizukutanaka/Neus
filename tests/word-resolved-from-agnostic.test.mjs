// Neus — resolved-from-agnostic prompt (Socratic feature)
//
// Found via a third round of Socratic self-examination of the product's own feature set.
// cognitiveShift.shifted requires priorDir !== 'open' to fire, but PRIOR_DIRECTION maps both
// 'curious' and 'agnostic' to 'open' — so neither can ever trigger a shift prompt, even though
// declaring "this is unknowable" (agnostic) and later reaching a confident verdict is a sharper
// self-contradiction than the certain/skeptical reversals that already get dedicated prompts
// (shifted-from-certain, shifted-from-skeptical). 'curious' is the near-universal default
// (excluding it avoids diluting the signal with the common case), but 'agnostic' is a
// deliberately, rarely chosen stance — so it gets its own narrow prompt instead.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// Mirrors the resolved-from-agnostic check inside socraticPrompts in index.html.
function resolvedFromAgnosticPrompt(prior, verdict) {
  if (prior === 'agnostic' && (verdict === 'answered' || verdict === 'converging')) {
    return {
      key: 'resolved-from-agnostic',
      ja: '「わからない」と始めたが、結論に至った。それは本当に知り得たのか、それとも決めつけただけか?',
      en: "You began agnostic ('unknowable'), yet reached a conclusion. Did you truly come to know it, or did you just decide?",
    };
  }
  return null;
}

describe('resolved-from-agnostic prompt (modeled)', () => {
  it('fires when an agnostic prior reaches answered', () => {
    const p = resolvedFromAgnosticPrompt('agnostic', 'answered');
    expect(p).not.toBeNull();
    expect(p.key).toBe('resolved-from-agnostic');
  });
  it('fires when an agnostic prior reaches converging', () => {
    expect(resolvedFromAgnosticPrompt('agnostic', 'converging')).not.toBeNull();
  });
  it('does not fire when agnostic stays open or is suspended', () => {
    expect(resolvedFromAgnosticPrompt('agnostic', 'open')).toBeNull();
    expect(resolvedFromAgnosticPrompt('agnostic', 'suspended')).toBeNull();
  });
  it('does not fire for the default curious prior even when settled (avoids diluting the signal)', () => {
    expect(resolvedFromAgnosticPrompt('curious', 'answered')).toBeNull();
    expect(resolvedFromAgnosticPrompt('curious', 'converging')).toBeNull();
  });
  it('does not fire for certain/skeptical (they have their own dedicated shift prompts)', () => {
    expect(resolvedFromAgnosticPrompt('certain', 'answered')).toBeNull();
    expect(resolvedFromAgnosticPrompt('skeptical', 'answered')).toBeNull();
  });
});

describe('resolved-from-agnostic wiring (index.html)', () => {
  it('checks prior===\'agnostic\' directly, independent of cognitiveShift.shifted', () => {
    // shift.shifted structurally cannot be true for agnostic (PRIOR_DIRECTION.agnostic === 'open'),
    // so this prompt must NOT be gated on shift.shifted the way shifted-from-certain/-skeptical are.
    expect(html).toContain("if(prior==='agnostic'&&(verdict==='answered'||verdict==='converging'))out.push({key:'resolved-from-agnostic'");
  });
  it('maps both curious and agnostic to the open direction (why curious is excluded)', () => {
    expect(html).toContain("const PRIOR_DIRECTION={certain:'affirm',skeptical:'deny',curious:'open',agnostic:'open'};");
  });
  it('is registered inside socraticPrompts, within the 3-prompt cap', () => {
    const fnStart = html.indexOf('function socraticPrompts(word,events){');
    const fnEnd = html.indexOf('return out.slice(0,3);', fnStart);
    const idx = html.indexOf("key:'resolved-from-agnostic'", fnStart);
    expect(fnStart).toBeGreaterThan(-1);
    expect(fnEnd).toBeGreaterThan(fnStart);
    expect(idx).toBeGreaterThan(fnStart);
    expect(idx).toBeLessThan(fnEnd);
  });
});
