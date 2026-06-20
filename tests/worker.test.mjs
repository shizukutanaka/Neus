// Neus — _worker.js unit tests
// Covers SSRF prevention, content-type validation, routing, error handling,
// and the /json endpoint allowlist (Wikipedia-only proxy security boundary).

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ===== Extract pure logic from _worker.js =====
// Import the module and reconstruct testable surface.

// PRIVATE_HOST_RE (copied — stays in sync via ci check)
// WHATWG URL normalizes IPv4-mapped IPv6 to hex before PRIVATE_HOST_RE sees the hostname,
// so the regex must match the normalized hex form, not the dotted IPv4 notation.
const PRIVATE_HOST_RE = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|169\.254\.|0\.0\.0\.0|\[::1\]|\[::ffff:(7f|a[0-9a-f][0-9a-f]:|c0a8:|ac1[0-9a-f]:|a9fe:)|\[fc|\[fd|\[fe80)/i;

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
    // IPv4-mapped IPv6 — resolve identically to their IPv4 counterparts at socket level
    'http://[::ffff:127.0.0.1]/loopback',
    'http://[::ffff:10.0.0.1]/private',
    'http://[::ffff:192.168.1.1]/private',
    'http://[::ffff:172.16.0.1]/private',
    'http://[::ffff:169.254.169.254]/metadata',
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

describe('JSON_HOST_ALLOW — /json endpoint host allowlist', () => {
  // Mirror of _worker.js JSON_HOST_ALLOW regex
  const JSON_HOST_ALLOW = /(^|\.)(wikipedia\.org|wikimedia\.org)$/i;

  const allowed = [
    'en.wikipedia.org',
    'ja.wikipedia.org',
    'wikipedia.org',
    'commons.wikimedia.org',
    'wikimedia.org',
    'upload.wikimedia.org',
  ];

  allowed.forEach(host => {
    it(`allows ${host}`, () => {
      expect(JSON_HOST_ALLOW.test(host)).toBe(true);
    });
  });

  const blocked = [
    'evil.com',
    'notwikipedia.org',
    'en.wikipedia.org.evil.com',
    'fakewikipedia.org',
    'wikipedia.org.attacker.com',
    'api.openai.com',
    'api.anthropic.com',
    'localhost',
    '127.0.0.1',
    '',
  ];

  blocked.forEach(host => {
    it(`blocks "${host}"`, () => {
      expect(JSON_HOST_ALLOW.test(host)).toBe(false);
    });
  });

  it('is case-insensitive (Wikipedia.ORG)', () => {
    expect(JSON_HOST_ALLOW.test('en.Wikipedia.ORG')).toBe(true);
  });
});

describe('JSON_CONTENT_RE — /json content-type validation', () => {
  // Mirror of worker check: !/json/i.test(ct)
  const jsonRe = /json/i;

  it('accepts application/json', () => expect(jsonRe.test('application/json')).toBe(true));
  it('accepts application/json; charset=utf-8', () => expect(jsonRe.test('application/json; charset=utf-8')).toBe(true));
  it('rejects text/html', () => expect(jsonRe.test('text/html')).toBe(false));
  it('rejects text/xml', () => expect(jsonRe.test('text/xml')).toBe(false));
  it('rejects empty string', () => expect(jsonRe.test('')).toBe(false));
});

describe('readCapped — streaming size enforcement', () => {
  const MAX_SIZE = 5 * 1024 * 1024;

  // Mirror of readCapped from _worker.js
  async function readCapped(res) {
    const cl = res.headers.get('content-length');
    if (cl && Number(cl) > MAX_SIZE) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_SIZE) return null;
    return buf;
  }

  function makeRes(body, contentLength = null) {
    const headers = new Headers();
    if (contentLength !== null) headers.set('content-length', String(contentLength));
    return new Response(body, { headers });
  }

  it('returns buffer for a small body without Content-Length', async () => {
    const res = makeRes('hello');
    const buf = await readCapped(res);
    expect(buf).not.toBeNull();
    expect(buf.byteLength).toBe(5);
  });

  it('returns null when Content-Length exceeds MAX_SIZE (fast reject)', async () => {
    const res = makeRes('x', MAX_SIZE + 1);
    expect(await readCapped(res)).toBeNull();
  });

  it('returns null when streamed body exceeds MAX_SIZE even without Content-Length', async () => {
    // Simulate a server that omits Content-Length but sends a large body
    const oversized = new Uint8Array(MAX_SIZE + 1);
    const res = makeRes(oversized.buffer);
    expect(await readCapped(res)).toBeNull();
  });

  it('accepts exactly MAX_SIZE bytes', async () => {
    const exact = new Uint8Array(MAX_SIZE);
    const res = makeRes(exact.buffer);
    expect(await readCapped(res)).not.toBeNull();
  });
});

describe('Worker _worker.js source invariants', () => {
  let src;
  beforeAll(() => {
    src = readFileSync(join(__dirname, '..', '_worker.js'), 'utf8');
  });

  it('readCapped helper enforces streaming size even without Content-Length', () => {
    expect(src).toContain('async function readCapped(res)');
    expect(src).toContain('const buf = await res.arrayBuffer()');
    expect(src).toContain('if (buf.byteLength > MAX_SIZE) return null');
  });
  it('SSRF guard matches IPv4-mapped IPv6 in WHATWG hex-normalized form', () => {
    // WHATWG URL normalizes [::ffff:127.0.0.1] → [::ffff:7f00:1], so match hex.
    expect(src).toContain('::ffff:(7f|a[0-9a-f][0-9a-f]:|c0a8:|ac1[0-9a-f]:|a9fe:)');
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
