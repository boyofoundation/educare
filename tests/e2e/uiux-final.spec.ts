import { expect, test } from '@playwright/test';

const MOBILE_VIEWPORT = { width: 390, height: 844 };

const prepareFreshBrowser = async (page: import('@playwright/test').Page) => {
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
};

const openFreshApp = async (
  page: import('@playwright/test').Page,
  viewport = { width: 1280, height: 900 },
) => {
  await page.setViewportSize(viewport);
  await prepareFreshBrowser(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#root')).toBeVisible();
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
  const settingsButton = page.getByRole('button', { name: '設定' }).first();
  if (await settingsButton.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await settingsButton.click();
  } else {
    await page.getByRole('button', { name: '開啟選單' }).click();
    await page.getByRole('button', { name: '設定' }).click();
  }
};

test.describe('UIUX integrated acceptance @final', () => {
  test('first-run onboarding completes a template path without credentials and persists', async ({
    page,
  }) => {
    await openFreshApp(page);

    const overlay = page.getByTestId('onboarding-overlay');
    await expect(overlay).toBeVisible();
    const dialog = overlay.getByRole('dialog');
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog).toContainText('先選用途，再開始備課');

    await dialog.getByRole('button', { name: /英文教學樣板/ }).click();
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
    const navigation = page.getByRole('navigation', { name: '主要導覽' });
    await expect(menuButton).toBeVisible();
    const closedState = await navigation.evaluate(element => ({
      ariaHidden: element.getAttribute('aria-hidden'),
      inert: element.hasAttribute('inert') || (element as HTMLElement).inert === true,
    }));
    expect(closedState.ariaHidden === 'true' || closedState.inert).toBe(true);

    await menuButton.click();
    await expect(navigation).toBeVisible();
    await navigation.getByRole('button', { name: '關閉選單' }).focus();
    await page.keyboard.press('Escape');
    await expect(navigation).toBeHidden();
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
  }) => {
    await openFreshApp(page, MOBILE_VIEWPORT);
    await openSettings(page);
    const appearance = page.getByTestId('appearance-settings');
    await expect(appearance).toBeVisible();
    await appearance.getByTestId('appearance-theme-light').check();
    await appearance.getByTestId('appearance-font-size').selectOption('large');
    await appearance.getByTestId('appearance-reduced-motion').check();
    await expect(appearance.getByRole('status')).toContainText('已儲存');

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

    await page.goto('/?share=missing-shared-assistant', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('searchbox')).toBeHidden();
    await expect(page.getByRole('button', { name: /搜尋|查找/ }).first()).toBeHidden();
  });
});
