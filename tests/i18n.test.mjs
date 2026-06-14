// Neus — i18n completeness tests
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexPath = join(__dirname, '..', 'index.html');

function extractDict() {
  const html = readFileSync(indexPath, 'utf8');
  // ja: { ... }, en: { ... }
  const jaMatch = html.match(/ja:\s*{([^}]+(?:\}[^}]*)*?)\s*},\s*en:/s);
  const enMatch = html.match(/en:\s*{([^}]+(?:\}[^}]*)*?)\s*},\s*};/s);
  if (!jaMatch || !enMatch) {
    throw new Error('Could not extract DICT from index.html');
  }
  const parseKeys = (block) => {
    const keys = new Set();
    // capture single quoted keys: 'key.name':'value' (handle apostrophes in values via simple scan)
    const re = /'([a-zA-Z][a-zA-Z0-9.-]*)'\s*:\s*['"`]/g;
    let m;
    while ((m = re.exec(block)) !== null) keys.add(m[1]);
    return keys;
  };
  return {
    ja: parseKeys(jaMatch[1]),
    en: parseKeys(enMatch[1]),
  };
}

describe('i18n — DICT completeness', () => {
  let ja, en;
  it('extracts non-empty key sets', () => {
    const dict = extractDict();
    ja = dict.ja;
    en = dict.en;
    expect(ja.size).toBeGreaterThan(20);
    expect(en.size).toBeGreaterThan(20);
  });

  it('JA and EN have the same set of keys', () => {
    const dict = extractDict();
    const onlyInJa = [...dict.ja].filter(k => !dict.en.has(k));
    const onlyInEn = [...dict.en].filter(k => !dict.ja.has(k));
    expect(onlyInJa, `Keys only in JA: ${onlyInJa.join(', ')}`).toEqual([]);
    expect(onlyInEn, `Keys only in EN: ${onlyInEn.join(', ')}`).toEqual([]);
  });

  it('all keys used in t() calls are defined', () => {
    const html = readFileSync(indexPath, 'utf8');
    const dict = extractDict();
    const used = new Set();
    // capture t('key.name') — must contain dot to distinguish from variable t(x)
    const re = /\bt\(['"`]([a-zA-Z][a-zA-Z0-9.-]*\.[a-zA-Z][a-zA-Z0-9.-]*)['"`]\)/g;
    let m;
    while ((m = re.exec(html)) !== null) used.add(m[1]);
    expect(used.size).toBeGreaterThan(10);
    const missing = [...used].filter(k => !dict.ja.has(k));
    expect(missing, `t() keys not in DICT: ${missing.join(', ')}`).toEqual([]);
  });

  it('no DICT key has empty string value', () => {
    // Extract only DICT region to avoid false positives from JS object literals
    // (e.g., \`{'watch-hit':''}\` used as classList toggle, which is not a DICT entry)
    const html = readFileSync(indexPath, 'utf8');
    const dictMatch = html.match(/const DICT=\{([\s\S]*?)\n\};/);
    if (!dictMatch) throw new Error('DICT not found');
    const dictBlock = dictMatch[1];
    // DICT keys are quoted, must contain a dot (namespace.key pattern)
    const empty = dictBlock.match(/'[a-z][a-z0-9.-]*\.[a-z][a-z0-9.-]*':\s*''/g);
    expect(empty || []).toEqual([]);
  });
});

describe('i18n — coverage of UI elements', () => {
  it('core navigation labels exist', () => {
    const dict = extractDict();
    const required = ['btn.sources', 'btn.vault', 'btn.settings', 'btn.poll',
                      'btn.keywords', 'btn.stats',
                      'nav.later', 'nav.digest',
                      'btn.add', 'btn.close', 'btn.save'];
    for (const k of required) {
      expect(dict.ja.has(k), `Missing JA key: ${k}`).toBe(true);
      expect(dict.en.has(k), `Missing EN key: ${k}`).toBe(true);
    }
  });

  it('digest view keys exist', () => {
    const dict = extractDict();
    for (const k of ['digest.title', 'digest.top3', 'digest.tags', 'digest.sources', 'digest.week.trend']) {
      expect(dict.ja.has(k)).toBe(true);
      expect(dict.en.has(k)).toBe(true);
    }
  });
});
