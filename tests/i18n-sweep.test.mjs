// Neus — systematic i18n inconsistency sweep (docs/FEATURE-AUDIT.md §1-12)
//
// Found via a round-28 UI/a11y/i18n audit: ~25 toast() call sites were single-language
// (English-only or Japanese-only), sometimes with success/failure pairs for the SAME feature
// disagreeing on language (e.g. Vault export success was bilingual but its failure toast was
// English-only). #kw-sheet (the long-press/right-click action sheet) was entirely hardcoded
// Japanese with no applyI18N wiring, and the detail modal mixed English headings with
// Japanese-only placeholders. Fixed by routing all of these through the currentLang==='ja'?
// pattern (toasts) or the DICT/t() mechanism (kw-sheet, detail modal), matching the existing
// convention used throughout the rest of the app.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

describe('kw-sheet is data-driven via I18N, not hardcoded Japanese (index.html)', () => {
  it('declares DICT keys for every kw-sheet label in both languages', () => {
    for (const key of ['kwsheet.hint', 'kwsheet.watch-hl', 'kwsheet.watch-star', 'kwsheet.block-arch', 'kwsheet.block-del', 'kwsheet.cancel']) {
      const occurrences = (html.match(new RegExp(`'${key}':`, 'g')) || []).length;
      expect(occurrences, `${key} should be declared in both ja and en DICT blocks`).toBe(2);
    }
  });
  it('applyI18N sets every kw-sheet label, preserving the dot-indicator spans via childNodes[1]', () => {
    expect(html).toContain("$('#kw-sheet-hint').textContent=t('kwsheet.hint');");
    expect(html).toContain("$('#kw-sheet-watch-hl').childNodes[1].nodeValue=t('kwsheet.watch-hl');");
    expect(html).toContain("$('#kw-sheet-watch-star').childNodes[1].nodeValue=t('kwsheet.watch-star');");
    expect(html).toContain("$('#kw-sheet-block-arch').childNodes[1].nodeValue=t('kwsheet.block-arch');");
    expect(html).toContain("$('#kw-sheet-block-del').childNodes[1].nodeValue=t('kwsheet.block-del');");
    expect(html).toContain("$('#kw-sheet-cancel').textContent=t('kwsheet.cancel');");
  });
});

describe('detail modal chrome routes through t(), no mixed-language hardcoding (index.html)', () => {
  it('declares DICT keys for every detail-modal heading/button/placeholder in both languages', () => {
    for (const key of ['detail.title', 'detail.usertags', 'detail.autotags', 'detail.quote', 'detail.quote.ph', 'detail.note', 'detail.note.ph', 'detail.tag.ph', 'detail.vaultnotes', 'detail.vault', 'detail.resummarize', 'detail.copy']) {
      const occurrences = (html.match(new RegExp(`'${key}':`, 'g')) || []).length;
      expect(occurrences, `${key} should be declared in both ja and en DICT blocks`).toBe(2);
    }
  });
  it('the openDetailModal template calls t() for headings, buttons, and placeholders', () => {
    const fnStart = html.indexOf('async function openDetailModal(ev){');
    const body = html.slice(fnStart, fnStart + 3000);
    expect(body).toContain("<h3 id=\"hd-detail\">${t('detail.title')}</h3>");
    expect(body).toContain("<h4>${t('detail.usertags')}</h4>");
    expect(body).toContain("<h4>${t('detail.autotags')}</h4>");
    expect(body).toContain("<h4>${t('detail.quote')}</h4>");
    expect(body).toContain("<h4>${t('detail.note')}</h4>");
    expect(body).toContain("placeholder=\"${escapeAttr(t('detail.tag.ph'))}\"");
    expect(body).toContain("placeholder=\"${escapeAttr(t('detail.quote.ph'))}\"");
    expect(body).toContain("placeholder=\"${escapeAttr(t('detail.note.ph'))}\"");
    expect(body).toContain("<button id=\"detail-close\" type=\"button\">${t('btn.close')}</button>");
    expect(body).toContain("<button id=\"detail-vault\" type=\"button\">${t('detail.vault')}</button>");
    expect(body).toContain("<button id=\"detail-resummarize\" type=\"button\">${t('detail.resummarize')}</button>");
    expect(body).toContain("<button id=\"detail-copy\" type=\"button\">${t('detail.copy')}</button>");
    expect(body).toContain("<button id=\"detail-save\" class=\"primary\" type=\"button\">${t('btn.save')}</button>");
  });
  it('placeholders/headings are escaped through escapeAttr where interpolated into an attribute', () => {
    expect(html).toContain("escapeAttr(t('detail.tag.ph'))");
    expect(html).toContain("escapeAttr(t('detail.quote.ph'))");
    expect(html).toContain("escapeAttr(t('detail.note.ph'))");
  });
});

describe('toast() calls that were single-language are now bilingual (index.html)', () => {
  const bilingualPairs = [
    ["File System Access APIに対応していません", 'File System Access API not supported'],
    ['コピーしました', 'copied'],
    ['クリップボードへのアクセスが拒否されました', 'clipboard denied'],
    ['Markdownをコピーしました', 'markdown copied'],
    ['BYOK APIキーが無効です', 'BYOK key invalid'],
    ['本日の要約予算に達しました', 'daily summary budget reached'],
    ['操作に失敗しました', 'action failed'],
    ['ルールの保存に失敗しました', 'rule save failed'],
    ['保存しました', 'saved'],
    ['保存に失敗しました', 'save failed'],
    ['書出に失敗しました', 'vault export failed'],
    ['要約に失敗しました(BYOK設定を確認)', 'summarize failed (check BYOK settings)'],
    ['要約を更新しました', 'summary updated'],
    ['ソースの読み込みに失敗しました', 'failed to load sources'],
    ['削除に失敗しました', 'delete failed'],
    ['無効なOPMLです', 'invalid OPML'],
    ['OPMLにソースがありません', 'no sources in OPML'],
    ['OPMLの取り込みに失敗しました', 'OPML import failed'],
    ['ソースなし', 'no sources'],
    ['OPMLの書き出しに失敗しました', 'OPML export failed'],
    ['Vault接続を解除しました', 'vault disconnected'],
    ['再適用に失敗しました', 'reapply failed'],
    ['不正なJSONです', 'invalid JSON'],
    ['Neusのバックアップファイルではありません', 'not a Neus backup'],
    ['APIキーが必要です', 'api key required'],
    ['設定を保存しました', 'settings saved'],
  ];
  it.each(bilingualPairs)('has both the ja (%s) and en (%s) branch present', (ja, en) => {
    expect(html, `missing Japanese branch: ${ja}`).toContain(ja);
    expect(html, `missing English branch: ${en}`).toContain(en);
  });
  it('deliberately leaves a few sites language-neutral (raw error passthrough, an already-bilingual variable, and the "vault:" status-label convention)', () => {
    // These are documented exceptions, not oversights — see FEATURE-AUDIT.md 1-12.
    expect(html).toContain('toast(`[${source}] ${err?.message||err}`');
    expect(html).toContain("toast(msg,n>0?'ok':'');");
    expect(html).toContain("toast(`vault: ${name}`,'ok');");
  });
});
