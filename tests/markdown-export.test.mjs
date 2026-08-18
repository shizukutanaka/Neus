// Neus — MarkdownExporter YAML frontmatter safety + VaultWriter / addWord guards
// A feed title or source name commonly contains ':' (and may contain newlines or
// commas), which previously broke or injected into the exported note's YAML
// frontmatter. The exporter now wraps scalar fields with a shared yamlScalar()
// escaper. These tests pin the escaping and the related robustness wiring.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// Mirror of yamlScalar in index.html.
// round 55b: \r and C0 control characters must also be escaped. YAML treats \r as a line
// break, and a raw NUL is illegal anywhere in a YAML stream, so a conforming parser rejects
// the whole document. Tab (0x09) is legal inside a double-quoted scalar and stays raw.
const yamlScalar = (s) => '"' + String(s ?? '')
  .replace(/\\/g, '\\\\')
  .replace(/"/g, '\\"')
  .replace(/\n/g, '\\n')
  .replace(/\r/g, '\\r')
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, c => '\\x' + c.charCodeAt(0).toString(16).padStart(2, '0'))
  + '"';

// Mirror of the frontmatter line construction in MarkdownExporter.toMarkdown.
function frontmatter(ev) {
  const tags = [...(ev.meta.userTags || []), ...(ev.meta.autoTags || [])];
  return ['---',
    `neus_id: ${ev.id}`,
    `source: ${yamlScalar(ev.source.name)}`,
    `source_url: ${yamlScalar(ev.source.url || '')}`,
    `tags: [${tags.map(yamlScalar).join(', ')}]`,
    `score: ${ev.meta.score}`,
    `hash: ${ev.hash}`,
    '---'].join('\n');
}
const baseEv = (over = {}) => ({ id: 'id1', hash: 'h1', source: { name: 'Tech', url: 'https://e.com' }, meta: { score: 50, userTags: [], autoTags: [] }, ...over });

describe('yamlScalar', () => {
  it('wraps a plain string in quotes', () => {
    expect(yamlScalar('Tech News')).toBe('"Tech News"');
  });
  it('keeps a colon inside the quoted scalar (does not start a new YAML key)', () => {
    expect(yamlScalar('Ars Technica: Reviews')).toBe('"Ars Technica: Reviews"');
  });
  it('escapes embedded quotes and backslashes', () => {
    expect(yamlScalar('say "hi"\\path')).toBe('"say \\"hi\\"\\\\path"');
  });
  it('escapes newlines to \\n (no real line break that splits frontmatter)', () => {
    const out = yamlScalar('line1\ninjected: evil');
    expect(out).toBe('"line1\\ninjected: evil"');
    expect(out).not.toContain('\n');
  });
  it('handles null/undefined as empty quoted string', () => {
    expect(yamlScalar(undefined)).toBe('""');
    expect(yamlScalar(null)).toBe('""');
  });
});

describe('MarkdownExporter frontmatter is injection-safe (modeled)', () => {
  it('a colon-laden source name stays a single source line', () => {
    const fm = frontmatter(baseEv({ source: { name: 'Foo: bar # baz', url: 'https://e.com' } }));
    const sourceLines = fm.split('\n').filter(l => l.startsWith('source:'));
    expect(sourceLines).toEqual(['source: "Foo: bar # baz"']);
  });
  it('a newline-injection source name cannot add a top-level YAML key', () => {
    const fm = frontmatter(baseEv({ source: { name: 'X\nmalicious: true', url: 'https://e.com' } }));
    expect(fm).not.toMatch(/^malicious:/m);     // no injected key on its own line
    expect(fm.split('\n').filter(l => l.startsWith('source:')).length).toBe(1);
  });
  it('tags with commas/brackets are individually quoted in the flow sequence', () => {
    const fm = frontmatter(baseEv({ meta: { score: 50, userTags: ['a,b', 'c]d'], autoTags: [] } }));
    expect(fm).toContain('tags: ["a,b", "c]d"]');
  });
  it('a normal event produces clean, expected frontmatter', () => {
    const fm = frontmatter(baseEv({ meta: { score: 70, userTags: ['rust'], autoTags: ['lang'] } }));
    expect(fm).toContain('source: "Tech"');
    expect(fm).toContain('source_url: "https://e.com"');
    expect(fm).toContain('tags: ["rust", "lang"]');
    expect(fm).toContain('score: 70');
  });
});

describe('mdEsc / vault daily link title escaping (index.html)', () => {
  // Bug: vault daily note links used raw ev.content.title inside [title](path).
  // Titles with ] (e.g. "GPT-4 [Technical Report]") break CommonMark link syntax.
  // Fix: extract mdEsc helper and apply it to the title in exportEvent/exportBatch.
  it('defines a standalone mdEsc helper (shared by mdLink, mdImgLink, VaultWriter)', () => {
    expect(html).toContain('const mdEsc=');
  });
  it('VaultWriter.exportEvent uses mdEsc on the event title in the daily note link', () => {
    expect(html).toContain('`- [${mdEsc(ev.content.title)}](neus/${ev.id})');
  });
  it('VaultWriter.exportBatch uses mdEsc on titles in daily note lines', () => {
    // Appears in dailyLines.push(...)
    const occ = html.split('`- [${mdEsc(ev.content.title)}](neus/${ev.id})').length - 1;
    expect(occ).toBeGreaterThanOrEqual(2);
  });
  it('mdLink uses mdEsc (no longer duplicates the inline esc function)', () => {
    expect(html).toContain('mdEsc(title)}](<${safe}>)');
    expect(html).not.toContain("const esc=(s)=>(s||'')");
  });
});

describe('export/storage robustness wiring (index.html)', () => {
  it('MarkdownExporter escapes source/source_url/tags with yamlScalar', () => {
    expect(html).toContain('source: ${yamlScalar(ev.source.name)}');
    expect(html).toContain('source_url: ${yamlScalar(ev.source.url||\'\')}');
    expect(html).toContain('tags: [${tags.map(yamlScalar).join(\', \')}]');
  });
  it('WordExporter reuses the shared yamlScalar (no duplicated escaper)', () => {
    expect(html).toContain('const ys=yamlScalar;');
  });
  it('VaultWriter aborts the writable on error and surfaces export failure', () => {
    expect(html).toContain('catch(e){try{await w.abort();}catch{}throw e;}');
    expect(html).toContain("catch(e){console.warn('[VaultWriter] export failed:',e);return false;}");
  });
  it('addWord has a synchronous in-flight guard against double-submit', () => {
    expect(html).toContain('let addingWord=false;');
    expect(html).toContain('if(addingWord)return;');
    expect(html).toContain('addingWord=true;');
    expect(html).toContain('finally{addingWord=false;}');
  });
});


describe('yamlScalar — control characters from feed text (round 55b)', () => {
  // source.name / tags / title all flow through here and all come from feeds.
  const raw = (out) => /[\r\n]/.test(out) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(out);

  it('escapes a carriage return, which YAML also treats as a line break', () => {
    const out = yamlScalar('title\rinjected: true');
    expect(out).toContain('\\r');
    expect(raw(out), 'no raw break may remain').toBe(false);
  });

  it('escapes CRLF without leaving a stray CR', () => {
    expect(raw(yamlScalar('a\r\nb'))).toBe(false);
  });

  it('escapes NUL, which is illegal anywhere in a YAML stream', () => {
    // A conforming parser must reject the entire document, so one bad feed title would
    // make the whole note unreadable to Obsidian/Dataview.
    const out = yamlScalar('a\u0000b');
    expect(out).toContain('\\x00');
    expect(raw(out)).toBe(false);
  });

  it('escapes other C0 controls and DEL', () => {
    expect(yamlScalar('a\u0007b')).toContain('\\x07');
    expect(yamlScalar('a\u007fb')).toContain('\\x7f');
  });

  it('leaves tab alone — it is legal in a double-quoted scalar', () => {
    expect(yamlScalar('a\tb')).toBe('"a\tb"');
  });

  it('still escapes the original cases', () => {
    expect(yamlScalar('say "hi"')).toBe('"say \\"hi\\""');
    expect(yamlScalar('C:\\p')).toBe('"C:\\\\p"');
    expect(yamlScalar('a\nb')).toBe('"a\\nb"');
  });

  it('the frontmatter block keeps exactly its own delimiters', () => {
    const fm = ['---', `source: ${yamlScalar('Evil\rinjected: pwned')}`, 'score: 50', '---'].join('\n');
    expect(fm.split('\n')).toHaveLength(4);
  });
});
