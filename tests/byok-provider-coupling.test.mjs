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

// round 99: the checks above hold three couplings — byokDefaults <-> select options,
// byokDefaults <-> connect-src, and the two selects against each other. A fourth coupling is
// what actually makes a provider work: the dispatch chain in the summarizer,
// `s.provider==='x' ? callX() : ...`, which was pinned only for four historical providers
// (tests/byok-providers.test.mjs, written when qwen/gemma/glm/ollama shipped) as fixed literal
// strings — not derived from byokDefaults, so it says nothing about a provider added later.
//
// Confirmed reachable: a fully-wired 8th provider (byokDefaults entry, both selects, connect-src
// origin — everything the checks above require) but with no dispatch branch left the full suite
// at 1832/1832. Nothing catches it, because nothing derives "every declared provider" and checks
// it against the dispatch chain — every existing check either starts from the chain's own
// hard-coded names or never looks at the chain at all. The user selects it, saves a key, and the
// first summarization throws `unknown_provider` — caught, logged as a summarizer.error event,
// silently returns null. This is the same failure class round 47 found in onboarding step 1,
// one hop further down the same chain of dereferences.
function dispatchPairs() {
  const at = html.indexOf("if(s.provider==='anthropic')");
  expect(at, 'provider dispatch chain found').toBeGreaterThan(-1);
  const end = html.indexOf('unknown_provider', at);
  expect(end, "dispatch chain's unknown_provider fallback found").toBeGreaterThan(-1);
  const chain = html.slice(at, end);
  return [...chain.matchAll(/s\.provider==='([a-z0-9]+)'\)text=await (\w+)\(/g)].map(m => [m[1], m[2]]);
}

describe('BYOK dispatch chain coupling (round 99)', () => {
  const keys = byokKeys();
  const pairs = dispatchPairs();
  const dispatched = pairs.map(([k]) => k);

  it('every byokDefaults provider has a dispatch branch', () => {
    const missing = keys.filter(k => !dispatched.includes(k));
    expect(missing, `providers with no dispatch branch — selecting them throws unknown_provider: ${missing.join(', ')}`).toEqual([]);
  });

  it('the dispatch chain has no branch for a provider byokDefaults does not declare', () => {
    const extra = dispatched.filter(k => !keys.includes(k));
    expect(extra, `dispatch branches with no byokDefaults entry: ${extra.join(', ')}`).toEqual([]);
  });

  it('every dispatch branch calls a function that is actually defined', () => {
    for (const [provider, fn] of pairs) {
      expect(html, `${provider} dispatches to ${fn}, which is never defined`).toContain(`async function ${fn}(`);
    }
  });

  it('every byokDefaults provider is reachable from at least one select', () => {
    // The reverse of "every option has a default" (checked above): a provider nobody can select
    // is dead config rather than a crash, but it is the same coupling and costs nothing extra
    // to hold here too.
    const a = optionsOf('ob-provider') || [];
    const b = optionsOf('set-byok-provider') || [];
    const reachable = new Set([...a, ...b]);
    const unreachable = keys.filter(k => !reachable.has(k));
    expect(unreachable, `byokDefaults providers offered nowhere in the UI: ${unreachable.join(', ')}`).toEqual([]);
  });
});
