// Neus — Watchword questions tests (Socratic: knowing what you don't know)
// Every inquiry surfaces new questions; the dossier must record what remains open.
// Mirrors question logic in toDossier in index.html.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// ===== Mirrored from toDossier in index.html =====
function questionsSection(word) {
  const qs = (word.questions || []);
  if (!qs.length) return '';
  const lines = ['## 問い群', ''];
  for (const q of qs) lines.push(`- ${q.text}`);
  lines.push('');
  return lines.join('\n');
}

const q = (text) => ({ id: 'id-' + text.slice(0, 4), text, createdAt: 0 });

describe('questionsSection', () => {
  it('returns empty string when there are no questions', () => {
    expect(questionsSection({ questions: [] })).toBe('');
    expect(questionsSection({})).toBe('');
  });
  it('renders each question as a list item', () => {
    const out = questionsSection({ questions: [q('Is it safe?'), q('Is it fast?')] });
    expect(out).toContain('- Is it safe?');
    expect(out).toContain('- Is it fast?');
  });
  it('includes the section header', () => {
    const out = questionsSection({ questions: [q('Any concerns?')] });
    expect(out).toContain('## 問い群');
  });
  it('preserves insertion order', () => {
    const qs = ['First', 'Second', 'Third'].map(q);
    const out = questionsSection({ questions: qs });
    const idx = (s) => out.indexOf(s);
    expect(idx('- First')).toBeLessThan(idx('- Second'));
    expect(idx('- Second')).toBeLessThan(idx('- Third'));
  });
});

describe('questions wiring (index.html)', () => {
  it('includes the questions section heading in toDossier output', () => {
    expect(html).toContain('## 問い群');
  });
  it('supports addq and delq actions in the view handler', () => {
    expect(html).toContain("act==='addq'");
    expect(html).toContain("act==='delq'");
  });
  it('renders question input and add button in the word view', () => {
    expect(html).toContain('data-wqinput');
    expect(html).toContain('data-wact="addq"');
    expect(html).toContain('data-wact="delq"');
  });
});
