/* global IDBDatabase, indexedDB */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const APP_URL = 'http://127.0.0.1:4182/educare/';
const PRACTICE_DB = 'educare-practice-workspace';
const PRIMARY_PROFILE_ID = 'f5-profile-primary';
const SECONDARY_PROFILE_ID = 'f5-profile-secondary';
const PRIMARY_PROFILE_NAME = 'F5 Primary';
const SECONDARY_PROFILE_NAME = 'F5 Empty';
const ACTIVE_PROFILE_KEY = 'educare.practice.active-profile';
const LESSON_TITLES = {
  english: 'F5 deterministic English',
  math: 'F5 deterministic Math',
  science: 'F5 deterministic Science',
} as const;

const BLOCKED_EXTERNAL_HOST =
  /(?:openai|openrouter|anthropic|googleapis|generativelanguage|turso|libsql|supabase)/i;

type FixtureProfile = {
  id: string;
  displayName: string;
  anonymous: true;
  createdAt: number;
  updatedAt: number;
};

type FixtureLesson = {
  id: string;
  schemaVersion: 1;
  version: 1;
  title: string;
  gradeLevel: string;
  subject: 'english' | 'math' | 'science';
  templateId: string;
  topic: string;
  learningObjectives: string[];
  lessonPlan: string;
  questions: Array<{
    id: string;
    schemaVersion: 1;
    prompt: string;
    type: 'choice' | 'fill' | 'free-response';
    options?: string[];
    answer?: string;
    acceptedAnswers?: string[];
    explanation: string;
    sources: Array<{
      id: string;
      title: string;
      status: 'verified' | 'unverified';
      locator: string;
    }>;
    schemaValid: true;
  }>;
  sources: [];
  ownerProfileId: string;
  generatedBy: 'teacher';
  createdAt: number;
  updatedAt: number;
};

const primaryProfile: FixtureProfile = {
  id: PRIMARY_PROFILE_ID,
  displayName: PRIMARY_PROFILE_NAME,
  anonymous: true,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
};

const secondaryProfile: FixtureProfile = {
  id: SECONDARY_PROFILE_ID,
  displayName: SECONDARY_PROFILE_NAME,
  anonymous: true,
  createdAt: 1_700_000_000_001,
  updatedAt: 1_700_000_000_001,
};

const source = (id: string, title: string, locator: string) => ({
  id,
  title,
  status: 'verified' as const,
  locator,
});

const lesson = (
  subject: FixtureLesson['subject'],
  id: string,
  title: string,
  topic: string,
  templateId: string,
  choicePrompt: string,
  options: string[],
  answer: string,
  fillPrompt: string,
  fillAnswer: string,
  freePrompt: string,
  timestamp: number,
): FixtureLesson => ({
  id,
  schemaVersion: 1,
  version: 1,
  title,
  gradeLevel: '國小五年級',
  subject,
  templateId,
  topic,
  learningObjectives: ['辨識核心概念', '用一句話說明自己的理解'],
  lessonPlan: `F5 deterministic lesson plan for ${subject}.`,
  questions: [
    {
      id: `${id}-choice`,
      schemaVersion: 1,
      prompt: choicePrompt,
      type: 'choice',
      options,
      answer,
      explanation: `The deterministic answer is ${answer}.`,
      sources: [source(`${id}-source-choice`, `${subject} teacher guide`, 'fixture-1')],
      schemaValid: true,
    },
    {
      id: `${id}-fill`,
      schemaVersion: 1,
      prompt: fillPrompt,
      type: 'fill',
      answer: fillAnswer,
      acceptedAnswers: [fillAnswer],
      explanation: `The deterministic fill answer is ${fillAnswer}.`,
      sources: [source(`${id}-source-fill`, `${subject} workbook`, 'fixture-2')],
      schemaValid: true,
    },
    {
      id: `${id}-free`,
      schemaVersion: 1,
      prompt: freePrompt,
      type: 'free-response',
      explanation: 'This response remains marked for teacher review.',
      sources: [source(`${id}-source-free`, `${subject} activity`, 'fixture-3')],
      schemaValid: true,
    },
  ],
  sources: [],
  ownerProfileId: PRIMARY_PROFILE_ID,
  generatedBy: 'teacher',
  createdAt: timestamp,
  updatedAt: timestamp,
});

const fixtureLessons: FixtureLesson[] = [
  lesson(
    'english',
    'f5-lesson-english',
    LESSON_TITLES.english,
    '日常情境字彙',
    'tpl_english_teaching',
    'Which word means「開心的」?',
    ['happy', 'quiet', 'small'],
    'happy',
    'Complete the sentence: I ___ a student.',
    'am',
    'Write one short sentence using “school”.',
    1_700_000_010_000,
  ),
  lesson(
    'math',
    'f5-lesson-math',
    LESSON_TITLES.math,
    '分數與等值分數',
    'tpl_math_teaching',
    '2 + 3 = ?',
    ['4', '5', '6'],
    '5',
    '一半用分數表示是 __。',
    '1/2',
    '請用一句話說明為什麼 2/4 和 1/2 相等。',
    1_700_000_020_000,
  ),
  lesson(
    'science',
    'f5-lesson-science',
    LESSON_TITLES.science,
    '水的三態變化',
    'tpl_teaching_guidance',
    '冰塊融化後會變成哪一種狀態?',
    ['固態', '液態', '氣態'],
    '液態',
    '水煮沸產生的水蒸氣屬於 __ 態。',
    '氣',
    '請舉一個生活中水蒸氣遇冷的例子。',
    1_700_000_030_000,
  ),
];

async function prepareContext(context: BrowserContext): Promise<string[]> {
  const blockedRequests: string[] = [];
  await context.addInitScript(
    ({ activeProfileKey, primaryProfileId }) => {
      localStorage.setItem(
        'educare:onboarding-preferences',
        JSON.stringify({ completed: true, dismissed: true }),
      );
      if (!localStorage.getItem(activeProfileKey)) {
        localStorage.setItem(activeProfileKey, primaryProfileId);
      }
    },
    { activeProfileKey: ACTIVE_PROFILE_KEY, primaryProfileId: PRIMARY_PROFILE_ID },
  );
  await context.route('**/*', async route => {
    const requestUrl = route.request().url();
    let parsed: URL;
    try {
      parsed = new URL(requestUrl);
    } catch {
      blockedRequests.push(requestUrl);
      await route.abort();
      return;
    }
    if (
      BLOCKED_EXTERNAL_HOST.test(parsed.hostname) ||
      !['127.0.0.1', 'localhost'].includes(parsed.hostname)
    ) {
      blockedRequests.push(requestUrl);
      await route.abort();
      return;
    }
    await route.continue();
  });
  return blockedRequests;
}

async function seedPracticeDatabase(page: Page): Promise<void> {
  await page.evaluate(
    ({ dbName, primary, secondary, lessons }) =>
      new Promise<void>((resolve, reject) => {
        const opening = indexedDB.open(dbName, 1);
        opening.onupgradeneeded = () => {
          const database = opening.result;
          if (!database.objectStoreNames.contains('profiles')) {
            database.createObjectStore('profiles', { keyPath: 'id' });
          }
          if (!database.objectStoreNames.contains('lessons')) {
            const store = database.createObjectStore('lessons', { keyPath: 'id' });
            store.createIndex('by-profile', 'ownerProfileId');
          }
          if (!database.objectStoreNames.contains('attempts')) {
            const store = database.createObjectStore('attempts', { keyPath: 'id' });
            store.createIndex('by-profile', 'profileId');
            store.createIndex('by-lesson', 'lessonId');
          }
          if (!database.objectStoreNames.contains('bookmarks')) {
            const store = database.createObjectStore('bookmarks', { keyPath: 'id' });
            store.createIndex('by-profile', 'profileId');
            store.createIndex('by-lesson', 'lessonId');
          }
          if (!database.objectStoreNames.contains('imports')) {
            database.createObjectStore('imports', { keyPath: 'token' });
          }
        };
        opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
          const database = opening.result as IDBDatabase;
          const transaction = database.transaction(
            ['profiles', 'lessons', 'attempts', 'bookmarks', 'imports'],
            'readwrite',
          );
          transaction.objectStore('profiles').put(primary);
          transaction.objectStore('profiles').put(secondary);
          for (const fixture of lessons) {
            transaction.objectStore('lessons').put(fixture);
          }
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.onerror = () => {
            database.close();
            reject(transaction.error);
          };
        };
      }),
    {
      dbName: PRACTICE_DB,
      primary: primaryProfile,
      secondary: secondaryProfile,
      lessons: fixtureLessons,
    },
  );
}

async function openPractice(page: Page): Promise<void> {
  if (page.url() === 'about:blank') {
    await page.goto(APP_URL);
  }
  const workspace = page.getByTestId('practice-workspace');
  if (!(await workspace.isVisible().catch(() => false))) {
    const menu = page.getByRole('button', { name: '開啟選單' });
    if (await menu.isVisible().catch(() => false)) {
      await menu.click();
    }
    await page.getByRole('button', { name: '備課與練習', exact: true }).click();
  }
  await expect(workspace).toBeVisible();
  await expect(page.getByRole('button', { name: '產生題組預覽' })).toBeEnabled();
}

function library(page: Page) {
  return page.locator('section[aria-labelledby="practice-library-heading"]');
}

async function expectAllSubjectLessons(page: Page): Promise<void> {
  const lessons = library(page);
  await expect(lessons.getByRole('button', { name: LESSON_TITLES.english })).toBeVisible();
  await expect(lessons.getByRole('button', { name: LESSON_TITLES.math })).toBeVisible();
  await expect(lessons.getByRole('button', { name: LESSON_TITLES.science })).toBeVisible();
  await expect(lessons.getByRole('button')).toHaveCount(3);
}

async function enterLesson(page: Page, title: string): Promise<void> {
  const lessons = library(page);
  await lessons.getByRole('button', { name: title }).click();
  await page.getByRole('button', { name: '開始練習', exact: true }).click();
  await expect(page.getByRole('heading', { name: `練習：${title}` })).toBeVisible();
}

test('F5 practice subjects, profile isolation, progress and full-backup restore', async ({
  browser,
  page,
  context,
}) => {
  // playwright.functionality.config.ts runs this acceptance in headless Chromium and WebKit.
  const blockedRequests = await prepareContext(context);
  await page.goto(APP_URL);
  await seedPracticeDatabase(page);
  await openPractice(page);

  const profileSelect = page.locator('#practice-profile');
  await expect(profileSelect).toHaveValue(PRIMARY_PROFILE_ID);
  await expectAllSubjectLessons(page);

  await profileSelect.selectOption(SECONDARY_PROFILE_ID);
  await expect(profileSelect).toHaveValue(SECONDARY_PROFILE_ID);
  await expect(library(page).getByRole('button')).toHaveCount(0);
  await expect(page.getByText('先建立一份題組預覽。')).toBeVisible();

  await profileSelect.selectOption(PRIMARY_PROFILE_ID);
  await expectAllSubjectLessons(page);
  // Exercise local grading with the browser genuinely offline, not merely with
  // external provider requests intercepted. Cold offline reload is covered by
  // the dedicated Service Worker acceptance suite.
  await context.setOffline(true);
  for (const fixture of fixtureLessons) {
    await enterLesson(page, fixture.title);
    const activeLesson = page.locator('section[aria-labelledby="practice-active-heading"]');
    await activeLesson
      .getByRole('radio', { name: fixture.questions[0].answer, exact: true })
      .check();
    await activeLesson.getByRole('button', { name: '送出答案', exact: true }).first().click();
    await expect(activeLesson.locator('article').first().getByRole('status')).toHaveText(
      '答對了。',
    );
  }
  await context.setOffline(false);

  // A reload must retain the selected profile and the recorded answer in IndexedDB.
  await page.reload();
  await openPractice(page);
  await expect(profileSelect).toHaveValue(PRIMARY_PROFILE_ID);
  for (const fixture of fixtureLessons) {
    await enterLesson(page, fixture.title);
    await expect(
      page
        .locator('section[aria-labelledby="practice-active-heading"]')
        .locator('article')
        .first()
        .getByRole('status'),
    ).toHaveText('答對了。');
  }

  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '匯出完整備份', exact: true }).click();
  const download = await downloading;
  expect(await download.failure()).toBeNull();
  const backupPath = await download.path();
  expect(backupPath).not.toBeNull();
  const backupBytes = await readFile(backupPath!);

  const restoredContext = await browser.newContext({ serviceWorkers: 'block' });
  try {
    const restoredBlockedRequests = await prepareContext(restoredContext);
    const restoredPage = await restoredContext.newPage();
    await restoredPage.goto(APP_URL);
    await openPractice(restoredPage);
    await restoredPage
      .getByTestId('practice-workspace')
      .locator('input[type="file"]')
      .setInputFiles({
        name: 'educare-practice-backup.json',
        mimeType: 'application/json',
        buffer: backupBytes,
      });
    await expect(restoredPage.getByTestId('practice-workspace').getByRole('status')).toContainText(
      /匯入完成：新增 3 份教案/,
    );
    await restoredPage.reload();
    await openPractice(restoredPage);

    const restoredProfileSelect = restoredPage.locator('#practice-profile');
    await restoredProfileSelect.selectOption({ label: PRIMARY_PROFILE_NAME });
    const restoredPrimaryProfileId = await restoredProfileSelect.inputValue();
    await expectAllSubjectLessons(restoredPage);
    for (const fixture of fixtureLessons) {
      await enterLesson(restoredPage, fixture.title);
      await expect(
        restoredPage
          .locator('section[aria-labelledby="practice-active-heading"]')
          .locator('article')
          .first()
          .getByRole('status'),
      ).toHaveText('答對了。');
    }

    await restoredProfileSelect.selectOption({ label: SECONDARY_PROFILE_NAME });
    await expect(restoredPage.locator('#practice-profile')).not.toHaveValue(
      restoredPrimaryProfileId,
    );
    await expect(library(restoredPage).getByRole('button')).toHaveCount(0);

    await restoredProfileSelect.selectOption({ label: PRIMARY_PROFILE_NAME });
    await restoredPage.reload();
    await openPractice(restoredPage);
    await expect(restoredPage.locator('#practice-profile')).toHaveValue(restoredPrimaryProfileId);
    await expectAllSubjectLessons(restoredPage);

    expect(restoredBlockedRequests).toEqual([]);
  } finally {
    await restoredContext.close();
  }

  expect(blockedRequests).toEqual([]);
});
