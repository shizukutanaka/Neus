// Neus — Watchword falsification-condition tests
// The sharpest Socratic question: "what would change your mind?" A verdict
// that cannot state its own defeaters is dogma, not knowledge (Popper's
// falsifiability, the elenchus applied to oneself). falsifierPatch records it;
// socraticPrompts uses it to sharpen the stale-verdict challenge and to flag
// settled verdicts that never stated a falsifier.
// Mirrors falsifierPatch / socraticPrompts logic in index.html.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// ===== Mirror =====
function falsifierPatch(word, newText) {
  const text = (newText || '').trim().slice(0, 280);
  const cur = (word.falsifier || '').trim();
  if (text === cur) return null;
  return { falsifier: text };
}

describe('falsifierPatch', () => {
  it('returns null when unchanged', () => {
    expect(falsifierPatch({ falsifier: 'a peer-reviewed RCT' }, 'a peer-reviewed RCT')).toBeNull();
    expect(falsifierPatch({ falsifier: 'x' }, '  x  ')).toBeNull();
  });
  it('returns null when both empty', () => {
    expect(falsifierPatch({}, '')).toBeNull();
    expect(falsifierPatch({ falsifier: '' }, '   ')).toBeNull();
  });
  it('writes a new falsifier', () => {
    expect(falsifierPatch({}, 'a benchmark regression')).toEqual({ falsifier: 'a benchmark regression' });
  });
  it('caps the falsifier at 280 chars', () => {
    const long = 'x'.repeat(400);
    expect(falsifierPatch({}, long).falsifier).toHaveLength(280);
  });
  it('trims surrounding whitespace', () => {
    expect(falsifierPatch({}, '  evidence of harm  ')).toEqual({ falsifier: 'evidence of harm' });
  });
});

describe('falsifier wiring (index.html)', () => {
  it('declares the falsifierPatch pure helper', () => {
    expect(html).toContain('function falsifierPatch(word,newText)');
  });
  it('renders the falsifier line and editor row (editfals/savefals/cancelfals)', () => {
    expect(html).toContain('class="word-falsifier"');
    expect(html).toContain('data-wact="editfals"');
    expect(html).toContain('data-wact="savefals"');
    expect(html).toContain('data-wact="cancelfals"');
    expect(html).toContain('data-fsinput="${escapeAttr(w.id)}"');
  });
  it('only offers the falsifier editor once a verdict exists (vnEditable gate)', () => {
    // fsBtn reuses the same vnEditable gate as the rationale editor
    expect(html).toContain('const fsBtn=vnEditable?');
  });
  it('handles editfals/savefals/cancelfals in the click handler', () => {
    expect(html).toContain("act==='editfals'");
    expect(html).toContain("act==='savefals'");
    expect(html).toContain("act==='cancelfals'");
    expect(html).toContain('falsifierPatch(word,input?.value)');
  });
  it('submits the falsifier on Enter and dismisses on Escape', () => {
    expect(html).toContain("input[data-fsinput]");
    expect(html).toContain('e.target.dataset.fsinput');
    expect(html).toContain("e.target.closest('[data-fsedit]')");
  });
  it('indexes the falsifier in FTS wordText', () => {
    expect(html).toContain('w.verdict?.note,w.falsifier');
  });
  it('defines CSS for the falsifier line', () => {
    expect(html).toContain('.word-falsifier{');
  });
});

describe('socraticPrompts falsifier integration (index.html)', () => {
  it('sharpens the stale prompt to reference the stated falsifier', () => {
    expect(html).toContain("key:'stale-falsifier'");
    expect(html).toContain('word.falsifier');
  });
  it('challenges a settled verdict that never stated a falsifier', () => {
    expect(html).toContain("key:'no-falsifier'");
    expect(html).toContain('SETTLED_VERDICTS.has(verdict)&&!word.falsifier');
  });
});

describe('falsifier export / round-trip (index.html)', () => {
  it('adds falsifier to dossier frontmatter and a 反証条件 section', () => {
    expect(html).toContain('word.falsifier?`falsifier: ${ys(word.falsifier)}`:null');
    expect(html).toContain('## 反証条件');
  });
  it('exports falsifier in toWordJson', () => {
    expect(html).toContain('falsifier:word.falsifier||\'\'');
  });
  it('preserves falsifier in wordFromImport', () => {
    expect(html).toContain("falsifier:typeof w.falsifier==='string'?w.falsifier:''");
  });
  it('creates new words with an empty falsifier', () => {
    expect(html).toContain("verdictHistory:[],falsifier:'',questions:[]");
  });
});
