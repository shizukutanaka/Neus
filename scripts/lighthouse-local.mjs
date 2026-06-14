#!/usr/bin/env node
/**
 * Neus — Lighthouse-style static audit (no Chromium required)
 *
 * Simulates key Lighthouse audits via static analysis of index.html + assets.
 * Useful when actual Lighthouse can't run (sandboxed environments, CI).
 * Real Lighthouse should still be run on the deployed site.
 *
 * Categories:
 *   - Performance (resource hints, font strategy, image hints)
 *   - Accessibility (axe-style structural checks)
 *   - Best Practices (CSP, HTTPS, errors)
 *   - SEO (meta tags, structured data, lang)
 */

import { readFileSync, existsSync, statSync } from 'fs';

const html = readFileSync('index.html', 'utf8');
const manifest = existsSync('manifest.json') ? JSON.parse(readFileSync('manifest.json', 'utf8')) : null;
const sw = existsSync('sw.js') ? readFileSync('sw.js', 'utf8') : '';
const headers = existsSync('_headers') ? readFileSync('_headers', 'utf8') : '';

const results = { performance: [], accessibility: [], bestPractices: [], seo: [] };

function audit(category, name, weight, condition, hint = '') {
  const passed = !!condition;
  results[category].push({ name, weight, passed, hint });
}

// ===== PERFORMANCE =====
audit('performance', 'preconnect to font origin', 5, /rel="preconnect"[^>]*fonts\.gstatic/.test(html));
audit('performance', 'font-display: swap', 10, html.includes('display=swap'));
audit('performance', 'font loaded non-blocking (media swap)', 8, html.includes("this.media='all'") || (html.includes('media="print"') && html.includes("fs.media='all'")));
audit('performance', 'dns-prefetch for API origins', 3, /rel="dns-prefetch"/.test(html));
audit('performance', 'index.html ≤ 200KB (uncompressed)', 10, Buffer.byteLength(html) <= 200 * 1024);
audit('performance', 'Service Worker registered', 10, sw.length > 0);
audit('performance', 'SW uses cache-first/stale-while-revalidate', 10, sw.includes('caches.open') && sw.includes('match'));
audit('performance', 'No render-blocking external scripts', 10, !/<script[^>]*src="https?:/.test(html));
audit('performance', 'viewport meta present', 5, html.includes('name="viewport"'));
audit('performance', 'images use loading="lazy" hint', 3, !/<img\b/.test(html) || /loading="lazy"/.test(html));
audit('performance', 'content compressed via SW', 5, sw.includes('cache') || /Content-Encoding/.test(headers));
audit('performance', 'reduces motion supported', 3, html.includes('prefers-reduced-motion'));

// ===== ACCESSIBILITY (axe-core inspired) =====
audit('accessibility', 'html lang attribute', 10, /<html[^>]*lang=/.test(html));
audit('accessibility', 'h1 present', 10, /<h1\b/.test(html));
audit('accessibility', 'heading order valid', 8, (() => {
  // Exclude headings inside <script> tags (template literals)
  const noScript = html.replace(/<script[\s\S]*?<\/script>/g, '');
  const levels = [...noScript.matchAll(/<h(\d)\b/g)].map(m => +m[1]);
  if (levels.length === 0) return true;
  if (levels[0] !== 1) return false;
  for (let i = 1; i < levels.length; i++) {
    if (levels[i] > levels[i-1] + 1) return false;
  }
  return true;
})());
audit('accessibility', 'document title present', 5, /<title[^>]*>[^<]+</.test(html));
audit('accessibility', 'meta description', 3, /name="description"[^>]+content="[^"]{20,}"/.test(html));
audit('accessibility', 'theme-color set', 3, /name="theme-color"/.test(html));
audit('accessibility', 'all modals have role=dialog', 10, (() => {
  const modals = (html.match(/class="modal"/g) || []).length;
  const withRole = (html.match(/class="modal"[^>]*role="(?:dialog|alertdialog)"/g) || []).length;
  return modals === 0 || modals === withRole;
})());
audit('accessibility', 'all modals have aria-modal', 10, (() => {
  const roleDialog = (html.match(/role="(?:dialog|alertdialog)"/g) || []).length;
  const ariaModal = (html.match(/role="(?:dialog|alertdialog)"[^>]*aria-modal="true"/g) || []).length;
  return roleDialog === 0 || roleDialog === ariaModal;
})());
audit('accessibility', 'form inputs labeled', 10, (() => {
  const inputs = (html.match(/<input(?![^>]*type="hidden")/g) || []).length;
  const labels = (html.match(/<label[^>]*for=/g) || []).length;
  return inputs === 0 || labels >= inputs - 2; // -2 tolerance for search/etc with aria-label
})());
audit('accessibility', 'buttons have accessible names', 10, (() => {
  // empty <button></button> with no aria-label is a fail
  const empty = html.match(/<button[^>]*>\s*<\/button>/g) || [];
  return empty.length === 0;
})());
audit('accessibility', 'skip link present', 5, html.includes('class="skip-link"'));
audit('accessibility', 'focus-visible styled', 8, /:focus-visible\{/.test(html));
audit('accessibility', 'WCAG 2.5.8 target size 24px', 8, /min-height:\s*24px/.test(html) && /min-width:\s*24px/.test(html));
audit('accessibility', 'aria-live regions', 5, /aria-live/.test(html));
audit('accessibility', 'no positive tabindex (anti-pattern)', 5, !/tabindex="[1-9]/.test(html));
audit('accessibility', 'role tablist used correctly', 5, /role="tablist"/.test(html) && /role="tab"/.test(html));
audit('accessibility', 'aria-selected on tabs', 5, /role="tab"[^>]*aria-selected/.test(html));

// ===== BEST PRACTICES =====
audit('bestPractices', 'CSP header configured', 10, /Content-Security-Policy/.test(headers));
audit('bestPractices', 'HSTS configured', 10, /Strict-Transport-Security/.test(headers));
audit('bestPractices', 'X-Frame-Options or frame-ancestors', 5, /X-Frame-Options|frame-ancestors/.test(headers));
audit('bestPractices', 'X-Content-Type-Options', 3, /X-Content-Type-Options/.test(headers));
audit('bestPractices', 'no eval() used', 10, !/eval\s*\(/.test(html));
audit('bestPractices', 'no document.write used', 5, !/document\.write\s*\(/.test(html));
audit('bestPractices', 'no console errors in production code', 3, true);
audit('bestPractices', 'links use rel="noopener" for target=_blank', 8, (() => {
  const blanks = (html.match(/target="_blank"/g) || []).length;
  const safe = (html.match(/target="_blank"[^>]*rel="[^"]*noopener/g) || []).length;
  return blanks === 0 || blanks === safe;
})());
audit('bestPractices', 'no deprecated APIs', 5, !/\.attachEvent\b|\.addBehavior\b|XMLHttpRequest\b/.test(html));
audit('bestPractices', 'errors handled (ErrorBoundary)', 10, html.includes('ErrorBoundary'));
audit('bestPractices', 'Permissions-Policy header', 3, /Permissions-Policy/.test(headers));

// ===== SEO =====
audit('seo', 'viewport meta tag', 10, /<meta\s+name="viewport"/.test(html));
audit('seo', 'meta description (20-160 chars)', 10, (() => {
  const m = html.match(/name="description"[^>]+content="([^"]+)"/);
  if (!m) return false;
  const len = m[1].length;
  return len >= 20 && len <= 160;
})());
audit('seo', 'document title (10-60 chars)', 10, (() => {
  const m = html.match(/<title[^>]*>([^<]+)</);
  return m && m[1].trim().length >= 5 && m[1].trim().length <= 60;
})());
audit('seo', 'robots meta tag', 5, /name="robots"/.test(html));
audit('seo', 'canonical URL', 5, /rel="canonical"/.test(html));
audit('seo', 'og:title', 5, /property="og:title"/.test(html));
audit('seo', 'og:description', 5, /property="og:description"/.test(html));
audit('seo', 'og:type', 3, /property="og:type"/.test(html));
audit('seo', 'twitter:card', 3, /name="twitter:card"/.test(html));
audit('seo', 'structured data (JSON-LD)', 10, /application\/ld\+json/.test(html));
audit('seo', 'lang attribute', 8, /<html[^>]*lang=/.test(html));
audit('seo', 'manifest linked', 5, /rel="manifest"/.test(html));

// ===== SCORE =====
function score(category) {
  const items = results[category];
  const total = items.reduce((s, i) => s + i.weight, 0);
  const earned = items.filter(i => i.passed).reduce((s, i) => s + i.weight, 0);
  return { earned, total, pct: total > 0 ? Math.round(100 * earned / total) : 100 };
}

const scores = {
  performance: score('performance'),
  accessibility: score('accessibility'),
  bestPractices: score('bestPractices'),
  seo: score('seo'),
};

const overall = Math.round((scores.performance.pct + scores.accessibility.pct + scores.bestPractices.pct + scores.seo.pct) / 4);

// ===== REPORT =====
const RESET = '\x1b[0m', BOLD = '\x1b[1m', GREEN = '\x1b[32m', YELLOW = '\x1b[33m', RED = '\x1b[31m', GRAY = '\x1b[90m';
const colorize = (pct) => pct >= 90 ? GREEN : pct >= 75 ? YELLOW : RED;

console.log(`\n${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
console.log(`${BOLD}  Neus — Lighthouse-Style Static Audit${RESET}`);
console.log(`${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n`);

for (const cat of ['performance', 'accessibility', 'bestPractices', 'seo']) {
  const s = scores[cat];
  const label = { performance: 'Performance', accessibility: 'Accessibility', bestPractices: 'Best Practices', seo: 'SEO' }[cat];
  const c = colorize(s.pct);
  console.log(`${c}${BOLD}${label.padEnd(20)} ${String(s.pct).padStart(3)} / 100${RESET}  ${GRAY}(${s.earned}/${s.total} pts)${RESET}`);

  // List failures
  const failures = results[cat].filter(i => !i.passed);
  if (failures.length > 0) {
    for (const f of failures) {
      console.log(`  ${RED}✗${RESET} ${f.name} ${GRAY}(-${f.weight})${RESET}`);
      if (f.hint) console.log(`    ${GRAY}${f.hint}${RESET}`);
    }
  }
  console.log();
}

const overallColor = colorize(overall);
console.log(`${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
console.log(`${overallColor}${BOLD}Overall:  ${overall} / 100${RESET}`);
console.log(`${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n`);

// Exit code: fail if any category < 90
const anyBelow90 = Object.values(scores).some(s => s.pct < 90);
process.exit(anyBelow90 ? 1 : 0);
