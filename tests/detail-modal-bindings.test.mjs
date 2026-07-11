// Neus — detail modal event-listener leak (round 28 audit)
//
// #detail-card is a persistent container (only its innerHTML is replaced per open). The old
// code bound a fresh click listener to it inside openDetailModal on every open, each closing
// over its own local `tags` array — so after N opens, N stale handlers fired on every tag
// click/promote, each rewriting #user-tags-row from a different stale tag list. Fixed by
// binding the delegated click handler once at module scope, reading/writing module-level
// `detailTags` instead of a per-open closure variable.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

describe('detail modal tag-click handler is bound once, not per-open (index.html)', () => {
  it('declares detailTags as module-level state, not a per-open const', () => {
    expect(html).toContain('let detailTags=[];');
    expect(html).not.toContain('const tags=[...(ev.meta.userTags||[])];');
  });
  it('binds the #detail-card click handler exactly once, outside openDetailModal', () => {
    const bindCount = (html.match(/\$\('#detail-card'\)\.addEventListener\('click',/g) || []).length;
    expect(bindCount).toBe(1);
    const bindIdx = html.indexOf("$('#detail-card').addEventListener('click',");
    const fnIdx = html.indexOf('async function openDetailModal(ev){');
    expect(bindIdx).toBeGreaterThan(-1);
    expect(fnIdx).toBeGreaterThan(-1);
    expect(bindIdx).toBeLessThan(fnIdx); // bound before the function that used to rebind it
  });
  it('openDetailModal resets detailTags from the event on every open (fresh state, shared handler)', () => {
    expect(html).toContain('currentDetailId=ev.id;detailTags=[...(ev.meta.userTags||[])];');
  });
  it('the shared handler and refresh helper operate on detailTags, not a closure variable', () => {
    expect(html).toContain('const refreshDetailTagsRow=()=>{');
    expect(html).toContain('function bindDetailTagInput(){');
    expect(html).toContain("if(rm){detailTags.splice(+rm.dataset.tagRm,1);refreshDetailTagsRow();}");
    expect(html).toContain("if(!detailTags.includes(t2))detailTags.push(t2);refreshDetailTagsRow();promote.style.display='none';");
  });
  it('detail-save persists detailTags (module state), not a stale local', () => {
    expect(html).toContain('cur.meta.userTags=detailTags;');
  });
});
