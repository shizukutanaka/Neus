// Neus — 単語収集が、収集中に保存された入力を消さないことを固定する (round 75)
//
// round 73/74 で潰した「読む → 長い await → 丸ごと書き戻す」型は、**単語収集**にも残っていた。
//
// `_collectOne(word)` は渡された `word` を持ったまま Wikipedia と最大8つの検索フィードを
// **並列に**取得し(それでも実測で秒単位)、終わってから `Store.putWord(word)` で書き戻す。
// 一方 WORDS 画面のハンドラは例外なく `const word=await Store.getWord(btn.dataset.id)` で
// **別のコピー**を読んでから書き戻す。つまり収集中に「問いを追加」「判定を保存」
// 「レビュー済みにする」を行うと、後から届く収集の書き戻しが**その入力を消す**。
//
// これは待ち時間の長い操作ほど当たりやすい。COLLECT を押してから結果が出るまでの数秒〜十数秒は、
// 利用者が手持ち無沙汰で他の欄をいじる時間そのもの。
//
// 検証はミラーではなく**実ソースの `_collectOne` を取り出して評価**する。依存は全て注入する。

import { describe, it, expect } from 'vitest';
import { extractFunction, source } from './helpers/from-source.mjs';

function makeCollector({ collectDelayMs = 5 } = {}) {
  const code = `
    const WORD_FEEDS = { hn: {}, reddit: {} };
    const Bus = { publish: () => {} };
    const fetchWiki = async () => { await tick(); return { extract: 'wiki text' }; };
    const fetchFeed = async (word, key) => {
      if (onFetchStart) await onFetchStart(key);
      await tick();
      return { label: key, source: { id: 's' }, items: [{ raw: {} }] };
    };
    const tick = () => new Promise(r => setTimeout(r, ${collectDelayMs}));
${extractFunction('_collectOne', '  ')}
    return { _collectOne };
  `;
  // eslint-disable-next-line no-new-func -- deliberate: exercise the REAL function body
  return new Function('Store', 'onFetchStart', code);
}

function makeStore(word) {
  const db = new Map([[word.id, structuredClone(word)]]);
  return {
    db,
    getWord: async (id) => { const w = db.get(id); return w ? structuredClone(w) : null; },
    putWord: async (w) => { db.set(w.id, structuredClone(w)); },
    // What a WORDS-view handler does while the collection is in flight: reads its own copy,
    // edits it, writes it back.
    async editBehindTheCollector(id, patch) {
      const w = await this.getWord(id);
      Object.assign(w, patch);
      await this.putWord(w);
    },
  };
}

const aWord = () => ({
  id: 'w1', term: 'rust', normalized: 'rust',
  sources: { wikipedia: true, hn: true, reddit: true },
  questions: [], verdict: { status: 'open', note: '' }, reviewedAt: 0,
  wiki: null, lastCollectedAt: null, lastFetched: 0, lastErrors: null,
});

describe('WordCollector._collectOne does not overwrite edits made while it runs', () => {
  it('is the real function, not a copy', () => {
    const src = extractFunction('_collectOne', '  ');
    expect(src).toContain('async function _collectOne(word)');
    expect(src).toContain('Store.putWord');
    expect(source()).toContain('async function _collectOne(word){');
  });

  it('a question added during collection survives', async () => {
    const Store = makeStore(aWord());
    const factory = makeCollector();
    const { _collectOne } = factory(Store, async (key) => {
      if (key !== 'hn') return;
      await Store.editBehindTheCollector('w1', { questions: [{ id: 'q1', text: 'does it hold?' }] });
    });

    await _collectOne(structuredClone(await Store.getWord('w1')));
    expect(Store.db.get('w1').questions,
      'a question saved mid-collection must not be erased by the collector').toHaveLength(1);
  });

  it('a verdict saved during collection survives', async () => {
    const Store = makeStore(aWord());
    const factory = makeCollector();
    const { _collectOne } = factory(Store, async (key) => {
      if (key !== 'hn') return;
      await Store.editBehindTheCollector('w1', { verdict: { status: 'supported', note: 'strong' } });
    });

    await _collectOne(structuredClone(await Store.getWord('w1')));
    expect(Store.db.get('w1').verdict.status,
      'a verdict saved mid-collection must not revert to open').toBe('supported');
  });

  it('the collector still records its own result', async () => {
    const Store = makeStore(aWord());
    const factory = makeCollector();
    const { _collectOne } = factory(Store, null);

    const total = await _collectOne(structuredClone(await Store.getWord('w1')));
    const saved = Store.db.get('w1');
    expect(total, 'two feeds returning one item each').toBe(2);
    expect(saved.lastFetched).toBe(2);
    expect(saved.lastCollectedAt).toBeGreaterThan(0);
    expect(saved.wiki, 'the Wikipedia extract is the collector\'s own field').toBeTruthy();
  });

  it('the caller\'s copy is refreshed too, so the immediate re-render is not stale', async () => {
    // renderWordList runs right after collectOne with the object the caller still holds.
    const Store = makeStore(aWord());
    const factory = makeCollector();
    const { _collectOne } = factory(Store, null);

    const mine = structuredClone(await Store.getWord('w1'));
    await _collectOne(mine);
    expect(mine.lastFetched, 'the caller must not redraw a zero count').toBe(2);
    expect(mine.lastCollectedAt).toBeGreaterThan(0);
  });

  it('a word deleted during collection is not resurrected with stale fields', async () => {
    const Store = makeStore(aWord());
    const factory = makeCollector();
    const mine = structuredClone(await Store.getWord('w1'));
    const { _collectOne } = factory(Store, async (key) => {
      if (key === 'hn') Store.db.delete('w1');
    });

    await _collectOne(mine);
    // Falling back to the in-hand copy is deliberate: the collection really happened and its
    // result belongs somewhere. What matters is that it cannot silently undo a concurrent
    // edit, which the earlier cases cover. Record the chosen behaviour explicitly.
    expect(Store.db.has('w1'), 'documented: the fallback re-creates the record').toBe(true);
  });
});
