import { expect, test } from '@playwright/test';

test.describe('UIUX rendered readability @readability', () => {
  for (const theme of ['dark', 'light'] as const) {
    test(`onboarding stays readable with reachable touch controls in ${theme} mode`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.addInitScript(selectedTheme => {
        localStorage.setItem(
          'educare.appearance.v1',
          JSON.stringify({ theme: selectedTheme, fontSize: 'medium', reducedMotion: true }),
        );
      }, theme);
      await page.goto('./');
      const dialog = page.getByRole('dialog', { name: '先選用途，再開始備課' });
      await expect(dialog).toBeVisible();
      const contrast = await dialog.getByRole('heading', { level: 2 }).evaluate(heading => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d')!;
        const channels = (color: string) => {
          context.clearRect(0, 0, 1, 1);
          context.fillStyle = color;
          context.fillRect(0, 0, 1, 1);
          return Array.from(context.getImageData(0, 0, 1, 1).data);
        };
        const luminance = (rgba: number[]) => {
          const linear = rgba.slice(0, 3).map(value => {
            const channel = value / 255;
            return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
          });
          return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
        };
        let background: number[] | undefined;
        let node: HTMLElement | null = heading as HTMLElement;
        while (node) {
          const color = channels(window.getComputedStyle(node).backgroundColor);
          if (color[3] === 255) {
            background = color;
            break;
          }
          node = node.parentElement;
        }
        if (!background) {
          throw new Error('Expected an opaque onboarding surface');
        }
        const foreground = luminance(channels(window.getComputedStyle(heading).color));
        const backdrop = luminance(background);
        return (Math.max(foreground, backdrop) + 0.05) / (Math.min(foreground, backdrop) + 0.05);
      });
      expect(contrast).toBeGreaterThanOrEqual(4.5);
      for (const name of ['關閉對話框', '先跳過']) {
        const control = dialog.getByRole('button', { name, exact: true });
        await control.scrollIntoViewIfNeeded();
        const bounds = await control.boundingBox();
        expect(bounds?.width).toBeGreaterThanOrEqual(44);
        expect(bounds?.height).toBeGreaterThanOrEqual(44);
      }
      await page.screenshot({ path: testInfo.outputPath(`onboarding-mobile-${theme}.png`) });
      await dialog.getByRole('button', { name: '先跳過', exact: true }).click();
      await expect(dialog).toBeHidden();
    });
  }
});
