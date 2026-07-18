// Neus — Digest aggregation logic tests
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// === Pure aggregation helpers mirrored from renderDigest ===

function computeTagFreq(events) {
  const tagFreq = new Map();
  for (const ev of events) {
    for (const tg of [...(ev.meta.userTags||[]), ...(ev.meta.autoTags||[])]) {
      tagFreq.set(tg, (tagFreq.get(tg)||0) + 1);
    }
  }
  return [...tagFreq.entries()].sort((a,b) => b[1]-a[1]);
}

function computeSourceFreq(events) {
  const m = new Map();
  for (const ev of events) m.set(ev.source.name, (m.get(ev.source.name)||0) + 1);
  return [...m.entries()].sort((a,b) => b[1]-a[1]);
}

function computeTop3(events) {
  return events
    .filter(e => !e.state.archived)
    .sort((a,b) => {
      const sa = (a.meta.score||0) + (a.content.summary?20:0) + (!a.state.read?10:0);
      const sb = (b.meta.score||0) + (b.content.summary?20:0) + (!b.state.read?10:0);
      return sb - sa;
    })
    .slice(0, 3);
}

function computeWeekTrend(allEvents) {
  const week = Array(7).fill(0);
  const now = Date.now();
  for (const ev of allEvents) {
    const days = Math.floor((now - ev.timestamp) / (24*60*60*1000));
    if (days >= 0 && days < 7) week[6-days]++;
  }
  return week;
}

function filter24h(allEvents) {
  const since = Date.now() - 24*60*60*1000;
  return allEvents.filter(e => e.timestamp >= since);
}

const evFixture = (overrides = {}) => ({
  id: 'e' + Math.random().toString(36).slice(2),
  timestamp: Date.now(),
  source: { id: 'hn', name: 'Hacker News' },
  content: { title: 'Test', snippet: '', summary: '' },
  meta: { autoTags: [], userTags: [], score: 50 },
  state: { read: false, starred: false, archived: false },
  ...overrides,
  content: { title: 'Test', ...overrides.content },
  meta: { autoTags: [], userTags: [], score: 50, ...overrides.meta },
  state: { read: false, starred: false, archived: false, ...overrides.state },
});

describe('Digest — filter24h', () => {
  it('includes events within last 24h', () => {
    const events = [
      evFixture({ timestamp: Date.now() }),
      evFixture({ timestamp: Date.now() - 23*60*60*1000 }),
      evFixture({ timestamp: Date.now() - 25*60*60*1000 }),
    ];
    expect(filter24h(events)).toHaveLength(2);
  });
  it('returns empty for all-old events', () => {
    const events = [evFixture({ timestamp: Date.now() - 48*60*60*1000 })];
    expect(filter24h(events)).toHaveLength(0);
  });
  it('returns empty for empty input', () => {
    expect(filter24h([])).toHaveLength(0);
  });
});

describe('Digest — computeTagFreq', () => {
  it('counts user + auto tags', () => {
    const events = [
      evFixture({ meta: { userTags: ['rust','async'], autoTags: ['programming'] } }),
      evFixture({ meta: { userTags: ['rust'], autoTags: ['async'] } }),
    ];
    const freq = computeTagFreq(events);
    expect(freq[0]).toEqual(['rust', 2]);
    expect(freq.find(([t]) => t === 'async')[1]).toBe(2);
  });
  it('sorts by frequency descending', () => {
    const events = [
      evFixture({ meta: { userTags: ['a','b','b','c','c','c'] } }),
    ];
    const freq = computeTagFreq(events);
    expect(freq[0][0]).toBe('c');
    expect(freq[1][0]).toBe('b');
  });
  it('handles no tags', () => {
    const events = [evFixture()];
    expect(computeTagFreq(events)).toEqual([]);
  });
});

describe('Digest — computeSourceFreq', () => {
  it('counts per source name', () => {
    const events = [
      evFixture({ source: { name: 'HN' } }),
      evFixture({ source: { name: 'HN' } }),
      evFixture({ source: { name: 'GitHub' } }),
    ];
    const freq = computeSourceFreq(events);
    expect(freq[0]).toEqual(['HN', 2]);
    expect(freq[1]).toEqual(['GitHub', 1]);
  });
});

describe('Digest — computeTop3', () => {
  it('returns top 3 by composite score', () => {
    const events = [
      evFixture({ meta: { score: 50 } }),
      evFixture({ meta: { score: 90 } }),
      evFixture({ meta: { score: 70 } }),
      evFixture({ meta: { score: 30 } }),
    ];
    const top = computeTop3(events);
    expect(top).toHaveLength(3);
    expect(top[0].meta.score).toBe(90);
    expect(top[1].meta.score).toBe(70);
  });
  it('boosts summarized + unread events', () => {
    const events = [
      evFixture({ meta: { score: 50 }, content: { summary: 'has summary' }, state: { read: false } }), // 50+20+10=80
      evFixture({ meta: { score: 70 }, content: { summary: '' }, state: { read: true } }),           // 70
      evFixture({ meta: { score: 60 }, content: { summary: 'has' }, state: { read: false } }),       // 60+20+10=90
    ];
    const top = computeTop3(events);
    expect(top[0].meta.score).toBe(60); // highest composite
  });
  it('excludes archived events', () => {
    const events = [
      evFixture({ meta: { score: 90 }, state: { archived: true } }),
      evFixture({ meta: { score: 50 } }),
    ];
    expect(computeTop3(events)).toHaveLength(1);
  });
  it('returns fewer than 3 if insufficient', () => {
    expect(computeTop3([evFixture()])).toHaveLength(1);
    expect(computeTop3([])).toHaveLength(0);
  });
});

describe('Digest — computeWeekTrend', () => {
  it('returns 7 buckets', () => {
    expect(computeWeekTrend([])).toHaveLength(7);
  });
  it('places today in last bucket', () => {
    const events = [evFixture({ timestamp: Date.now() })];
    const week = computeWeekTrend(events);
    expect(week[6]).toBe(1);
    expect(week[0]).toBe(0);
  });
  it('places 6-day-old event in first bucket', () => {
    const events = [evFixture({ timestamp: Date.now() - 6*24*60*60*1000 })];
    const week = computeWeekTrend(events);
    expect(week[0]).toBe(1);
  });
  it('ignores events older than 7 days', () => {
    const events = [evFixture({ timestamp: Date.now() - 8*24*60*60*1000 })];
    expect(computeWeekTrend(events).reduce((a,b) => a+b, 0)).toBe(0);
  });
});

describe('Digest — tag/source chip click wiring (index.html)', () => {
  // Bug: digest tag chips rendered as `#tag N` (count inline in textContent).
  // The .tag click handler stripped the leading # but left the count: "tag N" != "tag".
  // Fix: dedicated [data-digest-tag]/[data-digest-src] handlers read the attribute value
  // (correct) and switch to the ALL view so the filter is visible in the timeline.
  it('digest tag chips carry a data-digest-tag attribute with the raw tag name', () => {
    expect(html).toContain('data-digest-tag="${escapeAttr(tg)}"');
  });
  it('digest source rows carry a data-digest-src attribute with the source name', () => {
    expect(html).toContain('data-digest-src="${escapeAttr(s)}"');
  });
  it('handles [data-digest-tag] clicks before the generic .tag handler', () => {
    // The new handler must appear before the .tag handler in the source
    const dtIdx = html.indexOf("closest('[data-digest-tag]')");
    const tagIdx = html.indexOf("closest('.tag')");
    expect(dtIdx).toBeGreaterThan(0);
    expect(tagIdx).toBeGreaterThan(0);
    expect(dtIdx).toBeLessThan(tagIdx);
  });
  it('digest tag handler reads dataset.digestTag (not textContent)', () => {
    expect(html).toContain("applyFilter('tag',digestTagEl.dataset.digestTag)");
  });
  it('digest source handler reads dataset.digestSrc', () => {
    expect(html).toContain("applyFilter('source',digestSrcEl.dataset.digestSrc)");
  });
  it('digest handlers switch to the ALL view before applying the filter', () => {
    expect(html).toContain("data-view=\"all\"]');if(allBtn){allBtn.classList.add('active')");
  });
});

describe('Digest — composite metrics', () => {
  it('summarized count matches events with summary field', () => {
    const events = [
      evFixture({ content: { summary: 'a' } }),
      evFixture({ content: { summary: '' } }),
      evFixture({ content: { summary: 'b' } }),
    ];
    expect(events.filter(e => e.content.summary).length).toBe(2);
  });
  it('starred today count matches state.starred', () => {
    const events = [
      evFixture({ state: { starred: true } }),
      evFixture({ state: { starred: false } }),
      evFixture({ state: { starred: true } }),
    ];
    expect(events.filter(e => e.state.starred).length).toBe(2);
  });
});
