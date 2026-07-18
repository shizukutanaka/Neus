// Neus — Summarizer daily budget correctness + notification-fatigue fix
//
// Found via a BYOK/Summarizer audit (docs/FEATURE-AUDIT.md §1-6, §1-7):
//
// 1. budget:0 meant "unlimited" (falsy-check bug): a user who explicitly set the daily
//    budget field to 0, intending "block all summarization", got the opposite — the check
//    `s.budget && dailyCount >= s.budget` short-circuits on falsy 0, skipping the guard
//    entirely. Fixed to `typeof s.budget === 'number' && dailyCount >= s.budget`.
// 2. Toast spam: once the budget was exceeded, every subsequently-tagged event re-published
//    'summarizer.budget-exceeded', firing the same error toast repeatedly (a role="status"
//    aria-live region, so screen readers re-announced it too). Fixed with a per-day
//    budgetNotified flag, reset alongside dailyCount in resetIfNewDay.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// Mirrors the budget-check + notify-once logic inside Summarizer.summarize in index.html.
function checkBudget(budget, dailyCount, notifiedRef) {
  if (typeof budget === 'number' && dailyCount >= budget) {
    const alreadyNotified = notifiedRef.notified;
    if (!alreadyNotified) notifiedRef.notified = true;
    return { blocked: true, shouldNotify: !alreadyNotified };
  }
  return { blocked: false, shouldNotify: false };
}

describe('budget=0 means "block everything", not "unlimited" (modeled)', () => {
  it('blocks immediately when budget is explicitly 0', () => {
    const r = checkBudget(0, 0, { notified: false });
    expect(r.blocked).toBe(true);
  });
  it('does not block when budget is undefined (no BYOK budget configured)', () => {
    const r = checkBudget(undefined, 0, { notified: false });
    expect(r.blocked).toBe(false);
  });
  it('blocks once dailyCount reaches a positive budget', () => {
    expect(checkBudget(5, 4, { notified: false }).blocked).toBe(false);
    expect(checkBudget(5, 5, { notified: false }).blocked).toBe(true);
    expect(checkBudget(5, 6, { notified: false }).blocked).toBe(true);
  });
});

describe('budget-exceeded notifies at most once per day (modeled)', () => {
  it('notifies on the first block', () => {
    const ref = { notified: false };
    const r = checkBudget(0, 0, ref);
    expect(r.shouldNotify).toBe(true);
  });
  it('does not notify again on subsequent blocks the same day', () => {
    const ref = { notified: false };
    checkBudget(0, 0, ref);
    const r2 = checkBudget(0, 1, ref);
    const r3 = checkBudget(0, 2, ref);
    expect(r2.shouldNotify).toBe(false);
    expect(r3.shouldNotify).toBe(false);
  });
  it('notifies again after the flag resets (simulating a new day)', () => {
    const ref = { notified: false };
    checkBudget(0, 0, ref);
    ref.notified = false; // resetIfNewDay resets this alongside dailyCount
    const r = checkBudget(0, 0, ref);
    expect(r.shouldNotify).toBe(true);
  });
});

describe('Summarizer budget wiring (index.html)', () => {
  it('uses a typeof check, not a falsy check, so budget:0 is honored', () => {
    expect(html).toContain("if(typeof s.budget==='number'&&dailyCount>=s.budget){");
    expect(html).not.toContain('if(s.budget&&dailyCount>=s.budget)');
  });
  it('declares a budgetNotified flag and resets it alongside dailyCount on a new day', () => {
    expect(html).toContain('let budgetNotified=false;');
    expect(html).toContain('dailyKey=today;dailyCount=0;budgetNotified=false;await persist();');
  });
  it('publishes summarizer.budget-exceeded only once per day', () => {
    expect(html).toContain("if(!budgetNotified){budgetNotified=true;Bus.publish('summarizer.budget-exceeded',{});}");
  });
});
