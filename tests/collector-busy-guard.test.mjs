// Neus — WordCollector の多重起動ガードを実ソースで検証する (round 72)
//
// round 69 で BYOK の日次予算に「確認 → await → 変更」型の欠陥が見つかった。同じ形が他にも
// 無いか、モジュールレベルの可変フラグを総当たりで見た結果、`WordCollector.collectAll` に
// **同型の穴**が残っていた:
//
//   if(busy){...return 0;}                                 // 確認
//   if(!NetworkMonitor.isOnline()){...return 0;}
//   const words=(await Store.listWords()).filter(...);     // ← ここで await
//   if(words.length===0)return 0;
//   busy=true;                                             // 変更
//
// 確認と変更の間に await があるため、**2つの呼び出しが両方とも門を通れる**。
//
// これは机上の話ではない。`collectAll` は少なくとも4経路から呼ばれ、うち2つは利用者の
// 操作と無関係に発火する:
//   - `NetworkMonitor` のオンライン復帰ハンドラ(`fetchAll().then(collectAll())`、await されない)
//   - Service Worker からの定期同期
//   - POLL ボタン / COLLECT ALL ボタン
// 定期同期やオンライン復帰が POLL 押下と重なるのは**ごく普通の並び**。
//
// 被害は「要約が二重に出る」ではない。単語収集は1語につき Wikipedia / HN / Reddit / arXiv /
// Qiita / Zenn / はてな / GitHub を叩くため、**登録語数 × ソース数の外部リクエストが丸ごと
// 二重になる**。第三者サービスへのレート制限・行儀の問題であり、同じ word レコードへの
// `Store.putWord` も競合する。
//
// `collectOne` と `RSSPoller.fetchAll` と `addWord` と `VaultMatcher.scan` は同じ形を
// 持っておらず(確認の直後に同期で立てている)、問題は無かった。`collectAll` だけが例外。
//
// 検証はミラーではなく**実ソースの `collectAll` を取り出して評価**する(round 60 のヘルパー)。
// 依存は全て注入する — 何を注入したかが、この関数が本当に触るものの一覧でもある。

import { describe, it, expect } from 'vitest';
import { extractFunction, source } from './helpers/from-source.mjs';

// Build a runnable copy of the real collectAll with every dependency stubbed.
// listWordsDelayMs models the gap that the bug lives in: any real IndexedDB read takes
// at least one microtask, and this makes that gap observable.
function makeCollector({ words = 2, listWordsDelayMs = 5 } = {}) {
  const code = `
    let busy = false;
    let progress = { done: 0, total: 0 };
    const currentLang = 'en';
    const stats = { collectOneCalls: 0, passes: 0 };
    const toast = () => {};
    const NetworkMonitor = { isOnline: () => true };
    const Store = {
      listWords: async () => {
        await new Promise(r => setTimeout(r, ${listWordsDelayMs}));
        return Array.from({ length: ${words} }, (_, i) => ({ term: 'w' + i, enabled: true }));
      },
    };
    const _collectOne = async () => {
      stats.collectOneCalls++;
      await new Promise(r => setTimeout(r, 1));
      return 1;
    };
${extractFunction('collectAll', '  ')}
    const wrapped = async () => { const n = await collectAll(); stats.passes++; return n; };
    return { collectAll: wrapped, stats, isBusy: () => busy, getProgress: () => progress };
  `;
  // eslint-disable-next-line no-new-func -- deliberate: exercise the REAL function body
  return new Function(code)();
}

describe('WordCollector.collectAll — the guard must not be jumpable', () => {
  it('is the real function, not a copy', () => {
    const src = extractFunction('collectAll', '  ');
    expect(src).toContain('async function collectAll()');
    expect(src).toContain('Store.listWords()');
    expect(source()).toContain('async function collectAll(){');
  });

  it('two concurrent calls perform exactly one collection pass', async () => {
    // The defect: with the reservation after the await, both callers passed the check and
    // both ran the whole loop — every word fetched from every source twice.
    const c = makeCollector({ words: 3 });
    await Promise.all([c.collectAll(), c.collectAll()]);
    expect(c.stats.collectOneCalls,
      'a second overlapping call must be turned away, not run a duplicate pass').toBe(3);
  });

  it('the second caller is rejected rather than queued', async () => {
    const c = makeCollector({ words: 2 });
    const [a, b] = await Promise.all([c.collectAll(), c.collectAll()]);
    // One does the work; the other returns its "already running" zero.
    expect([a, b].filter(n => n === 2)).toHaveLength(1);
    expect([a, b].filter(n => n === 0)).toHaveLength(1);
  });

  it('the flag is released so a later call still works', async () => {
    const c = makeCollector({ words: 2 });
    await c.collectAll();
    expect(c.isBusy(), 'busy must be cleared in finally').toBe(false);
    await c.collectAll();
    expect(c.stats.collectOneCalls, 'sequential calls are fine — only overlap is blocked').toBe(4);
  });

  it('an empty word list still releases the flag and resets progress', async () => {
    // The early `return 0` for "no words" sits inside the reserved window now, so it has to
    // unwind through finally or the collector deadlocks for the rest of the session.
    const c = makeCollector({ words: 0 });
    expect(await c.collectAll()).toBe(0);
    expect(c.isBusy(), 'an early return must not leave the collector wedged').toBe(false);
    expect(c.getProgress()).toEqual({ done: 0, total: 0 });
  });

  it('structurally: nothing may await between the check and the reservation', async () => {
    // The behavioural tests above would still pass if someone reintroduced an await before
    // the flag is set but after the list is read. Pin the shape too.
    const src = extractFunction('collectAll', '  ');
    const check = src.indexOf('if(busy)');
    const reserve = src.indexOf('busy=true');
    expect(check).toBeGreaterThan(-1);
    expect(reserve).toBeGreaterThan(check);
    const between = src.slice(check, reserve).replace(/^\s*\/\/.*$/gm, '');
    expect(between, 'an await here makes the guard jumpable again').not.toMatch(/\bawait\b/);
  });
});

describe('the sibling guards that were checked and found correct', () => {
  // Recorded so a future reader does not have to re-derive that these are fine, and so a
  // regression in any of them fails here rather than silently.
  const cases = [
    { name: 'collectOne', indent: '  ', check: 'if(busy)', set: 'busy=true' },
    { name: 'fetchAll', indent: '  ', check: 'if(fetching)', set: 'fetching=true' },
    { name: 'addWord', indent: '', check: 'if(addingWord)', set: 'addingWord=true' },
  ];
  it.each(cases)('$name reserves synchronously after its check', ({ name, indent, check, set }) => {
    const src = extractFunction(name, indent);
    const a = src.indexOf(check), b = src.indexOf(set);
    expect(a, `${name} must have a re-entry check`).toBeGreaterThan(-1);
    expect(b, `${name} must set its flag`).toBeGreaterThan(a);
    const between = src.slice(a, b).replace(/^\s*\/\/.*$/gm, '');
    expect(between, `${name}: await between check and set makes the guard jumpable`)
      .not.toMatch(/\bawait\b/);
  });
});
