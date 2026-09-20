import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { AgentBundle } from '../../types';

const ORIGIN = 'http://127.0.0.1:4182';
const SECRET = 'f2-existing-private-key-never-share';
const MATERIAL = '<img src=x onerror="window.f2Executed=true"> teaching material';

async function localOnly(context: BrowserContext) {
  await context.addInitScript(() => {
    localStorage.setItem('educare:onboarding-preferences', JSON.stringify({ completed: true }));
  });
  await context.route('**/*', route =>
    new URL(route.request().url()).origin === ORIGIN ? route.continue() : route.abort(),
  );
}

async function bundleRecords(page: Page) {
  return page.evaluate(async () => {
    const opening = window.indexedDB.open('professional-assistant-db', 2);
    return new Promise<Array<{ id: string; bundle: AgentBundle }>>((resolve, reject) => {
      opening.onerror = () => reject(opening.error);
      opening.onsuccess = () => {
        const database = opening.result;
        const request = database.transaction('bundles').objectStore('bundles').getAll();
        request.onsuccess = () => {
          database.close();
          resolve(request.result);
        };
        request.onerror = () => reject(request.error);
      };
    });
  });
}

test('F2 public bundle export and material import work in an isolated browser without credentials or cloud', async ({
  page,
  context,
  browser,
}) => {
  await localOnly(context);
  await page.goto('./');
  await expect(page.getByRole('button', { name: '打包協作包', exact: true })).toBeVisible();
  await page.evaluate(
    async ({ secret, material }) => {
      localStorage.setItem(
        'providerSettings',
        JSON.stringify({
          activeProvider: 'openrouter',
          providers: {
            openrouter: { enabled: true, config: { apiKey: secret, model: 'fixture' } },
          },
        }),
      );
      const opening = window.indexedDB.open('professional-assistant-db', 2);
      await new Promise<void>((resolve, reject) => {
        opening.onupgradeneeded = () => {
          const database = opening.result;
          if (!database.objectStoreNames.contains('assistants')) {
            database.createObjectStore('assistants', { keyPath: 'id' });
          }
          if (!database.objectStoreNames.contains('sessions')) {
            database
              .createObjectStore('sessions', { keyPath: 'id' })
              .createIndex('by-assistant', 'assistantId');
          }
          if (!database.objectStoreNames.contains('bundles')) {
            database.createObjectStore('bundles', { keyPath: 'id' });
          }
        };
        opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
          const database = opening.result;
          const transaction = database.transaction('assistants', 'readwrite');
          for (const index of [1, 2]) {
            transaction.objectStore('assistants').put({
              id: `f2-author-${index}`,
              name: `F2 作者助理 ${index}`,
              description: 'local file exchange',
              systemPrompt: 'Teach with the supplied material.',
              starterPrompts: [],
              createdAt: index,
              ragChunks: [{ fileName: `material-${index}.md`, content: material }],
            });
          }
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      });
    },
    { secret: SECRET, material: MATERIAL },
  );
  await page.reload();
  await page.getByRole('button', { name: '打包協作包', exact: true }).click();
  for (const index of [1, 2]) {
    await page.getByRole('checkbox', { name: new RegExp(`F2 作者助理 ${index}`) }).check();
  }
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await page.getByLabel('設為接待入口：F2 作者助理 1', { exact: true }).check();
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await page.getByLabel('協作包名稱', { exact: true }).fill('F2 本機教學交接');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '匯出 JSON', exact: true }).click();
  const download = await downloading;
  const path = (await download.path())!;
  const raw = await readFile(path, 'utf8');
  expect(raw).not.toContain(SECRET);
  const exported = JSON.parse(raw) as AgentBundle;
  expect(exported.manifest.schemaVersion).toBe(1);
  expect(exported).not.toHaveProperty('encryptedProviderSettings');
  expect(exported.agents).toHaveLength(2);
  expect(exported.agents.map(agent => agent.ragChunks[0].content)).toEqual([MATERIAL, MATERIAL]);

  const recipient = await browser.newContext({ serviceWorkers: 'block' });
  try {
    await localOnly(recipient);
    const receiver = await recipient.newPage();
    await receiver.goto(`${ORIGIN}/educare/?import=bundle`);
    const fileInput = receiver.getByRole('region', { name: '協作包檔案拖放區' }).locator('input');
    await fileInput.setInputFiles({
      name: 'broken.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{broken'),
    });
    await expect(receiver.getByRole('region', { name: '驗證錯誤' })).toBeVisible();
    expect(await bundleRecords(receiver)).toEqual([]);
    await fileInput.setInputFiles(path);
    const preview = receiver.getByRole('region', { name: '協作包預覽' });
    await expect(preview).toContainText('來源不可信');
    await expect(preview).toContainText('material-1.md');
    await expect(preview).toContainText('material-2.md');
    expect(await bundleRecords(receiver)).toEqual([]);
    await preview.getByRole('button', { name: '啟用協作包' }).click();
    await expect(receiver).toHaveURL(/bundle=/);
    await receiver.reload();
    const records = await bundleRecords(receiver);
    expect(records).toHaveLength(1);
    expect(records[0].bundle.agents.map(agent => agent.ragChunks[0].content)).toEqual([
      MATERIAL,
      MATERIAL,
    ]);
    expect(await receiver.evaluate(() => JSON.stringify(localStorage))).not.toContain(SECRET);
    expect(await receiver.evaluate(() => Reflect.get(window, 'f2Executed'))).toBeUndefined();
    expect(receiver.url()).not.toContain(SECRET);
  } finally {
    await recipient.close();
  }
});
