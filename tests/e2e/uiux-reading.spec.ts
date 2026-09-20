import { expect, test, type Locator, type Page } from '@playwright/test';

test.use({ video: 'off' });

const seedReadingSession = async (page: Page) => {
  await page.goto('./');
  await expect(page.locator('main').first()).toBeVisible();
  await page.evaluate(async () => {
    localStorage.setItem('educare:onboarding-preferences', JSON.stringify({ completed: true }));
    const request = window.indexedDB.open('professional-assistant-db', 2);
    await new Promise<void>((resolve, reject) => {
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction(['assistants', 'sessions'], 'readwrite');
        transaction.objectStore('assistants').put({
          id: 'reading-assistant',
          name: '閱讀驗證助理',
          description: '閱讀驗證',
          systemPrompt: 'Help.',
          ragChunks: [],
          createdAt: 1,
        });
        transaction.objectStore('sessions').put({
          id: 'reading-session',
          assistantId: 'reading-assistant',
          title: '閱讀驗證',
          createdAt: 2,
          tokenCount: 0,
          messages: [
            {
              role: 'model',
              timestamp: 3,
              content: [
                '閱讀段落：數學、程式碼與引用都應清楚。',
                '$$x^2 + y^2 = z^2$$',
                '```javascript\nconst lesson = "English";\nconsole.log(lesson, 42);\n```',
                '參考教案 [1]',
              ].join('\n\n'),
              citations: [
                {
                  marker: 1,
                  chunkId: 'reading-source',
                  chunkIndex: 0,
                  fileName: '教案.txt',
                  excerpt: '教案摘錄：先觀察，再練習。',
                },
              ],
            },
            {
              role: 'model',
              timestamp: 4,
              content: '服務暫時無法連線，請到設定檢查後重試。',
              isError: true,
            },
          ],
        });
        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
        transaction.onerror = () => {
          database.close();
          reject(transaction.error);
        };
      };
    });
  });
  await page.reload();
  await expect(page.getByRole('log', { name: '訊息列表' })).toBeVisible();
};

// Resolve CSS colors in the browser (including oklch) and composite translucent
// backgrounds. These checks cover named reading elements, not a whole-site audit.
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
    const fg = luminance(foreground);
    const bg = luminance(background);
    return { ratio: (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05), foreground, background };
  }, foregroundProperty);

test.describe('UIUX reading states @reading', () => {
  test('keeps loaded local history and the draft readable when network access goes offline', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        'providerSettings',
        JSON.stringify({
          activeProvider: 'openrouter',
          providers: {
            openrouter: { enabled: true, config: { apiKey: 'e2e-fake-key', model: 'test-model' } },
          },
        }),
      );
    });
    const externalWrites: string[] = [];
    await page.route('**/*', async route => {
      if (new URL(route.request().url()).hostname === '127.0.0.1') {
        await route.continue();
      } else {
        if (route.request().method() === 'POST') {
          externalWrites.push(route.request().url());
        }
        await route.fulfill({ status: 503, body: '' });
      }
    });
    await seedReadingSession(page);
    await expect(page.getByTestId('chat-input-guidance')).toBeHidden();
    const composer = page.getByRole('textbox', { name: '輸入訊息' });
    await composer.fill('離線時保留的草稿');
    await page.context().setOffline(true);
    await expect(page.getByTestId('chat-input-guidance')).toContainText('目前沒有網路連線');
    await expect(page.getByRole('button', { name: '傳送訊息' })).toBeDisabled();
    await page
      .getByRole('main', { name: '聊天對話' })
      .evaluate(element => element.scrollTo({ top: 0 }));
    await expect(page.getByText('閱讀段落：數學、程式碼與引用都應清楚。')).toBeVisible();
    await expect(composer).toHaveValue('離線時保留的草稿');
    await page.context().setOffline(false);
    await expect(page.getByTestId('chat-input-guidance')).toBeHidden();
    await expect(page.getByRole('button', { name: '傳送訊息' })).toBeEnabled();
    expect(externalWrites).toEqual([]);
  });

  for (const theme of ['dark', 'light', 'system'] as const) {
    test(`math, code, citations and errors remain readable in ${theme} mode`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
      await page.route('**/*', async route => {
        const hostname = new URL(route.request().url()).hostname;
        if (hostname === '127.0.0.1' || hostname === 'localhost') {
          await route.continue();
        } else {
          await route.fulfill({ status: 503, body: 'Test blocks external services' });
        }
      });
      await page.addInitScript(selectedTheme => {
        if (!localStorage.getItem('educare.appearance.v1')) {
          localStorage.setItem(
            'educare.appearance.v1',
            JSON.stringify({ theme: selectedTheme, fontSize: 'large', reducedMotion: true }),
          );
        }
      }, theme);
      await seedReadingSession(page);
      await expect(page.locator('html')).toHaveAttribute('data-theme-preference', theme);
      const message = page.locator('[data-message-index="0"]');
      await message.getByText('📚 參考資料').click();
      await message.getByText('教案.txt · 段落 1').click();
      const content = [
        message.locator('.markdown-content > p').first(),
        message.locator('.katex').first(),
        message.locator('pre code').first(),
        message.getByText('javascript', { exact: true }),
        message.getByRole('button', { name: '複製', exact: true }),
        ...(await message.locator('pre code [class^="hljs-"]').all()),
        message.locator('.citation-list > summary'),
        message.getByText('1 個來源', { exact: true }),
        message.getByText('來源檔案已更新或移除，以下顯示儲存時的摘錄。'),
        message.locator('.citation-excerpt'),
        message.locator('.message-actions > span'),
        message.getByRole('button', { name: '朗讀回應' }),
        message.getByRole('button', { name: '複製回應' }),
      ];
      for (const element of content) {
        await element.scrollIntoViewIfNeeded();
        const contrast = await contrastOf(element);
        expect(
          contrast.ratio,
          `${theme}: ${await element.textContent()} ${JSON.stringify(contrast)}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
      await message.locator('pre code').scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`reading-code-${theme}.png`) });
      // Expanded citations can move the final message outside Virtuoso's window.
      await page
        .getByRole('main', { name: '聊天對話' })
        .evaluate(element => element.scrollTo({ top: element.scrollHeight, behavior: 'auto' }));
      const error = page.locator('.message-bubble--error .markdown-content p');
      await expect(error).toBeVisible();
      expect((await contrastOf(error)).ratio).toBeGreaterThanOrEqual(4.5);
      await expect(page.getByRole('button', { name: '傳送訊息' })).toBeDisabled();
      await expect(page.getByTestId('chat-input-guidance')).toBeVisible();
      for (const element of [
        page.getByTestId('chat-input-guidance').locator('span').first(),
        page.getByRole('button', { name: '設定 AI 服務商', exact: true }),
        page.getByRole('textbox', { name: '輸入訊息' }),
      ]) {
        expect(
          (await contrastOf(element)).ratio,
          `${theme}: ${await element.textContent()}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
        .toBe(true);
      const composer = page.getByRole('textbox', { name: '輸入訊息' });
      await composer.evaluate(element => (element as HTMLElement).blur());
      expect(
        (await contrastOf(composer, 'borderTopColor')).ratio,
        `${theme}: composer border`,
      ).toBeGreaterThanOrEqual(3);
      await page.screenshot({ path: testInfo.outputPath(`reading-${theme}.png`) });
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('data-theme-preference', theme);
      await expect(page.locator('html')).toHaveAttribute('data-reading-size', 'large');
      if (theme === 'system') {
        const surface = page.getByRole('main', { name: '聊天對話' }).locator('..');
        const lightBackground = await surface.evaluate(
          element => window.getComputedStyle(element).backgroundColor,
        );
        await page.emulateMedia({ colorScheme: 'dark' });
        await expect
          .poll(() => surface.evaluate(element => window.getComputedStyle(element).backgroundColor))
          .not.toBe(lightBackground);
        await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'system');
        await page.emulateMedia({ colorScheme: 'light' });
        await expect(surface).toHaveCSS('background-color', lightBackground);
      }
    });
  }
});
