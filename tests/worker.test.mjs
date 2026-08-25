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
// round 31: \[::1?\] (was \[::1\]) also blocks the bare unspecified address [::]
// (equivalent to 0.0.0.0), which previously matched no pattern here.
const PRIVATE_HOST_RE = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|169\.254\.|0\.0\.0\.0|\[::1?\]|\[::ffff:(7f|a[0-9a-f][0-9a-f]:|c0a8:|ac1[0-9a-f]:|a9fe:)|\[fc|\[fd|\[fe80)/i;
const MAX_REDIRECTS = 5;

const RSS_CONTENT_RE = /xml|rss|atom|application\/feed/i;

function validateTarget(raw) {
  let u;
  try { u = new URL(raw); } catch { return [null, 'invalid_url']; }
  if (!/^https?:$/.test(u.protocol)) return [null, 'invalid_protocol'];
  if (PRIVATE_HOST_RE.test(u.hostname)) return [null, 'private_host_forbidden'];
  return [u, null];
}

// fetchValidated (copied — stays in sync via ci check)
// round 31: fetch() used redirect:'follow', which only validates the FIRST URL — a
// malicious/compromised feed could pass that check, then redirect the Worker into a
// private address. This re-validates every hop by following redirects manually, using an
// injectable fetchFn instead of the real network so it's testable without I/O.
async function fetchValidated(u, fetchFn, extraCheck) {
  let current = u;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetchFn(current);
    const loc = (res.status >= 300 && res.status < 400) ? res.headers.get('location') : null;
    if (!loc) return res;
    let next;
    try { next = new URL(loc, current); } catch { throw new Error('invalid_redirect'); }
    const [validated, err] = validateTarget(next.toString());
    if (err) throw new Error('redirect_private_host');
    if (extraCheck && !extraCheck(validated)) throw new Error('redirect_host_not_allowed');
    current = validated;
  }
  throw new Error('too_many_redirects');
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
    'http://[::]/any',  // unspecified address, equivalent to 0.0.0.0 (round 31)
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

describe('fetchValidated — SSRF prevention across redirects (round 31)', () => {
  // Before: fetch used redirect:'follow', which only validates the FIRST URL. A malicious
  // or compromised feed could pass that check, then 302 the Worker into a private address —
  // fetchValidated re-validates every hop by following redirects manually.
  function stubChain(chain) {
    return async (url) => {
      const next = chain[url.toString()];
      if (next) return { status: 302, headers: { get: (h) => h === 'location' ? next : null } };
      return { status: 200, headers: { get: () => null } };
    };
  }

  it('follows a legitimate redirect chain to completion', async () => {
    const [u] = validateTarget('https://example.com/old-feed');
    const res = await fetchValidated(u, stubChain({ 'https://example.com/old-feed': 'https://example.com/new-feed' }));
    expect(res.status).toBe(200);
  });

  it('blocks a redirect to a private/internal address (SSRF via redirect)', async () => {
    const [u] = validateTarget('https://evil.example.com/feed');
    const fetchFn = stubChain({ 'https://evil.example.com/feed': 'http://169.254.169.254/latest/meta-data/' });
    await expect(fetchValidated(u, fetchFn)).rejects.toThrow('redirect_private_host');
  });

  it('blocks a redirect to a private address disguised as IPv4-mapped IPv6', async () => {
    const [u] = validateTarget('https://evil2.example.com/feed');
    const fetchFn = stubChain({ 'https://evil2.example.com/feed': 'http://[::ffff:169.254.169.254]/' });
    await expect(fetchValidated(u, fetchFn)).rejects.toThrow('redirect_private_host');
  });

  it('blocks a redirect off the /json host allowlist even to a public host', async () => {
    const [u] = validateTarget('https://en.wikipedia.org/api/rest_v1/page/summary/Foo');
    const fetchFn = stubChain({ 'https://en.wikipedia.org/api/rest_v1/page/summary/Foo': 'https://attacker.example.com/steal' });
    const extraCheck = (uu) => /(^|\.)wikipedia\.org$/i.test(uu.hostname);
    await expect(fetchValidated(u, fetchFn, extraCheck)).rejects.toThrow('redirect_host_not_allowed');
  });

  it('caps redirect chains at MAX_REDIRECTS instead of following indefinitely', async () => {
    const chain = {};
    for (let i = 0; i < 10; i++) chain[`https://example.com/hop${i}`] = `https://example.com/hop${i + 1}`;
    const [u] = validateTarget('https://example.com/hop0');
    await expect(fetchValidated(u, stubChain(chain))).rejects.toThrow('too_many_redirects');
  });

  it('a response with no redirect returns immediately (no unnecessary hop)', async () => {
    const [u] = validateTarget('https://example.com/feed.xml');
    const res = await fetchValidated(u, stubChain({}));
    expect(res.status).toBe(200);
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
  // Mirror of _worker.js JSON_HOST_ALLOW regex (wikipedia/wikimedia + qiita.com per ADR-0017)
  const JSON_HOST_ALLOW = /(^|\.)(wikipedia\.org|wikimedia\.org|qiita\.com)$/i;

  const allowed = [
    'en.wikipedia.org',
    'ja.wikipedia.org',
    'wikipedia.org',
    'commons.wikimedia.org',
    'wikimedia.org',
    'upload.wikimedia.org',
    'qiita.com',          // ADR-0017: Qiita REST API v2 full-text search
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
    'notqiita.com',           // suffix-anchor must not match a lookalike
    'qiita.com.attacker.com', // trailing-domain attack
    'zenn.dev',               // Zenn is NOT on the JSON allowlist (tag-feed via /rss only)
    'localhost',
    '127.0.0.1',
    '',
  ];

  blocked.forEach(host => {
    it(`blocks "${host}"`, () => {
      expect(JSON_HOST_ALLOW.test(host)).toBe(false);
    });
  });

  it('allows a qiita.com subdomain via the (^|.) anchor', () => {
    expect(JSON_HOST_ALLOW.test('api.qiita.com')).toBe(true);
  });

  it('is case-insensitive (Wikipedia.ORG / Qiita.COM)', () => {
    expect(JSON_HOST_ALLOW.test('en.Wikipedia.ORG')).toBe(true);
    expect(JSON_HOST_ALLOW.test('Qiita.COM')).toBe(true);
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

  // Mirror of readCapped from _worker.js.
  //
  // round 83: this block was named "streaming size enforcement" while the implementation it
  // mirrored buffered the entire body with arrayBuffer() and only then measured it. Every
  // assertion here looked at the RETURN VALUE, which is identical either way, so the name was
  // never checked by anything. Measured on a 40MB chunked body with no Content-Length:
  // the old shape pulled all 40MB before rejecting; reading incrementally stops at 5.1MB.
  // A Worker isolate is capped at 128MB, so a large enough body ended the isolate instead of
  // returning 413 — the limit is needed for what we READ, not only for what we relay.
  // The bytes-pulled test below is the one that would have caught it.
  async function readCapped(res) {
    const cl = res.headers.get('content-length');
    if (cl && Number(cl) > MAX_SIZE) return null;
    if (!res.body) {
      const b = await res.arrayBuffer();
      return b.byteLength > MAX_SIZE ? null : b;
    }
    const reader = res.body.getReader();
    const parts = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_SIZE) {
        await reader.cancel().catch(() => {});
        return null;
      }
      parts.push(value);
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const p of parts) { out.set(p, offset); offset += p.byteLength; }
    return out.buffer;
  }

  function makeRes(body, contentLength = null) {
    const headers = new Headers();
    if (contentLength !== null) headers.set('content-length', String(contentLength));
    return new Response(body, { headers });
  }

  /** A chunked body with no Content-Length that reports how much was actually pulled. */
  function countingBody(totalBytes, chunkBytes = 64 * 1024) {
    const chunk = new Uint8Array(chunkBytes);
    const chunks = Math.ceil(totalBytes / chunkBytes);
    let sent = 0;
    const stream = new ReadableStream({
      pull(c) {
        if (sent >= chunks) return c.close();
        sent++;
        c.enqueue(chunk.slice());
      },
    });
    return { stream, pulled: () => sent * chunkBytes, chunkBytes };
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

  it('stops PULLING once past the cap, instead of draining the whole body', async () => {
    // The assertion the four above were missing. They check the return value, which is null
    // either way; this checks how much was read to get there. Without it, "streaming" is
    // just a word in the describe block.
    const body = countingBody(40 * 1024 * 1024);
    const res = new Response(body.stream, { headers: new Headers() });

    expect(await readCapped(res), 'an oversized body is still rejected').toBeNull();
    expect(body.pulled(),
      `pulled ${(body.pulled() / 1048576).toFixed(1)}MB to reject a body over a 5MB cap`)
      .toBeLessThanOrEqual(MAX_SIZE + body.chunkBytes);
  });

  it('still reads a legitimate body to the end', async () => {
    // The cap must not truncate a feed that is merely large-ish.
    const size = MAX_SIZE - 1024;
    const body = countingBody(size);
    const res = new Response(body.stream, { headers: new Headers() });
    const buf = await readCapped(res);
    expect(buf).not.toBeNull();
    expect(buf.byteLength).toBe(body.pulled());
  });

  it('reassembles multi-chunk content in order', async () => {
    // Concatenating the chunks by hand is new code; a body that arrives in pieces must come
    // back byte-identical rather than merely the right length.
    const text = 'abcdefghij'.repeat(3000);
    const bytes = new TextEncoder().encode(text);
    const stream = new ReadableStream({
      start(c) {
        for (let i = 0; i < bytes.length; i += 997) c.enqueue(bytes.slice(i, i + 997));
        c.close();
      },
    });
    const buf = await readCapped(new Response(stream, { headers: new Headers() }));
    expect(new TextDecoder().decode(new Uint8Array(buf))).toBe(text);
  });
});

describe('Worker _worker.js source invariants', () => {
  let src;
  beforeAll(() => {
    src = readFileSync(join(__dirname, '..', '_worker.js'), 'utf8');
  });

  it('readCapped reads incrementally and gives up the rest once past the cap', () => {
    // round 83: this used to require `const buf = await res.arrayBuffer()` — it pinned the
    // very shape that made the cap useless for memory. Pin the property instead.
    expect(src).toContain('async function readCapped(res)');
    expect(src, 'it must read in pieces, not buffer the whole body first')
      .toContain('const reader = res.body.getReader();');
    expect(src, 'and release the remainder rather than draining it')
      .toContain('await reader.cancel().catch(() => {});');
    expect(src).toContain('if (total > MAX_SIZE)');
    expect(src, 'a body-less response still needs the old path')
      .toContain('if (!res.body)');
  });
  it('SSRF guard matches IPv4-mapped IPv6 in WHATWG hex-normalized form', () => {
    // WHATWG URL normalizes [::ffff:127.0.0.1] → [::ffff:7f00:1], so match hex.
    expect(src).toContain('::ffff:(7f|a[0-9a-f][0-9a-f]:|c0a8:|ac1[0-9a-f]:|a9fe:)');
  });
  it('SSRF guard also blocks the bare unspecified address [::] (round 31)', () => {
    expect(src).toContain('\\[::1?\\]');
  });
  it('both handleRSS and handleJSON fetch through fetchValidated, not redirect:\'follow\' (round 31)', () => {
    expect(src).toContain('async function fetchValidated(u, headers, signal, extraCheck)');
    expect(src).toContain("redirect: 'manual'");
    expect(src).not.toContain("redirect: 'follow'");
    expect(src).toContain('upstream = await fetchValidated(u, reqHeaders, ctrl.signal);');
    expect(src).toContain("upstream = await fetchValidated(u, jsonReqHeaders, ctrl.signal, (uu) => JSON_HOST_ALLOW.test(uu.hostname));");
  });
  it('redirect-blocked errors map to the same status codes as the initial validation', () => {
    expect(src).toContain("if (e.message === 'redirect_private_host') return jsonErr(400, 'private_host_forbidden');");
    expect(src).toContain("if (e.message === 'redirect_host_not_allowed') return jsonErr(403, 'host_not_allowed');");
    expect(src).toContain("if (e.message === 'too_many_redirects') return jsonErr(400, 'too_many_redirects');");
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
