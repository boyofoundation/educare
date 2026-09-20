/* global indexedDB, IDBDatabase */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { AgentRunCheckpoint, ChatSession } from '../../types';

const APP_URL = 'http://127.0.0.1:4182/educare/';
const API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const SESSION_ID = 'f6-local-session';
const SECRET = 'f6-fixture-secret-never-export';
const PRIVATE_MESSAGE = 'f6-private-lesson-content';
const RESPONSE = 'F6 deterministic provider response.';

async function prepare(context: BrowserContext) {
  await context.addInitScript(secret => {
    localStorage.setItem('educare:onboarding-preferences', JSON.stringify({ completed: true }));
    localStorage.setItem(
      'providerSettings',
      JSON.stringify({
        activeProvider: 'openrouter',
        providers: {
          openrouter: {
            enabled: true,
            config: {
              apiKey: secret,
              model: 'openai/gpt-4o-mini',
              temperature: 0.2,
              maxTokens: 256,
            },
          },
        },
      }),
    );
  }, SECRET);
  await context.route('**/*', async route => {
    if (new URL(route.request().url()).origin === new URL(APP_URL).origin) {
      await route.continue();
    } else {
      await route.abort();
    }
  });
}

function provider(
  context: BrowserContext,
  options: { failFirst?: boolean; holdFirst?: Promise<void> } = {},
) {
  let calls = 0;
  const ready = context.route(API_URL, async route => {
    const headers = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization,content-type,http-referer,x-title',
      'access-control-allow-methods': 'POST,OPTIONS',
    };
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers });
      return;
    }
    calls += 1;
    if (calls === 1 && options.holdFirst) {
      await options.holdFirst;
    }
    if (calls === 1 && options.failFirst) {
      await route.fulfill({
        status: 429,
        headers,
        json: { error: { message: 'fixture rate limit', code: 'rate_limit_exceeded' } },
      });
      return;
    }
    const usage = { prompt_tokens: 7, completion_tokens: 4, total_tokens: 11 };
    const body = route.request().postDataJSON() as { stream?: boolean };
    if (body.stream === false) {
      await route.fulfill({
        status: 200,
        headers,
        json: {
          choices: [
            { index: 0, message: { role: 'assistant', content: RESPONSE }, finish_reason: 'stop' },
          ],
          usage,
        },
      });
      return;
    }
    await route.fulfill({
      status: 200,
      headers: { ...headers, 'content-type': 'text/event-stream' },
      body:
        `data: ${JSON.stringify({ choices: [{ delta: { content: RESPONSE } }] })}\n\n` +
        `data: ${JSON.stringify({ choices: [], usage })}\n\ndata: [DONE]\n\n`,
    });
  });
  return { ready, calls: () => calls };
}

async function seed(page: Page, checkpoint?: AgentRunCheckpoint) {
  await page.goto(APP_URL);
  await expect(page.getByRole('button', { name: '打包協作包', exact: true })).toBeVisible();
  await page.evaluate(
    async ({ sessionId, privateMessage, checkpoint }) => {
      const open = (name: string, version: number) =>
        new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open(name, version);
          request.onupgradeneeded = () => {
            if (name === 'agent-run-checkpoints') {
              const store = request.result.createObjectStore('checkpoints', { keyPath: 'runId' });
              store.createIndex('by-session', 'sessionId');
            } else {
              const database = request.result;
              database.createObjectStore('assistants', { keyPath: 'id' });
              database
                .createObjectStore('sessions', { keyPath: 'id' })
                .createIndex('by-assistant', 'assistantId');
              database.createObjectStore('bundles', { keyPath: 'id' });
            }
          };
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      const db = await open('professional-assistant-db', 2);
      const tx = db.transaction(['assistants', 'sessions'], 'readwrite');
      tx.objectStore('assistants').put({
        id: 'f6-assistant',
        name: 'F6 本機助理',
        description: 'local fixture',
        systemPrompt: 'Answer briefly.',
        ragChunks: [],
        starterPrompts: [],
        createdAt: 1,
      });
      tx.objectStore('sessions').put({
        id: sessionId,
        assistantId: 'f6-assistant',
        title: 'F6 續跑測試',
        messages: [{ role: 'user', content: privateMessage, timestamp: 1 }],
        createdAt: 1,
        updatedAt: 1,
        tokenCount: checkpoint ? 100 : 0,
        ...(checkpoint
          ? {
              tokenUsage: {
                source: 'api',
                totals: { inputTokens: 70, outputTokens: 30, totalTokens: 100 },
                lastUpdatedAt: 1,
                unavailableTurns: 0,
              },
            }
          : {}),
      });
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
      if (checkpoint) {
        const checkpointDb = await open('agent-run-checkpoints', 1);
        const checkpointTx = checkpointDb.transaction('checkpoints', 'readwrite');
        checkpointTx.objectStore('checkpoints').put(checkpoint);
        await new Promise<void>((resolve, reject) => {
          checkpointTx.oncomplete = () => resolve();
          checkpointTx.onerror = () => reject(checkpointTx.error);
        });
        checkpointDb.close();
      }
    },
    { sessionId: SESSION_ID, privateMessage: PRIVATE_MESSAGE, checkpoint },
  );
  await page.reload();
  await expect(page.getByRole('textbox', { name: '輸入訊息' })).toBeVisible();
}

async function readSession(page: Page): Promise<ChatSession> {
  return page.evaluate(
    sessionId =>
      new Promise((resolve, reject) => {
        const opening = indexedDB.open('professional-assistant-db', 2);
        opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
          const db = opening.result;
          const request = db.transaction('sessions').objectStore('sessions').get(sessionId);
          request.onsuccess = () => {
            db.close();
            resolve(request.result);
          };
          request.onerror = () => {
            db.close();
            reject(request.error);
          };
        };
      }),
    SESSION_ID,
  );
}

async function send(page: Page, message: string) {
  await page.getByRole('textbox', { name: '輸入訊息' }).fill(message);
  await page.getByRole('button', { name: '傳送訊息', exact: true }).click();
}

async function expectLatestResponse(page: Page) {
  const response = page.getByText(RESPONSE, { exact: true }).first();
  const jump = page.getByRole('button', { name: '捲動至最新訊息' });
  // IndexedDB can be ready before React/Virtuoso mounts after reload. Wait for
  // the actual user-visible navigation state before deciding whether to scroll.
  await expect
    .poll(async () => (await response.isVisible()) || (await jump.isVisible()))
    .toBe(true);
  if (!(await response.isVisible())) {
    await jump.click();
  }
  await expect(page.getByRole('log', { name: '訊息列表' })).toContainText(RESPONSE);
}

test('F6 retryable 429 survives reload and persists actual usage after explicit continuation', async ({
  page,
  context,
}) => {
  await prepare(context);
  const mock = provider(context, { failFirst: true });
  await mock.ready;
  await seed(page);
  await send(page, PRIVATE_MESSAGE);
  await expect(page.getByTestId('resume-run-banner')).toBeVisible();
  expect(mock.calls()).toBe(1);
  await page.reload();
  const banner = page.getByTestId('resume-run-banner');
  await expect(banner).toBeVisible();
  await banner.getByRole('button', { name: '繼續', exact: true }).click();
  await expect
    .poll(async () =>
      (await readSession(page)).messages.some(
        message => message.role === 'model' && message.content === RESPONSE,
      ),
    )
    .toBe(true);
  await expectLatestResponse(page);
  await expect.poll(async () => (await readSession(page)).tokenUsage?.totals?.totalTokens).toBe(11);
  expect(mock.calls()).toBe(2);
  await page.reload();
  await expect
    .poll(async () =>
      (await readSession(page)).messages.some(
        message => message.role === 'model' && message.content === RESPONSE,
      ),
    )
    .toBe(true);
  await expectLatestResponse(page);
  expect((await readSession(page)).tokenUsage?.totals?.totalTokens).toBe(11);
  await expect(banner).toBeHidden();
});

test('F6 paused budget remains inspectable after reload, diagnostics are redacted, and only an extended budget resumes', async ({
  page,
  context,
}) => {
  await prepare(context);
  const mock = provider(context);
  await mock.ready;
  const checkpoint: AgentRunCheckpoint = {
    schemaVersion: 1,
    runId: 'f6-paused-run',
    sessionId: SESSION_ID,
    assistantId: 'f6-assistant',
    projectId: null,
    status: 'paused',
    turnIndex: 0,
    maxTurns: 5,
    originalMessage: PRIVATE_MESSAGE,
    committedHistoryDelta: [],
    partialText: '',
    toolTrace: [],
    inFlightToolCallIds: [],
    tokenTotals: { promptTokenCount: 70, candidatesTokenCount: 30 },
    agentHarnessEnabled: false,
    htmlProjectEnabled: false,
    projectBootstrapEnabled: false,
    sharedMode: false,
    budget: { maxTurns: 5, maxToolCalls: 30, maxTokens: 100 },
    budgetUsage: {
      turns: 0,
      toolCalls: 0,
      toolCallsKnown: true,
      tokens: 100,
      estimatedTokens: false,
    },
    pauseReason: 'budget',
    failure: { stage: 'budget', code: 'token-budget', retryable: true },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    heartbeatAt: Date.now(),
  };
  await seed(page, checkpoint);
  const banner = page.getByTestId('resume-run-banner');
  await expect(banner.getByRole('button', { name: '繼續', exact: true })).toBeDisabled();
  expect(mock.calls()).toBe(0);
  const controls = page.getByTestId('agent-run-controls');
  if (!(await controls.isVisible())) {
    await page.locator('details').filter({ has: controls }).locator('summary').click();
  }
  const downloading = page.waitForEvent('download');
  await controls.getByRole('button', { name: '下載去敏診斷檔', exact: true }).click();
  const download = await downloading;
  const diagnostics = await readFile((await download.path())!, 'utf8');
  expect(diagnostics).not.toContain(SECRET);
  expect(diagnostics).not.toContain(PRIVATE_MESSAGE);
  expect(JSON.parse(diagnostics)).toBeTruthy();
  await page.getByLabel('Token 上限', { exact: true }).fill('1000');
  await expect(banner.getByRole('button', { name: '繼續', exact: true })).toBeEnabled();
  await banner.getByRole('button', { name: '繼續', exact: true }).click();
  await expect(page.getByRole('log', { name: '訊息列表' })).toContainText(RESPONSE);
  expect(mock.calls()).toBe(1);
  await expect
    .poll(async () => (await readSession(page)).tokenUsage?.totals?.totalTokens)
    .toBe(111);
});

test('F6 two pages in one workspace cannot send concurrent runs and can retry after release', async ({
  page,
  context,
}) => {
  await prepare(context);
  let release!: () => void;
  const held = new Promise<void>(resolve => {
    release = resolve;
  });
  const mock = provider(context, { holdFirst: held });
  await mock.ready;
  await seed(page);
  const second = await context.newPage();
  try {
    await second.goto(APP_URL);
    await expect(second.getByRole('textbox', { name: '輸入訊息' })).toBeVisible();
    await send(page, 'first page holds workspace run');
    await expect.poll(mock.calls).toBe(1);
    await send(second, 'second page must wait');
    await expect(second.getByRole('alert')).toContainText(/其他分頁|另一個分頁|工作區.*執行/);
    expect(mock.calls()).toBe(1);
    release();
    await expect(page.getByRole('log', { name: '訊息列表' })).toContainText(RESPONSE);
    await send(second, 'second page retries after release');
    await expect(second.getByRole('log', { name: '訊息列表' })).toContainText(RESPONSE);
    expect(mock.calls()).toBe(2);
  } finally {
    release();
    await second.close();
  }
});
