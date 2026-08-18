// Neus — Vault へ書き出すファイル名のパス安全性 (round 51)
//
// VaultWriter は File System Access API で**利用者の実ディスク**にファイルを書く。
// ファイル名の材料は次の3つで、うち1つは利用者入力、1つはフィード由来になりうる:
//   - `${ev.id}.md`                      … crypto.randomUUID()。外部が影響できない
//   - `${date}.md`(Daily Note)          … localDateKey()。数字とハイフンのみ
//   - `${wordSlug(word.term)}-${id}.md`  … **word.term は利用者が自由に入力する**
//
// 監査の結果、`wordSlug` は許容文字のホワイトリスト方式
// (`[^a-z0-9ぁ-んァ-ヶ一-龠ー]+` を `-` に置換)で、`/` `\` `.` が全て潰れるため
// ディレクトリ脱出は成立しない — **既に安全**だった。
//
// しかしこの性質にテストが無かった。スラッグ生成は「日本語が消える」「短すぎる」等の理由で
// 後から善意で書き換えられやすく、その際にホワイトリストがブラックリストに変わると
// 静かにパストラバーサルが復活する。**安全であることを固定する**のが本ファイルの目的。

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// Mirrors wordSlug in index.html.
const wordSlug = (s) => (s || 'word').trim().toLowerCase()
  .replace(/[^a-z0-9ぁ-んァ-ヶ一-龠ー]+/gi, '-')
  .replace(/^-+|-+$/g, '').slice(0, 60) || 'word';

const TRAVERSAL = [
  '../../etc/passwd',
  '..\\..\\windows\\system32',
  'a/../../b',
  '....//....//x',
  '日本語/../x',
  '/absolute/path',
  './relative',
  '..',
  '...',
  '/',
  '///',
  '\\\\server\\share',
];

describe('wordSlug — no filename can escape the Vault directory', () => {
  it.each(TRAVERSAL)('neutralises %j', (input) => {
    const s = wordSlug(input);
    expect(s, 'no path separator').not.toMatch(/[/\\]/);
    expect(s, 'no parent-directory token').not.toContain('..');
    expect(s.length, 'never empty (would create a dotfile or fail)').toBeGreaterThan(0);
  });

  it('never yields a leading dot (hidden file / extension confusion)', () => {
    for (const s of ['.hidden', '.', '.md', '..config']) {
      expect(wordSlug(s).startsWith('.')).toBe(false);
    }
  });

  it('never yields an empty or whitespace-only name', () => {
    for (const s of ['', '   ', '///', '---', null, undefined]) {
      const out = wordSlug(s);
      expect(out.trim()).toBe(out);
      expect(out.length).toBeGreaterThan(0);
    }
  });

  it('bounds length so a long title cannot break the filesystem limit', () => {
    expect(wordSlug('a'.repeat(500)).length).toBeLessThanOrEqual(60);
    expect(wordSlug('あ'.repeat(500)).length).toBeLessThanOrEqual(60);
  });

  it('keeps legitimate Japanese and alphanumeric terms usable', () => {
    // The guard must not be so aggressive that real terms collapse to "word".
    expect(wordSlug('機械学習')).toBe('機械学習');
    expect(wordSlug('Rust')).toBe('rust');
    expect(wordSlug('WebGPU 入門')).toBe('webgpu-入門');
    expect(wordSlug('C++')).toBe('c');
  });

  it('distinct terms that normalise alike still get distinct files via the id suffix', () => {
    // "C++" and "C" both slug to "c"; the filename appends the word id, so they cannot
    // overwrite each other. This is asserted at the call site below.
    expect(wordSlug('C++')).toBe(wordSlug('C'));
  });
});

describe('Vault write sites (index.html)', () => {
  it('word notes combine the slug with a unique id', () => {
    expect(html).toContain("`${wordSlug(word.term)}-${word.id.slice(0,8)}.md`");
  });
  it('event notes are named from a UUID, never from feed text', () => {
    expect(html).toContain('`${ev.id}.md`');
    expect(html).toContain('const uuid=()=>crypto.randomUUID();');
  });
  it('the daily note is named from the local date only', () => {
    expect(html).toContain('const date=localDateKey();');
  });
  it('wordSlug remains an allow-list, not a deny-list', () => {
    // A deny-list ("strip these bad chars") is what would let traversal back in.
    expect(html).toContain("replace(/[^a-z0-9ぁ-んァ-ヶ一-龠ー]+/gi,'-')");
  });
  it('directory segments are hard-coded, never derived from input', () => {
    expect(html).toContain("['neus','words']");
    expect(html).toContain("['neus']");
  });
});
