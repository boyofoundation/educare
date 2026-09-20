import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __closePracticeStoreForTesting,
  __resetPracticeStoreForTesting,
  createPracticeLessonDraft,
  createPracticeProfile,
  deletePracticeBookmark,
  deletePracticeLesson,
  deletePracticeProfile,
  exportPracticeArchive,
  exportPracticeJson,
  exportPracticeTeachingShare,
  getPracticeArchiveImport,
  getPracticeReviewQueue,
  getPracticeLesson,
  importPracticeArchive,
  listPracticeAttempts,
  listPracticeArchiveRecordIds,
  listPracticeBookmarks,
  listPracticeLessons,
  listPracticeProfiles,
  PRACTICE_DB_NAME,
  PRACTICE_DB_VERSION,
  PRACTICE_SUBJECTS,
  publishPracticeImportedRecords,
  recordPracticeAttempt,
  removePracticeImportedRecords,
  savePracticeBookmark,
  savePracticeProfile,
  savePracticeLesson,
  type PracticeArchiveRecords,
  type PracticeExportEnvelope,
} from './practiceWorkspaceService';
import { WORKSPACE_ARCHIVE_IMPORT_ID_FIELD, markWorkspaceArchiveImportPublished } from './db';
import {
  __resetWorkspaceOperationServiceForTesting,
  beginWorkspaceOperation,
} from './workspaceOperationService';
import { workspacePracticeArchiveProvider } from './workspacePracticeArchiveProvider';

const deleteRawPracticeLesson = async (lessonId: string): Promise<void> => {
  const request = globalThis.indexedDB.open(PRACTICE_DB_NAME, PRACTICE_DB_VERSION);
  const db = await new Promise<typeof request.result>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('lessons', 'readwrite');
    transaction.objectStore('lessons').delete(lessonId);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
};

const updateRawPracticeLesson = async (
  lessonId: string,
  update: (lesson: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> => {
  const request = globalThis.indexedDB.open(PRACTICE_DB_NAME, PRACTICE_DB_VERSION);
  const db = await new Promise<typeof request.result>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('lessons', 'readwrite');
    const store = transaction.objectStore('lessons');
    const getRequest = store.get(lessonId);
    getRequest.onsuccess = () => {
      const lesson = getRequest.result as Record<string, unknown> | undefined;
      if (!lesson) {
        reject(new Error(`Missing lesson ${lessonId}`));
        return;
      }
      store.put(update(lesson));
    };
    getRequest.onerror = () => reject(getRequest.error);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
};

const deleteRawPracticeImportLog = async (importId: string): Promise<void> => {
  const request = globalThis.indexedDB.open(PRACTICE_DB_NAME, PRACTICE_DB_VERSION);
  const db = await new Promise<typeof request.result>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('imports', 'readwrite');
    transaction.objectStore('imports').delete(importId);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
};

const cloneArchive = (archive: PracticeExportEnvelope): PracticeExportEnvelope =>
  JSON.parse(JSON.stringify(archive)) as PracticeExportEnvelope;

describe('practiceWorkspaceService', () => {
  beforeEach(async () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => values.set(key, value)),
      removeItem: vi.fn((key: string) => values.delete(key)),
      clear: vi.fn(() => values.clear()),
    });
    await __resetPracticeStoreForTesting();
  });

  afterEach(async () => {
    await __resetPracticeStoreForTesting();
    __resetWorkspaceOperationServiceForTesting();
    vi.unstubAllGlobals();
  });

  it('generates valid mock fixtures for all three supported subjects', async () => {
    const profile = await createPracticeProfile('Fixture teacher');
    const lessons = PRACTICE_SUBJECTS.map(subject =>
      createPracticeLessonDraft({
        profileId: profile.id,
        gradeLevel: '國小五年級',
        subject,
        topic: '',
        learningObjectives: '能辨識核心概念',
      }),
    );

    for (const lesson of lessons) {
      expect(lesson.questions).toHaveLength(3);
      expect(lesson.schemaValid).toBe(true);
      await savePracticeLesson(lesson);
    }

    await expect(listPracticeLessons(profile.id)).resolves.toHaveLength(3);
  });

  it('keeps attempts, mistakes, and bookmarks isolated between local anonymous profiles', async () => {
    const first = await createPracticeProfile('本機 A');
    const second = await createPracticeProfile('本機 B');
    const lesson = createPracticeLessonDraft({
      profileId: first.id,
      gradeLevel: '國小五年級',
      subject: 'math',
      topic: '分數',
      learningObjectives: ['能辨識等值分數'],
    });
    await savePracticeLesson(lesson);

    const question = lesson.questions[0];
    await recordPracticeAttempt({
      profileId: first.id,
      lessonId: lesson.id,
      questionId: question.id,
      response: 'wrong',
      now: Date.parse('2026-01-01T00:00:00Z'),
    });
    await savePracticeBookmark(first.id, lesson.id, question.id);

    await expect(listPracticeAttempts(first.id)).resolves.toHaveLength(1);
    await expect(listPracticeBookmarks(first.id)).resolves.toHaveLength(1);
    await expect(listPracticeAttempts(second.id)).resolves.toHaveLength(0);
    await expect(listPracticeBookmarks(second.id)).resolves.toHaveLength(0);
    await expect(listPracticeLessons(second.id)).resolves.toHaveLength(0);

    const review = await getPracticeReviewQueue(first.id, Date.parse('2026-01-03T00:00:00Z'));
    expect(review.some(item => item.reason === 'mistake')).toBe(true);
  });

  it('survives a store close/reopen and imports a full backup with copied IDs', async () => {
    const profile = await createPracticeProfile('Original');
    const lesson = createPracticeLessonDraft({
      profileId: profile.id,
      gradeLevel: '國中七年級',
      subject: 'science',
      topic: '水的三態',
      learningObjectives: '能辨識三態變化',
    });
    await savePracticeLesson(lesson);
    await recordPracticeAttempt({
      profileId: profile.id,
      lessonId: lesson.id,
      questionId: lesson.questions[0].id,
      response: 'wrong',
    });

    await __closePracticeStoreForTesting();
    await expect(getPracticeLesson(lesson.id)).resolves.toEqual(
      expect.objectContaining({ id: lesson.id }),
    );

    const archive = await exportPracticeArchive();
    await __resetPracticeStoreForTesting();
    const imported = await importPracticeArchive(archive);

    expect(imported.copiedIds.profileIds[0]).not.toBe(profile.id);
    expect(imported.copiedIds.lessonIds[0]).not.toBe(lesson.id);
    expect(imported.copiedIds.attemptIds).toHaveLength(1);
    await expect(listPracticeProfiles()).resolves.toHaveLength(1);
    await expect(listPracticeLessons(imported.copiedIds.profileIds[0])).resolves.toHaveLength(1);
    await expect(listPracticeAttempts(imported.copiedIds.profileIds[0])).resolves.toHaveLength(1);
  });

  it('exports all practice stores through one token-scoped readonly transaction', async () => {
    const profile = await createPracticeProfile('Token export');
    await savePracticeLesson(
      createPracticeLessonDraft({
        profileId: profile.id,
        gradeLevel: '國小',
        subject: 'english',
        topic: '字彙',
        learningObjectives: '能辨識字義',
      }),
    );

    const operation = await beginWorkspaceOperation('export');
    try {
      await expect(
        exportPracticeArchive({ operationToken: operation.operationToken }),
      ).resolves.toMatchObject({
        records: expect.objectContaining({
          profiles: expect.any(Array),
          lessons: expect.any(Array),
        }),
      });
    } finally {
      operation.release();
    }
  });

  it('never grades a schema-invalid question and keeps unverified source provenance explicit', async () => {
    const profile = await createPracticeProfile();
    const lesson = createPracticeLessonDraft({
      profileId: profile.id,
      gradeLevel: '國小',
      subject: 'english',
      topic: '字彙',
      learningObjectives: '能辨識字義',
    });
    const invalidLesson = {
      ...lesson,
      questions: [
        {
          ...lesson.questions[0],
          options: ['only one option'],
          answer: 'missing',
        },
      ],
    };
    await savePracticeLesson(invalidLesson);
    const attempt = await recordPracticeAttempt({
      profileId: profile.id,
      lessonId: lesson.id,
      questionId: lesson.questions[0].id,
      response: 'missing',
    });

    expect(attempt.attempt.result.status).toBe('ungraded-invalid');
    expect(attempt.attempt.result.score).toBeNull();
    expect(attempt.question.sources[0].status).toBe('unverified');
  });

  it('keeps default teaching exports private and excludes attempts/profile data', async () => {
    const profile = await createPracticeProfile('Private local label');
    const lesson = createPracticeLessonDraft({
      profileId: profile.id,
      gradeLevel: '國小',
      subject: 'english',
      topic: '字彙',
      learningObjectives: '能辨識字義',
    });
    await savePracticeLesson(lesson);
    await recordPracticeAttempt({
      profileId: profile.id,
      lessonId: lesson.id,
      questionId: lesson.questions[0].id,
      response: 'wrong',
    });

    const text = await exportPracticeJson('teaching-share', profile.id);
    expect(text).toContain('teaching-share');
    expect(text).toContain(lesson.title);
    expect(text).not.toContain('attempts');
    expect(text).not.toContain('bookmarks');
    expect(text).not.toContain('profileId');
    expect(text).not.toContain('Private local label');
  });

  it('rejects incomplete backup collections and incomplete attempt/result schemas before staging', async () => {
    const profile = await createPracticeProfile('Schema source');
    const lesson = createPracticeLessonDraft({
      profileId: profile.id,
      gradeLevel: '國小',
      subject: 'english',
      topic: '字彙',
      learningObjectives: '能辨識字義',
    });
    await savePracticeLesson(lesson);
    await recordPracticeAttempt({
      profileId: profile.id,
      lessonId: lesson.id,
      questionId: lesson.questions[0].id,
      response: 'wrong',
    });
    const archive = await exportPracticeArchive();

    const incomplete = cloneArchive(archive);
    delete (incomplete.records as unknown as Record<string, unknown>).bookmarks;
    await expect(importPracticeArchive(incomplete)).rejects.toThrow('完整備份缺少 bookmarks');

    const invalidResult = cloneArchive(archive);
    const attempt = (invalidResult.records as PracticeArchiveRecords)
      .attempts[0] as unknown as Record<string, unknown>;
    const result = attempt.result as Record<string, unknown>;
    delete result.feedbackMode;
    await expect(importPracticeArchive(invalidResult)).rejects.toThrow('attempt 資料格式錯誤');
  });

  it('rejects duplicate question IDs and duplicate planned destination IDs before staging', async () => {
    const profile = await createPracticeProfile('Duplicate source');
    const lesson = createPracticeLessonDraft({
      profileId: profile.id,
      gradeLevel: '國小',
      subject: 'math',
      topic: '分數',
      learningObjectives: '能辨識等值分數',
    });
    await savePracticeLesson(lesson);
    const archive = await exportPracticeArchive();

    const duplicateQuestion = cloneArchive(archive);
    const duplicateLesson = (duplicateQuestion.records as PracticeArchiveRecords).lessons[0];
    duplicateLesson.questions[1].id = duplicateLesson.questions[0].id;
    await expect(importPracticeArchive(duplicateQuestion)).rejects.toThrow('重複題目 id');

    const duplicateDestination = cloneArchive(archive);
    await expect(
      importPracticeArchive(duplicateDestination, {
        importId: `duplicate-destination-${Date.now()}`,
        visibility: 'hidden',
        plannedIds: {
          profiles: { [profile.id]: 'planned-collision' },
          lessons: { [lesson.id]: 'planned-collision' },
        },
      }),
    ).rejects.toThrow('匯入 destination id 重複');
    await expect(listPracticeArchiveRecordIds()).resolves.not.toContain('planned-collision');
  });

  it('remaps attempt question IDs per lesson and rejects dangling foreign keys', async () => {
    const profile = await createPracticeProfile('Per lesson remap');
    const firstLesson = createPracticeLessonDraft({
      profileId: profile.id,
      gradeLevel: '國小',
      subject: 'english',
      topic: '第一課',
      learningObjectives: '能辨識字義',
    });
    const secondLesson = createPracticeLessonDraft({
      profileId: profile.id,
      gradeLevel: '國小',
      subject: 'english',
      topic: '第二課',
      learningObjectives: '能辨識句型',
    });
    const sharedQuestionId = firstLesson.questions[0].id;
    secondLesson.questions[0].id = sharedQuestionId;
    await savePracticeLesson(firstLesson);
    await savePracticeLesson(secondLesson);
    await recordPracticeAttempt({
      profileId: profile.id,
      lessonId: firstLesson.id,
      questionId: sharedQuestionId,
      response: 'wrong',
    });
    await recordPracticeAttempt({
      profileId: profile.id,
      lessonId: secondLesson.id,
      questionId: sharedQuestionId,
      response: 'wrong',
    });

    const archive = await exportPracticeArchive();
    await __resetPracticeStoreForTesting();
    const imported = await importPracticeArchive(archive);
    const importedLessons = await listPracticeLessons(imported.copiedIds.profileIds[0]);
    const importedAttempts = await listPracticeAttempts(imported.copiedIds.profileIds[0]);
    for (const attempt of importedAttempts) {
      const lessonForAttempt = importedLessons.find(item => item.id === attempt.lessonId);
      expect(lessonForAttempt?.questions.some(question => question.id === attempt.questionId)).toBe(
        true,
      );
    }

    const dangling = cloneArchive(archive);
    const danglingAttempt = (dangling.records as PracticeArchiveRecords).attempts[0];
    danglingAttempt.questionId = 'missing-question';
    await expect(importPracticeArchive(dangling)).rejects.toThrow('找不到關聯題目');
  });

  it('keeps staged imports hidden, waits for the shared receipt, and never rolls back missing ownership', async () => {
    const profile = await createPracticeProfile('Staging profile');
    const lesson = createPracticeLessonDraft({
      profileId: profile.id,
      gradeLevel: '國小',
      subject: 'science',
      topic: '水循環',
      learningObjectives: '能描述水循環',
    });
    await savePracticeLesson(lesson);
    const share = await exportPracticeTeachingShare(profile.id);
    const importId = `f1-practice-hidden-test-${Date.now()}`;
    await importPracticeArchive(share, {
      targetProfileId: profile.id,
      importId,
      visibility: 'hidden',
    });

    await expect(listPracticeLessons(profile.id)).resolves.toHaveLength(1);
    await removePracticeImportedRecords(importId);
    await expect(listPracticeLessons(profile.id)).resolves.toHaveLength(1);

    const stagedAgain = await importPracticeArchive(share, {
      targetProfileId: profile.id,
      importId: `${importId}-second`,
      visibility: 'hidden',
    });
    await expect(listPracticeLessons(profile.id)).resolves.toHaveLength(1);
    await expect(listPracticeArchiveRecordIds()).resolves.toContain(
      stagedAgain.copiedIds.lessonIds[0],
    );
    await expect(workspacePracticeArchiveProvider.listExistingIds?.()).resolves.toContain(
      stagedAgain.copiedIds.lessonIds[0],
    );
    await expect(exportPracticeArchive()).resolves.toMatchObject({
      records: expect.objectContaining({ lessons: expect.any(Array) }),
    });
    expect((await exportPracticeArchive()).records.lessons).toHaveLength(1);
    await expect(publishPracticeImportedRecords(stagedAgain.importId)).resolves.toMatchObject({
      published: false,
      awaitingSharedReceipt: true,
      state: 'staged',
    });

    await deleteRawPracticeLesson(stagedAgain.copiedIds.lessonIds[0]);
    await expect(publishPracticeImportedRecords(stagedAgain.importId)).rejects.toThrow(
      '尚未完整寫入',
    );
    await expect(getPracticeArchiveImport(stagedAgain.importId)).resolves.toMatchObject({
      state: 'failed',
    });
    const cleanup = await removePracticeImportedRecords(stagedAgain.importId);
    expect(cleanup.state).toBe('failed');
    expect(cleanup.missingIds.lessonIds).toContain(stagedAgain.copiedIds.lessonIds[0]);

    const finalStage = await importPracticeArchive(share, {
      targetProfileId: profile.id,
      importId: `${importId}-published`,
      visibility: 'hidden',
    });
    await expect(publishPracticeImportedRecords(finalStage.importId)).resolves.toMatchObject({
      awaitingSharedReceipt: true,
    });
    markWorkspaceArchiveImportPublished(finalStage.importId);
    await expect(publishPracticeImportedRecords(finalStage.importId)).resolves.toMatchObject({
      published: true,
      state: 'published',
    });
    await expect(listPracticeLessons(profile.id)).resolves.toHaveLength(2);
    await removePracticeImportedRecords(finalStage.importId);
  });

  it('refuses publication or rollback when staged nested question ownership changes', async () => {
    const profile = await createPracticeProfile('Nested ownership');
    const lesson = createPracticeLessonDraft({
      profileId: profile.id,
      gradeLevel: '國小',
      subject: 'english',
      topic: '題目關聯',
      learningObjectives: '能辨識關聯',
    });
    await savePracticeLesson(lesson);
    const share = await exportPracticeTeachingShare(profile.id);
    const importId = `practice-nested-ownership-${Date.now()}`;
    const staged = await importPracticeArchive(share, {
      targetProfileId: profile.id,
      importId,
      visibility: 'hidden',
    });

    await updateRawPracticeLesson(staged.copiedIds.lessonIds[0], current => {
      const questions = current.questions as Array<Record<string, unknown>>;
      return {
        ...current,
        questions: [{ ...questions[0], id: 'mutated-question-id' }, ...questions.slice(1)],
      };
    });

    await expect(publishPracticeImportedRecords(importId)).rejects.toThrow('尚未完整寫入');
    const cleanup = await removePracticeImportedRecords(importId);
    expect(cleanup.state).toBe('failed');
    expect(cleanup.missingIds.lessonIds).toContain(staged.copiedIds.lessonIds[0]);
    await expect(listPracticeArchiveRecordIds()).resolves.toContain(staged.copiedIds.lessonIds[0]);
  });

  it('does not let normal mutators overwrite or delete archive-managed rows', async () => {
    const profile = await createPracticeProfile('Archive marker guard');
    const lesson = createPracticeLessonDraft({
      profileId: profile.id,
      gradeLevel: '國小',
      subject: 'math',
      topic: '標記保護',
      learningObjectives: '能保留原資料',
    });
    await savePracticeLesson(lesson);
    await recordPracticeAttempt({
      profileId: profile.id,
      lessonId: lesson.id,
      questionId: lesson.questions[0].id,
      response: 'wrong',
    });
    const archive = await exportPracticeArchive();
    const importId = `practice-marker-guard-${Date.now()}`;
    const staged = await importPracticeArchive(archive, { importId, visibility: 'hidden' });
    const stagedProfileId = staged.copiedIds.profileIds[0];
    const stagedLessonId = staged.copiedIds.lessonIds[0];
    const stagedQuestionId = staged.copiedIds.questionIds[0];

    await expect(savePracticeProfile({ ...profile, id: stagedProfileId })).rejects.toThrow(
      '不能由一般操作覆寫或刪除',
    );
    await expect(deletePracticeProfile(stagedProfileId)).rejects.toThrow(
      '不能由一般操作覆寫或刪除',
    );
    await expect(savePracticeLesson({ ...lesson, id: stagedLessonId })).rejects.toThrow(
      '不能由一般操作覆寫或刪除',
    );
    await expect(deletePracticeLesson(stagedLessonId)).rejects.toThrow('不能由一般操作覆寫或刪除');
    await expect(
      recordPracticeAttempt({
        profileId: stagedProfileId,
        lessonId: stagedLessonId,
        questionId: stagedQuestionId,
        response: 'wrong',
      }),
    ).rejects.toThrow('不能由一般操作覆寫或刪除');
    await expect(
      savePracticeBookmark(stagedProfileId, stagedLessonId, stagedQuestionId),
    ).rejects.toThrow('不能由一般操作覆寫或刪除');
    await expect(
      deletePracticeBookmark(stagedProfileId, stagedLessonId, stagedQuestionId),
    ).rejects.toThrow('不能由一般操作覆寫或刪除');
  });

  it('resolves a teaching-share target profile through the active operation token', async () => {
    const profile = await createPracticeProfile('Token target');
    const lesson = createPracticeLessonDraft({
      profileId: profile.id,
      gradeLevel: '國小',
      subject: 'science',
      topic: 'token target',
      learningObjectives: '能完成匯入',
    });
    await savePracticeLesson(lesson);
    const share = await exportPracticeTeachingShare(profile.id);
    await __resetPracticeStoreForTesting();
    const operation = await beginWorkspaceOperation('import');
    try {
      await expect(
        importPracticeArchive(share, {
          importId: `practice-token-target-${Date.now()}`,
          visibility: 'hidden',
          operationToken: operation.operationToken,
        }),
      ).resolves.toMatchObject({ state: 'staged' });
    } finally {
      operation.release();
    }
  });

  it('treats cleanup without a journal as success only when planned rows are absent', async () => {
    await expect(
      removePracticeImportedRecords('practice-never-staged', {
        expectedIds: ['planned-profile', 'planned-lesson', 'planned-question'],
      }),
    ).resolves.toMatchObject({ state: 'rolled_back' });
  });

  it('fails closed when a missing journal leaves rows without exact root ownership', async () => {
    const profile = await createPracticeProfile('Missing journal ownership');
    const lesson = createPracticeLessonDraft({
      profileId: profile.id,
      gradeLevel: '國小',
      subject: 'english',
      topic: 'journal ownership',
      learningObjectives: '能保留 ownership',
    });
    await savePracticeLesson(lesson);
    const archive = await exportPracticeArchive();
    const importId = `practice-missing-journal-${Date.now()}`;
    const staged = await importPracticeArchive(archive, { importId, visibility: 'hidden' });
    await deleteRawPracticeImportLog(importId);
    await updateRawPracticeLesson(staged.copiedIds.lessonIds[0], current => ({
      ...current,
      [WORKSPACE_ARCHIVE_IMPORT_ID_FIELD]: 'different-root-import',
    }));

    await expect(
      removePracticeImportedRecords(importId, {
        expectedIds: [
          ...staged.copiedIds.profileIds,
          ...staged.copiedIds.lessonIds,
          ...staged.copiedIds.questionIds,
          ...staged.copiedIds.attemptIds,
          ...staged.copiedIds.bookmarkIds,
        ],
      }),
    ).rejects.toThrow('ownership 無法核對');
    await expect(listPracticeArchiveRecordIds()).resolves.toContain(staged.copiedIds.lessonIds[0]);
  });

  it('rejects missing-journal cleanup when an owned lesson loses a planned nested question', async () => {
    const profile = await createPracticeProfile('Missing nested question');
    const lesson = createPracticeLessonDraft({
      profileId: profile.id,
      gradeLevel: '國小',
      subject: 'math',
      topic: 'partial nested ownership',
      learningObjectives: '能保留每一題的 ownership',
    });
    await savePracticeLesson(lesson);
    const archive = await exportPracticeArchive();
    const importId = `practice-missing-nested-question-${Date.now()}`;
    const staged = await importPracticeArchive(archive, { importId, visibility: 'hidden' });
    const missingQuestionId = staged.copiedIds.questionIds[0];
    await deleteRawPracticeImportLog(importId);
    await updateRawPracticeLesson(staged.copiedIds.lessonIds[0], current => ({
      ...current,
      questions: (current.questions as Array<Record<string, unknown>>).filter(
        question => question.id !== missingQuestionId,
      ),
    }));

    await expect(
      removePracticeImportedRecords(importId, {
        expectedIds: [
          ...staged.copiedIds.profileIds,
          ...staged.copiedIds.lessonIds,
          ...staged.copiedIds.questionIds,
          ...staged.copiedIds.attemptIds,
          ...staged.copiedIds.bookmarkIds,
        ],
      }),
    ).rejects.toThrow('ownership 無法核對');
    await expect(listPracticeArchiveRecordIds()).resolves.toEqual(
      expect.arrayContaining([staged.copiedIds.profileIds[0], staged.copiedIds.lessonIds[0]]),
    );
  });

  it('hides every staged practice reader and export until the shared receipt exists', async () => {
    const profile = await createPracticeProfile('Hidden reader profile');
    const lesson = createPracticeLessonDraft({
      profileId: profile.id,
      gradeLevel: '國小五年級',
      subject: 'math',
      topic: '分數',
      learningObjectives: '能辨識等值分數',
    });
    await savePracticeLesson(lesson);
    await recordPracticeAttempt({
      profileId: profile.id,
      lessonId: lesson.id,
      questionId: lesson.questions[0].id,
      response: 'wrong',
    });
    await savePracticeBookmark(profile.id, lesson.id, lesson.questions[0].id);

    const archive = await exportPracticeArchive();
    const importId = `f1-practice-all-readers-${Date.now()}`;
    const staged = await importPracticeArchive(archive, {
      importId,
      visibility: 'hidden',
    });

    await expect(listPracticeProfiles()).resolves.toHaveLength(1);
    await expect(listPracticeLessons()).resolves.toHaveLength(1);
    await expect(listPracticeAttempts(profile.id)).resolves.toHaveLength(1);
    await expect(listPracticeBookmarks(profile.id)).resolves.toHaveLength(1);
    await expect(getPracticeLesson(staged.copiedIds.lessonIds[0])).resolves.toBeUndefined();
    await expect(listPracticeArchiveRecordIds()).resolves.toEqual(
      expect.arrayContaining([
        staged.copiedIds.profileIds[0],
        staged.copiedIds.lessonIds[0],
        staged.copiedIds.attemptIds[0],
        staged.copiedIds.bookmarkIds[0],
      ]),
    );
    const visibleExport = await exportPracticeArchive();
    const visibleRecords = visibleExport.records as PracticeArchiveRecords;
    expect(visibleRecords.profiles).toHaveLength(1);
    expect(visibleRecords.lessons).toHaveLength(1);
    expect(visibleRecords.attempts).toHaveLength(1);
    expect(visibleRecords.bookmarks).toHaveLength(1);

    markWorkspaceArchiveImportPublished(importId);
    await expect(publishPracticeImportedRecords(importId)).resolves.toMatchObject({
      published: true,
      state: 'published',
    });
    await expect(listPracticeProfiles()).resolves.toHaveLength(2);
    await expect(listPracticeLessons()).resolves.toHaveLength(2);
    await expect(listPracticeAttempts(staged.copiedIds.profileIds[0])).resolves.toHaveLength(1);
    await expect(listPracticeBookmarks(staged.copiedIds.profileIds[0])).resolves.toHaveLength(1);
    await removePracticeImportedRecords(importId);
  });
});
