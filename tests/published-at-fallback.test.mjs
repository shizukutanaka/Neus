// Neus — publishedAt date-fallback convention (SPEC.md §6.4)
//
// Convention: when a feed item provides no date, parseFeed leaves
// event.publishedAt === undefined (it does NOT fabricate a timestamp, so the
// "no date" signal is preserved). Every consumer that sorts or displays a date
// must fall back with `publishedAt || timestamp`. These tests pin both halves of
// the contract so a future change can't silently break ordering or lose the signal.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// Mirror of parseFeed's date extraction (the only place publishedAt is derived).
const parseDate = (pubDate) => (pubDate ? Date.parse(pubDate) || undefined : undefined);

describe('publishedAt derivation (mirrors parseFeed)', () => {
  it('is a real epoch when the feed provides a parseable date', () => {
    const ts = parseDate('Wed, 21 Oct 2025 07:28:00 GMT');
    expect(typeof ts).toBe('number');
    expect(ts).toBe(Date.parse('Wed, 21 Oct 2025 07:28:00 GMT'));
  });
  it('is undefined when the feed provides no date (signal preserved, not fabricated)', () => {
    expect(parseDate('')).toBeUndefined();
    expect(parseDate(undefined)).toBeUndefined();
  });
  it('is undefined when the date string is unparseable', () => {
    expect(parseDate('not-a-date')).toBeUndefined();
  });
});

describe('date-fallback at sort/display (mirrors consumers)', () => {
  const key = (ev) => ev.publishedAt || ev.timestamp;
  it('falls back to ingest timestamp when publishedAt is undefined', () => {
    const ev = { publishedAt: undefined, timestamp: 1000 };
    expect(key(ev)).toBe(1000);
  });
  it('orders a dated item ahead of an undated one by ingest time, not NaN', () => {
    const dated = { publishedAt: 5000, timestamp: 100 };
    const undated = { publishedAt: undefined, timestamp: 3000 };
    const sorted = [undated, dated].sort((a, b) => key(b) - key(a));
    expect(sorted[0]).toBe(dated);     // 5000 > 3000
    // and the undated item still sorts by a real number, never NaN
    expect(Number.isNaN(key(undated))).toBe(false);
  });
});

describe('source invariants (index.html)', () => {
  it('parseFeed leaves publishedAt undefined for date-less items (no fabrication)', () => {
    expect(html).toContain('publishedAt:pubDate?Date.parse(pubDate)||undefined:undefined');
  });
  it('never assigns publishedAt = timestamp at parse time', () => {
    expect(html).not.toMatch(/publishedAt:\s*(Date\.now\(\)|raw\.timestamp|timestamp)\b/);
  });
  it('every sort comparator guards publishedAt with ||timestamp', () => {
    // There must be no bare `.publishedAt-` / `.publishedAt -` subtraction in a sort.
    const sorts = [...html.matchAll(/sort\(\([^)]*\)=>\([^)]*publishedAt[^)]*\)/g)].map(m => m[0]);
    expect(sorts.length).toBeGreaterThan(0);
    for (const s of sorts) {
      expect(s).toContain('publishedAt||');
    }
  });
});
