// Neus — Crypto (AES-GCM + PBKDF2) round-trip tests
//
// round 97: these parameters used to be hard-coded here as 300000 and 12. They matched, but
// nothing held them together — and ADR-0021 exists precisely to change the iteration count
// (300k -> OWASP's 600k). Had it been accepted, `CONFIG.pbkdf2Iterations` would have moved
// while this file kept exercising the old value, and every test would have stayed green while
// testing a parameter the product no longer used. The most consequential path in the app, and
// its tests could have drifted off it silently — the round-94 hazard, sitting on the API key.
//
// The parameters are now read out of index.html, so changing CONFIG changes what is tested.
// The algorithm itself still has to be adapted (the real encrypt() fetches the salt from
// IndexedDB, which is not available here), so the anchors below pin the choices that the
// adaptation cannot verify: which config keys are used, and that no literal is used instead.
import { describe, it, expect } from 'vitest';
import { webcrypto } from 'crypto';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// jsdom env では crypto.subtle が limited — Node webcrypto を直接使用
const crypto = webcrypto;

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8');
const configNumber = (key) => {
  const m = html.match(new RegExp(`${key}\\s*:\\s*(\\d+)`));
  if (!m) throw new Error(`crypto test: CONFIG.${key} not found in index.html`);
  return Number(m[1]);
};

const PBKDF2_ITERATIONS = configNumber('pbkdf2Iterations');
const IV_LEN = configNumber('ivLen');

// ===== Crypto helpers adapted from index.html (parameters read from it) =====

async function deriveKey(passphrase, salt) {
  const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    km,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encrypt(text, passphrase, salt) {
  const key = await deriveKey(passphrase, salt);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
  const combined = new Uint8Array(IV_LEN + ct.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ct), IV_LEN);
  return btoa(String.fromCharCode(...combined));
}

async function decrypt(b64, passphrase, salt) {
  const combined = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const key = await deriveKey(passphrase, salt);
  const iv = combined.slice(0, IV_LEN);
  const ct = combined.slice(IV_LEN);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(pt);
}

describe('Crypto — AES-GCM round-trip', () => {
  let salt;
  beforeEach(() => {
    salt = crypto.getRandomValues(new Uint8Array(16));
  });

  it('round-trip simple ASCII', async () => {
    const text = 'sk-ant-api03-abc123def456';
    const enc = await encrypt(text, 'pass123', salt);
    const dec = await decrypt(enc, 'pass123', salt);
    expect(dec).toBe(text);
  }, 10000);

  it('round-trip UTF-8 (Japanese)', async () => {
    const text = '日本語のパスフレーズで暗号化';
    const enc = await encrypt(text, 'パスワード123', salt);
    const dec = await decrypt(enc, 'パスワード123', salt);
    expect(dec).toBe(text);
  }, 10000);

  it('round-trip long string', async () => {
    const text = 'x'.repeat(10000);
    const enc = await encrypt(text, 'p', salt);
    const dec = await decrypt(enc, 'p', salt);
    expect(dec).toBe(text);
  }, 10000);

  it('round-trip empty string', async () => {
    const enc = await encrypt('', 'p', salt);
    const dec = await decrypt(enc, 'p', salt);
    expect(dec).toBe('');
  }, 10000);

  it('returns different ciphertext for same plaintext (random IV)', async () => {
    const text = 'same input';
    const enc1 = await encrypt(text, 'p', salt);
    const enc2 = await encrypt(text, 'p', salt);
    expect(enc1).not.toBe(enc2);
  }, 10000);

  it('fails on wrong passphrase', async () => {
    const enc = await encrypt('secret', 'correct', salt);
    await expect(decrypt(enc, 'wrong', salt)).rejects.toThrow();
  }, 10000);

  it('fails on tampered ciphertext (GCM auth tag)', async () => {
    const enc = await encrypt('secret', 'p', salt);
    const tampered = Uint8Array.from(atob(enc), c => c.charCodeAt(0));
    tampered[20] ^= 0x01; // flip a bit in ciphertext
    const tamperedB64 = btoa(String.fromCharCode(...tampered));
    await expect(decrypt(tamperedB64, 'p', salt)).rejects.toThrow();
  }, 10000);

  it('different salts produce different keys', async () => {
    const salt2 = crypto.getRandomValues(new Uint8Array(16));
    const enc = await encrypt('secret', 'p', salt);
    await expect(decrypt(enc, 'p', salt2)).rejects.toThrow();
  }, 10000);
});

describe('Crypto — IV uniqueness', () => {
  it('first 12 bytes (IV) of encrypted output differ across calls', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const text = 'fixed';
    const enc1 = Uint8Array.from(atob(await encrypt(text, 'p', salt)), c => c.charCodeAt(0));
    const enc2 = Uint8Array.from(atob(await encrypt(text, 'p', salt)), c => c.charCodeAt(0));
    const iv1 = Array.from(enc1.slice(0, 12)).join(',');
    const iv2 = Array.from(enc2.slice(0, 12)).join(',');
    expect(iv1).not.toBe(iv2);
  }, 10000);
});

// beforeEach hoist
import { beforeEach } from 'vitest';

describe('the adaptation cannot drift from the real algorithm (round 97)', () => {
  it('takes its parameters from the same place the app does', () => {
    expect(PBKDF2_ITERATIONS, 'read out of CONFIG, not typed here').toBeGreaterThan(0);
    expect(IV_LEN).toBeGreaterThan(0);
    expect(html).toContain(`pbkdf2Iterations:${PBKDF2_ITERATIONS}`);
    expect(html).toContain(`ivLen:${IV_LEN}`);
  });

  it('the real deriveKey reads the config value rather than a literal', () => {
    // If someone inlines the number, the link this file depends on is quietly cut.
    const at = html.indexOf('async function deriveKey(passphrase,salt){');
    expect(at, 'deriveKey must still exist').toBeGreaterThan(-1);
    const fn = html.slice(at, at + 400);
    expect(fn, 'iterations must come from CONFIG').toContain('iterations:CONFIG.pbkdf2Iterations');
    expect(fn, 'a hard-coded count here would decouple the tests silently')
      .not.toMatch(/iterations:\s*\d/);
  });

  it('the real encrypt uses the same IV length key', () => {
    const at = html.indexOf('async function encrypt(text,passphrase){');
    const fn = html.slice(at, at + 500);
    expect(fn).toContain('new Uint8Array(CONFIG.ivLen)');
    expect(fn, 'the IV must be prefixed at the same offset the tests assume')
      .toContain('combined.set(new Uint8Array(ct),CONFIG.ivLen)');
  });

  it('the algorithm choices this file assumes are the ones in use', () => {
    expect(html).toContain("name:'PBKDF2'");
    expect(html).toContain("hash:'SHA-256'");
    expect(html).toContain("{name:'AES-GCM',length:256}");
  });
});
