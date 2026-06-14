#!/usr/bin/env node
/**
 * Neus — SBOM (Software Bill of Materials) generator
 *
 * Generates CycloneDX 1.5 format SBOM for supply chain transparency.
 * Required by EU CRA (Cyber Resilience Act), US OMB M-26-05, NIST SSDF.
 *
 * Usage: node scripts/sbom.mjs [--format cyclonedx|spdx] [--output sbom.json]
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import crypto from 'crypto';

const args = process.argv.slice(2);
const format = args.includes('--format') ? args[args.indexOf('--format') + 1] : 'cyclonedx';
const output = args.includes('--output') ? args[args.indexOf('--output') + 1] : 'sbom.json';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const lock = existsSync('package-lock.json') ? JSON.parse(readFileSync('package-lock.json', 'utf8')) : null;

function hashFile(path) {
  if (!existsSync(path)) return null;
  return crypto.createHash('sha256').update(readFileSync(path)).digest('hex');
}

function getGitCommit() {
  try { return execSync('git rev-parse HEAD', { stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim(); }
  catch { return 'unknown'; }
}

function makePurl(name, version) {
  // npm package URL (PURL spec)
  if (name.startsWith('@')) {
    const [scope, pkgName] = name.split('/');
    return `pkg:npm/${scope}/${pkgName}@${version}`;
  }
  return `pkg:npm/${name}@${version}`;
}

// Build components list from package-lock.json
const components = [];
if (lock?.packages) {
  for (const [path, info] of Object.entries(lock.packages)) {
    if (!path || path === '') continue;
    const name = path.replace(/^node_modules\//, '').split('/node_modules/').pop();
    if (!info.version) continue;
    components.push({
      type: 'library',
      'bom-ref': `pkg:npm/${name}@${info.version}`,
      name,
      version: info.version,
      purl: makePurl(name, info.version),
      licenses: info.license ? [{ license: { id: info.license } }] : undefined,
      scope: info.dev ? 'optional' : 'required',
    });
  }
}

// Source files (the actual Neus product)
const sourceFiles = ['index.html', 'sw.js', '_worker.js', 'manifest.json'];
const fileComponents = sourceFiles.filter(f => existsSync(f)).map(f => ({
  type: 'file',
  'bom-ref': `file://${f}`,
  name: f,
  version: pkg.version,
  hashes: [{ alg: 'SHA-256', content: hashFile(f) }],
}));

const sbom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  serialNumber: `urn:uuid:${crypto.randomUUID()}`,
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    tools: [{ vendor: 'Neus', name: 'sbom.mjs', version: '1.0' }],
    component: {
      type: 'application',
      'bom-ref': `neus@${pkg.version}`,
      name: pkg.name,
      version: pkg.version,
      description: pkg.description,
      licenses: pkg.license ? [{ license: { id: pkg.license } }] : undefined,
      purl: `pkg:generic/${pkg.name}@${pkg.version}`,
      properties: [
        { name: 'git:commit', value: getGitCommit() },
        { name: 'build:source-hash:index.html', value: hashFile('index.html') },
      ],
    },
    supplier: { name: 'shizukutanaka', url: ['https://github.com/shizukutanaka/neus'] },
  },
  components: [...fileComponents, ...components],
};

writeFileSync(output, JSON.stringify(sbom, null, 2));
console.log(`SBOM written to ${output}`);
console.log(`  Format: ${format} (CycloneDX 1.5)`);
console.log(`  Components: ${sbom.components.length}`);
console.log(`  Source files: ${fileComponents.length}`);
console.log(`  Dependencies: ${components.length}`);
console.log(`  index.html SHA-256: ${hashFile('index.html')?.substring(0, 16)}...`);
