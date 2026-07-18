// Neus — event card action buttons accessibility + notification icon regression
// Found via codebase audit: three action buttons lacked aria-label (inconsistent
// with their siblings on the same card), and the periodic-sync notification
// referenced a nonexistent /icon-192.png (only inline SVG data URIs exist in
// this zero-build-step app — there is no PNG asset anywhere in the repo).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

describe('event card action buttons — aria-label consistency (index.html)', () => {
  it('every action button in cardHtml declares an aria-label', () => {
    const start = html.indexOf('function cardHtml(ev,scoreHit){');
    expect(start).toBeGreaterThan(-1);
    const end = html.indexOf('\n}', start);
    const fn = html.slice(start, end);
    const buttons = [...fn.matchAll(/<button data-act="(\w+)"[^>]*>/g)];
    expect(buttons.length).toBeGreaterThanOrEqual(7); // read, star, archive, later, vault, detail, copy
    for (const [tag, act] of buttons) {
      expect(tag, `data-act="${act}" button missing aria-label`).toMatch(/aria-label=/);
    }
  });
  it('vault/detail/copy buttons have descriptive aria-labels (previously missing)', () => {
    expect(html).toContain('data-act="vault" class="vault-btn${ev.state.exported?\' done\':\'\'}" aria-label="Export to vault"');
    expect(html).toContain('data-act="detail" aria-label="Edit event details"');
    expect(html).toContain('data-act="copy" aria-label="Copy as Markdown"');
  });
});

describe('periodic-sync notification icon (index.html)', () => {
  it('does not reference a nonexistent /icon-192.png file', () => {
    expect(html).not.toContain("icon:'/icon-192.png'");
  });
  it('uses an inline SVG data URI matching the manifest app icon', () => {
    expect(html).toContain("icon:\"data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 192 192'>");
    expect(html).toContain("stroke='%2300C4CC'"); // brand accent color
  });
});
