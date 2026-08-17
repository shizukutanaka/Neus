// Neus — 検索演算子 "完全一致" / -除外 (round 41)
//
// 動機(関連ソフトウェアの慣習 + N-gram索引の原理的限界):
// FTSIndex は文字N-gram索引で **語順を保持しない**。そのため日本語では構成文字が同じ別語が
// 高スコアで返る。実測(Node、閾値 ftsScoreMin=0.4):
//   クエリ「情報検索」 → 「検索情報のまとめ」が score=0.489 で**返ってしまう**(別の語なのに)
// N-gram索引は本質的に「取りこぼしの無い候補生成器(lossy filter)」なので、IR の定石どおり
//   候補生成(索引) → 検証(実テキストで literal 照合)
// の2段構成にして精度を回復する。
//
// 記法は Feedly / Inoreader / Obsidian / Gmail / GitHub 等でほぼ共通の
// `"完全一致"` と `-除外` に合わせ、学習コストを増やさない。

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// Mirrors parseSearchQuery / matchesSearchOps in index.html.
function parseSearchQuery(raw) {
  const q = String(raw || '');
  const phrases = [], excludes = [];
  let base = q.replace(/"([^"]+)"/g, (_, p) => { const t = p.trim(); if (t) phrases.push(t.toLowerCase()); return ' '; });
  base = base.replace(/(^|\s)-([^\s"]+)/g, (_, sp, t) => { const x = t.trim().toLowerCase(); if (x) excludes.push(x); return ' '; });
  return { base: base.replace(/\s+/g, ' ').trim(), phrases, excludes };
}
function matchesSearchOps(text, ops) {
  if (!ops || (ops.phrases.length === 0 && ops.excludes.length === 0)) return true;
  const t = String(text || '').toLowerCase();
  for (const p of ops.phrases) if (!t.includes(p)) return false;
  for (const x of ops.excludes) if (t.includes(x)) return false;
  return true;
}

describe('parseSearchQuery', () => {
  it('leaves a plain query untouched (no operators = previous behaviour)', () => {
    expect(parseSearchQuery('rust ownership')).toEqual({ base: 'rust ownership', phrases: [], excludes: [] });
  });
  it('extracts a quoted phrase', () => {
    expect(parseSearchQuery('"machine learning"')).toEqual({ base: '', phrases: ['machine learning'], excludes: [] });
  });
  it('extracts an exclusion', () => {
    expect(parseSearchQuery('rust -crypto')).toEqual({ base: 'rust', phrases: [], excludes: ['crypto'] });
  });
  it('handles phrase and exclusion together', () => {
    const r = parseSearchQuery('"情報検索" ai -広告');
    expect(r.phrases).toEqual(['情報検索']);
    expect(r.excludes).toEqual(['広告']);
    expect(r.base).toBe('ai');
  });
  it('supports multiple phrases and exclusions', () => {
    const r = parseSearchQuery('"a b" "c d" -x -y');
    expect(r.phrases).toEqual(['a b', 'c d']);
    expect(r.excludes).toEqual(['x', 'y']);
  });
  it('does NOT treat an unclosed quote as an operator (typing mid-query must not blank results)', () => {
    const r = parseSearchQuery('"machine learn');
    expect(r.phrases).toEqual([]);
    expect(r.base).toBe('"machine learn');
  });
  it('does not treat an intra-word hyphen as exclusion', () => {
    const r = parseSearchQuery('e-mail parsing');
    expect(r.excludes).toEqual([]);
    expect(r.base).toBe('e-mail parsing');
  });
  it('treats a leading hyphen at the very start as exclusion', () => {
    expect(parseSearchQuery('-spam').excludes).toEqual(['spam']);
  });
  it('is case-insensitive for operators', () => {
    expect(parseSearchQuery('"Machine Learning" -SPAM')).toEqual({ base: '', phrases: ['machine learning'], excludes: ['spam'] });
  });
  it('handles empty and nullish input', () => {
    expect(parseSearchQuery('')).toEqual({ base: '', phrases: [], excludes: [] });
    expect(parseSearchQuery(null)).toEqual({ base: '', phrases: [], excludes: [] });
  });
});

describe('matchesSearchOps — verification stage', () => {
  it('passes everything through when there are no operators', () => {
    expect(matchesSearchOps('anything at all', parseSearchQuery('plain query'))).toBe(true);
  });

  it('fixes the measured CJK word-order false positive', () => {
    // This is the whole point: 「検索情報のまとめ」 scores 0.489 for 「情報検索」 in the
    // n-gram index (above the 0.4 threshold) purely because bigrams lose word order.
    const ops = parseSearchQuery('"情報検索"');
    expect(matchesSearchOps('情報検索の入門', ops)).toBe(true);   // real match survives
    expect(matchesSearchOps('検索情報のまとめ', ops)).toBe(false); // reordered term rejected
  });

  it('requires every phrase to be present', () => {
    const ops = parseSearchQuery('"machine learning" "neural net"');
    expect(matchesSearchOps('machine learning with a neural net', ops)).toBe(true);
    expect(matchesSearchOps('machine learning only', ops)).toBe(false);
  });

  it('rejects a document containing an excluded term', () => {
    const ops = parseSearchQuery('rust -crypto');
    expect(matchesSearchOps('rust ownership model', ops)).toBe(true);
    expect(matchesSearchOps('rust for crypto wallets', ops)).toBe(false);
  });

  it('applies phrase and exclusion together', () => {
    const ops = parseSearchQuery('"machine learning" -advertising');
    expect(matchesSearchOps('machine learning research', ops)).toBe(true);
    expect(matchesSearchOps('machine learning for advertising', ops)).toBe(false);
    expect(matchesSearchOps('deep learning research', ops)).toBe(false); // phrase missing
  });

  it('is case-insensitive against document text', () => {
    expect(matchesSearchOps('Machine Learning Basics', parseSearchQuery('"machine learning"'))).toBe(true);
    expect(matchesSearchOps('SPAM offer', parseSearchQuery('-spam'))).toBe(false);
  });

  it('handles empty document text safely', () => {
    expect(matchesSearchOps('', parseSearchQuery('"x"'))).toBe(false);
    expect(matchesSearchOps(null, parseSearchQuery('-x'))).toBe(true); // nothing to exclude
  });
});

describe('search operator wiring (index.html)', () => {
  it('defines the parser and the verifier', () => {
    expect(html).toContain('function parseSearchQuery(raw){');
    expect(html).toContain('function matchesSearchOps(text,ops){');
  });
  it('verification is a no-op without operators (keeps previous behaviour)', () => {
    expect(html).toContain('if(!ops||(ops.phrases.length===0&&ops.excludes.length===0))return true;');
  });
  it('only runs the extra fetch pass when operators are present', () => {
    expect(html).toContain('if(ops.phrases.length||ops.excludes.length){');
  });
  it('falls back to the phrase text for candidate generation when base is empty', () => {
    expect(html).toContain('searchResults=FTSIndex.search(ops.base||ops.phrases.join(\' \')||searchQuery);');
  });
  it('verifies watchword hits too, not only events', () => {
    expect(html).toContain("if(r.id.startsWith('word:')){const w=await Store.getWord(r.id.slice(5));");
  });
  it('advertises the operators in both locales', () => {
    expect((html.match(/'search\.placeholder':/g) || []).length).toBe(2);
    expect(html).toContain('検索... "完全一致" -除外 が使えます');
    expect(html).toContain('search... use "exact phrase" and -exclude');
  });
});
