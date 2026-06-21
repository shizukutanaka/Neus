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
    // countAll includes archived; the ALL view excludes it, so the badge subtracts archived.
    expect(html).toContain('$(\'#cnt-all\').textContent=(await Store.countAll())-(await Store.countArchived());');
  });
  it('block-archive takes precedence over watch actions in KeywordRules.apply', () => {
    expect(html).toContain('if(!ev.state.archived)for(const r of matched.watch){');
  });
});
