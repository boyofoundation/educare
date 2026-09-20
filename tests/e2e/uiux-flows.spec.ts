import { expect, test, type Page } from '@playwright/test';

const APP_ORIGIN = 'http://127.0.0.1:4178';
const DESKTOP_VIEWPORT = { width: 1280, height: 900 };
const TARGET_MESSAGE = 'exact-target-message-aurora';
const PINNED_TITLE = 'Pinned Aurora Lesson';

type SeedAssistant = {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  ragChunks: string[];
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

type SeedBundle = {
  manifest: {
    format: string;
    schemaVersion: number;
    name: string;
    description: string;
    version: string;
    exportedAt: number;
    entryAgentId: string;
  };
  agents: Array<{
    id: string;
    name: string;
    description: string;
    systemPrompt: string;
    starterPrompts: string[];
    ragChunks: string[];
  }>;
  routes: [];
};

type SeedBundleRecord = {
  id: string;
  bundle: SeedBundle;
  importedAt: number;
  sizeBytes: number;
};

type SeedData = {
  assistants: SeedAssistant[];
  sessions: SeedSession[];
  bundles?: SeedBundleRecord[];
};

const MOCK_PROVIDER_SETTINGS = {
  activeProvider: 'openrouter',
  providers: {
    openrouter: {
      enabled: true,
      config: {
        apiKey: 'e2e-fake-key',
        model: 'openai/gpt-4o-mini',
        temperature: 0.2,
        maxTokens: 256,
        maxToolRounds: 2,
      },
    },
  },
};

const makeAssistant = (overrides: Partial<SeedAssistant> = {}): SeedAssistant => ({
  id: 'e2e-local-assistant',
  name: '本機測試助理',
  description: '供 UIUX 端對端測試使用的本機助理',
  systemPrompt: 'You are a concise teaching assistant.',
  ragChunks: [],
  starterPrompts: [],
  createdAt: 1_700_000_000_000,
  ...overrides,
});

const makeSession = (overrides: Partial<SeedSession> = {}): SeedSession => ({
  id: 'e2e-local-session',
  assistantId: 'e2e-local-assistant',
  title: '本機測試對話',
  messages: [
    {
      role: 'user',
      content: 'responsive-state-marker',
      timestamp: 1_700_000_000_001,
    },
  ],
  createdAt: 1_700_000_000_001,
  updatedAt: 1_700_000_000_001,
  tokenCount: 0,
  ...overrides,
});

const makeBundleRecord = (): SeedBundleRecord => ({
  id: 'private-search-bundle',
  bundle: {
    manifest: {
      format: 'educare-agent-bundle',
      schemaVersion: 1,
      name: 'E2E Bundle',
      description: 'A bundle used to verify private search boundaries.',
      version: '1.0.0',
      exportedAt: 1_700_000_000_000,
      entryAgentId: 'bundle-agent',
    },
    agents: [
      {
        id: 'bundle-agent',
        name: 'Bundle Bot',
        description: 'Bundled test agent',
        systemPrompt: 'Answer briefly.',
        starterPrompts: [],
        ragChunks: [],
      },
    ],
    routes: [],
  },
  importedAt: 1_700_000_000_000,
  sizeBytes: 0,
});

const openFreshApp = async (page: Page, viewport = DESKTOP_VIEWPORT): Promise<void> => {
  await page.setViewportSize(viewport);
  // Every test receives a fresh Playwright context. Reloads below deliberately
  // retain that context's storage so they exercise real persistence.
  await page.goto('./', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#root')).toBeVisible();
  await expect(page.locator('main').first()).toBeVisible();
};

const seedDatabase = async (page: Page, seed: SeedData): Promise<void> => {
  // IDB is unavailable on an opaque about:blank origin, so establish the app
  // origin first, then write through the browser's real IndexedDB API.
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
      request.onerror = () => reject(request.error ?? new Error('Unable to open test DB'));
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction(
          ['assistants', 'sessions', 'bundles'],
          'readwrite',
        );
        for (const assistant of payload.assistants) {
          transaction.objectStore('assistants').put(assistant);
        }
        for (const session of payload.sessions) {
          transaction.objectStore('sessions').put(session);
        }
        for (const bundle of payload.bundles ?? []) {
          transaction.objectStore('bundles').put(bundle);
        }
        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
        transaction.onerror = () => {
          database.close();
          reject(transaction.error ?? new Error('Unable to seed test DB'));
        };
        transaction.onabort = () => {
          database.close();
          reject(transaction.error ?? new Error('Test DB seed aborted'));
        };
      };
    });
  }, seed);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#root')).toBeVisible();
};

const readSessionMessageContents = async (page: Page, sessionId: string): Promise<string[]> =>
  page.evaluate(async id => {
    const request = window.indexedDB.open('professional-assistant-db', 2);
    return new Promise<string[]>((resolve, reject) => {
      request.onerror = () => reject(request.error ?? new Error('Unable to read test DB'));
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction('sessions', 'readonly');
        const getRequest = transaction.objectStore('sessions').get(id);
        getRequest.onerror = () => {
          database.close();
          reject(getRequest.error ?? new Error('Unable to read test session'));
        };
        getRequest.onsuccess = () => {
          const session = getRequest.result as
            | { messages?: Array<{ content?: unknown }> }
            | undefined;
          const messages = Array.isArray(session?.messages)
            ? session.messages.map(message =>
                typeof message.content === 'string' ? message.content : '',
              )
            : [];
          database.close();
          resolve(messages);
        };
      };
    });
  }, sessionId);

const installMockProvider = async (page: Page): Promise<{ calls: () => number }> => {
  await page.addInitScript(settings => {
    localStorage.setItem('providerSettings', JSON.stringify(settings));
  }, MOCK_PROVIDER_SETTINGS);

  let callCount = 0;
  await page.route('https://openrouter.ai/api/v1/chat/completions', async route => {
    const corsHeaders = {
      'access-control-allow-headers': 'authorization,content-type,http-referer,x-title',
      'access-control-allow-methods': 'POST,OPTIONS',
      'access-control-allow-origin': '*',
    };
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders });
      return;
    }

    callCount += 1;
    const requestBody = route.request().postDataJSON() as { stream?: unknown } | null;
    if (requestBody?.stream === false) {
      await route.fulfill({
        status: 200,
        headers: {
          ...corsHeaders,
          'content-type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({
          id: 'e2e-completion',
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'Mock stream response from provider.',
              },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 1,
            completion_tokens: 1,
            total_tokens: 2,
          },
        }),
      });
      return;
    }

    const body = [
      'data: {"choices":[{"delta":{"content":"Mock stream response"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" from provider."}}]}\n\n',
      'data: [DONE]\n\n',
    ].join('');
    await route.fulfill({
      status: 200,
      headers: {
        ...corsHeaders,
        'content-type': 'text/event-stream; charset=utf-8',
      },
      body,
    });
  });

  return { calls: () => callCount };
};

const blockExternalRequests = async (page: Page): Promise<void> => {
  await page.route('**/*', async route => {
    const requestUrl = new URL(route.request().url());
    if (
      (requestUrl.protocol === 'http:' || requestUrl.protocol === 'https:') &&
      requestUrl.origin !== APP_ORIGIN
    ) {
      await route.fulfill({ status: 404, body: '' });
      return;
    }
    await route.continue();
  });
};

const makeHundredSessions = (): SeedSession[] => {
  const now = Date.now();
  return Array.from({ length: 100 }, (_, index) => {
    const timestamp = now - index * 1_000;
    return makeSession({
      id: `e2e-session-${String(index).padStart(3, '0')}`,
      title: `Lesson ${String(index).padStart(3, '0')}`,
      messages: [
        {
          role: 'user',
          content: index === 73 ? TARGET_MESSAGE : `ordinary lesson ${index}`,
          timestamp,
        },
        {
          role: 'model',
          content: `response ${index}`,
          timestamp: timestamp + 1,
        },
      ],
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  });
};

const makeThousandMessageSession = (): SeedSession => {
  const now = Date.now();
  return makeSession({
    id: 'e2e-long-history-session',
    title: 'Long virtualized history',
    messages: Array.from({ length: 1_000 }, (_, index) => ({
      role: index % 2 === 0 ? ('user' as const) : ('model' as const),
      content: `long-history-message-${String(index).padStart(4, '0')}`,
      timestamp: now - (1_000 - index),
    })),
    createdAt: now - 1_000,
    updatedAt: now,
  });
};

test.describe('UIUX production flows @flows', () => {
  test('gets from a template to a first mocked chat response in three setup actions', async ({
    page,
  }) => {
    const provider = await installMockProvider(page);
    await openFreshApp(page);

    const dialog = page.getByRole('dialog', { name: '先選用途，再開始備課' });
    await expect(dialog).toBeVisible();

    // Selecting a template, applying it, and saving the assistant are the
    // three setup actions. The provider response is intentionally mocked at
    // the browser boundary, so no live key or external mutation is involved.
    await dialog.getByRole('button', { name: /英文教學/ }).click();
    await dialog.getByRole('button', { name: '套用樣板並開始' }).click();
    const editor = page.getByTestId('assistant-editor');
    await expect(editor).toBeVisible();
    await editor.getByTestId('save-button').click();

    await expect(editor).toBeHidden();
    await expect(page.getByTestId('chat-input-guidance')).toBeHidden({ timeout: 15_000 });
    const composer = page.getByRole('textbox', { name: '輸入訊息' });
    await composer.fill('請給我一個英文暖身活動');
    await page.getByRole('button', { name: '傳送訊息' }).click();

    const log = page.getByRole('log', { name: '訊息列表' });
    await expect(log).toContainText('請給我一個英文暖身活動');
    await expect(log).toContainText('Mock stream response from provider.');
    expect(provider.calls()).toBe(1);
  });

  test('assistant save failure keeps the draft and exposes a retryable error', async ({ page }) => {
    await page.addInitScript(() => {
      const browserWindow = window as Window & { __e2eFailAssistantWrites?: boolean };
      browserWindow.__e2eFailAssistantWrites = true;
      const storePrototype = window.IDBObjectStore.prototype;
      const originalPut = storePrototype.put;
      storePrototype.put = function put(value: unknown, key?: globalThis.IDBValidKey) {
        if (browserWindow.__e2eFailAssistantWrites && this.name === 'assistants') {
          throw new window.DOMException('Quota exceeded', 'QuotaExceededError');
        }
        return key === undefined
          ? originalPut.call(this, value)
          : originalPut.call(this, value, key);
      };
    });
    await openFreshApp(page);

    const dialog = page.getByRole('dialog', { name: '先選用途，再開始備課' });
    await dialog.getByRole('button', { name: /數學教學/ }).click();
    await dialog.getByRole('button', { name: '套用樣板並開始' }).click();

    const editor = page.getByTestId('assistant-editor');
    const nameField = editor.locator('#name');
    await expect(nameField).toHaveValue('數學教學');
    await editor.getByTestId('save-button').click();

    const failure = editor.getByRole('alert');
    await expect(failure).toContainText('保存失敗');
    await expect(failure).toContainText('請重試');
    await expect(nameField).toHaveValue('數學教學');
    await expect(editor.getByTestId('assistant-save-status')).not.toContainText('已保存於這台裝置');

    await page.evaluate(() => {
      (window as Window & { __e2eFailAssistantWrites?: boolean }).__e2eFailAssistantWrites = false;
    });
    await editor.getByTestId('save-button').click();
    await expect(editor).toBeHidden();
    await expect(page.locator('main').first()).toBeVisible();
  });

  test('finds an exact message among 100 sessions and persists rename and pin on reload', async ({
    page,
  }) => {
    await seedDatabase(page, {
      assistants: [makeAssistant()],
      sessions: makeHundredSessions(),
    });

    const searchTrigger = page.getByTestId('sidebar-search-toggle');
    await expect(searchTrigger).toBeVisible();
    await searchTrigger.click();
    const searchInput = page.getByRole('searchbox');
    await searchInput.fill(TARGET_MESSAGE);

    const results = page.getByTestId('navigation-search-results');
    await expect(results).toBeVisible();
    await expect(results.getByRole('button')).toHaveCount(1);
    await expect(results).toContainText(TARGET_MESSAGE);
    await results.getByRole('button').click();
    await expect(page.getByRole('log', { name: '訊息列表' })).toContainText(TARGET_MESSAGE);

    const oldTitle = 'Lesson 073';
    const targetRow = page.locator('div[role="button"]').filter({ hasText: oldTitle }).first();
    await expect(targetRow).toBeVisible();
    await targetRow.getByRole('button', { name: `重新命名聊天 ${oldTitle}` }).click();
    // While editing, the title lives in the input value, not row textContent.
    const renameInput = page.getByRole('textbox', { name: `重新命名聊天 ${oldTitle}` });
    await renameInput.fill(PINNED_TITLE);
    await renameInput.press('Enter');
    const renamedRow = page.locator('div[role="button"]').filter({ hasText: PINNED_TITLE }).first();
    await expect(renamedRow).toContainText(PINNED_TITLE);

    const pinButton = renamedRow.getByRole('button', { name: `置頂 ${PINNED_TITLE}` });
    await pinButton.click();
    await expect(
      renamedRow.getByRole('button', { name: `取消置頂 ${PINNED_TITLE}` }),
    ).toHaveAttribute('aria-pressed', 'true');

    await page.reload({ waitUntil: 'domcontentloaded' });
    const persistedRow = page
      .locator('div[role="button"]')
      .filter({ hasText: PINNED_TITLE })
      .first();
    await expect(persistedRow).toBeVisible();
    await expect(
      persistedRow.getByRole('button', { name: `取消置頂 ${PINNED_TITLE}` }),
    ).toHaveAttribute('aria-pressed', 'true');
    await persistedRow.getByText(PINNED_TITLE, { exact: true }).click();
    await expect(page.getByRole('log', { name: '訊息列表' })).toContainText(TARGET_MESSAGE);
  });

  test('shared and bundled views do not expose private local search', async ({ page }) => {
    await blockExternalRequests(page);
    await seedDatabase(page, {
      assistants: [makeAssistant()],
      sessions: [
        makeSession({
          title: 'Private local session',
          messages: [
            {
              role: 'user',
              content: 'private-only-marker',
              timestamp: 1_700_000_000_002,
            },
          ],
        }),
      ],
      bundles: [makeBundleRecord()],
    });

    await page.goto('./?share=missing-shared-assistant', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('sidebar-search-toggle')).toHaveCount(0);
    await expect(page.getByRole('searchbox')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('private-only-marker');

    await page.goto('./?bundle=private-search-bundle', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#root')).toBeVisible();
    await expect(page.getByTestId('sidebar-search-toggle')).toHaveCount(0);
    await expect(page.getByRole('searchbox')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('private-only-marker');
  });

  test('keeps local shell within each target viewport and retains seeded chat state', async ({
    page,
  }) => {
    await seedDatabase(page, {
      assistants: [makeAssistant()],
      sessions: [makeSession()],
    });

    for (const viewport of [
      { width: 360, height: 800 },
      { width: 390, height: 844 },
      { width: 768, height: 900 },
      DESKTOP_VIEWPORT,
    ]) {
      await page.setViewportSize(viewport);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.locator('#root')).toBeVisible();
      await expect
        .poll(
          () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
          { timeout: 10_000 },
        )
        .toBe(true);
      await expect(page.getByRole('log', { name: '訊息列表' })).toContainText(
        'responsive-state-marker',
      );
    }
  });

  test('virtualized 1000-message history reaches top, middle, and bottom without a forced jump', async ({
    page,
  }) => {
    const provider = await installMockProvider(page);
    await seedDatabase(page, {
      assistants: [makeAssistant()],
      sessions: [makeThousandMessageSession()],
    });

    await expect(page.getByTestId('chat-input-guidance')).toBeHidden({ timeout: 15_000 });
    const chatMain = page.getByRole('main', { name: '聊天對話' });
    const message = (index: number) => chatMain.locator(`[data-message-index="${index}"]`);
    const visibleMessageIndex = async (): Promise<number> =>
      chatMain.evaluate(element => {
        const containerRect = element.getBoundingClientRect();
        const visibleMessage = Array.from(element.querySelectorAll('[data-message-index]')).find(
          candidate => {
            const rect = candidate.getBoundingClientRect();
            return rect.bottom > containerRect.top && rect.top < containerRect.bottom;
          },
        );
        return Number(visibleMessage?.getAttribute('data-message-index') ?? -1);
      });

    await chatMain.evaluate(element => element.scrollTo({ top: 0, behavior: 'auto' }));
    await expect(message(0)).toBeVisible();
    await expect(message(0)).toContainText('long-history-message-0000');
    await expect.poll(() => chatMain.locator('[data-message-index]').count()).toBeLessThan(200);

    await chatMain.evaluate(element =>
      element.scrollTo({ top: element.scrollHeight / 2, behavior: 'auto' }),
    );
    await expect.poll(visibleMessageIndex).toBeGreaterThan(100);
    const middleIndex = await visibleMessageIndex();
    expect(middleIndex).toBeLessThan(900);
    await expect(message(middleIndex)).toBeVisible();
    await expect(message(middleIndex)).toContainText(
      `long-history-message-${String(middleIndex).padStart(4, '0')}`,
    );
    const middleScrollTop = await chatMain.evaluate(element => element.scrollTop);

    const composer = page.getByRole('textbox', { name: '輸入訊息' });
    await composer.fill('append-after-reading-history');
    await page.getByRole('button', { name: '傳送訊息' }).click();
    // The user message is appended before the provider finishes. Assert the
    // reader's existing viewport remains anchored at that moment.
    await expect(message(middleIndex)).toBeVisible();
    const duringAppendScrollTop = await chatMain.evaluate(element => element.scrollTop);
    expect(Math.abs(duringAppendScrollTop - middleScrollTop)).toBeLessThan(300);

    // The appended response is outside the virtual window while reading history.
    // Verify completion in IndexedDB before scrolling down to inspect its DOM.
    await expect.poll(provider.calls).toBeGreaterThan(0);

    await expect
      .poll(
        async () => {
          const contents = await readSessionMessageContents(page, 'e2e-long-history-session');
          return {
            count: contents.length,
            tail: contents.slice(-2),
          };
        },
        { timeout: 15_000 },
      )
      .toEqual({
        count: 1_002,
        tail: ['append-after-reading-history', 'Mock stream response from provider.'],
      });

    // A response appended at the bottom must not pull a reader away from the
    // middle of the existing history when they were not already at the bottom.
    await expect(message(middleIndex)).toBeVisible();
    const afterAppendScrollTop = await chatMain.evaluate(element => element.scrollTop);
    expect(Math.abs(afterAppendScrollTop - middleScrollTop)).toBeLessThan(300);

    await chatMain.evaluate(element =>
      element.scrollTo({ top: element.scrollHeight, behavior: 'auto' }),
    );
    await expect(page.getByRole('log', { name: '訊息列表' })).toContainText(
      'Mock stream response from provider.',
    );
    await expect(message(1_001)).toBeVisible();
  });
});
