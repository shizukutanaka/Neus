// Neus — InterestProfile の抑制側上限を非対称にする (round 35)
//
// 問題: 暗黙の興味学習(star=pos / archive=neg)が `meta.score` を最大 ±interestBoostMax で
// 補正しており、抑制側も昇格側と同じ強さだった。これは推薦研究がフィルターバブル/
// エコーチェンバーとして繰り返し報告している構造そのもの — 「関連性を優先して多様性を
// 犠牲にする」personalization が確証バイアスを強化する — に該当する。
//
// Neus 固有の深刻さ: 本プロダクトは反証条件を能動監視する Falsifier Watch を看板機能に据え、
// 「何があれば自分の結論を覆すか」を問い続けさせる設計思想を持つ。その同じアプリの中で、
// 暗黙の学習が異論を昇格と同じ強さで沈めるのは自己矛盾になる。
//
// 損失の非対称性(修正の根拠):
//  - 誤って持ち上げた場合 → 読み飛ばすだけ。可逆で、本人にも見えている。
//  - 誤って沈めた場合   → そもそも出会わない。不可逆で、しかも本人に見えない。
// さらに補正は ingest 時に meta.score へ焼き込まれ永続する(語彙は減衰するが既存イベントの
// スコアは戻らない)ため、沈めた判断は後から効かなくなることも無い。
// 明示的な抑制手段は KeywordRules の block(ユーザーが書き・見え・編集できる)が既に存在する。
// よって「学習による暗黙の抑制」だけ上限を絞る。

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

const CONFIG = { interestMinDf: 2, interestBoostMax: 25, interestPenaltyMax: 10 };

// Mirrors scoreBoost in index.html.
function makeProfile() {
  const vocab = new Map();
  const words = (t) => new Set(t.toLowerCase().split(/\s+/).filter(Boolean));
  function learn(text, kind, n = 1) {
    for (const w of words(text)) {
      const e = vocab.get(w) || { pos: 0, neg: 0 };
      if (kind === 'pos') e.pos += n; else e.neg += n;
      vocab.set(w, e);
    }
  }
  function scoreBoost(text) {
    let signal = 0, matched = 0;
    for (const w of words(text)) {
      const e = vocab.get(w); if (!e) continue;
      const total = e.pos + e.neg;
      if (total < CONFIG.interestMinDf) continue;
      signal += (e.pos - e.neg) / total; matched++;
    }
    if (matched === 0) return 0;
    const avg = signal / matched;
    const cap = avg < 0 ? CONFIG.interestPenaltyMax : CONFIG.interestBoostMax;
    return Math.round(avg * cap);
  }
  return { learn, scoreBoost };
}

describe('InterestProfile — asymmetric suppression cap', () => {
  it('still promotes what you like (personalization is not removed)', () => {
    const p = makeProfile();
    p.learn('rust webassembly', 'pos', 4);
    expect(p.scoreBoost('rust webassembly')).toBeGreaterThan(0);
  });

  it('still demotes what you repeatedly archive (the signal is kept, just bounded)', () => {
    const p = makeProfile();
    p.learn('crypto airdrop', 'neg', 4);
    expect(p.scoreBoost('crypto airdrop')).toBeLessThan(0);
  });

  it('suppression is capped strictly tighter than promotion', () => {
    const p = makeProfile();
    p.learn('alpha', 'pos', 8);
    p.learn('beta', 'neg', 8);
    const up = p.scoreBoost('alpha');
    const down = p.scoreBoost('beta');
    expect(up).toBe(CONFIG.interestBoostMax);           // full promotion
    expect(down).toBe(-CONFIG.interestPenaltyMax);      // bounded suppression
    expect(Math.abs(down)).toBeLessThan(Math.abs(up));  // the asymmetry itself
  });

  it('a maximally-disliked item cannot be buried by more than interestPenaltyMax', () => {
    const p = makeProfile();
    p.learn('spam clickbait listicle', 'neg', 50); // extreme, sustained dislike
    expect(p.scoreBoost('spam clickbait listicle')).toBeGreaterThanOrEqual(-CONFIG.interestPenaltyMax);
  });

  it('neutral items are untouched', () => {
    const p = makeProfile();
    p.learn('rust', 'pos', 4);
    expect(p.scoreBoost('cooking pasta recipe')).toBe(0);
  });

  it('under-sampled vocabulary is ignored (interestMinDf still respected)', () => {
    const p = makeProfile();
    p.learn('rust', 'neg', 1); // below interestMinDf=2
    expect(p.scoreBoost('rust')).toBe(0);
  });

  it('a disliked item can still be out-scored back into view by other signals', () => {
    // The practical point of the cap: with a -10 floor, an item with a strong base score
    // (e.g. high engagement) survives, whereas -25 could sink it below the fold permanently.
    const p = makeProfile();
    p.learn('crypto', 'neg', 20);
    const base = 70; // e.g. engagementScore-boosted item
    expect(base + p.scoreBoost('crypto')).toBeGreaterThan(50);
  });
});

describe('InterestProfile asymmetry wiring (index.html)', () => {
  it('declares a separate, smaller penalty cap', () => {
    expect(html).toContain('interestPenaltyMax:10,');
    expect(html).toContain('interestBoostMax:25');
  });
  it('selects the cap by polarity sign', () => {
    expect(html).toContain('const cap=avg<0?CONFIG.interestPenaltyMax:CONFIG.interestBoostMax;');
    expect(html).toContain('return Math.round(avg*cap);');
    // The old symmetric form must be gone.
    expect(html).not.toContain('return Math.round(avg*CONFIG.interestBoostMax);');
  });
  it('keeps explicit suppression (KeywordRules block) as the visible, user-authored path', () => {
    // The asymmetry is justified partly because an explicit, editable block mechanism exists.
    expect(html).toContain("case 'contains':return t.includes(p);");
    expect(html).toContain("'kw.block.action'");
  });
});
