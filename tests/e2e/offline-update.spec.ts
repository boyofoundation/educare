import { expect, test, type Page } from '@playwright/test';
import { releaseServer } from './support/offlineFixture';
/* global caches, MessageChannel */

async function activeVersion(page: Page) {
  return page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return new Promise<string>(resolve => {
      const channel = new MessageChannel();
      channel.port1.onmessage = event => {
        channel.port1.close();
        resolve(event.data.version);
      };
      registration.active!.postMessage({ type: 'EDUCARE_OFFLINE_STATUS' }, [channel.port2]);
    });
  });
}

async function requestUpdate(page: Page, waitForFailure = false) {
  await page.evaluate(async failed => {
    const registration = await navigator.serviceWorker.ready;
    const settled = new Promise<void>(resolve => {
      registration.addEventListener(
        'updatefound',
        () => {
          const worker = registration.installing!;
          worker.addEventListener('statechange', () => {
            if (worker.state === (failed ? 'redundant' : 'installed')) {
              resolve();
            }
          });
        },
        { once: true },
      );
    });
    await registration.update();
    await settled;
  }, waitForFailure);
}

async function seedLocalWork(page: Page, url: string) {
  await page.goto(url);
  await expect(page.getByLabel('離線與版本狀態')).toContainText('離線已準備', { timeout: 60_000 });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await page.getByTestId('onboarding-overlay').getByRole('button', { name: '先跳過' }).click();
  await page.getByRole('button', { name: '新增您的第一個助理' }).click();
  await page.getByTestId('assistant-editor').locator('#name').fill('更新時保留的教學資料');
  await page.getByTestId('save-button').click();
  await page.getByRole('textbox', { name: '輸入訊息', exact: true }).fill('未送出草稿：保留此內容');
  // Observe persisted data, not an arbitrary sleep for the 500ms debounce.
  await expect
    .poll(() => page.evaluate(() => Object.values(localStorage).join('')))
    .toContain('未送出草稿：保留此內容');
}

test('N to N+1 waits for both tabs, retains old lazy chunks and local work', async ({
  page,
  context,
  browserName,
}) => {
  const fixture = await releaseServer();
  try {
    await seedLocalWork(page, fixture.url);
    const second = await context.newPage();
    await second.goto(fixture.url);
    expect(await activeVersion(page)).toBe(fixture.version('N'));
    fixture.deploy('N1');
    await requestUpdate(second);
    expect(await activeVersion(page)).toBe(fixture.version('N'));
    expect(await activeVersion(second)).toBe(fixture.version('N'));
    // Even direct activation is rejected with another local client present.
    const activation = await second.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      return new Promise<boolean>(resolve => {
        const channel = new MessageChannel();
        channel.port1.onmessage = event => {
          channel.port1.close();
          resolve(event.data.activated);
        };
        registration.waiting!.postMessage({ type: 'EDUCARE_OFFLINE_ACTIVATE' }, [channel.port2]);
      });
    });
    expect(activation).toBe(false);
    await expect(page.getByRole('textbox', { name: '輸入訊息', exact: true })).toHaveValue(
      '未送出草稿：保留此內容',
    );
    await fixture.disconnect(page, context, browserName);
    expect(
      await page.evaluate(async () => (await fetch('./assets/release-N.js')).text()),
    ).toContain('"N"');
    await page.close();
    await second.close();
    const reopened = await context.newPage();
    await reopened.goto(fixture.url);
    await expect.poll(() => activeVersion(reopened)).toBe(fixture.version('N1'));
    await expect(reopened.locator('meta[name="fixture-release"]')).toHaveAttribute('content', 'N1');
    await expect(
      reopened.getByRole('heading', { name: '更新時保留的教學資料', level: 2 }),
    ).toBeVisible();
    await expect(reopened.getByRole('textbox', { name: '輸入訊息', exact: true })).toHaveValue(
      '未送出草稿：保留此內容',
    );
    expect(
      await reopened.evaluate(async () => (await fetch('./assets/release-N.js')).text()),
    ).toContain('"N"');
  } finally {
    await context.close();
    await fixture.close();
  }
});

test('production update guard waits for the workspace run lease and flushes the latest draft', async ({
  page,
  context,
}) => {
  const fixture = await releaseServer();
  try {
    await seedLocalWork(page, fixture.url);
    fixture.deploy('N1');
    await requestUpdate(page);
    await expect(page.getByLabel('離線與版本狀態')).toContainText('新版已下載');
    await page.getByLabel('離線與版本狀態').click();
    await page.evaluate(
      () =>
        new Promise<void>(resolve => {
          void navigator.locks.request('agent-run-educare-local-workspace', async () => {
            await new Promise<void>(release => {
              Object.assign(window, { releaseFixtureRun: release });
              resolve();
            });
          });
        }),
    );
    await page.getByRole('button', { name: '已保存，套用更新' }).click();
    await expect(
      page.getByText('請先保存內容，並等待對話、匯入或作品寫入完成後再更新。'),
    ).toBeVisible();
    expect(await activeVersion(page)).toBe(fixture.version('N'));
    await page.evaluate(() => {
      (window as typeof window & { releaseFixtureRun: () => void }).releaseFixtureRun();
    });
    await page
      .getByRole('textbox', { name: '輸入訊息', exact: true })
      .fill('更新前最後一筆未送出草稿');
    await page.getByRole('button', { name: '已保存，套用更新' }).click();
    await expect(
      page.getByText('更新已啟用；確認內容已保存後，可自行重新整理頁面。'),
    ).toBeVisible();
    await expect.poll(() => activeVersion(page)).toBe(fixture.version('N1'));
    await page.reload();
    await expect(page.getByRole('textbox', { name: '輸入訊息', exact: true })).toHaveValue(
      '更新前最後一筆未送出草稿',
    );
  } finally {
    await context.close();
    await fixture.close();
  }
});

for (const failure of ['network', 'quota'] as const) {
  test(`failed ${failure} candidate preserves previous offline release and data`, async ({
    page,
    context,
    browserName,
  }) => {
    const fixture = await releaseServer();
    try {
      await seedLocalWork(page, fixture.url);
      fixture.deploy('broken', failure);
      await requestUpdate(page, true);
      if (failure === 'network') {
        expect(fixture.faults()).toBeGreaterThan(0);
      }
      expect(await activeVersion(page)).toBe(fixture.version('N'));
      const keys = await page.evaluate(() => caches.keys());
      expect(keys.some(key => key.endsWith('-broken'))).toBe(false);
      expect(keys.some(key => key.endsWith('-N'))).toBe(true);
      await fixture.disconnect(page, context, browserName);
      await page.reload();
      await expect(page.locator('meta[name="fixture-release"]')).toHaveAttribute('content', 'N');
      await expect(
        page.getByRole('heading', { name: '更新時保留的教學資料', level: 2 }),
      ).toBeVisible();
      await expect(page.getByRole('textbox', { name: '輸入訊息', exact: true })).toHaveValue(
        '未送出草稿：保留此內容',
      );
    } finally {
      await context.close();
      await fixture.close();
    }
  });
}
