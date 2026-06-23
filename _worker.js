/**
 * Neus CORS Proxy — Cloudflare Worker
 *
 * STATELESS. No logging. No storage.
 *
 * Endpoints:
 *   GET /rss?url=<encoded>  — Fetch RSS/Atom feed and relay with CORS headers
 *   GET /json?url=<encoded> — Fetch JSON from an allowlisted host (Wikipedia) and relay
 *   GET /                   — Health check
 *
 * Constraints:
 *   - /rss Content-Type must match xml|rss|atom
 *   - /json target host must be on JSON_HOST_ALLOW (Wikipedia/Wikimedia + qiita.com per ADR-0017)
 *   - Target URL must be http(s)
 *   - No private IP ranges (SSRF prevention)
 *   - No persistent state, no logs
 */

const RSS_CONTENT_RE = /xml|rss|atom|application\/feed/i;
// /json は信頼ドメインのみ許可(任意JSONの汎用プロキシ化を防ぐ)。
// wikipedia/wikimedia: 単語の定義カード。qiita.com: 公式 REST API v2 の全文検索(ADR-0017)。
const JSON_HOST_ALLOW = /(^|\.)(wikipedia\.org|wikimedia\.org|qiita\.com)$/i;
const MAX_SIZE = 5 * 1024 * 1024; // 5MB
const TIMEOUT_MS = 15000;

// Private/internal IP ranges — SSRF prevention.
// WHATWG URL normalizes IPv4-mapped IPv6 to pure hex before this check runs,
// e.g. [::ffff:127.0.0.1] → [::ffff:7f00:1]. Match both the plain IPv4 dotted
// form (belt) and the hex-normalized IPv6 form (suspenders):
//   127.x.x.x  → ::ffff:7f??:????  → \[::ffff:7f
//   10.x.x.x   → ::ffff:0a??:????  → \[::ffff:a[0-9a-f][0-9a-f]:
//   192.168.x.x → ::ffff:c0a8:??   → \[::ffff:c0a8:
//   172.16-31.x → ::ffff:ac1[0-f]: → \[::ffff:ac1[0-9a-f]:
//   169.254.x.x → ::ffff:a9fe:??   → \[::ffff:a9fe:
const PRIVATE_HOST_RE = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|169\.254\.|0\.0\.0\.0|\[::1\]|\[::ffff:(7f|a[0-9a-f][0-9a-f]:|c0a8:|ac1[0-9a-f]:|a9fe:)|\[fc|\[fd|\[fe80)/i;

// Read a response body up to MAX_SIZE bytes. Returns the ArrayBuffer or null if
// Content-Length already exceeds the limit, or if the buffered body exceeds it.
// Enforces the size limit even when Content-Length is absent (chunked encoding).
async function readCapped(res) {
  const cl = res.headers.get('content-length');
  if (cl && Number(cl) > MAX_SIZE) return null;
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_SIZE) return null;
  return buf;
}

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'content-type, if-none-match, if-modified-since',
    'access-control-expose-headers': 'etag, last-modified',
    'access-control-max-age': '86400',
  };
}

function jsonErr(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders() },
  });
}

function validateTarget(raw) {
  let u;
  try { u = new URL(raw); } catch { return [null, 'invalid_url']; }
  if (!/^https?:$/.test(u.protocol)) return [null, 'invalid_protocol'];
  if (PRIVATE_HOST_RE.test(u.hostname)) return [null, 'private_host_forbidden'];
  return [u, null];
}

async function handleRSS(request) {
  const url = new URL(request.url);
  const target = url.searchParams.get('url');
  if (!target) return jsonErr(400, 'missing_url_param');

  const [u, err] = validateTarget(target);
  if (err) return jsonErr(400, err);

  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  // Conditional GET: クライアントの検証子をupstreamに転送し、帯域を節約する。
  const reqHeaders = {
    'user-agent': 'Neus-Proxy/1.0 (+https://github.com/shizukutanaka/neus)',
    'accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml',
  };
  const inm = request.headers.get('if-none-match');
  const ims = request.headers.get('if-modified-since');
  if (inm) reqHeaders['if-none-match'] = inm;
  if (ims) reqHeaders['if-modified-since'] = ims;

  let upstream;
  try {
    upstream = await fetch(u.toString(), {
      headers: reqHeaders,
      signal: ctrl.signal,
      redirect: 'follow',
      cf: { cacheTtl: 300, cacheEverything: false },
    });
  } catch (e) {
    clearTimeout(to);
    return jsonErr(502, 'upstream_fetch_failed');
  }
  clearTimeout(to);

  // 304 Not Modified: 変更なし。検証子だけ返してボディは空(帯域節約)
  if (upstream.status === 304) {
    return new Response(null, {
      status: 304,
      headers: {
        ...(upstream.headers.get('etag') ? { 'etag': upstream.headers.get('etag') } : {}),
        ...(upstream.headers.get('last-modified') ? { 'last-modified': upstream.headers.get('last-modified') } : {}),
        ...corsHeaders(),
      },
    });
  }

  if (!upstream.ok) return jsonErr(upstream.status, 'upstream_status');

  const ct = upstream.headers.get('content-type') || '';
  if (!RSS_CONTENT_RE.test(ct)) return jsonErr(415, 'unsupported_content_type');

  // Size guard: enforced on the buffered body so chunked/no-Content-Length responses
  // are capped too (old Content-Length-only check silently passed unbounded streams).
  const buf = await readCapped(upstream);
  if (!buf) return jsonErr(413, 'too_large');

  // upstreamの検証子をクライアントへ中継(次回のConditional GET用)
  const etag = upstream.headers.get('etag');
  const lastMod = upstream.headers.get('last-modified');
  return new Response(buf, {
    status: 200,
    headers: {
      'content-type': ct,
      'cache-control': 'no-store',
      ...(etag ? { 'etag': etag } : {}),
      ...(lastMod ? { 'last-modified': lastMod } : {}),
      ...corsHeaders(),
    },
  });
}

async function handleJSON(request) {
  const url = new URL(request.url);
  const target = url.searchParams.get('url');
  if (!target) return jsonErr(400, 'missing_url_param');

  const [u, err] = validateTarget(target);
  if (err) return jsonErr(400, err);
  if (!JSON_HOST_ALLOW.test(u.hostname)) return jsonErr(403, 'host_not_allowed');

  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  let upstream;
  try {
    upstream = await fetch(u.toString(), {
      headers: {
        'user-agent': 'Neus-Proxy/1.0 (+https://github.com/shizukutanaka/neus)',
        'accept': 'application/json',
      },
      signal: ctrl.signal,
      redirect: 'follow',
      cf: { cacheTtl: 300, cacheEverything: false },
    });
  } catch (e) {
    clearTimeout(to);
    return jsonErr(502, 'upstream_fetch_failed');
  }
  clearTimeout(to);

  if (!upstream.ok) return jsonErr(upstream.status, 'upstream_status');

  const ct = upstream.headers.get('content-type') || '';
  if (!/json/i.test(ct)) return jsonErr(415, 'unsupported_content_type');

  const buf = await readCapped(upstream);
  if (!buf) return jsonErr(413, 'too_large');

  return new Response(buf, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...corsHeaders(),
    },
  });
}

function handleRoot() {
  return new Response(JSON.stringify({
    service: 'neus-proxy',
    stateless: true,
    logs: false,
    endpoints: ['/rss?url=', '/json?url='],
  }), {
    status: 200,
    headers: { 'content-type': 'application/json', ...corsHeaders() },
  });
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (request.method !== 'GET') {
      return jsonErr(405, 'method_not_allowed');
    }

    const path = new URL(request.url).pathname;
    if (path === '/rss') return handleRSS(request);
    if (path === '/json') return handleJSON(request);
    if (path === '/' || path === '') return handleRoot();
    return jsonErr(404, 'not_found');
  },
};
