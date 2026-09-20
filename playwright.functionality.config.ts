import { defineConfig, devices } from '@playwright/test';

/** Build first: all acceptance runs use the real production artifact. */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'functionality-*.spec.ts',
  outputDir: 'test-results/functionality',
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['json', { outputFile: 'test-reports/functionality-results.json' }]],
  use: {
    headless: true,
    // Route-based provider mocks must not be bypassed by a controlling worker.
    // The dedicated offline config independently tests the real Service Worker.
    serviceWorkers: 'block',
    baseURL: 'http://127.0.0.1:4182/educare/',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: 'node ./node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4182 --strictPort',
    url: 'http://127.0.0.1:4182/educare/',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
