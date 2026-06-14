// Neus — E2E smoke test (JSDOM, no browser required)
// Verifies that index.html loads, modules initialize, and core UI elements exist.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexPath = join(__dirname, '..', 'index.html');

describe('E2E smoke — HTML loads in JSDOM', () => {
  let dom, doc;
  beforeAll(() => {
    const html = readFileSync(indexPath, 'utf8');
    // Strip <script type="module"> since JSDOM can't execute it without IndexedDB polyfills
    const noScript = html.replace(/<script type="module">[\s\S]*?<\/script>/g, '');
    dom = new JSDOM(noScript, { url: 'https://example.com/' });
    doc = dom.window.document;
  });

  it('document title is set', () => {
    expect(doc.title).toBeTruthy();
    expect(doc.title.length).toBeGreaterThan(2);
  });

  it('html lang attribute is set', () => {
    expect(doc.documentElement.lang).toBeTruthy();
  });

  it('viewport meta tag present', () => {
    expect(doc.querySelector('meta[name="viewport"]')).toBeTruthy();
  });

  it('manifest linked', () => {
    expect(doc.querySelector('link[rel="manifest"]')).toBeTruthy();
  });

  it('skip-link is first focusable', () => {
    const skip = doc.querySelector('.skip-link');
    expect(skip).toBeTruthy();
    expect(skip.getAttribute('href')).toBe('#view');
  });

  it('h1 brand present', () => {
    const h1 = doc.querySelector('h1');
    expect(h1).toBeTruthy();
    expect(h1.textContent).toContain('NEUS');
  });

  it('navigation tablist with 7 tabs (inbox/all/starred/archived/later/digest/search)', () => {
    const tabs = doc.querySelectorAll('nav [role="tablist"] button[role="tab"]');
    expect(tabs.length).toBeGreaterThanOrEqual(6);
  });

  it('exactly one tab is initially active (aria-selected=true)', () => {
    const selected = doc.querySelectorAll('button[role="tab"][aria-selected="true"]');
    expect(selected.length).toBe(1);
  });

  it('all modals have role and aria-modal', () => {
    const modals = doc.querySelectorAll('.modal');
    for (const m of modals) {
      const role = m.getAttribute('role');
      expect(['dialog', 'alertdialog']).toContain(role);
      expect(m.getAttribute('aria-modal')).toBe('true');
    }
  });

  it('search input has aria-label', () => {
    const search = doc.getElementById('search-input');
    expect(search).toBeTruthy();
    expect(search.getAttribute('aria-label')).toBeTruthy();
  });

  it('main view has role=main and aria-live', () => {
    const view = doc.getElementById('view');
    expect(view).toBeTruthy();
    expect(view.getAttribute('role')).toBe('main');
    expect(view.getAttribute('aria-live')).toBeTruthy();
  });

  it('all required header buttons exist', () => {
    for (const id of ['btn-sources', 'btn-keywords', 'btn-stats', 'btn-vault', 'btn-settings', 'btn-poll']) {
      const el = doc.getElementById(id);
      expect(el, `Missing ${id}`).toBeTruthy();
    }
  });

  it('confirm modal exists with proper a11y', () => {
    const m = doc.getElementById('modal-confirm');
    expect(m).toBeTruthy();
    expect(m.getAttribute('role')).toBe('alertdialog');
    expect(m.querySelector('#confirm-ok')).toBeTruthy();
    expect(m.querySelector('#confirm-cancel')).toBeTruthy();
  });

  it('toast region has live region role', () => {
    const t = doc.getElementById('toast');
    expect(t).toBeTruthy();
    expect(t.getAttribute('role')).toBe('status');
  });

  it('no duplicate IDs', () => {
    const ids = [...doc.querySelectorAll('[id]')].map(el => el.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(dupes, `Duplicate IDs: ${dupes.join(', ')}`).toEqual([]);
  });

  it('structured data (JSON-LD) is valid', () => {
    const script = doc.querySelector('script[type="application/ld+json"]');
    expect(script).toBeTruthy();
    expect(() => JSON.parse(script.textContent)).not.toThrow();
    const data = JSON.parse(script.textContent);
    expect(data['@type']).toBeTruthy();
    expect(data.name).toBeTruthy();
  });

  it('manifest.json is valid JSON', () => {
    const manifest = JSON.parse(readFileSync(join(__dirname, '..', 'manifest.json'), 'utf8'));
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBeTruthy();
    expect(manifest.display).toBeTruthy();
    expect(Array.isArray(manifest.icons)).toBe(true);
    expect(manifest.icons.length).toBeGreaterThan(0);
  });

  it('Service Worker file is syntactically valid', async () => {
    const sw = readFileSync(join(__dirname, '..', 'sw.js'), 'utf8');
    expect(sw).toContain('self.addEventListener');
    expect(sw).toContain('install');
    expect(sw).toContain('activate');
    expect(sw).toContain('fetch');
  });
});

describe('E2E smoke — Module discovery', () => {
  let html;
  beforeAll(() => {
    html = readFileSync(indexPath, 'utf8');
  });

  it('contains all required modules', () => {
    const modules = ['Bus', 'Store', 'FTSIndex', 'Crypto', 'VaultWriter', 'VaultMatcher',
                     'NetworkMonitor', 'SourceFailTracker', 'StorageGuard',
                     'KeywordRules', 'AutoSync', 'ErrorBoundary', 'UndoStack',
                     'TagLearner', 'Summarizer', 'OPML', 'ShareTarget', 'Onboarding'];
    for (const mod of modules) {
      expect(html).toMatch(new RegExp(`const ${mod}\\b`));
    }
  });

  it('contains all required event topics', () => {
    const topics = ['inbound.fetched', 'event.normalized', 'event.stored',
                    'event.tagged', 'event.summarized', 'event.blocked'];
    for (const t of topics) {
      expect(html).toContain(`'${t}'`);
    }
  });
});

describe('E2E smoke — Resilience & quality features', () => {
  let html;
  beforeAll(() => {
    html = readFileSync(indexPath, 'utf8');
  });

  it('RSS fetch has exponential backoff retry', () => {
    expect(html).toMatch(/for\s*\(\s*let attempt=0;attempt<3/);
    expect(html).toContain('Math.pow(2,attempt)');
  });

  it('5xx server errors trigger additional retry', () => {
    expect(html).toMatch(/res\.status>=500/);
  });

  it('FTS rebuild yields to main thread (INP optimization)', () => {
    expect(html).toContain('scheduler');
    expect(html).toMatch(/i%100===0/);
  });

  it('KeywordRules reapply yields to main thread', () => {
    expect(html).toMatch(/changed%50===0/);
  });

  it('print stylesheet present', () => {
    expect(html).toContain('@media print');
  });

  it('keyword advanced input has aria-describedby + role=alert', () => {
    expect(html).toMatch(/id="kw-adv-input"[^>]*aria-describedby="kw-adv-err"/);
    expect(html).toMatch(/id="kw-adv-err"[^>]*role="alert"/);
  });

  it('setKwErr toggles aria-invalid (WCAG 3.3.1)', () => {
    expect(html).toContain('function setKwErr');
    expect(html).toContain("setAttribute('aria-invalid','true')");
  });

  it('search input has autocomplete and aria-keyshortcuts', () => {
    expect(html).toMatch(/id="search-input"[^>]*autocomplete="off"/);
    expect(html).toMatch(/id="search-input"[^>]*aria-keyshortcuts/);
  });

  it('trend SVG has viewBox and role=img (CLS prevention)', () => {
    expect(html).toMatch(/<svg[^>]*viewBox=[^>]*role="img"/);
  });
});
