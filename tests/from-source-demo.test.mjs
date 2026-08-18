// Neus — 実ソース評価方式の実証 (round 60)
//
// 既存のミラー方式(関数を手でコピーし、ソース文字列をアンカーで固定する)は本セッションだけで
// **4回**「ソースを直しただけでテストが赤」を起こした(round 42/55/56/59)。それ以上に重要な
// 弱点として、**ミラーはソースではない**ため、ミラーが古いままでもアンカーが緩ければ
// 「テストは緑なのに実装は壊れている」が成立しうる。
//
// 本ファイルは代替方式の実証: `tests/helpers/from-source.mjs` で index.html から**実物の関数を
// 抜き出して評価**し、その振る舞いを検証する。ミラーは存在しないので、実装が変われば
// テストは自動的に新しい実装を見る。
//
// 対象には純粋関数を選ぶ(この方式が使えるのは依存の少ない関数に限られるため。限界は
// ヘルパー冒頭に明記した)。既存テストの全面置換ではなく、**有効性の実証**が目的。

import { describe, it, expect } from 'vitest';
import { loadFunctions, extractFunction, source } from './helpers/from-source.mjs';

const CONFIG = {
  titleMaxChars: 300,
  publishedAtMaxSkewMs: 60 * 60 * 1000,
  regexScanMaxChars: 4000,
};

describe('from-source: capTitle (real implementation, no mirror)', () => {
  const { capTitle } = loadFunctions(['capTitle'], { CONFIG });

  it('is the real function, not a copy', () => {
    expect(typeof capTitle).toBe('function');
    expect(extractFunction('capTitle')).toContain('CONFIG.titleMaxChars');
  });
  it('caps an oversized headline', () => {
    expect(capTitle('A'.repeat(1000))).toHaveLength(CONFIG.titleMaxChars);
  });
  it('leaves a normal headline alone', () => {
    expect(capTitle('Rustの所有権')).toBe('Rustの所有権');
  });
  it('handles nullish input', () => {
    expect(capTitle(null)).toBe('');
    expect(capTitle(undefined)).toBe('');
  });
});

describe('from-source: sanePublishedAt (real implementation)', () => {
  const { sanePublishedAt } = loadFunctions(['sanePublishedAt'], { CONFIG });

  it('accepts a past date', () => {
    const d = Date.now() - 3600_000;
    expect(sanePublishedAt(d)).toBe(d);
  });
  it('rejects a far-future date', () => {
    expect(sanePublishedAt(Date.now() + 365 * 86400_000)).toBeUndefined();
  });
  it('rejects NaN and non-numbers', () => {
    expect(sanePublishedAt(NaN)).toBeUndefined();
    expect(sanePublishedAt('2020-01-01')).toBeUndefined();
  });
});

describe('from-source: localDateKey (real implementation)', () => {
  const { localDateKey } = loadFunctions(['localDateKey']);

  it('formats the LOCAL calendar day', () => {
    expect(localDateKey(new Date(2026, 0, 5, 8, 0))).toBe('2026-01-05');
  });
  it('does not drift to UTC', () => {
    // The round-50 bug: an 08:00 local timestamp must not report the previous day.
    const d = new Date(2026, 5, 10, 8, 0);
    expect(localDateKey(d).endsWith('-10')).toBe(true);
  });
});

describe('from-source: engagementScore (real implementation)', () => {
  const { engagementScore } = loadFunctions(['engagementScore']);

  it('is neutral for no signal and for malformed input', () => {
    expect(engagementScore(0)).toBe(50);
    expect(engagementScore('abc')).toBe(50);
    expect(engagementScore(-1)).toBe(50);
    expect(engagementScore({})).toBe(50);
  });
  it('never returns NaN', () => {
    for (const v of ['abc', {}, -5, NaN, undefined, Infinity]) {
      expect(Number.isNaN(engagementScore(v))).toBe(false);
    }
  });
});

describe('why this approach is stronger than a mirror', () => {
  it('the extractor survives regex literals containing braces', () => {
    // matchRule holds /[.*+?^${}()|[\]\\]/, which breaks naive brace-counting extraction —
    // a real mistake made while auditing, so the helper splits on indentation instead.
    const src = extractFunction('matchRule', '  ');
    expect(src).toContain('function matchRule(');
    expect(src.split('\n').length).toBeGreaterThan(3);
  });

  it('a stale mirror could pass while the real code is broken; this cannot', () => {
    // Mirrors are only as good as their anchor. Here the assertion runs the real bytes,
    // so there is no copy that can silently fall behind.
    const { capTitle } = loadFunctions(['capTitle'], { CONFIG });
    const realSaysCapped = capTitle('x'.repeat(CONFIG.titleMaxChars + 50)).length;
    expect(realSaysCapped).toBe(CONFIG.titleMaxChars);
    expect(source()).toContain('function capTitle(t){'); // the source really defines it
  });

  it('no hard-coded implementation string is needed to pin behaviour', () => {
    // Contrast with mirror suites, which must assert exact source text and therefore break
    // on harmless refactors. Nothing here depends on how the function is written.
    const { localDateKey } = loadFunctions(['localDateKey']);
    expect(localDateKey(new Date(2027, 11, 31))).toBe('2027-12-31');
  });
});
