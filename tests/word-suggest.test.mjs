// Neus — Watchword suggestion (maieutics) tests
// A registered word need not originate from the user typing it: the most
// valuable questions are latent in their own behaviour (WATCH keywords and
// tags recurring in STARred items). rankWordSuggestions draws them out.
// Mirrors rankWordSuggestions in index.html.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// ===== Mirrored from normalizeTerm / rankWordSuggestions in index.html =====
const normalizeTerm = (s) => (s || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
function rankWordSuggestions({ watchPatterns = [], tagCounts = {}, existing = new Set(), limit = 6 } = {}) {
  const cand = new Map();
  const add = (term, score, reason) => {
    const norm = normalizeTerm(term);
    if (norm.length < 2 || existing.has(norm)) return;
    const cur = cand.get(norm);
    if (cur) { cur.score += score; if (reason === 'keyword') cur.reason = 'keyword'; }
    else cand.set(norm, { term: (term || '').trim(), score, reason });
  };
  for (const p of watchPatterns) add(p, 100, 'keyword');
  for (const [tag, n] of Object.entries(tagCounts)) add(tag, n, 'tag');
  return [...cand.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

describe('rankWordSuggestions', () => {
  it('ranks explicit WATCH keywords above frequent tags', () => {
    const out = rankWordSuggestions({ watchPatterns: ['quantum'], tagCounts: { rust: 5 } });
    expect(out[0].term).toBe('quantum');
    expect(out[0].reason).toBe('keyword');
    expect(out[1].term).toBe('rust');
  });

  it('excludes terms already registered as watchwords', () => {
    const out = rankWordSuggestions({ watchPatterns: ['WebGPU'], tagCounts: { rust: 3 }, existing: new Set(['webgpu']) });
    expect(out.map(s => s.term)).toEqual(['rust']);
  });

  it('merges a keyword and a tag for the same term, summing score and keeping the keyword reason', () => {
    const out = rankWordSuggestions({ watchPatterns: ['ai'], tagCounts: { ai: 4 } });
    expect(out).toHaveLength(1);
    expect(out[0].reason).toBe('keyword');
    expect(out[0].score).toBe(104);
  });

  it('orders tag-only candidates by frequency', () => {
    const out = rankWordSuggestions({ tagCounts: { go: 2, rust: 9, zig: 5 } });
    expect(out.map(s => s.term)).toEqual(['rust', 'zig', 'go']);
  });

  it('drops sub-2-character noise and respects the limit', () => {
    const out = rankWordSuggestions({ tagCounts: { a: 99, react: 1, vue: 1, svelte: 1, solid: 1, qwik: 1, astro: 1, remix: 1 }, limit: 6 });
    expect(out.find(s => s.term === 'a')).toBeUndefined();
    expect(out).toHaveLength(6);
  });

  it('is case-insensitive when de-duplicating against existing words', () => {
    const out = rankWordSuggestions({ tagCounts: { Rust: 3 }, existing: new Set(['rust']) });
    expect(out).toHaveLength(0);
  });
});

describe('suggestion wiring (index.html)', () => {
  it('declares the ranker and the suggestion strip renderer', () => {
    expect(html).toContain('function rankWordSuggestions');
    expect(html).toContain('function renderWordSuggestions');
  });
  it('derives candidates from WATCH keywords and starred-item tags', () => {
    expect(html).toContain('KeywordRules.getRules()');
    expect(html).toContain('ev.state?.starred');
  });
  it('exposes a one-tap suggest action that registers and collects', () => {
    expect(html).toContain("data-wact=\"suggest\"");
    expect(html).toContain("act==='suggest'");
  });
});
