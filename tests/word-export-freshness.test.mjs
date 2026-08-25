// Neus — 書き出し系が、書き出し中に保存された入力を消さないことを固定する (round 76)
//
// round 69→75 で潰してきた系統の続き。残っていたのは **word の書き込みのうち、長い await を
// 挟む4経路**:
//
//   | 箇所                          | 挟まる待ち                                   | 窓 |
//   |-------------------------------|----------------------------------------------|----|
//   | `copyMd`                      | `gather()` 全イベント走査 + クリップボード権限 | 無制限 |
//   | `downloadMd` / `downloadJson` | `gather()` / `othersOf()`                     | 件数比例 |
//   | `toVault`                     | `ensureWriteAccess()` = ディレクトリ選択      | 無制限 |
//   | `downloadAllMd`               | 全単語 × 全イベント走査                       | 積で増える |
//
// いずれも末尾で `word.reviewedAt=Date.now();await Store.putWord(word)` と**レコード全体**を
// 書き戻していた。担当は `reviewedAt` だけなのに、である。待っている間に問いを足したり判定を
// 保存したりすると、その入力が消える。窓の広さの点では round 75 より悪い — ダイアログ待ちは
// 原理的に無制限だからだ。
//
// 検証はミラーではなく**実物の `WordExporter` を取り出して評価**する
// (`const WordExporter={` は indent 0 なので `extractConst` でそのまま取れる)。
// 依存は全て注入するので、注入したものがこのオブジェクトの本当の依存一覧でもある。

import { describe, it, expect } from 'vitest';
import { extractConst, source } from './helpers/from-source.mjs';

// The real lookup tables, not stand-ins — they are plain data and the exporter reads them.
const REAL_TABLES = ['PRIOR_BELIEF_DEFS', 'VERDICT_DEFS'].map(extractConst).join('\n');

function makeExporter(Store, { onSlowStep } = {}) {
  const code = `
    const currentLang = 'en';
    const toast = () => {};
    const downloadFile = () => {};
    const wordSlug = (t) => String(t).toLowerCase();
    const localDateKey = () => '2026-08-25';
    // Everything WordExporter reaches for that is not one of its own methods. Listing them
    // here is itself useful: it is the true dependency surface of the export paths.
    const cognitiveShift = () => ({ prior: 'curious', now: 'open', moved: false });
    const WORD_FEEDS = { hn: {}, reddit: {} };
    const escapeHtml = (x) => String(x);
    const yamlScalar = (x) => JSON.stringify(String(x ?? ''));
    const isoDate = () => '2026-08-25';
    const verdictOf = (w) => w?.verdict?.status || 'open';
    const priorBeliefOf = () => 'curious';
    const verdictStale = () => false;
    const newSinceReview = () => 0;
    const mdLink = (t) => String(t ?? '');
    const mdImgLink = (t) => String(t ?? '');
    const aggregateTags = () => [];
    const falsifierHits = () => [];
    const questionHits = () => [];
    const signalGaps = () => [];
    const socraticPrompts = () => [];
    const tierBreakdown = () => [];
    const relatedWords = () => [];
    const renderView = async () => {};
    const renderWordList = async () => {};
    const refreshCounts = async () => {};
    const confirmAsync = async () => true;
    const wordFromImport = (d) => d?.word ?? null;
    const withHashGate = (h, fn) => fn();
    const FTSIndex = { add: () => {}, addWord: () => {} };
    const uuid = () => 'id-' + Math.random().toString(36).slice(2);
    const navigator = { clipboard: { writeText: async () => {} } };
    const VaultWriter = { exportWordDossier: async () => { await slow(); return true; } };
    const slow = async () => { if (onSlowStep) await onSlowStep(); };
    const StoreReal = Store;
    const StoreSlow = {
      getWord: StoreReal.getWord,
      putWord: StoreReal.putWord,
      listWords: StoreReal.listWords,
      // gather()/othersOf() read every event; that read is the slow step for the
      // download/copy paths, so the interleaving hangs off it.
      allEvents: async () => { await slow(); return StoreReal.allEvents(); },
    };
${REAL_TABLES}
${extractConst('WordExporter').replace(/\bStore\./g, 'StoreSlow.')}
    return WordExporter;
  `;
  // eslint-disable-next-line no-new-func -- deliberate: exercise the REAL object
  return new Function('Store', 'onSlowStep', code)(Store, onSlowStep);
}

function makeStore(words) {
  const db = new Map(words.map(w => [w.id, structuredClone(w)]));
  return {
    db,
    getWord: async (id) => { const w = db.get(id); return w ? structuredClone(w) : null; },
    putWord: async (w) => { db.set(w.id, structuredClone(w)); },
    listWords: async () => [...db.values()].map(w => structuredClone(w)),
    allEvents: async () => [],
    // What a WORDS-view handler does while an export is running: its own copy, edited, written.
    async editBehindTheExport(id, patch) {
      const w = await this.getWord(id);
      if (!w) return;
      Object.assign(w, patch);
      await this.putWord(w);
    },
  };
}

const aWord = (id = 'w1') => ({
  id, term: 'rust', normalized: 'rust' + id, note: '', lang: 'en',
  questions: [], verdict: { status: 'open', note: '' }, verdictHistory: [],
  reviewedAt: 0, createdAt: 1, wiki: null, falsifier: '', sources: {},
});

const SLOW_EXPORTS = [
  ['copyMd', (x, w) => x.copyMd(w)],
  ['downloadMd', (x, w) => x.downloadMd(w)],
  ['downloadJson', (x, w) => x.downloadJson(w)],
  ['toVault', (x, w) => x.toVault(w)],
];

describe('WordExporter marks reviewed without clobbering concurrent edits', () => {
  it('is the real object, not a copy', () => {
    const src = extractConst('WordExporter');
    expect(src.startsWith('const WordExporter={')).toBe(true);
    expect(src).toContain('async markReviewed(word)');
    expect(source()).toContain('const WordExporter={');
  });

  it.each(SLOW_EXPORTS)('%s: a question saved mid-export survives', async (_name, run) => {
    const Store = makeStore([aWord()]);
    let once = true;
    const X = makeExporter(Store, {
      onSlowStep: async () => {
        if (!once) return;
        once = false;
        await Store.editBehindTheExport('w1', { questions: [{ id: 'q1', text: 'does it hold?' }] });
      },
    });

    await run(X, structuredClone(await Store.getWord('w1')));
    expect(Store.db.get('w1').questions,
      'the export must only touch reviewedAt, not the whole record').toHaveLength(1);
  });

  it.each(SLOW_EXPORTS)('%s: still records reviewedAt', async (_name, run) => {
    const Store = makeStore([aWord()]);
    const X = makeExporter(Store);
    await run(X, structuredClone(await Store.getWord('w1')));
    expect(Store.db.get('w1').reviewedAt, 'the export must still mark the word reviewed')
      .toBeGreaterThan(0);
  });

  it.each(SLOW_EXPORTS)('%s: refreshes the caller\'s copy for the re-render', async (_name, run) => {
    // renderView runs right after these handlers with the object the caller still holds.
    const Store = makeStore([aWord()]);
    const X = makeExporter(Store);
    const mine = structuredClone(await Store.getWord('w1'));
    await run(X, mine);
    expect(mine.reviewedAt, 'the caller must not redraw a stale "never reviewed"')
      .toBeGreaterThan(0);
  });

  it.each(SLOW_EXPORTS)('%s: a word deleted mid-export is not resurrected', async (_name, run) => {
    // Deliberately the opposite of _collectOne: a collection result has to land somewhere,
    // but reviewedAt is only an annotation on a record that must still exist.
    const Store = makeStore([aWord()]);
    let once = true;
    const X = makeExporter(Store, {
      onSlowStep: async () => { if (once) { once = false; Store.db.delete('w1'); } },
    });

    await run(X, structuredClone(await Store.getWord('w1')));
    expect(Store.db.has('w1'), 'an annotation must not re-create a deleted word').toBe(false);
  });

  it('downloadAllMd re-reads each word instead of writing its entry snapshot', async () => {
    const Store = makeStore([aWord('w1'), aWord('w2')]);
    let once = true;
    const X = makeExporter(Store, {
      onSlowStep: async () => {
        if (!once) return;
        once = false;
        await Store.editBehindTheExport('w2', { verdict: { status: 'supported', note: 'strong' } });
      },
    });

    await X.downloadAllMd();
    expect(Store.db.get('w2').verdict.status,
      'a verdict saved during the bulk export must survive it').toBe('supported');
    expect(Store.db.get('w1').reviewedAt, 'and every word is still marked reviewed')
      .toBeGreaterThan(0);
    expect(Store.db.get('w2').reviewedAt).toBeGreaterThan(0);
  });
});

describe('the refreshwiki handler re-reads too (source shape)', () => {
  // It lives inline in a DOM handler and cannot be extracted, so its shape is pinned here.
  const src = source();

  it('reads the record back after the Wikipedia round-trip', () => {
    const at = src.indexOf("if(act==='refreshwiki')");
    expect(at, 'the handler must still exist').toBeGreaterThan(-1);
    const handler = src.slice(at, at + 900);
    expect(handler).toContain('const wiki=await WordCollector.fetchWiki(word);');
    expect(handler, 'the fetched extract must land on a freshly-read record')
      .toContain('const fresh=await Store.getWord(word.id);');
    expect(handler).toContain('await Store.putWord(fresh);');
    expect(handler, 'and a word deleted while fetching must not be re-created')
      .toContain('if(!fresh){await renderView();return;}');
  });
});
