// Neus — safeHref security tests
// External URLs from RSS feeds and JSON imports are rendered as <a href>.
// escapeHtml() encodes HTML entities but does NOT prevent javascript: schemes,
// which execute code when clicked. safeHref() allows only http/https.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

function safeHref(url) {
  try { const p = new URL(url || '').protocol; return (p === 'https:' || p === 'http:') ? url : '#'; }
  catch { return '#'; }
}

describe('safeHref (modeled)', () => {
  it('allows https URLs through unchanged', () => {
    expect(safeHref('https://example.com/page')).toBe('https://example.com/page');
  });
  it('allows http URLs through unchanged', () => {
    expect(safeHref('http://example.com/page')).toBe('http://example.com/page');
  });
  it('blocks javascript: scheme', () => {
    expect(safeHref('javascript:alert(1)')).toBe('#');
  });
  it('blocks data: scheme', () => {
    expect(safeHref('data:text/html,<script>alert(1)</script>')).toBe('#');
  });
  it('returns # for empty/undefined', () => {
    expect(safeHref('')).toBe('#');
    expect(safeHref(undefined)).toBe('#');
  });
  it('returns # for relative paths (no scheme)', () => {
    expect(safeHref('/relative/path')).toBe('#');
  });
});

describe('safeHref wiring (index.html)', () => {
  it('defines safeHref near escapeHtml', () => {
    expect(html).toContain("const safeHref=(url)=>{try{const p=new URL(url||'').protocol;return(p==='https:'||p==='http:')?url:'#';}catch{return'#';}};");
  });
  it('uses safeHref in card title hrefs (both compact and detail views)', () => {
    expect(html).toContain('href="${escapeHtml(safeHref(ev.url))}"');
  });
  it('uses safeHref in falsifier-watch item links', () => {
    expect(html).toContain('href="${escapeAttr(safeHref(h.ev.url))}"');
  });
  it('uses safeHref for Wikipedia article link', () => {
    expect(html).toContain('href="${escapeHtml(safeHref(w.wiki.url))}"');
  });
  it('sanitizes event URLs in JSON import', () => {
    expect(html).toContain('if(ev.url)ev.url=safeHref(ev.url);');
  });
  it('sanitizes wiki URLs and thumbnails in JSON import', () => {
    expect(html).toContain('if(w.wiki){if(w.wiki.url)w.wiki.url=safeHref(w.wiki.url);if(w.wiki.thumbnail)w.wiki.thumbnail=safeHref(w.wiki.thumbnail);}');
  });
});
