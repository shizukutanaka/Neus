// Regression: every BYOK provider endpoint declared in index.html's CONFIG.byokDefaults
// must be present in the connect-src directive of BOTH _headers and the index.html meta CSP.
// v0.13.0 added qwen / gemma / glm / ollama providers but connect-src was hard-coded to the
// original three origins, so those providers were blocked by CSP at runtime.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

const html = readFileSync('index.html', 'utf8');
const headers = readFileSync('_headers', 'utf8');

function connectSrcOf(text) {
  const m = text.match(/connect-src ([^;]+)/);
  expect(m, 'connect-src directive not found').toBeTruthy();
  return m[1].trim().split(/\s+/);
}

function byokOrigins() {
  const out = new Set();
  for (const m of html.matchAll(/endpoint\s*:\s*'(https?:\/\/[^'/]+)/g)) out.add(m[1]);
  return [...out];
}

describe('CSP connect-src covers BYOK provider endpoints', () => {
  const origins = byokOrigins();

  it('finds the declared BYOK endpoints', () => {
    expect(origins.length).toBeGreaterThanOrEqual(3);
  });

  it('_headers allows every BYOK origin', () => {
    const allowed = connectSrcOf(headers);
    for (const o of origins) expect(allowed, `_headers connect-src missing ${o}`).toContain(o);
  });

  it('index.html meta CSP allows every BYOK origin', () => {
    const metaLine = html.split('\n').find(l => l.includes('http-equiv') && l.includes('Content-Security-Policy'));
    expect(metaLine, 'meta CSP not found in index.html').toBeTruthy();
    const allowed = connectSrcOf(metaLine);
    for (const o of origins) expect(allowed, `meta CSP connect-src missing ${o}`).toContain(o);
  });
});
