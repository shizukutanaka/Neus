import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'fs';

// Use the pre-installed chromium that actually exists in this environment
const candidates = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
];
const chromePath = candidates.find(p => existsSync(p));

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.mjs',
  timeout: 30000,
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  use: {
    launchOptions: {
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      ...(chromePath ? { executablePath: chromePath } : {}),
    },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], hasTouch: true } },
  ],
});
