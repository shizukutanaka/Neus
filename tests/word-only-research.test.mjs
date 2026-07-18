// Neus — only-research prompt (Socratic feature)
//
// Found via a fourth round of Socratic self-examination of the product's own feature set.
// no-research already flags the common failure mode (evidence is 100% discussion/other, no
// academic grounding — "is this fact or opinion?"), but its mirror was missing: an inquiry
// composed entirely of research-tier items (arXiv only, zero press/discussion coverage) never
// got flagged for the opposite failure mode — evidence that's theoretically grounded but never
// checked against real-world practice, community reaction, or press coverage.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// Mirrors tierBreakdown / the only-research check inside socraticPrompts in index.html.
const TIER_DEFS = [
  { key: 'research', ja: '一次(研究)', en: 'research' },
  { key: 'press', ja: '報道', en: 'press' },
  { key: 'discussion', ja: '議論', en: 'discussion' },
  { key: 'other', ja: 'その他', en: 'other' },
];
function sourceTier(name) {
  const label = ((name || '').split('·').pop() || '').trim().toLowerCase();
  if (label.includes('arxiv')) return 'research';
  if (label.includes('reddit') || label.includes('hacker') || label.includes('qiita') || label.includes('zenn') || label.includes('hatena')) return 'discussion';
  if (label.includes('news')) return 'press';
  return 'other';
}
function tierBreakdown(events) {
  const counts = new Map();
  for (const ev of events) { const k = sourceTier(ev.source?.name); counts.set(k, (counts.get(k) || 0) + 1); }
  return TIER_DEFS.filter(d => counts.get(d.key)).map(d => ({ tier: d.key, ja: d.ja, en: d.en, count: counts.get(d.key) }));
}
function onlyResearchPrompt(events) {
  const tiers = tierBreakdown(events);
  if (tiers.length > 0 && tiers.every(t => t.tier === 'research')) {
    return { key: 'only-research', ja: '学術論文のみで、報道・議論が無い。実世界で検証されているか、理論に留まるか?', en: 'Only academic papers — no press or discussion coverage. Validated in practice, or still theoretical?' };
  }
  return null;
}
const ev = (src) => ({ source: { name: `WebGPU · ${src}` } });

describe('only-research prompt (modeled)', () => {
  it('does not fire with no events', () => {
    expect(onlyResearchPrompt([])).toBeNull();
  });
  it('fires when every contributing tier is research (arXiv only)', () => {
    const p = onlyResearchPrompt([ev('arXiv'), ev('arXiv')]);
    expect(p).not.toBeNull();
    expect(p.key).toBe('only-research');
  });
  it('does not fire when press coverage is also present', () => {
    expect(onlyResearchPrompt([ev('arXiv'), ev('Google News')])).toBeNull();
  });
  it('does not fire when discussion coverage is also present', () => {
    expect(onlyResearchPrompt([ev('arXiv'), ev('Reddit')])).toBeNull();
  });
  it('does not fire for a pure-discussion inquiry (that is no-research\'s case, not this one)', () => {
    expect(onlyResearchPrompt([ev('Reddit'), ev('Hacker News')])).toBeNull();
  });
  it('is mutually exclusive with no-research by construction (cannot both be true)', () => {
    // no-research requires hasResearch===false && onlyTalk===true;
    // only-research requires every tier === 'research' (hasResearch===true, onlyTalk===false).
    const tiersAllResearch = tierBreakdown([ev('arXiv')]);
    const hasResearch = tiersAllResearch.some(t => t.tier === 'research');
    const onlyTalk = tiersAllResearch.length > 0 && tiersAllResearch.every(t => t.tier === 'discussion' || t.tier === 'other');
    expect(hasResearch && onlyTalk).toBe(false);
  });
});

describe('only-research wiring (index.html)', () => {
  it('checks tiers.every for the research tier, symmetric to onlyTalk\'s discussion/other check', () => {
    expect(html).toContain("if(tiers.length>0&&tiers.every(t=>t.tier==='research'))out.push({key:'only-research'");
  });
  it('is registered inside evidencePrompts, one of the tier-helpers socraticPrompts aggregates into its 3-prompt cap', () => {
    const fnStart = html.indexOf('function evidencePrompts(word,events){');
    const fnEnd = html.indexOf('return out;', fnStart);
    const idx = html.indexOf("key:'only-research'", fnStart);
    expect(fnStart).toBeGreaterThan(-1);
    expect(fnEnd).toBeGreaterThan(fnStart);
    expect(idx).toBeGreaterThan(fnStart);
    expect(idx).toBeLessThan(fnEnd);
  });
});
