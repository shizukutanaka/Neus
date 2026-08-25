// Neus — WORDS 一覧の並べ替えキーを比較の外で求めることを固定する (round 79)
//
// round 78 で「無くせる仕事」を探し始めたので、同じ目でソートを見た。ファイル全体で
// **比較関数の中で関数を呼んでいるのは1箇所だけ**(他は全て事前計算か素の値参照)、
// それが `renderWords` の並べ替えだった:
//
//   words.slice().sort((a,b)=>{const d=_wSortVal(a)-_wSortVal(b); ...})
//
// `_wSortVal` の `new` 分岐は**キー1つにつき全イベントを走査**する。比較関数の中で呼ぶと
// 同じ単語が何度も評価され、しかも**回数は V8 のソート実装と入力順に依存する**。
//
//   | 規模               | _wSortVal 呼び出し | 時間              |
//   |--------------------|--------------------|-------------------|
//   | 1,000件 × 10語     | 18 → 10            | 2.4ms → 0.5ms     |
//   | 5,000件 × 30語     | 128 → 30           | 20.9ms → 4.1ms    |
//   | 10,000件 × 50語    | 98 → 50            | 29.9ms → 15.6ms   |
//
// 派手な数字ではない(既定の並びは `date` で、この分岐は利用者が「新着順」を選んだときだけ
// 通る)。それでも**同じ答えを何度も計算し直す**のは無くせる仕事で、直し方は教科書どおりの
// decorate-sort-undecorate — 足すのではなく**重複を消す**変更である。
//
// 本当の危険は速度ではなく**並び順が変わること**なので、そこを重点的に固定する。

import { describe, it, expect } from 'vitest';
import { extractFunction, source } from './helpers/from-source.mjs';

// The real key function, with its four dependencies injected.
function makeSortVal({ wordSortKey, all, countCalls }) {
  const code = `
    const newSinceReview = (items, since) => items.filter(e => (e.timestamp || 0) > (since || 0));
    const verdictOf = (w) => w?.verdict?.status || 'open';
${extractFunction('_wSortVal', '  ')}
    return (w) => { counter.n++; return _wSortVal(w); };
  `;
  // eslint-disable-next-line no-new-func -- deliberate: exercise the REAL key function
  return new Function('wordSortKey', 'all', 'counter', code)(wordSortKey, all, countCalls);
}

const makeWords = (n) => Array.from({ length: n }, (_, i) => ({
  id: 'id' + i, normalized: 'w' + i, createdAt: i,
  reviewedAt: 0, verdict: { status: ['open', 'answered', 'converging', 'suspended'][i % 4] },
}));

const makeEvents = (m, w) => Array.from({ length: m }, (_, i) => ({
  timestamp: i + 1, meta: { autoTags: ['word:w' + (i % w)] }, state: { archived: false },
}));

/** The shipped shape: compute each key once, then sort the decorated list. */
const sortPrecomputed = (words, keyOf) => {
  const keyed = words.map(w => ({ w, k: keyOf(w) }));
  keyed.sort((a, b) => { const d = a.k - b.k; return d !== 0 ? d : -(a.w.createdAt || 0) + (b.w.createdAt || 0); });
  return keyed.map(x => x.w);
};

/** The old shape, kept only so the two can be compared. */
const sortInComparator = (words, keyOf) =>
  words.slice().sort((a, b) => { const d = keyOf(a) - keyOf(b); return d !== 0 ? d : -(a.createdAt || 0) + (b.createdAt || 0); });

describe('the sort key is computed once per word', () => {
  it('the shipped code decorates before sorting', () => {
    const src = source();
    expect(src).toContain('const keyed=words.map(w=>({w,k:_wSortVal(w)}));');
    expect(src, 'the comparator must not call the key function any more')
      .not.toMatch(/sort\(\(a,b\)=>\{const d=_wSortVal\(a\)-_wSortVal\(b\)/);
  });

  it.each([[10, 1000], [30, 5000]])('%i words: exactly one evaluation each', (W, M) => {
    const counter = { n: 0 };
    const keyOf = makeSortVal({ wordSortKey: 'new', all: makeEvents(M, W), countCalls: counter });
    sortPrecomputed(makeWords(W), keyOf);
    expect(counter.n, 'one key per word, independent of the sort implementation').toBe(W);
  });

  it('the old shape really did evaluate some words more than once', () => {
    // Guards against the refactor being pointless: if this ever stops being true the
    // justification above is wrong and should be revisited rather than trusted.
    const counter = { n: 0 };
    const keyOf = makeSortVal({ wordSortKey: 'new', all: makeEvents(5000, 30), countCalls: counter });
    sortInComparator(makeWords(30), keyOf);
    expect(counter.n).toBeGreaterThan(30);
  });
});

describe('the order is exactly what it was before', () => {
  // The real risk of decorate-sort-undecorate is a changed ordering, not a slower one.
  it.each(['date', 'new', 'verdict'])('%s sort matches the old comparator', (mode) => {
    const words = makeWords(24);
    const all = makeEvents(600, 24);
    const a = sortPrecomputed(words, makeSortVal({ wordSortKey: mode, all, countCalls: { n: 0 } }));
    const b = sortInComparator(words, makeSortVal({ wordSortKey: mode, all, countCalls: { n: 0 } }));
    expect(a.map(w => w.id)).toEqual(b.map(w => w.id));
  });

  it('ties still break by newest-created first', () => {
    // Every word has the same verdict rank, so only the tiebreak distinguishes them.
    const words = makeWords(6).map(w => ({ ...w, verdict: { status: 'open' } }));
    const out = sortPrecomputed(words, makeSortVal({ wordSortKey: 'verdict', all: [], countCalls: { n: 0 } }));
    expect(out.map(w => w.createdAt)).toEqual([5, 4, 3, 2, 1, 0]);
  });

  it('newest-first sorting really does depend on collected items', () => {
    // If the key were constant the equality checks above would pass vacuously.
    const words = makeWords(4);
    const all = [
      { timestamp: 9, meta: { autoTags: ['word:w2'] }, state: { archived: false } },
      { timestamp: 9, meta: { autoTags: ['word:w2'] }, state: { archived: false } },
      { timestamp: 9, meta: { autoTags: ['word:w0'] }, state: { archived: false } },
    ];
    const out = sortPrecomputed(words, makeSortVal({ wordSortKey: 'new', all, countCalls: { n: 0 } }));
    expect(out[0].normalized, 'the word with the most new items comes first').toBe('w2');
  });

  it('archived items do not count toward the newest-first key', () => {
    const words = makeWords(2);
    const all = [
      { timestamp: 9, meta: { autoTags: ['word:w1'] }, state: { archived: true } },
      { timestamp: 9, meta: { autoTags: ['word:w0'] }, state: { archived: false } },
    ];
    const out = sortPrecomputed(words, makeSortVal({ wordSortKey: 'new', all, countCalls: { n: 0 } }));
    expect(out[0].normalized).toBe('w0');
  });
});
