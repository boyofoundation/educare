import { defineConfig, devices } from '@playwright/test';

/** Build first. This runner owns a production preview, never a dev/HMR server. */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'offline-*.spec.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: [['list'], ['json', { outputFile: 'test-reports/offline-results.json' }]],
  use: {
    headless: true,
    baseURL: 'http://127.0.0.1:4180/educare/',
    serviceWorkers: 'allow',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: 'node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4180 --strictPort',
    url: 'http://127.0.0.1:4180/educare/',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
