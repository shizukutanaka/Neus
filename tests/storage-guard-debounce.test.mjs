// Neus — StorageGuard per-event full scans (round 28 audit)
//
// event.stored fires once per ingested item, and a single POLL can store dozens in a burst.
// StorageGuard.check() ran once per event with no guard: N navigator.storage.estimate() calls
// plus — once over the quota threshold — N concurrent full allEvents() scans, each computing
// its own overlapping eviction candidate list and issuing overlapping deleteEvent calls
// (bounded to exported+archived data, so a perf/UX problem rather than data loss, but real).
// Fixed with a trailing-edge debounce (storageCheckDebounceMs) plus an in-flight flag that
// coalesces a burst into one deferred check, with one follow-up if more events arrived
// mid-check.

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// Mirrors the scheduleCheck debounce/coalesce mechanism in StorageGuard.
function makeGuard(checkFn, debounceMs) {
  let checkPending = false, checkRunning = false;
  function scheduleCheck() {
    if (checkRunning) { checkPending = true; return; }
    checkRunning = true;
    setTimeout(async () => {
      try { await checkFn(); }
      catch { /* swallowed like the real handler */ }
      finally { checkRunning = false; if (checkPending) { checkPending = false; scheduleCheck(); } }
    }, debounceMs);
  }
  return scheduleCheck;
}

describe('StorageGuard scheduleCheck debounce (modeled)', () => {
  it('coalesces a burst of event.stored into a single deferred check', async () => {
    vi.useFakeTimers();
    const check = vi.fn();
    const schedule = makeGuard(check, 2000);
    for (let i = 0; i < 50; i++) schedule(); // 50-item poll burst
    await vi.advanceTimersByTimeAsync(2000);
    expect(check).toHaveBeenCalledTimes(1); // not 50
    vi.useRealTimers();
  });
  it('runs one follow-up check when more events arrive while a check is in flight', async () => {
    vi.useFakeTimers();
    const check = vi.fn();
    const schedule = makeGuard(check, 2000);
    schedule();
    await vi.advanceTimersByTimeAsync(1000); // timer armed, not yet fired
    schedule(); schedule(); // arrivals during the pending window
    await vi.advanceTimersByTimeAsync(1000); // first check fires; pending -> reschedule
    await vi.advanceTimersByTimeAsync(2000); // follow-up fires
    expect(check).toHaveBeenCalledTimes(2); // exactly one follow-up, not one per arrival
    vi.useRealTimers();
  });
  it('a failing check still clears the in-flight flag (next burst can run)', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const schedule = makeGuard(() => { calls++; throw new Error('estimate failed'); }, 2000);
    schedule();
    await vi.advanceTimersByTimeAsync(2000);
    schedule();
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls).toBe(2);
    vi.useRealTimers();
  });
});

describe('StorageGuard debounce wiring (index.html)', () => {
  it('declares the debounce interval in CONFIG', () => {
    expect(html).toContain('storageCheckDebounceMs:2000,');
  });
  it('subscribes event.stored to scheduleCheck, not directly to check', () => {
    expect(html).toContain("Bus.subscribe('event.stored',()=>scheduleCheck());");
    expect(html).not.toContain("Bus.subscribe('event.stored',()=>check());");
  });
  it('guards with in-flight + pending flags and reschedules once after a busy check', () => {
    expect(html).toContain('let checkPending=false,checkRunning=false;');
    expect(html).toContain('if(checkRunning){checkPending=true;return;}');
    expect(html).toContain('finally{checkRunning=false;if(checkPending){checkPending=false;scheduleCheck();}}');
  });
  it('still exposes check() directly for the startup call', () => {
    // round 80: scheduleCheck is exported too, so the write-failure path can run the guard.
    expect(html).toContain('return{check,requestPersist,scheduleCheck};');
    expect(html).toContain('await StorageGuard.check();');
  });
});
