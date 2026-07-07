// Neus — event.normalized hash-race serialization (found via a ShareTarget/pipeline audit)
//
// Store.findByHash -> Store.putEvent is a check-then-act pair, not an atomic transaction.
// Bus.publish is fire-and-forget (does not await subscriber handlers), and _collectOne fetches
// all enabled feeds for a word in parallel via Promise.all — so if the same article surfaces
// from two different sources (e.g. Google News and Hatena both index it), two concurrent
// event.normalized invocations for the same hash can both read "not found" via findByHash
// before either commits, creating a duplicate record. The hash index is intentionally
// unique:false (a unique index would risk failing to build during IDB upgrade on installs
// that already have historical duplicate hashes from this exact bug — a v0.2.0-era production
// risk more dangerous than the race itself). Instead, in-flight processing per hash is
// serialized via an in-memory Promise gate: a second concurrent call for the same hash awaits
// the first's completion, then re-evaluates findByHash — which now correctly resolves to the
// "existing" branch and merges autoTags, exactly as it would for a non-concurrent duplicate.

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// Mirrors the in-flight gate mechanism added around the event.normalized handler body.
function makeGate() {
  const inFlightHash = new Map();
  return async function withGate(hash, work) {
    const prior = inFlightHash.get(hash);
    if (prior) await prior.catch(() => {});
    let settle;
    const gate = new Promise(r => (settle = r));
    inFlightHash.set(hash, gate);
    try {
      return await work();
    } finally {
      if (inFlightHash.get(hash) === gate) inFlightHash.delete(hash);
      settle();
    }
  };
}

describe('in-flight hash gate (modeled)', () => {
  it('serializes two concurrent calls for the same hash — the second sees the first\'s effect', async () => {
    const withGate = makeGate();
    const store = new Map(); // stand-in for Store: hash -> committed record
    let commitOrder = [];
    async function process(hash, tag) {
      return withGate(hash, async () => {
        const existing = store.get(hash); // mirrors Store.findByHash
        if (existing) { existing.tags.push(tag); commitOrder.push(`merged:${tag}`); return; }
        // simulate async I/O latency between check and write, this is exactly where the race lived
        await new Promise(r => setTimeout(r, 5));
        store.set(hash, { tags: [tag] });
        commitOrder.push(`created:${tag}`);
      });
    }
    // Fire both "concurrently" (no await between them), exactly like two Bus.publish calls in a loop.
    const p1 = process('h1', 'word:a');
    const p2 = process('h1', 'word:b');
    await Promise.all([p1, p2]);
    expect(store.size).toBe(1); // no duplicate record for the same hash
    expect(store.get('h1').tags.sort()).toEqual(['word:a', 'word:b']); // both tags preserved
    expect(commitOrder[0]).toBe('created:word:a');
    expect(commitOrder[1]).toBe('merged:word:b'); // second call correctly took the merge path
  });
  it('does not serialize calls for different hashes (no unnecessary blocking)', async () => {
    const withGate = makeGate();
    const order = [];
    await Promise.all([
      withGate('h1', async () => { await new Promise(r => setTimeout(r, 10)); order.push('h1'); }),
      withGate('h2', async () => { order.push('h2'); }), // unrelated hash finishes first, unblocked
    ]);
    expect(order).toEqual(['h2', 'h1']);
  });
  it('a rejected first call does not block or poison the second (caught, second proceeds fresh)', async () => {
    const withGate = makeGate();
    const results = [];
    const p1 = withGate('h1', async () => { throw new Error('boom'); }).catch(e => results.push(e.message));
    const p2 = withGate('h1', async () => { results.push('second ran'); });
    await Promise.all([p1, p2]);
    expect(results).toContain('boom');
    expect(results).toContain('second ran');
  });
  it('cleans up the gate entry after completion (no unbounded memory growth)', async () => {
    const inFlightHash = new Map();
    const withGate = (() => {
      return async function (hash, work) {
        const prior = inFlightHash.get(hash);
        if (prior) await prior.catch(() => {});
        let settle;
        const gate = new Promise(r => (settle = r));
        inFlightHash.set(hash, gate);
        try { return await work(); }
        finally { if (inFlightHash.get(hash) === gate) inFlightHash.delete(hash); settle(); }
      };
    })();
    await withGate('h1', async () => {});
    expect(inFlightHash.size).toBe(0);
  });
});

describe('hash-race guard wiring (index.html)', () => {
  it('declares an in-flight hash map serializing event.normalized processing', () => {
    expect(html).toContain('const inFlightHash=new Map();');
  });
  it('awaits any prior in-flight processing for the same hash before proceeding', () => {
    expect(html).toContain('const prior=inFlightHash.get(ev.hash);');
    expect(html).toContain('if(prior)await prior.catch(()=>{});');
  });
  it('registers a gate promise before findByHash, so a concurrent call sees it', () => {
    expect(html).toMatch(/inFlightHash\.set\(ev\.hash,gate\);\s*try\{\s*const existing=await Store\.findByHash\(ev\.hash\);/);
  });
  it('cleans up the gate and settles it in a finally block (runs on every exit path, including early returns)', () => {
    expect(html).toContain('finally{if(inFlightHash.get(ev.hash)===gate)inFlightHash.delete(ev.hash);settle();}');
  });
  it('keeps the hash index unique:false (a unique constraint risks failing IDB upgrade on installs with pre-existing duplicate hashes)', () => {
    expect(html).toContain("os.createIndex('hash','hash',{unique:false});");
  });
});
