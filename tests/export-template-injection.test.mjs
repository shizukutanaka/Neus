// Neus — 書き出しテンプレートの置換が「注入」にならないことを固定する (round 65)
//
// v0.13 の Vault エクスポートは利用者が本文テンプレートを書ける(`{{title}}` 等)。
// テンプレートは利用者のもの、しかし**差し込まれる値はフィード由来**(title / snippet /
// summary は第三者が内容を決める)。したがって次が成り立たないと危険:
//
//   「値の中に `{{summary}}` と書いてあっても、それが**再度置換されない**こと」
//
// 実装は `block.replace(/\{\{(\w+)\}\}/g, callback)` の**単一パス**で、`String.replace` は
// コールバックの戻り値を再走査しない。よって構造的に注入は成立しない — **実測でも成立しなかった**。
// 修正は不要だったが、この性質にテストが1件も無かったため固定する。
// 置換を「効率化」して2パスや再帰にすると、フィード側が他フィールドを引き出せるようになる。
//
// frontmatter 側は別途固定(テンプレート対象外・yamlScalar でエスケープ)で、round 55/56 が
// NaN と制御文字の経路を塞いでいる。本ファイルは**本文側**の性質を受け持つ。

import { describe, it, expect } from 'vitest';
import { extractFunction, evaluate } from './helpers/from-source.mjs';

const { renderExportTemplate } = evaluate(
  extractFunction('renderExportTemplate'), ['renderExportTemplate']);

const vals = (over = {}) => ({
  title: '', url: '', link: '', source: '', date: '',
  tags: '', summary: '', snippet: '', note: '', quote: '', ...over,
});

describe('renderExportTemplate — substituted values are never re-scanned', () => {
  it('a feed-controlled title containing {{summary}} cannot pull the summary in', () => {
    const v = vals({ title: 'Evil {{summary}} title', summary: 'SECRET-SUMMARY' });
    const out = renderExportTemplate('# {{title}}', v);
    expect(out).toBe('# Evil {{summary}} title');
    expect(out, 'the other field must not leak').not.toContain('SECRET-SUMMARY');
  });

  it('holds for every field a feed can control', () => {
    for (const field of ['title', 'snippet', 'summary', 'source']) {
      const v = vals({ [field]: '{{note}}', note: 'PRIVATE-NOTE' });
      const out = renderExportTemplate(`{{${field}}}`, v);
      expect(out, field).not.toContain('PRIVATE-NOTE');
    }
  });

  it('a value containing its own placeholder does not recurse', () => {
    const v = vals({ title: '{{title}}' });
    expect(renderExportTemplate('{{title}}', v)).toBe('{{title}}');
  });
});

describe('renderExportTemplate — documented block behaviour', () => {
  it('drops a block whose known placeholders are all empty', () => {
    const v = vals({ title: 'T' });
    expect(renderExportTemplate('# {{title}}\n\n## Summary\n{{summary}}', v)).toBe('# T');
  });
  it('keeps a block with at least one non-empty placeholder', () => {
    const v = vals({ title: 'T', summary: 'S' });
    expect(renderExportTemplate('# {{title}}\n\n{{summary}}', v)).toBe('# T\n\nS');
  });
  it('keeps a static block that has no placeholders at all', () => {
    expect(renderExportTemplate('static heading\n\n{{summary}}', vals())).toBe('static heading');
  });
  it('leaves an unknown placeholder literal so a typo stays visible', () => {
    expect(renderExportTemplate('{{titel}} and {{title}}', vals({ title: 'T' })))
      .toBe('{{titel}} and T');
  });
  it('keeps a block containing only an unknown placeholder', () => {
    // known===0, so the empty-block rule does not apply — the typo is not silently swallowed.
    expect(renderExportTemplate('{{nosuch}}', vals())).toBe('{{nosuch}}');
  });
  it('treats extra braces as literal text', () => {
    expect(renderExportTemplate('{{{title}}}', vals({ title: 'T' }))).toBe('{T}');
  });
  it('renders null/undefined as empty, never the text "null"', () => {
    // Checked with a non-empty sibling so the block survives the empty-block rule.
    const v = vals({ title: null, summary: 'S' });
    const out = renderExportTemplate('{{title}}{{summary}}', v);
    expect(out).toBe('S');
    expect(out).not.toContain('null');
    expect(out).not.toContain('undefined');
  });

  it('drops the block ENTIRELY when every placeholder is empty — including its literal text', () => {
    // Documented behaviour: the block is the unit, so static text inside an all-empty block
    // goes with it. Asserted as measured, after I first expected the "x" to survive.
    const v = vals({ title: null, summary: undefined });
    expect(renderExportTemplate('{{title}}{{summary}}x', v)).toBe('');
  });
});
