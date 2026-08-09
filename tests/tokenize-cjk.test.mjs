// Neus — CJK 対応トークナイザ (round 37)
//
// round 36 で「日本語見出しが1トークンになる」ことが近似重複を壊していると判明したが、
// 原因である `tokenize()` は他にも4箇所で使われており、同じ根本原因が波及していた:
//   - TagLearner (タグ自動推定)   : タグ→語 の連想を学習し、新着との語の重なりで推定
//   - InterestProfile (興味学習)  : star/archive から語の極性を学習
//   - VaultMatcher (ノート照合)   : イベントの語と Vault ファイル名の語を突き合わせ
//   - 近似重複 (round 36 で対処済)
// いずれも「トークンの重なり」が動作原理なので、見出し全体が一意な1トークンになる日本語では
// 二度と一致せず、機能が事実上停止していた。
//
// 実測(round 37 実施前、Node で計測): 日本語記事3件で学習したタグモデルと、同じタグが
// 付くべき4件目の語の重なりは **0**(英語の同等実験では 3)。つまり日本語では自動タグ推定が
// 完全に不動作だった。
//
// 対策: 形態素解析器はゼロ依存原則(CLAUDE.md G0-2)により導入できないため、字種
// (ひらがな/カタカナ/漢字/その他)の切り替わりを語境界の近似として使う。日本語は助詞が
// ひらがな、内容語が漢字・カタカナに寄るため、この単純な規則でも内容語をよく拾える。

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// Mirrors CJK_RE / charKind / scriptRuns / tokenize in index.html.
const CJK_RE = new RegExp('[\\u3040-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff]');
function charKind(ch) {
  const c = ch.codePointAt(0);
  if (c >= 0x3040 && c <= 0x309f) return 'hira';
  if (c >= 0x30a0 && c <= 0x30ff) return 'kata';
  if ((c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf)) return 'han';
  return 'other';
}
function scriptRuns(word) {
  const out = []; let cur = '', prev = '';
  for (const ch of word) {
    const k = charKind(ch);
    if (cur && k !== prev) { out.push(cur); cur = ''; }
    cur += ch; prev = k;
  }
  if (cur) out.push(cur);
  return out;
}
function tokenize(text) {
  if (!text) return [];
  const words = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  const out = [];
  for (const w of words) {
    if (CJK_RE.test(w)) for (const r of scriptRuns(w)) out.push(r);
    else out.push(w);
  }
  return out.filter(w => w.length >= 2 && w.length <= 30);
}

describe('tokenize — English behaviour is byte-for-byte unchanged', () => {
  // The pre-existing utils.test.mjs assertions, restated here as a regression guard.
  it('splits plain words', () => expect(tokenize('Hello World')).toEqual(['hello', 'world']));
  it('drops single characters', () => expect(tokenize('a is ok')).toEqual(['is', 'ok']));
  it('strips punctuation', () => expect(tokenize('hello, world!')).toEqual(['hello', 'world']));
  it('handles empty and nullish input', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize(null)).toEqual([]);
  });
  it('leaves ASCII untouched by the CJK path', () => {
    expect(tokenize('Understanding Rust ownership')).toEqual(['understanding', 'rust', 'ownership']);
  });
});

describe('tokenize — CJK is segmented into word-like units', () => {
  it('separates latin, kanji and katakana runs', () => {
    expect(tokenize('Rustの所有権とライフタイム入門')).toEqual(['rust', '所有権', 'ライフタイム', '入門']);
  });
  it('extracts content words from a mixed headline', () => {
    expect(tokenize('TypeScript 5.0の新機能まとめ')).toEqual(['typescript', '新機能', 'まとめ']);
  });
  it('keeps kanji compounds intact rather than splitting per character', () => {
    expect(tokenize('機械学習のための線形代数')).toContain('機械学習');
    expect(tokenize('機械学習のための線形代数')).toContain('線形代数');
  });
  it('drops single-character particles via the existing length filter', () => {
    // を / の / と are one hiragana character and must not become tokens.
    for (const t of tokenize('Rustの型システムを学ぶ')) expect(t.length).toBeGreaterThanOrEqual(2);
  });
  it('no longer collapses a headline into a single opaque token', () => {
    expect(tokenize('Rustのトレイトとジェネリクス').length).toBeGreaterThan(1);
  });
});

describe('tokenize — the subsystems this unblocks', () => {
  // Reproduces the measurement that motivated the change: a tag model learned from three
  // Japanese articles had ZERO token overlap with a fourth that deserves the same tag.
  const learn = (docs) => {
    const m = new Set();
    for (const [t, s] of docs) for (const w of new Set([...tokenize(t), ...tokenize(s)])) m.add(w);
    return m;
  };
  const corpus = [
    ['Rustの所有権とライフタイム入門', 'Rustのメモリ管理を学ぶ'],
    ['Rustのエラー処理を理解する', 'Result型とOptionの使い方'],
    ['Rustの非同期プログラミング', 'tokioを使った並行処理'],
  ];

  it('TagLearner-style overlap is now non-zero for Japanese (was 0)', () => {
    const model = learn(corpus);
    const incoming = new Set([...tokenize('Rustのトレイトとジェネリクス'), ...tokenize('Rustの型システムを学ぶ')]);
    const hits = [...model].filter(w => incoming.has(w));
    expect(hits.length).toBeGreaterThan(0);
    expect(hits).toContain('rust');
  });

  it('InterestProfile-style vocabulary stays small enough to be useful', () => {
    // Character bigrams were rejected for this reason: they would flood the 300-entry
    // vocabulary cap. Script segmentation yields a handful of tokens per document.
    const toks = new Set([...tokenize('Rustの所有権とライフタイム入門'), ...tokenize('Rustのメモリ管理を学ぶ')]);
    expect(toks.size).toBeLessThan(12);
  });

  it('VaultMatcher-style filename matching can now hit a Japanese note name', () => {
    const noteTokens = new Set(tokenize('機械学習ノート'));
    const eventTokens = new Set(tokenize('機械学習のための線形代数'));
    expect([...noteTokens].some(t => eventTokens.has(t))).toBe(true);
  });
});

describe('CJK tokenizer wiring (index.html)', () => {
  it('defines the script-kind classifier', () => {
    expect(html).toContain('function charKind(ch){');
    expect(html).toContain("if(c>=0x3040&&c<=0x309f)return 'hira';");
    expect(html).toContain("if(c>=0x30a0&&c<=0x30ff)return 'kata';");
    expect(html).toContain("if((c>=0x4e00&&c<=0x9fff)||(c>=0x3400&&c<=0x4dbf))return 'han';");
  });
  it('splits on script transitions', () => {
    expect(html).toContain('function scriptRuns(word){');
    expect(html).toContain("if(cur&&k!==prev){out.push(cur);cur='';}");
  });
  it('tokenize routes CJK words through scriptRuns and leaves ASCII alone', () => {
    expect(html).toContain('if(CJK_RE.test(w))for(const r of scriptRuns(w))out.push(r);');
    expect(html).toContain('else out.push(w);');
    expect(html).toContain('return out.filter(w=>w.length>=2&&w.length<=30);');
  });
  it('CJK_RE is declared before tokenize uses it (const is not hoisted)', () => {
    expect(html.indexOf('const CJK_RE=')).toBeLessThan(html.indexOf('function tokenize(text){'));
  });
  it('adds no dependency — segmentation is hand-rolled per the zero-dependency rule', () => {
    expect(html).not.toContain('Intl.Segmenter');
    expect(html).not.toContain('kuromoji');
  });
});
