// Neus — wordsOverview completeness + stale-suspended prompt tests
//
// Finding A: wordsOverview tracked only 'answered' and 'open', silently dropping
//   'converging' and 'suspended' from the verdict distribution displayed in the chip bar.
//
// Finding B: verdictStale fires for all SETTLED_VERDICTS (answered + suspended),
//   but the Socratic stale prompt only challenged 'answered' verdicts. A suspended
//   word with new evidence was never prompted to revisit. Fix: fire 'stale-suspended'
//   when the verdict is 'suspended' and stale > 0.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// ===== Mirrors =====
const verdictOf = (word) => word.verdict?.status || 'open';

function wordsOverview(words) {
  const o = { total: words.length, answered: 0, converging: 0, suspended: 0, open: 0, reexamine: 0, unreviewed: 0, prompts: 0, uncollected: 0 };
  for (const w of words) {
    const v = verdictOf(w);
    if (v === 'answered') o.answered++;
    else if (v === 'converging') o.converging++;
    else if (v === 'suspended') o.suspended++;
    else o.open++;
    if (!w.lastCollectedAt) o.uncollected++;
  }
  return o;
}

describe('wordsOverview — complete verdict distribution', () => {
  const words = [
    { verdict: { status: 'open' }, lastCollectedAt: 1 },
    { verdict: { status: 'converging' }, lastCollectedAt: 1 },
    { verdict: { status: 'answered' }, lastCollectedAt: 1 },
    { verdict: { status: 'suspended' }, lastCollectedAt: null },
  ];

  it('counts all four verdict states', () => {
    const ov = wordsOverview(words);
    expect(ov.open).toBe(1);
    expect(ov.converging).toBe(1);
    expect(ov.answered).toBe(1);
    expect(ov.suspended).toBe(1);
  });

  it('total equals the sum of all verdict counts', () => {
    const ov = wordsOverview(words);
    expect(ov.open + ov.converging + ov.answered + ov.suspended).toBe(ov.total);
  });

  it('uncollected counts words without lastCollectedAt', () => {
    const ov = wordsOverview(words);
    expect(ov.uncollected).toBe(1);
  });

  it('defaults missing verdict to open', () => {
    const ov = wordsOverview([{ lastCollectedAt: 1 }]);
    expect(ov.open).toBe(1);
    expect(ov.answered).toBe(0);
  });
});

describe('wordsOverview wiring (index.html)', () => {
  it('initializes converging and suspended counters', () => {
    expect(html).toContain('converging:0,suspended:0');
  });
  it('increments converging on converging verdict', () => {
    expect(html).toContain("else if(v==='converging')o.converging++");
  });
  it('increments suspended on suspended verdict', () => {
    expect(html).toContain("else if(v==='suspended')o.suspended++");
  });
  it('renders converging chip in the overview bar', () => {
    expect(html).toContain("ovChip('converging'");
    expect(html).toContain('ov.converging>0');
  });
  it('renders suspended chip in the overview bar', () => {
    expect(html).toContain("ovChip('suspended'");
    expect(html).toContain('ov.suspended>0');
  });
  it('wordMatchesOv handles converging and suspended filters', () => {
    expect(html).toContain("filter==='converging'");
    expect(html).toContain("filter==='suspended'");
  });
  it('stats panel includes converging and suspended in word count', () => {
    expect(html).toContain("wov.converging>0?', '+wov.converging+' converging':''");
    expect(html).toContain("wov.suspended>0?', '+wov.suspended+' suspended':''");
  });
});

describe('stale-suspended Socratic prompt (index.html)', () => {
  it('stale check fires for SETTLED_VERDICTS (not only answered)', () => {
    expect(html).toContain('SETTLED_VERDICTS.has(verdict)&&stale>0');
    // The old answered-only guard must be gone from the stale block
    expect(html).not.toMatch(/if\(verdict==='answered'&&stale>0\)/);
  });
  it('declares the stale-suspended prompt key', () => {
    expect(html).toContain("key:'stale-suspended'");
  });
  it('stale-suspended fires when verdict is suspended', () => {
    expect(html).toContain("verdict==='suspended'");
    expect(html).toContain("stale-suspended");
  });
  it('stale-falsifier still fires for any settled verdict with a falsifier set', () => {
    expect(html).toContain("key:'stale-falsifier'");
    expect(html).toContain('word.falsifier');
  });
});

describe('prolonged-converging Socratic prompt (index.html)', () => {
  it('declares the prolonged-converging prompt key', () => {
    expect(html).toContain("key:'prolonged-converging'");
  });
  it('only fires when verdict is converging and verdictAt is set', () => {
    expect(html).toContain("verdict==='converging'&&word.verdictAt");
  });
  it('counts items since verdictAt (sinceConverging>=10 threshold)', () => {
    expect(html).toContain('sinceConverging=events.filter(e=>(e.timestamp||0)>word.verdictAt).length');
    expect(html).toContain('sinceConverging>=10');
  });
});
