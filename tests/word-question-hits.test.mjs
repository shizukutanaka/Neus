// Neus — Question Watch (Socratic feature, symmetric to Falsifier Watch)
//
// Found via a Socratic self-examination of the product's own inquiry model: falsifier
// (what would change your mind) already got an active evidence-matching sensor
// (Falsifier Watch), but questions (the aporia list — what remains unresolved) did not,
// even though both are structurally identical "declared text vs. collected evidence"
// matches. This closed that asymmetry by extracting the shared bigram-coverage logic
// (bigramCoverageHits) and applying it to each open (unresolved) question.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// Mirrors fsBigrams / bigramCoverageHits / questionHits in index.html.
function fsBigrams(text) {
  const s = String(text || '').toLowerCase().replace(/\s+/g, '');
  const g = new Set();
  for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2));
  return g;
}
function bigramCoverageHits(text, events) {
  const t = (text || '').trim();
  if (t.length < 4) return [];
  const tg = fsBigrams(t);
  if (tg.size < 3) return [];
  const hits = [];
  for (const ev of events || []) {
    const eg = fsBigrams([ev.content?.title, ev.content?.snippet, ev.content?.summary].filter(Boolean).join(' '));
    if (eg.size === 0) continue;
    let inter = 0; for (const b of tg) if (eg.has(b)) inter++;
    const cov = inter / tg.size;
    if (cov >= 0.5) hits.push({ ev, score: cov });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, 3);
}
function questionHits(question, events) { return bigramCoverageHits(question?.text, events); }
const ev = (title, snippet = '') => ({ content: { title, snippet }, url: 'https://e.com/' + encodeURIComponent(title) });

describe('questionHits (modeled)', () => {
  it('returns nothing for an empty or missing question', () => {
    expect(questionHits({ text: '' }, [ev('anything')])).toEqual([]);
    expect(questionHits(undefined, [ev('anything')])).toEqual([]);
  });
  it('ignores a too-short question', () => {
    expect(questionHits({ text: 'no' }, [ev('no')])).toEqual([]);
  });
  it('surfaces an item that closely matches the question text', () => {
    const q = { text: 'does Firefox support WebGPU compute shaders yet' };
    const items = [ev('Firefox now supports WebGPU compute shaders in nightly'), ev('Cats are nice')];
    const hits = questionHits(q, items);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].ev.content.title).toContain('WebGPU');
  });
  it('does not flag unrelated items', () => {
    const q = { text: 'does Firefox support WebGPU compute shaders yet' };
    const hits = questionHits(q, [ev('A recipe for sourdough bread'), ev('Stock market update')]);
    expect(hits).toEqual([]);
  });
  it('works for Japanese (character bigrams, no whitespace tokenization)', () => {
    const q = { text: '新しいベンチマークで性能が逆転したか' };
    const items = [ev('新しいベンチマークで性能が逆転したと報告'), ev('全く無関係な料理の話')];
    const hits = questionHits(q, items);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].ev.content.title).toContain('ベンチマーク');
  });
  it('ranks by coverage and caps at 3', () => {
    const q = { text: 'browser drops WebGPU support entirely' };
    const items = [
      ev('browser drops WebGPU support entirely confirmed'),
      ev('a browser may drop some WebGPU support'),
      ev('WebGPU support dropped by browser'),
      ev('another about WebGPU support drop browser'),
    ];
    const hits = questionHits(q, items);
    expect(hits.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < hits.length; i++) expect(hits[i - 1].score).toBeGreaterThanOrEqual(hits[i].score);
  });
});

describe('Question Watch wiring (index.html)', () => {
  it('shares one bigram-coverage helper between falsifier and question matching', () => {
    expect(html).toContain('function bigramCoverageHits(text,events){');
    expect(html).toContain('function falsifierHits(word,events){return bigramCoverageHits(word.falsifier,events);}');
    expect(html).toContain('function questionHits(question,events){return bigramCoverageHits(question?.text,events);}');
  });
  it('only computes hits for unresolved questions (resolved ones are not actively monitored)', () => {
    expect(html).toContain('const qh=done?[]:questionHits(q,items);');
  });
  it('renders a clickable hint linking to the top-matched item, with a title listing all matches', () => {
    expect(html).toContain('class="word-q-hit"');
    expect(html).toContain("qh.map(h=>h.ev.content.title||'(untitled)').join(' / ')");
  });
  it('includes question hits in the dossier export, nested under the open question', () => {
    expect(html).toContain('const qh=questionHits(q,events);');
    expect(html).toContain("for(const h of qh)parts.push(`  - ${mdLink(h.ev.content.title||'(untitled)',h.ev.url)} — ${Math.round(h.score*100)}%`);");
  });
  it('declares the word.qhits i18n key in both languages', () => {
    expect(html).toContain("'word.qhits':'関連しうる収集物'");
    expect(html).toContain("'word.qhits':'may relate'");
  });
});
