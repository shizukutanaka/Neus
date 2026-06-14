// Neus — InterestProfile (implicit interest learning) tests
// Mirrors the InterestProfile scoring logic. Validates that behavior signals
// (star=positive, archive=negative) correctly bias new-event scoring.

import { describe, it, expect } from 'vitest';

const CONFIG = { interestMinDf: 2, interestBoostMax: 25, interestMaxVocab: 300 };

function tokenize(text) {
  if (!text) return [];
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(w => w.length >= 2 && w.length <= 30);
}

function makeProfile() {
  let vocab = new Map();
  function evWords(ev) {
    return new Set([...tokenize(ev.content.title), ...tokenize(ev.content.snippet),
                    ...(ev.meta.userTags || []), ...(ev.meta.autoTags || [])]);
  }
  function learn(ev, kind, sign = 1) {
    for (const w of evWords(ev)) {
      const e = vocab.get(w) || { pos: 0, neg: 0 };
      if (kind === 'pos') e.pos = Math.max(0, e.pos + sign);
      else e.neg = Math.max(0, e.neg + sign);
      if (e.pos === 0 && e.neg === 0) vocab.delete(w); else vocab.set(w, e);
    }
  }
  function scoreBoost(ev) {
    if (vocab.size === 0) return 0;
    let signal = 0, matched = 0;
    for (const w of evWords(ev)) {
      const e = vocab.get(w); if (!e) continue;
      const total = e.pos + e.neg;
      if (total < CONFIG.interestMinDf) continue;
      signal += (e.pos - e.neg) / total; matched++;
    }
    if (matched === 0) return 0;
    return Math.round((signal / matched) * CONFIG.interestBoostMax);
  }
  function stats() {
    let pos = 0, neg = 0; for (const [, e] of vocab) { pos += e.pos; neg += e.neg; }
    return { vocab: vocab.size, posSignals: pos, negSignals: neg };
  }
  function topWords(kind, n = 10) {
    return [...vocab.entries()]
      .map(([w, e]) => [w, (e.pos - e.neg) / (e.pos + e.neg || 1), e.pos + e.neg])
      .filter(x => x[2] >= CONFIG.interestMinDf && (kind === 'pos' ? x[1] > 0 : x[1] < 0))
      .sort((a, b) => kind === 'pos' ? b[1] - a[1] : a[1] - b[1])
      .slice(0, n).map(x => x[0]);
  }
  return { learn, scoreBoost, stats, topWords };
}

const mk = (title, tags = []) => ({ content: { title, snippet: '' }, meta: { autoTags: tags, userTags: [] } });

describe('InterestProfile — implicit interest learning', () => {
  it('star (positive) boosts similar new events', () => {
    const p = makeProfile();
    for (let i = 0; i < 3; i++) p.learn(mk('rust async programming'), 'pos', 1);
    expect(p.scoreBoost(mk('rust webassembly'))).toBeGreaterThan(0);
  });

  it('archive (negative) penalizes similar new events', () => {
    const p = makeProfile();
    for (let i = 0; i < 3; i++) p.learn(mk('crypto airdrop scam'), 'neg', 1);
    expect(p.scoreBoost(mk('crypto airdrop guide'))).toBeLessThan(0);
  });

  it('unrelated events get zero boost', () => {
    const p = makeProfile();
    for (let i = 0; i < 3; i++) p.learn(mk('rust programming'), 'pos', 1);
    expect(p.scoreBoost(mk('cooking pasta recipe'))).toBe(0);
  });

  it('boost is bounded by interestBoostMax', () => {
    const p = makeProfile();
    for (let i = 0; i < 10; i++) p.learn(mk('rust async tokio'), 'pos', 1);
    expect(p.scoreBoost(mk('rust async tokio'))).toBeLessThanOrEqual(CONFIG.interestBoostMax);
    expect(p.scoreBoost(mk('rust async tokio'))).toBeGreaterThanOrEqual(-CONFIG.interestBoostMax);
  });

  it('words below interestMinDf are ignored', () => {
    const p = makeProfile();
    p.learn(mk('rare singular topic'), 'pos', 1); // only 1 signal < minDf=2
    expect(p.scoreBoost(mk('rare singular topic'))).toBe(0);
  });

  it('undo (sign=-1) cancels learned signal', () => {
    const p = makeProfile();
    const ev = mk('unique xyzzy topic');
    p.learn(ev, 'pos', 1);
    expect(p.stats().vocab).toBeGreaterThan(0);
    p.learn(ev, 'pos', -1);
    expect(p.stats().vocab).toBe(0);
  });

  it('mixed signals: net polarity decides direction', () => {
    const p = makeProfile();
    // "ai" appears in both starred and archived — should be near-neutral
    p.learn(mk('ai breakthrough research'), 'pos', 1);
    p.learn(mk('ai breakthrough research'), 'pos', 1);
    p.learn(mk('ai spam clickbait'), 'neg', 1);
    p.learn(mk('ai spam clickbait'), 'neg', 1);
    // "research" is purely positive, "spam" purely negative
    expect(p.scoreBoost(mk('research paper'))).toBeGreaterThan(0);
    expect(p.scoreBoost(mk('spam clickbait'))).toBeLessThan(0);
  });

  it('topWords separates liked from filtered', () => {
    const p = makeProfile();
    for (let i = 0; i < 2; i++) p.learn(mk('rust programming'), 'pos', 1);
    for (let i = 0; i < 2; i++) p.learn(mk('crypto scam'), 'neg', 1);
    expect(p.topWords('pos')).toContain('rust');
    expect(p.topWords('neg')).toContain('crypto');
    expect(p.topWords('pos')).not.toContain('crypto');
  });

  it('learns from tags too (not just title)', () => {
    const p = makeProfile();
    for (let i = 0; i < 3; i++) p.learn(mk('some article', ['machinelearning']), 'pos', 1);
    expect(p.scoreBoost(mk('another article', ['machinelearning']))).toBeGreaterThan(0);
  });
});
