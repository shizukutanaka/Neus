#!/usr/bin/env node
// Neus — HTML integrity checker (CI gate)
// Validates index.html without a browser.

import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeFileSync } from 'fs';

const html = readFileSync('index.html', 'utf8');
const errors = [];

function check(label, condition, detail = '') {
  if (!condition) {
    errors.push(`[FAIL] ${label}${detail ? ': ' + detail : ''}`);
  } else {
    process.stdout.write(`[OK]   ${label}\n`);
  }
}

// Syntax check: extract JS and verify with node --check
const m = html.match(/<script type="module">([\s\S]*?)<\/script>/);
if (m) {
  const tmpFile = join(tmpdir(), 'neus-check.mjs');
  writeFileSync(tmpFile, m[1]);
  try {
    execSync(`node --check ${tmpFile}`, { stdio: 'pipe' });
    check('JS syntax (node --check)', true);
  } catch (err) {
    check('JS syntax (node --check)', false, err.stderr?.toString().slice(0, 100));
  }
} else {
  check('Script tag found', false, 'no <script type="module"> found');
}

// Security checks
check('No localStorage',   !html.includes('localStorage'));
check('No sessionStorage', !html.includes('sessionStorage'));
check('No eval()',         !html.includes('eval('));
check('No innerHTML XSS', !html.includes("innerHTML = req") && !html.includes("innerHTML=req"));
check('escapeHtml present', html.includes('escapeHtml'));
check('Password input type', html.includes('type="password"'));
check('Anthropic direct-browser header', html.includes('anthropic-dangerous-direct-browser-access'));
check('No emoji in code',  !/[\u{1F300}-\u{1FAFF}]/u.test(html));

// PWA checks
check('manifest link',       html.includes('rel="manifest"'));
check('theme-color meta',    html.includes('name="theme-color"'));
check('apple-touch-icon',    html.includes('apple-touch-icon'));
check('apple-mobile-web-app-capable', html.includes('apple-mobile-web-app-capable'));
check('SW registration',     html.includes('serviceWorker.register'));
// Share Target is declared in manifest.json (separate file)
import { existsSync } from 'fs';
const manifestExists = existsSync('manifest.json');
if(manifestExists){
  const manifest = JSON.parse(readFileSync('manifest.json','utf8'));
  check('Share Target manifest', !!manifest.share_target);
}else{check('Share Target manifest', false, 'manifest.json not found');}

// Performance checks
check('Font preconnect',     html.includes('fonts.googleapis.com'));
check('Font preconnect gstatic', html.includes('fonts.gstatic.com'));
check('color-scheme meta',   html.includes('color-scheme'));
check('Perf.mark usage',     html.includes('Perf.mark'));

// i18n checks
check('DICT ja present',    html.includes("ja:"));
check('DICT en present',    html.includes("en:"));
check('t() function',       html.includes('const t='));

// Architecture checks
check('Event Bus',          html.includes('const Bus'));
check('IndexedDB Store',    html.includes('const Store'));
check('FTSIndex',           html.includes('const FTSIndex'));
check('VaultMatcher',       html.includes('const VaultMatcher'));
check('VaultWriter',        html.includes('const VaultWriter'));
check('Crypto (AES-GCM)',   html.includes('const Crypto'));
check('NetworkMonitor',     html.includes('const NetworkMonitor'));
check('StorageGuard',       html.includes('const StorageGuard'));
check('ShareTarget',        html.includes('const ShareTarget'));
check('Onboarding',         html.includes('const Onboarding'));

// v0.2.0 modules
check('KeywordRules',       html.includes('const KeywordRules'));
check('AutoSync',           html.includes('const AutoSync'));
check('ErrorBoundary',      html.includes('const ErrorBoundary'));
check('UndoStack',          html.includes('const UndoStack'));
check('Digest renderer',    html.includes('async function renderDigest'));

// Accessibility (WCAG 2.1 AA)
check('skip-link present',         html.includes('class="skip-link"'));
check('main role=main',            /id="view"[^>]*role="main"/.test(html));
check('main aria-live',            /id="view"[^>]*aria-live="polite"/.test(html));
check('nav role=tablist',          html.includes('role="tablist"'));
check('all modals have role=dialog',(html.match(/class="modal"/g)||[]).length === (html.match(/class="modal"[^>]*role="(?:dialog|alertdialog)"/g)||[]).length);
check('all modals have aria-modal', (html.match(/role="(?:dialog|alertdialog)"/g)||[]).length === (html.match(/role="(?:dialog|alertdialog)"[^>]*aria-modal="true"/g)||[]).length);
check('prefers-reduced-motion',    html.includes('prefers-reduced-motion'));
check('focus-visible enhanced',    /\:focus-visible\{[^}]*outline:\s*3px/.test(html));
check('search input aria-label',   /id="search-input"[^>]*aria-label/.test(html));
check('toast role=status',         /id="toast"[^>]*role="status"/.test(html));

// Security
check('escapeHtml usage',          /const escapeHtml=/.test(html));
check('escapeAttr usage',          /const escapeAttr=/.test(html));
check('no innerHTML with raw input', !/\.innerHTML\s*=\s*[a-zA-Z_]+\.content\.title/.test(html));
check('SSRF protection in worker', readFileSync('_worker.js', 'utf8').includes('PRIVATE_HOST_RE'));
check('Conditional GET (worker 304 relay)', readFileSync('_worker.js', 'utf8').includes('if-none-match') && /status === 304/.test(readFileSync('_worker.js', 'utf8')));
check('Conditional GET (client skip)', html.includes('If-None-Match') && /res\.status===304/.test(html));

// Resilience & 100-point quality
check('RSS retry with backoff',    /attempt<3/.test(html) && html.includes('Math.pow(2,attempt)'));
check('FTS rebuild yields (INP)',  html.includes('scheduler') && /i%100===0/.test(html));
check('print stylesheet',          html.includes('@media print'));
check('WCAG 3.3.1 form errors',    html.includes('function setKwErr') && html.includes("aria-describedby=\"kw-adv-err\""));
check('search autocomplete+keyshortcut', /id="search-input"[^>]*autocomplete="off"/.test(html));
check('trend SVG CLS-safe',        /<svg[^>]*viewBox=[^>]*role="img"/.test(html));
check('no boolean IDBKeyRange (init-breaking)', !/IDBKeyRange\.only\((?:true|false)\)/.test(html));
check('no currentFilter typo (use activeFilter)', !/\bcurrentFilter\b/.test(html));
check('test hook gated behind ?test', !html.includes('window.__neus') || html.includes("URLSearchParams(location.search).has('test')"));
check('SW ready has timeout guard',  html.includes('serviceWorker.ready') ? /Promise\.race\(\[[\s\S]{0,200}serviceWorker\.ready/.test(html) : true);
check('Esc closes modal from inputs', /tag==='INPUT'[\s\S]{0,300}anyModal\.classList\.remove\('show'\)/.test(html));
check('scheduler.yield awaited correctly (no hang)', !/new Promise\(r=>\('scheduler' in window/.test(html));
check('InterestProfile module present', html.includes('const InterestProfile=') && html.includes('scoreBoost'));
check('star/archive feed InterestProfile', /InterestProfile\.learn\(ev,'pos'/.test(html) && /InterestProfile\.learn\(ev,'neg'/.test(html));
check('RSS tolerant parse (bozo pattern)', html.includes('skip malformed item') || /for\(const item of nodes\)/.test(html));
check('RSS decodes HTML entities', html.includes('function decodeEntities'));
check('persistent storage requested', html.includes('navigator.storage.persist') && html.includes('requestPersist'));
check('card swipe gestures', html.includes('SWIPE_THRESHOLD') && html.includes('endSwipe'));
check('PWA install promotion', html.includes('beforeinstallprompt') && html.includes('InstallPromo') && html.includes('install-banner'));
check('overflow menu (mobile header)', html.includes('overflow-menu') && html.includes('btn-menu') && /aria-haspopup="true"/.test(html));
try {
  const mf = JSON.parse(readFileSync('manifest.json', 'utf8'));
  const maskable = mf.icons.filter(i => i.purpose.split(' ').includes('maskable'));
  check('manifest has dedicated maskable icon', maskable.length === 1 && maskable[0].purpose === 'maskable');
} catch { check('manifest.json valid JSON', false); }
check('POLL stays outside overflow menu', /<button id="btn-poll"[\s\S]{0,40}>POLL<\/button>\s*<div class="menu-wrap">/.test(html));
check('SW shell stale-while-revalidate', readFileSync('sw.js', 'utf8').includes('stale-while-revalidate') && /SHELL\.includes[\s\S]{0,400}cache\.put/.test(readFileSync('sw.js', 'utf8')));
check('SW shell uses ignoreSearch (offline query URLs)', readFileSync('sw.js', 'utf8').includes('ignoreSearch'));

// Size check
const sizeKB = Buffer.byteLength(html, 'utf8') / 1024;
check(`index.html ≤ 500KB (${sizeKB.toFixed(1)}KB)`, sizeKB <= 500);

// CSP hash integrity: _headers のハッシュが現在のindex.htmlのインラインスクリプトと一致するか。
// ズレると本番(ハッシュベースCSP)でスクリプトがブロックされアプリが壊れる致命的問題。
check('CSP meta present', html.includes('http-equiv="Content-Security-Policy"'));
try {
  const headers = readFileSync('_headers', 'utf8');
  const { createHash } = await import('crypto');
  const scriptRe = /<script(?![^>]*\bsrc\s*=)([^>]*)>([\s\S]*?)<\/script>/g;
  let m, allMatch = true, count = 0;
  while ((m = scriptRe.exec(html)) !== null) {
    if (m[2].trim().length === 0) continue;
    count++;
    const h = `sha256-${createHash('sha256').update(m[2], 'utf8').digest('base64')}`;
    if (!headers.includes(h)) allMatch = false;
  }
  check(`_headers CSP hashes match all ${count} inline scripts`, allMatch && count > 0);
} catch {
  check('_headers readable for CSP check', false);
}

if (errors.length > 0) {
  console.error(`\n${errors.join('\n')}`);
  console.error(`\n${errors.length} check(s) failed.`);
  process.exit(1);
}
console.log(`\nAll checks passed.`);
