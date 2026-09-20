import { defineConfig, devices } from '@playwright/test';

/**
 * UI/UX acceptance suite.
 *
 * The suite intentionally runs against the production preview rather than Vite's
 * development server. Build first, then let this config own port 4178 so the
 * performance samples and interaction checks use the same artifact.
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'uiux-*.spec.ts',
  outputDir: 'test-results/uiux',
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: process.env.CI ? 2 : 0,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [['list'], ['json', { outputFile: 'test-reports/uiux-results.json' }]],
  use: {
    headless: true,
    serviceWorkers: 'block',
    baseURL: 'http://127.0.0.1:4178/educare/',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 60_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'node ./node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4178 --strictPort',
    url: 'http://127.0.0.1:4178/educare/',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
