// Neus — SourceFailTracker no longer counts Neus's own internal errors (round 30 audit,
// docs/FEATURE-AUDIT.md 1-12)
//
// inbound.error carries error types from two distinct origins: 'network'/'http_*'/'parse'
// come from RSSPoller.fetchOne — a genuine problem reaching or reading the remote source —
// while 'normalize'/'pipeline' come from later in the client-side pipeline (URL
// normalization, dedup, keyword-rule application, DB writes), entirely inside Neus's own
// code and unrelated to whether the remote feed is healthy. The old handler counted every
// inbound.error toward auto-disable regardless of origin, so a client-side bug affecting
// many items from one feed (e.g. a normalizeUrl exception) could auto-disable a perfectly
// healthy source. Fixed with an isSourceFault() gate.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// Mirrors isSourceFault from SourceFailTracker in index.html.
function isSourceFault(error) {
  return error === 'network' || error === 'parse' || (typeof error === 'string' && error.startsWith('http_'));
}

describe('isSourceFault (modeled)', () => {
  it('treats network/parse/http_* as genuine source faults', () => {
    expect(isSourceFault('network')).toBe(true);
    expect(isSourceFault('parse')).toBe(true);
    expect(isSourceFault('http_404')).toBe(true);
    expect(isSourceFault('http_503')).toBe(true);
  });
  it('does not treat normalize/pipeline (Neus-side errors) as source faults', () => {
    expect(isSourceFault('normalize')).toBe(false);
    expect(isSourceFault('pipeline')).toBe(false);
  });
  it('is false for unknown/undefined error values (fail safe, do not disable on the unexpected)', () => {
    expect(isSourceFault(undefined)).toBe(false);
    expect(isSourceFault('something-new')).toBe(false);
  });
});

describe('SourceFailTracker wiring (index.html)', () => {
  it('declares isSourceFault and gates the error handler on it', () => {
    expect(html).toContain("function isSourceFault(error){return error==='network'||error==='parse'||(typeof error==='string'&&error.startsWith('http_'));}");
    expect(html).toContain("Bus.subscribe('inbound.error',async({source,error})=>{\n    if(!isSourceFault(error))return;");
  });
  it('normalize and pipeline errors are published (still logged/console-warned) but excluded from the counter', () => {
    // These origins still exist and still publish inbound.error for diagnostics —
    // only SourceFailTracker's counting is gated, not the event itself.
    expect(html).toContain("Bus.publish('inbound.error',{source,error:'normalize'});");
    expect(html).toContain("Bus.publish('inbound.error',{source:ev.source,error:'pipeline'});");
    expect(html).toContain("Bus.subscribe('inbound.error',({source,error})=>{console.warn(`[RSS] ${source.name}: ${error}`);});");
  });
});
