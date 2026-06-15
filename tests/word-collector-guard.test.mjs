// Neus — Watchword collector concurrency-guard tests
// Manual COLLECT, the POLL button, and periodic background sync all call
// collectAll(). Overlapping runs double-fetch every feed (dedup saves the
// data but wastes bandwidth and corrupts the count toast). A single busy
// flag serializes collection. These tests model that lock and assert the
// wiring in index.html.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// ===== Model of the busy-lock pattern used by WordCollector =====
function makeCollector(work) {
  let busy = false;
  const isBusy = () => busy;
  async function collectAll() {
    if (busy) return 0;
    busy = true;
    try { return await work(); }
    finally { busy = false; }
  }
  return { collectAll, isBusy };
}

describe('collection busy-lock (modeled)', () => {
  it('runs a single collection to completion', async () => {
    let runs = 0;
    const c = makeCollector(async () => { runs++; return 5; });
    expect(await c.collectAll()).toBe(5);
    expect(runs).toBe(1);
  });

  it('rejects an overlapping run while one is in flight', async () => {
    let resolveWork;
    const c = makeCollector(() => new Promise(r => { resolveWork = () => r(3); }));
    const first = c.collectAll();          // starts, holds the lock
    expect(c.isBusy()).toBe(true);
    const second = await c.collectAll();    // overlaps -> rejected immediately
    expect(second).toBe(0);
    resolveWork();
    expect(await first).toBe(3);
    expect(c.isBusy()).toBe(false);
  });

  it('releases the lock after the run so the next call proceeds', async () => {
    const c = makeCollector(async () => 1);
    await c.collectAll();
    expect(c.isBusy()).toBe(false);
    expect(await c.collectAll()).toBe(1);   // a fresh call works again
  });

  it('releases the lock even when the work throws', async () => {
    const c = makeCollector(async () => { throw new Error('boom'); });
    await expect(c.collectAll()).rejects.toThrow('boom');
    expect(c.isBusy()).toBe(false);
  });
});

describe('collector guard wiring (index.html)', () => {
  it('keeps a busy flag and exposes isBusy', () => {
    expect(html).toContain('let busy=false');
    expect(html).toContain('isBusy');
    expect(html).toMatch(/return\{collectOne,collectAll,fetchWiki,isBusy\}/);
  });
  it('guards both collectOne and collectAll on the busy flag', () => {
    expect(html).toContain('if(busy)return 0;');
    expect(html).toContain('finally{busy=false;}');
  });
  it('routes locked public calls through an unlocked _collectOne', () => {
    expect(html).toContain('async function _collectOne(word)');
    expect(html).toContain('await _collectOne(w)');
  });
  it('reports raw fetched count honestly (fetched, not collected)', () => {
    expect(html).toContain('word.lastFetched=total');
    expect(html).toContain('fetched ${total} item(s)');
    expect(html).not.toContain('collected ${total} item(s)');
  });
  it('shows the real stored item count in the words modal', () => {
    expect(html).toContain('const countFor=(w)=>');
    expect(html).not.toContain('w.lastCount||0');
  });
  it('makes re-examination reversible via the undo stack', () => {
    expect(html).toContain("act==='reexamine'");
    expect(html).toContain('Verdict re-opened');
    expect(html).toMatch(/UndoStack\.offer[\s\S]*w\.verdict\.status=prevStatus/);
  });
});
