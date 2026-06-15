// Neus — Watchword verdict tests (dialectic: every inquiry has a conclusion)
// A watchword is a question; that question must eventually reach a verdict.
// Tests mirror VERDICT_DEFS / verdictOf / toDossier verdict section.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// ===== Mirrored from index.html =====
const VERDICT_DEFS = [
  { key: 'open',       ja: '探究中', en: 'open' },
  { key: 'converging', ja: '収束中', en: 'converging' },
  { key: 'answered',   ja: '解決',   en: 'answered' },
  { key: 'suspended',  ja: '保留',   en: 'suspended' },
];
function verdictOf(word) { return word.verdict?.status || 'open'; }
function nextVerdict(status) {
  const keys = VERDICT_DEFS.map(d => d.key);
  const i = keys.indexOf(status);
  return keys[(i + 1) % keys.length];
}

// Minimal toDossier variant for verdict testing
function toDossierVerdict(word) {
  const parts = [];
  const vd = verdictOf(word);
  const vdef = VERDICT_DEFS.find(d => d.key === vd) || VERDICT_DEFS[0];
  if (vd !== 'open' || word.verdict?.note) {
    parts.push('## 裁決', '');
    parts.push(`${vdef.ja} / ${vdef.en} (${vd})`);
    if (word.verdict?.note) parts.push(`> ${word.verdict.note}`);
    parts.push('');
  }
  return parts.join('\n');
}

describe('verdictOf', () => {
  it('returns open when verdict is not set', () => {
    expect(verdictOf({})).toBe('open');
    expect(verdictOf({ verdict: null })).toBe('open');
  });
  it('returns the stored status', () => {
    expect(verdictOf({ verdict: { status: 'answered' } })).toBe('answered');
    expect(verdictOf({ verdict: { status: 'converging' } })).toBe('converging');
  });
});

describe('nextVerdict', () => {
  it('cycles open => converging => answered => suspended => open', () => {
    expect(nextVerdict('open')).toBe('converging');
    expect(nextVerdict('converging')).toBe('answered');
    expect(nextVerdict('answered')).toBe('suspended');
    expect(nextVerdict('suspended')).toBe('open');
  });
});

describe('toDossier verdict section', () => {
  it('omits the section when status is open and no note', () => {
    const out = toDossierVerdict({ verdict: { status: 'open', note: '' } });
    expect(out).not.toContain('## 裁決');
  });
  it('includes the section when status is non-open', () => {
    const out = toDossierVerdict({ verdict: { status: 'answered', note: '' } });
    expect(out).toContain('## 裁決');
    expect(out).toContain('解決 / answered (answered)');
  });
  it('includes the section when open but note is set', () => {
    const out = toDossierVerdict({ verdict: { status: 'open', note: 'Still exploring' } });
    expect(out).toContain('## 裁決');
    expect(out).toContain('> Still exploring');
  });
  it('includes verdict note as a blockquote', () => {
    const out = toDossierVerdict({ verdict: { status: 'converging', note: 'Evidence points to yes' } });
    expect(out).toContain('> Evidence points to yes');
  });
});

describe('verdict wiring (index.html)', () => {
  it('declares VERDICT_DEFS and verdictOf', () => {
    expect(html).toContain('VERDICT_DEFS');
    expect(html).toContain('function verdictOf');
    expect(html).toContain('function nextVerdict');
  });
  it('surfaces verdict pill in the view', () => {
    expect(html).toContain('class="word-verdict');
    expect(html).toContain('data-wact="setverd"');
  });
  it('includes verdict in toDossier output', () => {
    expect(html).toContain('## 裁決');
    expect(html).toContain('verdict_status');
  });
});
