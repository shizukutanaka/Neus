// Neus — 旧プロジェクト名の残骸を機械的に検出する (round 66)
//
// CLAUDE.md の禁止事項に「競合ソフト名混入(検索置換で残骸残らないよう注意)」がある。実際に
// 一度は残骸が見つかっており(`wrangler.toml` の Worker 名 `lensy-proxy` と `bookmarklet.js` の
// `YOUR_LENSY_URL`)、その時は**動く場所だけ**が直された。
//
// round 66 の OPML 監査中、`tests/utils.test.mjs` のミラーが `<title>Lensy Sources</title>` を
// 出力していたことに気づいた。テストは緑のままだった — ミラーは自分自身としか照合されないので、
// 旧名を吐き続けても誰も気づかない。同じ理由で `tests/setup.mjs` / `_redirects` / ADR 3件の
// 見出しにも残っていた。人間の目視では取りこぼす種類の残骸なので、機械に見張らせる。
//
// 例外は「旧名が残っていること自体を記録している文書」だけ。ここを allow-list にすることで、
// 新しい混入は必ず落ちる。

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, relative } from 'path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', 'test-results', '.wrangler']);

// Files whose whole purpose is to record that the old name was removed.
const ALLOWED = new Set([
  'SPEC.md',
  'CHANGELOG.md',
  'docs/reviews/AUDIT-BRIEF.md',
  'tests/no-legacy-name.test.mjs',
]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

describe('no legacy project name leaks back in', () => {
  const files = walk(root);

  it('scans a meaningful number of files (the walker itself is not silently empty)', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('mentions the old name only where its removal is documented', () => {
    const offenders = [];
    for (const f of files) {
      const rel = relative(root, f).split('\\').join('/');
      if (ALLOWED.has(rel)) continue;
      let text;
      try { text = readFileSync(f, 'utf8'); } catch { continue; }
      if (/lensy/i.test(text)) {
        const line = text.split('\n').findIndex(l => /lensy/i.test(l)) + 1;
        offenders.push(`${rel}:${line}`);
      }
    }
    expect(offenders, `old project name found in: ${offenders.join(', ')}`).toEqual([]);
  });

  it('the current name is what the deployed Worker and bookmarklet actually use', () => {
    // Guards the earlier fix from regressing along with the comment-level cleanup.
    expect(readFileSync(join(root, 'wrangler.toml'), 'utf8')).toContain('neus-proxy');
    expect(readFileSync(join(root, 'bookmarklet.js'), 'utf8')).toContain('YOUR_NEUS_URL');
  });
});
