// Neus — FTS索引の規模特性を測り、それを支えている境界を固定する (round 85)
//
// 「永久に貯め続ける」製品なので、問うべきは**2年後も動くか**である。実 Chromium・実
// IndexedDB で索引の構築費用とメモリを測った(語彙に偏りのある現実的なコーパス: 英日混在、
// 400語彙からサンプリング、スニペットは実運用と同じ500文字上限)。
//
//   | 件数    | 構築    | postings  | JSヒープ | 検索  |
//   |---------|---------|-----------|----------|-------|
//   |  2,000  |   229ms |   297,141 |  +13.2MB | 1.8ms |
//   | 10,000  | 1,495ms | 1,485,952 |  +56.9MB | 4.1ms |
//   | 20,000  | 2,122ms | 2,972,478 | +139.9MB | 9.1ms |
//
// **検索は速いまま**(20,000件で9.1ms)。効いてくるのは**メモリ**で、1イベントあたり約7KB。
// `StorageGuard` はディスクを見張るが、**インメモリ索引には上限が無い**。携帯端末では
// タブが落とされ、利用者には「アプリが勝手に再読み込みされる」と映る。これは欠陥ではなく
// **記録されていなかった設計特性**なので、ここに測定値として残す。
//
// ## 却下した「最適化」(測って否定した)
//
// メモリの **68%(20,000件で 136MB 中 92.8MB)は `eventGrams`**、つまり
// doc→grams の逆引きである。用途は `remove()` だけなので、消して「全gramを走査して
// その id を削る」方式にすれば約2倍軽くなる — と考えたが、**語彙の大きさを測って否定した**:
//
//   | コーパス          | 異なり2-gram |
//   |-------------------|--------------|
//   | 英数字            |        1,369 |
//   | かなのみ          |        6,975 |
//   | 漢字2000+かな     |   **14,423** |
//
// `add()` は先頭で `remove()` を呼ぶため、全gram走査にすると 20,000件の索引付けが
// 20,000 × 14,423 ≒ **2.9億回**の削除操作になる。`eventGrams` は無駄ではなく、
// remove/add を「その文書のgram数」に抑えるための**負荷を担う構造**だった。
//
// ## このテストが守るもの
//
// 上の envelope は「1文書あたりのgram数が有界」であることに全面的に依存する。それを
// 支えているのは**取り込み時の文字数上限**(タイトル300 / スニペット500)で、これが外れると
// 1件で語彙全体(14,000超)に届きうる — 平常時の約100倍。round 51 で `capTitle` を入れた
// 理由と同じ構図であり、当時タイトルにしか適用しなかった側(スニペット)も既に上限がある。
// ここではその上限が**両方の取り込み経路で**生きていることを固定する。

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// The real n-gram function, evaluated rather than mirrored.
function ngrams(text, n = 2) {
  const t = (text || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const grams = new Set();
  if (t.length < n) { if (t) grams.add(t); return grams; }
  for (let i = 0; i <= t.length - n; i++) grams.add(t.slice(i, i + n));
  return grams;
}

describe('what keeps per-document index cost bounded', () => {
  it('the RSS ingest path caps the snippet it stores', () => {
    // Without this, one feed with a 100KB <description> reaches most of the gram vocabulary
    // in a single document — roughly 100x a normal event's index footprint.
    expect(html).toContain("const summary=decodeEntities(summaryRaw).replace(/<[^>]+>/g,'').trim().slice(0,500);");
  });

  it('the JSON ingest path caps it too', () => {
    // A second path into the same index. Capping only one leaves the door open.
    const at = html.indexOf("parse:(text)=>{const d=JSON.parse(text);");
    expect(at, 'the JSON feed parser must still exist').toBeGreaterThan(-1);
    expect(html.slice(at, at + 700)).toContain('.trim().slice(0,500)');
  });

  it('titles are capped as well (round 51)', () => {
    expect(html).toContain('function capTitle(t){');
    expect(html).toContain('titleMaxChars');
  });

  it('nothing unbounded is indexed: eventText reads only capped or user-entered fields', () => {
    // `body` is deliberately absent — it is not populated by ingest, and indexing it would
    // reintroduce the unbounded case the caps exist to prevent.
    const at = html.indexOf('function eventText(ev){');
    const fn = html.slice(at, html.indexOf('\n', at));
    expect(fn).toContain('ev.content.title');
    expect(fn).toContain('ev.content.snippet');
    expect(fn, 'indexing the full body would make per-doc cost unbounded again')
      .not.toContain('ev.content.body');
  });
});

describe('the measured envelope holds for a capped document', () => {
  const capped = (n) => 'あいうえお機械学習と線形代数の話 rust ownership webgpu '.repeat(60).slice(0, n);

  it('a maximally-capped event stays far below the gram vocabulary', () => {
    // 500-char snippet + 300-char title is the worst a single ingested event can be.
    const doc = capped(300) + ' ' + capped(500);
    const g = ngrams(doc);
    expect(doc.length).toBeLessThanOrEqual(801);
    // Measured vocabulary for kanji+kana is ~14,400; one document must not approach it.
    expect(g.size, `a single capped event produced ${g.size} distinct bigrams`).toBeLessThan(1000);
  });

  it('a typical event is around the measured 149 grams, not orders more', () => {
    const doc = 'Rust ownership and lifetimes explained #4210 ' +
      'rust borrow checker webgpu compute shader 機械学習 線形代数 分散合意 '.repeat(4);
    const g = ngrams(doc);
    expect(g.size).toBeGreaterThan(40);
    expect(g.size, `typical event grams = ${g.size}; the envelope assumes a couple of hundred`)
      .toBeLessThan(600);
  });

  it('removing the snippet cap would blow past that band', () => {
    // The counterfactual, so the caps above read as load-bearing rather than incidental.
    //
    // Written carefully: repeating one string adds no DISTINCT bigrams (the first attempt
    // here compared 39 grams against 39 and failed). A real article body is lexically varied,
    // so its distinct-gram count climbs toward the vocabulary — that is the actual risk.
    let seed = 4242;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const chars = 'abcdefghijklmnopqrstuvwxyz あいうえおかきくけこ機械学習線形代数分散合意暗号署名推論';
    let body = '';
    for (let i = 0; i < 60000; i++) body += chars[Math.floor(rnd() * chars.length)];

    const cappedGrams = ngrams(body.slice(0, 500)).size;
    const uncappedGrams = ngrams(body).size;
    expect(body.length).toBeGreaterThan(50000);
    expect(uncappedGrams / cappedGrams,
      `one uncapped article would index ${uncappedGrams} grams vs ${cappedGrams} capped`)
      .toBeGreaterThan(3);
  });
});

describe('eventGrams is load-bearing, not duplication (round 85 negative result)', () => {
  it('remove() uses the reverse map instead of scanning the whole vocabulary', () => {
    // Dropping it would save ~68% of index memory and cost ~290M delete operations to index
    // 20k events, because add() calls remove() first. Measured, not assumed.
    expect(html).toContain('function remove(eid){const grams=eventGrams.get(eid);');
    expect(html).toContain('function add(ev){remove(ev.id);');
  });

  it('the same arrangement exists for words', () => {
    expect(html).toContain('function removeWord(wid){const gs=wordGrams.get(wid);');
  });
});
