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
// round 42: a feed-declared date beyond the clock-skew tolerance is treated as UNKNOWN
// (undefined) rather than trusted, because a future date would otherwise pin the item to
// the top of DIGEST and the tag/word views permanently. See tests/published-at-skew.test.mjs.
const PUBLISHED_AT_MAX_SKEW_MS = 60 * 60 * 1000;
const sanePublishedAt = (ms) => {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return undefined;
  if (ms > Date.now() + PUBLISHED_AT_MAX_SKEW_MS) return undefined;
  return ms;
};
const parseDate = (pubDate) => (pubDate ? sanePublishedAt(Date.parse(pubDate)) : undefined);

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
    expect(html).toContain('publishedAt:pubDate?sanePublishedAt(Date.parse(pubDate)):undefined');
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

describe('Google News publisher-suffix stripping (parseFeed)', () => {
  // Mirror of the stripping logic in parseFeed's item loop.
  // Google News appends " - {publisher}" using the <source> element;
  // stripping it produces the canonical headline for cross-source dedup.
  const strip = (title, pub) => {
    if (pub && title.length > pub.length + 3 && title.endsWith(' - ' + pub)) {
      return title.slice(0, -(pub.length + 3)).trim();
    }
    return title;
  };

  it('removes the " - publisher" suffix when the <source> name matches', () => {
    expect(strip('WebGPU in 2026 - Qiita', 'Qiita')).toBe('WebGPU in 2026');
    expect(strip('機械学習の最前線 - Zenn', 'Zenn')).toBe('機械学習の最前線');
  });
  it('is a no-op when there is no <source> element', () => {
    expect(strip('Plain title', '')).toBe('Plain title');
  });
  it('is a no-op when the title does not end with " - publisher"', () => {
    expect(strip('Title - Different Pub', 'Qiita')).toBe('Title - Different Pub');
  });
  it('does not strip when the title is just " - publisher" (no content before the suffix)', () => {
    // ' - Qiita'.length (8) is NOT > 'Qiita'.length+3 (8) → guard rejects: no strip
    expect(strip(' - Qiita', 'Qiita')).toBe(' - Qiita');
    // 'ab - cd' (7) > 'cd'.length+3 (5) → guard passes: strip is correct
    expect(strip('ab - cd', 'cd')).toBe('ab');
  });
  it('handles a publisher name that appears mid-title without stripping (suffix-only match)', () => {
    expect(strip('Qiita - Dev - Qiita', 'Qiita')).toBe('Qiita - Dev');
  });
  it('is wired into parseFeed in index.html', () => {
    expect(html).toContain("const pub=item.querySelector('source')?.textContent?.trim()||''");
    expect(html).toContain("if(pub&&title.length>pub.length+3&&title.endsWith(' - '+pub))title=title.slice(0,-(pub.length+3)).trim()");
  });
  it('is scoped to Google News via source.url, not applied to every RSS/Atom feed', () => {
    // Found via an adversarial review: <source> is a generic RSS 2.0 element any aggregator
    // feed may populate, not exclusive to Google News. A custom user-added feed (#src-add)
    // whose own house style is "Title - PublisherName" would otherwise get silently truncated.
    expect(html).toContain("if(source?.url?.includes('news.google.com')){");
    // The strip logic itself must live inside that gate, not run unconditionally for every item.
    const gateIdx = html.indexOf("if(source?.url?.includes('news.google.com')){");
    const stripIdx = html.indexOf("if(pub&&title.length>pub.length+3", gateIdx);
    const gateCloseIdx = html.indexOf('\n        }', gateIdx);
    expect(stripIdx).toBeGreaterThan(gateIdx);
    expect(stripIdx).toBeLessThan(gateCloseIdx);
  });
});
