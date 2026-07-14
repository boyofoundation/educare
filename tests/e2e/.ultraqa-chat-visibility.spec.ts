import { expect, test } from '@playwright/test';

const assistant = {
  id: 'ultraqa-assistant',
  name: 'UltraQA Assistant',
  description: 'Deterministic chat visibility probe',
  systemPrompt: 'Reply with the exact text requested by the test.',
  ragChunks: [],
  starterPrompts: [],
  mathToolsEnabled: true,
  createdAt: 1700000000000,
};

const session = {
  id: 'ultraqa-session',
  assistantId: assistant.id,
  title: 'New Chat',
  messages: [],
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
  tokenCount: 0,
};

const speechAssistant = {
  ...assistant,
  id: 'ultraqa-speech-assistant',
  name: 'UltraQA Speech Assistant',
  mathToolsEnabled: undefined,
  webSpeechToolsEnabled: true,
};

const providerSettings = {
  activeProvider: 'openrouter',
  providers: {
    gemini: { enabled: false, config: { model: 'gemini-2.5-flash' } },
    openai: { enabled: false, config: { model: 'gpt-4o' } },
    anthropic: { enabled: false, config: { model: 'claude-opus-4-8' } },
    ollama: {
      enabled: false,
      config: { baseUrl: 'http://localhost:11434', model: 'llama3.2:latest' },
    },
    groq: { enabled: false, config: { model: 'llama-3.1-70b-versatile' } },
    openrouter: {
      enabled: true,
      config: { apiKey: 'ultraqa-test-key', model: 'openai/gpt-4o-mini', maxTokens: 64 },
    },
    lmstudio: {
      enabled: false,
      config: { baseUrl: 'http://localhost:1234/v1', model: 'local-model' },
    },
  },
};

const seedDatabase = async (
  page: import('@playwright/test').Page,
  assistantRecord = assistant,
  sessionRecord = { ...session, assistantId: assistantRecord.id },
) => {
  await page.evaluate(
    async ({ assistantRecord, sessionRecord, settings }) => {
      localStorage.setItem('providerSettings', JSON.stringify(settings));
      await new Promise<void>((resolve, reject) => {
        const request = window.indexedDB.open('professional-assistant-db', 2);
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains('assistants')) {
            database.createObjectStore('assistants', { keyPath: 'id' });
          }
          if (!database.objectStoreNames.contains('sessions')) {
            const store = database.createObjectStore('sessions', { keyPath: 'id' });
            store.createIndex('by-assistant', 'assistantId');
          }
          if (!database.objectStoreNames.contains('bundles')) {
            database.createObjectStore('bundles', { keyPath: 'id' });
          }
        };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction(['assistants', 'sessions'], 'readwrite');
          transaction.objectStore('assistants').put(assistantRecord);
          transaction.objectStore('sessions').put(sessionRecord);
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      });
    },
    { assistantRecord, sessionRecord, settings: providerSettings },
  );
};

test('keeps the first streamed answer visible without navigating away', async ({ page }) => {
  test.setTimeout(30000);

  await page.route('https://openrouter.ai/api/v1/models', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [] }),
    });
  });
  await page.route('https://openrouter.ai/api/v1/chat/completions', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [
          { message: { role: 'assistant', content: 'ULTRAQA first answer remains visible' } },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 4, total_tokens: 9 },
      }),
    });
  });

  await page.goto('/educare/seed');
  await seedDatabase(page);
  await page.reload();
  await expect(page.locator('h2').filter({ hasText: assistant.name })).toBeVisible();

  const input = page.getByRole('textbox', { name: '輸入訊息' });
  await input.fill('First question');
  await page.getByRole('button', { name: '傳送訊息' }).click();

  await expect(page.getByText('First question', { exact: true })).toBeVisible();
  await expect(page.getByText('ULTRAQA first answer remains visible', { exact: true })).toBeVisible(
    {
      timeout: 10000,
    },
  );

  const logText = await page.getByRole('log', { name: '訊息列表' }).innerText();
  expect(logText).toContain('First question');
  expect(logText).toContain('ULTRAQA first answer remains visible');
});

test('keeps the answer and geometry board visible after a math tool round', async ({ page }) => {
  let requestCount = 0;
  await page.route('https://openrouter.ai/api/v1/models', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [] }),
    });
  });
  await page.route('https://openrouter.ai/api/v1/chat/completions', async route => {
    requestCount += 1;
    const response =
      requestCount === 1
        ? {
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: null,
                  tool_calls: [
                    {
                      id: 'geometry-call-1',
                      type: 'function',
                      function: {
                        name: 'draw_geometry',
                        arguments: JSON.stringify({
                          title: 'Triangle',
                          boundingbox: [0, 5, 5, 0],
                          objects: [
                            { id: 'A', kind: 'point', x: 1, y: 1, label: 'A' },
                            { id: 'B', kind: 'point', x: 4, y: 1, label: 'B' },
                            { id: 'C', kind: 'point', x: 2, y: 4, label: 'C' },
                          ],
                        }),
                      },
                    },
                  ],
                },
              },
            ],
          }
        : {
            choices: [
              {
                message: { role: 'assistant', content: 'ULTRAQA geometry answer remains visible' },
              },
            ],
          };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(response),
    });
  });

  await page.goto('/educare/seed');
  await seedDatabase(page);
  await page.reload();
  await expect(page.locator('h2').filter({ hasText: assistant.name })).toBeVisible();
  await page.getByRole('textbox', { name: '輸入訊息' }).fill('Draw a triangle');
  await page.getByRole('button', { name: '傳送訊息' }).click();

  await expect(
    page.getByText('ULTRAQA geometry answer remains visible', { exact: true }),
  ).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('Triangle', { exact: true })).toBeVisible({ timeout: 10000 });
  expect(requestCount).toBe(2);
});

test('keeps the answer and speech card visible after a speak_text tool round', async ({ page }) => {
  let requestCount = 0;
  await page.route('https://openrouter.ai/api/v1/models', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [] }),
    });
  });
  await page.route('https://openrouter.ai/api/v1/chat/completions', async route => {
    requestCount += 1;
    const response =
      requestCount === 1
        ? {
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: null,
                  tool_calls: [
                    {
                      id: 'speech-call-1',
                      type: 'function',
                      function: {
                        name: 'speak_text',
                        arguments: JSON.stringify({
                          text: 'Good morning',
                          language: 'en-US',
                          title: 'Greeting practice',
                          note: 'Stress the first syllable in morning.',
                        }),
                      },
                    },
                  ],
                },
              },
            ],
          }
        : {
            choices: [
              { message: { role: 'assistant', content: 'ULTRAQA speech answer remains visible' } },
            ],
          };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(response),
    });
  });

  await page.goto('/educare/seed');
  await seedDatabase(page, speechAssistant);
  await page.reload();
  await expect(page.locator('h2').filter({ hasText: speechAssistant.name })).toBeVisible();
  await page.getByRole('textbox', { name: '輸入訊息' }).fill('Practice this greeting');
  await page.getByRole('button', { name: '傳送訊息' }).click();

  await expect(
    page.getByText('ULTRAQA speech answer remains visible', { exact: true }),
  ).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('Greeting practice', { exact: true })).toBeVisible({
    timeout: 10000,
  });
  await expect(page.getByText('Good morning', { exact: true })).toBeVisible();
  expect(requestCount).toBe(2);
});
