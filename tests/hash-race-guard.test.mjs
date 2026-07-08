// Neus — event.normalized hash-race serialization (found via a ShareTarget/pipeline audit,
// then corrected via an independent adversarial code review of the original fix)
//
// Store.findByHash -> Store.putEvent is a non-atomic check-then-act pair. Bus.publish is
// fire-and-forget (does not await subscriber handlers), and _collectOne fetches all enabled
// feeds for a word in parallel via Promise.all — so when the same article surfaces from two
// different sources in one collection round, two concurrent event.normalized invocations for
// the same hash can both read "not found" via findByHash before either commits, creating a
// duplicate record. The hash index is intentionally unique:false (a unique constraint would
// risk failing to build during an IDB upgrade on any install that already has historical
// duplicate hashes from this exact bug — a worse risk than the race itself).
//
// The FIRST version of this fix used a "read prior, await it, then set my own gate" pattern:
//   const prior=inFlightHash.get(hash); if(prior)await prior.catch(()=>{});
//   let settle;const gate=new Promise(r=>settle=r); inFlightHash.set(hash,gate);
// An independent review found this only serializes 2-way contention: with 3+ concurrent
// calls for the same hash, the 2nd and 3rd both read the SAME "prior" (the 1st's gate) before
// either registers its own gate, so the 2nd's registration can be silently overwritten by the
// 3rd before the 2nd's work even starts — reproducing the exact race for 3-way contention.
//
// This version fixes it with the standard keyed-promise-chain pattern: the map is written
// SYNCHRONOUSLY (no await gap) via `.then(fn,fn)` immediately after reading the current chain,
// so any number of concurrent arrivals correctly chain in strict FIFO order. It's also
// generalized into a shared `withHashGate` helper used by every findByHash->putEvent call site
// (event.normalized, ShareTarget.ingest, and the dossier-import loop) instead of protecting
// only the one call site that had a bug report — so a future ingestion path doesn't silently
// reintroduce this bug class by not knowing to opt into an ad hoc, single-site guard.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// Mirrors the withHashGate helper in index.html.
function makeGate() {
  const hashGates = new Map();
  return function withHashGate(hash, fn) {
    const chained = (hashGates.get(hash) || Promise.resolve()).then(fn, fn);
    hashGates.set(hash, chained);
    chained.catch(() => {}).finally(() => { if (hashGates.get(hash) === chained) hashGates.delete(hash); });
    return chained;
  };
}

describe('withHashGate (modeled)', () => {
  it('serializes two concurrent calls for the same hash — the second sees the first\'s effect', async () => {
    const withHashGate = makeGate();
    const store = new Map();
    const commitOrder = [];
    async function process(hash, tag) {
      return withHashGate(hash, async () => {
        const existing = store.get(hash);
        if (existing) { existing.tags.push(tag); commitOrder.push(`merged:${tag}`); return; }
        await new Promise(r => setTimeout(r, 5));
        store.set(hash, { tags: [tag] });
        commitOrder.push(`created:${tag}`);
      });
    }
    await Promise.all([process('h1', 'word:a'), process('h1', 'word:b')]);
    expect(store.size).toBe(1);
    expect(store.get('h1').tags.sort()).toEqual(['word:a', 'word:b']);
    expect(commitOrder).toEqual(['created:word:a', 'merged:word:b']);
  });

  it('serializes THREE-way concurrent calls for the same hash (the case the original gate got wrong)', async () => {
    const withHashGate = makeGate();
    const store = new Map();
    const commitOrder = [];
    async function process(hash, tag) {
      return withHashGate(hash, async () => {
        const existing = store.get(hash);
        if (existing) { existing.tags.push(tag); commitOrder.push(`merged:${tag}`); return; }
        await new Promise(r => setTimeout(r, 5));
        store.set(hash, { tags: [tag] });
        commitOrder.push(`created:${tag}`);
      });
    }
    // All three fired without awaiting between them — the exact shape of the original bug.
    await Promise.all([process('h1', 'a'), process('h1', 'b'), process('h1', 'c')]);
    expect(store.size).toBe(1); // still exactly one record, not two or three
    expect(store.get('h1').tags.sort()).toEqual(['a', 'b', 'c']); // all three merged in
    expect(commitOrder[0]).toBe('created:a');
    expect(commitOrder.slice(1).sort()).toEqual(['merged:b', 'merged:c']);
  });

  it('serializes FIVE-way concurrent calls (generalizes to arbitrary N, not just 2 or 3)', async () => {
    const withHashGate = makeGate();
    const store = new Map();
    async function process(hash, tag) {
      return withHashGate(hash, async () => {
        const existing = store.get(hash);
        if (existing) { existing.tags.push(tag); return; }
        await new Promise(r => setTimeout(r, Math.random() * 5));
        store.set(hash, { tags: [tag] });
      });
    }
    await Promise.all(['a', 'b', 'c', 'd', 'e'].map(tag => process('h1', tag)));
    expect(store.size).toBe(1);
    expect(store.get('h1').tags.sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('does not serialize calls for different hashes (no unnecessary blocking)', async () => {
    const withHashGate = makeGate();
    const order = [];
    await Promise.all([
      withHashGate('h1', async () => { await new Promise(r => setTimeout(r, 10)); order.push('h1'); }),
      withHashGate('h2', async () => { order.push('h2'); }),
    ]);
    expect(order).toEqual(['h2', 'h1']);
  });

  it('a rejected call does not poison or block subsequent calls for the same hash', async () => {
    const withHashGate = makeGate();
    const results = [];
    const p1 = withHashGate('h1', async () => { throw new Error('boom'); }).catch(e => results.push(e.message));
    const p2 = withHashGate('h1', async () => { results.push('second ran'); });
    await Promise.all([p1, p2]);
    expect(results).toContain('boom');
    expect(results).toContain('second ran');
  });

  it('cleans up the map entry after the chain settles (no unbounded memory growth)', async () => {
    const hashGates = new Map();
    const withHashGate = (hash, fn) => {
      const chained = (hashGates.get(hash) || Promise.resolve()).then(fn, fn);
      hashGates.set(hash, chained);
      chained.catch(() => {}).finally(() => { if (hashGates.get(hash) === chained) hashGates.delete(hash); });
      return chained;
    };
    await withHashGate('h1', async () => {});
    await new Promise(r => setTimeout(r, 0)); // let the .finally() side-chain's cleanup run
    expect(hashGates.size).toBe(0);
  });

  it('does not delete a newer entry that already overwrote this one in the map', async () => {
    // If call B finishes before call C's chain replaces the map entry, B's cleanup must not
    // delete C's (still in-flight) entry — verified by the identity check on the stored chain.
    // The .finally() cleanup is a side-chain attached to (not replacing) the returned promise,
    // so it resolves a microtask or two after the awaited promise itself — flush with a
    // zero-delay setTimeout (a real event-loop turn, not just a microtask) before asserting.
    const flush = () => new Promise(r => setTimeout(r, 0));
    const hashGates = new Map();
    const withHashGate = (hash, fn) => {
      const chained = (hashGates.get(hash) || Promise.resolve()).then(fn, fn);
      hashGates.set(hash, chained);
      chained.catch(() => {}).finally(() => { if (hashGates.get(hash) === chained) hashGates.delete(hash); });
      return chained;
    };
    const pB = withHashGate('h1', async () => 'b');
    const pC = withHashGate('h1', async () => { await new Promise(r => setTimeout(r, 20)); return 'c'; });
    await pB;
    await flush();
    expect(hashGates.has('h1')).toBe(true); // C's entry must still be present
    await pC;
    await flush();
    expect(hashGates.has('h1')).toBe(false); // now cleaned up
  });
});

describe('withHashGate wiring (index.html)', () => {
  it('declares a shared hashGates map and withHashGate helper', () => {
    expect(html).toContain('const hashGates=new Map();');
    expect(html).toContain('function withHashGate(hash,fn){');
  });
  it('writes to the map synchronously via .then(fn,fn) before any await (the fix for 3-way+ contention)', () => {
    expect(html).toContain('const chained=(hashGates.get(hash)||Promise.resolve()).then(fn,fn);');
    expect(html).toContain('hashGates.set(hash,chained);');
  });
  it('cleans up only its own entry (identity check, not a blind delete)', () => {
    expect(html).toContain('if(hashGates.get(hash)===chained)hashGates.delete(hash);');
  });
  it('routes event.normalized through the shared gate', () => {
    expect(html).toContain("Bus.subscribe('event.normalized',(ev)=>withHashGate(ev.hash,async()=>{");
  });
  it('routes ShareTarget.ingest through the shared gate (previously unprotected)', () => {
    const start = html.indexOf('async ingest(url,title){');
    expect(start).toBeGreaterThan(-1);
    const body = html.slice(start, start + 800);
    expect(body).toContain('await withHashGate(hash,async()=>{');
  });
  it('routes the dossier-import loop through the shared gate (previously unprotected)', () => {
    expect(html).toContain('const wasImported=await withHashGate(ev.hash,async()=>{');
  });
});
