// Neus — renderView stale-render race (round 28 audit)
//
// renderView has several await points (Store.listEvents, Store.getEvent, Store.findWordByTerm)
// before each view.innerHTML write, with no guard against overlapping calls. A slow render
// (e.g. INBOX with many events) could resolve after a faster, newer render (e.g. the user
// switched to STARRED) and overwrite it with stale content — the visible view would then
// disagree with the active nav tab. Fixed with a renderSeq generation counter: each call
// captures its own token at entry, and commit(html) only writes if no newer call has started.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// Mirrors the commit() guard mechanism in renderView.
function makeRenderer() {
  let renderSeq = 0;
  const view = { html: null, busy: null };
  function start() {
    const myRender = ++renderSeq;
    view.busy = true;
    const commit = (html) => {
      if (myRender !== renderSeq) return false;
      view.html = html;
      view.busy = false;
      return true;
    };
    return { myRender, commit };
  }
  return { start, view, seq: () => renderSeq };
}

describe('renderSeq generation-guard mechanism (modeled)', () => {
  it('a slower render that resolves after a newer one does not overwrite it', async () => {
    const r = makeRenderer();
    const a = r.start(); // starts first (e.g. slow INBOX render)
    const b = r.start(); // starts second (e.g. user switched to STARRED), seq is now 2
    b.commit('STARRED CONTENT'); // resolves first
    expect(r.view.html).toBe('STARRED CONTENT');
    const committed = a.commit('stale INBOX content'); // resolves late, must be rejected
    expect(committed).toBe(false);
    expect(r.view.html).toBe('STARRED CONTENT'); // unchanged
  });
  it('a lone render always commits', () => {
    const r = makeRenderer();
    const a = r.start();
    expect(a.commit('X')).toBe(true);
    expect(r.view.html).toBe('X');
    expect(r.view.busy).toBe(false);
  });
  it('three overlapping renders: only the call matching the final seq commits', () => {
    const r = makeRenderer();
    const a = r.start(), b = r.start(), c = r.start(); // seq is now 3, c is newest
    expect(a.commit('A')).toBe(false);
    expect(b.commit('B')).toBe(false);
    expect(c.commit('C')).toBe(true);
    expect(r.view.html).toBe('C');
  });
});

describe('renderSeq wiring (index.html)', () => {
  it('declares the renderSeq counter at module scope', () => {
    expect(html).toContain('let renderSeq=0;');
  });
  it('renderView captures a token and increments renderSeq at entry', () => {
    expect(html).toContain('async function renderView(){');
    expect(html).toContain('const view=$(\'#view\');const myRender=++renderSeq;');
  });
  it('defines commit() to gate every view write on the token still being current', () => {
    expect(html).toContain("const commit=(html)=>{if(myRender!==renderSeq)return false;view.innerHTML=html;view.setAttribute('aria-busy','false');return true;};");
  });
  it('every branch routes its view.innerHTML write through commit(), not a direct assignment', () => {
    const fnStart = html.indexOf('async function renderView(){');
    const fnEnd = html.indexOf("}catch(err){console.error('[renderView]',err)", fnStart);
    expect(fnStart).toBeGreaterThan(-1);
    expect(fnEnd).toBeGreaterThan(fnStart);
    const body = html.slice(fnStart, fnEnd);
    // No branch should assign view.innerHTML directly anymore (only inside commit's own definition).
    const directAssigns = (body.match(/(?<!const commit=\(html\)=>\{if\(myRender!==renderSeq\)return false;)view\.innerHTML=/g) || []);
    expect(directAssigns.length).toBe(0);
    expect((body.match(/commit\(/g) || []).length).toBeGreaterThanOrEqual(6); // digest/words/search(x3)/timeline(x2)
  });
  it('the catch branch only clears aria-busy if this call is still current', () => {
    expect(html).toContain("catch(err){console.error('[renderView]',err);if(myRender===renderSeq)view.setAttribute('aria-busy','false');}");
  });
  it('the empty-sources click handler is only attached when the empty-state commit wins', () => {
    expect(html).toContain("if(commit(`<div class=\"empty\"><div class=\"icon\">[ ]</div><div>${t('empty.inbox')}</div><div class=\"hint\">${t('empty.hint')}</div><button id=\"empty-sources\" type=\"button\">${t('btn.sources')}</button></div>`))");
    expect(html).toContain("$('#empty-sources')?.addEventListener('click',openSourcesModal);");
  });
});
