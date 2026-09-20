import { expect, test, type Page } from '@playwright/test';
import { releaseServer } from './support/offlineFixture';
/* global caches */

async function prepare(page: Page, url = './') {
  await page.goto(url);
  await expect(page.getByLabel('離線與版本狀態')).toContainText('離線已準備', { timeout: 60_000 });
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);
}

test('cold offline tab loads the real production shell, all lazy assets and PDF worker', async ({
  page,
  context,
  browserName,
}) => {
  const fixture = await releaseServer();
  try {
    await prepare(page, fixture.url);
    const inventory = await page.evaluate(async () => {
      const manifest = (await (await fetch('./offline-manifest.json')).json()) as {
        assets: string[];
      };
      const scope = (await navigator.serviceWorker.ready).scope;
      const cacheNames = (await caches.keys()).filter(name => name.startsWith('educare-shell:'));
      const cache = await caches.open(cacheNames[0]);
      return {
        assets: manifest.assets,
        cached: (await cache.keys()).map(request => request.url),
        scope,
      };
    });
    expect(inventory.scope).toBe(fixture.url);
    expect(inventory.assets).toContain('js/pdf.worker.js');
    expect(inventory.assets.some(asset => asset.includes('AppearanceSettings'))).toBe(true);
    expect(inventory.cached).toHaveLength(inventory.assets.length);

    await page.getByTestId('onboarding-overlay').getByRole('button', { name: '先跳過' }).click();
    await page.getByRole('button', { name: '新增您的第一個助理' }).click();
    await page.getByTestId('assistant-editor').locator('#name').fill('離線教學資料');
    await page.getByTestId('save-button').click();
    await expect(
      page.getByRole('heading', { name: '離線教學資料', exact: true, level: 2 }),
    ).toBeVisible();
    await fixture.disconnect(page, context, browserName);
    const reopened = await context.newPage();
    const errors: string[] = [];
    reopened.on('pageerror', error => errors.push(error.message));
    await reopened.goto(fixture.url);
    await expect(
      reopened.getByRole('heading', { name: '離線教學資料', exact: true, level: 2 }),
    ).toBeVisible();
    // These chunks were not needed to create the assistant. Fetching every manifest
    // entry while offline also proves preparation includes unvisited parser/fonts.
    const failures = await reopened.evaluate(async assets => {
      const failures: string[] = [];
      for (const asset of assets) {
        try {
          if (!(await fetch(new URL(asset, document.baseURI))).ok) {
            failures.push(asset);
          }
        } catch {
          failures.push(asset);
        }
      }
      return failures;
    }, inventory.assets);
    expect(failures).toEqual([]);
    await reopened.getByRole('button', { name: '設定', exact: true }).click();
    await expect(reopened.getByTestId('settings-page')).toBeVisible();
    await expect(reopened.getByTestId('appearance-settings')).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await fixture.close();
  }
});

test('cache contains only the static manifest, never credentials or private request URLs', async ({
  page,
}) => {
  await prepare(page);
  await page.evaluate(async () => {
    await fetch('./fixture-model?token=SECRET_MARKER', {
      method: 'POST',
      body: 'PRIVATE_CHAT',
      headers: { Authorization: 'Bearer SECRET_MARKER' },
    }).catch(() => undefined);
    await fetch('./index.html?private=SECRET_MARKER', {
      headers: { Authorization: 'Bearer SECRET_MARKER' },
    });
  });
  await page.goto('./?private=SECRET_MARKER');
  const entries = await page.evaluate(async () => {
    const entries: { url: string; authorization: string | null }[] = [];
    for (const name of await caches.keys()) {
      if (!name.startsWith('educare-shell:')) {
        continue;
      }
      for (const request of await (await caches.open(name)).keys()) {
        entries.push({ url: request.url, authorization: request.headers.get('authorization') });
      }
    }
    return entries;
  });
  expect(entries.length).toBeGreaterThan(10);
  expect(entries.every(entry => !entry.url.includes('?') && entry.authorization === null)).toBe(
    true,
  );
  expect(JSON.stringify(entries)).not.toMatch(/SECRET_MARKER|fixture-model|PRIVATE_CHAT/);
});

test('an empty context does not claim first-ever offline availability', async ({ browser }) => {
  const empty = await browser.newContext({ offline: true });
  try {
    const page = await empty.newPage();
    await expect(page.goto('http://127.0.0.1:4180/educare/')).rejects.toThrow();
    expect(await page.getByText('離線已準備', { exact: true }).count()).toBe(0);
  } finally {
    await empty.close();
  }
});
