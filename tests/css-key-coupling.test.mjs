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

describe('the deletion audit that prompted this file', () => {
  // Recorded so the next person does not repeat the search and reach the wrong conclusion.
  it('every CONFIG key is referenced somewhere outside the block', () => {
    const at = html.indexOf('const CONFIG = Object.freeze({');
    const block = html.slice(at, html.indexOf('\n});', at));
    const rest = html.slice(0, at) + html.slice(html.indexOf('\n});', at));
    const keys = [...block.matchAll(/^ {2}([a-zA-Z]\w*)\s*:/gm)].map(m => m[1]);
    expect(keys.length).toBeGreaterThan(15);
    const unused = keys.filter(k => !rest.includes(`CONFIG.${k}`));
    expect(unused, `CONFIG keys nothing reads: ${unused.join(', ')}`).toEqual([]);
  });
});
