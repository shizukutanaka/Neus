// Neus — 生きた文書に「手で同期する数字」を書かせないガード (round 45)
//
// 経緯: コミット e534eff が「陳腐化したテスト件数ラベル」を一度同期し直した(1,277 → 1,399)。
// それから数ラウンドで実数は 1,510 になり、**同じ箇所がまた陳腐化した**。
// つまりこれは「直す」対象ではなく「無くす」対象だった — 手で同期し続ける必要のある数字は、
// 直すたびに必ずまた壊れる部品。マスク式に言えば「最良の部品は無い部品」。
//
// 方針(どこに数字を書いてよいか):
//   - **日付つきの記録**(CHANGELOG / SPEC §10 の各ラウンド / G10 チェックリストの実測欄)
//     → 数字は**正しい**。その時点の測定値であり、後から変わらないのが正しい振る舞い。
//   - **生きた指示・現状記述**(docs/reviews/AUDIT-BRIEF.md / goal.md)
//     → 数字は**書かない**。常に最新であることを期待される文書なので、固定値は必ず嘘になる。
//       代わりに「値を得るコマンド」を書く。
//
// このテストは後者だけを検査する。

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// Documents expected to stay current, so they must not freeze a number.
const LIVING_DOCS = ['docs/reviews/AUDIT-BRIEF.md', 'goal.md'];

// Patterns that mean "a count someone must remember to update".
const FROZEN = [
  { re: /\d{1,3},\d{3}\s*(?:件|tests?\b)/gi, what: 'a hard-coded test count' },
  { re: /\b\d{3,4}\s*tests?\b/gi, what: 'a hard-coded test count' },
  { re: /§?10\.\d+\s*\/\s*round\s*\d+/gi, what: 'a hard-coded SPEC section / round number' },
];

describe('living docs do not freeze counts that must be hand-synced', () => {
  it.each(LIVING_DOCS)('%s cites commands, not frozen numbers', (rel) => {
    const text = readFileSync(join(root, rel), 'utf8');
    const hits = [];
    for (const { re, what } of FROZEN) {
      for (const m of text.matchAll(re)) hits.push(`${what}: "${m[0].trim()}"`);
    }
    expect(hits, `${rel} contains numbers that will go stale — cite the command instead:\n  ${hits.join('\n  ')}`).toEqual([]);
  });

  it('AUDIT-BRIEF tells the reader how to derive the values instead', () => {
    const brief = readFileSync(join(root, 'docs/reviews/AUDIT-BRIEF.md'), 'utf8');
    expect(brief).toContain('npm test');
    expect(brief).toContain("grep -E '^### 10\\.[0-9]+' SPEC.md | tail -1");
  });

  it('dated records are deliberately NOT covered by this guard', () => {
    // CHANGELOG and SPEC §10 rounds record measurements at a point in time; a number there
    // is correct precisely because it does not change. Asserting they contain counts keeps
    // a future cleanup from "helpfully" stripping the historical record too.
    const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
    expect(/\d{1,3},\d{3}/.test(changelog) || /\d{3,4}\s*件/.test(changelog)).toBe(true);
  });
});
