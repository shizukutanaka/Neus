// Neus — Watchword relatedness tests (dialectic: words are not islands)
// One watchword's collected evidence may name another registered word; that
// mutual reference is the connective tissue of the inquiry.
// Mirrors relatedWords in index.html.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// ===== Mirrored from relatedWords in index.html =====
function relatedWords(items, others) {
  const hay = items.map(e => `${e.content?.title || ''} ${e.content?.snippet || ''}`).join('\n').toLowerCase();
  if (!hay.trim()) return [];
  const res = [];
  for (const ow of others) {
    const n = (ow.normalized || '').toLowerCase();
    const isAscii = /^[\x00-\x7f]+$/.test(n);
    if (n.length < (isAscii ? 3 : 2)) continue;
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = isAscii ? new RegExp(`\\b${esc}\\b`, 'g') : new RegExp(esc, 'g');
    const m = hay.match(re);
    if (m && m.length) res.push({ term: ow.term, normalized: ow.normalized, count: m.length });
  }
  return res.sort((a, b) => b.count - a.count).slice(0, 6);
}

const item = (title, snippet = '') => ({ content: { title, snippet } });
const others = [
  { term: 'WebGL', normalized: 'webgl' },
  { term: 'wgpu', normalized: 'wgpu' },
  { term: 'Vulkan', normalized: 'vulkan' },
];

describe('relatedWords', () => {
  it('detects other registered terms mentioned in the collected text', () => {
    const items = [item('WebGPU vs WebGL', 'compared to wgpu and WebGL')];
    const out = relatedWords(items, others);
    expect(out.find(r => r.normalized === 'webgl').count).toBe(2);
    expect(out.find(r => r.normalized === 'wgpu').count).toBe(1);
    expect(out.find(r => r.normalized === 'vulkan')).toBeUndefined();
  });

  it('sorts by mention count descending', () => {
    const items = [item('wgpu wgpu wgpu', 'webgl once')];
    expect(relatedWords(items, others).map(r => r.normalized)).toEqual(['wgpu', 'webgl']);
  });

  it('uses word boundaries for ASCII terms to avoid substring false positives', () => {
    // "gpu" must not match inside "webgpu"
    const items = [item('all about webgpu', 'webgpu internals')];
    const out = relatedWords(items, [{ term: 'gpu', normalized: 'gpu' }]);
    expect(out).toEqual([]);
  });

  it('matches CJK terms by substring (no word boundaries)', () => {
    const items = [item('量子コンピュータの進展', '量子ビットの話')];
    const out = relatedWords(items, [{ term: '量子', normalized: '量子' }]);
    expect(out[0].count).toBe(2);
  });

  it('skips sub-3-character terms as noise', () => {
    const items = [item('go go go', 'go')];
    expect(relatedWords(items, [{ term: 'go', normalized: 'go' }])).toEqual([]);
  });

  it('returns nothing when there are no items or no others', () => {
    expect(relatedWords([], others)).toEqual([]);
    expect(relatedWords([item('WebGL everywhere')], [])).toEqual([]);
  });

  it('caps the result at six related words', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ term: `term${i}`, normalized: `term${i}` }));
    const items = [item(many.map(m => m.normalized).join(' '))];
    expect(relatedWords(items, many)).toHaveLength(6);
  });
});

describe('relatedness wiring (index.html)', () => {
  it('declares relatedWords and threads others through the exporter', () => {
    expect(html).toContain('function relatedWords');
    expect(html).toContain('async othersOf(word)');
    expect(html).toContain('toDossier(word,events,others)');
  });
  it('renders related chips in the view and a 関連 section in the dossier', () => {
    expect(html).toContain('class="word-rel"');
    expect(html).toContain("data-wact=\"relfilter\"");
    expect(html).toContain('## 関連');
  });
});
