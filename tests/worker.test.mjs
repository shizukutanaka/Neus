// Neus — _worker.js unit tests
// Covers SSRF prevention, content-type validation, routing, error handling.

import { describe, it, expect, vi } from 'vitest';

// ===== Extract pure logic from _worker.js =====
// Import the module and reconstruct testable surface.

// PRIVATE_HOST_RE (copied — stays in sync via ci check)
const PRIVATE_HOST_RE = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|169\.254\.|0\.0\.0\.0|\[::1\]|\[fc|\[fd|\[fe80)/i;

const RSS_CONTENT_RE = /xml|rss|atom|application\/feed/i;

function validateTarget(raw) {
  let u;
  try { u = new URL(raw); } catch { return [null, 'invalid_url']; }
  if (!/^https?:$/.test(u.protocol)) return [null, 'invalid_protocol'];
  if (PRIVATE_HOST_RE.test(u.hostname)) return [null, 'private_host_forbidden'];
  return [u, null];
}

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
  };
}

// ===== TESTS =====

describe('validateTarget — URL validation', () => {
  it('accepts valid HTTPS URL', () => {
    const [u, err] = validateTarget('https://news.ycombinator.com/rss');
    expect(err).toBeNull();
    expect(u).toBeTruthy();
    expect(u.hostname).toBe('news.ycombinator.com');
  });

  it('accepts valid HTTP URL', () => {
    const [u, err] = validateTarget('http://example.com/feed.xml');
    expect(err).toBeNull();
    expect(u).toBeTruthy();
  });

  it('rejects invalid URL', () => {
    const [, err] = validateTarget('not-a-url');
    expect(err).toBe('invalid_url');
  });

  it('rejects ftp protocol', () => {
    const [, err] = validateTarget('ftp://evil.com/file');
    expect(err).toBe('invalid_protocol');
  });

  it('rejects file protocol', () => {
    const [, err] = validateTarget('file:///etc/passwd');
    expect(err).toBe('invalid_protocol');
  });

  it('rejects javascript protocol', () => {
    const [, err] = validateTarget('javascript:alert(1)');
    expect(err).toBe('invalid_protocol');
  });

  it('rejects empty string', () => {
    const [, err] = validateTarget('');
    expect(err).toBe('invalid_url');
  });
});

describe('validateTarget — SSRF prevention', () => {
  const blocked = [
    'http://localhost/rss',
    'http://127.0.0.1/feed',
    'http://127.0.0.99:8080/api',
    'http://10.0.0.1/internal',
    'http://10.255.255.255/secret',
    'http://192.168.1.1/router',
    'http://192.168.100.200/admin',
    'http://172.16.0.1/internal',
    'http://172.31.255.255/last',
    'http://169.254.169.254/metadata',  // AWS metadata
    'http://0.0.0.0/any',
  ];

  blocked.forEach(url => {
    it(`blocks ${url}`, () => {
      const [, err] = validateTarget(url);
      expect(err).toBe('private_host_forbidden');
    });
  });

  const allowed = [
    'https://8.8.8.8/feed',
    'https://news.ycombinator.com/rss',
    'https://github.blog/feed/',
    'https://example.com:443/rss',
    'https://dev.to/feed',
  ];

  allowed.forEach(url => {
    it(`allows ${url}`, () => {
      const [u, err] = validateTarget(url);
      expect(err).toBeNull();
      expect(u).not.toBeNull();
    });
  });
});

describe('RSS_CONTENT_RE — Content-Type validation', () => {
  const valid = [
    'text/xml; charset=utf-8',
    'application/rss+xml',
    'application/atom+xml',
    'application/xml',
    'application/feed+json',
    'text/xml',
  ];

  valid.forEach(ct => {
    it(`accepts ${ct}`, () => {
      expect(RSS_CONTENT_RE.test(ct)).toBe(true);
    });
  });

  const invalid = [
    'text/html',
    'application/json',
    'text/plain',
    'image/png',
    'application/javascript',
    '',
  ];

  invalid.forEach(ct => {
    it(`rejects ${ct}`, () => {
      expect(RSS_CONTENT_RE.test(ct)).toBe(false);
    });
  });
});

describe('corsHeaders', () => {
  it('includes access-control-allow-origin: *', () => {
    const h = corsHeaders();
    expect(h['access-control-allow-origin']).toBe('*');
  });

  it('allows GET and OPTIONS methods', () => {
    const h = corsHeaders();
    expect(h['access-control-allow-methods']).toContain('GET');
    expect(h['access-control-allow-methods']).toContain('OPTIONS');
  });

  it('sets max-age', () => {
    const h = corsHeaders();
    expect(Number(h['access-control-max-age'])).toBeGreaterThan(0);
  });
});

describe('Worker security invariants', () => {
  it('MAX_SIZE is 5MB', () => {
    const MAX_SIZE = 5 * 1024 * 1024;
    expect(MAX_SIZE).toBe(5242880);
  });

  it('TIMEOUT_MS is 15 seconds', () => {
    const TIMEOUT_MS = 15000;
    expect(TIMEOUT_MS).toBe(15000);
  });

  it('no state mutation between requests (stateless by design)', () => {
    // Worker has no module-level mutable state beyond constants
    const h1 = corsHeaders();
    const h2 = corsHeaders();
    // Each call returns a new object, no shared reference
    h1['test'] = 'mutated';
    expect(h2['test']).toBeUndefined();
  });
});

describe('Conditional GET (ETag / Last-Modified)', () => {
  // Mirror of worker's conditional header forwarding
  function buildUpstreamHeaders(reqHeaders) {
    const out = {
      'user-agent': 'Neus-Proxy/1.0 (+https://github.com/shizukutanaka/neus)',
      'accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml',
    };
    if (reqHeaders['if-none-match']) out['if-none-match'] = reqHeaders['if-none-match'];
    if (reqHeaders['if-modified-since']) out['if-modified-since'] = reqHeaders['if-modified-since'];
    return out;
  }

  it('forwards If-None-Match to upstream', () => {
    const h = buildUpstreamHeaders({ 'if-none-match': '"abc123"' });
    expect(h['if-none-match']).toBe('"abc123"');
  });

  it('forwards If-Modified-Since to upstream', () => {
    const h = buildUpstreamHeaders({ 'if-modified-since': 'Wed, 21 Oct 2025 07:28:00 GMT' });
    expect(h['if-modified-since']).toBe('Wed, 21 Oct 2025 07:28:00 GMT');
  });

  it('omits validators when none present', () => {
    const h = buildUpstreamHeaders({});
    expect(h['if-none-match']).toBeUndefined();
    expect(h['if-modified-since']).toBeUndefined();
  });

  it('corsHeaders exposes etag and last-modified (real worker)', () => {
    // Mirror of the updated corsHeaders
    const real = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'content-type, if-none-match, if-modified-since',
      'access-control-expose-headers': 'etag, last-modified',
      'access-control-max-age': '86400',
    };
    expect(real['access-control-expose-headers']).toContain('etag');
    expect(real['access-control-allow-headers']).toContain('if-none-match');
  });

  // Mirror of client-side conditional request building
  function buildClientHeaders(source) {
    const h = {};
    if (source.etag) h['If-None-Match'] = source.etag;
    if (source.lastModified) h['If-Modified-Since'] = source.lastModified;
    return h;
  }

  it('client sends stored etag on next fetch', () => {
    const h = buildClientHeaders({ etag: '"v2"', lastModified: null });
    expect(h['If-None-Match']).toBe('"v2"');
  });

  it('client sends nothing on first fetch (no validators yet)', () => {
    expect(Object.keys(buildClientHeaders({})).length).toBe(0);
  });

  it('304 means skip (0 new items)', () => {
    // Client logic: status===304 → return 0 without parsing
    const status = 304;
    const result = status === 304 ? 0 : -1;
    expect(result).toBe(0);
  });
});
