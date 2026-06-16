// Neus — Watchword name-filter tests
// With many words, the overview chips filter by inquiry state but give no way
// to find a specific term. The name filter narrows the WORDS view by word.normalized
// via DOM manipulation (no re-render), so the input stays focused on every keystroke.
// It stacks with the overview-chip filter (AND semantics).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// ===== Mirror of wordMatchesOv and normalizeTerm =====
const normalizeTerm = (s) => (s || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
function verdictOf(word) { return word.verdict?.status || 'open'; }
const wordMatchesOv = (w, all, filter) => {
  if (!filter) return true;
  if (filter === 'answered') return verdictOf(w) === 'answered';
  if (filter === 'open') return verdictOf(w) === 'open';
  return true;
};

// The combined filter applied by renderWords():
// shown = sorted.filter(w => wordMatchesOv(w,all,filter) && (!nameFilter || w.normalized.includes(nameFilter)))
function applyFilters(words, all, ovFilter, nameFilter) {
  return words.filter(w =>
    wordMatchesOv(w, all, ovFilter) &&
    (!nameFilter || w.normalized.includes(nameFilter.toLowerCase()))
  );
}

const words = [
  { normalized: 'webgpu', verdict: { status: 'open' } },
  { normalized: 'rust', verdict: { status: 'answered' } },
  { normalized: 'webassembly', verdict: { status: 'open' } },
  { normalized: 'graphics', verdict: { status: 'open' } },
];

describe('name filter logic', () => {
  it('returns all words when the filter is empty', () => {
    expect(applyFilters(words, [], null, '')).toHaveLength(4);
  });

  it('filters by substring of normalized name', () => {
    expect(applyFilters(words, [], null, 'web')).toHaveLength(2);
    expect(applyFilters(words, [], null, 'web').map(w => w.normalized)).toEqual(['webgpu', 'webassembly']);
  });

  it('is case-insensitive (normalized is already lowercase)', () => {
    expect(applyFilters(words, [], null, 'GPU')).toHaveLength(1);
    expect(applyFilters(words, [], null, 'gpu').map(w => w.normalized)).toEqual(['webgpu']);
  });

  it('ANDs with the overview chip filter', () => {
    // overview filter = 'open'; name filter = 'web' -> only open words containing 'web'
    const result = applyFilters(words, [], 'open', 'web');
    expect(result.map(w => w.normalized)).toEqual(['webgpu', 'webassembly']);
  });

  it('returns empty when no words match both filters', () => {
    expect(applyFilters(words, [], 'answered', 'web')).toHaveLength(0);
  });

  it('returns empty for a name with no match', () => {
    expect(applyFilters(words, [], null, 'zzzz')).toHaveLength(0);
  });
});

describe('name filter wiring (index.html)', () => {
  it('declares wordNameFilter state variable', () => {
    expect(html).toContain("let wordNameFilter=''");
  });
  it('renders a search input with id=word-name-filter', () => {
    expect(html).toContain('id="word-name-filter"');
    expect(html).toContain('class="word-name-filter"');
  });
  it('folds the name filter into the shown array', () => {
    expect(html).toContain('!wordNameFilter||w.normalized.includes(wordNameFilter)');
  });
  it('adds data-wnorm to each word section for DOM manipulation', () => {
    expect(html).toContain('data-wnorm="${escapeAttr(w.normalized)}"');
  });
  it('handles input events and manipulates display without re-render', () => {
    expect(html).toContain("e.target.closest('#word-name-filter')");
    expect(html).toContain("sec.dataset.wnorm.includes(wordNameFilter)");
    expect(html).toContain("sec.style.display=match?'':'none'");
  });
  it('updates the word count display on filter change', () => {
    expect(html).toContain("$('#word-count')");
  });
});

describe('name filter clear controls (index.html)', () => {
  it('renders a × clear button when wordNameFilter is non-empty', () => {
    expect(html).toContain('data-wact="clearwf"');
  });
  it('handles clearwf by resetting wordNameFilter and re-rendering', () => {
    expect(html).toContain("act==='clearwf'");
    expect(html).toContain("wordNameFilter='';await renderView()");
  });
  it('clears the name filter on Escape when the input is focused', () => {
    expect(html).toContain("e.target.id==='word-name-filter'");
    expect(html).toContain("wordNameFilter='';e.target.value=''");
  });
});

describe('g w keyboard shortcut (index.html)', () => {
  it('maps w to the words view in the goMap', () => {
    expect(html).toContain("w:'words'");
  });
  it('lists g w in the shortcuts table', () => {
    expect(html).toContain("keys:['g w']");
    expect(html).toContain("label:'Go WORDS'");
  });
});

describe('collect button feedback wiring (index.html)', () => {
  it('sets button text to ... during per-word collection', () => {
    expect(html).toContain("btn.textContent='...'");
    expect(html).toContain('await WordCollector.collectOne(word)');
  });
  it('modal COLLECT ALL uses setInterval progress ticker', () => {
    // There are two setInterval calls — one in the view collectall handler,
    // one in the modal #word-collect-all handler
    const matches = (html.match(/setInterval/g) || []).length;
    expect(matches).toBeGreaterThanOrEqual(2);
  });
  it('modal COLLECT ALL restores button text after completion', () => {
    expect(html).toContain("btn.textContent=_o;btn.disabled=false");
  });
});
