// Neus — data-safety regressions (SPEC.md §10 audit, round 15)
// Three concrete data-loss / budget-bypass fixes:
//  1. Summarizer daily budget persists across reloads (was in-memory only).
//  2. JSON import validates record shape BEFORE wiping existing data (no
//     rollback exists, so a malformed backup must not destroy the current store).
//  3. Vault dossier filenames are unique per word id (slug collisions like
//     "C++" vs "C" previously overwrote each other silently).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

describe('Summarizer budget persistence (modeled)', () => {
  // Mirror of the persisted-counter contract.
  function makeBudget(store) {
    let dailyCount = 0, dailyKey = 'D0', loaded = false;
    const persist = () => { store['summary-budget'] = { key: dailyKey, count: dailyCount }; };
    const load = (today) => {
      const b = store['summary-budget'];
      if (b && b.key === today) { dailyKey = today; dailyCount = b.count || 0; }
      else { dailyKey = today; dailyCount = 0; }
      loaded = true;
    };
    const tick = (today) => { load(today); dailyCount++; persist(); return dailyCount; };
    return { tick, get: () => dailyCount, isLoaded: () => loaded };
  }

  it('carries the count across a reload on the same day', () => {
    const store = {};
    const a = makeBudget(store);
    a.tick('2026-06-21'); a.tick('2026-06-21');   // 2 summaries
    // simulate reload: fresh module reads persisted store
    const b = makeBudget(store);
    b.tick('2026-06-21');                          // 3rd summary same day
    expect(store['summary-budget'].count).toBe(3); // NOT reset to 1
  });

  it('resets the count on a new calendar day', () => {
    const store = { 'summary-budget': { key: '2026-06-20', count: 9 } };
    const a = makeBudget(store);
    expect(a.tick('2026-06-21')).toBe(1);          // new day -> reset then increment
    expect(store['summary-budget'].key).toBe('2026-06-21');
  });
});

describe('Summarizer budget wiring (index.html)', () => {
  it('persists the counter to IndexedDB after each summary', () => {
    expect(html).toContain("Store.putSetting('summary-budget',{key:dailyKey,count:dailyCount})");
    expect(html).toContain('dailyCount++;await persist();return text.trim();');
  });
  it('loads the persisted counter and exposes load() for startup', () => {
    expect(html).toContain("const b=await Store.getSetting('summary-budget')");
    expect(html).toContain('return{summarize,getDailyCount:()=>dailyCount,load}');
    expect(html).toContain('await Summarizer.load();');
  });
  it('reloads the counter lazily inside summarize if not yet loaded', () => {
    expect(html).toContain('if(!loaded)await load();');
  });
});

describe('import shape validation (modeled)', () => {
  const validEvent = (ev) => !!ev && typeof ev.id === 'string' && !!ev.content && !!ev.source && !!ev.state && !!ev.meta;
  const validWord = (w) => !!w && typeof w.id === 'string' && typeof w.normalized === 'string';

  it('accepts a well-formed event', () => {
    expect(validEvent({ id: 'a', content: {}, source: {}, state: {}, meta: {} })).toBe(true);
  });
  it('rejects an event missing structural objects the UI dereferences', () => {
    expect(validEvent({ id: 'a' })).toBe(false);             // no content/source/state/meta
    expect(validEvent({ id: 'a', content: {}, source: {} })).toBe(false);
    expect(validEvent({ content: {}, source: {}, state: {}, meta: {} })).toBe(false); // no id
    expect(validEvent(null)).toBe(false);
  });
  it('rejects a word without a normalized key', () => {
    expect(validWord({ id: 'w1', normalized: 'ai' })).toBe(true);
    expect(validWord({ id: 'w1', normalized: null })).toBe(false);
    expect(validWord({ normalized: 'ai' })).toBe(false);
  });
});

describe('import validation wiring (index.html)', () => {
  it('validates events and words BEFORE the destructive restore', () => {
    const validateAt = html.indexOf('backup has malformed events');
    const wipeAt = html.indexOf('await Store.replaceAll({events:dump.events');
    expect(validateAt).toBeGreaterThan(0);
    expect(wipeAt).toBeGreaterThan(0);
    expect(validateAt).toBeLessThan(wipeAt); // shape guard precedes the atomic replace
  });
  it('aborts (returns) on malformed events or words without wiping', () => {
    expect(html).toContain("if(!dump.events.every(validEvent)){toast(currentLang==='ja'?'バックアップのイベントデータが不正です':'backup has malformed events','err');return;}");
    expect(html).toContain("if(Array.isArray(dump.words)&&!dump.words.every(validWord)){toast(currentLang==='ja'?'バックアップの単語データが不正です':'backup has malformed words','err');return;}");
  });
});

describe('full backup/restore settings whitelist (index.html)', () => {
  // Found via audit: interest-profile (learned star/archive vocab) and auto-sync
  // (poll schedule/notify prefs) were silently dropped from backups — a restore
  // wiped the user's learned personalization and sync preferences with no warning.
  // summary-budget is correctly excluded: it's a day-scoped API-call counter that
  // would misreport quota if blindly restored on a different day.
  it('includes interest-profile and auto-sync in the export whitelist', () => {
    expect(html).toContain("for(const key of ['byok','lang','keyword-rules','onboarding-done','interest-profile','auto-sync'])");
  });
  it('includes interest-profile and auto-sync in the restore whitelist', () => {
    expect(html).toContain("const RESTORE_SETTINGS_KEYS=new Set(['byok','lang','keyword-rules','onboarding-done','interest-profile','auto-sync'])");
  });
  it('excludes summary-budget from both whitelists (day-scoped, not portable)', () => {
    expect(html).not.toMatch(/RESTORE_SETTINGS_KEYS=new Set\(\[[^\]]*summary-budget/);
    expect(html).not.toMatch(/for\(const key of \[[^\]]*summary-budget/);
  });
  it('reloads InterestProfile after restore so the restored vocab takes effect immediately', () => {
    expect(html).toContain('await KeywordRules.load();\n  await InterestProfile.load();\n  await TagLearner.rebuild();');
  });
});

describe('vault dossier filename uniqueness (index.html)', () => {
  it('suffixes the vault filename with the stable word id to avoid slug collisions', () => {
    expect(html).toContain("['neus','words'],`${wordSlug(word.term)}-${word.id.slice(0,8)}.md`");
  });
  it('does not write the vault dossier under a term-only filename', () => {
    expect(html).not.toContain("['neus','words'],`${wordSlug(word.term)}.md`");
  });
});

describe('onboarding never persists the master passphrase (index.html)', () => {
  // Security: the passphrase decrypts the API key and must live in memory only
  // (sessionPassphrase). A passphrase-but-no-key onboarding previously left
  // byok.passphrase in the object written to IndexedDB. finish() must strip it
  // unconditionally and only persist byok when an actual key exists.
  it('deletes byok.passphrase unconditionally before persisting', () => {
    expect(html).toContain('delete byok.passphrase;');
  });
  it('only writes byok when there is an apiKey to store', () => {
    expect(html).toContain('if(byok.apiKey)await Store.putSetting(\'byok\',byok);');
  });
  it('does not persist byok with the passphrase still attached', () => {
    // The old leaky form deleted passphrase only inside the apiKey branch.
    expect(html).not.toContain('byok.encrypted=true;delete byok.passphrase;}');
  });
});

describe('wordSlug collision is real (justifies the id suffix)', () => {
  const wordSlug = (s) => (s || 'word').trim().toLowerCase().replace(/[^a-z0-9ぁ-んァ-ヶ一-龠ー]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'word';
  it('maps distinct terms to the same slug', () => {
    expect(wordSlug('C++')).toBe(wordSlug('C'));   // both -> 'c'
    expect(wordSlug('A.I.')).toBe('a-i');
  });
  it('the id suffix disambiguates the colliding slugs', () => {
    const f = (term, id) => `${wordSlug(term)}-${id.slice(0, 8)}.md`;
    expect(f('C++', 'aaaaaaaa-1111')).not.toBe(f('C', 'bbbbbbbb-2222'));
  });
});
