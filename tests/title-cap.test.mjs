// Neus — 見出し長の上限 (round 53)
//
// 発見: 取り込み時に `snippet` / `summary` は 500 字へ切っている(`.slice(0,500)`)のに、
// **`title` だけ無制限**だった。そして `title` は FTSIndex の N-gram 対象
// (`eventText` の先頭要素)に入る。
//
// 攻撃面: ワーカーはフィード応答を **5MB** まで許す(`MAX_SIZE`)。つまり悪意ある、あるいは
// 単に壊れたフィードが巨大な `<title>` を1件返すだけで、**その1文書が数百万個の bigram**を
// 索引へ流し込める:
//   title 100,000 字 -> 約 99,999 bigram(1文書あたり)
// 索引構築・検索・IndexedDB・描画が一斉に膨張する。第三者が内容を決められる入力なので、
// 「利用者が悪いことをしなければ起きない」類の話ではない。
//
// 注: round 34 の文書長正規化のおかげで、巨大文書が検索**順位**を支配することは既に防がれて
// いた(dl が大きいほど減点される)。しかし**索引そのものの膨張**は別問題で、そちらは未対策だった。
//
// 対策: 取り込み境界で `capTitle()` により CONFIG.titleMaxChars(300)へ切る。
// 実在の見出しは 200 字に収まるため、表示・検索の実用性は落ちない。

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

const CONFIG = { titleMaxChars: 300 };
// Mirrors capTitle in index.html.
function capTitle(t) {
  const s = String(t == null ? '' : t);
  return s.length > CONFIG.titleMaxChars ? s.slice(0, CONFIG.titleMaxChars) : s;
}
const bigramCount = (s) => Math.max(0, s.length - 1);

describe('capTitle', () => {
  it('leaves a normal headline untouched', () => {
    const t = 'Rustの所有権とライフタイム入門';
    expect(capTitle(t)).toBe(t);
  });
  it('leaves a long-but-plausible headline untouched', () => {
    const t = 'A'.repeat(200);
    expect(capTitle(t)).toBe(t);
  });
  it('truncates at exactly the configured limit', () => {
    expect(capTitle('A'.repeat(1000))).toHaveLength(CONFIG.titleMaxChars);
    expect(capTitle('A'.repeat(CONFIG.titleMaxChars))).toHaveLength(CONFIG.titleMaxChars);
    expect(capTitle('A'.repeat(CONFIG.titleMaxChars + 1))).toHaveLength(CONFIG.titleMaxChars);
  });
  it('handles nullish and non-string input without throwing', () => {
    expect(capTitle(null)).toBe('');
    expect(capTitle(undefined)).toBe('');
    expect(capTitle(12345)).toBe('12345');
  });
  it('preserves multi-byte characters (no mangling of Japanese)', () => {
    const t = '機械学習'.repeat(10);
    expect(capTitle(t)).toBe(t);
    expect(capTitle('あ'.repeat(400))).toHaveLength(CONFIG.titleMaxChars);
  });
});

describe('the index blow-up this prevents', () => {
  it('bounds how many bigrams a single document can contribute', () => {
    // A 5MB feed body is permitted by the worker, so an uncapped title could carry
    // millions of characters. After the cap one document is bounded.
    const hostile = 'x'.repeat(100_000);
    expect(bigramCount(hostile)).toBeGreaterThan(99_000);          // before
    expect(bigramCount(capTitle(hostile))).toBeLessThan(CONFIG.titleMaxChars); // after
  });

  it('the cap is far below the worker response limit, so it actually binds', () => {
    const workerMaxBytes = 5 * 1024 * 1024;
    expect(CONFIG.titleMaxChars).toBeLessThan(workerMaxBytes / 1000);
  });

  it('stays consistent with the existing snippet/summary limit', () => {
    // snippet/summary are cut to 500; a title cap larger than that would be incoherent.
    expect(CONFIG.titleMaxChars).toBeLessThanOrEqual(500);
  });
});

describe('wiring (index.html)', () => {
  it('declares the limit', () => {
    expect(html).toContain('titleMaxChars:300,');
  });
  it('defines the helper', () => {
    expect(html).toContain('function capTitle(t){');
    expect(html).toContain('return s.length>CONFIG.titleMaxChars?s.slice(0,CONFIG.titleMaxChars):s;');
  });
  it('applies at the RSS/Atom parse boundary', () => {
    expect(html).toContain("let title=capTitle(decodeEntities(get('title')))||'(untitled)';");
  });
  it('applies at the JSON (Qiita) parse boundary', () => {
    expect(html).toContain("title:capTitle(it.title)||'(untitled)',");
  });
  it('applies to shared content, which also comes from outside', () => {
    expect(html).toContain('const displayTitle=capTitle(title)||nu;');
  });
  it('snippet and summary keep their existing 500-char cut', () => {
    // Guard that this change did not disturb the neighbouring limits.
    expect(html).toContain(".trim().slice(0,500)");
  });
  it('title still reaches the FTS index (the cap must not remove it from search)', () => {
    expect(html).toContain('function eventText(ev){return[ev.content.title,');
  });
});
