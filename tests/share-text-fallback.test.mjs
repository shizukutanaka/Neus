// Neus — ShareTarget drops URLs shared only in the text field (round 28 audit)
//
// manifest.json's share_target maps text -> share_text and url -> share_url. Many Android
// share sources (and some iOS share sheets) only populate `text`, leaving `share_url` empty
// even when the shared content is a URL. The old handle() only ingested when share_url was
// present, then returned silently otherwise — the share was lost with no feedback. Fixed by
// falling back to extracting the first https?:// token from share_text, and surfacing a toast
// when a share was attempted but no URL could be found.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// Mirrors the share_url/share_text fallback extraction in ShareTarget.handle.
function resolveShareUrl(params) {
  const shareText = params.get('share_text') || '';
  let url = params.get('share_url');
  if (!url && shareText) {
    const m = shareText.match(/https?:\/\/\S+/);
    if (m) url = m[0];
  }
  const rawTitle = params.get('share_title') || shareText || '';
  return { url, rawTitle };
}

describe('share_text URL fallback (modeled)', () => {
  it('uses share_url directly when present', () => {
    const p = new URLSearchParams({ share_url: 'https://example.com/a', share_title: 'A' });
    expect(resolveShareUrl(p)).toEqual({ url: 'https://example.com/a', rawTitle: 'A' });
  });
  it('extracts the URL from share_text when share_url is absent', () => {
    const p = new URLSearchParams({ share_text: 'Check this out: https://example.com/article' });
    const r = resolveShareUrl(p);
    expect(r.url).toBe('https://example.com/article');
    expect(r.rawTitle).toBe('Check this out: https://example.com/article');
  });
  it('returns no url when neither field contains one', () => {
    const p = new URLSearchParams({ share_text: 'no link here' });
    expect(resolveShareUrl(p).url).toBeFalsy();
  });
  it('prefers share_url over any URL embedded in share_text', () => {
    const p = new URLSearchParams({ share_url: 'https://real.example', share_text: 'https://decoy.example' });
    expect(resolveShareUrl(p).url).toBe('https://real.example');
  });
});

describe('ShareTarget.handle wiring (index.html)', () => {
  it('falls back to extracting a URL from share_text when share_url is absent', () => {
    expect(html).toContain("if(!url&&shareText){const m=shareText.match(/https?:\\/\\/\\S+/);if(m)url=m[0];}");
  });
  it('still prefers the title field, falling back to share_text', () => {
    expect(html).toContain("const rawTitle=params.get('share_title')||shareText||'';");
  });
  it('toasts instead of silently returning when a share was attempted but no URL was found', () => {
    expect(html).toContain("if(params.has('share_url')||params.has('share_text')||params.has('share_title'))");
    expect(html).toContain('no URL found in the shared content');
  });
  it('does not toast on an ordinary app load with no share params at all', () => {
    // The toast is gated behind params.has(...) checks, not an unconditional !url branch.
    const idx = html.indexOf("if(!url){");
    const guardIdx = html.indexOf("if(params.has('share_url')", idx);
    expect(guardIdx).toBeGreaterThan(idx);
    expect(guardIdx).toBeLessThan(idx + 200);
  });
});
