// Neus — 「その人の1日」を UTC ではなくローカル日付で決める (round 50)
//
// 発見: カレンダー日付を作る箇所が軒並み `new Date().toISOString().slice(0,10)` を使っていた。
// これは **UTC 基準**なので、UTC+9(本製品の主要利用者)では 00:00-09:00 の間ずっと
// **前日の日付**になる。人間向けの日付グルーピングに使うと実害が出る:
//
//   1. **Obsidian Daily Note**(`appendDaily`)— 最も深刻。
//      朝8時に書き出したノートが**前日のデイリーノート**に紛れ込む。Daily Note は日付で辿る
//      前提の仕組みなので、本製品の看板連携が静かに誤ファイリングする。
//   2. **BYOK の1日あたり予算** — 予算が現地 09:00 にリセットされる。利用者の「1日」と
//      一致せず、しかも**自腹の API 課金**に関わる。
//   3. 書き出しファイル名(`neus-backup-YYYY-MM-DD.json` 等)— 軽微だが同じ取り違え。
//
// 一方、**機械可読タイムスタンプは UTC のままが正しい**。YAML frontmatter の
// `published_at` / `ingested_at` は `isoDate()`(完全な ISO 文字列)を使い続ける —
// タイムゾーンを持たない日付にすると、他ツールが読んだときに曖昧になるため。
// つまり「人が見る日付はローカル、機械が読む時刻は UTC」で使い分ける。

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// Mirrors localDateKey in index.html.
function localDateKey(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const utcKey = d => d.toISOString().slice(0, 10);

describe('localDateKey — uses the local calendar day', () => {
  it('matches the local date components, not UTC', () => {
    const d = new Date(2026, 0, 15, 8, 30); // 2026-01-15 08:30 local, whatever the zone
    expect(localDateKey(d)).toBe('2026-01-15');
  });

  it('zero-pads month and day', () => {
    expect(localDateKey(new Date(2026, 2, 5))).toBe('2026-03-05');
    expect(localDateKey(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  it('rolls over at local midnight, not UTC midnight', () => {
    const lateNight = new Date(2026, 5, 10, 23, 59);
    const justAfter = new Date(2026, 5, 11, 0, 1);
    expect(localDateKey(lateNight)).toBe('2026-06-10');
    expect(localDateKey(justAfter)).toBe('2026-06-11');
  });

  it('demonstrates the original bug whenever the runner is not on UTC', () => {
    // In a UTC+9 zone, 08:00 local is still the previous day in UTC. This assertion adapts:
    // where the offsets differ it proves the divergence, and on UTC it is a no-op equality.
    const morning = new Date(2026, 3, 20, 8, 0);
    if (morning.getTimezoneOffset() !== 0) {
      // At least one instant in the day must disagree between the two representations.
      const candidates = [0, 1, 8, 12, 20, 23].map(h => new Date(2026, 3, 20, h, 0));
      const anyDiffer = candidates.some(d => localDateKey(d) !== utcKey(d));
      expect(anyDiffer, 'local and UTC day keys should diverge off-UTC').toBe(true);
    } else {
      expect(localDateKey(morning)).toBe(utcKey(morning));
    }
  });

  it('is stable across a full day of local hours', () => {
    const keys = new Set();
    for (let h = 0; h < 24; h++) keys.add(localDateKey(new Date(2026, 7, 3, h, 0)));
    expect([...keys]).toEqual(['2026-08-03']); // one local day = exactly one key
  });
});

describe('wiring — human-facing dates are local, machine timestamps stay UTC', () => {
  it('defines the helper', () => {
    expect(html).toContain('function localDateKey(d=new Date()){');
  });

  it('the Obsidian daily note uses the local day', () => {
    expect(html).toContain('async function appendDaily(root,lines){\n    const date=localDateKey();');
  });

  it('the BYOK daily budget uses the local day in every place it is derived', () => {
    expect(html).toContain('let dailyCount=0;let dailyKey=localDateKey();let loaded=false;');
    expect(html).toContain('const today=localDateKey();if(b&&b.key===today)');
    expect(html).toContain('async function resetIfNewDay(){const today=localDateKey();');
  });

  it('export filenames use the local day', () => {
    for (const f of ['neus-words-${localDateKey()}.md', 'neus-sources-${localDateKey()}.opml',
                     'neus-backup-${localDateKey()}.json']) {
      expect(html).toContain(f);
    }
  });

  it('no human-facing date is still derived from toISOString().slice(0,10)', () => {
    // Only the explanatory comment may mention the old form.
    const codeLines = html.split('\n').filter(l => !l.trim().startsWith('//'));
    const offenders = codeLines.filter(l => l.includes('toISOString().slice(0,10)'));
    expect(offenders, `still UTC-derived:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('machine-readable frontmatter timestamps deliberately REMAIN full UTC ISO', () => {
    // Changing these to a local date would make them ambiguous to other tools reading the
    // Vault, so isoDate must survive this refactor.
    expect(html).toContain('const isoDate=(ms)=>new Date(ms).toISOString();');
    expect(html).toContain('`ingested_at: ${isoDate(ev.timestamp)}`');
  });
});
