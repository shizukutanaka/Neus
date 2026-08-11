// Neus — Real axe-core accessibility audit (WCAG 2.0/2.1/2.2 A/AA/AAA)
// This is the industry-standard accessibility test that catches ~57% of WCAG issues.
// Used by Google Lighthouse internally.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { JSDOM } from 'jsdom';
import axe from 'axe-core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexPath = join(__dirname, '..', 'index.html');

describe('axe-core — WCAG 2.0/2.1/2.2 A/AA compliance', () => {
  let dom, results;

  beforeAll(async () => {
    const html = readFileSync(indexPath, 'utf8');
    // Strip <script type="module"> for JSDOM (can't execute IDB/SW)
    const noScript = html.replace(/<script type="module">[\s\S]*?<\/script>/g, '');
    dom = new JSDOM(noScript, { url: 'https://neus.example.com/', runScripts: 'outside-only' });

    // Inject axe into JSDOM
    const axeSource = readFileSync(join(__dirname, '..', 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
    dom.window.eval(axeSource);

    // Run axe with WCAG 2.0/2.1/2.2 A+AA tags
    results = await new Promise((resolve, reject) => {
      dom.window.axe.run(dom.window.document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
        // color-contrast is known broken in JSDOM (no rendering) — disable
        rules: { 'color-contrast': { enabled: false } },
      }, (err, r) => err ? reject(err) : resolve(r));
    });
    // 120s, not 30s: parsing a 350KB index.html into JSDOM and running the full
    // axe ruleset takes ~16s alone, but 3-5x that when the suite's other 78 files
    // are competing for CPU — the old budget made the whole run flaky, not this test.
  }, 120000);

  it('axe-core executes without crash', () => {
    expect(results).toBeTruthy();
    expect(Array.isArray(results.violations)).toBe(true);
  });

  it('zero violations (WCAG 2.0/2.1/2.2 A/AA + best practices)', () => {
    if (results.violations.length > 0) {
      // Detailed failure report
      const report = results.violations.map(v => {
        const nodes = v.nodes.slice(0, 3).map(n => n.target.join(' ')).join('; ');
        return `[${v.impact}] ${v.id}: ${v.help}\n    Nodes: ${nodes}\n    Help: ${v.helpUrl}`;
      }).join('\n\n');
      console.error('\n=== axe-core violations ===\n' + report + '\n');
    }
    expect(results.violations, `${results.violations.length} violations`).toEqual([]);
  });

  it('reports tests applied', () => {
    expect(results.passes.length).toBeGreaterThan(10);
    expect(results.passes.length + results.violations.length + results.inapplicable.length).toBeGreaterThan(40);
  });

  it('zero critical or serious violations', () => {
    const severe = results.violations.filter(v => v.impact === 'critical' || v.impact === 'serious');
    expect(severe).toEqual([]);
  });
});
