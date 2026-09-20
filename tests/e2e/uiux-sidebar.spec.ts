import { expect, test, type Locator, type Page } from '@playwright/test';

test.use({ video: 'off' });

const sessionTitles = [
  '本週課程規劃',
  '七年級單字活動',
  '閱讀理解題組',
  '家長日簡報',
  '段考複習單',
  '差異化教學',
  '口說暖身活動',
  '學習單回饋',
] as const;

const blockExternalRequests = async (page: Page): Promise<void> => {
  await page.route('**/*', async route => {
    const hostname = new URL(route.request().url()).hostname;
    if (hostname === '127.0.0.1' || hostname === 'localhost') {
      await route.continue();
      return;
    }
    await route.fulfill({ status: 503, body: '' });
  });
};

const seedSidebarWorkspace = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'educare:onboarding-preferences',
      JSON.stringify({ completed: true, completionReason: 'template' }),
    );
    localStorage.setItem(
      'educare.appearance.v1',
      JSON.stringify({ theme: 'light', fontSize: 'medium', reducedMotion: true }),
    );
    localStorage.removeItem('sidebarCollapsed');
  });

  await page.goto('./');
  await expect(page.locator('main').first()).toBeVisible();
  await page.evaluate(async titles => {
    const assistantId = 'sidebar-e2e-assistant';
    const now = Date.now();
    const database = await new Promise<globalThis.IDBDatabase>((resolve, reject) => {
      const request = window.indexedDB.open('professional-assistant-db', 2);
      request.onupgradeneeded = () => {
        const nextDatabase = request.result;
        if (!nextDatabase.objectStoreNames.contains('assistants')) {
          nextDatabase.createObjectStore('assistants', { keyPath: 'id' });
        }
        if (!nextDatabase.objectStoreNames.contains('sessions')) {
          const sessions = nextDatabase.createObjectStore('sessions', { keyPath: 'id' });
          sessions.createIndex('by-assistant', 'assistantId', { unique: false });
        }
        if (!nextDatabase.objectStoreNames.contains('bundles')) {
          nextDatabase.createObjectStore('bundles', { keyPath: 'id' });
        }
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });

    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(['assistants', 'sessions'], 'readwrite');
      transaction.objectStore('assistants').put({
        id: assistantId,
        name: '英文備課夥伴',
        description: '協助教師備課與設計學習活動',
        systemPrompt: '你是一位專業的英語教學顧問。',
        ragChunks: [],
        createdAt: now,
      });
      titles.forEach((title, index) => {
        transaction.objectStore('sessions').put({
          id: `sidebar-e2e-session-${index + 1}`,
          assistantId,
          title,
          messages: [],
          createdAt: now - index * 86_400_000,
          lastOpenedAt: now - index * 3_600_000,
          tokenCount: 0,
        });
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
  }, sessionTitles);

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('.app-sidebar')).toBeAttached();
};

// Resolve modern CSS colors in-browser and composite translucent ancestor surfaces.
const contrastOf = (locator: Locator, foregroundProperty: 'color' | 'borderTopColor' = 'color') =>
  locator.evaluate((element, property) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d')!;
    const channels = (color: string) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data);
    };
    const blend = (front: number[], back: number[]) =>
      front
        .slice(0, 3)
        .map((channel, index) => (channel * front[3]) / 255 + back[index] * (1 - front[3] / 255));
    const ancestors = [element];
    for (let node = element.parentElement; node; node = node.parentElement) {
      ancestors.unshift(node);
    }
    let background = [255, 255, 255];
    for (const ancestor of ancestors) {
      background = blend(channels(window.getComputedStyle(ancestor).backgroundColor), background);
    }
    const foreground = blend(channels(window.getComputedStyle(element)[property]), background);
    const luminance = (rgb: number[]) =>
      rgb
        .map(value => {
          const channel = value / 255;
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        })
        .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    const foregroundLuminance = luminance(foreground);
    const backgroundLuminance = luminance(background);
    return (
      (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
      (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
    );
  }, foregroundProperty);

const expectTouchTarget = async (locator: Locator): Promise<void> => {
  const bounds = await locator.boundingBox();
  expect(bounds?.width).toBeGreaterThanOrEqual(44);
  expect(bounds?.height).toBeGreaterThanOrEqual(44);
};

const expectNoHorizontalOverflow = async (page: Page): Promise<void> => {
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1);
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport + 1);
};

test.describe('UIUX sidebar hierarchy and light theme @sidebar', () => {
  test('keeps primary actions visible with a flat menu and fully-hidden collapse', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await blockExternalRequests(page);
    await seedSidebarWorkspace(page);

    const navigation = page.getByRole('navigation', { name: '主要導覽' });
    const conversationButtons = navigation.getByRole('button', { name: /^開啟聊天 / });

    // AppData 完成後會自動續開最近對話;先等 boot 收斂(專案選擇器出現)再驗證結構,
    // 避免對載入中的暫態斷言。
    const projectButton = navigation.getByRole('button', { name: 'HTML Projects' });
    await expect(projectButton).toBeVisible();
    await expect(conversationButtons).toHaveCount(6);
    await expect(navigation.getByText(sessionTitles[6], { exact: true })).toHaveCount(0);
    await expect(navigation.locator('button button')).toHaveCount(0);

    await navigation.getByRole('button', { name: '顯示全部 8 個對話' }).click();
    await expect(conversationButtons).toHaveCount(8);
    await expect(navigation.getByText(sessionTitles[7], { exact: true })).toBeVisible();

    await expect(navigation.getByRole('button', { name: '備課與練習' })).toBeVisible();
    await expect(navigation.getByRole('button', { name: '資料管理' })).toBeVisible();
    await expect(navigation.getByRole('button', { name: '匯入協作包' })).toBeVisible();
    expect(
      await contrastOf(navigation.getByRole('button', { name: '匯入協作包' })),
    ).toBeGreaterThanOrEqual(4.5);

    await navigation.getByRole('button', { name: '管理助理' }).click();
    const managementMenu = navigation.locator('[aria-label="助理管理選單"]');
    await expect(managementMenu.getByRole('button', { name: '編輯助理' })).toBeVisible();
    await expect(managementMenu.getByRole('button', { name: '匯出助理設定檔' })).toBeVisible();
    await expect(managementMenu.getByRole('button', { name: '匯入助理設定檔' })).toBeVisible();
    await expect(managementMenu.getByRole('button', { name: '打包協作包' })).toBeVisible();
    await expect(managementMenu.getByRole('button', { name: '刪除助理' })).toBeVisible();

    for (const locator of [
      navigation.locator('.sidebar-brand__title'),
      navigation.locator('.custom-select__trigger'),
      navigation.getByRole('button', { name: '搜尋助理、聊天與素材' }),
      navigation.getByRole('button', { name: `開啟聊天 ${sessionTitles[0]}` }),
      navigation.locator('.sidebar-section-label').filter({ hasText: '工作區' }),
      navigation.getByRole('button', { name: '設定', exact: true }),
      managementMenu.getByRole('button', { name: '編輯助理' }),
    ]) {
      expect(await contrastOf(locator)).toBeGreaterThanOrEqual(4.5);
    }
    const searchToggle = navigation.getByRole('button', { name: '搜尋助理、聊天與素材' });
    expect(await contrastOf(searchToggle, 'borderTopColor')).toBeGreaterThanOrEqual(3);

    // 完全收起：側欄隱藏、只留浮動展開鈕，且展開鈕在淺色下對比足夠。
    await page.keyboard.press('Escape');
    const collapseToggle = navigation.getByRole('button', { name: '收折側邊欄' });
    await expectTouchTarget(collapseToggle);
    await collapseToggle.click();

    const expandToggle = page.getByTestId('sidebar-expand-toggle');
    await expect(expandToggle).toBeVisible();
    await expect(expandToggle).toHaveAttribute('aria-expanded', 'false');
    expect(await contrastOf(expandToggle)).toBeGreaterThanOrEqual(3);
    await expect(page.locator('.app-sidebar')).toHaveClass(/w-0/);
    await expect(navigation.getByRole('button', { name: /^開啟聊天 / })).toHaveCount(0);
    await expect(navigation.getByRole('button', { name: '管理助理' })).toHaveCount(0);
    await expect(navigation.getByRole('button', { name: '設定', exact: true })).toHaveCount(0);

    await expectTouchTarget(expandToggle);
    await expandToggle.click();
    await expect(navigation.getByRole('button', { name: /^開啟聊天 / })).toHaveCount(8);
    await expect(page.locator('.app-sidebar')).toHaveClass(/w-72/);
  });

  test('keeps the mobile drawer readable, operable, and within the viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await blockExternalRequests(page);
    await seedSidebarWorkspace(page);

    const openDrawer = page.getByRole('button', { name: '開啟選單' });
    await expectTouchTarget(openDrawer);
    await openDrawer.click();

    const navigation = page.getByRole('navigation', { name: '主要導覽' });
    await expect(navigation).toBeVisible();
    await expect(navigation.getByRole('button', { name: /^開啟聊天 / })).toHaveCount(6);

    for (const name of [
      '關閉選單',
      '新增助理',
      '分享助理',
      '管理助理',
      '搜尋助理、聊天與素材',
      '新增聊天',
      '檢視 token 用量',
      '備課與練習',
      '資料管理',
      '匯入協作包',
      '設定',
    ]) {
      await expectTouchTarget(navigation.getByRole('button', { name, exact: true }));
    }
    await expectNoHorizontalOverflow(page);
  });
});
