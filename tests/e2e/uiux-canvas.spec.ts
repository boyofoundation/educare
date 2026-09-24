import { expect, test, type Locator, type Page } from '@playwright/test';

test.use({ video: 'off' });

const DESKTOP_VIEWPORT = { width: 1280, height: 900 };
const DESKTOP_SPLIT_VIEWPORT = { width: 1024, height: 900 };
const RESPONSIVE_VIEWPORTS = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 768, height: 900 },
  { width: 1280, height: 900 },
];

const ASSISTANT_ID = 'e2e-canvas-assistant';
const SESSION_ID = 'e2e-canvas-session';
const PROJECT_ID = 'e2e-canvas-project';
const CURRENT_ARTIFACT_MARKER = 'canvas-current-artifact-marker';
const RESTORED_ARTIFACT_MARKER = 'canvas-restored-artifact-marker';
const UPLOADED_ARTIFACT_MARKER = 'canvas-uploaded-artifact-marker';

type SeedAssistant = {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  ragChunks: [];
  starterPrompts: [];
  createdAt: number;
};

type SeedChatMessage = {
  role: 'user' | 'model';
  content: string;
  timestamp: number;
};

type SeedSession = {
  id: string;
  assistantId: string;
  title: string;
  messages: SeedChatMessage[];
  createdAt: number;
  updatedAt: number;
  tokenCount: number;
  activeProjectId?: string | null;
};

type SeedProject = {
  id: string;
  assistantId: string;
  sessionId: string;
  name: string;
  description: string;
  entryFile: string;
  status: 'draft' | 'ready' | 'error';
  previewVersion: number;
  assetPaths: string[];
  createdAt: number;
  updatedAt: number;
  lastBuildError: null;
};

type SeedProjectFile = {
  projectId: string;
  path: string;
  kind: 'html' | 'css' | 'js' | 'json' | 'svg' | 'asset' | 'md';
  content: string;
  encoding: 'utf-8';
  dependencies: string[];
  size: number;
  updatedAt: number;
};

type SeedSnapshotFileEntry = {
  path: string;
  kind: SeedProjectFile['kind'];
  content: string;
  encoding: 'utf-8';
  dependencies?: string[];
};

type SeedSnapshot = {
  projectId: string;
  version: number;
  files: string[];
  createdAt: number;
  note: string;
  fileEntries: SeedSnapshotFileEntry[];
};

type CanvasSeed = {
  assistant?: SeedAssistant;
  session?: SeedSession;
  project?: SeedProject;
  files?: SeedProjectFile[];
  snapshots?: SeedSnapshot[];
};

const makeAssistant = (overrides: Partial<SeedAssistant> = {}): SeedAssistant => ({
  id: ASSISTANT_ID,
  name: 'Canvas E2E 助理',
  description: '用於 Canvas production flow 驗收的本機助理',
  systemPrompt: 'Answer briefly and clearly.',
  ragChunks: [],
  starterPrompts: [],
  createdAt: 1_700_000_000_000,
  ...overrides,
});

const makeChatMessages = (): SeedChatMessage[] =>
  Array.from({ length: 48 }, (_, index) => ({
    role: index % 2 === 0 ? ('user' as const) : ('model' as const),
    content: `canvas-reading-message-${String(index).padStart(2, '0')}`,
    timestamp: 1_700_000_000_000 + index,
  }));

const makeSession = (overrides: Partial<SeedSession> = {}): SeedSession => ({
  id: SESSION_ID,
  assistantId: ASSISTANT_ID,
  title: 'Canvas E2E 對話',
  messages: makeChatMessages(),
  createdAt: 1_700_000_000_001,
  updatedAt: 1_700_000_000_100,
  tokenCount: 0,
  ...overrides,
});

const makeProject = (overrides: Partial<SeedProject> = {}): SeedProject => ({
  id: PROJECT_ID,
  assistantId: ASSISTANT_ID,
  sessionId: SESSION_ID,
  name: 'Canvas E2E project',
  description: 'Production Canvas flow fixture',
  entryFile: '/index.html',
  status: 'draft',
  previewVersion: 2,
  assetPaths: [],
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_200,
  lastBuildError: null,
  ...overrides,
});

const makeProjectFile = (
  path: string,
  content: string,
  kind: SeedProjectFile['kind'] = path.endsWith('.css') ? 'css' : 'html',
  updatedAt = 1_700_000_000_200,
): SeedProjectFile => ({
  projectId: PROJECT_ID,
  path,
  kind,
  content,
  encoding: 'utf-8',
  dependencies: [],
  size: new TextEncoder().encode(content).length,
  updatedAt,
});

const makeArtifactHtml = (marker: string): string => `<!doctype html>
<html lang="zh-Hant">
  <head><meta charset="UTF-8" /><title>Canvas E2E</title></head>
  <body><main id="artifact-marker">${marker}</main></body>
</html>`;

const makeSnapshot = (overrides: Partial<SeedSnapshot> = {}): SeedSnapshot => ({
  projectId: PROJECT_ID,
  version: 1,
  files: ['/index.html'],
  createdAt: 1_700_000_000_100,
  note: 'checkpoint original',
  fileEntries: [
    {
      path: '/index.html',
      kind: 'html',
      content: makeArtifactHtml(RESTORED_ARTIFACT_MARKER),
      encoding: 'utf-8',
      dependencies: [],
    },
  ],
  ...overrides,
});

const openFreshApp = async (page: Page, viewport = DESKTOP_VIEWPORT): Promise<void> => {
  await page.setViewportSize(viewport);
  await page.goto('./', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#root')).toBeVisible();
  await expect(page.locator('main').first()).toBeVisible();
};

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

const seedCanvasDatabase = async (page: Page, seed: CanvasSeed): Promise<void> => {
  await page.goto('./', { waitUntil: 'domcontentloaded' });
  await page.evaluate(async payload => {
    const assistantDbRequest = window.indexedDB.open('professional-assistant-db', 2);
    await new Promise<void>((resolve, reject) => {
      assistantDbRequest.onupgradeneeded = () => {
        const database = assistantDbRequest.result;
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
      assistantDbRequest.onerror = () =>
        reject(assistantDbRequest.error ?? new Error('Unable to open assistant test DB'));
      assistantDbRequest.onsuccess = () => {
        const database = assistantDbRequest.result;
        const stores = ['assistants', 'sessions'];
        const transaction = database.transaction(stores, 'readwrite');
        if (payload.assistant) {
          transaction.objectStore('assistants').put(payload.assistant);
        }
        if (payload.session) {
          transaction.objectStore('sessions').put(payload.session);
        }
        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
        transaction.onerror = () => {
          database.close();
          reject(transaction.error ?? new Error('Unable to seed assistant test DB'));
        };
        transaction.onabort = () => {
          database.close();
          reject(transaction.error ?? new Error('Assistant test DB seed aborted'));
        };
      };
    });

    if (!payload.project) {
      return;
    }

    const projectDbRequest = window.indexedDB.open('educare-html-projects', 2);
    await new Promise<void>((resolve, reject) => {
      projectDbRequest.onupgradeneeded = () => {
        const database = projectDbRequest.result;
        if (!database.objectStoreNames.contains('htmlProjects')) {
          const projects = database.createObjectStore('htmlProjects', { keyPath: 'id' });
          projects.createIndex('by-assistant', 'assistantId', { unique: false });
          projects.createIndex('by-session', 'sessionId', { unique: false });
          projects.createIndex('by-updated-at', 'updatedAt', { unique: false });
        }
        if (!database.objectStoreNames.contains('htmlProjectFiles')) {
          const files = database.createObjectStore('htmlProjectFiles', {
            keyPath: ['projectId', 'path'],
          });
          files.createIndex('by-project', 'projectId', { unique: false });
          files.createIndex('by-project-updated-at', ['projectId', 'updatedAt'], {
            unique: false,
          });
        }
        if (!database.objectStoreNames.contains('htmlProjectSnapshots')) {
          const snapshots = database.createObjectStore('htmlProjectSnapshots', {
            keyPath: ['projectId', 'version'],
          });
          snapshots.createIndex('by-project', 'projectId', { unique: false });
        }
        if (!database.objectStoreNames.contains('htmlProjectTodos')) {
          const todos = database.createObjectStore('htmlProjectTodos', {
            keyPath: ['projectId', 'id'],
          });
          todos.createIndex('by-project', 'projectId', { unique: false });
          todos.createIndex('by-project-order', ['projectId', 'order'], { unique: false });
        }
      };
      projectDbRequest.onerror = () =>
        reject(projectDbRequest.error ?? new Error('Unable to open Canvas test DB'));
      projectDbRequest.onsuccess = () => {
        const database = projectDbRequest.result;
        const transaction = database.transaction(
          ['htmlProjects', 'htmlProjectFiles', 'htmlProjectSnapshots'],
          'readwrite',
        );
        transaction.objectStore('htmlProjects').put(payload.project);
        for (const file of payload.files ?? []) {
          transaction.objectStore('htmlProjectFiles').put(file);
        }
        for (const snapshot of payload.snapshots ?? []) {
          transaction.objectStore('htmlProjectSnapshots').put(snapshot);
        }
        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
        transaction.onerror = () => {
          database.close();
          reject(transaction.error ?? new Error('Unable to seed Canvas test DB'));
        };
        transaction.onabort = () => {
          database.close();
          reject(transaction.error ?? new Error('Canvas test DB seed aborted'));
        };
      };
    });
  }, seed);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#root')).toBeVisible();
};

const openSettings = async (page: Page): Promise<void> => {
  const menuButton = page.getByRole('button', { name: '開啟選單' });
  if (await menuButton.isVisible().catch(() => false)) {
    await menuButton.click();
    await page
      .getByRole('navigation', { name: '主要導覽' })
      .getByRole('button', { name: '設定', exact: true })
      .click();
    return;
  }
  await page.getByRole('button', { name: '設定', exact: true }).click();
};

const previewFrame = (page: Page) => page.frameLocator('iframe[title="HTML project preview"]');

const visibleMessageIndex = async (chat: Locator): Promise<number> =>
  chat.evaluate(element => {
    const viewport = element.getBoundingClientRect();
    const visibleMessages = Array.from(
      element.querySelectorAll<HTMLElement>('[data-message-index]'),
    )
      .map(node => ({
        index: Number(node.dataset.messageIndex),
        rect: node.getBoundingClientRect(),
      }))
      .filter(({ rect }) => rect.bottom > viewport.top && rect.top < viewport.bottom)
      .sort(
        (left, right) =>
          Math.abs((left.rect.top + left.rect.bottom) / 2 - (viewport.top + viewport.bottom) / 2) -
          Math.abs((right.rect.top + right.rect.bottom) / 2 - (viewport.top + viewport.bottom) / 2),
      );

    return visibleMessages[0]?.index ?? -1;
  });

const assertNoHorizontalOverflow = async (page: Page): Promise<void> => {
  const dimensions = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }));
  expect(
    dimensions.documentWidth,
    `document overflow at ${dimensions.innerWidth}px`,
  ).toBeLessThanOrEqual(dimensions.innerWidth + 1);
  expect(dimensions.bodyWidth, `body overflow at ${dimensions.innerWidth}px`).toBeLessThanOrEqual(
    dimensions.innerWidth + 1,
  );
};

const assertNoOverlappingControls = async (
  controls: Locator[],
  label: string,
  minimumSize = 44,
): Promise<void> => {
  await Promise.all(
    controls.map(control => expect(control, `${label} control should be visible`).toBeVisible()),
  );
  const renderedBounds = await Promise.all(controls.map(control => control.boundingBox()));
  const boxes = renderedBounds.map((bounds, index) => {
    expect(bounds, `${label} control should have a rendered box`).not.toBeNull();
    if (!bounds) {
      throw new Error(`${label} control ${index} has no rendered box`);
    }
    expect(bounds.width, `${label} control width`).toBeGreaterThanOrEqual(minimumSize);
    expect(bounds.height, `${label} control height`).toBeGreaterThanOrEqual(minimumSize);
    return bounds;
  });

  for (let leftIndex = 0; leftIndex < boxes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < boxes.length; rightIndex += 1) {
      const left = boxes[leftIndex];
      const right = boxes[rightIndex];
      const separated =
        left.x + left.width <= right.x + 1 ||
        right.x + right.width <= left.x + 1 ||
        left.y + left.height <= right.y + 1 ||
        right.y + right.height <= left.y + 1;
      expect(
        separated,
        `${label} controls ${leftIndex} and ${rightIndex} overlap: ${JSON.stringify({ left, right })}`,
      ).toBe(true);
    }
  }
};

test.describe('UIUX Canvas production flows @canvas @flows', () => {
  test('creates, edits, opens, closes, and reopens a real Canvas project', async ({ page }) => {
    await blockExternalRequests(page);
    const assistant = makeAssistant();
    const session = makeSession({ messages: [{ ...makeChatMessages()[0] }] });
    await seedCanvasDatabase(page, { assistant, session });
    await openFreshApp(page);

    await page.getByRole('button', { name: '工作區', exact: true }).click();
    const workspaceDialog = page.getByRole('dialog', { name: '工作區' });
    await expect(workspaceDialog).toBeVisible();
    await workspaceDialog.getByRole('button', { name: 'HTML Projects' }).click();
    const picker = page.getByRole('dialog', { name: 'HTML Canvas projects' });
    await expect(picker).toBeVisible();
    await picker.getByRole('button', { name: 'Start new project', exact: true }).click();

    const workspace = page.getByTestId('html-project-workspace');
    await expect(workspace).toBeVisible();
    await expect(previewFrame(page).locator('body')).toContainText('開始建立你的第一個互動原型');

    await workspace.getByRole('button', { name: 'Files', exact: true }).click();
    await expect(workspace).toContainText('index.html');
    await expect(workspace).toContainText('styles.css');
    await expect(workspace).toContainText('main.js');

    const editedHtml = makeArtifactHtml(UPLOADED_ARTIFACT_MARKER);
    await workspace.locator('input[type="file"][multiple]').setInputFiles({
      name: 'index.html',
      mimeType: 'text/html',
      buffer: Buffer.from(editedHtml),
    });
    await workspace.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(previewFrame(page).locator('#artifact-marker')).toContainText(
      UPLOADED_ARTIFACT_MARKER,
    );

    await workspace.getByRole('button', { name: 'Hide' }).click();
    await expect(workspace).toBeHidden();
    await page.getByRole('button', { name: '顯示 HTML Canvas' }).click();
    await expect(page.getByTestId('html-project-workspace')).toBeVisible();
    await expect(previewFrame(page).locator('#artifact-marker')).toContainText(
      UPLOADED_ARTIFACT_MARKER,
    );
  });

  test('restores a Canvas checkpoint while retaining the artifact and chat reading position', async ({
    page,
  }) => {
    await blockExternalRequests(page);
    const assistant = makeAssistant();
    const session = makeSession({ activeProjectId: PROJECT_ID });
    const project = makeProject();
    const currentFile = makeProjectFile('/index.html', makeArtifactHtml(CURRENT_ARTIFACT_MARKER));
    await seedCanvasDatabase(page, {
      assistant,
      session,
      project,
      files: [currentFile],
      snapshots: [makeSnapshot()],
    });
    await openFreshApp(page);

    const workspace = page.getByTestId('html-project-workspace');
    await expect(workspace).toBeVisible();
    await expect(previewFrame(page).locator('#artifact-marker')).toContainText(
      CURRENT_ARTIFACT_MARKER,
    );

    const chat = page.locator('main[aria-label="聊天對話"]');
    await expect(chat).toBeVisible();
    const readingPosition = await chat.evaluate(element => {
      element.scrollTop = Math.round(element.scrollHeight * 0.45);
      return element.scrollTop;
    });
    expect(readingPosition).toBeGreaterThan(0);
    await expect.poll(() => visibleMessageIndex(chat)).toBeGreaterThan(0);
    const readingIndex = await visibleMessageIndex(chat);
    expect(readingIndex).toBeGreaterThan(0);
    const readingMarker = chat.locator(`[data-message-index="${readingIndex}"]`);
    await expect(readingMarker).toBeVisible();

    await workspace.getByRole('button', { name: 'Activity' }).click();
    const revertButton = workspace.getByTestId(/^history-revert-/);
    await expect(revertButton).toHaveCount(1);
    page.once('dialog', dialog => dialog.accept());
    await revertButton.click();
    await workspace.getByRole('button', { name: 'Preview', exact: true }).click();

    await expect(previewFrame(page).locator('#artifact-marker')).toContainText(
      RESTORED_ARTIFACT_MARKER,
    );
    await expect(previewFrame(page).locator('#artifact-marker')).not.toContainText(
      CURRENT_ARTIFACT_MARKER,
    );
    await expect(readingMarker).toBeVisible();
    await expect
      .poll(() => chat.evaluate(element => element.scrollTop))
      .toBeGreaterThan(readingPosition - 24);
    await expect
      .poll(() => chat.evaluate(element => element.scrollTop))
      .toBeLessThan(readingPosition + 24);
  });

  test('keeps project actions in flow without covering the card open action', async ({ page }) => {
    await blockExternalRequests(page);
    const assistant = makeAssistant();
    const session = makeSession({ activeProjectId: PROJECT_ID });
    const project = makeProject();
    await seedCanvasDatabase(page, {
      assistant,
      session,
      project,
      files: [makeProjectFile('/index.html', makeArtifactHtml(CURRENT_ARTIFACT_MARKER))],
    });
    await openFreshApp(page);

    await page.getByRole('button', { name: 'Hide' }).click();
    await expect(page.getByTestId('html-project-workspace')).toBeHidden();
    await page.getByRole('button', { name: '工作區', exact: true }).click();
    const workspaceDialog = page.getByRole('dialog', { name: '工作區' });
    await workspaceDialog.getByRole('button', { name: 'HTML Projects' }).click();

    const picker = page.getByRole('dialog', { name: 'HTML Canvas projects' });
    const card = picker.getByTestId(`project-card-${PROJECT_ID}`);
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: '專案動作選單' }).click();

    const menu = card.getByRole('menu');
    await expect(menu).toBeVisible();
    const menuBounds = await menu.boundingBox();
    const openBounds = await card.getByRole('button', { name: '開啟' }).boundingBox();
    expect(menuBounds).not.toBeNull();
    expect(openBounds).not.toBeNull();
    expect(menuBounds!.y + menuBounds!.height).toBeLessThanOrEqual(openBounds!.y + 1);
    await expect
      .poll(() => menu.evaluate(element => window.getComputedStyle(element).position))
      .toBe('static');
  });

  test('keeps Canvas state reachable and the document within the viewport at all target widths', async ({
    page,
  }) => {
    await blockExternalRequests(page);
    const assistant = makeAssistant();
    const session = makeSession({ activeProjectId: PROJECT_ID });
    const project = makeProject();
    await seedCanvasDatabase(page, {
      assistant,
      session,
      project,
      files: [makeProjectFile('/index.html', makeArtifactHtml(CURRENT_ARTIFACT_MARKER))],
    });
    await openFreshApp(page, RESPONSIVE_VIEWPORTS[0]);
    await expect(previewFrame(page).locator('#artifact-marker')).toContainText(
      CURRENT_ARTIFACT_MARKER,
    );

    for (const viewport of RESPONSIVE_VIEWPORTS) {
      await page.setViewportSize(viewport);
      await page.reload({ waitUntil: 'domcontentloaded' });
      const workspace = page.getByTestId('html-project-workspace');
      await expect(workspace).toBeVisible();
      await expect(previewFrame(page).locator('#artifact-marker')).toContainText(
        CURRENT_ARTIFACT_MARKER,
      );
      await assertNoHorizontalOverflow(page);

      if (viewport.width < 1024) {
        const canvasTab = page.getByRole('tab', { name: '作品' });
        const chatTab = page.getByRole('tab', { name: '聊天' });
        await expect(canvasTab).toHaveAttribute('aria-selected', 'true');
        await chatTab.click();
        await expect(page.locator('main[aria-label="聊天對話"]')).toBeVisible();
        await canvasTab.click();
        await expect(previewFrame(page).locator('#artifact-marker')).toContainText(
          CURRENT_ARTIFACT_MARKER,
        );
      }
    }
  });

  test('keeps workspace controls separated and touchable at compact widths', async ({ page }) => {
    await blockExternalRequests(page);
    const assistant = makeAssistant();
    const session = makeSession({ activeProjectId: PROJECT_ID });
    const project = makeProject();
    await seedCanvasDatabase(page, {
      assistant,
      session,
      project,
      files: [makeProjectFile('/index.html', makeArtifactHtml(CURRENT_ARTIFACT_MARKER))],
    });

    for (const viewport of [
      RESPONSIVE_VIEWPORTS[0],
      RESPONSIVE_VIEWPORTS[1],
      DESKTOP_SPLIT_VIEWPORT,
      DESKTOP_VIEWPORT,
    ]) {
      await page.setViewportSize(viewport);
      await page.reload({ waitUntil: 'domcontentloaded' });

      const workspace = page.getByTestId('html-project-workspace');
      await expect(workspace).toBeVisible();
      await expect(workspace.getByRole('button', { name: 'Files', exact: true })).toContainText(
        '1',
      );
      const toolbar = workspace.getByTestId('preview-toolbar');
      await assertNoOverlappingControls(
        [
          toolbar.getByRole('button', { name: 'Refresh' }),
          toolbar.getByRole('link', { name: 'Open tab' }),
          toolbar.getByRole('button', { name: 'Upload files' }),
          toolbar.getByRole('button', { name: 'Download ZIP' }),
          toolbar.getByRole('button', { name: 'Hide' }),
        ],
        `workspace toolbar at ${viewport.width}px`,
      );

      await assertNoOverlappingControls(
        [
          workspace.getByRole('button', { name: 'Preview', exact: true }),
          workspace.getByRole('button', { name: 'Files', exact: true }),
          workspace.getByRole('button', { name: 'Activity', exact: true }),
        ],
        `workspace tabs at ${viewport.width}px`,
      );

      await assertNoOverlappingControls(
        [
          workspace.getByRole('button', { name: 'Desktop' }),
          workspace.getByRole('button', { name: 'Tablet' }),
          workspace.getByRole('button', { name: 'Mobile' }),
        ],
        `preview viewport controls at ${viewport.width}px`,
      );
    }
  });

  test('keeps provider settings usable without overflow at all target widths', async ({ page }) => {
    await blockExternalRequests(page);
    const assistant = makeAssistant();
    const session = makeSession({ messages: [{ ...makeChatMessages()[0] }] });
    await seedCanvasDatabase(page, { assistant, session });
    await openFreshApp(page, RESPONSIVE_VIEWPORTS[0]);

    for (const viewport of RESPONSIVE_VIEWPORTS) {
      await page.setViewportSize(viewport);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await openSettings(page);
      const settingsPage = page.getByTestId('settings-page');
      await expect(settingsPage).toBeVisible();
      await settingsPage.getByRole('button', { name: /AI 服務商/ }).click();
      await expect(page.getByRole('heading', { name: 'AI 服務商設定' })).toBeVisible();
      await expect(page.locator('body')).toContainText('OpenRouter');
      await assertNoHorizontalOverflow(page);
      if (viewport.width < 1024) {
        await expect(page.getByRole('button', { name: '開啟選單' })).toBeVisible();
      }
    }
  });
});
