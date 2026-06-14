#!/usr/bin/env node
/**
 * Neus — Color contrast checker (WCAG 2.1 SC 1.4.3)
 *
 * Computes WCAG contrast ratios for the brand color palette.
 * Required ratios:
 *   - Normal text: 4.5:1 (AA), 7:1 (AAA)
 *   - Large text:  3:1 (AA), 4.5:1 (AAA)
 *   - UI components / graphical objects: 3:1 (AA)
 */

function hexToRgb(hex) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  const n = parseInt(hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function relativeLuminance([r, g, b]) {
  const lin = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(fg, bg) {
  const L1 = relativeLuminance(hexToRgb(fg));
  const L2 = relativeLuminance(hexToRgb(bg));
  const lighter = Math.max(L1, L2);
  const darker = Math.min(L1, L2);
  return (lighter + 0.05) / (darker + 0.05);
}

// Neus color palette
const colors = {
  bg: '#0a0d0e',
  'bg-2': '#11151a',
  'bg-3': '#161b22',
  fg: '#e6edf3',
  'fg-2': '#a3adba',
  'fg-3': '#838b96',
  accent: '#00C4CC',
  err: '#f85149',
  warn: '#d29922',
  pass: '#3fb950',
  line: '#21262d',
};

// Critical text combinations to check
const checks = [
  // [fg, bg, label, context]
  ['fg', 'bg', 'Primary text on main bg', 'normal text — AAA target'],
  ['fg-2', 'bg', 'Secondary text on main bg', 'normal text — AA min'],
  ['fg-3', 'bg', 'Tertiary text on main bg', 'normal text — AA min'],
  ['accent', 'bg', 'Accent text/icons on main bg', 'UI — 3:1 min'],
  ['err', 'bg', 'Error text on main bg', 'normal text — AA min'],
  ['warn', 'bg', 'Warning text on main bg', 'normal text — AA min'],
  ['pass', 'bg', 'Pass text on main bg', 'normal text — AA min'],
  ['fg', 'bg-2', 'Primary text on bg-2 (cards)', 'normal text — AAA target'],
  ['fg-2', 'bg-2', 'Secondary text on bg-2', 'normal text — AA min'],
  ['accent', 'bg-2', 'Accent on bg-2', 'UI — 3:1 min'],
  ['fg', 'bg-3', 'Primary on bg-3 (modals)', 'normal text — AAA target'],
  ['bg', 'accent', 'BG on accent (button text)', 'normal text — AA min'],
];

const RESET = '\x1b[0m', GREEN = '\x1b[32m', YELLOW = '\x1b[33m', RED = '\x1b[31m', GRAY = '\x1b[90m', BOLD = '\x1b[1m';

console.log(`\n${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
console.log(`${BOLD}  WCAG 2.1 Color Contrast Audit${RESET}`);
console.log(`${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n`);

let failures = 0;
let aaPasses = 0;
let aaaPasses = 0;

for (const [fgKey, bgKey, label, context] of checks) {
  const fg = colors[fgKey];
  const bg = colors[bgKey];
  const ratio = contrastRatio(fg, bg);

  // Determine required threshold from context
  let threshold = 4.5; // AA normal text default
  let target = 'AA 4.5:1';
  let aaaTarget = 7;

  if (context.includes('large text only')) { threshold = 3; target = 'AA 3:1 (large)'; aaaTarget = 4.5; }
  else if (context.includes('UI')) { threshold = 3; target = 'AA 3:1 (UI)'; aaaTarget = 4.5; }
  else if (context.includes('AAA')) { threshold = 7; target = 'AAA 7:1'; aaaTarget = 7; }

  const aaPass = ratio >= threshold;
  const aaaPass = ratio >= aaaTarget;
  const color = aaaPass ? GREEN : aaPass ? YELLOW : RED;
  const mark = aaaPass ? '✓✓' : aaPass ? '✓ ' : '✗ ';

  if (!aaPass) failures++;
  if (aaPass) aaPasses++;
  if (aaaPass) aaaPasses++;

  console.log(`  ${color}${mark}${RESET} ${label.padEnd(38)} ${BOLD}${ratio.toFixed(2)}:1${RESET}  ${GRAY}(${target})${RESET}`);
  console.log(`     ${GRAY}fg=${fg} bg=${bg} — ${context}${RESET}`);
}

console.log(`\n${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}`);
console.log(`  ${GREEN}AA  passes:${RESET}  ${aaPasses} / ${checks.length}`);
console.log(`  ${GREEN}AAA passes:${RESET}  ${aaaPasses} / ${checks.length}`);
console.log(`  ${failures > 0 ? RED : GREEN}Failures:${RESET}   ${failures}`);
console.log(`${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n`);

process.exit(failures > 0 ? 1 : 0);
