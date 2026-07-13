// Neus — keyboard cursor desync after card actions (round 28 audit)
//
// The s/e/r/l/v keyboard shortcuts can remove the current card from the active view (e.g. e
// archives it out of INBOX). renderView() rebuilds the card list, but kbCursor was never
// clamped to the new length nor re-applied via highlightCard — the outline (an inline style
// on the destroyed old card nodes) vanished, and the next j/k/action operated on whatever
// card now happened to occupy the stale index, with no visible cursor at all. Fixed with
// reclampCursor(), called after every action-triggered renderView() in the keydown handler.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// Mirrors reclampCursor's clamping logic (highlightCard's DOM side effects are not modeled).
function reclamp(kbCursor, cardCount) {
  if (cardCount === 0) return -1;
  if (kbCursor >= cardCount) return cardCount - 1;
  return kbCursor;
}

describe('reclampCursor clamping logic (modeled)', () => {
  it('resets to -1 when the action emptied the view', () => {
    expect(reclamp(2, 0)).toBe(-1);
  });
  it('clamps down to the new last index when the cursor pointed past the shrunk list', () => {
    expect(reclamp(3, 3)).toBe(2); // was pointing at the now-removed 4th card
  });
  it('leaves the cursor untouched when still within range', () => {
    expect(reclamp(1, 5)).toBe(1);
  });
  it('leaves -1 (no cursor) untouched when nothing was selected', () => {
    expect(reclamp(-1, 5)).toBe(-1);
  });
});

describe('reclampCursor wiring (index.html)', () => {
  it('declares reclampCursor with the empty/clamp/highlight logic', () => {
    expect(html).toContain('function reclampCursor(){');
    expect(html).toContain('if(cards.length===0){kbCursor=-1;return;}');
    expect(html).toContain('if(kbCursor>=cards.length)kbCursor=cards.length-1;');
    expect(html).toContain('if(kbCursor>=0)highlightCard(kbCursor);');
  });
  it('is called after renderView() in both the vault-export (v) and default action branches', () => {
    expect(html).toContain("toast(ok?(currentLang==='ja'?'書出完了':'exported'):(currentLang==='ja'?'書出に失敗しました':'vault export failed'),ok?'ok':'err');await renderView();await refreshCounts();reclampCursor();return;");
    expect(html).toContain('await Store.putEvent(ev);FTSIndex.add(ev);await renderView();await refreshCounts();reclampCursor();');
  });
});
