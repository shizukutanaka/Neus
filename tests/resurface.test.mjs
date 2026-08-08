// Neus — RESURFACE view (round 32, first-principles gap: 段階6「想起」)
//
// 第一原理の分析で見つかった構造的な穴: 集めた情報は「能動的に検索した時」しか再会できないが、
// 人は「何を忘れたか」を検索できない(想起の逆説)。結果 LATER は入れたきり戻らない箱になる。
// PIM 研究でも「保存した時点で意識から消え再訪の動機が無い」ことが報告されている。
//
// スコア設計の根拠: 素朴な「古い順」は誤り。spacing effect の研究(Cepeda et al. 2008 ほか)は
// 間隔と効果の関係が単調増加ではなく逆U字であることを示す。早すぎる再提示は無駄(massed)、
// 遅すぎる再提示は陳腐化した情報を上位に押し上げる。よって resurfaceAfterMs を下限、
// resurfacePeakMs をピークとする対数正規型の重みを使う(決定的・ゼロ依存)。

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

const DAY = 24 * 60 * 60 * 1000;
const CONFIG = { resurfaceAfterMs: 7 * DAY, resurfacePeakMs: 30 * DAY, resurfaceMax: 5 };

// Mirrors resurfaceWeight / pickResurface in index.html (stays in sync via the anchor tests below).
function resurfaceWeight(age) {
  const r = Math.log(age / CONFIG.resurfacePeakMs);
  return Math.exp(-(r * r) / (2 * 0.9 * 0.9));
}
function pickResurface(events, now = Date.now(), limit = CONFIG.resurfaceMax) {
  const out = [];
  for (const ev of events || []) {
    if (!ev || !ev.state || ev.state.archived) continue;
    const later = ev.state.later === true;
    const starredUnread = ev.state.starred === true && !ev.state.read;
    if (!later && !starredUnread) continue;
    const anchor = (later ? ev.state.laterAt : 0) || ev.timestamp;
    if (!anchor) continue;
    const age = now - anchor;
    if (age < CONFIG.resurfaceAfterMs) continue;
    out.push({ ev, age, score: resurfaceWeight(age) * (later ? 1 : 0.8) });
  }
  return out.sort((a, b) => b.score - a.score || a.ev.id.localeCompare(b.ev.id)).slice(0, limit);
}

const NOW = 1_000_000_000_000;
const mk = (id, state, timestamp = NOW - 60 * DAY) => ({ id, timestamp, state });

describe('pickResurface — selection (modeled)', () => {
  it('returns nothing for an empty or nullish list', () => {
    expect(pickResurface([], NOW)).toEqual([]);
    expect(pickResurface(null, NOW)).toEqual([]);
  });

  it('skips items younger than resurfaceAfterMs (too soon = massed, no value)', () => {
    const fresh = mk('a', { later: true, laterAt: NOW - 2 * DAY });
    expect(pickResurface([fresh], NOW)).toEqual([]);
  });

  it('picks a neglected read-later item once past the threshold', () => {
    const old = mk('a', { later: true, laterAt: NOW - 30 * DAY });
    const picked = pickResurface([old], NOW);
    expect(picked).toHaveLength(1);
    expect(picked[0].ev.id).toBe('a');
  });

  it('picks starred-but-unread items too', () => {
    const ev = mk('s', { starred: true, read: false }, NOW - 30 * DAY);
    expect(pickResurface([ev], NOW).map(p => p.ev.id)).toEqual(['s']);
  });

  it('excludes archived items even when otherwise eligible', () => {
    const ev = mk('x', { later: true, laterAt: NOW - 30 * DAY, archived: true });
    expect(pickResurface([ev], NOW)).toEqual([]);
  });

  it('excludes starred items that were already read', () => {
    const ev = mk('r', { starred: true, read: true }, NOW - 30 * DAY);
    expect(pickResurface([ev], NOW)).toEqual([]);
  });

  it('ignores ordinary items (neither later nor starred-unread)', () => {
    const ev = mk('n', { read: false }, NOW - 90 * DAY);
    expect(pickResurface([ev], NOW)).toEqual([]);
  });

  it('respects the result limit', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      mk('e' + i, { later: true, laterAt: NOW - (30 + i) * DAY }));
    expect(pickResurface(many, NOW)).toHaveLength(CONFIG.resurfaceMax);
    expect(pickResurface(many, NOW, 3)).toHaveLength(3);
  });

  it('falls back to timestamp when laterAt is missing (restored/legacy data)', () => {
    const ev = mk('legacy', { later: true }, NOW - 30 * DAY); // no laterAt
    expect(pickResurface([ev], NOW).map(p => p.ev.id)).toEqual(['legacy']);
  });
});

describe('pickResurface — inverted-U weighting (the spacing-effect correction)', () => {
  it('scores an item at the peak interval higher than a much older one', () => {
    // The naive "oldest first" ordering would invert this. Cepeda et al.: the interval/benefit
    // relation is an inverted U, so a 2-year-old item is NOT the most valuable to resurface.
    const atPeak = mk('peak', { later: true, laterAt: NOW - 30 * DAY });
    const ancient = mk('ancient', { later: true, laterAt: NOW - 730 * DAY });
    const picked = pickResurface([ancient, atPeak], NOW);
    expect(picked[0].ev.id).toBe('peak');
  });

  it('scores an item at the peak higher than one barely past the threshold', () => {
    const atPeak = mk('peak', { later: true, laterAt: NOW - 30 * DAY });
    const barely = mk('barely', { later: true, laterAt: NOW - 8 * DAY });
    expect(pickResurface([barely, atPeak], NOW)[0].ev.id).toBe('peak');
  });

  it('weight is maximal exactly at the peak and symmetric in log-time', () => {
    expect(resurfaceWeight(CONFIG.resurfacePeakMs)).toBeCloseTo(1, 10);
    // Equal log-distance on either side of the peak yields equal weight.
    expect(resurfaceWeight(CONFIG.resurfacePeakMs / 3))
      .toBeCloseTo(resurfaceWeight(CONFIG.resurfacePeakMs * 3), 10);
  });

  it('prefers an explicit read-later over a merely starred item at the same age', () => {
    const later = mk('later', { later: true, laterAt: NOW - 30 * DAY });
    const starred = mk('starred', { starred: true, read: false }, NOW - 30 * DAY);
    expect(pickResurface([starred, later], NOW)[0].ev.id).toBe('later');
  });

  it('is deterministic — same input yields the same order (id tiebreak, no randomness)', () => {
    const evs = [
      mk('b', { later: true, laterAt: NOW - 30 * DAY }),
      mk('a', { later: true, laterAt: NOW - 30 * DAY }),
      mk('c', { later: true, laterAt: NOW - 30 * DAY }),
    ];
    const first = pickResurface(evs, NOW).map(p => p.ev.id);
    expect(first).toEqual(['a', 'b', 'c']);
    expect(pickResurface(evs, NOW).map(p => p.ev.id)).toEqual(first);
  });
});

describe('RESURFACE wiring (index.html)', () => {
  it('declares the tuning constants in CONFIG', () => {
    expect(html).toContain('resurfaceAfterMs:7*24*60*60*1000, resurfacePeakMs:30*24*60*60*1000, resurfaceMax:5,');
  });
  it('implements the inverted-U weight (not a monotonic oldest-first sort)', () => {
    expect(html).toContain('function resurfaceWeight(age){');
    expect(html).toContain('const r=Math.log(age/CONFIG.resurfacePeakMs);');
    expect(html).toContain('return Math.exp(-(r*r)/(2*0.9*0.9));');
  });
  it('derives selection from existing state only (no new persisted field)', () => {
    expect(html).toContain('function pickResurface(events,now=Date.now(),limit=CONFIG.resurfaceMax){');
    expect(html).toContain('const anchor=(later?ev.state.laterAt:0)||ev.timestamp;');
    expect(html).toContain('if(age<CONFIG.resurfaceAfterMs)continue;');
    // Must not introduce a new stored field on the event (data-model gate).
    expect(html).not.toContain('state.resurfacedAt');
    expect(html).not.toContain('ev.state.resurface');
  });
  it('sorts deterministically with an id tiebreak', () => {
    expect(html).toContain('a.ev.id.localeCompare(b.ev.id)');
  });
  it('renders through the existing view pipeline and card renderer', () => {
    expect(html).toContain("if(currentView==='resurface'){");
    expect(html).toContain('const picked=pickResurface(await Store.allEvents());');
    expect(html).toContain("picked.map(({ev})=>cardHtml(ev)).join('')");
  });
  it('exposes a nav tab with the required a11y attributes', () => {
    expect(html).toContain('<button data-view="resurface" id="nav-resurface" role="tab" aria-selected="false">RESURFACE</button>');
  });
  it('has bilingual DICT entries for the view copy', () => {
    for (const key of ['nav.resurface', 'resurface.hint', 'resurface.empty']) {
      const count = (html.match(new RegExp(`'${key.replace('.', '\\.')}':`, 'g')) || []).length;
      expect(count, `${key} should be declared in both ja and en`).toBe(2);
    }
  });
});
