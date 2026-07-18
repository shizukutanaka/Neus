// Neus — Watchword accessibility & keyboard-parity tests
// The rest of the app labels every control with aria-label; the dynamically
// rendered word controls (verdict pill, re-examine badge, related/suggest
// chips, question input + delete) must do the same, and the inline question
// input must be submittable with Enter, not only by clicking "+ Q".
// These are wiring assertions against index.html (Apple HIG, CLAUDE.md).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

describe('word controls expose accessible names', () => {
  it('labels the verdict pill with its current status', () => {
    expect(html).toMatch(/class="word-verdict[^"]*"[^>]*aria-label=/);
    expect(html).toContain('verdict: ${vlabel}');
  });
  it('labels the re-examine badge with the count and reason', () => {
    expect(html).toMatch(/class="word-reexamine"[^>]*aria-label=/);
    expect(html).toContain('re-examine ${stale}:');
  });
  it('labels the related-word filter chips', () => {
    expect(html).toMatch(/class="word-rel-chip"[^>]*aria-label=/);
  });
  it('labels the suggestion chips', () => {
    expect(html).toMatch(/class="word-suggest"[^>]*aria-label=/);
  });
  it('labels the question input and its delete button', () => {
    expect(html).toMatch(/data-wqinput="\$\{escapeAttr\(w\.id\)\}"/);
    expect(html).toContain('open question for ${w.term}');
    expect(html).toMatch(/class="word-q-del"[^>]*aria-label=/);
  });
});

describe('suggest action FTS indexing', () => {
  it('calls FTSIndex.addWord immediately after Store.putWord in the suggest handler', () => {
    expect(html).toContain("await Store.putWord(word);FTSIndex.addWord(word);\n    toast(currentLang==='ja'?`「${term}」を登録 — 収集中...");
  });
});

describe('word action buttons expose accessible names (index.html)', () => {
  it('labels the collect button with the word term', () => {
    expect(html).toContain("data-wact=\"collect\" data-id=\"${w.id}\" aria-label=\"${escapeAttr(currentLang==='ja'?`${w.term} を収集`:`collect ${w.term}`)}\"");
  });
  it('labels the reviewed button with the word term', () => {
    expect(html).toContain("data-wact=\"reviewed\" data-id=\"${w.id}\" aria-label=\"${escapeAttr(currentLang==='ja'?`${w.term} を確認済みにする`:`mark ${w.term} as reviewed`)}\"");
  });
  it('labels the filter button with the word term', () => {
    expect(html).toContain("data-wact=\"filter\" data-id=\"${w.id}\" aria-label=\"${escapeAttr(currentLang==='ja'?`${w.term} で絞り込む`:`filter by ${w.term}`)}\"");
  });
  it('labels the fetched-count badge so a bare number is not ambiguous', () => {
    // wordResultHtml's count badge previously rendered ${w.lastFetched} with no label,
    // indistinguishable from the verdict pill or match %. It is the *raw fetched* count
    // (not live stored count, which the modal shows via countFor), so its title/aria-label
    // must say so explicitly.
    expect(html).toContain("収集時の取得件数: ${w.lastFetched}");
    expect(html).toContain("fetched at last collection: ${w.lastFetched}");
    expect(html).toMatch(/cntBadge=w\.lastFetched\?`<span title="\$\{escapeAttr\(cntTitle\)\}" aria-label="\$\{escapeAttr\(cntTitle\)\}"/);
  });
  it('labels the copy/md/json/vault export buttons with the word term', () => {
    expect(html).toContain("data-wact=\"copy\" data-id=\"${w.id}\" aria-label=\"${escapeAttr(currentLang==='ja'?`${w.term} のドシエをコピー`:`copy dossier for ${w.term}`)}\"");
    expect(html).toContain("data-wact=\"md\" data-id=\"${w.id}\" aria-label=\"${escapeAttr(currentLang==='ja'?`${w.term} をMarkdown出力`:`export ${w.term} as Markdown`)}\"");
    expect(html).toContain("data-wact=\"json\" data-id=\"${w.id}\" aria-label=\"${escapeAttr(currentLang==='ja'?`${w.term} をJSON出力`:`export ${w.term} as JSON`)}\"");
    expect(html).toContain("data-wact=\"vault\" data-id=\"${w.id}\" aria-label=\"${escapeAttr(currentLang==='ja'?`${w.term} をVaultへ書き出し`:`export ${w.term} to vault`)}\"");
  });
});

describe('question input keyboard parity', () => {
  it('sets enterkeyhint on the inline question input', () => {
    expect(html).toMatch(/data-wqinput=[^>]*enterkeyhint="done"|enterkeyhint="done"[^>]*data-wqinput=/);
  });
  it('submits the question on Enter via a keydown handler', () => {
    expect(html).toContain("$('#view').addEventListener('keydown'");
    expect(html).toContain("e.target.closest('input[data-wqinput]')");
    expect(html).toContain("querySelector('button[data-wact=\"addq\"]')?.click()");
  });
});

describe('refine/verdict-note row cancel and Escape (index.html)', () => {
  it('refine row has a cancel button with cancelq action', () => {
    expect(html).toContain('data-wact="cancelq"');
  });
  it('verdict note row has a cancel button with cancelvn action', () => {
    expect(html).toContain('data-wact="cancelvn"');
  });
  it('cancelq handler hides the refine row without saving', () => {
    expect(html).toContain("act==='cancelq'");
    expect(html).toContain("row.style.display='none';return;}");
  });
  it('Escape in data-rqinput hides the refine row and blurs', () => {
    expect(html).toContain("e.target.dataset.rqinput");
    expect(html).toContain("e.target.closest('[data-refine]')");
  });
  it('Escape in data-vninput hides the verdict note row and blurs', () => {
    expect(html).toContain("e.target.dataset.vninput");
    expect(html).toContain("e.target.closest('[data-vnedit]')");
  });
});

describe('modal disabled-word visual (index.html)', () => {
  it('dims the word term in the modal when enabled is false', () => {
    expect(html).toContain("w.enabled===false?' style=\"opacity:.5;\"':''");
  });
});
