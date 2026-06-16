#!/usr/bin/env node
// Neus — Compute SHA-256 hashes for all inline scripts/styles
// and inject them into _headers to remove 'unsafe-inline'.

import { readFileSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';

const html = readFileSync('index.html', 'utf8');

function sha256Base64(content) {
  return createHash('sha256').update(content, 'utf8').digest('base64');
}

// Extract all <script>...</script> contents (excluding src=)
const scriptHashes = new Set();
const scriptRe = /<script(?![^>]*\bsrc\s*=)([^>]*)>([\s\S]*?)<\/script>/g;
let m;
while ((m = scriptRe.exec(html)) !== null) {
  const content = m[2];
  if (content.trim().length === 0) continue;
  scriptHashes.add(`'sha256-${sha256Base64(content)}'`);
}

// Extract all <style>...</style> contents
const styleHashes = new Set();
const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/g;
while ((m = styleRe.exec(html)) !== null) {
  const content = m[1];
  if (content.trim().length === 0) continue;
  styleHashes.add(`'sha256-${sha256Base64(content)}'`);
}

console.log(`Inline scripts: ${scriptHashes.size}`);
console.log(`Inline styles:  ${styleHashes.size}`);
for (const h of scriptHashes) console.log(`  script: ${h}`);
for (const h of styleHashes) console.log(`  style:  ${h}`);

// Build CSP
const scriptSrc = `script-src 'self' ${[...scriptHashes].join(' ')}`;
// Note: inline event handlers (onclick=) require 'unsafe-hashes' + hash, but we use addEventListener
// style-src needs 'unsafe-inline' for dynamic styles (toast color etc.) — keep for now, hash for static.
// To fully harden style-src, we'd need to eliminate all `element.style.X = ...` mutations.
const styleSrc = `style-src 'self' 'unsafe-inline'`; // pragmatic: keep style for now (dynamic styles ubiquitous)

const newCSP = `Content-Security-Policy: default-src 'self'; ${scriptSrc}; ${styleSrc} https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://api.anthropic.com https://api.openai.com https://generativelanguage.googleapis.com https://*.workers.dev; img-src 'self' data: blob: https://upload.wikimedia.org; media-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests`;

// Patch _headers
const headers = readFileSync('_headers', 'utf8');
const headerRe = /^  Content-Security-Policy:.*$/m;
if (!headerRe.test(headers)) {
  console.error('ERROR: Content-Security-Policy line not found in _headers');
  process.exit(1);
}
const patched = headers.replace(headerRe, `  ${newCSP}`);
writeFileSync('_headers', patched);
console.log('\n_headers updated with hash-based CSP (unsafe-inline removed from script-src)');
