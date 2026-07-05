import '@testing-library/jest-dom';
import 'fake-indexeddb/auto';
import { vi } from 'vitest';

// Mock localStorage
Object.defineProperty(window, 'localStorage', {
  value: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
  },
  writable: true,
});

// Mock sessionStorage
Object.defineProperty(window, 'sessionStorage', {
  value: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
  },
  writable: true,
});

// Mock fetch for API calls
global.fetch = vi.fn();

// Stub URL.createObjectURL / revokeObjectURL for jsdom (VFS bootstrap unit tests, V8).
// jsdom does not implement these. Individual tests may override via Object.defineProperty
// (configurable/writable) — this default just ensures the symbols exist.
let vfsBlobCounter = 0;
if (typeof URL.createObjectURL !== 'function') {
  Object.defineProperty(URL, 'createObjectURL', {
    value: vi.fn(() => `blob:vfs-test-${++vfsBlobCounter}`),
    configurable: true,
    writable: true,
  });
}
if (typeof URL.revokeObjectURL !== 'function') {
  Object.defineProperty(URL, 'revokeObjectURL', {
    value: vi.fn(),
    configurable: true,
    writable: true,
  });
}

// Mock DOM methods
// @ts-ignore
globalThis.Element.prototype.scrollIntoView = vi.fn();

// Mock clipboard API
Object.defineProperty(navigator, 'clipboard', {
  value: {
    writeText: vi.fn().mockResolvedValue(undefined),
    readText: vi.fn().mockResolvedValue(''),
  },
  configurable: true,
  writable: true,
});

// Mock environment variables
vi.mock('vite', () => ({
  loadEnv: vi.fn(() => ({
    GEMINI_API_KEY: 'test-api-key',
    TURSO_URL: 'test-turso-url',
    TURSOAPI_KEY: 'test-turso-api-key',
  })),
}));

// Mock DOMMatrix for PDF.js compatibility
// @ts-ignore
global.DOMMatrix = class DOMMatrix {
  constructor() {
    // Basic mock implementation
  }
};

// Mock Canvas API for PDF.js
global.HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
  clearRect: vi.fn(),
  drawImage: vi.fn(),
  getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })),
  putImageData: vi.fn(),
  fillRect: vi.fn(),
  strokeRect: vi.fn(),
  fillText: vi.fn(),
  measureText: vi.fn(() => ({ width: 0 })),
  save: vi.fn(),
  restore: vi.fn(),
  scale: vi.fn(),
  translate: vi.fn(),
  rotate: vi.fn(),
  transform: vi.fn(),
  setTransform: vi.fn(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
})) as any;

// Mock Web Workers for PDF.js
// @ts-ignore
global.Worker = class Worker {
  constructor() {
    // Basic mock implementation
  }
  postMessage = vi.fn();
  terminate = vi.fn();
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
};

// This import extends expect with jest-dom matchers
// The matchers are added automatically when imported
