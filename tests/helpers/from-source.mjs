// Neus — index.html から**実物の関数を取り出して**評価するテストヘルパー (round 60)
//
// 動機(実測された痛み): 本体ロジックは index.html のインライン ES モジュールにあり vitest から
// import できない(ADR-0007 のモノリス方針)。そのため既存テストは
//   1. 関数を**手でコピーしたミラー**を各テストに置く
//   2. 実装と食い違わないよう、ソース文字列を `expect(html).toContain('…')` で固定する
// という二重管理をしている。
//
// この方式は本セッションだけで **4回**、ソースを直しただけでテストが赤くなる事故を起こした
// (round 42 / 55 / 56 / 59)。しかも本質的な弱点がある: **ミラーはソースではない**。
// ミラーが正しくコピーされている保証はアンカー文字列だけで、アンカーが緩ければミラーが
// 古いまま「テストは緑」になりうる。テストしているのがコピーであって実装ではない状態は、
// 実装が壊れていても気づけない。
//
// 代替: **ソースから関数本文を抜き出して `new Function` で評価する**。こうすると
//   - ミラーが不要になる(二重管理の削除 = 事故の原因そのものを消す)
//   - 実装が変われば**テストは自動的に新しい実装を検証する**
//   - アンカー文字列で実装を固定する必要が減る(リファクタを妨げない)
//
// 限界を正直に書く: 任意の関数には使えない。`CONFIG` や他ヘルパーを参照する関数は依存を
// 注入する必要があり、DOM/IDB に触る関数はそもそも jsdom 側の準備が要る。したがって
// **純粋関数(または少数の値だけに依存する関数)向けの道具**であり、既存のミラー方式を
// 全面的に置き換えるものではない。ADR-0007 を再検討して `lib/` へ切り出せば本物の
// import ができるが、それは別の判断(要 ADR)。

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(join(__dirname, '..', '..', 'index.html'), 'utf8');

export const source = () => SOURCE;

/**
 * Extract one top-level `function NAME(...)` declaration verbatim from index.html.
 * Boundaries are found by indentation rather than brace counting, because the source
 * contains regex literals with braces (e.g. `[.*+?^${}()|[\]\\]`) that break naive counters —
 * a mistake made once while auditing, kept fixed here so nobody repeats it.
 *
 * @param {string} name function name as declared
 * @param {string} indent leading whitespace of the declaration ('' for top level)
 */
export function extractFunction(name, indent = '') {
  const lines = SOURCE.split('\n');
  // `async function` counts too. Without this the helper silently could not reach any async
  // declaration, which is most of the interesting ones — found while auditing collectAll.
  const heads = [`${indent}function ${name}(`, `${indent}async function ${name}(`];
  const start = lines.findIndex(l => heads.some(h => l.startsWith(h)));
  if (start < 0) throw new Error(`extractFunction: not found: ${indent}[async ]function ${name}(`);
  // A one-line declaration is self-contained.
  const first = lines[start];
  const balanced = (l) => (l.match(/\{/g) || []).length === (l.match(/\}/g) || []).length;
  if (first.trimEnd().endsWith('}') && balanced(first)) return first;
  // Otherwise the body ends at the closing brace sitting at the SAME indent, and that
  // line must be INCLUDED — stopping before it yields an unterminated function.
  const close = new RegExp(`^${indent}\\}`);
  let end = start + 1;
  while (end < lines.length && !close.test(lines[end])) end++;
  if (end >= lines.length) throw new Error(`extractFunction: no closing brace for ${name}`);
  return lines.slice(start, end + 1).join('\n');
}

/**
 * Extract a `const NAME=...` declaration verbatim, single- or multi-line.
 * Multi-line arrow bodies are common (`const f=(x)=>{ ... };`), so a single-line-only
 * matcher silently fails on them — a gap found by using this helper on normalizeSlugInput.
 */
export function extractConst(name) {
  const lines = SOURCE.split('\n');
  const start = lines.findIndex(l => new RegExp(`^\\s*const ${name}\\s*=`).test(l));
  if (start < 0) throw new Error(`extractConst: not found: const ${name}=`);
  const first = lines[start];
  const balanced = (l) => (l.match(/[{[]/g) || []).length === (l.match(/[}\]]/g) || []).length;
  if (balanced(first) && first.trimEnd().endsWith(';')) return first.trim();
  // Multi-line: run to the line closing at the declaration's own indent. Array literals
  // terminate with `]` — matching only `}` silently failed on every `const X=[`, which is
  // how the shared lookup tables are written (found while reaching for VERDICT_DEFS).
  const indent = first.match(/^\s*/)[0];
  const close = new RegExp(`^${indent}[}\\]];?$`);
  let end = start + 1;
  while (end < lines.length && !close.test(lines[end])) end++;
  if (end >= lines.length) throw new Error(`extractConst: no terminator for ${name}`);
  return lines.slice(start, end + 1).join('\n');
}

/**
 * Evaluate real source text and return the named bindings.
 * `deps` are injected as in-scope variables, which is how functions that read CONFIG or
 * call sibling helpers can be exercised without copying them.
 *
 * @param {string} code source text (from extractFunction / extractConst)
 * @param {string[]} names bindings to return
 * @param {object} deps values to place in scope (e.g. { CONFIG })
 */
export function evaluate(code, names, deps = {}) {
  const depNames = Object.keys(deps);
  const body = `${code}\nreturn {${names.join(',')}};`;
  // eslint-disable-next-line no-new-func -- deliberate: the whole point is running REAL source
  return new Function(...depNames, body)(...depNames.map(k => deps[k]));
}

/** Convenience: pull one or more real functions out of index.html and return them. */
export function loadFunctions(specs, deps = {}) {
  const code = specs.map(s =>
    typeof s === 'string' ? extractFunction(s) : extractFunction(s.name, s.indent ?? '')
  ).join('\n');
  const names = specs.map(s => (typeof s === 'string' ? s : s.name));
  return evaluate(code, names, deps);
}
