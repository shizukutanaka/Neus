// Neus — 実行時に組み立てられるクラス名と、その定義表の対応を固定する (round 77)
//
// 発端は**削除の監査**だった。round 69→76 は追加が続いたので、逆に「無くせる部品はないか」を
// 機械的に探した(最良の部品は無い部品)。結果は**ゼロ** — CONFIG 24キーは全て参照され、
// トップレベル関数 101 個に未使用は無く、CSS クラス 186 個も全て生きていた。
//
// ただし**その調べ方に落とし穴があった**。素朴な走査は 13 個を「未使用」と報告する:
//
//   .v-open / .v-converging / .v-answered / .v-suspended   ← `class="word-verdict v-${verdictOf(w)}"`
//   .tier-research                                          ← `class="word-prov-tier tier-${tb.tier}"`
//   (ほか8件は spread/テンプレート越しの関数呼び出し)
//
// **クラス名が実行時に組み立てられている**ため、文字列としてはソースのどこにも現れない。
// つまりこれらは「正しいのに、消せるように見える」。将来「未使用CSSの掃除」を素直に走らせた
// 人は、裁決ピルの色分けと出所ティアの強調を**気づかずに壊す**。
//
// そこで、見えない結合を機械が見張る結合に変える(round 62 の BYOK プロバイダ結合、
// round 71 の bookmarklet param 名と同じ手当て)。定義表は `extractConst` で実物を読む
// (round 76 で配列リテラルに対応させたので、参照表をそのまま扱える)。

import { describe, it, expect } from 'vitest';
import { extractConst, source } from './helpers/from-source.mjs';

const html = source();
const stylesheet = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));

/** Evaluate one of the real lookup tables out of index.html. */
function table(name) {
  // eslint-disable-next-line no-new-func -- deliberate: read the REAL table, not a copy
  return new Function(`${extractConst(name)}\nreturn ${name};`)();
}

// Selectors actually declared in the stylesheet (not arithmetic like `a.tier-b.tier`).
const ruleClasses = (prefix) => [...new Set(
  [...stylesheet.matchAll(new RegExp(`\\.${prefix}([a-z][a-z-]*)(?=[\\s,{:.])`, 'g'))].map(m => m[1])
)].sort();

describe('verdict pill classes match VERDICT_DEFS in both directions', () => {
  const keys = table('VERDICT_DEFS').map(d => d.key).sort();

  it('the table is non-trivial', () => {
    expect(keys.length).toBeGreaterThanOrEqual(3);
  });

  it('the class is composed from the key at runtime, which is why it looks unused', () => {
    // If this composition ever changes, the checks below stop meaning anything.
    expect(html).toContain('class="word-verdict v-${verdictOf(w)}"');
  });

  it('every verdict key has a style rule — adding a key must not ship an unstyled pill', () => {
    const missing = keys.filter(k => !ruleClasses('v-').includes(k));
    expect(missing, `VERDICT_DEFS keys with no .v-<key> rule: ${missing.join(', ')}`).toEqual([]);
  });

  it('every .v-<key> rule names a real key — deleting a key must not leave an orphan rule', () => {
    const orphans = ruleClasses('v-').filter(c => !keys.includes(c));
    expect(orphans, `.v-<key> rules with no VERDICT_DEFS entry: ${orphans.join(', ')}`).toEqual([]);
  });
});

describe('provenance tier classes name real TIER_DEFS keys', () => {
  const keys = table('TIER_DEFS').map(d => d.key);

  it('the class is composed from the key at runtime', () => {
    expect(html).toContain('class="word-prov-tier tier-${tb.tier}"');
  });

  it('every .tier-<key> rule names a real tier', () => {
    // Only one tier is deliberately highlighted, so the reverse direction is NOT asserted:
    // an unstyled tier is a design choice, an orphaned rule is a mistake.
    const orphans = ruleClasses('tier-').filter(c => !keys.includes(c));
    expect(orphans, `.tier-<key> rules with no TIER_DEFS entry: ${orphans.join(', ')}`).toEqual([]);
  });

  it('at least one tier is highlighted, so the provenance line is not uniformly grey', () => {
    expect(ruleClasses('tier-').length).toBeGreaterThan(0);
  });
});

// round 100: the key list this test walked was itself incomplete, and had been since round 77.
// `/^ {2}([a-zA-Z]\w*)\s*:/gm` only catches a key that is the FIRST thing on its own line at
// exactly 2-space indent. CONFIG packs several keys per line where it fits
// (`dbName: 'neus-v1', dbVersion: 2, maxViewItems: 50,`) and puts an explanatory comment on the
// line above others (`// RESURFACE: ...` then `resurfaceAfterMs:..., resurfacePeakMs:...,
// resurfaceMax:5,`) — every key not in first position on its line was silently never extracted,
// hence never checked. 12 of the 37 real top-level keys were invisible to "every CONFIG key is
// referenced": dbVersion, maxViewItems, tagSuggestMax, interestMinDf, interestBoostMax,
// interestDecay, dedupWindowMs, dedupCompareMax, ftsScoreMin, vaultMatchMax, resurfacePeakMs,
// resurfaceMax — among them dedupWindowMs/dedupCompareMax (round 28's dedup window cap) and
// the interest-scoring bounds, not edge cases.
//
// Confirmed reachable: removed the one call site reading CONFIG.resurfaceMax
// (`pickResurface`'s default parameter), replacing it with a bare literal — genuinely dead
// config, exactly what this test exists to catch. The test stayed green, because resurfaceMax
// was never on its list to begin with.
//
// The round-77 comment above said the deletion audit "found zero" dead keys and CSS classes.
// The CSS-class side was real (verified by trying a naive scan and finding runtime-composed
// names it missed, documented above). The CONFIG side was never actually a complete scan.
function configKeys(block) {
  // Depth/string/comment-aware scan: keep only characters written at depth 1 (directly inside
  // CONFIG's outer braces), blanking everything inside strings, line comments, and nested
  // structures (byokDefaults' provider entries, presetSources' array of objects,
  // syncIntervals' string-keyed map) — so a plain `identifier:` search over what remains can
  // only find real top-level keys, regardless of how many share a line or follow a comment.
  let depth = 0, inStr = false, out = '';
  for (let i = 0; i < block.length; i++) {
    const c = block[i], c2 = block[i + 1];
    if (inStr) {
      if (c === '\\') { out += '  '; i++; continue; }
      out += ' ';
      if (c === inStr) inStr = false;
      continue;
    }
    if (c === '/' && c2 === '/') {
      while (i < block.length && block[i] !== '\n') { out += ' '; i++; }
      out += '\n';
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { inStr = c; out += ' '; continue; }
    if (c === '{' || c === '[') { depth++; out += (depth === 1 ? c : ' '); continue; }
    if (c === '}' || c === ']') { out += (depth === 1 ? c : ' '); depth--; continue; }
    out += (depth === 1 ? c : ' ');
  }
  return [...out.matchAll(/([a-zA-Z]\w*)\s*:/g)].map(m => m[1]);
}

describe('the deletion audit that prompted this file', () => {
  // Recorded so the next person does not repeat the search and reach the wrong conclusion.
  it('every CONFIG key is referenced somewhere outside the block', () => {
    const at = html.indexOf('const CONFIG = Object.freeze({');
    const openBrace = html.indexOf('{', at);
    const closeBrace = html.indexOf('\n});', at) + 1; // include the closing brace itself
    const block = html.slice(openBrace, closeBrace);
    const rest = html.slice(0, at) + html.slice(html.indexOf('\n});', at));
    const keys = configKeys(block);
    expect(keys.length).toBeGreaterThan(30); // round 77 found 25 by only checking line-leaders
    const unused = keys.filter(k => !rest.includes(`CONFIG.${k}`));
    expect(unused, `CONFIG keys nothing reads: ${unused.join(', ')}`).toEqual([]);
  });

  it('the key scan itself sees keys the old line-anchored regex missed (guards the guard)', () => {
    // If this ever regresses to missing these, the test above silently narrows again.
    const at = html.indexOf('const CONFIG = Object.freeze({');
    const openBrace = html.indexOf('{', at);
    const closeBrace = html.indexOf('\n});', at) + 1;
    const keys = configKeys(html.slice(openBrace, closeBrace));
    for (const k of ['dbVersion', 'maxViewItems', 'tagSuggestMax', 'interestMinDf',
      'interestBoostMax', 'interestDecay', 'dedupWindowMs', 'dedupCompareMax', 'ftsScoreMin',
      'vaultMatchMax', 'resurfacePeakMs', 'resurfaceMax']) {
      expect(keys, `${k} missing from the scan again`).toContain(k);
    }
  });
});
