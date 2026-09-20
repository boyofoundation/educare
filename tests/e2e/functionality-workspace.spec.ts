/* global IDBDatabase, IDBObjectStore, indexedDB, DOMException */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import {
  parseWorkspaceArchive,
  type ParsedWorkspaceArchive,
} from '../../services/workspaceArchiveService';
import type { WorkspaceProjectArchiveRecord } from '../../services/workspaceProjectArchiveProvider';
import type { WorkspaceDraftArchiveEntry } from '../../services/workspaceDraftService';
import type {
  PracticeProfile,
  PracticeLesson,
  PracticeAttempt,
  PracticeBookmark,
} from '../../services/practiceWorkspaceService';
import {
  ARCHIVE_SECRET_MARKER,
  createWorkspaceAcceptanceFixture,
  hashBytes,
} from './support/workspaceArchiveFixture';

const APP_URL = 'http://127.0.0.1:4182/educare/';

async function prepareContext(context: BrowserContext, externalRequests: string[]): Promise<void> {
  await context.addInitScript(() => {
    localStorage.setItem(
      'educare:onboarding-preferences',
      JSON.stringify({ completed: true, dismissed: true }),
    );
  });
  await context.route('**/*', async route => {
    if (!['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname)) {
      externalRequests.push(route.request().url());
      await route.abort();
    } else {
      await route.continue();
    }
  });
}

async function openManagement(page: Page): Promise<void> {
  if (page.url() === 'about:blank') {
    await page.goto(APP_URL);
  }
  const menu = page.getByRole('button', { name: '開啟選單' });
  if (await menu.isVisible()) {
    await menu.click();
  }
  const workspaceDialog = page.getByRole('dialog', { name: '工作區' });
  await page.getByRole('button', { name: '工作區', exact: true }).click();
  await expect(workspaceDialog).toBeVisible();
  await workspaceDialog.getByRole('button', { name: '資料管理', exact: true }).click();
  await expect(workspaceDialog).toBeHidden();
  await expect(page.getByRole('button', { name: '選擇工作區備份檔', exact: true })).toBeEnabled();
  const navigation = await page
    .getByRole('navigation', { name: '主要導覽', exact: true })
    .boundingBox();
  const panel = await page.getByTestId('workspace-data-management').boundingBox();
  expect(panel!.x).toBeGreaterThanOrEqual(navigation!.x + navigation!.width);
}

async function previewArchive(page: Page, bytes: Uint8Array): Promise<void> {
  await page.getByLabel('選擇 EduCare 工作區備份檔').setInputFiles({
    name: 'workspace-fixture.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from(bytes),
  });
  await expect(page.getByTestId('workspace-import-preview')).toBeVisible();
}

async function importArchive(page: Page, bytes: Uint8Array): Promise<void> {
  await previewArchive(page, bytes);
  await page.getByRole('button', { name: '確認以副本匯入', exact: true }).click();
  await expect(page.getByTestId('workspace-data-management')).toBeHidden({ timeout: 60_000 });
}

async function downloadArchive(page: Page): Promise<ParsedWorkspaceArchive> {
  await openManagement(page);
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '匯出工作區備份', exact: true }).click();
  const download = await downloading;
  expect(await download.failure()).toBeNull();
  const savedPath = await download.path();
  expect(savedPath).not.toBeNull();
  return parseWorkspaceArchive(new Uint8Array(await readFile(savedPath!)));
}

function verifyWorkspace(
  archive: ParsedWorkspaceArchive,
  expected: Awaited<ReturnType<typeof createWorkspaceAcceptanceFixture>>,
): void {
  const { assistants = [], sessions = [], bundles = [], checkpoints = [] } = archive.records;
  const projects = archive.records.projects as WorkspaceProjectArchiveRecord[];
  expect(assistants).toHaveLength(3);
  expect(sessions).toHaveLength(100);
  expect(assistants.flatMap(assistant => assistant.ragChunks ?? [])).toHaveLength(20);
  expect(projects).toHaveLength(5);
  expect(bundles).toHaveLength(2);
  expect(checkpoints).toHaveLength(1);
  const assistantIds = new Set(assistants.map(assistant => assistant.id));
  const sessionIds = new Set(sessions.map(session => session.id));
  const projectIds = new Set(projects.map(project => project.id));
  const assistantMap = new Map(
    expected.source.assistants!.map(original => [
      original.id,
      assistants.find(item => item.name === original.name)!.id,
    ]),
  );
  const sessionMap = new Map(
    expected.source.sessions!.map(original => [
      original.id,
      sessions.find(item => item.title === original.title)!.id,
    ]),
  );
  const projectMap = new Map(
    expected.projects.map(original => [
      original.id,
      projects.find(item => item.project.name === original.project.name)!.id,
    ]),
  );
  for (const mapping of [assistantMap, sessionMap, projectMap]) {
    expect(new Set(mapping.values()).size).toBe(mapping.size);
    for (const [oldId, newId] of mapping) {
      expect(newId).not.toBe(oldId);
    }
  }
  for (const assistant of assistants) {
    for (const target of assistant.routableAssistantIds ?? []) {
      expect(assistantIds.has(target)).toBe(true);
    }
    const original = expected.source.assistants!.find(item => item.name === assistant.name)!;
    expect(assistant.routableAssistantIds).toEqual(
      original.routableAssistantIds?.map(id => assistantMap.get(id)),
    );
    expect(assistant.ragChunks).toEqual(original.ragChunks);
    expect(assistant.systemPrompt).toBe(original.systemPrompt);
  }
  for (const session of sessions) {
    expect(assistantIds.has(session.assistantId)).toBe(true);
    if (session.activeProjectId) {
      expect(projectIds.has(session.activeProjectId)).toBe(true);
    }
    const original = expected.source.sessions!.find(item => item.title === session.title)!;
    expect(session.assistantId).toBe(assistantMap.get(original.assistantId));
    if (original.activeProjectId) {
      expect(session.activeProjectId).toBe(projectMap.get(original.activeProjectId));
    }
    expect(session.messages).toEqual(original.messages);
  }
  for (const project of projects) {
    expect(projectIds.has(project.project.id)).toBe(true);
    expect(assistantIds.has(project.project.assistantId)).toBe(true);
    expect(sessionIds.has(project.project.sessionId!)).toBe(true);
    const original = expected.projects.find(item => item.project.name === project.project.name)!;
    expect(project.project.id).toBe(project.id);
    expect(project.project.assistantId).toBe(assistantMap.get(original.project.assistantId));
    expect(project.project.sessionId).toBe(sessionMap.get(original.project.sessionId!));
    for (const snapshot of project.snapshots) {
      expect(snapshot.projectId).toBe(project.id);
    }
    for (const todo of project.todos) {
      expect(todo.projectId).toBe(project.id);
    }
    expect(project.repository.headOid).toBe(original.repository.headOid);
    const fingerprints = (record: WorkspaceProjectArchiveRecord) =>
      record.repository.entries
        .map(entry => [entry.path, hashBytes(entry.data)])
        .sort((a, b) => a[0].localeCompare(b[0]));
    expect(fingerprints(project)).toEqual(fingerprints(original));
    expect(project.snapshots.map(snapshot => snapshot.oid)).toEqual(
      expect.arrayContaining(original.snapshots.map(snapshot => snapshot.oid.slice(0, 7))),
    );
    expect(project.todos.map(todo => todo.title)).toEqual(original.todos.map(todo => todo.title));
  }
  for (const checkpoint of checkpoints) {
    expect(assistantIds.has(checkpoint.assistantId)).toBe(true);
    expect(sessionIds.has(checkpoint.sessionId)).toBe(true);
    const original = expected.source.checkpoints!.find(
      item => item.originalMessage === checkpoint.originalMessage,
    )!;
    expect(checkpoint.runId).not.toBe(original.runId);
    expect(checkpoint.assistantId).toBe(assistantMap.get(original.assistantId));
    expect(checkpoint.sessionId).toBe(sessionMap.get(original.sessionId));
    expect(checkpoint.projectId).toBe(
      original.projectId ? projectMap.get(original.projectId) : null,
    );
  }
  const drafts = archive.records.drafts as WorkspaceDraftArchiveEntry[];
  expect(drafts).toHaveLength(1);
  expect(drafts[0].value).toBe('fixture-unsent-draft');
  expect(drafts[0].ownerId).toBe(
    `${assistantMap.get(expected.source.assistants![0].id)}:${sessionMap.get(expected.source.sessions![0].id)}`,
  );
  const practice = archive.records.practice as Array<{
    id: string;
    sourceId: string;
    kind: string;
    value: PracticeProfile | PracticeLesson | PracticeAttempt | PracticeBookmark;
  }>;
  expect(practice).toHaveLength(4);
  const profile = practice.find(row => row.kind === 'profile')!.value as PracticeProfile;
  const lesson = practice.find(row => row.kind === 'lesson')!.value as PracticeLesson;
  const attempt = practice.find(row => row.kind === 'attempt')!.value as PracticeAttempt;
  const bookmark = practice.find(row => row.kind === 'bookmark')!.value as PracticeBookmark;
  expect(profile.displayName).toBe('備份練習者');
  expect(lesson.ownerProfileId).toBe(profile.id);
  expect(lesson.questions).toHaveLength(3);
  expect(attempt.profileId).toBe(profile.id);
  expect(attempt.lessonId).toBe(lesson.id);
  expect(attempt.questionId).toBe(lesson.questions[0].id);
  expect(attempt.result.status).toBe('correct');
  expect(bookmark.profileId).toBe(profile.id);
  expect(bookmark.lessonId).toBe(lesson.id);
  expect(bookmark.questionId).toBe(lesson.questions[0].id);
  for (const bundle of bundles) {
    const original = expected.source.bundles!.find(
      item => item.bundle.manifest.name === bundle.bundle.manifest.name,
    )!;
    expect(bundle.id).not.toBe(original.id);
    expect(bundle.bundle.encryptedProviderSettings).toBeUndefined();
  }
  expect(archive.manifest.excludedFields).toContain('encryptedProviderSettings');
  const uncompressed = Object.values(archive.entries)
    .map(bytes => Buffer.from(bytes).toString('utf8'))
    .join('\n');
  expect(uncompressed).not.toContain(ARCHIVE_SECRET_MARKER);
}

test('full workspace ZIP survives production import, reload and a fresh browser context', async ({
  page,
  context,
  browser,
}) => {
  const externalRequests: string[] = [];
  await prepareContext(context, externalRequests);
  const fixture = await createWorkspaceAcceptanceFixture();
  await openManagement(page);
  await previewArchive(page, fixture.bytes);
  // Choosing a file does not authorize persistence.
  expect(
    await page.evaluate(async () => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const opening = indexedDB.open('professional-assistant-db');
        opening.onsuccess = () => resolve(opening.result);
        opening.onerror = () => reject(opening.error);
      });
      try {
        return await new Promise<number>((resolve, reject) => {
          const count = database.transaction('assistants').objectStore('assistants').count();
          count.onsuccess = () => resolve(count.result);
          count.onerror = () => reject(count.error);
        });
      } finally {
        database.close();
      }
    }),
  ).toBe(0);
  await page.getByRole('button', { name: '取消匯入', exact: true }).click();
  await importArchive(page, fixture.bytes);
  await page.reload();
  const first = await downloadArchive(page);
  verifyWorkspace(first, fixture);
  const fresh = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    serviceWorkers: 'block',
  });
  try {
    await prepareContext(fresh, externalRequests);
    const secondPage = await fresh.newPage();
    await openManagement(secondPage);
    await importArchive(secondPage, first.bytes);
    await secondPage.reload();
    const second = await downloadArchive(secondPage);
    verifyWorkspace(second, fixture);
    expect(
      second.records.assistants!.some(assistant =>
        first.records.assistants!.some(original => original.id === assistant.id),
      ),
    ).toBe(false);
    for (const category of ['sessions', 'projects', 'bundles', 'checkpoints'] as const) {
      const ids = (records: typeof first.records) =>
        (records[category] ?? []).map(record => ('runId' in record ? record.runId : record.id));
      const firstIds = new Set(ids(first.records));
      expect(ids(second.records).some(id => firstIds.has(id))).toBe(false);
    }
  } finally {
    await fresh.close();
  }
  expect(
    externalRequests.filter(url =>
      /turso|\/chat\/completions|generativelanguage|api\.anthropic/.test(url),
    ),
  ).toEqual([]);
});

test('a store quota failure stays hidden and can be recovered after reload without replacing existing data', async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    const faultWindow = window as typeof window & {
      workspaceArchiveFault?: { armed: boolean; failed: boolean };
    };
    faultWindow.workspaceArchiveFault = { armed: false, failed: false };
    // Install before idb caches its bound native methods. Fail one project
    // stage and keep the primary rollback blocked until a fresh page load.
    const originalAdd = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (...args: Parameters<IDBObjectStore['add']>) {
      const fault = faultWindow.workspaceArchiveFault!;
      if (fault.armed && !fault.failed && this.name === 'htmlProjects') {
        fault.failed = true;
        throw new DOMException('fixture quota', 'QuotaExceededError');
      }
      return originalAdd.apply(this, args);
    };
    const originalDelete = IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete = function (...args: Parameters<IDBObjectStore['delete']>) {
      if (faultWindow.workspaceArchiveFault?.failed && this.name === 'assistants') {
        throw new DOMException('fixture rollback unavailable until reload', 'UnknownError');
      }
      return originalDelete.apply(this, args);
    };
  });
  await prepareContext(context, []);
  const fixture = await createWorkspaceAcceptanceFixture();
  await openManagement(page);
  await importArchive(page, fixture.bytes);
  await openManagement(page);
  await page.evaluate(() => {
    Object.assign(window, { workspaceArchiveFault: { armed: true, failed: false } });
  });
  await previewArchive(page, fixture.bytes);
  await page.getByRole('button', { name: '確認以副本匯入', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('匯入');
  await page.reload();
  await openManagement(page);
  await expect(page.locator('[data-testid^="workspace-recovery-"]')).toHaveCount(1);
  verifyWorkspace(await downloadArchive(page), fixture);
  await page.getByRole('button', { name: /^回復並清理匯入 / }).click();
  await expect(page.getByTestId('workspace-data-management')).toBeHidden();
  verifyWorkspace(await downloadArchive(page), fixture);
  await expect(page.locator('[data-testid^="workspace-recovery-"]')).toHaveCount(0);
});

test('a failed import can explicitly resume from its journal after reload', async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    let failedThisPage = false;
    const originalAdd = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (...args: Parameters<IDBObjectStore['add']>) {
      if (this.name === 'htmlProjects' && !sessionStorage.getItem('workspace-quota-fired')) {
        sessionStorage.setItem('workspace-quota-fired', 'true');
        failedThisPage = true;
        throw new DOMException('fixture first-import quota', 'QuotaExceededError');
      }
      return originalAdd.apply(this, args);
    };
    const originalDelete = IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete = function (...args: Parameters<IDBObjectStore['delete']>) {
      if (failedThisPage && this.name === 'assistants') {
        throw new DOMException('fixture cleanup unavailable until reload', 'UnknownError');
      }
      return originalDelete.apply(this, args);
    };
  });
  await prepareContext(context, []);
  const fixture = await createWorkspaceAcceptanceFixture();
  await openManagement(page);
  await previewArchive(page, fixture.bytes);
  await page.getByRole('button', { name: '確認以副本匯入', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('匯入');
  await page.reload();
  await openManagement(page);
  await expect(page.locator('[data-testid^="workspace-recovery-"]')).toHaveCount(1);
  await page.getByRole('button', { name: /^繼續匯入 / }).click();
  await expect(page.getByTestId('workspace-data-management')).toBeHidden();
  verifyWorkspace(await downloadArchive(page), fixture);
  await expect(page.locator('[data-testid^="workspace-recovery-"]')).toHaveCount(0);
});
