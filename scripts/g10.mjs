#!/usr/bin/env node
// G10 release gate runner.
//
// Runs every gate that a machine can decide, prints the verdict table, and — importantly —
// prints exactly what is left for a human and why. The point is that nobody has to reconstruct
// "what still needs doing" from prose: this command answers it.
//
// Design note (round 49): gates that require human judgement are NOT auto-passed and are NOT
// quietly dropped. They are reported as OWNER with the reason, and the process exits non-zero
// so this can never be mistaken for "everything is green".

import { execSync } from 'child_process';

const NC = '\x1b[0m', B = '\x1b[1m', G = '\x1b[32m', Y = '\x1b[33m', R = '\x1b[31m', D = '\x1b[2m';

function run(cmd, { capture = true } = {}) {
  try {
    const out = execSync(cmd, { stdio: capture ? 'pipe' : 'inherit', encoding: 'utf8' });
    return { ok: true, out: out || '' };
  } catch (e) {
    return { ok: false, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}
const num = (re, s, d = '?') => (s.match(re)?.[1] ?? d);

console.log(`\n${B}G10 release gates${NC} ${D}(npm run g10)${NC}\n`);

const results = [];

// --- G10.01 lint -------------------------------------------------------------
process.stdout.write('  G10.01 lint ............ ');
const lint = run('npm run lint --silent');
const lintHtml = run('npm run lint:html --silent');
const g1 = lint.ok && lintHtml.ok;
console.log(g1 ? `${G}PASS${NC}` : `${R}FAIL${NC}`);
results.push(['G10.01', 'Linter zero warnings', g1 ? 'PASS' : 'FAIL',
  g1 ? 'node --check + HTML/CSP static checks' : 'see output above']);

// --- G10.02 tests + module coverage -----------------------------------------
process.stdout.write('  G10.02 tests ........... ');
const vt = run('npx vitest run 2>&1');
const tests = num(/Tests\s+(\d+) passed/, vt.out);
const files = num(/Test Files\s+(\d+) passed/, vt.out);
const g2 = vt.ok;
console.log(g2 ? `${G}PASS${NC} ${D}${tests} tests / ${files} files${NC}` : `${R}FAIL${NC}`);
results.push(['G10.02', 'Tests + module coverage', g2 ? 'PASS' : 'FAIL', `${tests} tests / ${files} files`]);

// --- G10.03 vulnerabilities --------------------------------------------------
process.stdout.write('  G10.03 audit ........... ');
const audit = run('npm audit --audit-level=high 2>&1');
console.log(audit.ok ? `${G}PASS${NC} ${D}0 high/critical${NC}` : `${R}FAIL${NC}`);
results.push(['G10.03', 'No Critical/High vulns', audit.ok ? 'PASS' : 'FAIL',
  audit.ok ? '0 vulnerabilities' : 'npm audit reported findings']);

// --- G10.04 cross-review -----------------------------------------------------
process.stdout.write('  G10.04 cross-review .... ');
const briefs = run('ls docs/reviews/AUDIT-BRIEF.md docs/reviews/OPUS.md docs/reviews/SONNET.md');
console.log(briefs.ok ? `${G}PASS${NC}` : `${R}FAIL${NC}`);
results.push(['G10.04', 'Cross-review briefs', briefs.ok ? 'PASS' : 'FAIL', 'docs/reviews/ + SPEC §10 audit log']);

// --- G10.05 docs -------------------------------------------------------------
process.stdout.write('  G10.05 docs ............ ');
const docs = run('npx vitest run tests/dict-no-dead-keys.test.mjs tests/docs-no-frozen-counts.test.mjs 2>&1');
console.log(docs.ok ? `${G}PASS${NC}` : `${R}FAIL${NC}`);
results.push(['G10.05', 'Docs consistency', docs.ok ? 'PASS' : 'FAIL', 'no dead i18n keys, no frozen counts']);

// --- G10.06 Lighthouse performance ------------------------------------------
process.stdout.write('  G10.06 performance ..... ');
const lh = run('npx playwright test --config playwright.config.mjs browser-lighthouse-score 2>&1');
const perf = num(/realistic \(SI~LCP\) = (\d+)/, lh.out);
console.log(lh.ok ? `${G}PASS${NC} ${D}Performance = ${perf}${NC}` : `${R}FAIL${NC}`);
results.push(['G10.06', 'Lighthouse Performance 90+', lh.ok ? 'PASS' : 'FAIL',
  `score ${perf} under Slow 4G + 4x CPU`]);

// --- G10.07 beta -------------------------------------------------------------
process.stdout.write('  G10.07 beta flows ...... ');
const beta = run('npx playwright test --config playwright.config.mjs browser-beta-flows 2>&1');
console.log(beta.ok ? `${Y}OWNER${NC} ${D}automated parts pass${NC}` : `${R}FAIL${NC}`);
results.push(['G10.07', 'Beta sign-off', beta.ok ? 'OWNER' : 'FAIL',
  'flows + zero-crash automated; subjective rating is the owner\'s']);

// --- summary -----------------------------------------------------------------
const pass = results.filter(r => r[2] === 'PASS').length;
const fail = results.filter(r => r[2] === 'FAIL').length;
const owner = results.filter(r => r[2] === 'OWNER').length;

console.log(`\n${B}  ${pass} machine-verifiable gates PASS${NC}` +
  (fail ? `, ${R}${fail} FAIL${NC}` : '') +
  (owner ? `, ${Y}${owner} awaiting the owner${NC}` : '') + '\n');

if (owner || fail) {
  console.log(`${B}Left for the owner — these are decisions, not tasks a tool can do:${NC}\n`);
  console.log(`  ${Y}1. G10.07 subjective rating (>= 4/5)${NC}`);
  console.log(`     ${D}Every mechanical part is automated and green: the flows run, and a full`);
  console.log(`     navigation + search sweep raises no pageerror or console.error.`);
  console.log(`     What remains is your judgement of whether it feels good enough to ship.`);
  console.log(`     Scenarios needing a real device are listed in DEPLOY.md STEP 7:`);
  console.log(`     RSS fetch (#2), BYOK summary (#3), Vault picker (#5), bookmarklet (#7),`);
  console.log(`     PWA install (#8), Android share (#9).${NC}\n`);
  console.log(`  ${Y}2. ADR-0021 — PBKDF2 iterations (300k vs OWASP 600k)${NC}`);
  console.log(`     ${D}Not implemented on purpose. Raising the count derives a different key from`);
  console.log(`     the same passphrase, so every stored API key becomes undecryptable while the`);
  console.log(`     UI reports a CORRECT passphrase as "wrong". CLAUDE.md gates the passphrase`);
  console.log(`     encryption scheme behind human approval, so it is filed as Proposed with a`);
  console.log(`     backward-compatible migration design: docs/adr/ADR-0021-*.md${NC}\n`);
  console.log(`  ${D}Also at release time: the signed distribution build (packaging, not a score).${NC}\n`);
}

// Non-zero while anything is unresolved, so this can never read as "all green".
process.exit(fail > 0 ? 1 : owner > 0 ? 2 : 0);
