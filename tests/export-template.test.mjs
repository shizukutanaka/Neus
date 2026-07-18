// Neus — user-customizable Vault export template (docs/FEATURE-AUDIT.md §1-9)
//
// From the 2026-07 external research pass: the incumbent PKM-sync pattern (Readwise's
// Obsidian plugin) lets users control export formatting via editable templates. Neus's
// exporter was fixed-format. This adds a zero-dependency {{placeholder}} template for the
// note BODY only — the YAML frontmatter stays fixed and yamlScalar-escaped so a template
// can never break YAML parsing or lose the machine-readable keys (neus_id, hash).
//
// Block rule (deliberately no control-flow syntax): the template splits on blank lines;
// a block whose every known placeholder resolves empty is dropped whole. Unknown
// placeholders stay literal so typos are visible instead of silently deleting content.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// Mirrors renderExportTemplate in index.html.
function renderExportTemplate(tpl, values) {
  const out = [];
  for (const block of String(tpl).split(/\n{2,}/)) {
    let known = 0, empty = 0;
    const rendered = block.replace(/\{\{(\w+)\}\}/g, (m, key) => {
      if (!(key in values)) return m;
      known++; const v = String(values[key] ?? '');
      if (!v) empty++;
      return v;
    });
    if (known > 0 && known === empty) continue;
    out.push(rendered);
  }
  return out.join('\n\n');
}

describe('renderExportTemplate (modeled)', () => {
  it('substitutes known placeholders', () => {
    expect(renderExportTemplate('# {{title}}\n{{source}}', { title: 'T', source: 'S' }))
      .toBe('# T\nS');
  });
  it('leaves unknown placeholders literal so typos stay visible', () => {
    expect(renderExportTemplate('{{title}} {{titel}}', { title: 'T' })).toBe('T {{titel}}');
  });
  it('drops a whole block when all its known placeholders are empty', () => {
    // Heading and value share a block (single newline) so they vanish together.
    const tpl = '# {{title}}\n\n## 要約\n{{summary}}\n\n{{link}}';
    const md = renderExportTemplate(tpl, { title: 'T', summary: '', link: '[L](<u>)' });
    expect(md).toBe('# T\n\n[L](<u>)');
  });
  it('keeps a heading separated from its placeholder by a blank line (own block, no placeholder)', () => {
    const tpl = '## 要約\n\n{{summary}}';
    expect(renderExportTemplate(tpl, { summary: '' })).toBe('## 要約');
  });
  it('keeps a block when at least one known placeholder is non-empty', () => {
    expect(renderExportTemplate('{{note}} / {{quote}}', { note: 'n', quote: '' })).toBe('n / ');
  });
  it('keeps placeholder-free blocks unconditionally', () => {
    expect(renderExportTemplate('static text\n\n{{summary}}', { summary: '' })).toBe('static text');
  });
  it('does not drop a block whose only placeholders are unknown (they stay literal)', () => {
    expect(renderExportTemplate('{{nope}}', { title: 'T' })).toBe('{{nope}}');
  });
  it('treats null/undefined values as empty', () => {
    expect(renderExportTemplate('{{summary}}', { summary: null })).toBe('');
    expect(renderExportTemplate('{{summary}}', { summary: undefined })).toBe('');
  });
  it('handles a multi-block template with mixed outcomes', () => {
    const tpl = 'A: {{a}}\n\nB: {{b}}\n\nC: {{c}}';
    expect(renderExportTemplate(tpl, { a: '1', b: '', c: '3' })).toBe('A: 1\n\nC: 3');
  });
});

describe('export template wiring (index.html)', () => {
  it('declares renderExportTemplate with the block-drop rule', () => {
    expect(html).toContain('function renderExportTemplate(tpl,values){');
    expect(html).toContain('if(known>0&&known===empty)continue;');
  });
  it('keeps the frontmatter fixed and prepended even when a template is set', () => {
    // The template path must return fm + rendered body — never a template-controlled fm.
    expect(html).toContain("return fm+'\\n\\n'+renderExportTemplate(this.template,values);");
  });
  it('only takes the template path for a non-empty string template', () => {
    expect(html).toContain("if(typeof this.template==='string'&&this.template.trim()){");
  });
  it('loads the template from the export-template setting at startup', () => {
    expect(html).toContain("this.template=(await Store.getSetting('export-template'))||null;");
    expect(html).toContain('await MarkdownExporter.load();');
  });
  it('exposes the documented placeholder set to the template values', () => {
    for (const key of ['title:', 'url:', 'link:', 'source:', 'date:', 'tags:', 'summary:', 'snippet:', 'note:', 'quote:']) {
      const idx = html.indexOf('const values={title:');
      expect(idx).toBeGreaterThan(-1);
      expect(html.slice(idx, idx + 400)).toContain(key);
    }
  });
  it('sanitizes the url/link placeholders through safeHref/mdLink like the fixed format does', () => {
    expect(html).toContain('url:ev.url?safeHref(ev.url):');
    expect(html).toContain("link:ev.url?mdLink('原文を開く',ev.url):");
  });
  it('has the settings UI: textarea, prefill on open, save/clear on save', () => {
    expect(html).toContain('id="set-export-template"');
    expect(html).toContain("$('#set-export-template').value=MarkdownExporter.template||'';");
    expect(html).toContain("await Store.putSetting('export-template',tplRaw);MarkdownExporter.template=tplRaw;");
    expect(html).toContain("await Store.deleteSetting('export-template');MarkdownExporter.template=null;");
  });
  it('falls back to the built-in fixed format when the template is cleared (existing anchors intact)', () => {
    expect(html).toContain("const parts=[fm,'',`# ${ev.content.title}`,''];");
    expect(html).toContain("if(ev.content.summary)parts.push('## 要約','',ev.content.summary,'');");
  });
});
