// Neus — Falsifier Watch (Socratic feature)
//
// Socratic chain: the system asks the inquirer to state a falsifier ("what would
// change your mind?"), the sharpest elenchus move (Popperian fallibility). But
// once stated, the falsifier was passive text — the system kept collecting
// evidence and knew the falsifier, yet never connected them, only nagging the
// human to check manually. Falsifier Watch closes the loop: it scores each
// collected item against the falsifier statement (language-agnostic character
// bigram coverage) and surfaces items that may satisfy the stated condition.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// Mirrors fsBigrams / falsifierHits in index.html.
function fsBigrams(text) {
  const s = String(text || '').toLowerCase().replace(/\s+/g, '');
  const g = new Set();
  for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2));
  return g;
}
function falsifierHits(word, events) {
  const f = (word.falsifier || '').trim();
  if (f.length < 4) return [];
  const fg = fsBigrams(f);
  if (fg.size < 3) return [];
  const hits = [];
  for (const ev of events || []) {
    const eg = fsBigrams([ev.content?.title, ev.content?.snippet, ev.content?.summary].filter(Boolean).join(' '));
    if (eg.size === 0) continue;
    let inter = 0; for (const b of fg) if (eg.has(b)) inter++;
    const cov = inter / fg.size;
    if (cov >= 0.5) hits.push({ ev, score: cov });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, 3);
}
const ev = (title, snippet = '') => ({ content: { title, snippet }, url: 'https://e.com/' + encodeURIComponent(title) });

describe('falsifierHits (modeled)', () => {
  it('returns nothing when there is no falsifier', () => {
    expect(falsifierHits({ falsifier: '' }, [ev('anything')])).toEqual([]);
    expect(falsifierHits({}, [ev('anything')])).toEqual([]);
  });
  it('ignores a too-short falsifier', () => {
    expect(falsifierHits({ falsifier: 'no' }, [ev('no')])).toEqual([]);
  });
  it('surfaces an item that closely matches the falsifier statement', () => {
    const word = { falsifier: 'a major browser drops WebGPU support' };
    const items = [ev('Chrome drops WebGPU support in next release'), ev('Cats are nice')];
    const hits = falsifierHits(word, items);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].ev.content.title).toContain('WebGPU');
  });
  it('does not flag unrelated items', () => {
    const word = { falsifier: 'a major browser drops WebGPU support' };
    const hits = falsifierHits(word, [ev('A recipe for sourdough bread'), ev('Stock market update')]);
    expect(hits).toEqual([]);
  });
  it('works for Japanese (character bigrams, no whitespace tokenization)', () => {
    const word = { falsifier: '新しいベンチマークで性能が逆転したら' };
    const items = [ev('新しいベンチマークで性能が逆転したと報告'), ev('全く無関係な料理の話')];
    const hits = falsifierHits(word, items);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].ev.content.title).toContain('ベンチマーク');
  });
  it('ranks by coverage and caps at 3', () => {
    const word = { falsifier: 'browser drops WebGPU support entirely' };
    const items = [
      ev('browser drops WebGPU support entirely confirmed'),  // near-exact
      ev('a browser may drop some WebGPU support'),
      ev('WebGPU support dropped by browser'),
      ev('another about WebGPU support drop browser'),
    ];
    const hits = falsifierHits(word, items);
    expect(hits.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < hits.length; i++) expect(hits[i - 1].score).toBeGreaterThanOrEqual(hits[i].score);
  });
});

describe('Falsifier Watch wiring (index.html)', () => {
  it('defines the pure helpers', () => {
    expect(html).toContain('function fsBigrams(text){');
    expect(html).toContain('function falsifierHits(word,events){');
    expect(html).toContain('if(cov>=0.5)hits.push({ev,score:cov});');
  });
  it('renders a falsifier-watch block in the word section', () => {
    expect(html).toContain('const fwatch=w.falsifier?falsifierHits(w,items):[];');
    expect(html).toContain('class="word-fwatch"');
    expect(html).toContain('${fwatchBlock}');
    expect(html).toContain("'word.fwatch':");
  });
  it('adds a high-priority falsifier-seen elenchus prompt and suppresses the generic stale ones', () => {
    expect(html).toContain("out.push({key:'falsifier-seen'");
    expect(html).toContain('if(SETTLED_VERDICTS.has(verdict)&&stale>0&&!fhits.length){');
  });
  it('includes possible falsifier evidence in the dossier export', () => {
    expect(html).toContain('## 反証候補 / possible falsifier evidence');
  });
});
