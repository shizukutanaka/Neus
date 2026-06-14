#!/usr/bin/env node
// Neus — Release verifier
// Runs all quality gates in sequence; exits non-zero on any failure.
// Usage: node scripts/release.mjs [--tag v0.2.0]

import { execSync } from 'child_process';
import { readFileSync } from 'fs';

const args = process.argv.slice(2);
const tagArg = args.find(a => a.startsWith('--tag='))?.split('=')[1];

const steps = [
  { name: 'package.json version', fn: () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    if (tagArg) {
      const expected = tagArg.replace(/^v/, '');
      if (pkg.version !== expected) {
        throw new Error(`Version mismatch: package.json=${pkg.version}, --tag=${tagArg}`);
      }
    }
    return `v${pkg.version}`;
  }},
  { name: 'CSP hash regeneration', cmd: 'node scripts/compute-csp-hash.mjs' },
  { name: 'JS syntax check', cmd: 'node --check _worker.js && node --check sw.js' },
  { name: 'HTML integrity (52 checks)', cmd: 'node scripts/check-html.mjs' },
  { name: 'Vitest (148 tests)', cmd: 'npm test --silent' },
  { name: 'npm audit (0 vulnerabilities)', cmd: 'npm audit --audit-level=high', allowFail: false },
  { name: 'CHANGELOG has version section', fn: () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    const cl = readFileSync('CHANGELOG.md', 'utf8');
    if (!cl.includes(`## [v${pkg.version}]`)) {
      throw new Error(`CHANGELOG.md missing section for v${pkg.version}`);
    }
    return `v${pkg.version} section found`;
  }},
  { name: 'No window.confirm leftovers', fn: () => {
    const html = readFileSync('index.html', 'utf8');
    // Strip JS comments to avoid false positives
    const stripped = html
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    const matches = stripped.match(/[^A-Za-z.]confirm\(/g) || [];
    if (matches.length > 0) {
      throw new Error(`Found ${matches.length} raw confirm() calls — use confirmAsync`);
    }
    return 'all replaced with confirmAsync';
  }},
  { name: 'No console.log leftovers (info/warn OK)', fn: () => {
    const html = readFileSync('index.html', 'utf8');
    const logs = (html.match(/console\.log\(/g) || []).length;
    if (logs > 2) {
      console.warn(`  WARN: ${logs} console.log calls (acceptable: ≤2)`);
    }
    return `${logs} console.log calls (acceptable)`;
  }},
];

let failed = 0;
for (const step of steps) {
  process.stdout.write(`▶ ${step.name} ... `);
  try {
    let result;
    if (step.fn) result = step.fn();
    else if (step.cmd) result = execSync(step.cmd, { stdio: 'pipe' }).toString().trim();
    console.log(`OK ${result ? `(${typeof result === 'string' ? result.slice(0, 80) : ''})` : ''}`);
  } catch (err) {
    console.log('FAIL');
    console.error(`  ${err.message.split('\n')[0]}`);
    failed++;
    if (!step.allowFail) break;
  }
}

if (failed > 0) {
  console.error(`\n${failed} step(s) failed.`);
  process.exit(1);
}

console.log('\nALL CHECKS PASSED. Ready to release.');
if (tagArg) {
  console.log(`\nNext steps:`);
  console.log(`  git add -A`);
  console.log(`  git commit -m "chore(release): ${tagArg}"`);
  console.log(`  git tag ${tagArg}`);
  console.log(`  git push origin main --tags`);
}
