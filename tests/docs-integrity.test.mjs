// Neus — 文書が指す先が実在することを固定する (round 93)
//
// 総括 1-5 は「**文書が自分を検算する**」を長所に挙げている。round 91/92 と同じ反問を当てた:
// *その検算はどこまで届いているのか?*
//
// 既存のガードは3つあり、どれも**内容**を見ている(件数を固定していないか / i18n の死にキー /
// 旧プロジェクト名)。**参照の健全性**と**採番の整合**は誰も見ていなかった。
//
// これは机上の心配ではない。**round 87 で実際に §10.73 を二重に振った**。気づいたのは
// 偶然で、見落としていれば SPEC は同じ節番号を2つ持ったまま出荷されていた。
// 90ラウンド分の追記を人の目で守り続けるのは、round 92 で示したとおり無理がある。
//
// 実測(round 93 時点、いずれも健全):
//   §10 監査節 78 — 節番号・監査序数・round 番号すべて重複なし、昇順、欠番なし
//   ADR 24 — 全てに status 行あり
//   文書からの参照(tests/ · scripts/ · ルートファイル · ADR-00XX · §10.XX)— 壊れ 0
//
// **直すものは無い。** 本テストは「今そうである」ことではなく「**壊れたら落ちる**」ことを
// 担保するために置く。

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, basename } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const R = (p) => readFileSync(join(root, p), 'utf8');

const DOCS = [
  'SPEC.md', 'CHANGELOG.md', 'README.md', 'goal.md', 'Plan.md', 'DEPLOY.md',
  'CLAUDE.md', 'G10_RELEASE_CHECKLIST.md',
  ...readdirSync(join(root, 'docs')).filter(f => f.endsWith('.md')).map(f => `docs/${f}`),
  ...readdirSync(join(root, 'docs/adr')).filter(f => f.endsWith('.md')).map(f => `docs/adr/${f}`),
  ...readdirSync(join(root, 'docs/reviews')).filter(f => f.endsWith('.md')).map(f => `docs/reviews/${f}`),
].filter(p => existsSync(join(root, p)));

const specHeads = [...R('SPEC.md').matchAll(/^### (10\.(\d+)) 第(\d+)次監査 \(round (\d+)\)/gm)]
  .map(m => ({ section: m[1], num: +m[2], audit: +m[3], round: +m[4] }));

const adrFiles = readdirSync(join(root, 'docs/adr')).filter(f => /^ADR-\d{4}/.test(f));
const adrNumbers = new Set(adrFiles.map(f => f.slice(4, 8)));

describe('documents point at things that exist', () => {
  it('the document set is non-trivial (the walker is not silently empty)', () => {
    expect(DOCS.length).toBeGreaterThan(10);
    expect(specHeads.length).toBeGreaterThan(50);
  });

  it('every referenced source or test file exists', () => {
    const broken = [];
    for (const d of DOCS) {
      const s = R(d);
      for (const m of s.matchAll(/`(tests\/[\w./-]+\.m?js|scripts\/[\w./-]+|_worker\.js|sw\.js|index\.html|manifest\.json)`/g)) {
        if (!existsSync(join(root, m[1]))) broken.push(`${d} -> ${m[1]}`);
      }
    }
    expect(broken, `documents citing files that are not there:\n${broken.join('\n')}`).toEqual([]);
  });

  it('every ADR reference resolves to an ADR', () => {
    const broken = [];
    for (const d of DOCS) {
      for (const m of R(d).matchAll(/ADR-(\d{4})/g)) {
        if (!adrNumbers.has(m[1])) broken.push(`${d} -> ADR-${m[1]}`);
      }
    }
    expect(broken, `references to ADRs that do not exist:\n${broken.join('\n')}`).toEqual([]);
  });

  it('every SPEC section reference resolves to a section', () => {
    const all = new Set([...R('SPEC.md').matchAll(/^### (10\.\d+)/gm)].map(m => m[1]));
    const broken = [];
    for (const d of DOCS) {
      for (const m of R(d).matchAll(/§(10\.\d+)/g)) {
        if (!all.has(m[1])) broken.push(`${d} -> §${m[1]}`);
      }
    }
    expect(broken, `references to SPEC sections that do not exist:\n${broken.join('\n')}`).toEqual([]);
  });
});

describe('the audit log is numbered consistently', () => {
  // round 87 assigned §10.73 twice. It was caught by eye, which is not a method.
  const dupes = (xs) => [...new Set(xs.filter((v, i) => xs.indexOf(v) !== i))].sort((a, b) => a - b);

  it('no section number is used twice', () => {
    expect(dupes(specHeads.map(h => h.num)), 'two sections cannot share a number').toEqual([]);
  });

  it('no audit ordinal is used twice', () => {
    expect(dupes(specHeads.map(h => h.audit)), 'the 第N次 counter must be unique').toEqual([]);
  });

  it('no round number is used twice', () => {
    expect(dupes(specHeads.map(h => h.round)), 'two entries cannot describe the same round').toEqual([]);
  });

  it('sections and rounds both run forward', () => {
    const nums = specHeads.map(h => h.num);
    const rounds = specHeads.map(h => h.round);
    expect(nums, 'sections must be in order').toEqual([...nums].sort((a, b) => a - b));
    expect(rounds, 'rounds must be in order').toEqual([...rounds].sort((a, b) => a - b));
  });

  it('section numbers have no gaps', () => {
    const nums = specHeads.map(h => h.num);
    const gaps = nums.slice(1).map((n, i) => (n - nums[i] === 1 ? null : `${nums[i]} -> ${n}`)).filter(Boolean);
    expect(gaps, `a skipped section number usually means a lost entry: ${gaps.join(', ')}`).toEqual([]);
  });
});

describe('every ADR says where it stands', () => {
  it('each ADR carries a status line', () => {
    const without = adrFiles.filter(f =>
      !/(?:^|\n)\s*[-*]?\s*\*\*status\*\*|(?:^|\n)status:/i.test(R(`docs/adr/${f}`)));
    expect(without, `an ADR with no status cannot be acted on: ${without.join(', ')}`).toEqual([]);
  });

  it('ADR files are numbered without duplicates', () => {
    const nums = adrFiles.map(f => f.slice(4, 8));
    expect(nums.length, 'two ADRs sharing a number make citations ambiguous').toBe(new Set(nums).size);
  });
});
