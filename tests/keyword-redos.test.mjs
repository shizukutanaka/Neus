// Neus — KeywordRules: 破滅的バックトラッキング(ReDoS)対策 (round 39)
//
// 問題: `matchRule` の regex モードは `new RegExp(...)` を try/catch で囲っていたが、catch が
// 捕まえるのは**コンパイルエラーだけ**で、実行時の破滅的バックトラッキングは捕まえられない。
// ルール自体はユーザーが書くが、照合対象 `getEventText(ev,'all')` は title+snippet+summary を
// 連結したフィード由来のテキスト = **第三者が中身を決められる**。さらに `KeywordRules.evaluate()`
// は ingest ごとにメインスレッドで同期実行される。
// 結果: 「うっかり書いた正規表現」1つで、POLL のたびにタブが恒久的に固まる(リロード以外に復帰不能)。
//
// 実測(Node、修正前の裸の RegExp): `^(\w+\s?)+$` に対し
//   入力22文字=28.9ms / 24文字=116ms / 26文字=449ms  → 2文字ごとに約2倍(指数)。
// フィードの snippet は数百〜数千文字なので事実上無限。
//
// 対策(多層。JS ではメインスレッド上で任意の正規表現の実行を中断できないため、完全な防御では
// なく緩和であることを明記する):
//   1. 保存時に危険形を検出して拒否(理由をユーザーに提示)
//   2. 実行時にも同じ判定で握りつぶす(バックアップ復元・旧版由来のルール対策)
//   3. regex モードの走査長を CONFIG.regexScanMaxChars で打ち切る(指数の肩を抑える)

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

const CONFIG = { regexScanMaxChars: 4000 };

// Mirrors hasNestedQuantifier in index.html (stays in sync via the anchor tests below).
function hasNestedQuantifier(pattern) {
  const starts = [];
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\') { i++; continue; }
    if (c === '[') { while (i < pattern.length && pattern[i] !== ']') { if (pattern[i] === '\\') i++; i++; } continue; }
    if (c === '(') { starts.push(i); continue; }
    if (c !== ')') continue;
    const s = starts.pop(); if (s === undefined) continue;
    const q = pattern[i + 1];
    if (!(q === '+' || q === '*' || (q === '{' && /^\{\d+,\}/.test(pattern.slice(i + 1))))) continue;
    const body = pattern.slice(s + 1, i);
    for (let j = 0; j < body.length; j++) {
      const b = body[j];
      if (b === '\\') { j++; continue; }
      if (b === '[') { while (j < body.length && body[j] !== ']') { if (body[j] === '\\') j++; j++; } continue; }
      if (b === '+' || b === '*') return true;
      if (b === '{' && /^\{\d+,\}/.test(body.slice(j))) return true;
    }
  }
  return false;
}
// Mirrors the regex branch of matchRule.
function matchRegexRule(text, rule) {
  if (!text || !rule.pattern) return false;
  if (hasNestedQuantifier(rule.pattern)) return false;
  const scan = text.length > CONFIG.regexScanMaxChars ? text.slice(0, CONFIG.regexScanMaxChars) : text;
  try { return new RegExp(rule.pattern, rule.case ? '' : 'i').test(scan); } catch { return false; }
}

describe('hasNestedQuantifier — flags the catastrophic shapes', () => {
  it.each([
    ['^(\\w+\\s?)+$', 'the realistic accidental one: "a sentence of words"'],
    ['(a+)+', 'textbook nested quantifier'],
    ['(a*)*', 'star of star'],
    ['([a-z]+)*', 'char-class plus inside a star'],
    ['(\\d+|\\w+)+', 'alternation of unbounded branches'],
    ['^(.*,)*$', 'CSV-ish, a very common real-world ReDoS'],
  ])('flags %s (%s)', (pattern) => {
    expect(hasNestedQuantifier(pattern)).toBe(true);
  });
});

describe('hasNestedQuantifier — does not flag realistic safe rules', () => {
  // False positives would silently break legitimate user rules, so these matter.
  it.each([
    '\\bAI\\b',
    '(abc)+',
    'rust|golang',
    '(\\d{4})-(\\d{2})',
    '^https?://',
    '(cat|dog)s?',
    '[A-Z][a-z]+',
    '\\b(AI|ML)\\b',
    '(foo)?bar',
  ])('allows %s', (pattern) => {
    expect(hasNestedQuantifier(pattern)).toBe(false);
  });

  it('treats bounded repetition {n} and {n,m} as safe', () => {
    expect(hasNestedQuantifier('(\\d{2,4})+')).toBe(false);   // inner bounded
    expect(hasNestedQuantifier('(\\w+){3}')).toBe(false);     // outer bounded
  });
  it('treats open-ended {n,} as unbounded', () => {
    expect(hasNestedQuantifier('(\\w{2,})+')).toBe(true);
  });
});

describe('matchRule regex branch — the freeze is prevented', () => {
  it('returns promptly on the input that used to hang the tab', () => {
    // Without the guard this pattern against ~1000 feed-derived chars does not finish
    // in any practical time. With it, the rule is skipped immediately.
    const rule = { mode: 'regex', pattern: '^(\\w+\\s?)+$' };
    const feedText = 'word '.repeat(200) + '!';
    const t0 = Date.now();
    const result = matchRegexRule(feedText, rule);
    const elapsed = Date.now() - t0;
    expect(result).toBe(false);
    expect(elapsed).toBeLessThan(2000); // observed ~0.1ms; unguarded is effectively infinite
  });

  it('a dangerous rule is skipped rather than applied (fails closed to "no match")', () => {
    // Even text that WOULD match is reported as no-match: a rule that cannot be evaluated
    // safely must not silently archive/delete items via a block action.
    expect(matchRegexRule('word word word', { mode: 'regex', pattern: '^(\\w+\\s?)+$' })).toBe(false);
  });

  it('safe regex rules still match normally', () => {
    expect(matchRegexRule('new AI model released', { mode: 'regex', pattern: '\\bAI\\b' })).toBe(true);
    expect(matchRegexRule('dogs bark', { mode: 'regex', pattern: '(cat|dog)s?' })).toBe(true);
    expect(matchRegexRule('cats meow', { mode: 'regex', pattern: '\\bAI\\b' })).toBe(false);
  });

  it('case sensitivity still honoured', () => {
    expect(matchRegexRule('ai model', { mode: 'regex', pattern: '\\bAI\\b', case: true })).toBe(false);
    expect(matchRegexRule('ai model', { mode: 'regex', pattern: '\\bAI\\b', case: false })).toBe(true);
  });

  it('invalid regex still fails closed as before', () => {
    expect(matchRegexRule('anything', { mode: 'regex', pattern: '([unclosed' })).toBe(false);
  });
});

describe('scan-length cap', () => {
  it('truncates the scanned text for regex mode', () => {
    const text = 'x'.repeat(CONFIG.regexScanMaxChars) + 'NEEDLE';
    expect(matchRegexRule(text, { mode: 'regex', pattern: 'NEEDLE' })).toBe(false);
  });
  it('matches when the target is within the cap', () => {
    const text = 'NEEDLE' + 'x'.repeat(100);
    expect(matchRegexRule(text, { mode: 'regex', pattern: 'NEEDLE' })).toBe(true);
  });
});

describe('ReDoS guard wiring (index.html)', () => {
  it('declares the scan cap', () => {
    expect(html).toContain('regexScanMaxChars:4000,');
  });
  it('defines the detector inside KeywordRules and exports it', () => {
    expect(html).toContain('function hasNestedQuantifier(pattern){');
    expect(html).toContain('load,save,evaluate,apply,reapplyAll,hasNestedQuantifier,');
  });
  it('guards at runtime before compiling the regex', () => {
    expect(html).toContain('if(hasNestedQuantifier(rule.pattern))return false;');
    expect(html).toContain('const scan=text.length>CONFIG.regexScanMaxChars?text.slice(0,CONFIG.regexScanMaxChars):text;');
    expect(html).toContain("try{return new RegExp(rule.pattern,rule.case?'':'i').test(scan);}catch{return false;}");
  });
  it('rejects at save time for BOTH watch and block rule lists', () => {
    const occurrences = (html.match(/if\(KeywordRules\.hasNestedQuantifier\(r\.pattern\)\)\{setKwErr/g) || []).length;
    expect(occurrences).toBe(2);
  });
  it('only unbounded outer quantifiers trigger the check', () => {
    expect(html).toContain("if(!(q==='+'||q==='*'||(q==='{'&&/^\\{\\d+,\\}/.test(pattern.slice(i+1)))))continue;");
  });
  it('has bilingual DICT entries for the save-time error', () => {
    expect((html.match(/'kw\.err\.redos':/g) || []).length).toBe(2);
  });
});
