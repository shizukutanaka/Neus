// Neus — Vault が使えないブラウザで、押す前に理由が分かることを固定する (round 84)
//
// ソクラテス問答: **「使えない機能を、使えないと分かる前に押させるのは正しいか?」**
//
// Vault は File System Access API に依存する。Chromium 系のみが実装しており Firefox /
// Safari には無い。判定は `ensureWriteAccess` の中にあったので、SELECT VAULT を押して
// 初めて「File System Access API not supported」と告げられていた。状態行は
// **「vault: 未選択」**と出ており、これは「選べば使える」と読める — 押しても失敗するだけの
// 案内である。
//
// 直し方は**削除ではなく順序**。機能は消さない(Chromium では従来どおり)。
// 起動時に一度判定し、**理由を先に**見せて、効かないボタンは押せなくする。
//
// 実ブラウザで検証する理由: 判定対象は `window` に生えている API の有無そのもので、
// 模造品では「本当に無いときにどう見えるか」を通せないため。

import { test, expect } from '@playwright/test';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join, extname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

let server, base;
test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    const p = (req.url || '/').split('?')[0];
    const f = join(root, p === '/' ? 'index.html' : p.replace(/^\/+/, ''));
    try {
      const b = await readFile(f);
      res.writeHead(200, { 'content-type': extname(f) === '.html' ? 'text/html' : 'application/octet-stream' });
      res.end(b);
    } catch { res.writeHead(404); res.end('nf'); }
  });
  await new Promise(r => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(() => new Promise(r => server.close(r)));

/** Remove the API entirely, the way Firefox and Safari present it. */
const withoutFSA = (page) => page.addInitScript(() => {
  delete window.showDirectoryPicker;
});

async function openVaultModal(page) {
  await page.goto(`${base}/index.html`, { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  await page.evaluate(() => document.querySelector('#onboarding')?.classList.remove('show'));
  await page.click('#btn-menu');
  await page.click('#btn-vault');
  await expect(page.locator('#modal-vault')).toHaveClass(/show/);
}

test.describe('a browser without the File System Access API', () => {
  test('the status line gives the reason, not "not selected"', async ({ page }) => {
    await withoutFSA(page);
    await openVaultModal(page);
    const status = await page.locator('#vault-status').innerText();
    expect(status, `"not selected" reads as "pick one and it works":\n${status}`)
      .not.toMatch(/not selected|未選択/);
    expect(status).toMatch(/File System Access API/);
  });

  test('the reason names a browser where it does work', async ({ page }) => {
    // Saying only "unsupported" leaves the reader stuck; the point is what to do instead.
    await withoutFSA(page);
    await openVaultModal(page);
    expect(await page.locator('#vault-status').innerText()).toMatch(/Chrome|Edge/);
  });

  test('the controls that cannot work are disabled', async ({ page }) => {
    await withoutFSA(page);
    await openVaultModal(page);
    for (const id of ['#vault-select', '#vault-rescan', '#vault-export-all', '#vault-clear']) {
      await expect(page.locator(id), `${id} must not be clickable`).toBeDisabled();
    }
  });

  test('the reason is readable WITHOUT hovering', async ({ page }) => {
    // The first draft of this change explained itself through a `title` tooltip. That fails
    // on precisely the browsers it targets: `title` needs hover, and iOS Safari — one of the
    // browsers without the API — never shows it. So the reason has to be body text.
    await withoutFSA(page);
    await openVaultModal(page);
    const visibleText = await page.locator('#modal-vault').innerText();
    expect(visibleText, 'the explanation must be readable text, not a tooltip')
      .toMatch(/File System Access API/);
  });

  test('the per-card VAULT button is not emitted into the template (shape)', async () => {
    // Deliberately different from the modal. The modal can carry the reason in its own body
    // text next to the greyed-out buttons; the card detail row cannot, so a disabled button
    // there would be a dead control with no readable explanation — worse than the original
    // behaviour of clicking and getting a toast. The feature stays discoverable through the
    // header VAULT button, which opens the modal that does explain itself.
    const { readFileSync } = await import('fs');
    const html = readFileSync(join(root, 'index.html'), 'utf8');
    expect(html, 'the button is emitted only when the API exists')
      .toContain("${VAULT_SUPPORTED?`<button id=\"detail-vault\" type=\"button\">");
    expect(html, 'and must not fall back to a disabled+title dead end')
      .not.toContain('id="detail-vault" type="button"${VAULT_SUPPORTED?\'\':` disabled');
  });
});

test.describe('a browser that does have the API', () => {
  test('nothing is disabled and the old status line is unchanged', async ({ page }) => {
    // The guard against over-correcting: Chromium users must lose nothing.
    await openVaultModal(page);
    for (const id of ['#vault-select', '#vault-rescan', '#vault-export-all']) {
      await expect(page.locator(id), `${id} must stay usable`).toBeEnabled();
    }
    const status = await page.locator('#vault-status').innerText();
    expect(status).toMatch(/not selected|未選択/);
    expect(status).not.toMatch(/File System Access API/);
  });
});

test.describe('the wiring', () => {
  test('the capability is decided once at module scope, not inside the click path (shape)', async () => {
    const { readFileSync } = await import('fs');
    const html = readFileSync(join(root, 'index.html'), 'utf8');
    expect(html).toContain("const VAULT_SUPPORTED='showDirectoryPicker'in window;");
    expect(html, 'the click-time check stays as the last line of defence')
      .toContain("if(!('showDirectoryPicker'in window))");
  });

  test('the reason exists in both languages (shape)', async () => {
    const { readFileSync } = await import('fs');
    const html = readFileSync(join(root, 'index.html'), 'utf8');
    expect(html.split("'vault.unsupported'").length - 1,
      'a JA entry, an EN entry, and at least one use').toBeGreaterThanOrEqual(3);
  });
});
