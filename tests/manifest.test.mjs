// Neus — PWA manifest validation tests
// Ensures install experience quality: separate maskable icon in safe zone,
// required fields, correct display/theme.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(__dirname, '..', 'manifest.json'), 'utf8'));

describe('PWA manifest — required fields', () => {
  for (const field of ['name', 'short_name', 'start_url', 'scope', 'display', 'theme_color', 'background_color', 'icons']) {
    it(`has ${field}`, () => {
      expect(manifest[field]).toBeDefined();
    });
  }

  it('display is standalone', () => {
    expect(manifest.display).toBe('standalone');
  });

  it('theme_color is the accent color', () => {
    expect(manifest.theme_color).toBe('#00C4CC');
  });

  it('background_color is the app background', () => {
    expect(manifest.background_color).toBe('#0a0d0e');
  });
});

describe('PWA manifest — icons', () => {
  const icons = manifest.icons;
  const anyIcons = icons.filter(i => i.purpose.split(' ').includes('any'));
  const maskableIcons = icons.filter(i => i.purpose.split(' ').includes('maskable'));

  it('has at least one "any" icon', () => {
    expect(anyIcons.length).toBeGreaterThanOrEqual(1);
  });

  it('has exactly one dedicated maskable icon', () => {
    expect(maskableIcons.length).toBe(1);
  });

  it('maskable icon purpose is exactly "maskable" (not combined with any)', () => {
    // Combining "any maskable" on one icon is an anti-pattern:
    // maskable needs its content in the safe zone (center 80%), any does not.
    expect(maskableIcons[0].purpose).toBe('maskable');
  });

  it('maskable icon is a distinct design from the any icon', () => {
    expect(maskableIcons[0].src).not.toBe(anyIcons[0].src);
  });

  it('has a 512x512 icon', () => {
    expect(icons.some(i => i.sizes === '512x512')).toBe(true);
  });

  it('maskable content stays within safe zone (center, radius <= 40% of 512)', () => {
    // Extract circle geometry from the maskable SVG; main shapes must sit
    // within ~205px of center (256) so a circular OS mask never clips them.
    const src = maskableIcons[0].src;
    const circles = [...src.matchAll(/cx='(\d+)' cy='(\d+)' r='(\d+)'/g)];
    expect(circles.length).toBeGreaterThan(0);
    for (const [, cx, cy, r] of circles) {
      const edge = Math.abs(Number(cx) - 256) + Number(r);
      expect(edge).toBeLessThanOrEqual(205);
    }
  });

  it('maskable icon has a full-bleed background (survives masking)', () => {
    // A <rect width=512 height=512> fill ensures no transparent corners after mask
    expect(maskableIcons[0].src).toMatch(/<rect width='512' height='512'/);
  });
});

describe('PWA manifest — share target & metadata', () => {
  it('declares a share_target', () => {
    expect(manifest.share_target).toBeDefined();
    expect(manifest.share_target.params).toBeDefined();
  });

  it('has app categories', () => {
    expect(Array.isArray(manifest.categories)).toBe(true);
    expect(manifest.categories.length).toBeGreaterThan(0);
  });
});
