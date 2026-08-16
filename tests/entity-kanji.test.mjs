// Neus — Kanji compound-noun entity extraction (round 38)
//
// round 37 で tokenize() が CJK 対応になり TagLearner の「学習経路」は日本語で動くようになったが、
// 学習データが無い時のフォールバック(コールドスタート)である extractEntities は
// カタカナ (/[ァ-ヴー]{3,}/) しか見ておらず、漢字複合語を一切抽出していなかった。
//
// 用語抽出研究(Nakagawa らの複合名詞ベース termhood。「日本語の技術用語の大半は漢語=漢字の
// 連続、またはカタカナ語で表される」)に照らすと、漢字複合語こそ日本語技術用語の主形態であり、
// その半分を取りこぼしていた。日本語見出しのコールドスタートで autoTags がほぼ空になり、
// タグ由来の検索・フィルタ・興味学習の起点が欠けていた。
//
// 実測(round 38 実施前):
//   「機械学習のための線形代数」 -> []
//   「自然言語処理の最新動向」   -> []
// 修正後: ひらがな(助詞)が自然な区切りになるため、漢字ランを取るだけで複合語境界が出る。

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// Mirror of TagLearner.extractEntities in index.html (stays in sync via the anchor tests below).
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
    while (words.length > 1 && STOP.has(words[words.length - 1])) words.pop();
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

describe('extractEntities — kanji compounds (the gap this closes)', () => {
  it('now extracts kanji compounds from a title that was previously empty', () => {
    expect(extractEntities('機械学習のための線形代数')).toEqual(['機械学習', '線形代数']);
  });
  it('splits on hiragana (particles) as natural boundaries', () => {
    expect(extractEntities('自然言語処理の最新動向')).toEqual(['自然言語処理', '最新動向']);
  });
  it('extracts a single compound when the rest is hiragana', () => {
    expect(extractEntities('量子計算の基礎を学ぶ')).toEqual(['量子計算']);
  });
  it('mixes kanji, katakana and latin from one headline', () => {
    // Kubernetes (latin) + 機械学習基盤 (kanji). Order: en -> kata -> kanji.
    expect(extractEntities('Kubernetesで機械学習基盤を作る')).toEqual(['Kubernetes', '機械学習基盤']);
  });
});

describe('extractEntities — JA stop words', () => {
  it('drops a run that is exactly a generic stop word', () => {
    expect(extractEntities('入門')).toEqual([]);
  });
  it('keeps a compound that merely CONTAINS a stop word (full-match only)', () => {
    // 機械学習入門 is one run; only the whole run is checked against JA_STOP, so it survives.
    expect(extractEntities('機械学習入門')).toEqual(['機械学習入門']);
  });
  it('drops the stop-word run but keeps the content compound beside it', () => {
    // 深層学習 (content) + 入門 (stop, dropped) — 入門 is its own run after the katakana/hiragana split.
    const r = extractEntities('深層学習の入門');
    expect(r).toContain('深層学習');
    expect(r).not.toContain('入門');
  });
});

describe('extractEntities — longer compounds rank first (termhood)', () => {
  it('orders kanji runs by descending length before the 3-cap', () => {
    // Nakagawa: longer compound nouns carry higher termhood. 画像認識入門(5) before 深層学習(4).
    const r = extractEntities('深層学習による画像認識入門');
    expect(r.indexOf('画像認識入門')).toBeLessThan(r.indexOf('深層学習'));
  });
});

describe('extractEntities — English and katakana behaviour is unchanged', () => {
  it('English proper nouns extract exactly as before', () => {
    expect(extractEntities('OpenAI releases new GPT model')).toEqual(['OpenAI', 'GPT']);
  });
  it('trims leading stopwords as before', () => {
    expect(extractEntities('Why Rust is faster than Go')).toEqual(['Rust', 'Go']);
  });
  it('katakana extraction is unaffected', () => {
    const r = extractEntities('アンソロピックがクロードを発表');
    expect(r).toContain('アンソロピック');
    expect(r).toContain('クロード');
  });
  it('pure lowercase English with no entities still returns empty', () => {
    expect(extractEntities('the quick brown fox')).toEqual([]);
  });
});

describe('kanji entity wiring (index.html)', () => {
  it('declares the JA stop-word set', () => {
    expect(html).toContain("const JA_STOP=new Set(['入門','基礎','応用','解説','理解','方法','対策','活用','紹介','実践','最新','徹底','完全','比較','考察','事例','初心','必見','注意','以下','場合','使用','利用','設定','確認','作成','実装','導入']);");
  });
  it('matches kanji runs of length 2..10 and filters stop words', () => {
    expect(html).toContain('const kanjiRuns=(title.match(/[一-鿿㐀-䶿]{2,10}/g)||[])');
    expect(html).toContain('.filter(m=>!JA_STOP.has(m))');
  });
  it('sorts by descending length so longer compounds win the 3-cap', () => {
    expect(html).toContain('.sort((a,b)=>b.length-a.length);');
  });
  it('shares the existing slice(0,3) cap rather than adding a new limit', () => {
    expect(html).toContain('return[...out].slice(0,3);');
  });
});
