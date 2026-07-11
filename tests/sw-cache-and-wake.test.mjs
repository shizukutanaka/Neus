// Neus — service worker shell-cache bloat + wake-notification consent (round 28 audit)
//
// 1) Shell reads used cache.match(req,{ignoreSearch:true}) (dedups across query strings) but
//    the background-revalidation write used cache.put(req) keyed on the FULL request URL —
//    so every distinct query string (share target ?share_url=..., bookmarklet, ?test=1,
//    tracking params) inserted its own ~325KB copy of index.html that was never trimmed.
//    Fixed by writing under a pathname-only key.
// 2) The periodicsync "no active client" wake notification always fired regardless of the
//    user's notify preference (which lives in IndexedDB, unreadable from the SW), and its
//    copy ("Tap to fetch new events") was misleading since tapping it doesn't fetch anything.
//    Fixed by mirroring the notify preference into a small Cache API entry (PREFS_CACHE) that
//    the main thread writes and the SW reads, and rewording the notification honestly.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sw = readFileSync(join(__dirname, '..', 'sw.js'), 'utf8');
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

describe('sw.js — shell cache write key is normalized to pathname', () => {
  it('bumps the cache version so any v2 cache bloated by the old bug gets purged', () => {
    expect(sw).toContain("const CACHE = 'neus-shell-v3';");
  });
  it('writes the shell cache entry keyed on origin+pathname, not the raw request', () => {
    expect(sw).toContain('cache.put(new Request(url.origin + url.pathname), res.clone());');
  });
  it('still reads with ignoreSearch so a cached shell serves every query-string variant', () => {
    expect(sw).toContain("cache.match(req, { ignoreSearch: true })");
  });
});

describe('sw.js — activate() spares the prefs cache from its cleanup sweep', () => {
  it('declares a separate PREFS_CACHE namespace', () => {
    expect(sw).toContain("const PREFS_CACHE = 'neus-prefs-v1';");
  });
  it('filters out both CACHE and PREFS_CACHE before deleting the rest', () => {
    expect(sw).toContain('keys.filter(k => k !== CACHE && k !== PREFS_CACHE).map(k => caches.delete(k))');
  });
});

describe('sw.js — periodicsync wake notification honors the notify preference', () => {
  const idx = sw.indexOf("if (clients.length === 0) {");
  const body = sw.slice(idx, idx + 1300);

  it('reads the mirrored preference from PREFS_CACHE before deciding to notify', () => {
    expect(body).toContain("const prefsCache = await caches.open(PREFS_CACHE);");
    expect(body).toContain("const res = await prefsCache.match('/__prefs');");
    expect(body).toContain('if (prefs?.notify) {');
  });
  it('no longer shows the wake notification unconditionally', () => {
    // The old code called showNotification directly inside the outer try with no gate.
    expect(body).not.toMatch(/try\s*\{\s*await self\.registration\.showNotification\('Neus',\s*\{\s*body: 'Tap to fetch new events'/);
  });
  it('uses honest copy — opening the app does not itself fetch anything', () => {
    expect(body).toContain("body: 'Open Neus to check for updates'");
    expect(body).not.toContain('Tap to fetch new events');
  });
});

describe('index.html — AutoSync.syncPrefsToSW mirrors the notify preference for the SW', () => {
  it('writes {notify} into the PREFS_CACHE namespace matching sw.js', () => {
    expect(html).toContain("const cache=await caches.open('neus-prefs-v1');");
    expect(html).toContain("await cache.put('/__prefs',new Response(JSON.stringify({notify})");
  });
  it('gates notify on both the user setting and actual granted browser permission', () => {
    expect(html).toContain("const notify=!!(s.notify&&'Notification'in window&&Notification.permission==='granted');");
  });
  it('is called after saving settings and once at startup', () => {
    expect(html).toContain('await AutoSync.syncPrefsToSW();');
    const settingsSaveIdx = html.indexOf("}else{await AutoSync.unregister();}");
    const startupIdx = html.indexOf('await MarkdownExporter.load();');
    expect(html.indexOf('await AutoSync.syncPrefsToSW();', settingsSaveIdx)).toBeGreaterThan(settingsSaveIdx);
    expect(html.indexOf('await AutoSync.syncPrefsToSW();', startupIdx)).toBeGreaterThan(startupIdx);
  });
  it('is exposed on the AutoSync public interface', () => {
    expect(html).toContain('return{getSettings,setSettings,isSupported,isRegistered,register,unregister,requestNotificationPerm,syncPrefsToSW};');
  });
});
