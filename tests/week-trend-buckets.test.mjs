// Neus — 週次トレンドを暦日でバケットする (round 54)
//
// 発見: ダイジェストの7日トレンドが**経過24時間**で割っていた:
//   const days=Math.floor((Date.now()-ev.timestamp)/(24*60*60*1000));
// これだと区切りが**現在時刻に張り付く**ため、暦日と一致しない。実測(月曜10:00に閲覧):
//
//   日曜 23:00 の記事 -> 経過11時間 -> bucket 0 = **「今日」として計上**(実際は昨日)
//   土曜 23:00 の記事 -> 経過35時間 -> bucket 1 = 「1日前」   (実際は2日前)
//
// つまり**毎晩の活動が翌日へずれる**。しかも境界が閲覧時刻で動くので、朝に見るか夜に見るかで
// 同じ記事が別の棒に入る。「日別トレンド」を名乗る図としては誤り。
// round 50 で「人が見る日付はローカル暦日」という方針を決めたので、それに揃える。

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

const DAY = 24 * 60 * 60 * 1000;
const localDateKey = (d = new Date()) => {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

// The old behaviour, kept to demonstrate the difference.
function bucketByElapsed(events, now) {
  const week = Array(7).fill(0);
  for (const ev of events) {
    const days = Math.floor((now - ev.timestamp) / DAY);
    if (days >= 0 && days < 7) week[6 - days]++;
  }
  return week;
}
// Mirrors the new implementation in index.html.
function bucketByCalendarDay(events, nowDate) {
  const week = Array(7).fill(0);
  const dayIndex = new Map();
  for (let i = 0; i < 7; i++) {
    const d = new Date(nowDate.getTime());
    d.setDate(d.getDate() - i);
    dayIndex.set(localDateKey(d), 6 - i);
  }
  for (const ev of events) {
    const slot = dayIndex.get(localDateKey(new Date(ev.timestamp)));
    if (slot !== undefined) week[slot]++;
  }
  return week;
}

// Monday 2026-08-17 10:00 local.
const NOW = new Date(2026, 7, 17, 10, 0);
const at = (...a) => new Date(...a).getTime();

describe('week trend — calendar-day bucketing', () => {
  it('counts an item from late last night as YESTERDAY, not today', () => {
    // The exact case the old code got wrong.
    const events = [{ timestamp: at(2026, 7, 16, 23, 0) }]; // Sunday 23:00
    expect(bucketByElapsed(events, NOW.getTime())[6]).toBe(1);      // old: "today"
    const week = bucketByCalendarDay(events, NOW);
    expect(week[6], 'today').toBe(0);
    expect(week[5], 'yesterday').toBe(1);
  });

  it('counts this morning as today', () => {
    const week = bucketByCalendarDay([{ timestamp: at(2026, 7, 17, 9, 0) }], NOW);
    expect(week[6]).toBe(1);
  });

  it('places each of the last 7 days in its own slot', () => {
    const events = [];
    for (let i = 0; i < 7; i++) events.push({ timestamp: at(2026, 7, 17 - i, 12, 0) });
    expect(bucketByCalendarDay(events, NOW)).toEqual([1, 1, 1, 1, 1, 1, 1]);
  });

  it('ignores anything older than the 7-day window', () => {
    const events = [{ timestamp: at(2026, 7, 10, 12, 0) }, { timestamp: at(2026, 6, 1, 12, 0) }];
    expect(bucketByCalendarDay(events, NOW).reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('ignores future-dated items rather than miscounting them', () => {
    expect(bucketByCalendarDay([{ timestamp: at(2026, 7, 20, 12, 0) }], NOW)
      .reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('is stable across the viewing hour (the old buckets shifted with the clock)', () => {
    const ev = [{ timestamp: at(2026, 7, 16, 23, 0) }]; // Sunday 23:00
    // Both viewing times are the SAME calendar day (Monday), so the chart must not change.
    // 22:00 and 23:30 straddle the old scheme's rolling 24h boundary for a Sunday-23:00 item.
    const early = bucketByCalendarDay(ev, new Date(2026, 7, 17, 22, 0));
    const late = bucketByCalendarDay(ev, new Date(2026, 7, 17, 23, 30));
    expect(early).toEqual(late);
    // The old scheme did NOT have this property: the same item moves buckets within one day.
    const oldEarly = bucketByElapsed(ev, at(2026, 7, 17, 22, 0));   // elapsed 23h -> "today"
    const oldLate = bucketByElapsed(ev, at(2026, 7, 17, 23, 30));   // elapsed 24.5h -> "1d ago"
    expect(oldEarly).not.toEqual(oldLate);
  });

  it('handles a month boundary', () => {
    const now = new Date(2026, 8, 2, 10, 0);          // 2026-09-02
    const events = [{ timestamp: at(2026, 7, 31, 12, 0) }]; // 2026-08-31 = 2 days earlier
    expect(bucketByCalendarDay(events, now)[4]).toBe(1);
  });

  it('handles a year boundary', () => {
    const now = new Date(2027, 0, 2, 10, 0);                 // 2027-01-02
    const events = [{ timestamp: at(2026, 11, 31, 12, 0) }]; // 2026-12-31 = TWO days earlier
    expect(bucketByCalendarDay(events, now)[4]).toBe(1);
  });
});

describe('wiring (index.html)', () => {
  it('builds a calendar-day index rather than dividing elapsed time', () => {
    expect(html).toContain('const dayIndex=new Map();');
    expect(html).toContain('for(let i=0;i<7;i++){const d=new Date();d.setDate(d.getDate()-i);dayIndex.set(localDateKey(d),6-i);}');
    expect(html).toContain('const slot=dayIndex.get(localDateKey(new Date(ev.timestamp)));');
  });
  it('the elapsed-24h computation is gone', () => {
    expect(html).not.toContain('const days=Math.floor((Date.now()-ev.timestamp)/(24*60*60*1000));');
  });
  it('reuses the round-50 local-day helper instead of a second date scheme', () => {
    expect(html).toContain('function localDateKey(d=new Date()){');
  });
});
