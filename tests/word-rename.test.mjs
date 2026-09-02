// Neus — Watchword rename tests
// Renaming a watchword must preserve its full inquiry history (questions,
// verdict, wiki, collected items). When the normalized form changes, every
// collected event's `word:{normalized}` autoTag must be re-tagged so the
// items stay associated. renameWordPlan is the pure decision function.
// Mirrors renameWordPlan in index.html.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// ===== Mirror of renameWordPlan / normalizeTerm =====
const normalizeTerm = (s) => (s || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
function renameWordPlan(word, newTerm, existingTaken) {
  const term = (newTerm || '').trim();
  if (!term) return { error: 'empty' };
  const normalized = normalizeTerm(term);
  if (term === word.term && normalized === word.normalized) return { noop: true };
  const retag = normalized !== word.normalized;
  if (retag && existingTaken) return { error: 'conflict' };
  return { patch: { term, normalized }, retag };
}

describe('renameWordPlan — decisions', () => {
  const word = { term: 'WebPGU', normalized: 'webpgu' };

  it('rejects an empty term', () => {
    expect(renameWordPlan(word, '   ', false)).toEqual({ error: 'empty' });
    expect(renameWordPlan(word, '', false)).toEqual({ error: 'empty' });
  });

  it('is a no-op when nothing changed', () => {
    expect(renameWordPlan(word, 'WebPGU', false)).toEqual({ noop: true });
  });

  it('fixes a typo that changes the normalized form (retag required)', () => {
    const plan = renameWordPlan(word, 'WebGPU', false);
    expect(plan).toEqual({ patch: { term: 'WebGPU', normalized: 'webgpu' }, retag: true });
  });

  it('changes only the display case without retagging when normalized is stable', () => {
    const w = { term: 'webgpu', normalized: 'webgpu' };
    const plan = renameWordPlan(w, 'WebGPU', false);
    expect(plan).toEqual({ patch: { term: 'WebGPU', normalized: 'webgpu' }, retag: false });
  });

  it('blocks a rename that would collide with an existing watchword', () => {
    expect(renameWordPlan(word, 'Rust', true)).toEqual({ error: 'conflict' });
  });

  it('does not flag a conflict when the normalized form is unchanged even if taken=true', () => {
    // taken only matters when retag is true; case-only edits never conflict
    const w = { term: 'rust', normalized: 'rust' };
    const plan = renameWordPlan(w, 'Rust', true);
    expect(plan).toEqual({ patch: { term: 'Rust', normalized: 'rust' }, retag: false });
  });

  it('trims surrounding whitespace from the new term', () => {
    const plan = renameWordPlan(word, '  WebGPU  ', false);
    expect(plan.patch.term).toBe('WebGPU');
    expect(plan.patch.normalized).toBe('webgpu');
  });
});

describe('rename wiring (index.html)', () => {
  it('declares the renameWordPlan pure helper', () => {
    expect(html).toContain('function renameWordPlan(word,newTerm,existingTaken)');
  });
  it('renders a RENAME button and inline rename row in the modal word list', () => {
    expect(html).toContain('data-wmact="rename"');
    expect(html).toContain('data-wrename="${w.id}"');
    expect(html).toContain('data-wrinput="${escapeAttr(w.id)}"');
  });
  it('saverename re-tags collected events when the normalized form changes', () => {
    expect(html).toContain("act==='saverename'");
    expect(html).toContain("const oldTag='word:'+oldNorm,newTag='word:'+word.normalized");
    // round 74: the loop re-reads each event before writing, so the snapshot taken at the
    // top of the sweep cannot clobber a star or summary that landed while it ran.
    expect(html).toContain('const fresh=await Store.getEvent(ev.id);');
    expect(html).toContain('tags[i]=newTag;await Store.putEvent(fresh);FTSIndex.add(fresh);');
  });
  it('saverename guards against double-submit via btn.disabled', () => {
    expect(html).toContain('if(btn.disabled)return;');
    // round 59: oldTerm is captured too, so a failed rename can restore in-memory state.
    expect(html).toContain('const oldNorm=word.normalized,oldTerm=word.term;');
  });
  it('saverename reports a conflict toast', () => {
    expect(html).toContain("plan.error==='conflict'");
    expect(html).toContain("'that term already exists'");
  });
  it('rename input submits on Enter and dismisses on Escape', () => {
    expect(html).toContain("input[data-wrinput]");
    expect(html).toContain('button[data-wmact="saverename"]');
    expect(html).toContain("e.key==='Escape'");
  });
});


describe('rename failure recovery (round 59)', () => {
  // The rename retags every event and then saves the word; putEvent runs one at a time, so
  // it cannot be a single transaction. What makes a mid-way failure survivable is that the
  // in-memory word is restored, leaving it consistent with IDB so a re-run replans the same
  // rename — and the retag loop skips already-updated events, so the retry finishes the job.
  it('wraps the retag + save in try/catch', () => {
    expect(html).toContain("}catch(err){\n      console.error('[word-rename]',err);");
  });
  it('restores the in-memory word so it matches what IDB still holds', () => {
    expect(html).toContain('word.normalized=oldNorm;word.term=oldTerm;');
  });
  it('re-enables the button so the user can retry', () => {
    expect(html).toContain('btn.disabled=false;                          // 再実行できるようにする');
  });
  it('tells the user a retry resumes rather than restarting', () => {
    expect(html).toContain('rename failed — running it again resumes where it stopped');
  });
  it('still saves the word LAST, which is what makes the retry converge', () => {
    const src = html.slice(html.indexOf('const oldNorm=word.normalized,oldTerm=word.term;'));
    const retagAt = src.indexOf("const oldTag='word:'+oldNorm");
    const saveAt = src.indexOf('await Store.putWord(word);FTSIndex.addWord(word);');
    expect(retagAt).toBeGreaterThan(-1);
    expect(saveAt).toBeGreaterThan(retagAt);
  });
  it('the retag skips events already carrying the new tag — shape; the handler is inline and cannot be extracted', () => {
    // indexOf(oldTag) < 0 for an already-migrated event, so a re-run only fixes the rest.
    // round 74: the check now runs on the freshly-read copy, which is what keeps it honest —
    // testing the stale snapshot would re-apply work another writer had already done.
    expect(html).toContain("const tags=fresh.meta?.autoTags||[];const i=tags.indexOf(oldTag);");
    expect(html).toContain('if(i<0)continue;');
  });
});
