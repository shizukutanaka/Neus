// Neus — Watchword collector concurrency-guard tests
// Manual COLLECT, the POLL button, and periodic background sync all call
// collectAll(). Overlapping runs double-fetch every feed (dedup saves the
// data but wastes bandwidth and corrupts the count toast). A single busy
// flag serializes collection. These tests model that lock and assert the
// wiring in index.html.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// ===== Model of the busy-lock pattern used by WordCollector =====
function makeCollector(work) {
  let busy = false;
  const isBusy = () => busy;
  async function collectAll() {
    if (busy) return 0;
    busy = true;
    try { return await work(); }
    finally { busy = false; }
  }
  return { collectAll, isBusy };
}

describe('collection busy-lock (modeled)', () => {
  it('runs a single collection to completion', async () => {
    let runs = 0;
    const c = makeCollector(async () => { runs++; return 5; });
    expect(await c.collectAll()).toBe(5);
    expect(runs).toBe(1);
  });

  it('rejects an overlapping run while one is in flight', async () => {
    let resolveWork;
    const c = makeCollector(() => new Promise(r => { resolveWork = () => r(3); }));
    const first = c.collectAll();          // starts, holds the lock
    expect(c.isBusy()).toBe(true);
    const second = await c.collectAll();    // overlaps -> rejected immediately
    expect(second).toBe(0);
    resolveWork();
    expect(await first).toBe(3);
    expect(c.isBusy()).toBe(false);
  });

  it('releases the lock after the run so the next call proceeds', async () => {
    const c = makeCollector(async () => 1);
    await c.collectAll();
    expect(c.isBusy()).toBe(false);
    expect(await c.collectAll()).toBe(1);   // a fresh call works again
  });

  it('releases the lock even when the work throws', async () => {
    const c = makeCollector(async () => { throw new Error('boom'); });
    await expect(c.collectAll()).rejects.toThrow('boom');
    expect(c.isBusy()).toBe(false);
  });
});

describe('collector guard wiring (index.html)', () => {
  it('keeps a busy flag and exposes isBusy', () => {
    expect(html).toContain('let busy=false');
    expect(html).toContain('isBusy');
    expect(html).toMatch(/return\{collectOne,collectAll,fetchWiki,isBusy,getProgress\}/);
  });
  it('guards both collectOne and collectAll on the busy flag', () => {
    // collectOne shows a toast before returning 0 when busy
    expect(html).toContain("if(busy){toast(currentLang==='ja'?'収集中 — しばらくお待ちください':'collection in progress — please wait','err');return 0;}");
    // collectAll also guards with busy (its guard sits at collectAll entry)
    expect(html).toContain("if(busy){toast(currentLang==='ja'?'収集中");
    expect(html).toContain('finally{busy=false;}');
  });
  it('routes locked public calls through an unlocked _collectOne', () => {
    expect(html).toContain('async function _collectOne(word)');
    expect(html).toContain('await _collectOne(w)');
  });
  it('fetches Wikipedia and all feeds concurrently (independent I/O, not serial)', () => {
    // Each feed is a fetchFeed unit; Wikipedia + feeds run under a single Promise.all
    // so a word with N sources is one round-trip wide, not N deep.
    expect(html).toContain('async function fetchFeed(word,key,q)');
    expect(html).toContain('const keys=Object.keys(WORD_FEEDS).filter(k=>word.sources?.[k])');
    expect(html).toContain('Promise.all(keys.map(k=>fetchFeed(word,k,q)))');
    expect(html).toContain("word.sources?.wikipedia?fetchWiki(word):Promise.resolve(null)");
  });
  it('still publishes per-source inbound.error and accumulates the raw total', () => {
    expect(html).toContain("Bus.publish('inbound.error',{source:r.source,error:r.error})");
    expect(html).toContain('total+=r.items.length');
  });
  it('wraps per-word _collectOne in try-catch so one failure does not abort the batch', () => {
    // A single bad word must not stop remaining words from being processed.
    expect(html).toContain("try{total+=await _collectOne(w);}catch(e){console.warn(");
  });
  it('logs (not silently swallows) errors from initial collect after word add', () => {
    // The "add word + immediate collectOne" path had catch(e){} — empty, completely silent.
    // A failure here (e.g. IndexedDB error mid-collect) would disappear with no trace.
    // Fixed: console.warn so the error is at least visible in devtools.
    expect(html).toContain("catch(e){console.warn('[WordCollector] initial collect failed:',e);}");
  });
  it('reports raw fetched count honestly (fetched, not collected)', () => {
    expect(html).toContain('word.lastFetched=total');
    expect(html).toContain('fetched ${total} item(s)');
    expect(html).not.toContain('collected ${total} item(s)');
  });
  it('shows the real stored item count in the words modal', () => {
    expect(html).toContain('const countFor=(w)=>');
    expect(html).not.toContain('w.lastCount||0');
  });
  it('makes re-examination reversible via the undo stack', () => {
    expect(html).toContain("act==='reexamine'");
    expect(html).toContain('Verdict re-opened');
    // undo restores the full prior verdict state (status, note, history) losslessly
    expect(html).toMatch(/UndoStack\.offer[\s\S]*w\.verdict=prevVerdict;w\.verdictAt=prevAt;w\.verdictHistory=prevHistory/);
  });
});

describe('word deletion undo (index.html)', () => {
  it('captures a snapshot of the word before deletion', () => {
    expect(html).toContain('const snap={...word}');
  });
  it('calls UndoStack.offer after successful word deletion', () => {
    expect(html).toMatch(/Store\.deleteWord\(word\.id\)[\s\S]{0,300}UndoStack\.offer/);
  });
  it('undo restores the word to Store and FTS', () => {
    expect(html).toContain('await Store.putWord(snap);FTSIndex.addWord(snap)');
  });
});

describe('modal word list collection status (index.html)', () => {
  it('shows last collected time when a word has been collected', () => {
    expect(html).toContain('w.lastCollectedAt?` · ${fmtTime(w.lastCollectedAt)}`');
  });
  it('shows a not-collected indicator when lastCollectedAt is absent', () => {
    expect(html).toContain("currentLang==='ja'?'未収集':'not collected'");
  });
});

describe('cross-word dedup autoTag merge (index.html)', () => {
  it('merges incoming autoTags onto an existing hash-duplicate event', () => {
    // When watchword A and B both collect the same article, the second collect sees a
    // hash-duplicate and must merge the incoming word:B tag onto the existing event so
    // the article appears under both words' views. Old code silently dropped the tag.
    expect(html).toContain('const merged=[...new Set([...(existing.meta.autoTags||[]),...(ev.meta.autoTags||[])])]');
  });
  it('only writes the merged event to Store when tags actually changed', () => {
    // Avoid spurious writes when both events already share the same tags.
    expect(html).toContain('if(merged.length!==(existing.meta.autoTags||[]).length)');
  });
  it('normalizes the URL at the pipeline entry before hashing (cross-source dedup)', () => {
    // RSS links are normalized in parseFeed, but JSON sources (Qiita) and future paths
    // were not. Normalize once here so trivial URL variants dedup, and url/hash stay consistent.
    expect(html).toContain("const link=normalizeUrl(raw.link||'');");
    expect(html).toContain("const hash=await sha256(link+'|'+raw.title);");
    expect(html).toContain('links:[],url:link,hash};');
  });
});

describe('source-provided content tags -> autoTags (modeled)', () => {
  // Mirror of the inbound.fetched enrichment: word: tag first, then content tags
  // (e.g. Qiita article tags), lowercased, de-duplicated, capped at 8.
  function buildAutoTags(source, raw) {
    const autoTags = source.wordTerm ? ['word:' + source.wordTerm] : [];
    if (Array.isArray(raw.tags)) for (const t of raw.tags) { const tag = String(t).trim().toLowerCase(); if (tag && autoTags.length < 8 && !autoTags.includes(tag)) autoTags.push(tag); }
    return autoTags;
  }
  it('prepends the word tag, then appends lowercased content tags', () => {
    expect(buildAutoTags({ wordTerm: 'rust' }, { tags: ['WebAssembly', 'Performance'] }))
      .toEqual(['word:rust', 'webassembly', 'performance']);
  });
  it('de-duplicates and ignores blanks', () => {
    expect(buildAutoTags({ wordTerm: 'rust' }, { tags: ['Rust', 'rust', '', '  ', 'wasm'] }))
      .toEqual(['word:rust', 'rust', 'wasm']);
  });
  it('caps total autoTags at 8', () => {
    const many = Array.from({ length: 20 }, (_, i) => 'tag' + i);
    expect(buildAutoTags({ wordTerm: 'x' }, { tags: many }).length).toBe(8);
  });
  it('handles a source with no tags field', () => {
    expect(buildAutoTags({ wordTerm: 'rust' }, {})).toEqual(['word:rust']);
    expect(buildAutoTags({}, {})).toEqual([]);
  });
});

describe('content-tag enrichment wiring (index.html)', () => {
  it('Qiita parse surfaces article tag names as raw.tags', () => {
    expect(html).toContain('tags:(it.tags||[]).map(t=>t&&t.name).filter(Boolean)');
  });
  it('inbound.fetched merges raw.tags into autoTags (lowercase, dedupe, cap 8)', () => {
    expect(html).toContain('if(Array.isArray(raw.tags))for(const t of raw.tags){const tag=String(t).trim().toLowerCase();if(tag&&autoTags.length<8&&!autoTags.includes(tag))autoTags.push(tag);}');
  });
});
