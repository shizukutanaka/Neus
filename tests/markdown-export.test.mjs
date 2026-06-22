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
const yamlScalar = (s) => '"' + String(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';

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
