// Lensy — Vitest global setup
// Runs before each test file.

import { beforeEach, vi } from 'vitest';

// Mock IndexedDB (jsdom does not implement it)
const idbMock = {
  open: vi.fn(),
  transaction: vi.fn(),
};
Object.defineProperty(global, 'indexedDB', { value: idbMock, writable: true });

// Mock crypto.subtle (available in Node 22 but ensure it's accessible)
if (!global.crypto) {
  const { webcrypto } = await import('crypto');
  Object.defineProperty(global, 'crypto', { value: webcrypto, writable: false });
}

// Mock navigator.storage
Object.defineProperty(global.navigator, 'storage', {
  value: { estimate: async () => ({ usage: 0, quota: 1e9 }) },
  writable: true,
});

// Mock ServiceWorker
Object.defineProperty(global.navigator, 'serviceWorker', {
  value: { register: vi.fn().mockResolvedValue({}) },
  writable: true,
});

beforeEach(() => {
  vi.clearAllMocks();
});
