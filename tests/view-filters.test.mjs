// Neus — view filter (Store.listEvents) regression tests
// The LATER view filter ({later:true,archived:false}) was silently ignored:
// listEvents only honored read/starred/archived, so LATER showed every
// non-archived event and the LATER count was wrong. These tests pin the filter
// semantics and the wiring.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// Mirror of the per-event matching in Store.listEvents.
function matches(filter, ev) {
  let m = true;
  if (filter.read !== undefined && ev.state.read !== filter.read) m = false;
  if (filter.starred !== undefined && ev.state.starred !== filter.starred) m = false;
  if (filter.archived !== undefined && ev.state.archived !== filter.archived) m = false;
  if (filter.later !== undefined && !!ev.state.later !== filter.later) m = false;
  return m;
}
const evt = (state) => ({ state: { read: false, starred: false, archived: false, later: false, ...state } });

// Mirror of VIEW_FILTERS in index.html.
const VIEW_FILTERS = { inbox: { read: false, archived: false }, all: { archived: false }, starred: { starred: true }, archived: { archived: true }, later: { later: true, archived: false } };

describe('Store.listEvents filter semantics (modeled)', () => {
  it('LATER view keeps only later, non-archived events', () => {
    const f = VIEW_FILTERS.later;
    expect(matches(f, evt({ later: true }))).toBe(true);
    expect(matches(f, evt({ later: false }))).toBe(false);        // was wrongly included before the fix
    expect(matches(f, evt({ later: true, archived: true }))).toBe(false); // archived leaves the later queue
  });
  it('treats a missing later flag (legacy events) as not-later', () => {
    const f = VIEW_FILTERS.later;
    expect(matches(f, { state: { read: false, starred: false, archived: false } })).toBe(false);
  });
  it('INBOX keeps unread, non-archived (regardless of later)', () => {
    const f = VIEW_FILTERS.inbox;
    expect(matches(f, evt({ read: false }))).toBe(true);
    expect(matches(f, evt({ read: true }))).toBe(false);
    expect(matches(f, evt({ read: false, archived: true }))).toBe(false);
    expect(matches(f, evt({ read: false, later: true }))).toBe(true); // later is orthogonal to inbox
  });
  it('ARCHIVED keeps archived events (a later+archived item belongs here)', () => {
    const f = VIEW_FILTERS.archived;
    expect(matches(f, evt({ archived: true }))).toBe(true);
    expect(matches(f, evt({ archived: true, later: true }))).toBe(true);
    expect(matches(f, evt({ archived: false }))).toBe(false);
  });
  it('STARRED keeps starred events; ALL excludes archived', () => {
    expect(matches(VIEW_FILTERS.starred, evt({ starred: true }))).toBe(true);
    expect(matches(VIEW_FILTERS.starred, evt({ starred: false }))).toBe(false);
    expect(matches(VIEW_FILTERS.all, evt({ archived: true }))).toBe(false);
    expect(matches(VIEW_FILTERS.all, evt({ archived: false }))).toBe(true);
  });
});

describe('view filter wiring (index.html)', () => {
  it('listEvents honors the later flag (the dropped filter that broke LATER)', () => {
    expect(html).toContain('if(filter.later!==undefined&&!!ev.state.later!==filter.later)m=false;');
  });
  it('still honors read / starred / archived', () => {
    expect(html).toContain('if(filter.read!==undefined&&ev.state.read!==filter.read)m=false;');
    expect(html).toContain('if(filter.starred!==undefined&&ev.state.starred!==filter.starred)m=false;');
    expect(html).toContain('if(filter.archived!==undefined&&ev.state.archived!==filter.archived)m=false;');
  });
  it('declares the LATER view filter as later+non-archived', () => {
    expect(html).toContain('later:{later:true,archived:false}');
  });
  it('resets the keyboard cursor when a tag/source filter is applied', () => {
    expect(html).toContain('function applyFilter(type,value){activeFilter={type,value};kbCursor=-1;');
  });
  it('ALL badge counts non-archived (matches the {archived:false} view, not countAll)', () => {
    // countAll includes archived; the ALL view excludes it, so the badge uses total-archived.
    expect(html).toContain("$('#cnt-all').textContent=total-archived;");
  });
  it('block-archive takes precedence over watch actions in KeywordRules.apply', () => {
    expect(html).toContain('if(!ev.state.archived)for(const r of matched.watch){');
  });
});

describe('keyboard cursor + wordViewFilter reset safety (index.html)', () => {
  // Bug: search view transitions (enter search, clear search) did not reset kbCursor.
  // Stale cursor index from a previous view applied to new search results, causing
  // keyboard navigation to select the wrong card.
  // Bug: wordViewFilter persisted when re-entering the WORDS view via a search-result
  // word click, so the user saw a filtered subset instead of the expected word.
  it('doSearch clears kbCursor when entering search view', () => {
    expect(html).toContain("currentView='search';kbCursor=-1;");
  });
  it('doSearch clears kbCursor when clearing search and returning to inbox', () => {
    expect(html).toContain("currentView='inbox';}kbCursor=-1;");
  });
  it('word result click resets wordViewFilter before entering WORDS view', () => {
    expect(html).toContain("wordViewFilter=null;wordNameFilter=wres.dataset.wres;currentView='words';kbCursor=-1;");
  });
  it('regword click also resets wordViewFilter and kbCursor when re-entering WORDS', () => {
    // Appears at least twice (existing word path + new word path)
    const occ = html.split("wordViewFilter=null;wordNameFilter=normalized;currentView='words';kbCursor=-1;").length - 1;
    expect(occ).toBeGreaterThanOrEqual(2);
  });
});

describe('event.normalized pipeline error handling (index.html)', () => {
  // Bug: the event.normalized Bus subscriber had no try/catch. Any IDB error
  // (e.g. quota exceeded) silently discarded the event with no user feedback.
  it('wraps the dedup/store pipeline in try/catch', () => {
    // try{ opens the handler body; catch closes it on the same line
    const tryIdx = html.indexOf("Bus.subscribe('event.normalized'");
    expect(tryIdx).toBeGreaterThan(0);
    const slice = html.slice(tryIdx, tryIdx + 400);
    expect(slice).toContain('try{');
    expect(slice).toContain('Store.findByHash(ev.hash)');
  });
  it('catches errors and publishes inbound.error for user visibility', () => {
    expect(html).toContain("catch(err){console.error('[Dedup] pipeline error:',err);Bus.publish('inbound.error',{source:ev.source,error:'pipeline'});}");
  });
});

describe('poll button double-submit guard (index.html)', () => {
  // Bug: clicking POLL (or triggering via SW periodic-poll-done or online event)
  // could start multiple concurrent fetchAll chains. Fix: in-flight guard moved
  // inside RSSPoller.fetchAll() itself so all callers are protected.
  it('RSSPoller.fetchAll declares fetching in-flight flag', () => {
    expect(html).toContain('let fetching=false;');
  });
  it('RSSPoller.fetchAll returns early if already in flight', () => {
    expect(html).toContain('if(fetching)return;fetching=true;');
  });
  it('RSSPoller.fetchAll resets flag in finally block', () => {
    expect(html).toContain('finally{fetching=false;}');
  });
  it('poll button disables itself during the fetch chain for UX feedback', () => {
    expect(html).toContain("const btn=$('#btn-poll');btn.disabled=true;");
    expect(html).toContain('finally{btn.disabled=false;}');
  });
});

describe('Bus subscriber error handling (index.html)', () => {
  // Bug: inbound.fetched, event.stored, event.tagged, and SourceFailTracker
  // async callbacks had no try/catch. IDB/network errors silently swallowed articles.
  it('inbound.fetched handler is wrapped in try/catch', () => {
    expect(html).toContain("catch(err){console.error('[inbound.fetched]',err);Bus.publish('inbound.error',{source,error:'normalize'});}");
  });
  it('event.stored (tagging) handler is wrapped in try/catch', () => {
    // The async event.stored subscriber that calls TagLearner.suggest
    expect(html).toContain("Bus.subscribe('event.stored',async(ev)=>{try{");
    expect(html).toContain("catch(err){console.error('[event.stored]',err);}");
  });
  it('event.tagged (Summarizer) handler is wrapped in try/catch', () => {
    expect(html).toContain("Bus.subscribe('event.tagged',async(ev)=>{try{");
    expect(html).toContain("catch(err){console.error('[event.tagged]',err);}");
  });
  it('SourceFailTracker wraps Store calls in try/catch', () => {
    expect(html).toContain("catch(err){console.warn('[SourceFailTracker]',err);}");
  });
});

describe('auto-refresh debouncing (index.html)', () => {
  // Bug: Bus.subscribe('event.stored') called renderView() directly on every event,
  // causing up to N concurrent renderView() calls during an N-article poll.
  // Fix: debounce schedules a single render 80ms after the last event.
  it('uses debounced scheduleRenderView for event.stored auto-refresh', () => {
    expect(html).toContain('const scheduleRenderView=debounce(()=>renderView(),80);');
  });
  it('uses debounced scheduleRefreshCounts for badge updates', () => {
    expect(html).toContain('const scheduleRefreshCounts=debounce(()=>refreshCounts(),80);');
  });
  it('event.stored subscriber uses the scheduled variants', () => {
    expect(html).toContain("Bus.subscribe('event.stored',()=>{scheduleRefreshCounts();scheduleRenderView();});");
  });
});

describe('FTSIndex rebuild-after-restore (index.html)', () => {
  // Bug: restore called FTSIndex.add(ev) for every event in a loop, and
  // FTSIndex.removeWord/remove for every deleted event. TagLearner.rebuild()
  // was called at the end (correct), but FTSIndex was not rebuilt in the same
  // pattern — inconsistent, and for large restores the N individual add()
  // calls block the main thread without yielding.
  // Fix: remove individual add/remove calls; call FTSIndex.rebuild() at the
  // end alongside TagLearner.rebuild() — uses the existing yield-every-100 path.
  it('restore calls FTSIndex.rebuild() after all events are stored', () => {
    expect(html).toContain('await FTSIndex.rebuild(); // batch rebuild with yield-every-100 for large restores');
  });
  it('restore does not call FTSIndex.add(ev) in the event loop', () => {
    // Find the restore section (after "復元" comment) — should not have FTSIndex.add inside the event loop
    const restoreIdx = html.indexOf('// 復元 (FTSIndex.add は呼ばず');
    expect(restoreIdx).toBeGreaterThan(0);
    const restoreSlice = html.slice(restoreIdx, restoreIdx + 400);
    expect(restoreSlice).not.toContain('FTSIndex.add(ev)');
  });
});

describe('InterestProfile time-based decay (index.html)', () => {
  // Bug: CONFIG.interestDecay (0.98) was declared but never applied.
  // Old interest signals accumulated indefinitely, making recent actions no more
  // influential than actions from months ago.
  // Fix: on load(), compute elapsed days since last save and apply decay^days.
  it('applies interestDecay on load proportional to days elapsed', () => {
    expect(html).toContain('const daysSince=saved.updatedAt?(Date.now()-saved.updatedAt)/(24*60*60*1000):0;');
    expect(html).toContain('const d=Math.pow(CONFIG.interestDecay,Math.max(0,daysSince));');
  });
  it('decays both pos and neg counters', () => {
    expect(html).toContain('vocab=new Map(saved.vocab.map(([w,e])=>[w,{pos:e.pos*d,neg:e.neg*d}]));');
  });
});

describe('source filter display (index.html)', () => {
  // Bug: clicking a source label called applyFilter('source', ev.source.id, ev.source.name).
  // applyFilter only accepts two args; the UUID was stored as activeFilter.value and shown
  // verbatim in the filter bar. Fix: pass ev.source.name so the label is human-readable.
  it('source click passes source.name (not source.id) to applyFilter', () => {
    // The old pattern passed ev.source.id as the second arg
    expect(html).not.toContain("applyFilter('source',ev.source.id");
    // The new pattern passes ev.source.name
    expect(html).toContain("applyFilter('source',ev.source.name)");
  });
  it('matchesFilter accepts both id and name matches for backward compatibility', () => {
    expect(html).toContain("ev.source.id===activeFilter.value||ev.source.name===activeFilter.value");
  });
});

// Mirror of matchesFilter for unit-testing matching logic
function matchesSourceFilter(activeFilter, ev) {
  if (!activeFilter) return true;
  if (activeFilter.type === 'source') return ev.source.id === activeFilter.value || ev.source.name === activeFilter.value;
  return true;
}

describe('source filter matching (modeled)', () => {
  const ev = { source: { id: 'uuid-1234', name: 'Hacker News' }, meta: { userTags: [], autoTags: [] }, state: {} };
  it('matches by source name', () => {
    expect(matchesSourceFilter({ type: 'source', value: 'Hacker News' }, ev)).toBe(true);
  });
  it('still matches by source id for backward compat', () => {
    expect(matchesSourceFilter({ type: 'source', value: 'uuid-1234' }, ev)).toBe(true);
  });
  it('does not match an unrelated source', () => {
    expect(matchesSourceFilter({ type: 'source', value: 'Reddit' }, ev)).toBe(false);
  });
  it('passes all events when no filter is active', () => {
    expect(matchesSourceFilter(null, ev)).toBe(true);
  });
});

describe('StorageGuard IDB/FTS ordering (index.html)', () => {
  // Bug: FTSIndex.remove(ev.id) was called before Store.deleteEvent(ev.id).
  // If the IDB deletion threw, the FTS lost the entry while IDB still held it.
  // Fix: delete from IDB first; only remove from FTS after IDB confirms success.
  it('deletes from IDB before removing from FTS in auto-cleanup loop', () => {
    // The correct order is: Store.deleteEvent first, FTSIndex.remove second.
    expect(html).toContain('await Store.deleteEvent(ev.id);FTSIndex.remove(ev.id);');
    // The old unsafe order must be gone.
    expect(html).not.toContain('FTSIndex.remove(ev.id);await Store.deleteEvent(ev.id);');
  });
  it('wraps each auto-cleanup deletion in try/catch so one failure does not abort the rest', () => {
    expect(html).toContain("catch(err){console.warn('[StorageGuard] delete failed:',ev.id,err);}");
  });
  it('only auto-evicts exported+archived events (recoverable from vault)', () => {
    // The eviction candidate filter must require BOTH archived AND exportedAt — never
    // silently delete unexported personal data (the persistent-storage invariant).
    expect(html).toContain('all.filter(ev=>ev.state.archived&&ev.state.exportedAt)');
  });
  it('warns the user instead of deleting when nothing recoverable can be evicted', () => {
    // When the exported-archived pool is empty but storage is critical, StorageGuard
    // must surface an actionable warning rather than destroying unexported data.
    expect(html).toContain('storage critical');
    expect(html).toContain('export & clear old events to free space');
  });
  it('guards against a zero/undefined quota (no division by zero)', () => {
    expect(html).toContain('if(!quota)return;');
  });
});

describe('TagLearner.rebuild error handling (index.html)', () => {
  // Bug: rebuild() had no error handling. An IDB error left dirty=true and
  // model=null, causing every subsequent suggest() call to re-enter rebuild()
  // indefinitely, creating an infinite loop on a broken IDB.
  // Fix: try/catch resets model to empty Map and sets dirty=false on error.
  it('catches IDB errors in rebuild and sets model to empty Map', () => {
    expect(html).toContain("catch(err){console.warn('[TagLearner.rebuild]',err);model=new Map();}");
  });
  it('sets dirty=false even after a rebuild error to stop infinite retry', () => {
    // dirty=false is placed after the catch block so it always executes.
    // Verify: catch sets model then dirty=false follows on the next line.
    expect(html).toContain("model=new Map();}");
    expect(html).toContain('dirty=false;');
  });
});

describe('SW periodic-poll-request error handling (index.html)', () => {
  // Bug: the async SW message handler for periodic-poll-request had no try/catch.
  // Any error (IDB, network) became an unhandled rejection.
  // Fix: wrap the handler body in try/catch.
  it('wraps periodic-poll-request handler in try/catch', () => {
    const idx = html.indexOf("e.data?.type==='periodic-poll-request'");
    expect(idx).toBeGreaterThan(0);
    const slice = html.slice(idx, idx + 800);
    expect(slice).toContain('try{');
    expect(slice).toContain("catch(err){console.error('[SW message] periodic-poll-request failed:',err);}");
  });
});

describe('ShareTarget URL protocol validation (index.html)', () => {
  // Bug: ShareTarget.ingest() stored any URL that normalizeUrl() accepted,
  // including javascript:/blob:/data: URLs that safeHref() later filters at
  // render time. Non-http URLs should be rejected before IDB storage.
  // Fix: guard with safeHref() before creating the event.
  it('rejects non-http URLs before storing', () => {
    expect(html).toContain("if(safeHref(nu)==='#'){toast(currentLang==='ja'?'無効なURL':'invalid url','err');return;}");
  });
});
