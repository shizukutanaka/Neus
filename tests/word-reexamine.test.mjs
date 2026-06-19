// Neus — Watchword re-examination tests (elenchus turned on one's own verdict)
// Socratic premise challenged: "a verdict, once reached, stays true." Genuine
// knowledge must survive continual re-examination; evidence arriving after a
// settled verdict re-opens the inquiry. Mirrors verdictStale in index.html.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// ===== Mirrored from index.html =====
function verdictOf(word) { return word.verdict?.status || 'open'; }
const SETTLED_VERDICTS = new Set(['answered', 'suspended']);
function verdictStale(word, events) {
  if (!SETTLED_VERDICTS.has(verdictOf(word))) return 0;
  const since = word.verdictAt || 0;
  if (!since) return 0;
  return events.filter(e => (e.timestamp || 0) > since).length;
}

const ev = (ts) => ({ timestamp: ts });
const wordAt = (status, verdictAt) => ({ verdict: { status, note: '' }, verdictAt });

describe('verdictStale', () => {
  it('counts items that arrived strictly after a settled verdict', () => {
    const w = wordAt('answered', 1000);
    expect(verdictStale(w, [ev(500), ev(1500), ev(2000)])).toBe(2);
  });

  it('treats suspended verdicts as settled too', () => {
    const w = wordAt('suspended', 1000);
    expect(verdictStale(w, [ev(1500)])).toBe(1);
  });

  it('returns 0 for an open inquiry — nothing to re-examine yet', () => {
    const w = wordAt('open', 1000);
    expect(verdictStale(w, [ev(2000), ev(3000)])).toBe(0);
  });

  it('returns 0 while converging — new evidence is expected, not a challenge', () => {
    const w = wordAt('converging', 1000);
    expect(verdictStale(w, [ev(2000)])).toBe(0);
  });

  it('returns 0 when no verdictAt timestamp is recorded', () => {
    const w = { verdict: { status: 'answered', note: '' }, verdictAt: null };
    expect(verdictStale(w, [ev(2000)])).toBe(0);
  });

  it('ignores items at or before the verdict timestamp (boundary is exclusive)', () => {
    const w = wordAt('answered', 1000);
    expect(verdictStale(w, [ev(1000), ev(999)])).toBe(0);
  });

  it('returns 0 when there are no events', () => {
    expect(verdictStale(wordAt('answered', 1000), [])).toBe(0);
  });

  it('defaults a missing verdict to open (not stale)', () => {
    expect(verdictStale({}, [ev(2000)])).toBe(0);
  });
});

describe('re-examination wiring (index.html)', () => {
  it('declares SETTLED_VERDICTS and verdictStale', () => {
    expect(html).toContain('SETTLED_VERDICTS');
    expect(html).toContain('function verdictStale');
  });
  it('stamps verdictAt when a verdict changes', () => {
    expect(html).toContain('verdictAt:Date.now()');
    expect(html).toContain('verdictAt:null');
  });
  it('surfaces a re-examine badge and action in the view', () => {
    expect(html).toContain('class="word-reexamine"');
    expect(html).toContain('data-wact="reexamine"');
    expect(html).toContain("act==='reexamine'");
  });
  it('includes the reexamine signal in the dossier frontmatter and verdict section', () => {
    expect(html).toContain('reexamine: ${stale}');
    expect(html).toContain('arrived after this verdict');
  });
});
