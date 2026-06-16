// Neus — Watchword sort tests
// renderWords() sorts by 'date' (createdAt desc), 'new' (unreviewed desc),
// or 'verdict' (answered first). The sort function is pure; mirrors
// _wSortVal in index.html.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// ===== Mirrored helpers =====
function verdictOf(word) { return word.verdict?.status || 'open'; }
const newSinceReview = (events, reviewedAt) => events.filter(e => (e.timestamp || 0) > (reviewedAt || 0));
const item = (norm, ts = 1) => ({ meta: { autoTags: ['word:' + norm] }, state: { archived: false }, timestamp: ts });

function wSortVal(w, all, key) {
  if (key === 'new') {
    const tag = 'word:' + w.normalized;
    const it = all.filter(e => (e.meta.autoTags || []).includes(tag) && !e.state.archived);
    return -newSinceReview(it, w.reviewedAt).length;
  }
  if (key === 'verdict') {
    const ord = { answered: 0, converging: 1, open: 2, suspended: 3 };
    return ord[verdictOf(w)] ?? 2;
  }
  return -(w.createdAt || 0);
}

const words = [
  { normalized: 'a', createdAt: 100, reviewedAt: 0, verdict: { status: 'answered' } },
  { normalized: 'b', createdAt: 200, reviewedAt: 0, verdict: { status: 'open' } },
  { normalized: 'c', createdAt: 50,  reviewedAt: 0, verdict: { status: 'converging' } },
];
const all = [item('a', 10), item('a', 20), item('b', 5)]; // a has 2 unreviewed, b has 1

function sortedBy(key) {
  return words.slice().sort((a, b) => wSortVal(a, all, key) - wSortVal(b, all, key)).map(w => w.normalized);
}

describe('word sort — date', () => {
  it('sorts newest-created first', () => {
    expect(sortedBy('date')).toEqual(['b', 'a', 'c']);
  });
});

describe('word sort — new', () => {
  it('sorts by most unreviewed items first', () => {
    expect(sortedBy('new')[0]).toBe('a'); // 2 new
    expect(sortedBy('new')[1]).toBe('b'); // 1 new
    expect(sortedBy('new')[2]).toBe('c'); // 0 new
  });
});

describe('word sort — verdict', () => {
  it('sorts answered first, then converging, then open', () => {
    expect(sortedBy('verdict')).toEqual(['a', 'c', 'b']);
  });
});

describe('sort wiring (index.html)', () => {
  it('declares wordSortKey state variable', () => {
    expect(html).toContain("let wordSortKey='date'");
  });
  it('renders sort buttons with data-wact="setsort"', () => {
    expect(html).toContain('data-wact="setsort"');
    expect(html).toContain("data-sort=\"${k}\""); // template builds date/new/verdict buttons
    expect(html).toContain("srtBtn('date'");
    expect(html).toContain("srtBtn('new'");
    expect(html).toContain("srtBtn('verdict'");
  });
  it('applies sort-active class to the current sort key', () => {
    expect(html).toContain("sort-active'");
  });
  it('handles setsort action in the click handler', () => {
    expect(html).toContain("act==='setsort'");
    expect(html).toContain('wordSortKey=btn.dataset.sort');
  });
  it('uses _wSortVal inside renderWords', () => {
    expect(html).toContain('function _wSortVal');
    expect(html).toContain("wordSortKey==='new'");
    expect(html).toContain("wordSortKey==='verdict'");
  });
});

describe('progress indicator wiring (index.html)', () => {
  it('exports getProgress from WordCollector', () => {
    expect(html).toContain('getProgress');
    expect(html).toContain('WordCollector.getProgress()');
  });
  it('uses setInterval to poll progress during collectall', () => {
    expect(html).toContain('setInterval');
    expect(html).toContain('p.total>0');
  });
  it('tracks done/total inside collectAll', () => {
    expect(html).toContain('progress={done:0,total:words.length}');
    expect(html).toContain('progress.done++');
  });
});

describe('stats modal word summary wiring (index.html)', () => {
  it('calls wordsOverview inside openStatsModal', () => {
    expect(html).toContain('wov=wordsOverview(wds,all)');
  });
  it('renders a stats row for words', () => {
    expect(html).toContain("t('stats.words')");
    expect(html).toContain('wov.answered');
  });
  it('has stats.words i18n key in both languages', () => {
    expect(html).toContain("'stats.words':'単語'");
    expect(html).toContain("'stats.words':'Words'");
  });
});
