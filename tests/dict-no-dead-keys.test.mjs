// Neus — DICT に死にキーを再び生やさないためのガード (round 43)
//
// 背景(イーロン・マスクの5段階アルゴリズムの適用):
//   1. 要件を疑う  — 「UI は i18n で JA/EN 両対応」(CLAUDE.md)は本物の要件。だが
//      「nav ラベルにも DICT キーを持つ」は**何も生まない要件**だった。applyI18N の navMap は
//      `dataset.view.toUpperCase()` にフォールバックするため、nav タブは両言語とも
//      INBOX / ALL / LATER / DIGEST / WORDS / RESURFACE の大文字英語で描画される。
//      DICT に入れても決して表示されない。
//   2. 削除する    — 参照されないキー18件(×2言語=36文字列)を削除した。
//                    内訳: 存在しないUI向けの文字列15件 + nav.* 3件。
//   3. 単純化する  — 逆に「要素はあるのに配線されていない」9件(KEYWORDS モーダル)は
//                    削除ではなく applyI18N へ配線した。DICT に JA/EN が揃っていたのに
//                    HTML 直書きの日本語が出ており、英語利用者に日本語が見えていた。
//   5. 自動化する  — **最後に**このガード。1〜3 を人手でやり直さずに済むようにする。
//      (順序が肝: 存在すべきでない物を自動化するのが最悪の手なので、削除の後に置く)
//
// このテストは「DICT のキーは必ずどこかで消費される」ことを不変条件として固定する。

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

function dictKeys() {
  const m = html.match(/const DICT=\{([\s\S]*?)\n\};/);
  if (!m) throw new Error('DICT block not found');
  return new Set([...m[1].matchAll(/'([a-z][a-z0-9.\-]*\.[a-z][a-z0-9.\-]*)':/g)].map(x => x[1]));
}
function referencedKeys() {
  const used = new Set();
  for (const m of html.matchAll(/t\('([^']+)'\)/g)) used.add(m[1]);
  for (const m of html.matchAll(/data-i18n="([^"]+)"/g)) used.add(m[1]);
  return used;
}
// Keys built at runtime via template literals, e.g. t(`onboard.${key}.title`).
// Each entry lists the regex a key must match to be considered dynamically consumed,
// alongside the source construct that proves it.
const DYNAMIC = [
  { construct: 't(`onboard.${key}.title`)', pattern: /^onboard\.[a-z]+\.title$/ },
  { construct: 't(`onboard.${key}.desc`)', pattern: /^onboard\.[a-z]+\.desc$/ },
];

describe('DICT has no dead keys', () => {
  it('every declared key is consumed somewhere', () => {
    const keys = dictKeys();
    const used = referencedKeys();
    const dead = [...keys].filter(k => !used.has(k) && !DYNAMIC.some(d => d.pattern.test(k)));
    expect(dead, `unused DICT keys (delete them, or wire them into applyI18N): ${dead.join(', ')}`).toEqual([]);
  });

  it('each dynamic-key exemption is backed by a real construct in the source', () => {
    // Guards the guard: an exemption must not silently keep dead keys alive after the
    // code that built them dynamically is gone.
    for (const d of DYNAMIC) expect(html.includes(d.construct), `stale exemption: ${d.construct}`).toBe(true);
  });

  it('every key exists in BOTH locales', () => {
    // A key present in only one locale renders as a missing string for the other.
    const keys = dictKeys();
    const bad = [...keys].filter(k => {
      const n = (html.match(new RegExp(`'${k.replace(/\./g, '\\.')}':`, 'g')) || []).length;
      return n !== 2;
    });
    expect(bad, `keys not declared exactly twice (ja + en): ${bad.join(', ')}`).toEqual([]);
  });
});

describe('the KEYWORDS modal is actually localized (round 43 wiring)', () => {
  it.each([
    'hd.keywords', 'kw.hint', 'hd.kw.watch', 'kw.watch.action',
    'hd.kw.block', 'kw.block.action', 'hd.kw.adv', 'kw.adv.hint', 'hd.kw.status',
  ])('%s is applied in applyI18N', (key) => {
    expect(html).toContain(`t('${key}')`);
  });

  it('nav labels intentionally have no DICT keys', () => {
    // They render from navMap's uppercase fallback in both locales, so a DICT entry
    // could never take effect. Re-adding one would be dead weight.
    for (const k of ['nav.later', 'nav.digest', 'nav.resurface', 'nav.inbox']) {
      expect(html).not.toContain(`'${k}':`);
    }
  });
});
