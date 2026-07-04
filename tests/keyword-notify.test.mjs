// Neus — keyword-match OS notifications (docs/FEATURE-AUDIT.md §1-2)
//
// Plan.md §4.9 (v1.1) lists "通知 / アラート(購読キーワード検知)" as a planned feature.
// KeywordRules could star/highlight/tag on a WATCH match, but had no way to trigger an OS
// notification — the only content-independent notification path was AutoSync's "N new
// items". This adds an opt-in `notify` flag to watch rules: when a matching rule has
// notify:true and the event survives (not archived by a block rule), an OS Notification
// fires, reusing the existing AutoSync.requestNotificationPerm() permission flow and the
// same tag-replacement pattern already used elsewhere (so notifications don't pile up).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// Mirrors the notify-decision logic added to the inbound.fetched -> event.normalized pipeline.
function shouldNotify(ev, matchedWatch, permission) {
  if (ev.state?.archived) return false;
  if (permission !== 'granted') return false;
  return matchedWatch.some(r => r.notify);
}

describe('keyword watch notification decision (modeled)', () => {
  it('does not notify when no watch rule has notify:true', () => {
    expect(shouldNotify({ state: {} }, [{ pattern: 'x', action: 'star' }], 'granted')).toBe(false);
  });
  it('notifies when a matched watch rule has notify:true and permission is granted', () => {
    expect(shouldNotify({ state: {} }, [{ pattern: 'x', notify: true }], 'granted')).toBe(true);
  });
  it('does not notify without permission, even if a rule requests it', () => {
    expect(shouldNotify({ state: {} }, [{ pattern: 'x', notify: true }], 'default')).toBe(false);
    expect(shouldNotify({ state: {} }, [{ pattern: 'x', notify: true }], 'denied')).toBe(false);
  });
  it('does not notify if the event was archived (block-precedence, same as star/highlight/tag)', () => {
    expect(shouldNotify({ state: { archived: true } }, [{ pattern: 'x', notify: true }], 'granted')).toBe(false);
  });
  it('notifies if any one of several matched rules requests it', () => {
    const rules = [{ pattern: 'a', action: 'star' }, { pattern: 'b', notify: true }];
    expect(shouldNotify({ state: {} }, rules, 'granted')).toBe(true);
  });
});

describe('keyword watch notification wiring (index.html)', () => {
  it('adds a notify checkbox to the simple WATCH UI', () => {
    expect(html).toContain('<label><input type="checkbox" id="kw-watch-notify"> 一致時にOS通知(要許可)</label>');
  });
  it('populates the checkbox from the saved simple rule on modal open', () => {
    expect(html).toContain("$('#kw-watch-notify').checked=!!simpleWatch[0]?.notify;");
  });
  it('requests notification permission (opt-in) only when the checkbox is checked at save time', () => {
    expect(html).toContain('const watchNotify=$(\'#kw-watch-notify\').checked;');
    expect(html).toContain('if(watchNotify)await AutoSync.requestNotificationPerm();');
  });
  it('carries notify through to the simple watch rule objects', () => {
    expect(html).toContain("action:watchAction,notify:watchNotify}));");
  });
  it('fires a Notification only when unarchived, permission granted, and a matched rule requests it', () => {
    expect(html).toContain("if(!ev.state.archived&&Notification.permission==='granted'){");
    expect(html).toContain('const notifyRule=matched.watch.find(r=>r.notify);');
  });
  it('uses a shared tag so repeated matches replace rather than pile up', () => {
    expect(html).toContain("tag:'neus-watch'");
  });
});
