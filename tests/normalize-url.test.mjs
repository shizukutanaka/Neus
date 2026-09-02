// Neus — normalizeUrl の実挙動を固定し、台帳の記述と実装のズレを防ぐ (round 57)
//
// `docs/FEATURE-AUDIT.md` は長らく「ホスト大文字小文字・末尾スラッシュ・追加トラッカーを
// 正規化していない」と記録していたが、実測するとホスト大小文字は**既に正規化済み**だった
// (`new URL().toString()` が host を自動で小文字化する)。
//
// これは単なる記述ミス以上の意味を持つ。同エントリには「正規化を変えると既存イベントとの
// ハッシュ不一致(= 一時的な重複窓)が生じる」という強い警告が付いている。誤った前提のまま
// 「ホスト小文字化を追加しよう」と着手すれば、**利得ゼロでそのリスクだけを踏む**ことになる。
// よって台帳を実測に合わせて訂正し、実挙動をテストで固定する。

import { describe, it, expect } from 'vitest';
import { loadFunctions } from './helpers/from-source.mjs';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// Mirrors normalizeUrl in index.html.
function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid']
      .forEach(p => u.searchParams.delete(p));
    return u.toString();
  } catch { return url; }
}
const same = (a, b) => normalizeUrl(a) === normalizeUrl(b);

describe('normalizeUrl — what it ALREADY collapses', () => {
  it('lowercases the host (the audit wrongly said it did not)', () => {
    expect(same('https://Example.com/a', 'https://example.com/a')).toBe(true);
    expect(same('https://EXAMPLE.COM/a', 'https://example.com/a')).toBe(true);
  });
  it('adds the implicit root path', () => {
    expect(same('https://example.com', 'https://example.com/')).toBe(true);
  });
  it('drops the fragment', () => {
    expect(same('https://example.com/a#section', 'https://example.com/a')).toBe(true);
  });
  it('strips the known tracker parameters', () => {
    for (const p of ['utm_source=x', 'utm_medium=x', 'utm_campaign=x', 'utm_term=x',
                     'utm_content=x', 'fbclid=x', 'gclid=x']) {
      expect(same(`https://example.com/a?${p}`, 'https://example.com/a'), p).toBe(true);
    }
  });
  it('keeps non-tracker query parameters', () => {
    expect(normalizeUrl('https://example.com/a?fbclid=1&id=2')).toBe('https://example.com/a?id=2');
  });
  it('drops an empty query string', () => {
    expect(same('https://example.com/a?', 'https://example.com/a')).toBe(true);
  });
});

describe('normalizeUrl — what it deliberately does NOT collapse', () => {
  it('treats a trailing slash as a distinct URL', () => {
    // /a/ and /a can address different resources; collapsing them would merge
    // genuinely different pages. This is a design decision, not a gap.
    expect(same('https://example.com/a/', 'https://example.com/a')).toBe(false);
  });
  it('treats http and https as distinct', () => {
    expect(same('http://example.com/a', 'https://example.com/a')).toBe(false);
  });
  it('does not strip unknown trackers such as ref (the real remaining gap)', () => {
    expect(same('https://example.com/a?ref=twitter', 'https://example.com/a')).toBe(false);
  });
});

describe('normalizeUrl — robustness', () => {
  it('never throws; returns the input unchanged when unparseable', () => {
    for (const bad of ['not a url', '', '///', 'javascript:alert(1)']) {
      expect(() => normalizeUrl(bad)).not.toThrow();
    }
    expect(normalizeUrl('not a url')).toBe('not a url');
  });
  it('leaves a relative path untouched rather than inventing an origin', () => {
    expect(normalizeUrl('/relative/path')).toBe('/relative/path');
  });
});

describe('wiring', () => {
  it('the tracker list is the one under test', () => {
    expect(html).toContain("['utm_source','utm_medium','utm_campaign','utm_term','utm_content','fbclid','gclid']");
  });
  it('the catch-all is still in place (the behaviour is proved above against the real function)', () => {
    expect(html).toContain('function normalizeUrl(url){');
    expect(html).toContain('catch{return url;}');
  });
});


describe('normalizeUrl — the real function, not a mirror (round 88)', () => {
  // The source-string test above only shows a `catch{return url;}` exists. This runs the
  // actual function and shows what that catch does for inputs a feed can really produce.
  const { normalizeUrl } = loadFunctions(['normalizeUrl']);

  it.each([
    ['not a url'], [''], ['javascript:alert(1)'], ['//no-scheme'], ['http://'],
  ])('returns %j unchanged instead of throwing', (input) => {
    expect(() => normalizeUrl(input)).not.toThrow();
    expect(normalizeUrl(input)).toBe(input);
  });

  it('tolerates non-string input the way a malformed feed item would supply it', () => {
    for (const v of [null, undefined, 42, {}]) expect(() => normalizeUrl(v)).not.toThrow();
  });

  it('still strips tracking parameters and fragments from a good URL', () => {
    expect(normalizeUrl('https://ex.test/a?utm_source=x&id=1#top')).toBe('https://ex.test/a?id=1');
  });
});
