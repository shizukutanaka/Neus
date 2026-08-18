// Neus — decodeEntities の安全性を**実ブラウザで**固定する (round 57)
//
// `RSSPoller.decodeEntities` はフィード由来の文字列を `textarea.innerHTML` に代入して
// HTML エンティティを復号する既知のイディオム:
//
//   const ta=document.createElement('textarea');ta.innerHTML=s;return ta.value;
//
// 監査結果は**安全**だが、安全である理由は2点の組み合わせに依存している:
//   1. `<textarea>` の中身は **RCDATA** としてパースされる。タグは要素にならず文字列のまま。
//   2. 要素は **detached**(document に挿入していない)ので、仮にノードが生成されても実行されない。
//
// 当初は「`</textarea>` が現れると RCDATA が途中で終わり、以降が切り捨てられるのでは」と疑ったが、
// **jsdom と実 Chromium の両方で切り捨ては起きなかった**(全文がそのまま `value` に入る)。
// 仮説は誤りで、実測で否定した。
//
// それでもテストを置くのは、この性質に検証が無かったため。将来 `textarea` を `div` に
// 変えるような「単純化」が入ると、RCDATA という前提が消えて DOM が構築されるようになり、
// mutation XSS の余地が生まれる。**なぜ textarea でなければならないか**を実行可能な形で残す。
//
// jsdom ではなく実ブラウザで検証する理由: HTML のパース規則(RCDATA の扱い)は実装差が出る
// ところで、本番は実ブラウザで動く。round 47 で「モックされた a11y テストが実ブラウザの
// 違反を見逃していた」のと同じ理由。

import { test, expect } from '@playwright/test';

test.describe('decodeEntities — feed text cannot escape the textarea idiom', () => {
  test.beforeEach(async ({ page }) => {
    await page.setContent('<!doctype html><html><body></body></html>');
    await page.evaluate(() => {
      window.decodeEntities = (s) => {
        if (!s || s.indexOf('&') < 0) return s;
        const ta = document.createElement('textarea');
        ta.innerHTML = s;
        return ta.value;
      };
    });
  });

  test('decodes ordinary named and numeric entities', async ({ page }) => {
    expect(await page.evaluate(() => window.decodeEntities('Tom &amp; Jerry'))).toBe('Tom & Jerry');
    expect(await page.evaluate(() => window.decodeEntities('caf&#233;'))).toBe('café');
  });

  test('returns input untouched when there is no ampersand (fast path)', async ({ page }) => {
    expect(await page.evaluate(() => window.decodeEntities('plain title'))).toBe('plain title');
  });

  test('does not truncate at a literal </textarea> in feed text', async ({ page }) => {
    // The hypothesis that RCDATA would end early and silently drop the rest of a headline.
    // Measured false in Chromium: the whole string survives.
    const out = await page.evaluate(() => window.decodeEntities('A&amp;B</textarea>REST OF TITLE'));
    expect(out).toContain('REST OF TITLE');
    expect(out).toBe('A&B</textarea>REST OF TITLE');
  });

  test('a script tag in feed text is inert and never executes', async ({ page }) => {
    const res = await page.evaluate(() => {
      window.__pwned = undefined;
      const out = window.decodeEntities('x&amp;y</textarea><script>window.__pwned=1</script>tail');
      return { out, pwned: window.__pwned };
    });
    expect(res.pwned, 'no script from feed text may run').toBeUndefined();
    expect(res.out).toContain('tail');
  });

  test('an img with onerror never fires', async ({ page }) => {
    const pwned = await page.evaluate(() => {
      window.__img = undefined;
      window.decodeEntities('&amp;<img src=x onerror="window.__img=1">');
      return window.__img;
    });
    expect(pwned).toBeUndefined();
  });

  test('single-decodes only — an escaped entity does not become live markup', async ({ page }) => {
    // &amp;lt;script&amp;gt; must decode to the TEXT "&lt;script&gt;", not to "<script>".
    const out = await page.evaluate(() => window.decodeEntities('&amp;lt;script&amp;gt;'));
    expect(out).toBe('&lt;script&gt;');
    expect(out).not.toContain('<script>');
  });

  test('the element is never attached to the document', async ({ page }) => {
    const count = await page.evaluate(() => {
      window.decodeEntities('&amp;<textarea>x</textarea>');
      return document.querySelectorAll('textarea, script, img').length;
    });
    expect(count, 'decodeEntities must not leave nodes in the document').toBe(0);
  });
});

test('the source still uses a detached textarea, not a div', async () => {
  const { readFileSync } = await import('fs');
  const { fileURLToPath } = await import('url');
  const { dirname, join } = await import('path');
  const here = dirname(fileURLToPath(import.meta.url));
  const html = readFileSync(join(here, '..', 'index.html'), 'utf8');
  // Swapping to a div would drop the RCDATA guarantee these tests rely on.
  expect(html).toContain("const ta=document.createElement('textarea');ta.innerHTML=s;return ta.value;");
});
