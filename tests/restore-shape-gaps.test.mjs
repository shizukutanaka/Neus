// Neus — 復元が受け入れる形の穴を塞ぐ (round 87)
//
// 発端は**手法の変更**だった。round 85/86 が続けて「修正不要」で終わったので、対象を勘で選ぶ
// のをやめ、抽出済みの純粋関数18個に**総当たりのファズ**を掛けた(敵対的・退化入力 556 種、
// 8,940 呼び出し: 不正サロゲート、双方向制御文字、ゼロ幅、NUL/BEL/ESC、10万文字、
// `javascript:`、`../../`、壊れた %エンコード、ReDoS 形など)。
//
// 出た throw の大半は**到達不能**だった。`tokenize` / `mdEsc` / `wordSlug` / `normalizeTerm` は
// 数値や真偽値で throw するが、呼び出し元は例外なく文字列を渡している。`hasNestedQuantifier(null)`
// も `matchRule` が `if(!text||!rule.pattern)return false;` で先に弾くので届かない。
// **これらは直さない** — 到達しない throw を潰すのは、テストのための変更でしかない。
//
// 到達するものが2つあった。どちらも**復元(restore)**経由で、型が保証されない唯一の入口である。
//
// ## 1. `validWord` が `term` を検査していない
//
// `id` と `normalized` は文字列であることを確認するのに、`term` は素通りする。しかし `term` は
//   - `wordSlug(word.term)`  … Vault/JSON 書き出し → `.trim is not a function`
//   - `encodeURIComponent((word.term||'').trim())` … `_collectOne` の収集クエリ組み立て
// で使われるため、`term: 123` の単語が1件混じると**その単語の収集と書き出しが恒久的に壊れる**。
//
// ## 2. `keyword-rules` は**検証ゼロ**で復元される
//
// `RESTORE_SETTINGS_KEYS` は `keyword-rules` を含むが、値はそのまま書き込まれる。
// `matchRule` は `!rule.pattern` を弾くものの、**真値の非文字列**(例 `pattern: 123`)は通過し、
// 非 regex モードで `p.toLowerCase()` が throw する。`KeywordRules.evaluate` は
// **全ての取り込みイベント**で走るので、これは1件の不正ルールで**取り込み全体が恒久的に停止**
// することを意味する。しかも `inbound.error 'pipeline'` は console 止まりなので、利用者には
// 「N件取得」と出たまま何も増えない状態に見える(round 80 で直した形の、より重い版)。
//
// round 65 で**イベント**の復元検証を入れたのは同じ理由だった。単語と設定は弱いままだった。

import { describe, it, expect } from 'vitest';
import { extractFunction, extractConst, evaluate, source } from './helpers/from-source.mjs';

const html = source();

const { wordSlug, normalizeTerm } = evaluate(
  [extractConst('wordSlug'), extractConst('normalizeTerm')].join('\n'),
  ['wordSlug', 'normalizeTerm']);

const { matchRule, hasNestedQuantifier } = evaluate(
  [extractFunction('hasNestedQuantifier', '  '), extractFunction('matchRule', '  ')].join('\n'),
  ['matchRule', 'hasNestedQuantifier'], { CONFIG: { regexScanMaxChars: 4000 } });

describe('what the fuzz sweep found, and why most of it is left alone', () => {
  it('helpers throw on non-string input — but their callers only ever pass strings', () => {
    // Recorded so the next reader does not "harden" these for nothing. Reachability is the
    // question, not whether a throw exists.
    expect(() => wordSlug(123)).toThrow();
    expect(() => normalizeTerm(true)).toThrow();
  });

  it('a null regex pattern cannot reach hasNestedQuantifier', () => {
    // It throws when called directly, so the guard in matchRule is what makes that moot.
    expect(() => hasNestedQuantifier(null)).toThrow();
    expect(matchRule('some text', { mode: 'regex', pattern: null }), 'short-circuited first').toBe(false);
    expect(html).toContain('function matchRule(text,rule){\n    if(!text||!rule.pattern)return false;');
  });
});

describe('a truthy non-string rule pattern breaks every ingest', () => {
  it('matchRule throws on it rather than declining to match', () => {
    // `123` is truthy, so the !rule.pattern guard lets it through, and the non-regex branch
    // calls p.toLowerCase(). KeywordRules.evaluate runs on every incoming event.
    expect(() => matchRule('rust ownership', { mode: 'contains', pattern: 123 }))
      .toThrow(TypeError);
  });

  it('restore validates keyword rules before storing them', () => {
    // The fix: the same treatment events and words already get in round 65's validator.
    expect(html).toContain('const validRule=(r)=>');
    expect(html, 'a rule whose pattern is not a string must be refused')
      .toContain("typeof r.pattern==='string'");
    expect(html, 'and the restore must actually run it over both lists')
      .toContain('validKeywordRules(');
  });

  it('a rules blob is refused rather than half-imported', () => {
    // Consistent with the round-81 choice: reject before touching the store, never partially.
    const at = html.indexOf('function validKeywordRules(');
    expect(at, 'the validator must exist').toBeGreaterThan(-1);
    const fn = html.slice(at, html.indexOf('\n}', at));
    expect(fn).toContain('watch');
    expect(fn).toContain('block');
    expect(fn, 'anything not shaped like a rule list is rejected whole').toContain('return false;');
  });
});

describe('a word whose term is not a string breaks its own collection and export', () => {
  it('wordSlug throws on it — the export path', () => {
    expect(() => wordSlug(42)).toThrow(TypeError);
  });

  it('the collect path would throw too', () => {
    // _collectOne builds its query with (word.term||'').trim().
    expect(html).toContain("const q=encodeURIComponent((word.term||'').trim());");
    expect(() => (42 || '').trim()).toThrow(TypeError);
  });

  it('restore now requires term to be a string', () => {
    const at = html.indexOf('const validWord=(w)=>{');
    expect(at).toBeGreaterThan(-1);
    const fn = html.slice(at, html.indexOf('};', at));
    expect(fn, 'id and normalized were already checked').toContain("typeof w.normalized!=='string'");
    expect(fn, 'term was not, though the collector and exporter both dereference it')
      .toContain("typeof w.term!=='string'");
  });

  it('the existing checks are kept, not replaced', () => {
    const at = html.indexOf('const validWord=(w)=>{');
    const fn = html.slice(at, html.indexOf('};', at));
    expect(fn).toContain("typeof w.id!=='string'");
    expect(fn).toContain('Number.isFinite(w.createdAt)');
    expect(fn).toContain('safeHref(w.wiki.url)');
  });
});
