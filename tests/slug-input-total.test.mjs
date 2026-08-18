// Neus — normalizeSlugInput を全域関数にする (round 63)
//
// 経緯: トピック型フィード(Zenn / GitHub)は素の語からスラッグを作るため、`_collectOne` が
// `encodeURIComponent` した `q` を `normalizeSlugInput` が復号し直す。検索型フィードは符号化済みの
// `q` をそのまま URL に載せるので、この往復は**両方の用途を満たすために必要**(削れない)。
//
// 監査で `decodeURIComponent` が不正な % シーケンスで **URIError を投げる**点に着目したが、
// **実測の結果、現行に crash path は無かった**: 唯一の呼び出し元が必ず符号化して渡すため、
// `100% pure` は `100%25%20pure` になり復号できる。仮説は誤りで、修正すべきバグは無かった。
//
// それでも全域関数にしたのは、その安全性が**文書化されていない暗黙の前提**に依存していたため。
// 生の語を渡す呼び出しが将来1つ増えるだけで例外になり、しかも `fetchFeed` は `Promise.all`
// の中なので **その単語の収集全体が失敗**する(Wikipedia の結果まで巻き添えで捨てられる)。
// 前提に頼らせない方が、前提を守り続けるより安い。

import { describe, it, expect } from 'vitest';
import { extractConst, evaluate } from './helpers/from-source.mjs';

const { normalizeSlugInput } = evaluate(extractConst('normalizeSlugInput'), ['normalizeSlugInput']);

describe('normalizeSlugInput — never throws', () => {
  it.each([
    ['bare percent', '%'],
    ['invalid escape', 'a%zz'],
    ['percent in plain text', '100% pure'],
    ['trailing percent', '50%'],
    ['lone high surrogate escape', '%E6'],
  ])('survives %s', (_label, input) => {
    expect(() => normalizeSlugInput(input)).not.toThrow();
  });

  it('falls back to the raw string when it cannot decode', () => {
    expect(normalizeSlugInput('100% pure')).toBe('100% pure');
    expect(normalizeSlugInput('%')).toBe('%');
  });

  it('handles nullish input', () => {
    expect(normalizeSlugInput(null)).toBe('');
    expect(normalizeSlugInput(undefined)).toBe('');
  });
});

describe('normalizeSlugInput — the round trip still works', () => {
  // This is the real contract: _collectOne encodes, this decodes back to the raw term.
  it.each(['100% pure', '50%off', '機械学習', 'C++', 'Next.js', '  Rust  '])(
    'round-trips %j through encodeURIComponent', (term) => {
      const q = encodeURIComponent(term.trim());
      expect(normalizeSlugInput(q)).toBe(term.trim().toLowerCase());
    });

  it('decodes percent-encoded Japanese', () => {
    expect(normalizeSlugInput('%E6%A9%9F')).toBe('機');
  });
  it('trims and lowercases', () => {
    expect(normalizeSlugInput('  Rust  ')).toBe('rust');
  });
});

describe('topic slug derivation stays as documented', () => {
  // SPEC records that Zenn concatenates (keeping Japanese) while GitHub hyphenates
  // (ASCII only) — deliberately different because the two sites name topics differently.
  const zenn = q => normalizeSlugInput(q).replace(/[^a-z0-9ぁ-んァ-ヶ一-龠ー]+/g, '');
  const github = q => normalizeSlugInput(q).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const enc = t => encodeURIComponent(t);

  it('Next.js differs between the two by design', () => {
    expect(zenn(enc('Next.js'))).toBe('nextjs');
    expect(github(enc('Next.js'))).toBe('next-js');
  });
  it('Zenn keeps Japanese, GitHub drops it', () => {
    expect(zenn(enc('機械学習'))).toBe('機械学習');
    expect(github(enc('機械学習'))).toBe('');
  });
  it('neither produces a leading or trailing hyphen', () => {
    expect(github(enc('  spaced  '))).toBe('spaced');
    expect(github(enc('---'))).toBe('');
  });
});
