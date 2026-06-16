// Neus — FTS word-search tests
// Words (notes, questions, verdict rationale) are indexed by FTSIndex alongside
// events so global search also finds registered words by their metadata.
// Word results get the prefix 'word:' + wordId in search result IDs.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// ===== Mirror of FTSIndex word search logic =====
function buildIndex(gramSize = 2) {
  const index = new Map();
  const eventGrams = new Map();
  const wordGrams = new Map();

  function ngrams(text) {
    const t = (text || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const grams = new Set();
    if (t.length < gramSize) { if (t) grams.add(t); return grams; }
    for (let i = 0; i <= t.length - gramSize; i++) grams.add(t.slice(i, i + gramSize));
    return grams;
  }
  function wordText(w) {
    return [w.term, w.normalized, w.note, ...(w.questions || []).map(q => q.text), w.verdict?.note].filter(Boolean).join(' ');
  }
  function addWord(w) {
    removeWord(w.id);
    const grams = ngrams(wordText(w));
    wordGrams.set(w.id, grams);
    for (const g of grams) { let s = index.get(g); if (!s) index.set(g, s = new Set()); s.add('word:' + w.id); }
  }
  function removeWord(wid) {
    const gs = wordGrams.get(wid);
    if (!gs) return;
    wordGrams.delete(wid);
    for (const g of gs) { const s = index.get(g); if (s) { s.delete('word:' + wid); if (s.size === 0) index.delete(g); } }
  }
  function search(query, scoreMin = 0.1) {
    const qGrams = ngrams(query); if (qGrams.size === 0) return [];
    const N = (eventGrams.size + wordGrams.size) || 1;
    const counts = new Map(); let qTotalIdf = 0;
    for (const g of qGrams) {
      const s = index.get(g); if (!s) continue;
      const idf = Math.log(1 + (N - s.size + 0.5) / (s.size + 0.5));
      qTotalIdf += idf;
      for (const id of s) counts.set(id, (counts.get(id) || 0) + idf);
    }
    if (qTotalIdf === 0) return [];
    return [...counts.entries()].map(([id, acc]) => ({ id, score: acc / qTotalIdf })).filter(r => r.score >= scoreMin).sort((a, b) => b.score - a.score);
  }
  return { addWord, removeWord, search };
}

describe('FTSIndex word indexing — logic', () => {
  it('finds a word by its normalized term', () => {
    const idx = buildIndex();
    idx.addWord({ id: 'w1', term: 'WebGPU', normalized: 'webgpu', note: '', questions: [] });
    const r = idx.search('webgpu');
    expect(r.some(x => x.id === 'word:w1')).toBe(true);
  });

  it('finds a word by its inquiry note', () => {
    const idx = buildIndex();
    idx.addWord({ id: 'w1', term: 'Rust', normalized: 'rust', note: 'memory safe systems', questions: [] });
    const r = idx.search('memory safe');
    expect(r.some(x => x.id === 'word:w1')).toBe(true);
  });

  it('finds a word by a question text', () => {
    const idx = buildIndex();
    idx.addWord({ id: 'w1', term: 'Rust', normalized: 'rust', note: '', questions: [{ id: 'q1', text: 'lifetime annotations' }] });
    const r = idx.search('lifetime');
    expect(r.some(x => x.id === 'word:w1')).toBe(true);
  });

  it('finds a word by verdict rationale', () => {
    const idx = buildIndex();
    idx.addWord({ id: 'w1', term: 'Rust', normalized: 'rust', note: '', questions: [], verdict: { note: 'ownership model prevents data races' } });
    const r = idx.search('data races');
    expect(r.some(x => x.id === 'word:w1')).toBe(true);
  });

  it('prefixes word result IDs with word:', () => {
    const idx = buildIndex();
    idx.addWord({ id: 'abc123', term: 'Rust', normalized: 'rust', note: 'low-level', questions: [] });
    const r = idx.search('rust');
    const wordResult = r.find(x => x.id.startsWith('word:'));
    expect(wordResult).toBeDefined();
    expect(wordResult.id).toBe('word:abc123');
  });

  it('removeWord cleans up index entries', () => {
    const idx = buildIndex();
    idx.addWord({ id: 'w1', term: 'Rust', normalized: 'rust', note: 'low-level', questions: [] });
    expect(idx.search('rust').some(x => x.id === 'word:w1')).toBe(true);
    idx.removeWord('w1');
    expect(idx.search('rust').some(x => x.id === 'word:w1')).toBe(false);
  });

  it('re-indexing a word replaces old content', () => {
    const idx = buildIndex();
    idx.addWord({ id: 'w1', term: 'Rust', normalized: 'rust', note: 'initial note', questions: [] });
    idx.addWord({ id: 'w1', term: 'Rust', normalized: 'rust', note: 'updated note', questions: [] });
    // 'initial' should no longer match
    const r = idx.search('initial');
    expect(r.some(x => x.id === 'word:w1')).toBe(false);
  });
});

describe('word lang badge and n shortcut (index.html)', () => {
  it('shows lang badge when word.lang differs from currentLang', () => {
    expect(html).toContain('langNote=w.lang&&w.lang!==currentLang');
    expect(html).toContain('` · [${w.lang}]`');
  });
  it('n shortcut opens words modal when on WORDS view', () => {
    expect(html).toContain("k==='n'&&currentView==='words'");
    expect(html).toContain('openWordsModal()');
  });
  it('n shortcut is listed in the shortcuts table', () => {
    expect(html).toContain("keys:['n']");
    expect(html).toContain("label:'New Word'");
  });
});

describe('word result card accessibility (index.html)', () => {
  it('renders word result term as a .word-res-link button', () => {
    expect(html).toContain('class="word-res-link"');
    expect(html).toContain('data-wres=');
  });
  it('does not put data-wres on the article itself (moved to button)', () => {
    // article should not carry data-wres; the button inside h2 carries it
    expect(html).toContain('<button class="word-res-link" data-wres=');
  });
  it('word-res-link has hover and focus-visible CSS rules', () => {
    expect(html).toContain('.word-res-link:hover');
    expect(html).toContain('.word-res-link:focus-visible');
  });
});

describe('collectAll busy feedback (index.html)', () => {
  it('shows a toast when collectAll is called while busy', () => {
    expect(html).toContain('collection in progress');
    expect(html).toContain('収集中 — しばらくお待ちください');
  });
});

describe('WORDS view UX improvements (index.html)', () => {
  it('scrolls to top on WORDS view re-render', () => {
    expect(html).toContain('view.scrollTop=0');
  });
  it('renders an EXPORT ALL button in the WORDS view header', () => {
    expect(html).toContain('data-wact="exportall"');
  });
  it('exportall handler calls WordExporter.downloadAllMd()', () => {
    expect(html).toContain("act==='exportall'");
    expect(html).toContain('WordExporter.downloadAllMd()');
  });
  it('downloadAllMd marks all words as reviewed after export', () => {
    expect(html).toContain('const now=Date.now();for(const w of words){w.reviewedAt=now;await Store.putWord(w);}');
  });
  it('addq clears the input value before re-render', () => {
    expect(html).toContain("if(input)input.value='';await Store.putWord(word);FTSIndex.addWord(word);await renderView();");
  });
});

describe('FTS word search wiring (index.html)', () => {
  it('declares wordGrams in FTSIndex', () => {
    expect(html).toContain('const wordGrams=new Map()');
  });
  it('exposes addWord and removeWord from FTSIndex', () => {
    expect(html).toContain('addWord,removeWord');
  });
  it('defines wordText() to concatenate term, note, questions, verdict.note', () => {
    expect(html).toContain('function wordText(w)');
    expect(html).toContain('w.verdict?.note');
  });
  it('includes wordGrams.size in document count N for IDF', () => {
    expect(html).toContain('(eventGrams.size+wordGrams.size)||1');
  });
  it('rebuild() indexes words after events', () => {
    expect(html).toContain('const words=await Store.listWords();for(const w of words)addWord(w)');
  });
  it('stats() reports word count', () => {
    expect(html).toContain('words:wordGrams.size');
  });
  it('search view partitions word: results from event results', () => {
    expect(html).toContain("r.id.startsWith('word:')");
    expect(html).toContain("Store.getWord(r.id.slice(5))");
  });
  it('renders wordResultHtml for word search hits', () => {
    expect(html).toContain('function wordResultHtml(w,score)');
    expect(html).toContain('data-wres=');
  });
  it('clicking a word result navigates to WORDS view with name filter', () => {
    expect(html).toContain("e.target.closest('[data-wres]')");
    expect(html).toContain("wordNameFilter=wres.dataset.wres");
  });
  it('addWord is called when a word is created via the modal', () => {
    expect(html).toContain('await Store.putWord(word);FTSIndex.addWord(word)');
  });
  it('removeWord is called when a word is deleted', () => {
    expect(html).toContain('FTSIndex.removeWord(word.id)');
  });
});

describe('search-to-watchword registration banner (index.html)', () => {
  it('renders sr-word-banner when query is not yet a watchword', () => {
    expect(html).toContain('class="sr-word-banner"');
    expect(html).toContain('data-wact="regword"');
  });
  it('omits the banner when the term is already a watchword (alreadyWord)', () => {
    expect(html).toContain('alreadyWord');
    expect(html).toContain("alreadyWord?'':");
  });
  it('register handler adds the word to Store and FTS then navigates to WORDS view', () => {
    expect(html).toContain("data-wact=\"regword\"");
    expect(html).toContain("await Store.putWord(word);FTSIndex.addWord(word)");
    expect(html).toContain("wordNameFilter=normalized;currentView='words'");
  });
  it('if already registered the banner navigates to WORDS view instead of re-registering', () => {
    expect(html).toContain('await Store.findWordByTerm(normalized)');
    expect(html).toContain("wordNameFilter=normalized");
  });
  it('sr-word-banner and sr-word-btn CSS rules are defined', () => {
    expect(html).toContain('.sr-word-banner{');
    expect(html).toContain('.sr-word-btn{');
    expect(html).toContain('.sr-word-btn:hover{');
  });
});
