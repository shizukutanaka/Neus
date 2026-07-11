// Neus — periodic-poll-request notification fix (round 28 audit)
//
// new Notification() is an illegal constructor on mobile Chrome/Android (platforms require
// ServiceWorkerRegistration.showNotification instead). The old handler called new Notification()
// inside the same try block as the post-poll UI refresh, so on Android a successful background
// poll would throw at the notification step and skip refreshCounts()/renderView() entirely —
// the UI stayed stale until some unrelated event triggered a re-render. Fixed by running the
// UI refresh first, then attempting the notification via reg.showNotification() in its own
// try/catch so a notification failure can never suppress the UI update.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

describe('periodic-poll-request UI-refresh-before-notification ordering (index.html)', () => {
  const idx = html.indexOf("e.data?.type==='periodic-poll-request'");
  const body = html.slice(idx, idx + 1800);

  it('refreshes the UI before attempting any notification', () => {
    const refreshIdx = body.indexOf('await refreshCounts();await renderView();');
    const notifyIdx = body.indexOf('reg.showNotification(');
    expect(refreshIdx).toBeGreaterThan(-1);
    expect(notifyIdx).toBeGreaterThan(-1);
    expect(refreshIdx).toBeLessThan(notifyIdx);
  });
  it('uses ServiceWorkerRegistration.showNotification, not the new Notification() constructor (illegal on Android)', () => {
    expect(body).toContain('const reg=await navigator.serviceWorker.ready;');
    expect(body).toContain('await reg.showNotification(');
    expect(body).not.toContain('new Notification(currentLang');
  });
  it('wraps the notification attempt in its own try/catch, isolated from the poll/refresh try', () => {
    const notifyIdx = body.indexOf('const reg=await navigator.serviceWorker.ready;');
    const beforeNotify = body.slice(Math.max(0, notifyIdx - 200), notifyIdx);
    expect(beforeNotify).toContain('try{');
    expect(body).toContain("catch(nErr){console.warn('[periodic-poll-request] notification failed:',nErr);}");
  });
  it('still gates the notification on notify setting, positive delta, and granted permission', () => {
    expect(body).toContain("if(s.notify&&fetched>0&&Notification.permission==='granted'){");
  });
});
