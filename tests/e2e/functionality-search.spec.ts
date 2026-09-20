import { expect, test, type Page } from '@playwright/test';

const APP_ORIGIN = 'http://127.0.0.1:4182';
const DESKTOP_VIEWPORT = { width: 1280, height: 900 };
const CHUNK_COUNT = 10_000;
const SESSION_COUNT = 100;
const MESSAGES_PER_SESSION = 20;
const MATERIAL_FILE_NAME = 'f4-large-material.md';
const MATERIAL_DOCUMENT_ID = 'f4-large-material-document';
const TARGET_CHUNK_INDEX = 9_876;
const TARGET_SESSION_INDEX = 73;
const TARGET_MESSAGE_INDEX = 14;
const TARGET_MATERIAL_QUERY = 'f4-exact-material-target';
const TARGET_MATERIAL_CONTENT =
  'f4-exact-material-target：第 9877 段，應開啟這一段而不是同檔案的其他內容。';
const TARGET_MESSAGE = 'f4-exact-session-message-target';
const COLD_QUERY_INDICES = [0, 1, 2, 3, 4];
const HOT_QUERY_INDICES = [5_000, 5_001, 5_002, 5_003, 5_004, 5_005, 5_006, 5_007, 5_008, 5_009];

type SeedChunk = {
  fileName: string;
  content: string;
  documentId: string;
  contentHash: string;
  sourceVersion: number;
  sourceType: 'file';
  chunkId: string;
};

type SeedAssistant = {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  ragChunks: SeedChunk[];
  starterPrompts: string[];
  createdAt: number;
};

type SeedMessage = {
  role: 'user' | 'model';
  content: string;
  timestamp: number;
};

type SeedSession = {
  id: string;
  assistantId: string;
  title: string;
  messages: SeedMessage[];
  createdAt: number;
  updatedAt: number;
  tokenCount: number;
};

type SeedData = {
  assistants: SeedAssistant[];
  sessions: SeedSession[];
};

const ASSISTANT_ID = 'f4-search-performance-assistant';

const probeQuery = (chunkIndex: number): string => `f4-search-probe-${chunkIndex}-unique`;

const buildSeed = (): SeedData => {
  const createdAt = 1_700_000_000_000;
  const ragChunks = Array.from({ length: CHUNK_COUNT }, (_, chunkIndex): SeedChunk => {
    const isTarget = chunkIndex === TARGET_CHUNK_INDEX;
    const content = isTarget
      ? `${TARGET_MATERIAL_CONTENT} ${probeQuery(chunkIndex)}`
      : `f4 material chunk ${chunkIndex}; ${probeQuery(chunkIndex)}.`;
    return {
      fileName: MATERIAL_FILE_NAME,
      content,
      documentId: MATERIAL_DOCUMENT_ID,
      contentHash: `f4-content-hash-${chunkIndex}`,
      sourceVersion: 1,
      sourceType: 'file',
      chunkId: `${MATERIAL_DOCUMENT_ID}:v1#${chunkIndex}`,
    };
  });

  const sessions = Array.from({ length: SESSION_COUNT }, (_, sessionIndex): SeedSession => {
    const sessionTime = createdAt + sessionIndex * 1_000;
    return {
      id: `f4-search-session-${String(sessionIndex).padStart(3, '0')}`,
      assistantId: ASSISTANT_ID,
      title: `F4 search session ${String(sessionIndex).padStart(3, '0')}`,
      messages: Array.from({ length: MESSAGES_PER_SESSION }, (_, messageIndex) => ({
        role: messageIndex % 2 === 0 ? ('user' as const) : ('model' as const),
        content:
          sessionIndex === TARGET_SESSION_INDEX && messageIndex === TARGET_MESSAGE_INDEX
            ? TARGET_MESSAGE
            : `f4 session ${sessionIndex} message ${messageIndex}`,
        timestamp: sessionTime + messageIndex,
      })),
      createdAt: sessionTime,
      updatedAt: sessionTime + MESSAGES_PER_SESSION,
      tokenCount: 0,
    };
  });

  return {
    assistants: [
      {
        id: ASSISTANT_ID,
        name: 'F4 本機搜尋測試助理',
        description: '用於驗證大量本機教材與聊天搜尋的測試資料。',
        systemPrompt: 'Answer briefly for the local-search E2E fixture.',
        ragChunks,
        starterPrompts: [],
        createdAt,
      },
    ],
    sessions,
  };
};

const seedDatabase = async (page: Page, seed: SeedData): Promise<void> => {
  await page.goto('./', { waitUntil: 'domcontentloaded' });
  await page.evaluate(async payload => {
    const request = window.indexedDB.open('professional-assistant-db', 2);
    await new Promise<void>((resolve, reject) => {
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains('assistants')) {
          database.createObjectStore('assistants', { keyPath: 'id' });
        }
        if (!database.objectStoreNames.contains('sessions')) {
          const sessions = database.createObjectStore('sessions', { keyPath: 'id' });
          sessions.createIndex('by-assistant', 'assistantId', { unique: false });
        }
        if (!database.objectStoreNames.contains('bundles')) {
          database.createObjectStore('bundles', { keyPath: 'id' });
        }
      };
      request.onerror = () => reject(request.error ?? new Error('Unable to open F4 test DB'));
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction(
          ['assistants', 'sessions', 'bundles'],
          'readwrite',
        );
        transaction.objectStore('assistants').clear();
        transaction.objectStore('sessions').clear();
        transaction.objectStore('bundles').clear();
        for (const assistant of payload.assistants) {
          transaction.objectStore('assistants').put(assistant);
        }
        for (const session of payload.sessions) {
          transaction.objectStore('sessions').put(session);
        }
        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
        transaction.onerror = () => {
          database.close();
          reject(transaction.error ?? new Error('Unable to seed F4 test DB'));
        };
        transaction.onabort = () => {
          database.close();
          reject(transaction.error ?? new Error('F4 test DB seed aborted'));
        };
      };
    });
  }, seed);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#root')).toBeVisible();
  await expect(page.getByTestId('sidebar-search-toggle')).toBeVisible();
};

const blockExternalRequests = async (page: Page): Promise<void> => {
  await page.route('**/*', async route => {
    const requestUrl = new URL(route.request().url());
    if (
      (requestUrl.protocol === 'http:' || requestUrl.protocol === 'https:') &&
      requestUrl.origin !== APP_ORIGIN
    ) {
      await route.fulfill({ status: 503, body: '' });
      return;
    }
    await route.continue();
  });
};

const openSearch = async (page: Page): Promise<void> => {
  await page.getByTestId('sidebar-search-toggle').click();
  await expect(page.getByRole('searchbox', { name: '搜尋本機內容' })).toBeVisible();
};

const measureSearch = async (
  page: Page,
  query: string,
  expectedResultText: string,
): Promise<number> => {
  const searchInput = page.getByRole('searchbox', { name: '搜尋本機內容' });
  const results = page.getByTestId('navigation-search-results');
  await expect(searchInput).toBeVisible();

  await page.evaluate(() => {
    performance.clearMarks('f4-ui-search-start');
    performance.clearMarks('f4-ui-search-end');
    performance.clearMeasures('f4-ui-search');
    performance.mark('f4-ui-search-start');
  });
  await searchInput.fill(query);
  const matchingResult = results.getByRole('button').filter({ hasText: expectedResultText });
  await expect(matchingResult).toHaveCount(1);
  await expect(matchingResult).toBeVisible();

  return page.evaluate(() => {
    performance.mark('f4-ui-search-end');
    const measure = performance.measure('f4-ui-search', 'f4-ui-search-start', 'f4-ui-search-end');
    const duration = measure.duration;
    performance.clearMarks('f4-ui-search-start');
    performance.clearMarks('f4-ui-search-end');
    performance.clearMeasures('f4-ui-search');
    return duration;
  });
};

const percentile95 = (values: number[]): number => {
  if (values.length === 0) {
    throw new Error('Cannot calculate p95 without measurements.');
  }
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
};

test.describe('F4 production local search', () => {
  test('searches 10,000 material chunks and 100 twenty-message sessions', async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await blockExternalRequests(page);
    await seedDatabase(page, buildSeed());

    const coldDurations: number[] = [];
    for (const chunkIndex of COLD_QUERY_INDICES) {
      if (coldDurations.length > 0) {
        await page.reload({ waitUntil: 'domcontentloaded' });
        await expect(page.getByTestId('sidebar-search-toggle')).toBeVisible();
      }
      await openSearch(page);
      coldDurations.push(await measureSearch(page, probeQuery(chunkIndex), probeQuery(chunkIndex)));
    }

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('sidebar-search-toggle')).toBeVisible();
    await openSearch(page);
    const hotDurations: number[] = [];
    for (const chunkIndex of HOT_QUERY_INDICES) {
      hotDurations.push(await measureSearch(page, probeQuery(chunkIndex), probeQuery(chunkIndex)));
    }

    const timing = {
      chunkCount: CHUNK_COUNT,
      sessionCount: SESSION_COUNT,
      sessionMessageCount: SESSION_COUNT * MESSAGES_PER_SESSION,
      coldSamplesMs: coldDurations,
      hotSamplesMs: hotDurations,
      coldP95Ms: percentile95(coldDurations),
      hotP95Ms: percentile95(hotDurations),
      hotTargetMs: 300,
    };
    test.info().annotations.push({
      type: 'f4-ui-search-timing',
      description: JSON.stringify(timing),
    });
    test.info().annotations.push({
      type: 'f4-cancellation',
      description:
        'Not measured: local navigation search exposes no cancellation control. Existing services/f4RetrievalBenchmark.ts deferred-parser benchmark remains the cancellation limitation.',
    });
    await test.info().attach('f4-ui-search-timing.json', {
      body: JSON.stringify(timing, null, 2),
      contentType: 'application/json',
    });
    expect(
      timing.hotP95Ms,
      `hot local-search p95 exceeded ${timing.hotTargetMs}ms`,
    ).toBeLessThanOrEqual(timing.hotTargetMs);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('sidebar-search-toggle')).toBeVisible();
    await openSearch(page);
    const results = page.getByTestId('navigation-search-results');
    const exactMaterialResult = results
      .getByRole('button')
      .filter({ hasText: TARGET_MATERIAL_QUERY });
    await page.getByRole('searchbox', { name: '搜尋本機內容' }).fill(TARGET_MATERIAL_QUERY);
    await expect(exactMaterialResult).toHaveCount(1);
    await exactMaterialResult.click();

    const material = page.getByTestId('focused-material-content');
    await expect(material).toBeVisible();
    await expect(material).toContainText(MATERIAL_FILE_NAME);
    await expect(material).toContainText(TARGET_MATERIAL_CONTENT);
    await expect(material).not.toContainText('f4 material chunk 9875');
    await page
      .getByRole('dialog', { name: '檢視素材' })
      .getByRole('button', { name: '關閉對話框' })
      .click();
    await expect(material).toBeHidden();

    // Reopen the real search control after material navigation to prove the
    // input remains usable and can navigate an exact message as well.
    await openSearch(page);
    const messageInput = page.getByRole('searchbox', { name: '搜尋本機內容' });
    await messageInput.fill(TARGET_MESSAGE);
    const messageResult = results.getByRole('button').filter({ hasText: TARGET_MESSAGE });
    await expect(messageResult).toHaveCount(1);
    await messageResult.click();
    await expect(page.getByRole('log', { name: '訊息列表' })).toContainText(TARGET_MESSAGE);
  });
});
