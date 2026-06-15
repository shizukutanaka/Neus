// Neus — Watchword term-normalization tests (duplicate-registration guard)
// "ＷｅｂＧＰＵ" (full-width), "Web  GPU" (double space), and " WebGPU "
// (padded) must not register as distinct watchwords from their plain form.
// The display term is preserved raw; only the matching key is normalized.
// Mirrors normalizeTerm in index.html.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// ===== Mirrored from index.html =====
const normalizeTerm = (s) => (s || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

describe('normalizeTerm', () => {
  it('lowercases and trims surrounding whitespace', () => {
    expect(normalizeTerm('  WebGPU  ')).toBe('webgpu');
  });

  it('collapses internal whitespace runs to a single space', () => {
    expect(normalizeTerm('Web   GPU')).toBe('web gpu');
    expect(normalizeTerm('Web\tGPU')).toBe('web gpu');
  });

  it('folds full-width ASCII to half-width via NFKC', () => {
    // U+FF37.. fullwidth "ＷｅｂＧＰＵ"
    expect(normalizeTerm('ＷｅｂＧＰＵ')).toBe('webgpu');
  });

  it('treats full-width and plain forms as the same key', () => {
    expect(normalizeTerm('ＷｅｂＧＰＵ')).toBe(normalizeTerm('WebGPU'));
    expect(normalizeTerm(' Web  GPU ')).toBe(normalizeTerm('web gpu'));
  });

  it('normalizes full-width digits and spaces', () => {
    expect(normalizeTerm('ＧＰＴ　4')).toBe('gpt 4'); // fullwidth GPT + ideographic space + 4
  });

  it('preserves distinct terms that differ by more than spacing/case/width', () => {
    expect(normalizeTerm('WebGPU')).not.toBe(normalizeTerm('WebGL'));
    expect(normalizeTerm('web gpu')).not.toBe(normalizeTerm('webgpu'));
  });

  it('leaves CJK terms intact', () => {
    expect(normalizeTerm('量子コンピュータ')).toBe('量子コンピュータ');
  });

  it('returns empty string for nullish input', () => {
    expect(normalizeTerm(undefined)).toBe('');
    expect(normalizeTerm(null)).toBe('');
    expect(normalizeTerm('')).toBe('');
  });
});

describe('normalization wiring (index.html)', () => {
  it('declares normalizeTerm', () => {
    expect(html).toContain('const normalizeTerm=');
    expect(html).toContain("normalize('NFKC')");
  });
  it('uses normalizeTerm at every registration entry point', () => {
    // call sites: addWord, suggest handler, and the suggestion ranker
    const occurrences = (html.match(/normalizeTerm\(/g) || []).length;
    expect(occurrences).toBeGreaterThanOrEqual(3);
  });
});
