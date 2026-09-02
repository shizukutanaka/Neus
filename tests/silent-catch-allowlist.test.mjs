// Neus — 「失敗を隠さない」を、握り潰しの許可リストとして固定する (round 92)
//
// round 91 で `SOCRATIC-AUDIT` 1-1(ゼロ送信)に同じ問いを当てた:「その検査はどこにあるのか」。
// 本ラウンドは 1-2「**失敗を隠さない**」に当てる。答えは同じく「**個別には測ったが、
// 全体としては測っていない**」だった。round 80/81/82 は書けない・開けない・保持保証が無いを
// それぞれ直したが、「**どこにも黙って握り潰す箇所が無い**」ことは一度も確認していない。
//
// 全 `catch` を機械的に分類した(index.html、round 92 時点):
//
//   合計 98
//     利用者へ通知(toast / Bus.publish)  32
//     console のみ                        27
//     再 throw                             1
//     空(何もしない)                     11(+ sw.js に1件 = 計12)
//     残りは代替値を返す / 返り値で伝える(`return url` / `{ok:false,reason}` / `error:'parse'`)
//
// **空 catch を1件ずつ読んだ結果、握り潰しは1件も無かった** — 全て
// (a) 後始末の best-effort(`db.close()` / `t.abort()` / `w.abort()` / `prev?.focus()`)、
// (b) 失敗しても**安全側に倒れる**経路、のどちらかである。
//
// 特に確認したもの: `syncPrefsToSW` の `cache.put('/__prefs')` が黙って失敗すると、
// sw.js 側は `prefs?.notify` が false になり**通知しない**。つまり失敗の向きは
// 「望まぬ通知が出る」ではなく「望んだ通知が出ない」で、**fail-closed**。製品の姿勢と一致する。
//
// **一度読んで安心する**のではなく、**増えたら落ちる**ようにするのが本テストの役目。
// 新しい空 catch は、理由を書いて許可リストに載せない限り通らない。
//
// その役目は初回実行で早速果たされた: 手で数えた 11件は index.html だけを見ており、
// **sw.js の1件を見落としていた**。ガードがそれを名指しで落とした — 人の目視より機械の
// 網羅が要る、という本テストの存在理由そのものである。

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Every place the code is allowed to swallow an error, keyed by what sits inside the `try`
 * it belongs to, with the reason it is acceptable. Line numbers would rot; the guarded
 * statement is stable and is also what a reader needs to judge the entry.
 */
const ALLOWED = new Map([
  ['db.close()', 'releasing a connection on versionchange; if it is already gone there is nothing to do'],
  ['t.abort()', 'aborting a transaction that may already have finished — the error is still rejected (round 88)'],
  ['w.abort()', 'closing a failed writable; the original error is rethrown immediately after'],
  ['h.queryPermission', 'a stored Vault handle that can no longer be queried falls through to the picker'],
  ['root.getFileHandle', "the day's note not existing yet is the normal first-write case"],
  ['toast(', 'the error reporter reporting its own failure has nowhere left to go'],
  ['cache.put', 'fail-closed: without prefs the service worker does not notify, so a lost write costs a wanted notification, never an unwanted one'],
  ['periodicSync.unregister', 'best-effort teardown of a registration that may already be gone'],
  ['new Notification', 'permission is checked before this point; a late failure must not break the poll'],
  ['prev?.focus()', 'restoring focus to an element that has since been removed'],
  ['deferred.userChoice', "the install prompt's outcome is advisory; the app carries on either way"],
  // Found by this very guard on its first run — I had classified the eleven in index.html by
  // hand and missed the service worker's own. Same fail-closed shape: if reading prefs or
  // showing the notification throws, nothing is shown, which is the safe direction.
  ["'neus-wake'", 'fail-closed in the service worker: a failure here means no wake notification, never an unconsented one'],
]);

/** Find `catch (…) { }` blocks with an empty body, and the `try` statement they guard. */
function emptyCatches(src) {
  const out = [];
  for (const m of src.matchAll(/catch\s*(?:\(\s*\w+\s*\))?\s*\{\s*\}/g)) {
    const before = src.slice(Math.max(0, m.index - 400), m.index);
    // The nearest preceding `try{` starts the guarded region.
    const tryAt = before.lastIndexOf('try{');
    const guarded = tryAt >= 0 ? before.slice(tryAt + 4) : before.slice(-80);
    out.push({
      line: src.slice(0, m.index).split('\n').length,
      guarded: guarded.replace(/\s+/g, ' ').trim(),
    });
  }
  return out;
}

const FILES = ['index.html', 'sw.js'];

describe('nothing swallows an error without a stated reason', () => {
  const found = FILES.flatMap(f =>
    emptyCatches(readFileSync(join(root, f), 'utf8')).map(c => ({ ...c, file: f })));

  it('there are empty catches to check (the matcher is not silently finding none)', () => {
    expect(found.length).toBeGreaterThan(5);
  });

  it('every empty catch is on the allow-list', () => {
    const unlisted = found.filter(c => ![...ALLOWED.keys()].some(k => c.guarded.includes(k)));
    expect(unlisted.map(c => `${c.file}:${c.line} guarding: ${c.guarded.slice(0, 90)}`),
      'a new empty catch needs a line in ALLOWED saying why swallowing is right here').toEqual([]);
  });

  it('every allow-list entry carries a real reason, not a shrug', () => {
    for (const [what, why] of ALLOWED) {
      expect(why.length, `${what} needs an explanation`).toBeGreaterThan(25);
      expect(why, `${what}: "ok"/"fine"/"safe" alone explains nothing`)
        .not.toMatch(/^(ok|fine|safe|harmless)\.?$/i);
    }
  });

  it('the allow-list has no entries nothing uses any more', () => {
    // An allow-list that only grows becomes permission to swallow anything.
    const stale = [...ALLOWED.keys()].filter(k => !found.some(c => c.guarded.includes(k)));
    expect(stale, `no empty catch guards these any more — remove them: ${stale.join(', ')}`).toEqual([]);
  });
});

describe('the shape of error handling overall', () => {
  // Recorded so the next reader does not have to re-derive that this is healthy, and so a
  // drift toward silence shows up as a failure rather than as nothing.
  const src = readFileSync(join(root, 'index.html'), 'utf8');
  const catches = [...src.matchAll(/catch\s*(?:\(\s*(\w+)\s*\))?\s*\{/g)];

  function bodyOf(i) {
    let depth = 1, j = i;
    while (j < src.length && depth) { if (src[j] === '{') depth++; else if (src[j] === '}') depth--; j++; }
    return src.slice(i, j - 1);
  }

  it('more catches tell the reader something than say nothing at all', () => {
    let informs = 0, empty = 0;
    for (const m of catches) {
      const body = bodyOf(m.index + m[0].length);
      if (body.includes('toast(') || body.includes('Bus.publish')) informs++;
      else if (body.trim() === '') empty++;
    }
    expect(informs, 'user-facing error reporting must not thin out').toBeGreaterThan(20);
    expect(empty, 'and silence must stay the exception').toBeLessThan(informs);
  });
});
