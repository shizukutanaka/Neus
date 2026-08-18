// Neus — エンゲージメント信号の数値堅牢性 (round 55)
//
// 発見1: `engagementScore(n)` のガードは `(n||0)` だけで、null/undefined/0 しか救えなかった。
//   実測(修正前): 'abc' -> NaN / {} -> NaN / -1 -> -Infinity / -5 -> NaN
//   `likes_count` は **Qiita REST API 由来**で第三者が形を決める値。しかも Hatena 経路は
//   `bmc>0` でガードしているのに、**Qiita 経路だけ無ガード**で engagementScore に渡していた。
//
// 発見2(こちらが本質): 下流のガードが**検証しているように見えて検証していなかった**。
//   score:typeof raw.score==='number'?raw.score:50
//   `typeof NaN === 'number'` は **true** なので、NaN はこのガードを素通りして
//   `meta.score` として永続化される。
//
// 実害: 保存された NaN スコアは Vault 書き出しの YAML frontmatter に
//   score: NaN
// として出力される。NaN は YAML の標準表記(`.nan`)ではないため、Obsidian / Dataview 等が
// frontmatter を読むときに壊れる。第三者データが利用者の Vault のメタデータを壊せる経路だった。
//
// 対策: 数値化できない/負の信号は「信号なし」と同義なので中立の 50 に倒し、下流ガードは
// `Number.isFinite` に置き換える(typeof では NaN を弾けない)。

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// Mirrors engagementScore in index.html.
function engagementScore(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return 50;
  return 50 + Math.min(25, Math.round(Math.log10(v + 1) * 12));
}

describe('engagementScore — normal signals still rank', () => {
  it('treats zero engagement as neutral', () => expect(engagementScore(0)).toBe(50));
  it('increases monotonically with engagement', () => {
    expect(engagementScore(1)).toBeGreaterThan(engagementScore(0));
    expect(engagementScore(100)).toBeGreaterThan(engagementScore(10));
  });
  it('is logarithmic, so a viral outlier cannot dominate', () => {
    // 10x the likes must not give 10x the boost.
    expect(engagementScore(1000) - engagementScore(100)).toBeLessThan(10);
  });
  it('caps the boost at +25', () => {
    expect(engagementScore(1e9)).toBeLessThanOrEqual(75);
    expect(engagementScore(Number.MAX_VALUE)).toBeLessThanOrEqual(75);
  });
  it('accepts a numeric string, since feeds often stringify numbers', () => {
    expect(engagementScore('42')).toBe(engagementScore(42));
  });
});

describe('engagementScore — hostile or malformed third-party input', () => {
  // Each of these produced NaN or -Infinity before round 55.
  it.each([
    ['non-numeric string', 'abc'],
    ['object', {}],
    ['array', []],
    ['negative one', -1],
    ['negative many', -5],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['-Infinity', -Infinity],
    ['null', null],
    ['undefined', undefined],
  ])('returns a finite neutral-or-better score for %s', (_label, input) => {
    const s = engagementScore(input);
    expect(Number.isFinite(s), `${_label} produced ${s}`).toBe(true);
    expect(s).toBeGreaterThanOrEqual(50);
    expect(s).toBeLessThanOrEqual(75);
  });

  it('never yields NaN, which would survive a typeof check downstream', () => {
    for (const v of ['abc', {}, -1, NaN, undefined]) {
      expect(Number.isNaN(engagementScore(v))).toBe(false);
    }
  });
});

describe('the downstream guard actually rejects NaN now', () => {
  const oldGuard = (score) => (typeof score === 'number' ? score : 50);
  const newGuard = (score) => (Number.isFinite(score) ? score : 50);

  it('typeof lets NaN through — this is why the old guard failed', () => {
    expect(typeof NaN).toBe('number');
    expect(Number.isNaN(oldGuard(NaN))).toBe(true); // NaN persisted as meta.score
  });
  it('Number.isFinite rejects it', () => {
    expect(newGuard(NaN)).toBe(50);
    expect(newGuard(Infinity)).toBe(50);
    expect(newGuard(-Infinity)).toBe(50);
  });
  it('still passes legitimate numeric scores unchanged', () => {
    expect(newGuard(0)).toBe(0);
    expect(newGuard(73)).toBe(73);
  });
  it('a finite score keeps the Vault frontmatter valid', () => {
    // `score: NaN` is not standard YAML (the spec uses .nan), so Dataview/Obsidian
    // mis-parse the note. A finite number always serialises cleanly.
    expect(`score: ${newGuard(NaN)}`).toBe('score: 50');
    expect(`score: ${newGuard(NaN)}`).not.toContain('NaN');
  });
});

describe('wiring (index.html)', () => {
  it('engagementScore coerces and rejects non-finite/negative input', () => {
    expect(html).toContain('const v=Number(n);');
    expect(html).toContain('if(!Number.isFinite(v)||v<0)return 50;');
  });
  it('the ingestion guard uses Number.isFinite, not typeof', () => {
    expect(html).toContain('score:Number.isFinite(raw.score)?raw.score:50,');
    expect(html).not.toContain("score:typeof raw.score==='number'?raw.score:50,");
  });
  it('the Hatena path keeps its own >0 guard', () => {
    expect(html).toContain('...(bmc>0?{score:engagementScore(bmc)}:{}),');
  });
  it('the Qiita path still supplies the signal (the fix must not drop ranking)', () => {
    expect(html).toContain('score:engagementScore(it.likes_count)');
  });
});
