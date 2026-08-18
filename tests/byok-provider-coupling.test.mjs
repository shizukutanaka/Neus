// Neus — プロバイダ選択肢と byokDefaults の結合を固定する (round 62)
//
// 監査の発端: round 47 でオンボーディング **step 1** に実クラッシュが見つかったため、残りの
// step も同じ目で調べた。step 3(BYOK 設定)は次のように書かれている:
//
//   if(step===3){ ... selected.byok={...,model:CONFIG.byokDefaults[provider].model,...} }
//
// `provider` は `<select id="ob-provider">` の値をそのまま使う。つまり**選択肢に
// `byokDefaults` へ存在しない値が1つでも混ざると `undefined.model` で即座に例外**になり、
// 新規利用者のオンボーディングが「次へ」で止まる。
//
// 実測の結果、現状は**問題なし**: 選択肢7種(anthropic / openai / gemini / qwen / gemma /
// glm / ollama)は `byokDefaults` の7キーと完全一致し、設定モーダル側の select も同じ。
// **修正は不要**だった。
//
// それでもテストを置く理由: これは「片方だけ足すと壊れる」種類の暗黙の結合で、しかも壊れ方が
// **オンボーディング(初回体験)の例外**という最も痛い場所に出る。プロバイダ追加は今後も
// 起こりうる(v0.13 で qwen/glm/ollama が実際に追加された)ので、片側だけの追加を機械的に
// 検出できるようにしておく。round 47 の実バグと同じ轍を踏まないための番人。

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

function byokKeys() {
  const at = html.indexOf('byokDefaults: {');
  expect(at, 'byokDefaults block found').toBeGreaterThan(-1);
  const block = html.slice(at, at + 2000);
  return [...block.matchAll(/^\s{4}([a-z0-9]+):\s*\{/gm)].map(m => m[1]);
}
function optionsOf(selectId) {
  const at = html.indexOf(`id="${selectId}"`);
  if (at < 0) return null;
  const tail = html.slice(at);
  const inner = tail.slice(0, tail.indexOf('</select>'));
  return [...inner.matchAll(/option value="([a-z0-9]+)"/g)].map(m => m[1]);
}

describe('BYOK provider coupling', () => {
  const keys = byokKeys();

  it('byokDefaults declares every provider it claims to support', () => {
    expect(keys.length).toBeGreaterThanOrEqual(3);
    for (const k of keys) {
      // Each entry must carry the two fields the caller dereferences.
      const entry = html.slice(html.indexOf(`${k}:`, html.indexOf('byokDefaults: {')));
      expect(entry.slice(0, 200), `${k} needs a model`).toContain('model:');
      expect(entry.slice(0, 300), `${k} needs an endpoint`).toContain('endpoint:');
    }
  });

  it('every onboarding provider option has a default — otherwise step 3 throws', () => {
    // The crash path: CONFIG.byokDefaults[provider].model on an unknown provider.
    const opts = optionsOf('ob-provider');
    expect(opts, 'onboarding provider select exists').not.toBeNull();
    const missing = opts.filter(o => !keys.includes(o));
    expect(missing, `options with no byokDefaults entry: ${missing.join(', ')}`).toEqual([]);
  });

  it('every settings provider option has a default too', () => {
    const opts = optionsOf('set-byok-provider');
    if (!opts) return; // select is optional in this build
    const missing = opts.filter(o => !keys.includes(o));
    expect(missing, `options with no byokDefaults entry: ${missing.join(', ')}`).toEqual([]);
  });

  it('the two selects offer the same providers, so the flows cannot diverge', () => {
    const a = optionsOf('ob-provider'), b = optionsOf('set-byok-provider');
    if (!a || !b) return;
    expect([...a].sort()).toEqual([...b].sort());
  });

  it('the dereference that makes this coupling load-bearing still exists', () => {
    // If this line is ever refactored to be defensive, the coupling stops being fatal —
    // but until then these assertions are what keep onboarding from throwing.
    expect(html).toContain('model:CONFIG.byokDefaults[provider].model');
  });

  it('every provider endpoint origin is allowed by connect-src', () => {
    // A provider with a default but no CSP entry fails at request time instead — the exact
    // defect fixed earlier for qwen/glm/ollama. Keep both sides in step.
    const at = html.indexOf('byokDefaults: {');
    const block = html.slice(at, at + 2000);
    const origins = [...block.matchAll(/endpoint:\s*'(https?:\/\/[^/']+)/g)].map(m => m[1]);
    const csp = html.slice(html.indexOf('Content-Security-Policy'), html.indexOf('Content-Security-Policy') + 1200);
    for (const o of new Set(origins)) {
      expect(csp, `connect-src must allow ${o}`).toContain(o);
    }
  });
});
