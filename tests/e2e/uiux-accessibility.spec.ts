import { expect, test, type Locator, type Page } from '@playwright/test';

test.use({ video: 'off' });

const TARGET_VIEWPORTS = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 768, height: 900 },
  { width: 1280, height: 900 },
];

const blockExternalRequests = async (page: Page): Promise<void> => {
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.protocol === 'blob:' || url.protocol === 'data:') {
      await route.continue();
      return;
    }
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
      await route.fulfill({ status: 404, body: '' });
      return;
    }
    await route.continue();
  });
};

const openFreshApp = async (page: Page, viewport: { width: number; height: number }) => {
  await page.setViewportSize(viewport);
  await page.goto('http://127.0.0.1:4178/educare/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#root')).toBeVisible();
  await expect(page.locator('main').first()).toBeVisible();
};

const assertNoHorizontalOverflow = async (page: Page): Promise<void> => {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
    .toBe(true);
};

const assertActionTarget = async (page: Page, target: Locator, label: string): Promise<void> => {
  await expect(target, `${label} should remain visible after scrolling`).toBeVisible();
  await target.scrollIntoViewIfNeeded();
  const bounds = await target.boundingBox();
  const viewport = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  expect(bounds, `${label} should have a rendered target`).not.toBeNull();
  expect(bounds?.width, `${label} width`).toBeGreaterThanOrEqual(44);
  expect(bounds?.height, `${label} height`).toBeGreaterThanOrEqual(44);
  expect(
    (bounds?.x ?? 0) + (bounds?.width ?? 0),
    `${label} should intersect the viewport horizontally`,
  ).toBeGreaterThan(0);
  expect(bounds?.x, `${label} should intersect the viewport horizontally`).toBeLessThan(
    viewport.width,
  );
  expect(
    (bounds?.y ?? 0) + (bounds?.height ?? 0),
    `${label} should be reachable below the form scroll`,
  ).toBeLessThanOrEqual(viewport.height + 1);
};

const assertKeyboardReachable = async (
  page: Page,
  target: Locator,
  label: string,
  maxTabs = 120,
): Promise<void> => {
  await expect(target, `${label} should be visible for keyboard navigation`).toBeVisible();
  await page.evaluate(() => {
    const body = document.body;
    body.tabIndex = -1;
    body.focus();
  });

  for (let tab = 0; tab < maxTabs; tab += 1) {
    if (await target.evaluate(element => element === document.activeElement)) {
      await target.scrollIntoViewIfNeeded();
      const bounds = await target.boundingBox();
      const viewport = await page.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight,
      }));
      expect(bounds, `${label} should have a rendered target`).not.toBeNull();
      expect(
        (bounds?.x ?? 0) + (bounds?.width ?? 0),
        `${label} should remain horizontally reachable`,
      ).toBeGreaterThan(0);
      expect(bounds?.x, `${label} should remain horizontally reachable`).toBeLessThan(
        viewport.width,
      );
      // At large text/zoom a template card can be taller than the viewport.
      // Keyboard reachability requires a visible focused portion, not the whole card.
      expect((bounds?.y ?? 0) + (bounds?.height ?? 0), `${label} bottom`).toBeGreaterThan(0);
      expect(bounds?.y, `${label} top`).toBeLessThan(viewport.height);
      return;
    }
    await page.keyboard.press('Tab');
  }

  throw new Error(`${label} was not reachable after ${maxTabs} Tab presses`);
};

const applyEnglishTemplate = async (page: Page): Promise<Locator> => {
  const dialog = page.getByRole('dialog', { name: '先選用途，再開始備課' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /英文教學/ }).click();
  await dialog.getByRole('button', { name: '套用樣板並開始' }).click();
  const editor = page.getByTestId('assistant-editor');
  await expect(editor).toBeVisible();
  return editor;
};

const assertEditorActions = async (page: Page, editor: Locator): Promise<void> => {
  await editor.evaluate(element => {
    element.scrollTop = element.scrollHeight;
  });
  await assertActionTarget(page, editor.getByTestId('cancel-button'), '取消');
  await assertActionTarget(page, editor.getByTestId('save-button'), '保存助理');
};

const openAssistantEditor = async (page: Page): Promise<Locator> => {
  const menuButton = page.getByRole('button', { name: '開啟選單' });
  if (await menuButton.isVisible().catch(() => false)) {
    await menuButton.click();
  }
  const navigation = page.getByRole('navigation', { name: '主要導覽' });
  // 編輯助理位於「管理助理」下拉選單內（689c522 選單重構後）。
  const manageButton = navigation.getByRole('button', { name: '管理助理' });
  await expect(manageButton).toBeVisible();
  await manageButton.click();
  const editButton = navigation.getByRole('button', { name: '編輯助理', exact: true });
  await expect(editButton).toBeVisible();
  await editButton.click();
  const editor = page.getByTestId('assistant-editor');
  await expect(editor).toBeVisible();
  return editor;
};

const openSettings = async (page: Page): Promise<Locator> => {
  const menuButton = page.getByRole('button', { name: '開啟選單' });
  if (await menuButton.isVisible().catch(() => false)) {
    await menuButton.click();
    await page
      .getByRole('navigation', { name: '主要導覽' })
      .getByRole('button', { name: '設定', exact: true })
      .click();
  } else {
    await page.getByRole('button', { name: '設定', exact: true }).click();
  }
  const settingsPage = page.getByTestId('settings-page');
  await expect(settingsPage).toBeVisible();
  return settingsPage;
};

test.describe('UIUX accessibility and form flows @accessibility @flows', () => {
  test('keeps create/edit save and cancel reachable at every target width', async ({ browser }) => {
    for (const viewport of TARGET_VIEWPORTS) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      try {
        await blockExternalRequests(page);
        await openFreshApp(page, viewport);

        let editor = await applyEnglishTemplate(page);
        await assertNoHorizontalOverflow(page);
        await assertEditorActions(page, editor);
        await editor.getByTestId('save-button').click();
        await expect(editor).toBeHidden();

        editor = await openAssistantEditor(page);
        const nameField = editor.locator('#name');
        await nameField.fill(`Viewport ${viewport.width} assistant`);
        await assertNoHorizontalOverflow(page);
        await assertEditorActions(page, editor);
        await editor.getByTestId('save-button').click();
        await expect(editor.getByTestId('assistant-save-status')).toContainText('已保存');
        await editor.getByTestId('cancel-button').click();
        await expect(editor).toBeHidden();
        await expect(
          page.getByRole('heading', {
            name: `Viewport ${viewport.width} assistant`,
            exact: true,
            level: 2,
          }),
        ).toBeVisible();
      } finally {
        await context.close();
      }
    }
  });

  test('keeps onboarding, editor, chat, and settings keyboard reachable with 200% zoom reflow emulation', async ({
    browser,
  }) => {
    // Model a 1280×900 screen at 200% browser zoom with a 640×450 CSS viewport.
    // CSS zoom:2 is not equivalent: it leaves dvh units unscaled and can put a
    // fixed-height drawer below the visual viewport. Native browser zoom remains
    // a human acceptance item; this covers the corresponding reflow/keyboard path.
    const zoomedViewport = { width: 640, height: 450 };
    const context = await browser.newContext({ viewport: zoomedViewport, deviceScaleFactor: 2 });
    const page = await context.newPage();
    try {
      await blockExternalRequests(page);
      await openFreshApp(page, zoomedViewport);
      const onboarding = page.getByRole('dialog', { name: '先選用途，再開始備課' });
      await expect(onboarding).toBeVisible();
      await assertNoHorizontalOverflow(page);

      const template = onboarding.getByRole('button', { name: /英文教學/ });
      await assertKeyboardReachable(page, template, '英文教學樣板');
      await page.keyboard.press('Enter');
      const apply = onboarding.getByRole('button', { name: '套用樣板並開始' });
      await assertKeyboardReachable(page, apply, '套用樣板並開始');
      await page.keyboard.press('Enter');

      const editor = page.getByTestId('assistant-editor');
      await expect(editor).toBeVisible();
      await assertEditorActions(page, editor);
      const save = editor.getByTestId('save-button');
      await assertKeyboardReachable(page, save, '保存助理');
      await page.keyboard.press('Enter');
      await expect(editor).toBeHidden();

      const composer = page.getByRole('textbox', { name: '輸入訊息' });
      await expect(composer).toBeVisible();
      await assertKeyboardReachable(page, composer, '聊天輸入框');
      await composer.fill('zoom reflow keyboard draft');
      await expect(composer).toHaveValue('zoom reflow keyboard draft');

      const settingsPage = await openSettings(page);
      const providerEntry = settingsPage.getByRole('button', { name: /AI 服務商/ });
      await assertKeyboardReachable(page, providerEntry, 'AI 服務商設定入口');
      await providerEntry.click();
      await expect(page.getByRole('heading', { name: 'AI 服務商設定' })).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
