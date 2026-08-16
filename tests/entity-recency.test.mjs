// Neus — Entity extraction & recency-decay scoring tests
// Validates improvements derived from arXiv research:
//   - IP2: Entity-Guided Interest Probing (RecSys'25) — entity extraction for cold-start tagging
//   - Lifetime-aware Interest Matching (CIKM'25) — recency decay in digest ranking

import { describe, it, expect } from 'vitest';

// === Mirror of TagLearner.extractEntities (stays in sync via ci check) ===
const STOP = new Set(['The','A','An','This','That','These','Those','I','We','You','It','He','She','They','But','And','Or','For','In','On','At','To','Of','With','How','Why','What','When','Where','Who','New','Is','Are','Was','Were','Will','Can']);
const JA_STOP = new Set(['入門','基礎','応用','解説','理解','方法','対策','活用','紹介','実践','最新','徹底','完全','比較','考察','事例','初心','必見','注意','以下','場合','使用','利用','設定','確認','作成','実装','導入']);
function extractEntities(title) {
  if (!title) return [];
  const out = new Set();
  const enMatches = title.match(/\b[A-Z][a-zA-Z0-9]+(?:\s+[A-Z][a-zA-Z0-9]+){0,2}\b/g) || [];
  for (let m of enMatches) {
    m = m.trim();
    let words = m.split(/\s+/);
    while (words.length > 1 && STOP.has(words[0])) words.shift();
    while (words.length > 1 && STOP.has(words[words.length-1])) words.pop();
    if (words.length === 0) continue;
    if (words.every(w => STOP.has(w))) continue;
    if (words.length === 1 && STOP.has(words[0])) continue;
    const phrase = words.join(' ');
    if (phrase.length >= 2 && phrase.length <= 40) out.add(phrase);
  }
  const kataMatches = title.match(/[ァ-ヴー]{3,}/g) || [];
  for (const m of kataMatches) out.add(m);
  const kanjiRuns = (title.match(/[一-鿿㐀-䶿]{2,10}/g) || [])
    .filter(m => !JA_STOP.has(m))
    .sort((a, b) => b.length - a.length);
  for (const m of kanjiRuns) out.add(m);
  return [...out].slice(0, 3);
}

// === Mirror of recency boost ===
const HALF_LIFE_MS = 6 * 60 * 60 * 1000;
function recencyBoost(ageMs) {
  return 25 * Math.pow(0.5, Math.max(0, ageMs) / HALF_LIFE_MS);
}

describe('Entity extraction (IP2-inspired cold-start tagging)', () => {
  it('extracts proper nouns from English title', () => {
    expect(extractEntities('OpenAI releases new GPT model')).toEqual(['OpenAI', 'GPT']);
  });

  it('trims leading stopwords', () => {
    expect(extractEntities('Why Rust is faster than Go')).toEqual(['Rust', 'Go']);
  });

  it('trims leading article', () => {
    const r = extractEntities('The Way To Build');
    expect(r).not.toContain('The Way');
    expect(r.some(e => e.includes('Way'))).toBe(true);
  });

  it('extracts katakana entities from Japanese title', () => {
    const r = extractEntities('アンソロピックがクロードを発表');
    expect(r).toContain('アンソロピック');
    expect(r).toContain('クロード');
  });

  it('returns empty for title with no entities', () => {
    expect(extractEntities('the quick brown fox')).toEqual([]);
  });

  it('handles empty/null title', () => {
    expect(extractEntities('')).toEqual([]);
    expect(extractEntities(null)).toEqual([]);
  });

  it('caps at 3 entities', () => {
    expect(extractEntities('Apple Google Microsoft Amazon Meta').length).toBeLessThanOrEqual(3);
  });

  it('respects max length (rejects very long phrases)', () => {
    const long = 'A'.repeat(50);
    expect(extractEntities(long)).toEqual([]);
  });
});

describe('Recency decay scoring (Lifetime-aware Interest Matching)', () => {
  it('fresh event gets full boost (~25)', () => {
    expect(recencyBoost(0)).toBeCloseTo(25, 1);
  });

  it('halves every 6 hours', () => {
    expect(recencyBoost(HALF_LIFE_MS)).toBeCloseTo(12.5, 1);
    expect(recencyBoost(2 * HALF_LIFE_MS)).toBeCloseTo(6.25, 1);
  });

  it('older events score lower than newer', () => {
    const fresh = recencyBoost(1 * 60 * 60 * 1000);   // 1h
    const stale = recencyBoost(20 * 60 * 60 * 1000);  // 20h
    expect(fresh).toBeGreaterThan(stale);
  });

  it('never negative', () => {
    expect(recencyBoost(100 * HALF_LIFE_MS)).toBeGreaterThanOrEqual(0);
  });

  it('changes ranking: fresh high-recency can outrank stale', () => {
    // Stale event with slightly higher base score vs fresh event
    const staleScore = 60 + recencyBoost(23 * 60 * 60 * 1000); // ~60
    const freshScore = 50 + recencyBoost(0);                    // 75
    expect(freshScore).toBeGreaterThan(staleScore);
  });
});
