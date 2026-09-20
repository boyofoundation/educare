import { expect, test } from '@playwright/test';

const MOBILE_VIEWPORT = { width: 390, height: 844 };
const DESKTOP_VIEWPORT = { width: 1280, height: 900 };

const prepareFreshBrowser = async (page: import('@playwright/test').Page) => {
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
};

const openFreshApp = async (
  page: import('@playwright/test').Page,
  viewport: { width: number; height: number } = DESKTOP_VIEWPORT,
) => {
  await page.setViewportSize(viewport);
  await prepareFreshBrowser(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#root')).toBeVisible();
  await expect(page).toHaveTitle(/EduCare/);
};

test.describe('UIUX production baseline @baseline', () => {
  test('renders the local-first shell without provider credentials', async ({ page }) => {
    const externalRequests: string[] = [];
    page.on('request', request => {
      const url = new URL(request.url());
      if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
        externalRequests.push(request.url());
      }
    });

    await openFreshApp(page);
    await expect(page.locator('body')).toContainText('EduCare');
    await expect(page.locator('#root')).not.toContainText(/請輸入.*API Key/i);
    expect(
      externalRequests.filter(url => /openrouter|googleapis|aistudio|anthropic/i.test(url)),
    ).toEqual([]);
  });

  test('has no horizontal overflow at the planned mobile and desktop widths', async ({ page }) => {
    await openFreshApp(page, MOBILE_VIEWPORT);
    await expect
      .poll(() =>
        page.evaluate(() => ({
          innerWidth: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
        })),
      )
      .toEqual({ innerWidth: MOBILE_VIEWPORT.width, scrollWidth: MOBILE_VIEWPORT.width });

    await page.setViewportSize(DESKTOP_VIEWPORT);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect
      .poll(() =>
        page.evaluate(() => ({
          innerWidth: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
        })),
      )
      .toEqual({ innerWidth: DESKTOP_VIEWPORT.width, scrollWidth: DESKTOP_VIEWPORT.width });
  });

  test('keeps the embedded artifact boundary local to the app origin', async ({ page }) => {
    const crossOriginRequests: string[] = [];
    page.on('request', request => {
      const url = new URL(request.url());
      if (!['127.0.0.1', 'localhost'].includes(url.hostname) && url.protocol !== 'data:') {
        crossOriginRequests.push(request.url());
      }
    });

    await openFreshApp(page, MOBILE_VIEWPORT);
    expect(crossOriginRequests.filter(url => /font|api|provider|turso|cdn/i.test(url))).toEqual([]);
  });
});
