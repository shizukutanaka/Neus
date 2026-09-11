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

// round 98: the two tests above check a lower bound only (every required origin is present).
// Nothing checked the upper bound. A stray origin added next to the real ones — a debugging
// leftover, a copy-paste from another project, a compromised build step — passed both tests
// above, because "contains the required set" says nothing about what else is there. connect-src
// is the one browser-enforced mechanism for CLAUDE.md invariant #1 (zero personal data leaves the
// device except to origins the user explicitly chose); an unbounded allowlist is a hole in the
// invariant itself, not just in test coverage of it.
//
// Confirmed red against the gap: with a rogue origin appended to connect-src in both files, the
// two describe blocks above stayed green (1830/1830) because every required origin was still
// present. Only an exact-set comparison catches an addition.
//
// The expected set is exactly: 'self', every BYOK origin, and the workers.dev wildcard for the
// user-deployed RSS/JSON proxy (CONFIG.proxy, round-tripped through /rss and /json — the one
// entry that is legitimately a wildcard, since each owner deploys their own subdomain and the
// literal value in CONFIG.proxy is a placeholder, not the real host). Nothing else has a reason
// to be there.
describe('CSP connect-src is exactly this set — nothing more (round 98)', () => {
  const expected = new Set(["'self'", ...byokOrigins(), 'https://*.workers.dev']);

  function assertExactSet(text, label) {
    const actual = new Set(connectSrcOf(text));
    const extra = [...actual].filter(o => !expected.has(o));
    const missing = [...expected].filter(o => !actual.has(o));
    expect(extra, `${label} connect-src has origins the app never declared: ${extra.join(', ')}`).toEqual([]);
    expect(missing, `${label} connect-src is missing declared origins: ${missing.join(', ')}`).toEqual([]);
  }

  it('_headers connect-src has no extra and no missing origins', () => {
    assertExactSet(headers, '_headers');
  });

  it('index.html meta CSP connect-src has no extra and no missing origins', () => {
    const metaLine = html.split('\n').find(l => l.includes('http-equiv') && l.includes('Content-Security-Policy'));
    expect(metaLine, 'meta CSP not found in index.html').toBeTruthy();
    assertExactSet(metaLine, 'meta CSP');
  });
});
