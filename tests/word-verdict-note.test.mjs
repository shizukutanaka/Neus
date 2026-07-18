// Neus — Watchword verdict-rationale tests
// The verdict pill cycles status (open -> converging -> answered -> suspended),
// but a conclusion without a reason is dogma, not inquiry. verdictNotePatch lets
// the user author *why* they reached a verdict. The note already flows into the
// Markdown dossier (verdict_note) and JSON export — this closes the input gap.
// Mirrors verdictNotePatch in index.html.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// ===== Mirror =====
function verdictOf(word) { return word.verdict?.status || 'open'; }
function verdictNotePatch(word, newText) {
  const text = (newText || '').trim().slice(0, 280);
  const cur = (word.verdict?.note || '').trim();
  if (text === cur) return null;
  return { verdict: { status: verdictOf(word), note: text } };
}

describe('verdictNotePatch', () => {
  it('returns null when text is unchanged', () => {
    expect(verdictNotePatch({ verdict: { status: 'answered', note: 'because X' } }, 'because X')).toBeNull();
    expect(verdictNotePatch({ verdict: { status: 'answered', note: 'because X' } }, '  because X  ')).toBeNull();
  });

  it('returns null when both empty', () => {
    expect(verdictNotePatch({ verdict: { status: 'open' } }, '')).toBeNull();
    expect(verdictNotePatch({}, '   ')).toBeNull();
  });

  it('writes a new rationale, preserving the current status', () => {
    const p = verdictNotePatch({ verdict: { status: 'answered', note: '' } }, 'drivers shipped');
    expect(p).toEqual({ verdict: { status: 'answered', note: 'drivers shipped' } });
  });

  it('keeps status when word has no verdict object yet (defaults open)', () => {
    expect(verdictNotePatch({}, 'leaning yes')).toEqual({ verdict: { status: 'open', note: 'leaning yes' } });
  });

  it('clears a rationale when emptied', () => {
    const p = verdictNotePatch({ verdict: { status: 'suspended', note: 'old' } }, '');
    expect(p).toEqual({ verdict: { status: 'suspended', note: '' } });
  });

  it('trims and caps the rationale at 280 chars', () => {
    const long = 'x'.repeat(400);
    const p = verdictNotePatch({ verdict: { status: 'answered' } }, '  ' + long + '  ');
    expect(p.verdict.note).toHaveLength(280);
  });

  it('updates an existing rationale in place', () => {
    const p = verdictNotePatch({ verdict: { status: 'converging', note: 'maybe' } }, 'now sure');
    expect(p).toEqual({ verdict: { status: 'converging', note: 'now sure' } });
  });
});

describe('verdict-note wiring (index.html)', () => {
  it('declares verdictNotePatch', () => {
    expect(html).toContain('function verdictNotePatch');
  });
  it('offers an edit affordance only for non-open verdicts', () => {
    expect(html).toContain("const vnEditable=verdictOf(w)!=='open'");
    expect(html).toContain('data-wact="editverd"');
  });
  it('renders a hidden inline rationale editor row', () => {
    expect(html).toContain('data-vnedit="${w.id}"');
    expect(html).toContain('data-vninput=');
    expect(html).toContain('data-wact="savevn"');
  });
  it('inserts the rationale row into the section after the verdict note', () => {
    expect(html).toContain('${verdictNote}\n      ${verdictNoteRow}');
  });
  it('handles editverd and savevn actions', () => {
    expect(html).toContain("act==='editverd'");
    expect(html).toContain("act==='savevn'");
    expect(html).toContain('verdictNotePatch(word,input?.value)');
  });
  it('submits the rationale on Enter', () => {
    expect(html).toContain("input[data-vninput]");
    expect(html).toContain('button[data-wact="savevn"]');
  });
  it('still carries verdict_note into the Markdown dossier', () => {
    expect(html).toContain('verdict_note: ${ys(word.verdict.note)}');
  });
});
