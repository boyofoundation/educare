import { expect, test } from '@playwright/test';

const MOBILE_VIEWPORT = { width: 390, height: 844 };

const openFreshApp = async (
  page: import('@playwright/test').Page,
  viewport = { width: 1280, height: 900 },
) => {
  await page.setViewportSize(viewport);
  // Playwright gives each test an isolated context. Do not clear storage on
  // every navigation: reload assertions must exercise actual persistence.
  await page.goto('./', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#root')).toBeVisible();
  await expect(page.locator('main')).toBeVisible();
};

const skipOnboardingIfPresent = async (page: import('@playwright/test').Page) => {
  const overlay = page.getByTestId('onboarding-overlay');
  if (await overlay.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await overlay.getByRole('button', { name: '先跳過' }).click();
    await expect(overlay).toBeHidden();
  }
};

const openSettings = async (page: import('@playwright/test').Page) => {
  await skipOnboardingIfPresent(page);
  const menuButton = page.getByRole('button', { name: '開啟選單' });
  if (await menuButton.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await menuButton.click();
    await page
      .getByRole('navigation', { name: '主要導覽' })
      .getByRole('button', { name: '設定', exact: true })
      .click();
  } else {
    await page.getByRole('button', { name: '設定', exact: true }).click();
  }
};

test.describe('UIUX integrated acceptance @final', () => {
  test('exports and imports an assistant in a fresh browser without cloud setup or writes', async ({
    page,
    browser,
  }) => {
    const externalWrites: string[] = [];
    await page.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
        if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
          externalWrites.push(request.url());
        }
        await route.fulfill({ status: 404, body: '' });
        return;
      }
      await route.continue();
    });
    await openFreshApp(page);
    const onboarding = page.getByRole('dialog', { name: '先選用途，再開始備課' });
    await onboarding.getByRole('button', { name: /英文教學/ }).click();
    await onboarding.getByRole('button', { name: '套用樣板並開始' }).click();
    const assistantName = await page.getByTestId('assistant-editor').locator('#name').inputValue();
    await page.getByTestId('save-button').click();
    await expect(page.getByTestId('assistant-editor')).toBeHidden();
    await page.getByRole('button', { name: '分享助理', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '分享助理', exact: true });
    await expect(dialog.getByText('先匯出助理檔案')).toBeVisible();
    const downloadReady = page.waitForEvent('download');
    await dialog.getByRole('button', { name: '匯出助理檔案', exact: true }).click();
    const download = await downloadReady;
    expect(download.suggestedFilename()).toMatch(/\.zip$/);
    expect(await download.failure()).toBeNull();
    const archivePath = await download.path();
    expect(archivePath).not.toBeNull();
    const importedContext = await browser.newContext({ viewport: MOBILE_VIEWPORT });
    try {
      await importedContext.route('**/*', async route => {
        const request = route.request();
        if (!['127.0.0.1', 'localhost'].includes(new URL(request.url()).hostname)) {
          if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
            externalWrites.push(request.url());
          }
          await route.fulfill({ status: 404, body: '' });
        } else {
          await route.continue();
        }
      });
      const importedPage = await importedContext.newPage();
      await importedPage.goto('http://127.0.0.1:4178/educare/');
      await importedPage.getByRole('button', { name: /匯入助理／協作包/ }).click();
      const importDialog = importedPage.getByRole('dialog', { name: '匯入助理或協作包' });
      await importDialog.locator('input[type="file"]').setInputFiles(archivePath!);
      await expect(importDialog).toBeHidden();
      await expect(importedPage.getByRole('main', { name: '聊天對話' })).toBeVisible();
      await expect(
        importedPage.getByRole('heading', { name: assistantName, exact: true, level: 2 }),
      ).toBeVisible();
      await expect(importedPage.getByTestId('chat-input-guidance')).toContainText('尚未設定');
      await importedPage.reload();
      await expect(
        importedPage.getByRole('heading', { name: assistantName, exact: true, level: 2 }),
      ).toBeVisible();
      await expect(importedPage.getByTestId('onboarding-overlay')).toBeHidden();
    } finally {
      await importedContext.close();
    }
    expect(externalWrites).toEqual([]);
  });

  test('first-run onboarding completes a template path without credentials and persists', async ({
    page,
  }, testInfo) => {
    await openFreshApp(page);

    const overlay = page.getByTestId('onboarding-overlay');
    await expect(overlay).toBeVisible();
    const dialog = page.getByRole('dialog', { name: '先選用途，再開始備課' });
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog).toContainText('先選用途，再開始備課');
    await page.screenshot({ path: testInfo.outputPath('onboarding-desktop.png') });

    await dialog.getByRole('button', { name: /英文教學/ }).click();
    await expect(dialog.getByRole('button', { name: '套用樣板並開始' })).toBeEnabled();
    await dialog.getByRole('button', { name: '套用樣板並開始' }).click();
    await expect(overlay).toBeHidden();

    const preferences = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('educare:onboarding-preferences') || 'null'),
    );
    expect(preferences).toEqual(
      expect.objectContaining({ completed: true, completionReason: 'template' }),
    );

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('onboarding-overlay')).toBeHidden();
  });

  test('mobile drawer removes closed controls from focus and restores trigger focus on Escape', async ({
    page,
  }) => {
    await openFreshApp(page, MOBILE_VIEWPORT);
    await skipOnboardingIfPresent(page);

    const menuButton = page.getByRole('button', { name: '開啟選單' });
    // An aria-hidden region has no accessible name until it opens.
    const navigation = page.locator('[role="navigation"][aria-label="主要導覽"]');
    await expect(menuButton).toBeVisible();
    const menuBounds = await menuButton.boundingBox();
    expect(menuBounds?.width).toBeGreaterThanOrEqual(44);
    expect(menuBounds?.height).toBeGreaterThanOrEqual(44);
    const closedState = await navigation.evaluate(element => ({
      ariaHidden: element.getAttribute('aria-hidden'),
      inert: element.hasAttribute('inert') || (element as HTMLElement).inert === true,
    }));
    expect(closedState.ariaHidden === 'true' || closedState.inert).toBe(true);

    await menuButton.click();
    await expect(navigation).toBeVisible();
    const closeMenu = navigation.getByRole('button', { name: '關閉選單' });
    const closeBounds = await closeMenu.boundingBox();
    expect(closeBounds?.width).toBeGreaterThanOrEqual(44);
    expect(closeBounds?.height).toBeGreaterThanOrEqual(44);
    await closeMenu.focus();
    await page.keyboard.press('Escape');
    await expect
      .poll(async () =>
        navigation.evaluate(element => ({
          ariaHidden: element.getAttribute('aria-hidden'),
          inert: element.hasAttribute('inert') || (element as HTMLElement).inert === true,
        })),
      )
      .toEqual(expect.objectContaining({ ariaHidden: 'true', inert: true }));
    await expect(menuButton).toBeFocused();
  });

  test('provider modal traps focus, locks scroll, and returns focus after Escape', async ({
    page,
  }) => {
    await openFreshApp(page);
    await openSettings(page);
    await page.getByRole('button', { name: /AI 服務商/ }).click();

    const trigger = page.getByRole('button', { name: '分享此服務商設定' });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: '分享服務商設定' });
    await expect(dialog).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('hidden');
    await expect
      .poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]'))))
      .toBe(true);

    await page.keyboard.press('Tab');
    await expect
      .poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]'))))
      .toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
  });

  test('storage failure is visible and never claims appearance preferences were persisted', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const storagePrototype = window.Storage.prototype;
      const originalSetItem = storagePrototype.setItem;
      storagePrototype.setItem = function setItem(key: string, value: string) {
        if (key === 'educare.appearance.v1') {
          throw new window.DOMException('Quota exceeded', 'QuotaExceededError');
        }
        return originalSetItem.call(this, key, value);
      };
    });
    await openFreshApp(page);
    await openSettings(page);

    const appearance = page.getByTestId('appearance-settings');
    await expect(appearance).toBeVisible();
    await appearance.getByTestId('appearance-theme-light').check();
    await expect(appearance.getByRole('status')).toContainText('未允許保存偏好');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    const persistedPreferences = await page.evaluate(() =>
      localStorage.getItem('educare.appearance.v1'),
    );
    expect(persistedPreferences).toBeNull();
  });

  test('mobile theme and reading preferences survive reload without changing preview boundaries', async ({
    page,
  }, testInfo) => {
    await openFreshApp(page, MOBILE_VIEWPORT);
    await openSettings(page);
    const appearance = page.getByTestId('appearance-settings');
    await expect(appearance).toBeVisible();
    await appearance.getByTestId('appearance-theme-light').check();
    await appearance.getByTestId('appearance-font-size').selectOption('large');
    await appearance.getByTestId('appearance-reduced-motion').check();
    await expect(appearance.getByRole('status')).toContainText('已儲存');
    await expect(page.getByTestId('settings-page')).toHaveCSS(
      'background-color',
      'rgb(255, 255, 255)',
    );
    await page.screenshot({ path: testInfo.outputPath('appearance-mobile-light.png') });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('html')).toHaveAttribute('data-reading-size', 'large');
    await expect(page.locator('html')).toHaveAttribute('data-reduced-motion', 'true');

    const previewFrames = page.locator('iframe');
    for (let index = 0; index < (await previewFrames.count()); index += 1) {
      await expect(previewFrames.nth(index)).toHaveAttribute('src', /^(?!.*appearance)/);
    }
  });

  test('local navigation search is usable and is absent from shared mode', async ({ page }) => {
    const requests = [] as string[];
    page.on('request', request => {
      const url = new URL(request.url());
      if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
        requests.push(request.url());
      }
    });

    await openFreshApp(page);
    await skipOnboardingIfPresent(page);
    const searchTrigger = page.getByRole('button', { name: /搜尋|查找/ }).first();
    await expect(searchTrigger).toBeVisible();
    await searchTrigger.click();
    const searchInput = page.getByRole('searchbox');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('private-only-marker');
    await expect(page.getByTestId('navigation-search-results')).toBeVisible();
    await expect(page.getByTestId('navigation-search-results')).toContainText(/找不到|沒有結果/);
    expect(requests.filter(url => /api|turso|provider|search/i.test(url))).toEqual([]);

    await page.goto('./?share=missing-shared-assistant', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('searchbox')).toBeHidden();
    await expect(page.getByRole('button', { name: /搜尋|查找/ }).first()).toBeHidden();
  });
});
