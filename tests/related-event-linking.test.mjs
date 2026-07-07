// Neus — Related event auto-linking (ADR-0020, docs/FEATURE-AUDIT.md §1-3)
//
// Plan.md §4.9 (v1.1) planned "関連付け自動化(類似度ベース、リンク自動生成)". The dedup
// pipeline already computed a title-similarity score (jaccard on tokenized titles) against
// the recent window, but discarded anything below dedupTitleThreshold=0.8 entirely — even
// though moderately-similar-but-distinct articles (a followup, a different angle on the same
// story) are common and worth surfacing. This reuses the exact dedup infrastructure
// (recentEvents/tokenize/jaccard, ADR-0019's dedupCompareMax window) to record a bidirectional
// related:{eventId} link — extending links[]'s existing string-prefix convention (bare URL =
// same-article alias, vault: = matched Obsidian note) rather than introducing a new store.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// Mirrors the three-way branch added to the dedup loop: dup-merge / related-link / neither.
function classify(sim, dedupTitleThreshold = 0.8, relatedTitleThreshold = 0.4) {
  if (sim >= dedupTitleThreshold) return 'duplicate';
  if (sim >= relatedTitleThreshold) return 'related';
  return 'unrelated';
}

describe('dedup vs related classification (modeled)', () => {
  it('classifies high similarity as a duplicate (merges, does not link)', () => {
    expect(classify(0.85)).toBe('duplicate');
    expect(classify(0.8)).toBe('duplicate'); // boundary is inclusive, matching existing dedup
  });
  it('classifies mid-range similarity as related (links, does not merge)', () => {
    expect(classify(0.5)).toBe('related');
    expect(classify(0.4)).toBe('related'); // boundary is inclusive
    expect(classify(0.79)).toBe('related');
  });
  it('classifies low similarity as unrelated (neither link nor merge)', () => {
    expect(classify(0.39)).toBe('unrelated');
    expect(classify(0.1)).toBe('unrelated');
    expect(classify(0)).toBe('unrelated');
  });
  it('the related band sits strictly below the dedup threshold (mutually exclusive by construction)', () => {
    // relatedTitleThreshold must be lower than dedupTitleThreshold, or every "related" case
    // would already have been claimed by the duplicate-merge branch first.
    const RELATED = 0.4, DEDUP = 0.8;
    expect(RELATED).toBeLessThan(DEDUP);
  });
});

describe('related-link cap (modeled)', () => {
  function pushRelated(links, tag, max) {
    if (links.length >= max) return links;
    if (links.includes(tag)) return links;
    return [...links, tag];
  }
  it('stops adding once the cap is reached', () => {
    let links = [];
    for (let i = 0; i < 10; i++) links = pushRelated(links, `related:e${i}`, 5);
    expect(links).toHaveLength(5);
  });
  it('does not add a duplicate tag for the same related event twice', () => {
    let links = pushRelated([], 'related:e1', 5);
    links = pushRelated(links, 'related:e1', 5);
    expect(links).toEqual(['related:e1']);
  });
});

describe('related-event linking wiring (index.html)', () => {
  it('declares the config thresholds', () => {
    expect(html).toContain('relatedTitleThreshold:0.4, relatedMax:5,');
  });
  it('checks the related threshold only in the else branch of the duplicate check (mutually exclusive)', () => {
    expect(html).toContain("else if(sim>=CONFIG.relatedTitleThreshold&&ev.links.length<CONFIG.relatedMax){");
  });
  it('records the link bidirectionally using the related: prefix convention', () => {
    expect(html).toContain("const fwdTag=`related:${r.id}`,revTag=`related:${ev.id}`;");
    expect(html).toContain('if(!ev.links.includes(fwdTag))ev.links=[...ev.links,fwdTag];');
    expect(html).toContain("if(!(r.links||[]).includes(revTag)&&(r.links||[]).length<CONFIG.relatedMax){r.links=[...(r.links||[]),revTag];await Store.putEvent(r);FTSIndex.add(r);}");
  });
  it('resolves related: links to actual events in the detail modal, dropping unresolvable ones silently', () => {
    expect(html).toContain("const relatedIds=(ev.links||[]).filter(l=>l.startsWith('related:')).map(l=>l.slice(8));");
    expect(html).toContain('const relatedEvents=(await Promise.all(relatedIds.map(id=>Store.getEvent(id)))).filter(Boolean);');
  });
  it('renders a RELATED ITEMS block only when resolved related events exist', () => {
    expect(html).toContain('const relatedHtml=relatedEvents.length?');
    expect(html).toContain('data-related-id=');
  });
  it('clicking a related item navigates into its own detail modal', () => {
    expect(html).toContain("const related=e.target.closest('[data-related-id]');if(related){e.preventDefault();const r=await Store.getEvent(related.dataset.relatedId);if(r)openDetailModal(r);}");
  });
});
