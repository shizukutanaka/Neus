// Neus — Watchword dossier import tests (round-trip the inquiry)
// A complete JSON export is only half the loop; you must be able to import it
// back. wordFromImport reconstructs a word object from a dossier JSON
// (schema 1 legacy or 2), with safe defaults and validation.
// Mirrors wordFromImport in index.html (id/timestamps are non-deterministic).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// ===== Mirrors =====
const normalizeTerm = (s) => (s || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
let _id = 0;
const uuid = () => 'id-' + (++_id);
// Mirror of defaultSources() with currentLang='en' (the common test default).
const defaultSources = () => ({ wikipedia: true, news: true, reddit: true, hn: true, arxiv: false, qiita: false, zenn: false, hatena: false, github: false });
function wordFromImport(dump) {
  if (!dump || dump.kind !== 'word-dossier' || !dump.word) return null;
  const w = dump.word;
  const term = (w.term || '').trim();
  if (!term) return null;
  const now = Date.now();
  return {
    id: uuid(), term, normalized: normalizeTerm(term), lang: w.lang || 'en',
    note: w.note || '', questionHistory: Array.isArray(w.questionHistory) ? w.questionHistory : [],
    priorBelief: w.priorBelief || 'curious',
    sources: (w.sources && typeof w.sources === 'object') ? { ...defaultSources(), ...w.sources } : defaultSources(),
    enabled: w.enabled !== false,
    verdict: { status: w.verdict?.status || 'open', note: w.verdict?.note || '' }, verdictAt: w.verdictAt || null,
    verdictHistory: Array.isArray(w.verdictHistory) ? w.verdictHistory : [], falsifier: typeof w.falsifier === 'string' ? w.falsifier : '',
    questions: Array.isArray(w.questions) ? w.questions : [],
    createdAt: w.createdAt || now, reviewedAt: w.reviewedAt || now,
    lastCollectedAt: w.lastCollectedAt || null, lastFetched: w.lastFetched || 0,
    wiki: w.wiki || null, lastErrors: w.lastErrors || null,
  };
}

const dossier = (word) => ({ app: 'neus', kind: 'word-dossier', schema: 2, word });

describe('wordFromImport — validation', () => {
  it('rejects nullish or non-dossier payloads', () => {
    expect(wordFromImport(null)).toBeNull();
    expect(wordFromImport({})).toBeNull();
    expect(wordFromImport({ kind: 'something-else', word: { term: 'x' } })).toBeNull();
  });
  it('rejects a dossier with no usable term', () => {
    expect(wordFromImport(dossier({ term: '   ' }))).toBeNull();
    expect(wordFromImport(dossier({}))).toBeNull();
  });
});

describe('wordFromImport — reconstruction', () => {
  it('restores the full inquiry from a schema-2 export', () => {
    const w = wordFromImport(dossier({
      term: 'WebGPU', lang: 'en', note: 'ready?', questionHistory: [{ text: 'old', at: 1 }],
      priorBelief: 'skeptical', sources: { arxiv: true }, enabled: true,
      verdict: { status: 'converging', note: 'leaning yes' }, verdictAt: 99,
      questions: [{ id: 'q', text: 'drivers?', createdAt: 2 }],
      createdAt: 10, reviewedAt: 20, lastCollectedAt: 30, lastFetched: 5,
      wiki: { title: 'WebGPU', extract: 'x' },
    }));
    expect(w.term).toBe('WebGPU');
    expect(w.normalized).toBe('webgpu');
    expect(w.note).toBe('ready?');
    expect(w.priorBelief).toBe('skeptical');
    expect(w.verdict).toEqual({ status: 'converging', note: 'leaning yes' });
    expect(w.verdictAt).toBe(99);
    expect(w.questions).toHaveLength(1);
    expect(w.questionHistory).toHaveLength(1);
    // Stored sources are merged with current defaults: explicit key wins, missing keys get defaults.
    expect(w.sources).toMatchObject({ arxiv: true });
    expect(w.sources).toHaveProperty('github');   // new keys filled in by the merge
    expect(w.lastFetched).toBe(5);
    expect(w.wiki.title).toBe('WebGPU');
  });

  it('normalizes the term to a fresh matching key', () => {
    expect(wordFromImport(dossier({ term: '  ＷｅｂＧＰＵ ' })).normalized).toBe('webgpu');
  });

  it('fills safe defaults for a legacy (schema 1) export missing new fields', () => {
    const w = wordFromImport(dossier({ term: 'Rust', lang: 'en', normalized: 'rust', wiki: null }));
    expect(w.note).toBe('');
    expect(w.priorBelief).toBe('curious');
    expect(w.verdict).toEqual({ status: 'open', note: '' });
    expect(w.questions).toEqual([]);
    expect(w.questionHistory).toEqual([]);
    expect(w.enabled).toBe(true);
    expect(w.sources).toEqual({ wikipedia: true, news: true, reddit: true, hn: true, arxiv: false, qiita: false, zenn: false, hatena: false, github: false });
  });

  it('honors a disabled flag', () => {
    expect(wordFromImport(dossier({ term: 'x', enabled: false })).enabled).toBe(false);
  });

  it('preserves lastErrors for signal-gap display after round-trip', () => {
    const errors = { 'Google News': 'http_429', Wikipedia: 'fetch' };
    const w = wordFromImport(dossier({ term: 'x', lastErrors: errors }));
    expect(w.lastErrors).toEqual(errors);
  });

  it('defaults lastErrors to null when absent', () => {
    const w = wordFromImport(dossier({ term: 'x' }));
    expect(w.lastErrors).toBeNull();
  });

  it('preserves verdictHistory (the dialectic trace) after round-trip', () => {
    const vh = [{ status: 'open', note: '', at: 1 }, { status: 'converging', note: 'leaning yes', at: 2 }];
    const w = wordFromImport(dossier({ term: 'x', verdictHistory: vh }));
    expect(w.verdictHistory).toEqual(vh);
  });

  it('defaults verdictHistory to an empty array when absent or malformed', () => {
    expect(wordFromImport(dossier({ term: 'x' })).verdictHistory).toEqual([]);
    expect(wordFromImport(dossier({ term: 'x', verdictHistory: 'nope' })).verdictHistory).toEqual([]);
  });

  it('preserves the falsifier (falsification condition) after round-trip', () => {
    const w = wordFromImport(dossier({ term: 'x', falsifier: 'a replicated counter-study' }));
    expect(w.falsifier).toBe('a replicated counter-study');
  });

  it('defaults falsifier to an empty string when absent or non-string', () => {
    expect(wordFromImport(dossier({ term: 'x' })).falsifier).toBe('');
    expect(wordFromImport(dossier({ term: 'x', falsifier: 42 })).falsifier).toBe('');
  });

  it('guards against malformed arrays', () => {
    const w = wordFromImport(dossier({ term: 'x', questions: 'nope', questionHistory: 5 }));
    expect(w.questions).toEqual([]);
    expect(w.questionHistory).toEqual([]);
  });

  it('assigns a fresh id on each import', () => {
    const a = wordFromImport(dossier({ term: 'a' }));
    const b = wordFromImport(dossier({ term: 'b' }));
    expect(a.id).not.toBe(b.id);
  });

  it('fills missing source keys from current defaults when importing a word from an older dossier', () => {
    // An older export only had wikipedia/news/reddit/hn/arxiv; newer sources (qiita/zenn/hatena/github)
    // were absent. After import the word should have all keys (new ones default to false).
    const oldSources = { wikipedia: true, news: true, reddit: true, hn: true, arxiv: false };
    const w = wordFromImport(dossier({ term: 'WebGPU', sources: oldSources }));
    expect(w.sources.wikipedia).toBe(true);   // preserved
    expect(w.sources.news).toBe(true);         // preserved
    expect(w.sources.arxiv).toBe(false);       // preserved
    expect(w.sources.qiita).toBe(false);       // filled with default
    expect(w.sources.zenn).toBe(false);        // filled with default
    expect(w.sources.hatena).toBe(false);      // filled with default
    expect(w.sources.github).toBe(false);      // filled with default
  });

  it('explicit source values in the dossier override the defaults (user choices survive round-trip)', () => {
    // A user who had explicitly enabled qiita and hatena should keep them after import.
    const w = wordFromImport(dossier({ term: 'Rust', sources: { qiita: true, hatena: true } }));
    expect(w.sources.qiita).toBe(true);
    expect(w.sources.hatena).toBe(true);
    expect(w.sources.github).toBe(false);   // not in dossier, gets default
  });
});

describe('import wiring (index.html)', () => {
  it('declares wordFromImport and an importJson exporter method', () => {
    expect(html).toContain('function wordFromImport');
    expect(html).toContain('async importJson(file)');
  });
  it('round-trips items, skipping hash duplicates', () => {
    expect(html).toContain('await Store.findByHash(ev.hash)');
    expect(html).toContain('FTSIndex.add(ev)');
  });
  it('preserves an existing word id when replacing', () => {
    expect(html).toContain('word.id=existing.id');
  });
  it('exposes an IMPORT control wired to a file input', () => {
    expect(html).toContain('id="word-import"');
    expect(html).toContain('id="word-import-file"');
    expect(html).toContain("WordExporter.importJson(f)");
  });
  it('preserves verdictHistory in the wordFromImport wiring', () => {
    expect(html).toContain('verdictHistory:Array.isArray(w.verdictHistory)?w.verdictHistory:[]');
  });
  it('preserves lastErrors in the wordFromImport wiring', () => {
    expect(html).toContain('lastErrors:w.lastErrors||null');
  });
});
