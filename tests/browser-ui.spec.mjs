// Neus — REAL UI interaction E2E in Chromium
// Clicks actual buttons, opens modals, toggles star/archive, runs search.
// This is the path that v0.2.4's startup bugs lived in — now we exercise it fully.

import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appUrl = 'file://' + join(__dirname, '..', 'index.html') + '?test=1';

// Track console errors — ANY pageerror means a code path crashed
// (ignore external resource failures like Google Fonts 403 under file://)
function trackErrors(page) {
  const errors = [];
  const ignore = (t) => /Failed to load resource|net::ERR|fonts\.googleapis|fonts\.gstatic|403|favicon/i.test(t);
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !ignore(m.text())) errors.push('console: ' + m.text()); });
  return errors;
}

// メニュー内ボタンはオーバーフローメニューを開いてからクリック
async function clickMenuItem(page, sel) {
  await page.click('#btn-menu');
  await page.waitForTimeout(100);
  await page.click(sel);
}

async function gotoReady(page) {
  // Pre-mark onboarding as done so it doesn't intercept clicks
  await page.addInitScript(() => {
    // Will be applied before app scripts run; app reads from IDB so we set after init below
  });
  await page.goto(appUrl);
  await page.waitForFunction(() => window.__neus !== undefined, { timeout: 8000 });
  // Dismiss onboarding if shown
  await page.evaluate(async () => {
    const o = document.querySelector('.onboarding');
    if (o && o.classList.contains('show')) {
      o.classList.remove('show');
      try { await window.__neus.Store.putSetting('onboarding-done', true); } catch {}
    }
  });
}

// Seed N events directly via the test hook, then re-render
async function seed(page, n = 3) {
  await page.evaluate(async (count) => {
    const { Store, FTSIndex } = window.__neus;
    for (let i = 0; i < count; i++) {
      const ev = {
        id: `ui-seed-${i}`, timestamp: Date.now() - i * 1000,
        source: { id: 'seed', type: 'rss', name: 'Seed Source' },
        content: { title: `Seed Article ${i} about rust`, snippet: `snippet ${i}`, summary: '' },
        meta: { autoTags: ['seed'], userTags: [], score: 50 },
        user: {}, state: { read: false, starred: false, archived: false },
        links: [], url: `https://example.com/seed-${i}`, hash: `seed-hash-${i}`,
      };
      await Store.putEvent(ev);
      FTSIndex.add(ev);
    }
  }, n);
}

test.describe('Real Chromium UI — modals open/close without crashing', () => {
  for (const [btn, modal] of [
    ['#btn-sources', '#modal-sources'],
    ['#btn-keywords', '#modal-keywords'],
    ['#btn-stats', '#modal-stats'],
    ['#btn-settings', '#modal-settings'],
  ]) {
    test(`${btn} opens ${modal}`, async ({ page }) => {
      const errors = trackErrors(page);
      await gotoReady(page);
      await clickMenuItem(page, btn);
      await expect(page.locator(modal)).toHaveClass(/show/, { timeout: 6000 });
      // Close via Escape
      await page.keyboard.press('Escape');
      await expect(page.locator(modal)).not.toHaveClass(/show/, { timeout: 6000 });
      expect(errors, `errors on ${btn}: ${errors.join('; ')}`).toEqual([]);
    });
  }
});

test.describe('Real Chromium UI — nav tabs switch without crashing', () => {
  for (const view of ['all', 'starred', 'archived', 'later', 'digest', 'inbox']) {
    test(`nav to ${view}`, async ({ page }) => {
      const errors = trackErrors(page);
      await gotoReady(page);
      await seed(page, 3);
      await page.click(`[data-view="${view}"]`);
      await page.waitForTimeout(300);
      // aria-selected must be true on the clicked tab
      const selected = await page.getAttribute(`[data-view="${view}"]`, 'aria-selected');
      expect(selected).toBe('true');
      expect(errors, `errors on ${view}: ${errors.join('; ')}`).toEqual([]);
    });
  }
});

test.describe('Real Chromium UI — card actions mutate state', () => {
  test('STAR toggles state.starred and persists', async ({ page }) => {
    const errors = trackErrors(page);
    await gotoReady(page);
    await seed(page, 1);
    // re-render inbox
    await page.click('[data-view="inbox"]');
    await page.waitForSelector('.card', { timeout: 3000 });
    // click star on first card
    await page.click('.card [data-act="star"]');
    await page.waitForTimeout(300);
    const starred = await page.evaluate(async () => {
      const { Store } = window.__neus;
      const ev = await Store.getEvent('ui-seed-0');
      return ev?.state.starred;
    });
    expect(starred).toBe(true);
    expect(errors).toEqual([]);
  });

  test('ARCHIVE toggles state.archived and persists', async ({ page }) => {
    const errors = trackErrors(page);
    await gotoReady(page);
    await seed(page, 1);
    await page.click('[data-view="inbox"]');
    await page.waitForSelector('.card', { timeout: 3000 });
    await page.click('.card [data-act="archive"]');
    await page.waitForTimeout(300);
    const archived = await page.evaluate(async () => {
      const { Store } = window.__neus;
      const ev = await Store.getEvent('ui-seed-0');
      return ev?.state.archived;
    });
    expect(archived).toBe(true);
    expect(errors).toEqual([]);
  });

  test('LATER toggles state.later and persists', async ({ page }) => {
    const errors = trackErrors(page);
    await gotoReady(page);
    await seed(page, 1);
    await page.click('[data-view="inbox"]');
    await page.waitForSelector('.card', { timeout: 3000 });
    await page.click('.card [data-act="later"]');
    await page.waitForTimeout(300);
    const later = await page.evaluate(async () => {
      const { Store } = window.__neus;
      const ev = await Store.getEvent('ui-seed-0');
      return ev?.state.later;
    });
    expect(later).toBe(true);
    expect(errors).toEqual([]);
  });
});

test.describe('Real Chromium UI — search', () => {
  test('typing in search filters to matching cards', async ({ page }) => {
    const errors = trackErrors(page);
    await gotoReady(page);
    await seed(page, 3);
    await page.fill('#search-input', 'rust');
    await page.waitForTimeout(500);
    // search view should show cards
    const cardCount = await page.locator('.card').count();
    expect(cardCount).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  test('Escape clears search', async ({ page }) => {
    await gotoReady(page);
    await seed(page, 2);
    await page.fill('#search-input', 'rust');
    await page.waitForTimeout(300);
    await page.locator('#search-input').press('Escape');
    const val = await page.inputValue('#search-input');
    expect(val).toBe('');
  });
});

test.describe('Real Chromium UI — keyboard shortcuts', () => {
  test('? opens shortcuts modal', async ({ page }) => {
    const errors = trackErrors(page);
    await gotoReady(page);
    await page.keyboard.press('Shift+Slash'); // "?"
    await page.waitForTimeout(300);
    const shown = await page.locator('#modal-shortcuts').evaluate(el => el.classList.contains('show')).catch(() => false);
    expect(shown).toBe(true);
    expect(errors).toEqual([]);
  });

  test('g i navigates to inbox', async ({ page }) => {
    const errors = trackErrors(page);
    await gotoReady(page);
    await seed(page, 2);
    await page.click('[data-view="all"]');
    await page.waitForTimeout(200);
    await page.keyboard.press('g');
    await page.keyboard.press('i');
    await page.waitForTimeout(300);
    const selected = await page.getAttribute('[data-view="inbox"]', 'aria-selected');
    expect(selected).toBe('true');
    expect(errors).toEqual([]);
  });
});

test.describe('Real Chromium UI — KeywordRules via modal', () => {
  test('saving simple watch rule persists', async ({ page }) => {
    const errors = trackErrors(page);
    await gotoReady(page);
    await clickMenuItem(page, '#btn-keywords');
    await expect(page.locator('#modal-keywords')).toHaveClass(/show/);
    // chip-style input: type + Enter
    await page.fill('#kw-watch-chipinput', 'rust');
    await page.press('#kw-watch-chipinput', 'Enter');
    await page.fill('#kw-watch-chipinput', 'webassembly');
    await page.press('#kw-watch-chipinput', 'Enter');
    await page.click('#kw-save');
    await page.waitForTimeout(300);
    const rules = await page.evaluate(() => window.__neus.KeywordRules.getRules());
    expect(rules.watch.length).toBe(2);
    await page.evaluate(() => window.__neus.KeywordRules.replaceRules({ watch: [], block: [] }));
    expect(errors).toEqual([]);
  });

  test('invalid advanced JSON shows aria-invalid error', async ({ page }) => {
    await gotoReady(page);
    await clickMenuItem(page, '#btn-keywords');
    await page.fill('#kw-adv-input', '{not valid json');
    await page.click('#kw-save');
    await page.waitForTimeout(300);
    const invalid = await page.getAttribute('#kw-adv-input', 'aria-invalid');
    const errText = await page.textContent('#kw-adv-err');
    expect(invalid).toBe('true');
    expect(errText).toContain('Invalid JSON');
  });

  test('chip can be removed via × button', async ({ page }) => {
    const errors = trackErrors(page);
    await gotoReady(page);
    await clickMenuItem(page, '#btn-keywords');
    await page.fill('#kw-watch-chipinput', 'temporary');
    await page.press('#kw-watch-chipinput', 'Enter');
    expect(await page.locator('#kw-watch-chips .kw-chip').count()).toBe(1);
    await page.click('#kw-watch-chips .kw-chip .rm');
    expect(await page.locator('#kw-watch-chips .kw-chip').count()).toBe(0);
    expect(errors).toEqual([]);
  });

  test('comma-separated paste creates multiple chips', async ({ page }) => {
    await gotoReady(page);
    await clickMenuItem(page, '#btn-keywords');
    // simulate typing with comma delimiter
    await page.fill('#kw-block-chipinput', 'spam');
    await page.press('#kw-block-chipinput', ',');
    await page.fill('#kw-block-chipinput', 'ads');
    await page.press('#kw-block-chipinput', 'Enter');
    expect(await page.locator('#kw-block-chips .kw-chip').count()).toBe(2);
  });
});

test.describe('Real Chromium UI — context action sheet (long-press / right-click)', () => {
  async function seedTagged(page) {
    await page.evaluate(async () => {
      const { Store, FTSIndex } = window.__neus;
      const ev = {
        id: 'ctx-ui-1', timestamp: Date.now(),
        source: { id: 'hn', type: 'rss', name: 'Hacker News' },
        content: { title: 'Rust article for context', snippet: '', summary: '' },
        meta: { autoTags: ['rust'], userTags: [], score: 50 },
        user: {}, state: { read: false, starred: false, archived: false },
        links: [], url: 'https://example.com/ctx', hash: 'ctx-ui-hash',
      };
      await Store.putEvent(ev); FTSIndex.add(ev);
    });
  }

  test('right-click on tag opens sheet with the term', async ({ page }) => {
    const errors = trackErrors(page);
    await gotoReady(page);
    await seedTagged(page);
    await page.click('[data-view="inbox"]');
    await page.waitForSelector('.card .tag', { timeout: 3000 });
    await page.click('.card .tag', { button: 'right' });
    await expect(page.locator('#kw-sheet')).toHaveClass(/show/, { timeout: 3000 });
    const term = await page.textContent('#kw-sheet-term');
    expect(term).toBe('rust');
    expect(errors).toEqual([]);
  });

  test('sheet BLOCK action adds a keyword rule', async ({ page }) => {
    await gotoReady(page);
    await seedTagged(page);
    await page.click('[data-view="inbox"]');
    await page.waitForSelector('.card .tag', { timeout: 3000 });
    await page.click('.card .tag', { button: 'right' });
    await expect(page.locator('#kw-sheet')).toHaveClass(/show/);
    await page.click('#kw-sheet-block-arch');
    await page.waitForTimeout(500);
    const rules = await page.evaluate(() => window.__neus.KeywordRules.getRules());
    expect(rules.block.some(r => r.pattern === 'rust' && r.action === 'archive')).toBe(true);
    await page.evaluate(() => window.__neus.KeywordRules.replaceRules({ watch: [], block: [] }));
  });

  test('sheet closes on Escape', async ({ page }) => {
    await gotoReady(page);
    await seedTagged(page);
    await page.click('[data-view="inbox"]');
    await page.waitForSelector('.card .tag', { timeout: 3000 });
    await page.click('.card .tag', { button: 'right' });
    await expect(page.locator('#kw-sheet')).toHaveClass(/show/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#kw-sheet')).not.toHaveClass(/show/);
  });
});

test.describe('Real Chromium UI — card swipe gestures', () => {
  async function seedAndShow(page, id) {
    await page.evaluate(async (eid) => {
      const { Store, FTSIndex } = window.__neus;
      const ev = {
        id: eid, timestamp: Date.now(), source: { id: 's', type: 'rss', name: 'S' },
        content: { title: 'Swipe target ' + eid, snippet: '', summary: '' },
        meta: { autoTags: [], userTags: [], score: 50 },
        user: {}, state: { read: false, starred: false, archived: false },
        links: [], url: 'u' + eid, hash: 'h' + eid,
      };
      await Store.putEvent(ev); FTSIndex.add(ev);
    }, id);
    await page.click('[data-view="inbox"]');
    await page.waitForSelector(`.card[data-id="${id}"]`, { timeout: 3000 });
  }
  function swipe(page, id, dir) {
    return page.evaluate(({ id, dir }) => {
      const card = document.querySelector(`.card[data-id="${id}"]`);
      const box = card.getBoundingClientRect();
      const cy = box.y + box.height / 2;
      const x0 = dir > 0 ? box.x + 40 : box.x + box.width - 40;
      const mk = (type, x) => new TouchEvent(type, {
        bubbles: true, cancelable: true,
        touches: type === 'touchend' ? [] : [new Touch({ identifier: 1, target: card, clientX: x, clientY: cy })],
        changedTouches: [new Touch({ identifier: 1, target: card, clientX: x, clientY: cy })],
      });
      card.dispatchEvent(mk('touchstart', x0));
      card.dispatchEvent(mk('touchmove', x0 + dir * 100));
      card.dispatchEvent(mk('touchend', x0 + dir * 100));
    }, { id, dir });
  }

  test('right swipe stars the card', async ({ page }) => {
    await gotoReady(page);
    await seedAndShow(page, 'swr');
    await swipe(page, 'swr', 1);
    await page.waitForTimeout(400);
    const starred = await page.evaluate(async () => (await window.__neus.Store.getEvent('swr'))?.state.starred);
    expect(starred).toBe(true);
  });

  test('left swipe archives the card', async ({ page }) => {
    await gotoReady(page);
    await seedAndShow(page, 'swl');
    await swipe(page, 'swl', -1);
    await page.waitForTimeout(400);
    const archived = await page.evaluate(async () => (await window.__neus.Store.getEvent('swl'))?.state.archived);
    expect(archived).toBe(true);
  });

  test('small swipe below threshold does nothing', async ({ page }) => {
    await gotoReady(page);
    await seedAndShow(page, 'sws');
    await page.evaluate(() => {
      const card = document.querySelector('.card[data-id="sws"]');
      const box = card.getBoundingClientRect();
      const cy = box.y + box.height / 2, x0 = box.x + 40;
      const mk = (type, x) => new TouchEvent(type, {
        bubbles: true, cancelable: true,
        touches: type === 'touchend' ? [] : [new Touch({ identifier: 1, target: card, clientX: x, clientY: cy })],
        changedTouches: [new Touch({ identifier: 1, target: card, clientX: x, clientY: cy })],
      });
      card.dispatchEvent(mk('touchstart', x0));
      card.dispatchEvent(mk('touchmove', x0 + 30)); // below 80px threshold
      card.dispatchEvent(mk('touchend', x0 + 30));
    });
    await page.waitForTimeout(300);
    const ev = await page.evaluate(async () => await window.__neus.Store.getEvent('sws'));
    expect(ev.state.starred).toBe(false);
    expect(ev.state.archived).toBe(false);
  });
});

test.describe('Real Chromium UI — PWA install promotion', () => {
  test('banner elements exist with accessible buttons', async ({ page }) => {
    await gotoReady(page);
    expect(await page.locator('#install-banner').count()).toBe(1);
    expect(await page.locator('#install-now').count()).toBe(1);
    expect(await page.locator('#install-later').count()).toBe(1);
  });

  test('"Later" hides banner and sets snooze', async ({ page }) => {
    await gotoReady(page);
    await page.evaluate(() => document.querySelector('#install-banner').classList.add('show'));
    await page.click('#install-later');
    await page.waitForTimeout(200);
    const shown = await page.evaluate(() => document.querySelector('#install-banner').classList.contains('show'));
    const snooze = await page.evaluate(async () => await window.__neus.Store.getSetting('install-snooze-until'));
    expect(shown).toBe(false);
    expect(snooze).toBeTruthy();
  });

  test('maybeShow does not show banner with < 5 events', async ({ page }) => {
    await gotoReady(page);
    // No deferred prompt + few events → must stay hidden
    await page.evaluate(async () => { await window.__neus.InstallPromo.maybeShow(); });
    await page.waitForTimeout(100);
    const shown = await page.evaluate(() => document.querySelector('#install-banner').classList.contains('show'));
    expect(shown).toBe(false);
  });
});

test.describe('Real Chromium UI — overflow menu', () => {
  test('menu toggles open/closed via hamburger', async ({ page }) => {
    await gotoReady(page);
    expect(await page.evaluate(() => document.querySelector('#overflow-menu').classList.contains('show'))).toBe(false);
    await page.click('#btn-menu');
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => document.querySelector('#overflow-menu').classList.contains('show'))).toBe(true);
    expect(await page.getAttribute('#btn-menu', 'aria-expanded')).toBe('true');
  });

  test('clicking a menu item opens its modal and closes menu', async ({ page }) => {
    await gotoReady(page);
    await page.click('#btn-menu');
    await page.waitForTimeout(100);
    await page.click('#btn-stats');
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => document.querySelector('#modal-stats').classList.contains('show'))).toBe(true);
    expect(await page.evaluate(() => document.querySelector('#overflow-menu').classList.contains('show'))).toBe(false);
  });

  test('outside click closes menu', async ({ page }) => {
    await gotoReady(page);
    await page.click('#btn-menu');
    await page.waitForTimeout(100);
    await page.click('h1.brand');
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => document.querySelector('#overflow-menu').classList.contains('show'))).toBe(false);
  });

  test('POLL button remains directly accessible (not in menu)', async ({ page }) => {
    await gotoReady(page);
    // POLL is a direct sibling, visible without opening the menu
    const visible = await page.isVisible('#btn-poll');
    expect(visible).toBe(true);
  });
});
