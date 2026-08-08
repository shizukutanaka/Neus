// Neus — CJK 見出しの近似重複検出 (round 36)
//
// 問題: `tokenize()` は空白で分割するが、日本語をはじめ CJK は単語境界に空白が無い。そのため
// 見出し全体がほぼ1トークンになり、token jaccard は近い見出しでもほとんど 0 になる。
// 実測: 「AIの未来について考える」vs「AIの未来を考える」= 0.000、
//       「Rustの所有権を理解する」vs「Rustの所有権を理解する【入門】」= 0.500(閾値0.8未満)。
// 結果、Qiita / Zenn / はてな といった日本語ソース間のクロスソース重複が、URLハッシュが
// 一致しない限り事実上まったく検出できていなかった(本プロダクトの主要言語での機能欠落)。
//
// 対策: CJK を含む見出しに限り、Falsifier Watch と同じ言語非依存の文字bigram(fsBigrams)で
// 再判定する。英語のみの見出しは従来経路のままで挙動不変。
//
// 閾値 0.75 の根拠(実測で決定、推測ではない):
//   真の重複ペア    : 0.615 〜 1.000
//   別記事のペア    : 0.304 〜 0.563  ← 最大 0.563
//   → 0.75 は別記事の最大値から 0.188 の余裕がある。クラスは一部重なるため完全分離は不可能で、
//     意図的に保守側へ倒し、サフィックス違い(0.6〜0.73)の取りこぼしは許容する。
// 損失が非対称であることが理由:
//   - 重複の見逃し   → 似たカードが2枚並ぶだけ。可逆で、本人にも見える。
//   - 別記事の誤merge → 受信側イベントは破棄され links に足されるだけ。不可逆で、本人に見えない。

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

const CONFIG = { dedupTitleThreshold: 0.8, dedupCjkTitleThreshold: 0.75 };

// Mirrors tokenize / jaccard / fsBigrams / titleDupSim in index.html.
function tokenize(text) {
  if (!text) return [];
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(w => w.length >= 2 && w.length <= 30);
}
function jaccard(A, B) {
  if (A.size === 0 && B.size === 0) return 0;
  let i = 0; for (const x of A) if (B.has(x)) i++;
  return (A.size + B.size - i) ? (i / (A.size + B.size - i)) : 0;
}
function fsBigrams(text) {
  const s = String(text || '').toLowerCase().replace(/\s+/g, '');
  const g = new Set(); for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2)); return g;
}
const CJK_RE = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/;
function titleDupSim(newTitle, newTok, oldTitle) {
  const tok = jaccard(newTok, new Set(tokenize(oldTitle)));
  if (tok >= CONFIG.dedupTitleThreshold) return tok;
  if (!CJK_RE.test(newTitle) && !CJK_RE.test(oldTitle)) return 0;
  const bg = jaccard(fsBigrams(newTitle), fsBigrams(oldTitle));
  return bg >= CONFIG.dedupCjkTitleThreshold ? bg : 0;
}
const dup = (a, b) => titleDupSim(a, new Set(tokenize(a)), b) > 0;

describe('CJK dedup — the regression this fixes', () => {
  it('token jaccard genuinely fails on Japanese (the root cause)', () => {
    // Documents WHY the fallback is needed: whitespace tokenization cannot segment Japanese.
    const a = 'Rustの所有権を理解する', b = 'Rustの所有権を理解する【入門】';
    expect(tokenize(a)).toHaveLength(1);                       // whole headline = one token
    expect(jaccard(new Set(tokenize(a)), new Set(tokenize(b)))).toBeLessThan(CONFIG.dedupTitleThreshold);
  });

  it('now catches a Japanese near-duplicate that was previously missed entirely', () => {
    expect(dup('Rustの所有権を理解する', 'Rustの所有権を理解する【入門】')).toBe(true);
  });

  it('catches whitespace-only differences in Japanese headlines', () => {
    expect(dup('TypeScript 5.0 の新機能まとめ', 'TypeScript 5.0の新機能まとめ')).toBe(true);
  });

  it('catches full-width vs half-width punctuation variants', () => {
    expect(dup('Kubernetes入門: Podとは何か', 'Kubernetes入門:Podとは何か')).toBe(true);
  });
});

describe('CJK dedup — must not merge genuinely different articles', () => {
  // A false merge DISCARDS the incoming event, so these matter more than the catches above.
  const distinct = [
    ['Rustの所有権を理解する', 'Rustのエラー処理を理解する'],
    ['AIの未来について考える', 'Web開発の未来について考える'],
    ['TypeScriptの型安全入門', 'JavaScriptの非同期入門'],
    ['React 19の新機能を解説', 'Vue 3の新機能を解説'],
    ['Kubernetes運用のベストプラクティス', 'Docker運用のベストプラクティス'],
    ['Goの並行処理入門', 'Goのエラー処理入門'],
    ['機械学習のための線形代数', '機械学習のための確率統計'],
    ['Pythonで学ぶデータ分析', 'Pythonで学ぶ画像処理'],
    ['Next.jsのルーティング解説', 'Nuxtのルーティング解説'],
  ];
  it.each(distinct)('does not merge %s with %s', (a, b) => {
    expect(dup(a, b)).toBe(false);
  });

  it('keeps a real margin between the threshold and the closest distinct pair', () => {
    const worst = Math.max(...distinct.map(([a, b]) => jaccard(fsBigrams(a), fsBigrams(b))));
    expect(worst).toBeLessThan(CONFIG.dedupCjkTitleThreshold);
    expect(CONFIG.dedupCjkTitleThreshold - worst).toBeGreaterThan(0.15); // measured ~0.188
  });
});

describe('CJK dedup — English behaviour is unchanged', () => {
  it('still dedups English titles at the original token threshold', () => {
    expect(dup('Understanding Rust ownership today', 'Understanding Rust ownership today')).toBe(true);
  });
  it('does not apply the bigram fallback to pure-ASCII titles', () => {
    // These two are 0.778 by character bigram — above the CJK threshold — but must NOT merge,
    // because the fallback is deliberately scoped to CJK only.
    const a = 'Understanding Rust ownership', b = 'Understanding Rust ownership (guide)';
    expect(jaccard(fsBigrams(a), fsBigrams(b))).toBeGreaterThan(CONFIG.dedupCjkTitleThreshold);
    expect(dup(a, b)).toBe(false); // unchanged from before this round
  });
  it('mixed CJK+ASCII headlines do use the fallback', () => {
    expect(CJK_RE.test('React 19の新機能')).toBe(true);
  });
});

describe('CJK dedup — deliberate, documented misses (conservative by design)', () => {
  // These are true duplicates the conservative threshold does NOT catch. Recorded so the
  // trade-off is explicit rather than an unknown gap: lowering the threshold to catch them
  // would leave only ~0.04 margin above the closest distinct pair (0.563).
  it.each([
    ['React 19の新機能を解説', 'React 19の新機能を解説 - Qiita'],
    ['Goの並行処理入門', 'Goの並行処理入門 | Zenn'],
    ['Dockerではじめる開発環境構築', 'Dockerではじめる開発環境構築【2026年版】'],
  ])('still misses the source-suffix variant: %s', (a, b) => {
    expect(dup(a, b)).toBe(false);
  });
});

describe('CJK dedup wiring (index.html)', () => {
  it('declares a dedicated CJK threshold', () => {
    expect(html).toContain('dedupCjkTitleThreshold:0.75,');
  });
  it('defines the CJK range check and the similarity helper', () => {
    expect(html).toContain('const CJK_RE=/[\\u3040-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff]/;');
    expect(html).toContain('function titleDupSim(newTitle,newTok,oldTitle){');
    expect(html).toContain('if(!CJK_RE.test(newTitle)&&!CJK_RE.test(oldTitle))return 0;');
  });
  it('reuses fsBigrams rather than adding another similarity implementation', () => {
    expect(html).toContain('const bg=jaccard(fsBigrams(newTitle),fsBigrams(oldTitle));');
  });
  it('the dedup pipeline calls the helper and preserves the reported similarity', () => {
    expect(html).toContain('const sim=titleDupSim(ev.content.title,newTok,r.content.title);if(sim>0){');
    expect(html).toContain("Bus.publish('event.duplicate',{ev,reason:'similar',matched:r.id,sim});");
  });
});
