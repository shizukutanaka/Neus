// Neus — 一括処理が「入口で撮ったスナップショット」を書き戻さないことを固定する (round 74)
//
// round 73 で「読む → 長い await → 丸ごと書き戻す」型の lost update を要約経路で潰した。
// 同じ形は**一括処理**にもある。全件を配列に読み込み、1件ずつ await しながら書き戻す処理は、
// その await のたびに制御をイベントループへ返す — つまり**利用者の操作や到着した要約が
// 割り込む前提**の作りになっている。にもかかわらず入口のコピーを書き戻していた。
//
// 該当したのは2つ:
//   - `KeywordRules.reapplyAll`   … REAPPLY TO ALL(DEPLOY STEP 7 の #14)
//   - 単語改名の `word:` タグ差し替えループ
//
// `reapplyAll` はさらに悪い。INP のために **50件ごとに明示的に yield している** —
// 応答性のためにわざと制御を手放す設計なので、割り込みは「起こりうる」ではなく「起こる」。
//
// 本テストはミラーではなく**実ソースの `reapplyAll` を取り出して評価**し、
// 「走査中に別経路が付けた星が、一括処理の書き戻しで消えないこと」を直接確かめる。

import { describe, it, expect } from 'vitest';
import { extractFunction, source } from './helpers/from-source.mjs';

// A store whose records can be mutated behind the bulk loop's back, exactly as a click
// handler or an arriving summary would while the loop yields.
function makeStore(events) {
  const db = new Map(events.map(e => [e.id, structuredClone(e)]));
  return {
    db,
    allEvents: async () => [...db.values()].map(e => structuredClone(e)),
    getEvent: async (id) => { const e = db.get(id); return e ? structuredClone(e) : null; },
    putEvent: async (e) => { db.set(e.id, structuredClone(e)); },
    // What a concurrent star press does: writes straight to the record.
    starBehindTheLoop(id) { const e = db.get(id); e.state.starred = true; },
  };
}

function makeReapply(Store, { onPut } = {}) {
  const code = `
    const evaluate = (ev) => ({
      watch: /rust/i.test(ev.content.title) ? [{ pattern: 'rust', score: 30 }] : [],
      block: [],
    });
    const apply = (ev, m) => { if (m.watch.length) ev.meta.score = (ev.meta.score || 50) + 30; };
    const FTSIndex = { add: () => {} };
    const wrappedStore = {
      allEvents: Store.allEvents,
      getEvent: Store.getEvent,
      putEvent: async (e) => { if (onPut) await onPut(e); return Store.putEvent(e); },
    };
    const Store2 = wrappedStore;
${extractFunction('reapplyAll', '  ').replace(/\bStore\./g, 'Store2.')}
    return { reapplyAll };
  `;
  // eslint-disable-next-line no-new-func -- deliberate: exercise the REAL function body
  return new Function('Store', 'onPut', 'window', code)(Store, onPut, { });
}

const ev = (id, title) => ({
  id, content: { title }, meta: { score: 50, autoTags: [] },
  state: { starred: false, read: false, archived: false }, source: { name: 's' }, timestamp: 1,
});

describe('KeywordRules.reapplyAll does not write back a stale snapshot', () => {
  it('is the real function, not a copy', () => {
    const src = extractFunction('reapplyAll', '  ');
    expect(src).toContain('Store.allEvents()');
    expect(src).toContain('Store.putEvent');
    expect(source()).toContain('async function reapplyAll(){');
  });

  it('a star applied while the sweep is running survives it', async () => {
    // Two matching events. While the first is being written, a star lands on the second —
    // which the sweep read into its snapshot before the star existed.
    const Store = makeStore([ev('a', 'rust ownership'), ev('b', 'rust lifetimes')]);
    let first = true;
    const { reapplyAll } = makeReapply(Store, {
      onPut: async () => { if (first) { first = false; Store.starBehindTheLoop('b'); } },
    });

    await reapplyAll();
    expect(Store.db.get('b').state.starred,
      'the sweep must not overwrite a star that landed mid-run').toBe(true);
  });

  it('still applies its own change to every matching event', async () => {
    const Store = makeStore([ev('a', 'rust ownership'), ev('b', 'go routines'), ev('c', 'rust macros')]);
    const { reapplyAll } = makeReapply(Store);
    const changed = await reapplyAll();

    expect(changed, 'both rust events are updated').toBe(2);
    expect(Store.db.get('a').meta.score).toBe(80);
    expect(Store.db.get('c').meta.score).toBe(80);
    expect(Store.db.get('b').meta.score, 'a non-matching event is left alone').toBe(50);
  });

  it('skips an event deleted during the sweep instead of resurrecting it', async () => {
    const Store = makeStore([ev('a', 'rust ownership'), ev('b', 'rust lifetimes')]);
    let first = true;
    const { reapplyAll } = makeReapply(Store, {
      onPut: async () => { if (first) { first = false; Store.db.delete('b'); } },
    });

    await reapplyAll();
    expect(Store.db.has('b'), 'a record deleted mid-sweep must stay deleted').toBe(false);
  });
});

describe('the bulk loops re-read before writing (source shape)', () => {
  // reapplyAll is covered behaviourally above. The rename retag loop lives inside a DOM
  // handler and cannot be extracted, so its shape is pinned here instead.
  const src = source();

  it('the word-rename retag loop re-reads each event before writing it', () => {
    const at = src.indexOf("const oldTag='word:'+oldNorm");
    expect(at, 'the retag loop must still exist').toBeGreaterThan(-1);
    const loop = src.slice(at, at + 900);
    expect(loop, 'it must re-read rather than write the snapshot copy')
      .toContain('await Store.getEvent(ev.id)');
    expect(loop, 'and the idempotence check must run on the fresh copy')
      .toMatch(/const tags=fresh\.meta\?\.autoTags\|\|\[\];const i=tags\.indexOf\(oldTag\)/);
  });

  it('reapplyAll re-reads before applying', () => {
    const at = src.indexOf('async function reapplyAll(){');
    const fn = src.slice(at, src.indexOf('\n  }', at));
    expect(fn).toContain('await Store.getEvent(snapshot.id)');
    // The yield is what makes the interleaving certain rather than merely possible; if it is
    // ever removed the re-read is still correct, but this records why it was needed.
    expect(fn).toMatch(/scheduler.*yield|setTimeout/);
  });
});
