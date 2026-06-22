// Neus — SourceFailTracker auto-disable regression tests
// A source is auto-disabled after CONFIG.sourceMaxFails CONSECUTIVE failures.
// The bug: the counter was reset only by inbound.fetched (items published), so a
// healthy fetch that yields no new items (304 Not Modified, or an empty feed)
// did NOT reset it. A rarely-updating feed + occasional network blips would
// accumulate non-consecutive fails and eventually disable a working source.
// Fix: every healthy fetch (304/empty/with-items) publishes source.ok, which
// resets the counter — restoring consecutive-failure semantics.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

const MAX = 5; // CONFIG.sourceMaxFails

// Model of the tracker: error increments, ok resets, threshold disables once.
function makeTracker(max = MAX) {
  const fails = new Map();
  const disabled = new Set();
  return {
    onError(id) {
      const n = (fails.get(id) || 0) + 1;
      fails.set(id, n);
      if (n >= max) { disabled.add(id); fails.delete(id); }
    },
    onOk(id) { fails.delete(id); },
    isDisabled: (id) => disabled.has(id),
    count: (id) => fails.get(id) || 0,
  };
}

describe('SourceFailTracker (modeled)', () => {
  it('disables after exactly MAX consecutive failures', () => {
    const t = makeTracker();
    for (let i = 0; i < MAX - 1; i++) t.onError('s');
    expect(t.isDisabled('s')).toBe(false);
    t.onError('s');
    expect(t.isDisabled('s')).toBe(true);
  });
  it('a healthy fetch (source.ok) resets the counter, preventing disable', () => {
    const t = makeTracker();
    t.onError('s'); t.onError('s'); t.onError('s'); // 3 fails
    t.onOk('s');                                     // 304 / empty / items -> reset
    t.onError('s'); t.onError('s');                  // 2 more
    expect(t.isDisabled('s')).toBe(false);           // never 5 in a row
    expect(t.count('s')).toBe(2);
  });
  it('REGRESSION: non-consecutive fails interleaved with ok never disable', () => {
    const t = makeTracker();
    for (let i = 0; i < 10; i++) { t.onError('s'); t.onOk('s'); } // fail, 304, fail, 304...
    expect(t.isDisabled('s')).toBe(false);
  });
  it('tracks sources independently', () => {
    const t = makeTracker();
    for (let i = 0; i < MAX; i++) t.onError('a');
    expect(t.isDisabled('a')).toBe(true);
    expect(t.isDisabled('b')).toBe(false);
  });
});

describe('SourceFailTracker wiring (index.html)', () => {
  it('resets the fail counter on source.ok (not only on inbound.fetched)', () => {
    expect(html).toContain("Bus.subscribe('source.ok',({source})=>{fails.delete(source.id);});");
    expect(html).not.toContain("Bus.subscribe('inbound.fetched',({source})=>{fails.delete(source.id);});");
  });
  it('fetchOne signals source.ok on a 304 Not Modified', () => {
    expect(html).toContain("if(res.status===304){Bus.publish('source.ok',{source});return 0;}");
  });
  it('fetchOne signals source.ok on any 2xx (even a 0-item feed)', () => {
    // published right after the !res.ok guard, before parsing — so an empty feed still resets
    expect(html).toContain("if(!res.ok){Bus.publish('inbound.error',{source,error:`http_${res.status}`});return 0;}\n    // 2xx 応答 = ソース健全(0件でも)。失敗カウンタをリセット。\n    Bus.publish('source.ok',{source});");
  });
  it('still increments on real failures (network / http_ / parse)', () => {
    expect(html).toContain("Bus.publish('inbound.error',{source,error:'network'});return 0;");
    expect(html).toContain("Bus.publish('inbound.error',{source,error:`http_${res.status}`});return 0;");
    expect(html).toContain("Bus.publish('inbound.error',{source,error:'parse'});return 0;");
  });
  it('excludes synthetic word: sources from auto-disable', () => {
    expect(html).toContain("if(typeof source.id==='string'&&source.id.startsWith('word:'))return;");
  });
});
