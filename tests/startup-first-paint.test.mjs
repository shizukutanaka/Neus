// Neus — startup blocked first paint on full-store scans (round 28 audit)
//
// main() previously gated the first renderView() behind FTSIndex.rebuild() (full allEvents
// scan, chunked), TagLearner.rebuild() (another full scan, previously UNchunked — a single
// long task), VaultMatcher.tryRestoreVault(), and StorageGuard.check() (a third scan when
// over quota). None of those are needed for the first paint: the initial view only needs
// listEvents({limit}). With a few thousand events the user stared at an empty #view while
// all of it completed. Fixed by rendering first, then running the heavy init after a
// setTimeout(0) yield; TagLearner.rebuild also gained FTSIndex.rebuild's yield-every-100
// pattern. Search before the deferred FTS rebuild completes degrades gracefully (empty
// index -> empty results, progressively filled).
//
// Perf instrumentation fix folded in: Perf.mark('render') was previously only set in the
// Onboarding path, so the [Neus] ready log reported render:0.00ms for every returning user.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// Anchor the analysis to main() specifically — the backup-restore path legitimately
// rebuilds before rendering and must not satisfy/violate these assertions.
const mainStart = html.indexOf('(async function main(){');
const mainBody = html.slice(mainStart, html.indexOf('})();', mainStart));

describe('main() first-paint ordering (index.html)', () => {
  it('renders the initial view BEFORE the deferred heavy init (FTS/TagLearner/StorageGuard)', () => {
    const renderIdx = mainBody.indexOf('await refreshCounts();await renderView();');
    const ftsIdx = mainBody.indexOf('await FTSIndex.rebuild();');
    const tagIdx = mainBody.indexOf('await TagLearner.rebuild();');
    const sgIdx = mainBody.indexOf('await StorageGuard.check();');
    expect(renderIdx).toBeGreaterThan(-1);
    expect(ftsIdx).toBeGreaterThan(-1);
    expect(renderIdx).toBeLessThan(ftsIdx);
    expect(renderIdx).toBeLessThan(tagIdx);
    expect(renderIdx).toBeLessThan(sgIdx);
  });
  it('yields to the event loop between first paint and the heavy init', () => {
    const renderIdx = mainBody.indexOf('await refreshCounts();await renderView();');
    const yieldIdx = mainBody.indexOf('await new Promise(r=>setTimeout(r,0));');
    const ftsIdx = mainBody.indexOf('await FTSIndex.rebuild();');
    expect(yieldIdx).toBeGreaterThan(renderIdx);
    expect(yieldIdx).toBeLessThan(ftsIdx);
  });
  it('marks the render Perf point in main() itself (was onboarding-only, reporting 0.00ms for returning users)', () => {
    expect(mainBody).toContain("await refreshCounts();await renderView();Perf.mark('render');");
  });
  it('the ready log measures store->render->fts in the new order', () => {
    expect(mainBody).toContain("render:Perf.measure('store','render')+'ms',fts:Perf.measure('render','fts')+'ms'");
  });
});

describe('TagLearner.rebuild yields during its corpus scan (index.html)', () => {
  it('uses the same yield-every-100 pattern as FTSIndex.rebuild', () => {
    const fnIdx = html.indexOf('const TagLearner=(()=>{');
    const body = html.slice(fnIdx, html.indexOf('async function suggest', fnIdx));
    expect(body).toContain('for(let i=0;i<all.length;i++){');
    expect(body).toContain("if(i>0&&i%100===0)await (('scheduler' in window&&window.scheduler.yield)?window.scheduler.yield():new Promise(r=>setTimeout(r,0)));");
  });
});
