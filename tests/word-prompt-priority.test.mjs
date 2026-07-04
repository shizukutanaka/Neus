// Neus — socraticPrompts priority mechanism (docs/FEATURE-AUDIT.md §1-1)
//
// Found via a co-occurrence analysis: socraticPrompts has ~20 independent trigger
// conditions, but the old implementation just pushed matching prompts in source order
// and returned out.slice(0,3) — an unsorted first-3-that-fired cut. A single neglected
// word can easily satisfy several conditions at once (e.g. a disabled word with no
// questions set, silent sources, and 10+ unreviewed items all fire together), and the
// prompts added late in the function (verdict-churn, resolved-from-agnostic,
// disabled-still-open, silence, unreviewed) were structurally starved out whenever
// earlier-declared conditions also matched — regardless of which was actually more
// important. Fixed by tagging every prompt with a tier (1=highest priority) matching the
// function's own documented priority comment ("結論の妥当性 > 反証条件 > 証拠の質 >
// 自己矛盾 > 探究の怠り"), then stable-sorting by tier before slicing to 3. Array.sort is
// guaranteed stable (ES2019+), so within a tier the original source-order priority
// (e.g. falsifier-seen before the generic stale-* prompts) is unchanged.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// Mirrors the generic "tag with tier, stable-sort, slice(0,3)" mechanism now used at the
// end of socraticPrompts in index.html — independent of which specific conditions fired.
function prioritize(candidates) {
  const out = [...candidates];
  out.sort((a, b) => a.tier - b.tier);
  return out.slice(0, 3);
}

describe('prompt priority mechanism (modeled)', () => {
  it('a lower tier number always wins a slot over a higher tier number, regardless of push order', () => {
    // Simulates the real starvation scenario: three low-priority (tier 4/5) conditions were
    // pushed first, then a tier-1 condition (falsifier-seen) fires later in the function body.
    // Under the old push-order-slice(0,3), falsifier-seen would never make it into the top 3.
    const candidates = [
      { key: 'disabled-still-open', tier: 4 },
      { key: 'no-questions', tier: 5 },
      { key: 'unreviewed', tier: 5 },
      { key: 'falsifier-seen', tier: 1 }, // pushed 4th, but must still win a slot
    ];
    const top3 = prioritize(candidates);
    expect(top3.map(p => p.key)).toContain('falsifier-seen');
    expect(top3).toHaveLength(3);
  });
  it('picks the 3 lowest tiers when more than 3 conditions fire simultaneously', () => {
    const candidates = [
      { key: 'a', tier: 5 }, { key: 'b', tier: 4 }, { key: 'c', tier: 3 },
      { key: 'd', tier: 2 }, { key: 'e', tier: 1 },
    ];
    const top3 = prioritize(candidates).map(p => p.key);
    expect(top3).toEqual(['e', 'd', 'c']); // tiers 1, 2, 3 — 4 and 5 starved, correctly
  });
  it('preserves original push order for ties within the same tier (stable sort)', () => {
    const candidates = [
      { key: 'first', tier: 4 }, { key: 'second', tier: 4 }, { key: 'third', tier: 4 },
    ];
    expect(prioritize(candidates).map(p => p.key)).toEqual(['first', 'second', 'third']);
  });
  it('returns fewer than 3 when fewer than 3 conditions fire (no padding)', () => {
    expect(prioritize([{ key: 'only-one', tier: 3 }])).toHaveLength(1);
    expect(prioritize([])).toHaveLength(0);
  });
});

describe('prompt priority wiring (index.html)', () => {
  it('defines the 5 tier constants matching the documented priority order', () => {
    expect(html).toContain('const TIER_VALIDITY=1,TIER_FALSIFIABILITY=2,TIER_EVIDENCE=3,TIER_CONTRADICTION=4,TIER_NEGLECT=5;');
  });
  it('stable-sorts by tier immediately before the slice(0,3) cutoff', () => {
    expect(html).toMatch(/out\.sort\(\(a,b\)=>a\.tier-b\.tier\);\s*return out\.slice\(0,3\);/);
  });
  it('every out.push call site inside socraticPrompts tags a tier', () => {
    const fnStart = html.indexOf('function socraticPrompts(word,events){');
    const fnEnd = html.indexOf('return out.slice(0,3);', fnStart);
    expect(fnStart).toBeGreaterThan(-1);
    expect(fnEnd).toBeGreaterThan(fnStart);
    const body = html.slice(fnStart, fnEnd);
    const pushSites = [...body.matchAll(/out\.push\(\{key:'[\w-]+'/g)];
    expect(pushSites.length).toBeGreaterThanOrEqual(20); // all known prompts, generously bounded
    for (const push of pushSites) {
      const afterKey = body.slice(push.index, push.index + 120);
      expect(afterKey, `push site missing tier: ${push[0]}`).toMatch(/tier:TIER_\w+/);
    }
  });
  it('assigns falsifier/stale prompts to the highest-priority tier (validity)', () => {
    expect(html).toContain("key:'falsifier-seen',tier:TIER_VALIDITY");
    expect(html).toContain("key:'stale-falsifier',tier:TIER_VALIDITY");
    expect(html).toContain("key:'stale-suspended',tier:TIER_VALIDITY");
    expect(html).toContain("key:'stale',tier:TIER_VALIDITY");
  });
  it('assigns the neglect-signal prompts (no-questions, unreviewed) to the lowest tier', () => {
    expect(html).toContain("key:'no-questions',tier:TIER_NEGLECT");
    expect(html).toContain("key:'unreviewed',tier:TIER_NEGLECT");
  });
});
