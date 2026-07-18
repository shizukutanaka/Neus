// Neus — focus-trap rebind leak, kw-sheet exclusion, single focus-restore slot (round 28 audit)
//
// Three related a11y bugs found in the same MutationObserver-driven focus management:
// 1. trapFocus() re-bound a fresh keydown listener AND recomputed first/last focusables on
//    every modal show, on a persistent element that's shown/hidden repeatedly — after N opens,
//    N stale listeners fought each other with N different (possibly outdated) first/last refs.
// 2. #kw-sheet (class sheet-backdrop, role=dialog aria-modal=true) was excluded from the
//    MutationObserver condition that installs the trap and saves/restores focus, even though
//    the keydown Escape-guard already treated it as a blocking modal — it was announced as a
//    modal dialog with no actual trap, autofocus, or focus restoration.
// 3. A single lastFocusedBeforeModal variable lost the original opener whenever a second
//    modal-like element (e.g. confirmAsync's #modal-confirm) showed while a first was still
//    open — overwritten with an element inside the first modal.
//
// Fixed by: binding the keydown listener once per modal (dataset.trapBound guard) and
// re-querying focusables live inside the handler; adding 'sheet-backdrop' to the modal-like
// class list; and replacing the single slot with a push/pop stack.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

describe('focus stack push/pop mechanism (modeled)', () => {
  function makeStack() {
    const stack = [];
    return {
      show(activeEl) { stack.push(activeEl); },
      hide() { return stack.length ? stack.pop() : null; },
      depth: () => stack.length,
    };
  }
  it('a single modal restores its own opener', () => {
    const s = makeStack();
    s.show('opener-A');
    expect(s.hide()).toBe('opener-A');
  });
  it('a modal opened over another modal restores to the correct (inner) opener first', () => {
    const s = makeStack();
    s.show('page-body'); // modal A opens from the page
    s.show('button-in-A'); // modal B (e.g. a confirm dialog) opens from inside A
    expect(s.hide()).toBe('button-in-A'); // B closes, focus returns to the element in A
    expect(s.hide()).toBe('page-body'); // A closes, focus returns to the original opener
  });
  it('does not restore anything when the stack is empty', () => {
    const s = makeStack();
    expect(s.hide()).toBe(null);
  });
});

describe('MODAL_LIKE_CLASSES includes sheet-backdrop (index.html)', () => {
  it('declares sheet-backdrop alongside modal/onboarding/lock-screen', () => {
    expect(html).toContain("const MODAL_LIKE_CLASSES=['modal','onboarding','lock-screen','sheet-backdrop'];");
  });
  it('the MutationObserver gate uses isModalLike(), not a hardcoded per-branch class check', () => {
    expect(html).toContain('function isModalLike(el){return MODAL_LIKE_CLASSES.some(c=>el.classList.contains(c));}');
    expect(html).toContain('if(!isModalLike(el))continue;');
  });
});

describe('focusStack replaces the single lastFocusedBeforeModal slot (index.html)', () => {
  it('declares focusStack as an array, with no leftover single-slot variable', () => {
    expect(html).toContain('let focusStack=[];');
    expect(html).not.toContain('let lastFocusedBeforeModal');
  });
  it('pushes the active element on show and pops (restoring it) on hide', () => {
    expect(html).toContain('focusStack.push(document.activeElement);');
    expect(html).toContain('const prev=focusStack.pop();');
    expect(html).toContain('try{prev?.focus();}catch{}');
  });
});

describe('trapFocus binds its keydown listener once per modal, not per open (index.html)', () => {
  it('guards binding with a dataset flag', () => {
    expect(html).toContain("if(!modal.dataset.trapBound){");
    expect(html).toContain("modal.dataset.trapBound='1';");
  });
  it('re-queries focusables live inside the keydown handler rather than capturing first/last once', () => {
    expect(html).toContain('function liveFocusables(modal){');
    const idx = html.indexOf("modal.addEventListener('keydown',(e)=>{");
    expect(idx).toBeGreaterThan(-1);
    const body = html.slice(idx, idx + 300);
    expect(body).toContain('const focusables=liveFocusables(modal);');
  });
  it('still auto-focuses the first focusable on every open, bound or not', () => {
    expect(html).toContain('function autoFocusFirst(modal){');
    expect(html).toContain('setTimeout(()=>focusables[0].focus(),50);');
    // Called unconditionally at the end of trapFocus, whether or not this was the first bind.
    const fnStart = html.indexOf('function trapFocus(modal){');
    const fnEnd = html.indexOf('\n}', fnStart);
    expect(html.slice(fnStart, fnEnd)).toContain('autoFocusFirst(modal);');
  });
});
