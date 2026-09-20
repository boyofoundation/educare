import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import {
  WORKSPACE_ARCHIVE_IMPORT_ID_FIELD,
  clearWorkspaceArchivePublication,
  isWorkspaceArchiveImportPublished,
  isWorkspaceArchiveRecordVisible,
  stripWorkspaceArchiveVisibility,
  tagWorkspaceArchiveRecord,
  withWorkspaceDatabaseOperation,
} from './db';
import type { WorkspaceOperationToken } from './workspaceOperationService';

/**
 * F5 practice data is intentionally kept in its own IndexedDB database. This
 * avoids coupling the teaching workspace to the existing assistant/chat
 * stores, while still giving the F1 backup service a typed boundary.
 */
export const PRACTICE_DB_NAME = 'educare-practice-workspace';
export const PRACTICE_DB_VERSION = 1;
export const PRACTICE_SCHEMA_VERSION = 1;
export const PRACTICE_EXPORT_FORMAT = 'educare-practice-workspace';
export const PRACTICE_ARCHIVE_FORMAT = 'educare-practice-archive';
export const PRACTICE_ACTIVE_PROFILE_KEY = 'educare.practice.active-profile';
export const DEFAULT_PRACTICE_PROFILE_ID = 'practice-local-anonymous';

export const PRACTICE_SUBJECTS = ['english', 'math', 'science'] as const;
export type PracticeSubject = (typeof PRACTICE_SUBJECTS)[number];

export const PRACTICE_QUESTION_TYPES = ['choice', 'fill', 'free-response'] as const;
export type PracticeQuestionType = (typeof PRACTICE_QUESTION_TYPES)[number];

export type PracticeSourceStatus = 'verified' | 'unverified';
export type PracticeExportMode = 'teaching-share' | 'f1-backup';
export type PracticeImportVisibility = 'visible' | 'hidden';
export type PracticeImportState = 'staged' | 'published' | 'rolled_back' | 'failed';

export interface PracticeArchiveOperationOptions {
  /** Opaque capability issued by the active F1 workspace archive operation. */
  operationToken?: WorkspaceOperationToken;
  /** Root-planned provider IDs used to prove an import never staged. */
  expectedIds?: string[];
}

export interface PracticeArchiveImportOptions extends PracticeArchiveOperationOptions {
  targetProfileId?: string;
  /** A root archive coordinator supplies this before any provider rows are written. */
  importId?: string;
  /** Hidden is required for F1's staged publication; visible is for standalone teaching share. */
  visibility?: PracticeImportVisibility;
  /** Optional root-planned IDs make crash recovery discoverable before provider writes. */
  plannedIds?: Partial<Record<PracticeImportRecordKind, Record<string, string>>>;
}

export type PracticeImportRecordKind = 'profiles' | 'lessons' | 'attempts' | 'bookmarks';

export interface PracticeSource {
  id: string;
  title: string;
  status: PracticeSourceStatus;
  url?: string;
  locator?: string;
  excerpt?: string;
  notes?: string;
}

export interface PracticeQuestion {
  id: string;
  schemaVersion: number;
  prompt: string;
  type: PracticeQuestionType;
  options?: string[];
  /** Canonical answer for choice/fill questions. */
  answer?: string;
  /** Backward-friendly alias accepted when importing generated content. */
  correctAnswer?: string;
  acceptedAnswers?: string[];
  explanation: string;
  sources: PracticeSource[];
  /** Invalid questions remain editable but can never receive a score. */
  schemaValid?: boolean;
  validationErrors?: string[];
}

export interface PracticeLesson {
  id: string;
  schemaVersion: number;
  version: number;
  title: string;
  gradeLevel: string;
  subject: PracticeSubject;
  /** Existing assistant-template id used to seed the mock lesson. */
  templateId?: string;
  topic: string;
  learningObjectives: string[];
  lessonPlan: string;
  questions: PracticeQuestion[];
  sources: PracticeSource[];
  ownerProfileId: string;
  generatedBy: 'mock' | 'teacher' | 'ai';
  createdAt: number;
  updatedAt: number;
  schemaValid?: boolean;
  validationErrors?: string[];
}

export interface PracticeProfile {
  id: string;
  displayName: string;
  anonymous: true;
  createdAt: number;
  updatedAt: number;
}

export type PracticeGradeStatus = 'correct' | 'incorrect' | 'manual-review' | 'ungraded-invalid';

export type PracticeFeedbackMode = 'offline' | 'manual' | 'online-ai';

export interface PracticeGradeResult {
  status: PracticeGradeStatus;
  score: number | null;
  feedback: string;
  feedbackMode: PracticeFeedbackMode;
  gradedAt: number;
}

export interface PracticeAttempt {
  id: string;
  schemaVersion: number;
  profileId: string;
  lessonId: string;
  lessonVersion: number;
  questionId: string;
  response: string;
  result: PracticeGradeResult;
  submittedAt: number;
}

export interface PracticeBookmark {
  id: string;
  schemaVersion: number;
  profileId: string;
  lessonId: string;
  questionId: string;
  createdAt: number;
}

export interface PracticeMistake {
  profileId: string;
  lessonId: string;
  questionId: string;
  lesson: PracticeLesson | undefined;
  question: PracticeQuestion | undefined;
  latestAttempt: PracticeAttempt;
  incorrectCount: number;
}

export interface PracticeReviewItem {
  id: string;
  profileId: string;
  lessonId: string;
  questionId: string;
  reason: 'mistake' | 'bookmark';
  nextReviewAt: number;
  lesson: PracticeLesson | undefined;
  question: PracticeQuestion | undefined;
  latestAttempt?: PracticeAttempt;
}

export interface PracticeValidationIssue {
  path: string;
  message: string;
}

export interface PracticeValidationResult {
  valid: boolean;
  errors: PracticeValidationIssue[];
}

export interface PracticeLessonDraftInput {
  profileId?: string;
  gradeLevel: string;
  subject: PracticeSubject;
  topic: string;
  learningObjectives: string | string[];
  title?: string;
  lessonPlan?: string;
  now?: number;
}

export interface PracticeSubjectFixture {
  subject: PracticeSubject;
  label: string;
  templateId: string;
  defaultTopic: string;
  lessonPlan: string;
  questions: Array<
    Omit<PracticeQuestion, 'id' | 'schemaVersion' | 'sources'> & {
      sources: Array<Omit<PracticeSource, 'id'>>;
    }
  >;
}

export interface PracticeShareLesson extends Omit<PracticeLesson, 'ownerProfileId'> {
  /** Ownership is deliberately omitted from teaching shares. */
  ownerProfileId?: never;
}

export interface PracticeArchiveRecords {
  schemaVersion: 1;
  profiles: PracticeProfile[];
  lessons: PracticeLesson[];
  attempts: PracticeAttempt[];
  bookmarks: PracticeBookmark[];
}

export interface PracticeExportManifest {
  format: typeof PRACTICE_EXPORT_FORMAT | typeof PRACTICE_ARCHIVE_FORMAT;
  schemaVersion: 1;
  mode: PracticeExportMode;
  exportedAt: number;
  recordCounts: Record<string, number>;
}

export interface PracticeExportEnvelope {
  manifest: PracticeExportManifest;
  records: { lessons: PracticeShareLesson[] } | PracticeArchiveRecords;
}

export interface PracticeImportResult {
  mode: PracticeExportMode;
  rollbackToken: string;
  importId: string;
  visibility: PracticeImportVisibility;
  state: PracticeImportState;
  copiedIds: {
    profileIds: string[];
    lessonIds: string[];
    questionIds: string[];
    attemptIds: string[];
    bookmarkIds: string[];
  };
  warnings: PracticeValidationIssue[];
}

export interface PracticeExportParseResult {
  ok: boolean;
  data: PracticeExportEnvelope | null;
  errors: PracticeValidationIssue[];
  warnings: PracticeValidationIssue[];
}

export interface PracticeArchiveAdapter {
  /** Short names are convenient for F1's generic archive registry. */
  export: (options?: PracticeArchiveOperationOptions) => Promise<PracticeExportEnvelope>;
  import: (
    input: PracticeExportEnvelope | PracticeArchiveRecords | string,
    options?: PracticeArchiveImportOptions,
  ) => Promise<PracticeImportResult>;
  rollback: (
    importToken: string | PracticeImportResult,
    options?: PracticeArchiveOperationOptions,
  ) => Promise<void>;
  exportRecords: () => Promise<PracticeExportEnvelope>;
  importRecords: (
    input: PracticeExportEnvelope | PracticeArchiveRecords | string,
    options?: PracticeArchiveImportOptions,
  ) => Promise<PracticeImportResult>;
  /** Validate staged rows; only the F1 coordinator may publish the shared receipt. */
  publishImportedRecords: (
    importId: string,
    options?: PracticeArchiveOperationOptions,
  ) => Promise<PracticeImportPublicationResult>;
  /** Remove only rows owned by this import id and report incomplete cleanup as failed. */
  removeImportedRecords: (
    importId: string,
    options?: PracticeArchiveOperationOptions,
  ) => Promise<PracticeImportCleanupResult>;
}

interface PracticeImportLog {
  token: string;
  importId: string;
  visibility: PracticeImportVisibility;
  state: PracticeImportState;
  copiedIds: PracticeImportResult['copiedIds'];
  plannedIds: PracticeImportResult['copiedIds'];
  /** Exact copied question ownership, keyed by the copied lesson id. */
  questionIdsByLesson: Record<string, string[]>;
  createdAt: number;
  updatedAt: number;
}

export interface PracticeImportPublicationResult {
  importId: string;
  state: PracticeImportState;
  published: boolean;
  awaitingSharedReceipt: boolean;
}

export interface PracticeImportCleanupResult {
  importId: string;
  state: Extract<PracticeImportState, 'rolled_back' | 'failed'>;
  removedIds: PracticeImportResult['copiedIds'];
  missingIds: PracticeImportResult['copiedIds'];
}

interface PracticeDB extends DBSchema {
  profiles: { key: string; value: PracticeProfile };
  lessons: {
    key: string;
    value: PracticeLesson;
    indexes: { 'by-profile': string };
  };
  attempts: {
    key: string;
    value: PracticeAttempt;
    indexes: { 'by-profile': string; 'by-lesson': string };
  };
  bookmarks: {
    key: string;
    value: PracticeBookmark;
    indexes: { 'by-profile': string; 'by-lesson': string };
  };
  imports: { key: string; value: PracticeImportLog };
}

const PROFILE_STORE = 'profiles';
const LESSON_STORE = 'lessons';
const ATTEMPT_STORE = 'attempts';
const BOOKMARK_STORE = 'bookmarks';
const IMPORT_STORE = 'imports';

let dbPromise: Promise<IDBPDatabase<PracticeDB>> | null = null;
let idCounter = 0;

const createId = (prefix: string): string => {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }

  idCounter += 1;
  return `${prefix}-${Date.now()}-${idCounter}`;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const isQuestionType = (value: unknown): value is PracticeQuestionType =>
  typeof value === 'string' && PRACTICE_QUESTION_TYPES.includes(value as PracticeQuestionType);

const isSubject = (value: unknown): value is PracticeSubject =>
  typeof value === 'string' && PRACTICE_SUBJECTS.includes(value as PracticeSubject);

const isSourceStatus = (value: unknown): value is PracticeSourceStatus =>
  value === 'verified' || value === 'unverified';

const getPracticeDb = (): Promise<IDBPDatabase<PracticeDB>> => {
  if (!dbPromise) {
    dbPromise = openDB<PracticeDB>(PRACTICE_DB_NAME, PRACTICE_DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(PROFILE_STORE)) {
          db.createObjectStore(PROFILE_STORE, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(LESSON_STORE)) {
          const store = db.createObjectStore(LESSON_STORE, { keyPath: 'id' });
          store.createIndex('by-profile', 'ownerProfileId');
        }
        if (!db.objectStoreNames.contains(ATTEMPT_STORE)) {
          const store = db.createObjectStore(ATTEMPT_STORE, { keyPath: 'id' });
          store.createIndex('by-profile', 'profileId');
          store.createIndex('by-lesson', 'lessonId');
        }
        if (!db.objectStoreNames.contains(BOOKMARK_STORE)) {
          const store = db.createObjectStore(BOOKMARK_STORE, { keyPath: 'id' });
          store.createIndex('by-profile', 'profileId');
          store.createIndex('by-lesson', 'lessonId');
        }
        if (!db.objectStoreNames.contains(IMPORT_STORE)) {
          db.createObjectStore(IMPORT_STORE, { keyPath: 'token' });
        }
      },
    });
  }
  return dbPromise;
};

const emptyCopiedIds = (): PracticeImportResult['copiedIds'] => ({
  profileIds: [],
  lessonIds: [],
  questionIds: [],
  attemptIds: [],
  bookmarkIds: [],
});

const copyCopiedIds = (
  copiedIds: PracticeImportResult['copiedIds'],
): PracticeImportResult['copiedIds'] => ({
  profileIds: [...copiedIds.profileIds],
  lessonIds: [...copiedIds.lessonIds],
  questionIds: [...copiedIds.questionIds],
  attemptIds: [...copiedIds.attemptIds],
  bookmarkIds: [...copiedIds.bookmarkIds],
});

const copyQuestionIdsByLesson = (
  questionIdsByLesson: Record<string, string[]>,
): Record<string, string[]> =>
  Object.fromEntries(
    Object.entries(questionIdsByLesson).map(([lessonId, questionIds]) => [
      lessonId,
      [...questionIds],
    ]),
  );

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const archiveMarker = (value: unknown): string | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const marker = value[WORKSPACE_ARCHIVE_IMPORT_ID_FIELD];
  return typeof marker === 'string' && marker.length > 0 ? marker : undefined;
};

const assertPracticeRecordNotArchiveManaged = (value: unknown): void => {
  if (archiveMarker(value)) {
    throw new Error('封存匯入資料只能由匯入復原流程管理，不能由一般操作覆寫或刪除。');
  }
};

const visibleRecord = <T>(record: T | undefined): T | undefined =>
  record && isWorkspaceArchiveRecordVisible(record)
    ? stripWorkspaceArchiveVisibility(record)
    : undefined;

const visibleRecords = <T>(records: T[]): T[] =>
  records.filter(isWorkspaceArchiveRecordVisible).map(stripWorkspaceArchiveVisibility);

const withPracticeWrite = <T>(
  operation: () => Promise<T>,
  options: PracticeArchiveOperationOptions = {},
): Promise<T> => withWorkspaceDatabaseOperation(options, operation);

const parseObjectives = (value: string | string[]): string[] => {
  const values = Array.isArray(value) ? value : value.split(/[\n,]/g);
  return values.map(item => item.trim()).filter(Boolean);
};

const normalizeSource = (value: unknown, index: number): PracticeSource => {
  const source = isRecord(value) ? value : {};
  const titleValue = source.title ?? source.label ?? source.name;
  const title = typeof titleValue === 'string' ? titleValue.trim() : '';
  const status = isSourceStatus(source.status) ? source.status : 'unverified';
  const normalized: PracticeSource = {
    id: typeof source.id === 'string' && source.id.trim() ? source.id : createId(`source-${index}`),
    title: title || `未命名來源 ${index + 1}`,
    status,
  };

  for (const key of ['url', 'locator', 'excerpt', 'notes'] as const) {
    if (typeof source[key] === 'string' && source[key].trim()) {
      normalized[key] = source[key].trim();
    }
  }
  return normalized;
};

const normalizeQuestion = (value: unknown, index: number): PracticeQuestion => {
  const question = isRecord(value) ? value : {};
  const validation = validatePracticeQuestion(value);
  const type = isQuestionType(question.type) ? question.type : 'free-response';
  const answer =
    typeof question.answer === 'string'
      ? question.answer
      : typeof question.correctAnswer === 'string'
        ? question.correctAnswer
        : undefined;
  const acceptedAnswers = Array.isArray(question.acceptedAnswers)
    ? question.acceptedAnswers.filter((item): item is string => typeof item === 'string')
    : undefined;
  const normalized: PracticeQuestion = {
    id:
      typeof question.id === 'string' && question.id.trim()
        ? question.id
        : createId(`question-${index}`),
    schemaVersion:
      typeof question.schemaVersion === 'number' ? question.schemaVersion : PRACTICE_SCHEMA_VERSION,
    prompt: typeof question.prompt === 'string' ? question.prompt : '',
    type,
    explanation: typeof question.explanation === 'string' ? question.explanation : '',
    sources: Array.isArray(question.sources) ? question.sources.map(normalizeSource) : [],
    schemaValid: validation.valid,
    ...(validation.valid
      ? {}
      : { validationErrors: validation.errors.map(error => error.message) }),
  };

  if (Array.isArray(question.options)) {
    normalized.options = question.options.filter(
      (item): item is string => typeof item === 'string',
    );
  }
  if (answer !== undefined) {
    normalized.answer = answer;
    normalized.correctAnswer = answer;
  }
  if (acceptedAnswers?.length) {
    normalized.acceptedAnswers = acceptedAnswers;
  }
  return normalized;
};

const normalizeLesson = (value: unknown, index = 0): PracticeLesson => {
  const lesson = isRecord(value) ? value : {};
  const questionValues = Array.isArray(lesson.questions) ? lesson.questions : [];
  const questions = questionValues.map((question, questionIndex) =>
    normalizeQuestion(question, questionIndex),
  );
  const sourceValues = Array.isArray(lesson.sources) ? lesson.sources : [];
  const objectives = Array.isArray(lesson.learningObjectives)
    ? lesson.learningObjectives.filter((item): item is string => typeof item === 'string')
    : typeof lesson.learningObjectives === 'string'
      ? parseObjectives(lesson.learningObjectives)
      : [];
  const normalized: PracticeLesson = {
    id: typeof lesson.id === 'string' && lesson.id.trim() ? lesson.id : createId(`lesson-${index}`),
    schemaVersion:
      typeof lesson.schemaVersion === 'number' ? lesson.schemaVersion : PRACTICE_SCHEMA_VERSION,
    version: typeof lesson.version === 'number' && lesson.version > 0 ? lesson.version : 1,
    title: typeof lesson.title === 'string' ? lesson.title.trim() : '',
    gradeLevel: typeof lesson.gradeLevel === 'string' ? lesson.gradeLevel.trim() : '',
    subject: isSubject(lesson.subject) ? lesson.subject : 'english',
    ...(typeof lesson.templateId === 'string' && lesson.templateId.trim()
      ? { templateId: lesson.templateId.trim() }
      : {}),
    topic: typeof lesson.topic === 'string' ? lesson.topic.trim() : '',
    learningObjectives: objectives,
    lessonPlan: typeof lesson.lessonPlan === 'string' ? lesson.lessonPlan : '',
    questions,
    sources: sourceValues.map(normalizeSource),
    ownerProfileId:
      typeof lesson.ownerProfileId === 'string'
        ? lesson.ownerProfileId
        : DEFAULT_PRACTICE_PROFILE_ID,
    generatedBy:
      lesson.generatedBy === 'teacher' || lesson.generatedBy === 'ai' ? lesson.generatedBy : 'mock',
    createdAt: typeof lesson.createdAt === 'number' ? lesson.createdAt : Date.now(),
    updatedAt: typeof lesson.updatedAt === 'number' ? lesson.updatedAt : Date.now(),
  };
  const validation = validatePracticeLesson(normalized);
  normalized.schemaValid = validation.valid;
  if (!validation.valid) {
    normalized.validationErrors = validation.errors.map(error => error.message);
  }
  return normalized;
};

export const validatePracticeQuestion = (value: unknown): PracticeValidationResult => {
  const errors: PracticeValidationIssue[] = [];
  if (!isRecord(value)) {
    return { valid: false, errors: [{ path: '', message: '題目必須是物件。' }] };
  }

  if (value.schemaVersion !== PRACTICE_SCHEMA_VERSION) {
    errors.push({ path: 'schemaVersion', message: '題目 schema 版本不受支援。' });
  }
  if (value.schemaValid === false) {
    errors.push({ path: 'schemaValid', message: '題目先前已被標記為 schema 無效。' });
  }
  if (typeof value.id !== 'string' || !value.id.trim()) {
    errors.push({ path: 'id', message: '題目缺少 id。' });
  }
  if (typeof value.prompt !== 'string' || !value.prompt.trim()) {
    errors.push({ path: 'prompt', message: '題目缺少題幹。' });
  }
  if (!isQuestionType(value.type)) {
    errors.push({ path: 'type', message: '題型必須是 choice、fill 或 free-response。' });
  }
  if (typeof value.explanation !== 'string') {
    errors.push({ path: 'explanation', message: '題目必須包含解說欄位。' });
  }
  if (!Array.isArray(value.sources)) {
    errors.push({ path: 'sources', message: '題目必須包含來源陣列。' });
  } else {
    value.sources.forEach((source, index) => {
      if (!isRecord(source)) {
        errors.push({ path: `sources.${index}`, message: '來源格式錯誤。' });
        return;
      }
      if (typeof source.id !== 'string' || !source.id.trim()) {
        errors.push({ path: `sources.${index}.id`, message: '來源缺少 id。' });
      }
      if (typeof source.title !== 'string' || !source.title.trim()) {
        errors.push({ path: `sources.${index}.title`, message: '來源缺少名稱。' });
      }
      if (!isSourceStatus(source.status)) {
        errors.push({ path: `sources.${index}.status`, message: '來源必須標示已確認或未驗證。' });
      }
    });
  }

  if (value.type === 'choice') {
    if (!Array.isArray(value.options) || value.options.length < 2) {
      errors.push({ path: 'options', message: '選擇題至少需要兩個選項。' });
    }
    const answer =
      typeof value.answer === 'string'
        ? value.answer
        : typeof value.correctAnswer === 'string'
          ? value.correctAnswer
          : undefined;
    if (typeof answer !== 'string' || !answer.trim()) {
      errors.push({ path: 'answer', message: '選擇題缺少正確答案。' });
    } else if (Array.isArray(value.options) && !value.options.includes(answer)) {
      errors.push({ path: 'answer', message: '正確答案必須存在於選項中。' });
    }
  }

  if (value.type === 'fill') {
    const answer =
      typeof value.answer === 'string'
        ? value.answer
        : typeof value.correctAnswer === 'string'
          ? value.correctAnswer
          : undefined;
    const acceptedAnswers = Array.isArray(value.acceptedAnswers)
      ? value.acceptedAnswers.filter((item): item is string => typeof item === 'string')
      : [];
    if ((!answer || !answer.trim()) && acceptedAnswers.length === 0) {
      errors.push({ path: 'answer', message: '填空題缺少可核對答案。' });
    }
  }

  return { valid: errors.length === 0, errors };
};

export const validatePracticeLesson = (value: unknown): PracticeValidationResult => {
  if (!isRecord(value)) {
    return { valid: false, errors: [{ path: '', message: '教案必須是物件。' }] };
  }
  const errors: PracticeValidationIssue[] = [];
  if (value.schemaVersion !== PRACTICE_SCHEMA_VERSION) {
    errors.push({ path: 'schemaVersion', message: '教案 schema 版本不受支援。' });
  }
  for (const key of ['id', 'title', 'gradeLevel', 'topic', 'ownerProfileId'] as const) {
    const field = value[key];
    if (typeof field !== 'string' || !field.trim()) {
      errors.push({ path: key, message: `教案缺少 ${key}。` });
    }
  }
  if (!isSubject(value.subject)) {
    errors.push({ path: 'subject', message: '教案科目不受支援。' });
  }
  if (!Array.isArray(value.learningObjectives)) {
    errors.push({ path: 'learningObjectives', message: '教案必須包含學習目標陣列。' });
  }
  if (typeof value.lessonPlan !== 'string') {
    errors.push({ path: 'lessonPlan', message: '教案必須包含可編輯的教學流程。' });
  }
  if (!Array.isArray(value.questions) || value.questions.length === 0) {
    errors.push({ path: 'questions', message: '教案至少需要一題。' });
  } else {
    value.questions.forEach((question, index) => {
      const result = validatePracticeQuestion(question);
      for (const issue of result.errors) {
        errors.push({ path: `questions.${index}.${issue.path}`, message: issue.message });
      }
    });
  }
  if (!Array.isArray(value.sources)) {
    errors.push({ path: 'sources', message: '教案必須包含來源陣列。' });
  }
  return { valid: errors.length === 0, errors };
};

export class PracticeValidationError extends Error {
  readonly issues: PracticeValidationIssue[];

  constructor(message: string, issues: PracticeValidationIssue[]) {
    super(message);
    this.name = 'PracticeValidationError';
    this.issues = issues;
  }
}

export class PracticeImportError extends Error {
  readonly issues: PracticeValidationIssue[];

  constructor(message: string, issues: PracticeValidationIssue[]) {
    super(message);
    this.name = 'PracticeImportError';
    this.issues = issues;
  }
}

const unverifiedFixtureSource = (title: string, locator: string): Omit<PracticeSource, 'id'> => ({
  title,
  locator,
  status: 'unverified',
  notes: 'Mock fixture source; teacher should confirm or correct this provenance.',
});

export const PRACTICE_SUBJECT_FIXTURES: Record<PracticeSubject, PracticeSubjectFixture> = {
  english: {
    subject: 'english',
    label: '英文',
    templateId: 'tpl_english_teaching',
    defaultTopic: '日常情境字彙',
    lessonPlan: '先以生活情境引導，再用例句練習，最後以短題組檢核理解。',
    questions: [
      {
        prompt: 'Which word means「開心的」?',
        type: 'choice',
        options: ['happy', 'quiet', 'small'],
        answer: 'happy',
        explanation: 'happy 是「開心的」；quiet 是安靜的，small 是小的。',
        sources: [unverifiedFixtureSource('教師提供字彙表', '單元 1')],
      },
      {
        prompt: 'Complete the sentence: I ___ a student.',
        type: 'fill',
        answer: 'am',
        acceptedAnswers: ['am'],
        explanation: '主詞 I 搭配 be 動詞 am。',
        sources: [unverifiedFixtureSource('英文文法筆記', 'be 動詞')],
      },
      {
        prompt: 'Write one short sentence using “school”.',
        type: 'free-response',
        explanation: '請教師人工檢查句意、拼字與句型；本機不替自由回答打分。',
        sources: [unverifiedFixtureSource('教師課堂活動', '口說／寫作練習')],
      },
    ],
  },
  math: {
    subject: 'math',
    label: '數學',
    templateId: 'tpl_math_teaching',
    defaultTopic: '分數與等值分數',
    lessonPlan: '先用圖像表示分數，再比較分子分母，最後以計算題與生活題應用。',
    questions: [
      {
        prompt: '2 + 3 = ?',
        type: 'choice',
        options: ['4', '5', '6'],
        answer: '5',
        explanation: '把兩組數量合併，2 加 3 等於 5。',
        sources: [unverifiedFixtureSource('數學課本', '第 2 單元')],
      },
      {
        prompt: '一半用分數表示是 __。',
        type: 'fill',
        answer: '1/2',
        acceptedAnswers: ['1/2', '½'],
        explanation: '整體分成兩等份，取其中一份就是 1/2。',
        sources: [unverifiedFixtureSource('教師投影片', '分數表示')],
      },
      {
        prompt: '請用一句話說明為什麼 2/4 和 1/2 相等。',
        type: 'free-response',
        explanation: '請教師人工檢查是否說明約分或等量分割的理由。',
        sources: [unverifiedFixtureSource('課堂討論問題', '等值分數')],
      },
    ],
  },
  science: {
    subject: 'science',
    label: '自然',
    templateId: 'tpl_teaching_guidance',
    defaultTopic: '水的三態變化',
    lessonPlan: '從冰塊與水蒸氣的觀察開始，整理三態變化，再用生活例子做分類。',
    questions: [
      {
        prompt: '冰塊融化後會變成哪一種狀態?',
        type: 'choice',
        options: ['固態', '液態', '氣態'],
        answer: '液態',
        explanation: '冰塊受熱融化後成為液態的水。',
        sources: [unverifiedFixtureSource('自然課本', '水的變化')],
      },
      {
        prompt: '水煮沸產生的水蒸氣屬於 __ 態。',
        type: 'fill',
        answer: '氣',
        acceptedAnswers: ['氣', '氣態'],
        explanation: '水蒸氣是水的氣態形式。',
        sources: [unverifiedFixtureSource('實驗紀錄', '沸騰觀察')],
      },
      {
        prompt: '請舉一個生活中水蒸氣遇冷的例子。',
        type: 'free-response',
        explanation: '請教師人工判斷例子是否描述凝結現象。',
        sources: [unverifiedFixtureSource('生活觀察單', '凝結現象')],
      },
    ],
  },
};

/** Backward-friendly alias for fixture consumers. */
export const PRACTICE_FIXTURES = PRACTICE_SUBJECT_FIXTURES;

export const createPracticeLessonDraft = (input: PracticeLessonDraftInput): PracticeLesson => {
  const now = input.now ?? Date.now();
  const fixture = PRACTICE_SUBJECT_FIXTURES[input.subject];
  const topic = input.topic.trim() || fixture.defaultTopic;
  const title = input.title?.trim() || `${input.gradeLevel.trim() || '未指定年級'}｜${topic}`;
  const questions = fixture.questions.map((question, index) => ({
    ...question,
    id: createId(`question-${index}`),
    schemaVersion: PRACTICE_SCHEMA_VERSION,
    sources: question.sources.map((source, sourceIndex) => ({
      ...source,
      id: createId(`source-${index}-${sourceIndex}`),
    })),
    schemaValid: true,
  }));

  return {
    id: createId('lesson'),
    schemaVersion: PRACTICE_SCHEMA_VERSION,
    version: 1,
    title,
    gradeLevel: input.gradeLevel.trim(),
    subject: input.subject,
    templateId: fixture.templateId,
    topic,
    learningObjectives: parseObjectives(input.learningObjectives),
    lessonPlan: input.lessonPlan?.trim() || fixture.lessonPlan,
    questions,
    sources: [],
    ownerProfileId: input.profileId?.trim() || DEFAULT_PRACTICE_PROFILE_ID,
    generatedBy: 'mock',
    createdAt: now,
    updatedAt: now,
    schemaValid: true,
  };
};

export const createMockPracticeLesson = createPracticeLessonDraft;

export const createPracticeProfile = async (
  displayName = '本機匿名使用者',
  options: PracticeArchiveOperationOptions = {},
): Promise<PracticeProfile> => {
  const now = Date.now();
  const profile: PracticeProfile = {
    id: createId('profile'),
    displayName: displayName.trim() || '本機匿名使用者',
    anonymous: true,
    createdAt: now,
    updatedAt: now,
  };
  const db = await getPracticeDb();
  await withPracticeWrite(() => db.put(PROFILE_STORE, profile), options);
  return clone(profile);
};

export const savePracticeProfile = async (
  profile: PracticeProfile,
  options: PracticeArchiveOperationOptions = {},
): Promise<PracticeProfile> => {
  assertPracticeRecordNotArchiveManaged(profile);
  const normalized: PracticeProfile = {
    ...profile,
    displayName: profile.displayName.trim() || '本機匿名使用者',
    anonymous: true,
    updatedAt: Date.now(),
  };
  const db = await getPracticeDb();
  await withPracticeWrite(async () => {
    assertPracticeRecordNotArchiveManaged(await db.get(PROFILE_STORE, normalized.id));
    await db.put(PROFILE_STORE, normalized);
  }, options);
  return clone(normalized);
};

export const getPracticeProfile = async (
  profileId: string,
): Promise<PracticeProfile | undefined> => {
  const db = await getPracticeDb();
  return visibleRecord(await db.get(PROFILE_STORE, profileId));
};

export const listPracticeProfiles = async (): Promise<PracticeProfile[]> => {
  const db = await getPracticeDb();
  return visibleRecords(await db.getAll(PROFILE_STORE));
};

export const deletePracticeProfile = async (
  profileId: string,
  options: PracticeArchiveOperationOptions = {},
): Promise<void> => {
  await withPracticeWrite(async () => {
    const db = await getPracticeDb();
    assertPracticeRecordNotArchiveManaged(await db.get(PROFILE_STORE, profileId));
    const [lessons, attempts, bookmarks] = await Promise.all([
      visibleRecords(await db.getAllFromIndex(LESSON_STORE, 'by-profile', profileId)),
      visibleRecords(await db.getAllFromIndex(ATTEMPT_STORE, 'by-profile', profileId)),
      visibleRecords(await db.getAllFromIndex(BOOKMARK_STORE, 'by-profile', profileId)),
    ]);
    const tx = db.transaction(
      [PROFILE_STORE, LESSON_STORE, ATTEMPT_STORE, BOOKMARK_STORE],
      'readwrite',
    );
    await tx.objectStore(PROFILE_STORE).delete(profileId);
    for (const lesson of lessons) {
      await tx.objectStore(LESSON_STORE).delete(lesson.id);
    }
    for (const attempt of attempts) {
      await tx.objectStore(ATTEMPT_STORE).delete(attempt.id);
    }
    for (const bookmark of bookmarks) {
      await tx.objectStore(BOOKMARK_STORE).delete(bookmark.id);
    }
    await tx.done;
  }, options);
};

export const getActivePracticeProfileId = (): string | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.localStorage.getItem(PRACTICE_ACTIVE_PROFILE_KEY);
  } catch {
    return null;
  }
};

export const setActivePracticeProfileId = (profileId: string): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }
  try {
    window.localStorage.setItem(PRACTICE_ACTIVE_PROFILE_KEY, profileId);
    return true;
  } catch {
    return false;
  }
};

export const getOrCreatePracticeProfile = async (
  options: PracticeArchiveOperationOptions = {},
): Promise<PracticeProfile> => {
  const activeId = getActivePracticeProfileId();
  if (activeId) {
    const active = await getPracticeProfile(activeId);
    if (active) {
      return active;
    }
  }
  const existing = await listPracticeProfiles();
  if (existing[0]) {
    setActivePracticeProfileId(existing[0].id);
    return existing[0];
  }
  const created = await createPracticeProfile('本機匿名使用者', options);
  setActivePracticeProfileId(created.id);
  return created;
};

export const savePracticeLesson = async (
  lesson: PracticeLesson,
  options: PracticeArchiveOperationOptions = {},
): Promise<PracticeLesson> => {
  assertPracticeRecordNotArchiveManaged(lesson);
  const normalized = normalizeLesson({ ...lesson, updatedAt: Date.now() });
  const basicIssues: PracticeValidationIssue[] = [];
  if (!normalized.id.trim()) {
    basicIssues.push({ path: 'id', message: '教案缺少 id。' });
  }
  if (!normalized.title.trim()) {
    basicIssues.push({ path: 'title', message: '教案需要標題。' });
  }
  if (!normalized.ownerProfileId.trim()) {
    basicIssues.push({ path: 'ownerProfileId', message: '教案需要匿名 profile。' });
  }
  if (basicIssues.length) {
    throw new PracticeValidationError('教案基本欄位無效。', basicIssues);
  }
  const db = await getPracticeDb();
  await withPracticeWrite(async () => {
    assertPracticeRecordNotArchiveManaged(await db.get(LESSON_STORE, normalized.id));
    await db.put(LESSON_STORE, normalized);
  }, options);
  return clone(normalized);
};

export const getPracticeLesson = async (lessonId: string): Promise<PracticeLesson | undefined> => {
  const db = await getPracticeDb();
  return visibleRecord(await db.get(LESSON_STORE, lessonId));
};

export const listPracticeLessons = async (profileId?: string): Promise<PracticeLesson[]> => {
  const db = await getPracticeDb();
  const lessons = profileId
    ? await db.getAllFromIndex(LESSON_STORE, 'by-profile', profileId)
    : await db.getAll(LESSON_STORE);
  return visibleRecords(lessons).sort((left, right) => right.updatedAt - left.updatedAt);
};

export const deletePracticeLesson = async (
  lessonId: string,
  options: PracticeArchiveOperationOptions = {},
): Promise<void> => {
  await withPracticeWrite(async () => {
    const db = await getPracticeDb();
    assertPracticeRecordNotArchiveManaged(await db.get(LESSON_STORE, lessonId));
    const [attempts, bookmarks] = await Promise.all([
      visibleRecords(await db.getAllFromIndex(ATTEMPT_STORE, 'by-lesson', lessonId)),
      visibleRecords(await db.getAllFromIndex(BOOKMARK_STORE, 'by-lesson', lessonId)),
    ]);
    const tx = db.transaction([LESSON_STORE, ATTEMPT_STORE, BOOKMARK_STORE], 'readwrite');
    await tx.objectStore(LESSON_STORE).delete(lessonId);
    for (const attempt of attempts) {
      await tx.objectStore(ATTEMPT_STORE).delete(attempt.id);
    }
    for (const bookmark of bookmarks) {
      await tx.objectStore(BOOKMARK_STORE).delete(bookmark.id);
    }
    await tx.done;
  }, options);
};

export const updatePracticeQuestionSource = async (
  lessonId: string,
  questionId: string,
  sourceId: string,
  patch: Partial<Omit<PracticeSource, 'id'>>,
  options: PracticeArchiveOperationOptions = {},
): Promise<PracticeLesson> => {
  const lesson = await getPracticeLesson(lessonId);
  if (!lesson) {
    throw new Error('找不到要更新來源的教案。');
  }
  const questions = lesson.questions.map(question => {
    if (question.id !== questionId) {
      return question;
    }
    return {
      ...question,
      sources: question.sources.map(source =>
        source.id === sourceId
          ? normalizeSource({ ...source, ...patch, id: source.id }, 0)
          : source,
      ),
    };
  });
  return savePracticeLesson({ ...lesson, questions }, options);
};

const normalizeAnswer = (value: string): string => value.trim().toLocaleLowerCase();

const getQuestionAnswer = (question: PracticeQuestion): string | undefined =>
  question.answer ?? question.correctAnswer;

export const gradePracticeQuestion = (
  question: PracticeQuestion | unknown,
  response: unknown,
  now = Date.now(),
): PracticeGradeResult => {
  const validation = validatePracticeQuestion(question);
  if (!validation.valid) {
    return {
      status: 'ungraded-invalid',
      score: null,
      feedback: '題目 schema 無效，未計分。請先修正題幹、答案或來源欄位。',
      feedbackMode: 'offline',
      gradedAt: now,
    };
  }

  const typedQuestion = question as PracticeQuestion;
  const answer = typeof response === 'string' ? response : '';
  if (typedQuestion.type === 'free-response') {
    return {
      status: 'manual-review',
      score: null,
      feedback:
        '自由回答不會由本機自動評分；請教師人工批改，若要連線 AI 回饋也必須由教師明確啟用。',
      feedbackMode: 'manual',
      gradedAt: now,
    };
  }

  const accepted = [
    getQuestionAnswer(typedQuestion),
    ...(typedQuestion.acceptedAnswers ?? []),
  ].filter((value): value is string => typeof value === 'string');
  const correct = accepted.some(value => normalizeAnswer(value) === normalizeAnswer(answer));
  return {
    status: correct ? 'correct' : 'incorrect',
    score: correct ? 1 : 0,
    feedback: correct ? '答對了。' : `再試一次，參考解說：${typedQuestion.explanation}`,
    feedbackMode: 'offline',
    gradedAt: now,
  };
};

export interface PracticeAttemptInput {
  profileId: string;
  lessonId: string;
  questionId: string;
  response: string;
  now?: number;
  operationToken?: WorkspaceOperationToken;
}

export const recordPracticeAttempt = async (
  input: PracticeAttemptInput,
): Promise<{ attempt: PracticeAttempt; lesson: PracticeLesson; question: PracticeQuestion }> => {
  const db = await getPracticeDb();
  return withPracticeWrite(
    async () => {
      const rawProfile = await db.get(PROFILE_STORE, input.profileId);
      const rawLesson = await db.get(LESSON_STORE, input.lessonId);
      assertPracticeRecordNotArchiveManaged(rawProfile);
      assertPracticeRecordNotArchiveManaged(rawLesson);
      const lesson = visibleRecord(rawLesson);
      const question = lesson?.questions.find(item => item.id === input.questionId);
      if (!lesson || !question) {
        const result = gradePracticeQuestion({}, input.response, input.now);
        const missingQuestion: PracticeQuestion = {
          id: input.questionId,
          schemaVersion: 0,
          prompt: '',
          type: 'free-response',
          explanation: '',
          sources: [],
          schemaValid: false,
          validationErrors: ['找不到題目。'],
        };
        const missingLesson: PracticeLesson = lesson ?? {
          id: input.lessonId,
          schemaVersion: 0,
          version: 0,
          title: '',
          gradeLevel: '',
          subject: 'english',
          topic: '',
          learningObjectives: [],
          lessonPlan: '',
          questions: [],
          sources: [],
          ownerProfileId: input.profileId,
          generatedBy: 'teacher',
          createdAt: input.now ?? Date.now(),
          updatedAt: input.now ?? Date.now(),
          schemaValid: false,
        };
        const attempt: PracticeAttempt = {
          id: createId('attempt'),
          schemaVersion: PRACTICE_SCHEMA_VERSION,
          profileId: input.profileId,
          lessonId: input.lessonId,
          lessonVersion: missingLesson.version,
          questionId: input.questionId,
          response: input.response,
          result,
          submittedAt: input.now ?? Date.now(),
        };
        await db.put(ATTEMPT_STORE, attempt);
        return { attempt: clone(attempt), lesson: clone(missingLesson), question: missingQuestion };
      }

      const submittedAt = input.now ?? Date.now();
      const attempt: PracticeAttempt = {
        id: createId('attempt'),
        schemaVersion: PRACTICE_SCHEMA_VERSION,
        profileId: input.profileId,
        lessonId: input.lessonId,
        lessonVersion: lesson.version,
        questionId: input.questionId,
        response: input.response,
        result: gradePracticeQuestion(question, input.response, submittedAt),
        submittedAt,
      };
      await db.put(ATTEMPT_STORE, attempt);
      return { attempt: clone(attempt), lesson: clone(lesson), question: clone(question) };
    },
    { operationToken: input.operationToken },
  );
};

export const submitPracticeAnswer = recordPracticeAttempt;

export const listPracticeAttempts = async (
  profileId: string,
  lessonId?: string,
): Promise<PracticeAttempt[]> => {
  const db = await getPracticeDb();
  const attempts = await db.getAllFromIndex(ATTEMPT_STORE, 'by-profile', profileId);
  return visibleRecords(attempts)
    .filter(attempt => !lessonId || attempt.lessonId === lessonId)
    .sort((left, right) => right.submittedAt - left.submittedAt);
};

export const calculatePracticeReviewAt = (attempt: PracticeAttempt, incorrectCount = 1): number => {
  const intervals = [24 * 60 * 60 * 1000, 3 * 24 * 60 * 60 * 1000, 7 * 24 * 60 * 60 * 1000];
  return (
    attempt.submittedAt + intervals[Math.min(Math.max(incorrectCount - 1, 0), intervals.length - 1)]
  );
};

export const listPracticeMistakes = async (profileId: string): Promise<PracticeMistake[]> => {
  const attempts = await listPracticeAttempts(profileId);
  const byQuestion = new Map<string, PracticeAttempt[]>();
  for (const attempt of attempts) {
    if (attempt.result.status !== 'incorrect') {
      continue;
    }
    const key = `${attempt.lessonId}:${attempt.questionId}`;
    const list = byQuestion.get(key) ?? [];
    list.push(attempt);
    byQuestion.set(key, list);
  }

  const results: PracticeMistake[] = [];
  for (const [key, questionAttempts] of byQuestion) {
    const [lessonId, questionId] = key.split(':');
    const lesson = await getPracticeLesson(lessonId);
    results.push({
      profileId,
      lessonId,
      questionId,
      lesson,
      question: lesson?.questions.find(question => question.id === questionId),
      latestAttempt: questionAttempts[0],
      incorrectCount: questionAttempts.length,
    });
  }
  return results.sort(
    (left, right) => right.latestAttempt.submittedAt - left.latestAttempt.submittedAt,
  );
};

export const savePracticeBookmark = async (
  profileId: string,
  lessonId: string,
  questionId: string,
  options: PracticeArchiveOperationOptions = {},
): Promise<PracticeBookmark> => {
  const db = await getPracticeDb();
  return withPracticeWrite(async () => {
    assertPracticeRecordNotArchiveManaged(await db.get(PROFILE_STORE, profileId));
    assertPracticeRecordNotArchiveManaged(await db.get(LESSON_STORE, lessonId));
    const rawBookmarks = await db.getAllFromIndex(BOOKMARK_STORE, 'by-profile', profileId);
    rawBookmarks.forEach(assertPracticeRecordNotArchiveManaged);
    const existing = visibleRecords(rawBookmarks).find(
      bookmark => bookmark.lessonId === lessonId && bookmark.questionId === questionId,
    );
    if (existing) {
      return existing;
    }
    const bookmark: PracticeBookmark = {
      id: createId('bookmark'),
      schemaVersion: PRACTICE_SCHEMA_VERSION,
      profileId,
      lessonId,
      questionId,
      createdAt: Date.now(),
    };
    await db.put(BOOKMARK_STORE, bookmark);
    return clone(bookmark);
  }, options);
};

export const deletePracticeBookmark = async (
  profileId: string,
  lessonId: string,
  questionId: string,
  options: PracticeArchiveOperationOptions = {},
): Promise<void> => {
  await withPracticeWrite(async () => {
    const db = await getPracticeDb();
    assertPracticeRecordNotArchiveManaged(await db.get(PROFILE_STORE, profileId));
    assertPracticeRecordNotArchiveManaged(await db.get(LESSON_STORE, lessonId));
    const rawBookmarks = await db.getAllFromIndex(BOOKMARK_STORE, 'by-profile', profileId);
    rawBookmarks.forEach(assertPracticeRecordNotArchiveManaged);
    const bookmarks = visibleRecords(rawBookmarks);
    const tx = db.transaction(BOOKMARK_STORE, 'readwrite');
    for (const bookmark of bookmarks) {
      if (bookmark.lessonId === lessonId && bookmark.questionId === questionId) {
        await tx.store.delete(bookmark.id);
      }
    }
    await tx.done;
  }, options);
};

export const listPracticeBookmarks = async (profileId: string): Promise<PracticeBookmark[]> => {
  const db = await getPracticeDb();
  return visibleRecords(await db.getAllFromIndex(BOOKMARK_STORE, 'by-profile', profileId));
};

/**
 * Review is calculated only when called by the opened app. Nothing schedules a
 * background notification or writes a future job.
 */
export const getPracticeReviewQueue = async (
  profileId: string,
  now = Date.now(),
): Promise<PracticeReviewItem[]> => {
  const [mistakes, bookmarks] = await Promise.all([
    listPracticeMistakes(profileId),
    listPracticeBookmarks(profileId),
  ]);
  const items: PracticeReviewItem[] = [];
  for (const mistake of mistakes) {
    const nextReviewAt = calculatePracticeReviewAt(mistake.latestAttempt, mistake.incorrectCount);
    if (nextReviewAt <= now) {
      items.push({
        id: `mistake:${mistake.lessonId}:${mistake.questionId}`,
        profileId,
        lessonId: mistake.lessonId,
        questionId: mistake.questionId,
        reason: 'mistake',
        nextReviewAt,
        lesson: mistake.lesson,
        question: mistake.question,
        latestAttempt: mistake.latestAttempt,
      });
    }
  }
  for (const bookmark of bookmarks) {
    if (
      !items.some(
        item => item.lessonId === bookmark.lessonId && item.questionId === bookmark.questionId,
      )
    ) {
      items.push({
        id: `bookmark:${bookmark.lessonId}:${bookmark.questionId}`,
        profileId,
        lessonId: bookmark.lessonId,
        questionId: bookmark.questionId,
        reason: 'bookmark',
        nextReviewAt: bookmark.createdAt,
        lesson: await getPracticeLesson(bookmark.lessonId),
        question: (await getPracticeLesson(bookmark.lessonId))?.questions.find(
          question => question.id === bookmark.questionId,
        ),
      });
    }
  }
  return items.sort((left, right) => left.nextReviewAt - right.nextReviewAt);
};

export const buildPracticeMarkdown = (
  lesson: PracticeLesson,
  options: { includeAnswers?: boolean } = {},
): string => {
  const includeAnswers = options.includeAnswers !== false;
  const lines = [
    `# ${lesson.title}`,
    '',
    `- 年級：${lesson.gradeLevel}`,
    `- 科目：${lesson.subject}`,
    `- 主題：${lesson.topic}`,
    `- 學習目標：${lesson.learningObjectives.join('；') || '未設定'}`,
    '',
    '## 教學流程',
    '',
    lesson.lessonPlan || '未設定',
    '',
    '## 題組',
    '',
  ];
  lesson.questions.forEach((question, index) => {
    lines.push(`${index + 1}. ${question.prompt}`);
    if (question.type === 'choice' && question.options?.length) {
      question.options.forEach(option => lines.push(`   - ${option}`));
    }
    if (includeAnswers && question.type !== 'free-response') {
      const answer =
        getQuestionAnswer(question) ?? question.acceptedAnswers?.join('、') ?? '未設定';
      lines.push(`   - 答案：${answer}`);
    }
    if (includeAnswers) {
      lines.push(`   - 解說：${question.explanation || '未設定'}`);
    }
    if (question.sources.length) {
      lines.push(
        `   - 來源：${question.sources
          .map(
            source =>
              `${source.title}（${source.status === 'verified' ? '教師已確認' : '未驗證，請確認'}）`,
          )
          .join('；')}`,
      );
    } else {
      lines.push('   - 來源：未提供');
    }
    lines.push('');
  });
  return lines.join('\n');
};

const stripLessonOwner = (lesson: PracticeLesson): PracticeShareLesson => {
  const shareLesson = clone(lesson) as Omit<PracticeLesson, 'ownerProfileId'> & {
    ownerProfileId?: string;
  };
  delete shareLesson.ownerProfileId;
  return shareLesson as PracticeShareLesson;
};

const buildManifest = (
  mode: PracticeExportMode,
  recordCounts: Record<string, number>,
): PracticeExportManifest => ({
  format: mode === 'f1-backup' ? PRACTICE_ARCHIVE_FORMAT : PRACTICE_EXPORT_FORMAT,
  schemaVersion: PRACTICE_SCHEMA_VERSION,
  mode,
  exportedAt: Date.now(),
  recordCounts,
});

export const exportPracticeArchive = async (
  options: PracticeArchiveOperationOptions = {},
): Promise<PracticeExportEnvelope> =>
  withWorkspaceDatabaseOperation(options, async () => {
    const db = await getPracticeDb();
    const tx = db.transaction(
      [PROFILE_STORE, LESSON_STORE, ATTEMPT_STORE, BOOKMARK_STORE],
      'readonly',
    );
    const [profiles, lessons, attempts, bookmarks] = await Promise.all([
      tx.objectStore(PROFILE_STORE).getAll(),
      tx.objectStore(LESSON_STORE).getAll(),
      tx.objectStore(ATTEMPT_STORE).getAll(),
      tx.objectStore(BOOKMARK_STORE).getAll(),
    ]);
    await tx.done;
    const records: PracticeArchiveRecords = {
      schemaVersion: PRACTICE_SCHEMA_VERSION,
      profiles: visibleRecords(profiles),
      lessons: visibleRecords(lessons),
      attempts: visibleRecords(attempts),
      bookmarks: visibleRecords(bookmarks),
    };
    return {
      manifest: buildManifest('f1-backup', {
        profiles: records.profiles.length,
        lessons: records.lessons.length,
        attempts: records.attempts.length,
        bookmarks: records.bookmarks.length,
      }),
      records,
    };
  });

/** Internal archive conflict/rollback enumeration; unlike app readers it includes staged rows. */
export const listPracticeArchiveRecordIds = async (
  options: PracticeArchiveOperationOptions = {},
): Promise<string[]> =>
  withWorkspaceDatabaseOperation(options, async () => {
    const db = await getPracticeDb();
    const tx = db.transaction(
      [PROFILE_STORE, LESSON_STORE, ATTEMPT_STORE, BOOKMARK_STORE],
      'readonly',
    );
    const [profiles, lessons, attempts, bookmarks] = await Promise.all([
      tx.objectStore(PROFILE_STORE).getAll(),
      tx.objectStore(LESSON_STORE).getAll(),
      tx.objectStore(ATTEMPT_STORE).getAll(),
      tx.objectStore(BOOKMARK_STORE).getAll(),
    ]);
    await tx.done;
    return [
      ...profiles.map(record => record.id),
      ...lessons.map(record => record.id),
      ...attempts.map(record => record.id),
      ...bookmarks.map(record => record.id),
    ];
  });

export const buildPracticeTeachingExport = (lessons: PracticeLesson[]): PracticeExportEnvelope => ({
  manifest: buildManifest('teaching-share', { lessons: lessons.length }),
  records: { lessons: lessons.map(stripLessonOwner) },
});

export const exportPracticeTeachingShare = async (
  profileId?: string,
): Promise<PracticeExportEnvelope> =>
  buildPracticeTeachingExport(await listPracticeLessons(profileId));

export const serializePracticeExport = (value: PracticeExportEnvelope): string =>
  JSON.stringify(value, null, 2);

const isManifest = (value: unknown): value is PracticeExportManifest => {
  if (!isRecord(value)) {
    return false;
  }
  return (
    (value.format === PRACTICE_EXPORT_FORMAT || value.format === PRACTICE_ARCHIVE_FORMAT) &&
    value.schemaVersion === PRACTICE_SCHEMA_VERSION &&
    (value.mode === 'teaching-share' || value.mode === 'f1-backup') &&
    typeof value.exportedAt === 'number' &&
    isRecord(value.recordCounts)
  );
};

const parseRawExport = (value: unknown): PracticeExportParseResult => {
  const errors: PracticeValidationIssue[] = [];
  const warnings: PracticeValidationIssue[] = [];
  if (!isRecord(value) || !isManifest(value.manifest) || !isRecord(value.records)) {
    return {
      ok: false,
      data: null,
      errors: [{ path: '', message: '不是有效的 EduCare 練習工作區匯出檔。' }],
      warnings: [],
    };
  }

  const manifest = value.manifest;
  const records = value.records as Record<string, unknown>;
  if (!Array.isArray(records.lessons)) {
    errors.push({ path: 'records.lessons', message: '匯出檔缺少教案陣列。' });
  }
  if (manifest.mode === 'f1-backup') {
    for (const key of ['profiles', 'attempts', 'bookmarks'] as const) {
      if (!Array.isArray(records[key])) {
        errors.push({ path: `records.${key}`, message: `完整備份缺少 ${key} 陣列。` });
      }
    }
    if (records.schemaVersion !== PRACTICE_SCHEMA_VERSION) {
      errors.push({ path: 'records.schemaVersion', message: '完整備份 records 版本不受支援。' });
    }
  }
  if (errors.length) {
    return { ok: false, data: null, errors, warnings };
  }

  const rawLessons: unknown[] = Array.isArray(records.lessons) ? records.lessons : [];
  const seenLessonIds = new Set<string>();
  const lessons = rawLessons.map((lesson: unknown, index: number) => {
    const normalized = normalizeLesson(lesson, index);
    if (seenLessonIds.has(normalized.id)) {
      errors.push({
        path: `records.lessons.${index}.id`,
        message: '教案不可有重複 id。',
      });
    }
    seenLessonIds.add(normalized.id);
    const validation = validatePracticeLesson(normalized);
    for (const issue of validation.errors) {
      if (issue.path.startsWith('questions.')) {
        warnings.push({ path: `records.lessons.${index}.${issue.path}`, message: issue.message });
      } else {
        errors.push({ path: `records.lessons.${index}.${issue.path}`, message: issue.message });
      }
    }
    const seenQuestionIds = new Set<string>();
    normalized.questions.forEach((question, questionIndex) => {
      if (seenQuestionIds.has(question.id)) {
        errors.push({
          path: `records.lessons.${index}.questions.${questionIndex}.id`,
          message: '同一教案不可有重複題目 id。',
        });
      }
      seenQuestionIds.add(question.id);
    });
    return normalized;
  });

  if (errors.length) {
    return { ok: false, data: null, errors, warnings };
  }
  if (manifest.mode === 'teaching-share') {
    return {
      ok: true,
      data: { manifest, records: { lessons: lessons.map(stripLessonOwner) } },
      errors: [],
      warnings,
    };
  }

  const rawProfiles: unknown[] = Array.isArray(records.profiles) ? records.profiles : [];
  const rawAttempts: unknown[] = Array.isArray(records.attempts) ? records.attempts : [];
  const rawBookmarks: unknown[] = Array.isArray(records.bookmarks) ? records.bookmarks : [];
  const assertUniqueIds = (values: unknown[], path: string, label: string): void => {
    const seen = new Set<string>();
    values.forEach((value, index) => {
      const id = isRecord(value) && typeof value.id === 'string' ? value.id : undefined;
      if (!id) {
        return;
      }
      if (seen.has(id)) {
        errors.push({
          path: `${path}.${index}.id`,
          message: `${label}不可有重複 id。`,
        });
      }
      seen.add(id);
    });
  };
  assertUniqueIds(rawProfiles, 'records.profiles', 'profile');
  assertUniqueIds(rawAttempts, 'records.attempts', 'attempt');
  assertUniqueIds(rawBookmarks, 'records.bookmarks', 'bookmark');
  rawProfiles.forEach((profile, index) => {
    if (!isPracticeProfile(profile)) {
      errors.push({ path: `records.profiles.${index}`, message: 'profile 資料格式錯誤。' });
    }
  });
  rawAttempts.forEach((attempt, index) => {
    if (!isPracticeAttempt(attempt)) {
      errors.push({ path: `records.attempts.${index}`, message: 'attempt 資料格式錯誤。' });
    }
  });
  rawBookmarks.forEach((bookmark, index) => {
    if (!isPracticeBookmark(bookmark)) {
      errors.push({ path: `records.bookmarks.${index}`, message: 'bookmark 資料格式錯誤。' });
    }
  });
  if (errors.length) {
    return { ok: false, data: null, errors, warnings };
  }
  const archiveRecords: PracticeArchiveRecords = {
    schemaVersion: PRACTICE_SCHEMA_VERSION,
    profiles: rawProfiles.filter(isPracticeProfile),
    lessons,
    attempts: rawAttempts.filter(isPracticeAttempt),
    bookmarks: rawBookmarks.filter(isPracticeBookmark),
  };
  return { ok: true, data: { manifest, records: archiveRecords }, errors: [], warnings };
};

const isPracticeProfile = (value: unknown): value is PracticeProfile =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  value.id.trim().length > 0 &&
  typeof value.displayName === 'string' &&
  value.displayName.trim().length > 0 &&
  value.anonymous === true &&
  isFiniteNumber(value.createdAt) &&
  isFiniteNumber(value.updatedAt);

const isPracticeAttempt = (value: unknown): value is PracticeAttempt => {
  if (!isRecord(value)) {
    return false;
  }
  const result = value.result;
  if (!isRecord(result)) {
    return false;
  }
  const validStatus =
    result.status === 'correct' ||
    result.status === 'incorrect' ||
    result.status === 'manual-review' ||
    result.status === 'ungraded-invalid';
  const validFeedbackMode =
    result.feedbackMode === 'offline' ||
    result.feedbackMode === 'manual' ||
    result.feedbackMode === 'online-ai';
  const validScore = result.score === null || isFiniteNumber(result.score);
  return (
    typeof value.id === 'string' &&
    value.id.trim().length > 0 &&
    value.schemaVersion === PRACTICE_SCHEMA_VERSION &&
    typeof value.profileId === 'string' &&
    value.profileId.trim().length > 0 &&
    typeof value.lessonId === 'string' &&
    value.lessonId.trim().length > 0 &&
    isFiniteNumber(value.lessonVersion) &&
    typeof value.questionId === 'string' &&
    value.questionId.trim().length > 0 &&
    typeof value.response === 'string' &&
    validStatus &&
    validScore &&
    typeof result.feedback === 'string' &&
    validFeedbackMode &&
    isFiniteNumber(result.gradedAt) &&
    isFiniteNumber(value.submittedAt)
  );
};

const isPracticeBookmark = (value: unknown): value is PracticeBookmark =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  value.id.trim().length > 0 &&
  value.schemaVersion === PRACTICE_SCHEMA_VERSION &&
  typeof value.profileId === 'string' &&
  value.profileId.trim().length > 0 &&
  typeof value.lessonId === 'string' &&
  value.lessonId.trim().length > 0 &&
  typeof value.questionId === 'string' &&
  value.questionId.trim().length > 0 &&
  isFiniteNumber(value.createdAt);

export const parsePracticeExport = (text: string): PracticeExportParseResult => {
  try {
    return parseRawExport(JSON.parse(text));
  } catch {
    return {
      ok: false,
      data: null,
      errors: [{ path: '', message: '匯出檔不是有效 JSON。' }],
      warnings: [],
    };
  }
};

const asExportEnvelope = (
  input: PracticeExportEnvelope | PracticeArchiveRecords | string,
): PracticeExportEnvelope => {
  const parseFailure = (issues: PracticeValidationIssue[]): PracticeImportError =>
    new PracticeImportError(
      `練習資料匯入失敗：${issues[0]?.message ?? '匯出檔格式無效。'}`,
      issues,
    );
  if (typeof input === 'string') {
    const parsed = parsePracticeExport(input);
    if (!parsed.ok || !parsed.data) {
      throw parseFailure(parsed.errors);
    }
    return parsed.data;
  }
  if (isRecord(input) && 'manifest' in input) {
    const parsed = parseRawExport(input);
    if (!parsed.ok || !parsed.data) {
      throw parseFailure(parsed.errors);
    }
    return parsed.data;
  }
  const records = input as PracticeArchiveRecords;
  const parsed = parseRawExport({
    manifest: buildManifest('f1-backup', {
      profiles: records.profiles?.length ?? 0,
      lessons: records.lessons?.length ?? 0,
      attempts: records.attempts?.length ?? 0,
      bookmarks: records.bookmarks?.length ?? 0,
    }),
    records,
  });
  if (!parsed.ok || !parsed.data) {
    throw parseFailure(parsed.errors);
  }
  return parsed.data;
};

const copyLesson = (
  lesson: PracticeLesson,
  ownerProfileId: string,
  now: number,
  plannedLessonId?: string,
): { lesson: PracticeLesson; questionIds: string[]; questionMap: Map<string, string> } => {
  const questionMap = new Map<string, string>();
  const questions = lesson.questions.map((question, index) => {
    const copiedId = createId(`question-copy-${index}`);
    questionMap.set(question.id, copiedId);
    return { ...clone(question), id: copiedId };
  });
  return {
    lesson: {
      ...clone(lesson),
      id: plannedLessonId || createId('lesson-copy'),
      ownerProfileId,
      questions,
      createdAt: now,
      updatedAt: now,
    },
    questionIds: questions.map(question => question.id),
    questionMap,
  };
};

interface PreparedPracticeImport {
  records: PracticeArchiveRecords;
  copiedIds: PracticeImportResult['copiedIds'];
  warnings: PracticeValidationIssue[];
  questionIdsByLesson: Record<string, string[]>;
}

const plannedRecordId = (
  options: PracticeArchiveImportOptions,
  kind: PracticeImportRecordKind,
  sourceId: string,
  prefix: string,
): string => options.plannedIds?.[kind]?.[sourceId] || createId(prefix);

const assertNoDuplicatePlannedDestinationIds = (
  plannedIds: PracticeArchiveImportOptions['plannedIds'],
): void => {
  if (!plannedIds) {
    return;
  }
  const destinations = new Map<string, string>();
  for (const [kind, records] of Object.entries(plannedIds)) {
    if (!records) {
      continue;
    }
    for (const [sourceId, destinationId] of Object.entries(records)) {
      if (!destinationId.trim()) {
        throw new PracticeImportError('匯入 destination id 無效。', [
          { path: `${kind}.${sourceId}`, message: 'destination id 不可為空。' },
        ]);
      }
      const previous = destinations.get(destinationId);
      if (previous) {
        throw new PracticeImportError('匯入 destination id 重複。', [
          {
            path: `${kind}.${sourceId}`,
            message: `${destinationId} 同時對應 ${previous}，已拒絕 last-write-wins。`,
          },
        ]);
      }
      destinations.set(destinationId, `${kind}.${sourceId}`);
    }
  }
};

const preparePracticeImport = async (
  envelope: PracticeExportEnvelope,
  options: PracticeArchiveImportOptions,
  targetProfileId: string | undefined,
  now: number,
): Promise<PreparedPracticeImport> => {
  assertNoDuplicatePlannedDestinationIds(options.plannedIds);
  const copiedIds = emptyCopiedIds();
  const warnings: PracticeValidationIssue[] = [];
  const profiles: PracticeProfile[] = [];
  const lessons: PracticeLesson[] = [];
  const attempts: PracticeAttempt[] = [];
  const bookmarks: PracticeBookmark[] = [];
  const questionIdsByLesson: Record<string, string[]> = {};
  const profileMap = new Map<string, string>();
  const lessonMap = new Map<string, string>();
  const questionMapByLesson = new Map<string, Map<string, string>>();
  const records = envelope.records;

  const rememberCopiedLesson = (
    sourceLessonId: string,
    copied: ReturnType<typeof copyLesson>,
  ): void => {
    lessons.push(copied.lesson);
    copiedIds.lessonIds.push(copied.lesson.id);
    copiedIds.questionIds.push(...copied.questionIds);
    lessonMap.set(sourceLessonId, copied.lesson.id);
    questionMapByLesson.set(sourceLessonId, copied.questionMap);
    questionIdsByLesson[copied.lesson.id] = [...copied.questionIds];
  };

  if (envelope.manifest.mode === 'teaching-share') {
    if (!targetProfileId) {
      throw new Error('教學分享匯入需要本機匿名 profile。');
    }
    for (const lesson of records.lessons) {
      const copied = copyLesson(
        normalizeLesson({ ...lesson, ownerProfileId: targetProfileId }),
        targetProfileId,
        now,
        plannedRecordId(options, 'lessons', lesson.id, 'lesson-copy'),
      );
      rememberCopiedLesson(lesson.id, copied);
    }
  } else {
    const archiveRecords = records as PracticeArchiveRecords;
    for (const profile of archiveRecords.profiles) {
      const copiedProfile: PracticeProfile = {
        ...clone(profile),
        id: plannedRecordId(options, 'profiles', profile.id, 'profile-copy'),
        createdAt: now,
        updatedAt: now,
      };
      profiles.push(copiedProfile);
      profileMap.set(profile.id, copiedProfile.id);
      copiedIds.profileIds.push(copiedProfile.id);
    }
    for (const lesson of archiveRecords.lessons) {
      const ownerProfileId = profileMap.get(lesson.ownerProfileId);
      if (!ownerProfileId) {
        throw new PracticeImportError('教案 owner profile 關聯無效。', [
          {
            path: `lessons.${lesson.id}.ownerProfileId`,
            message: `找不到匯入來源 profile：${lesson.ownerProfileId}。`,
          },
        ]);
      }
      const copied = copyLesson(
        lesson,
        ownerProfileId,
        now,
        plannedRecordId(options, 'lessons', lesson.id, 'lesson-copy'),
      );
      rememberCopiedLesson(lesson.id, copied);
    }
    for (const attempt of archiveRecords.attempts) {
      const lessonId = lessonMap.get(attempt.lessonId);
      const questionId = questionMapByLesson.get(attempt.lessonId)?.get(attempt.questionId);
      const profileId = profileMap.get(attempt.profileId);
      if (!lessonId) {
        throw new PracticeImportError('練習匯入關聯資料無效：找不到關聯教案。', [
          { path: `attempts.${attempt.id}.lessonId`, message: '找不到關聯教案。' },
        ]);
      }
      if (!questionId) {
        throw new PracticeImportError('練習匯入關聯資料無效：找不到關聯題目。', [
          { path: `attempts.${attempt.id}.questionId`, message: '找不到關聯題目。' },
        ]);
      }
      if (!profileId) {
        throw new PracticeImportError('練習匯入關聯資料無效：找不到關聯 profile。', [
          { path: `attempts.${attempt.id}.profileId`, message: '找不到關聯 profile。' },
        ]);
      }
      const copiedAttempt: PracticeAttempt = {
        ...clone(attempt),
        id: plannedRecordId(options, 'attempts', attempt.id, 'attempt-copy'),
        profileId,
        lessonId,
        questionId,
      };
      attempts.push(copiedAttempt);
      copiedIds.attemptIds.push(copiedAttempt.id);
    }
    for (const bookmark of archiveRecords.bookmarks) {
      const lessonId = lessonMap.get(bookmark.lessonId);
      const questionId = questionMapByLesson.get(bookmark.lessonId)?.get(bookmark.questionId);
      const profileId = profileMap.get(bookmark.profileId);
      if (!lessonId) {
        throw new PracticeImportError('練習匯入關聯資料無效：找不到關聯教案。', [
          { path: `bookmarks.${bookmark.id}.lessonId`, message: '找不到關聯教案。' },
        ]);
      }
      if (!questionId) {
        throw new PracticeImportError('練習匯入關聯資料無效：找不到關聯題目。', [
          { path: `bookmarks.${bookmark.id}.questionId`, message: '找不到關聯題目。' },
        ]);
      }
      if (!profileId) {
        throw new PracticeImportError('練習匯入關聯資料無效：找不到關聯 profile。', [
          { path: `bookmarks.${bookmark.id}.profileId`, message: '找不到關聯 profile。' },
        ]);
      }
      const copiedBookmark: PracticeBookmark = {
        ...clone(bookmark),
        id: plannedRecordId(options, 'bookmarks', bookmark.id, 'bookmark-copy'),
        profileId,
        lessonId,
        questionId,
      };
      bookmarks.push(copiedBookmark);
      copiedIds.bookmarkIds.push(copiedBookmark.id);
    }
  }

  return {
    records: {
      schemaVersion: PRACTICE_SCHEMA_VERSION,
      profiles,
      lessons,
      attempts,
      bookmarks,
    },
    copiedIds,
    warnings,
    questionIdsByLesson,
  };
};

const assertNoPracticeImportCollisions = async (
  db: IDBPDatabase<PracticeDB>,
  copiedIds: PracticeImportResult['copiedIds'],
): Promise<void> => {
  const seenDestinationIds = new Set<string>();
  for (const ids of Object.values(copiedIds)) {
    for (const id of ids) {
      if (seenDestinationIds.has(id)) {
        throw new PracticeImportError('匯入 destination id 重複。', [
          { path: id, message: '匯入資料含有重複 destination id，已拒絕 last-write-wins。' },
        ]);
      }
      seenDestinationIds.add(id);
    }
  }
  type PracticeDataStore =
    | typeof PROFILE_STORE
    | typeof LESSON_STORE
    | typeof ATTEMPT_STORE
    | typeof BOOKMARK_STORE;
  const checks: Array<[keyof PracticeImportResult['copiedIds'], PracticeDataStore]> = [
    ['profileIds', PROFILE_STORE],
    ['lessonIds', LESSON_STORE],
    ['attemptIds', ATTEMPT_STORE],
    ['bookmarkIds', BOOKMARK_STORE],
  ];
  for (const [kind, store] of checks) {
    for (const id of copiedIds[kind]) {
      if (await db.get(store, id)) {
        throw new PracticeImportError('練習資料匯入會覆寫既有資料。', [
          { path: `${kind}.${id}`, message: '匯入 id 已存在，已拒絕覆寫。' },
        ]);
      }
    }
  }
};

const tagPreparedPracticeRecords = (
  records: PracticeArchiveRecords,
  importId: string,
  visibility: PracticeImportVisibility,
): PracticeArchiveRecords => {
  if (visibility === 'visible') {
    return clone(records);
  }
  return {
    schemaVersion: records.schemaVersion,
    profiles: records.profiles.map(record => tagWorkspaceArchiveRecord(record, importId)),
    lessons: records.lessons.map(record => tagWorkspaceArchiveRecord(record, importId)),
    attempts: records.attempts.map(record => tagWorkspaceArchiveRecord(record, importId)),
    bookmarks: records.bookmarks.map(record => tagWorkspaceArchiveRecord(record, importId)),
  };
};

const persistPracticeImport = async (
  db: IDBPDatabase<PracticeDB>,
  prepared: PreparedPracticeImport,
  importId: string,
  visibility: PracticeImportVisibility,
  now: number,
): Promise<void> => {
  const log: PracticeImportLog = {
    token: importId,
    importId,
    visibility,
    state: visibility === 'hidden' ? 'staged' : 'published',
    copiedIds: copyCopiedIds(prepared.copiedIds),
    plannedIds: copyCopiedIds(prepared.copiedIds),
    questionIdsByLesson: copyQuestionIdsByLesson(prepared.questionIdsByLesson),
    createdAt: now,
    updatedAt: now,
  };
  const records = tagPreparedPracticeRecords(prepared.records, importId, visibility);
  if (visibility === 'hidden') {
    // The ownership journal is durable before any provider row is visible to a reader.
    await db.put(IMPORT_STORE, log);
    const tx = db.transaction(
      [PROFILE_STORE, LESSON_STORE, ATTEMPT_STORE, BOOKMARK_STORE],
      'readwrite',
    );
    for (const record of records.profiles) {
      await tx.objectStore(PROFILE_STORE).put(record);
    }
    for (const record of records.lessons) {
      await tx.objectStore(LESSON_STORE).put(record);
    }
    for (const record of records.attempts) {
      await tx.objectStore(ATTEMPT_STORE).put(record);
    }
    for (const record of records.bookmarks) {
      await tx.objectStore(BOOKMARK_STORE).put(record);
    }
    await tx.done;
    await db.put(IMPORT_STORE, { ...log, updatedAt: Date.now() });
    return;
  }

  // Standalone teaching-share imports are immediately visible as one transaction.
  const tx = db.transaction(
    [PROFILE_STORE, LESSON_STORE, ATTEMPT_STORE, BOOKMARK_STORE, IMPORT_STORE],
    'readwrite',
  );
  await tx.objectStore(IMPORT_STORE).put(log);
  for (const record of records.profiles) {
    await tx.objectStore(PROFILE_STORE).put(record);
  }
  for (const record of records.lessons) {
    await tx.objectStore(LESSON_STORE).put(record);
  }
  for (const record of records.attempts) {
    await tx.objectStore(ATTEMPT_STORE).put(record);
  }
  for (const record of records.bookmarks) {
    await tx.objectStore(BOOKMARK_STORE).put(record);
  }
  await tx.done;
};

export const importPracticeArchive = async (
  input: PracticeExportEnvelope | PracticeArchiveRecords | string,
  options: PracticeArchiveImportOptions = {},
): Promise<PracticeImportResult> => {
  const envelope = asExportEnvelope(input);
  assertNoDuplicatePlannedDestinationIds(options.plannedIds);
  const now = Date.now();
  let targetProfileId = options.targetProfileId;
  if (envelope.manifest.mode === 'teaching-share') {
    if (!targetProfileId || !(await getPracticeProfile(targetProfileId))) {
      targetProfileId = (await getOrCreatePracticeProfile(options)).id;
    }
  }
  const importId = options.importId || createId('practice-import');
  const visibility = options.visibility ?? (options.importId ? 'hidden' : 'visible');
  const execute = async (): Promise<PracticeImportResult> => {
    const db = await getPracticeDb();
    if (await db.get(IMPORT_STORE, importId)) {
      throw new PracticeImportError('練習匯入 id 已存在。', [
        { path: 'importId', message: '每次匯入必須使用新的 importId。' },
      ]);
    }
    const prepared = await preparePracticeImport(envelope, options, targetProfileId, now);
    await assertNoPracticeImportCollisions(db, prepared.copiedIds);
    await persistPracticeImport(db, prepared, importId, visibility, now);
    return {
      mode: envelope.manifest.mode,
      rollbackToken: importId,
      importId,
      visibility,
      state: visibility === 'hidden' ? 'staged' : 'published',
      copiedIds: prepared.copiedIds,
      warnings: prepared.warnings,
    };
  };
  return withPracticeWrite(execute, options);
};

type PracticeImportStoreKind = 'profileIds' | 'lessonIds' | 'attemptIds' | 'bookmarkIds';

const practiceImportStores: Array<{
  kind: PracticeImportStoreKind;
  store: typeof PROFILE_STORE | typeof LESSON_STORE | typeof ATTEMPT_STORE | typeof BOOKMARK_STORE;
}> = [
  { kind: 'profileIds', store: PROFILE_STORE },
  { kind: 'lessonIds', store: LESSON_STORE },
  { kind: 'attemptIds', store: ATTEMPT_STORE },
  { kind: 'bookmarkIds', store: BOOKMARK_STORE },
];

/**
 * Nested question rows are generated by copyLesson rather than stored in their own object store.
 * Journal-less recovery therefore uses their stable destination prefix to distinguish planned
 * nested IDs from the top-level profile, lesson, attempt, and bookmark IDs.
 */
const isCopiedQuestionId = (id: string): boolean => id.startsWith('question-copy-');

const removePracticeRowsWithoutJournal = async (
  db: IDBPDatabase<PracticeDB>,
  importId: string,
  expectedIds: string[],
): Promise<PracticeImportCleanupResult> => {
  const expected = new Set(expectedIds);
  const expectedNestedQuestionIds = new Set(expectedIds.filter(isCopiedQuestionId));
  if (expected.size === 0) {
    throw new PracticeImportError('缺少練習匯入紀錄，無法證明清理範圍。', [
      { path: 'importId', message: '匯入沒有可核對的 planned id。' },
    ]);
  }

  const recordsByStore = await Promise.all(
    practiceImportStores.map(async entry => ({
      ...entry,
      records: await db.getAll(entry.store),
    })),
  );
  const ownedRecords: Array<{
    kind: PracticeImportStoreKind;
    store:
      | typeof PROFILE_STORE
      | typeof LESSON_STORE
      | typeof ATTEMPT_STORE
      | typeof BOOKMARK_STORE;
    id: string;
    record: unknown;
  }> = [];
  const mismatchedIds: string[] = [];
  const unexpectedOwnedIds: string[] = [];
  for (const entry of recordsByStore) {
    for (const record of entry.records) {
      const id = isRecord(record) && typeof record.id === 'string' ? record.id : undefined;
      const marker = importRecordMarker(record);
      if (marker === importId && id && !expected.has(id)) {
        unexpectedOwnedIds.push(id);
      }
      if (!id || !expected.has(id)) {
        continue;
      }
      if (marker !== importId) {
        mismatchedIds.push(id);
        continue;
      }
      ownedRecords.push({ ...entry, id, record });
    }
  }

  const ownedQuestions = new Set<string>();
  const observedNestedQuestionIds = new Set<string>();
  for (const item of ownedRecords) {
    if (item.kind !== 'lessonIds') {
      continue;
    }
    const questions =
      isRecord(item.record) && Array.isArray(item.record.questions) ? item.record.questions : [];
    for (const question of questions) {
      const questionId =
        isRecord(question) && typeof question.id === 'string' ? question.id : undefined;
      if (!questionId || !expected.has(questionId) || ownedQuestions.has(questionId)) {
        if (questionId && (!expected.has(questionId) || ownedQuestions.has(questionId))) {
          mismatchedIds.push(questionId);
        }
        continue;
      }
      ownedQuestions.add(questionId);
      if (expectedNestedQuestionIds.has(questionId)) {
        observedNestedQuestionIds.add(questionId);
      }
    }
  }

  // A lesson row can prove ownership only for the complete nested question set it carries.
  // Missing-journal recovery must fail before deleting any owned row when a planned copied
  // question is absent from an otherwise present owned lesson. If every planned row is already
  // absent, the no-op path below remains idempotent for interrupted/completed retries.
  if (ownedRecords.some(item => item.kind === 'lessonIds')) {
    for (const expectedQuestionId of expectedNestedQuestionIds) {
      if (!observedNestedQuestionIds.has(expectedQuestionId)) {
        mismatchedIds.push(expectedQuestionId);
      }
    }
  }

  if (mismatchedIds.length > 0 || unexpectedOwnedIds.length > 0) {
    throw new PracticeImportError('練習匯入紀錄缺失且 ownership 無法核對。', [
      {
        path: 'importId',
        message: `planned id ownership 不一致：${[
          ...new Set([...mismatchedIds, ...unexpectedOwnedIds]),
        ].join(', ')}`,
      },
    ]);
  }

  if (ownedRecords.length === 0) {
    clearWorkspaceArchivePublication(importId);
    return {
      importId,
      state: 'rolled_back',
      removedIds: emptyCopiedIds(),
      missingIds: emptyCopiedIds(),
    };
  }

  const removedIds = emptyCopiedIds();
  const tx = db.transaction(
    [PROFILE_STORE, LESSON_STORE, ATTEMPT_STORE, BOOKMARK_STORE],
    'readwrite',
  );
  for (const item of ownedRecords) {
    await tx.objectStore(item.store).delete(item.id);
    if (item.kind === 'profileIds') {
      removedIds.profileIds.push(item.id);
    }
    if (item.kind === 'lessonIds') {
      removedIds.lessonIds.push(item.id);
    }
    if (item.kind === 'attemptIds') {
      removedIds.attemptIds.push(item.id);
    }
    if (item.kind === 'bookmarkIds') {
      removedIds.bookmarkIds.push(item.id);
    }
  }
  removedIds.questionIds.push(...ownedQuestions);
  await tx.done;
  clearWorkspaceArchivePublication(importId);
  return {
    importId,
    state: 'rolled_back',
    removedIds,
    missingIds: emptyCopiedIds(),
  };
};

const normalizeImportLog = (value: unknown): PracticeImportLog | undefined => {
  if (!isRecord(value) || typeof value.token !== 'string') {
    return undefined;
  }
  const copiedIds = isRecord(value.copiedIds) ? value.copiedIds : {};
  const readIds = (key: PracticeImportStoreKind): string[] =>
    Array.isArray(copiedIds[key])
      ? copiedIds[key].filter((id): id is string => typeof id === 'string')
      : [];
  const normalizedIds: PracticeImportResult['copiedIds'] = {
    profileIds: readIds('profileIds'),
    lessonIds: readIds('lessonIds'),
    questionIds: Array.isArray(copiedIds.questionIds)
      ? copiedIds.questionIds.filter((id): id is string => typeof id === 'string')
      : [],
    attemptIds: readIds('attemptIds'),
    bookmarkIds: readIds('bookmarkIds'),
  };
  const planned = isRecord(value.plannedIds) ? value.plannedIds : normalizedIds;
  const plannedIds: PracticeImportResult['copiedIds'] = {
    profileIds: Array.isArray(planned.profileIds)
      ? planned.profileIds.filter((id): id is string => typeof id === 'string')
      : normalizedIds.profileIds,
    lessonIds: Array.isArray(planned.lessonIds)
      ? planned.lessonIds.filter((id): id is string => typeof id === 'string')
      : normalizedIds.lessonIds,
    questionIds: Array.isArray(planned.questionIds)
      ? planned.questionIds.filter((id): id is string => typeof id === 'string')
      : normalizedIds.questionIds,
    attemptIds: Array.isArray(planned.attemptIds)
      ? planned.attemptIds.filter((id): id is string => typeof id === 'string')
      : normalizedIds.attemptIds,
    bookmarkIds: Array.isArray(planned.bookmarkIds)
      ? planned.bookmarkIds.filter((id): id is string => typeof id === 'string')
      : normalizedIds.bookmarkIds,
  };
  const questionIdsByLesson: Record<string, string[]> = {};
  if (isRecord(value.questionIdsByLesson)) {
    for (const [lessonId, questionIds] of Object.entries(value.questionIdsByLesson)) {
      if (Array.isArray(questionIds)) {
        questionIdsByLesson[lessonId] = questionIds.filter(
          (id): id is string => typeof id === 'string' && id.length > 0,
        );
      }
    }
  }
  const importId = typeof value.importId === 'string' ? value.importId : value.token;
  const visibility: PracticeImportVisibility = value.visibility === 'hidden' ? 'hidden' : 'visible';
  const state: PracticeImportState =
    value.state === 'staged' ||
    value.state === 'published' ||
    value.state === 'rolled_back' ||
    value.state === 'failed'
      ? value.state
      : visibility === 'hidden'
        ? 'staged'
        : 'published';
  const createdAt = typeof value.createdAt === 'number' ? value.createdAt : Date.now();
  return {
    token: value.token,
    importId,
    visibility,
    state,
    copiedIds: normalizedIds,
    plannedIds,
    questionIdsByLesson,
    createdAt,
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : createdAt,
  };
};

const importRecordMarker = (record: unknown): string | undefined => {
  if (!isRecord(record)) {
    return undefined;
  }
  const marker = record[WORKSPACE_ARCHIVE_IMPORT_ID_FIELD];
  return typeof marker === 'string' ? marker : undefined;
};

const inspectPracticeImportOwnership = async (
  db: IDBPDatabase<PracticeDB>,
  log: PracticeImportLog,
): Promise<{
  owned: PracticeImportResult['copiedIds'];
  missing: PracticeImportResult['copiedIds'];
}> => {
  const owned = emptyCopiedIds();
  const missing = emptyCopiedIds();
  const addUnique = (ids: string[], id: string): void => {
    if (!ids.includes(id)) {
      ids.push(id);
    }
  };
  for (const { kind, store } of practiceImportStores) {
    for (const id of log.plannedIds[kind]) {
      const record = await db.get(store, id);
      const marker = importRecordMarker(record);
      const belongsToImport =
        Boolean(record) &&
        (log.visibility === 'hidden'
          ? marker === log.importId
          : !marker || marker === log.importId);
      if (kind === 'lessonIds') {
        const expectedQuestionIds = log.questionIdsByLesson[id] ?? [];
        const actualQuestionIds =
          isRecord(record) && Array.isArray(record.questions)
            ? record.questions.flatMap(question =>
                isRecord(question) && typeof question.id === 'string' ? [question.id] : [],
              )
            : [];
        const expectedSet = new Set(expectedQuestionIds);
        const actualSet = new Set(actualQuestionIds);
        const exactQuestionOwnership =
          belongsToImport &&
          expectedQuestionIds.length === actualQuestionIds.length &&
          expectedSet.size === expectedQuestionIds.length &&
          actualSet.size === actualQuestionIds.length &&
          expectedQuestionIds.every(questionId => actualSet.has(questionId));
        if (exactQuestionOwnership) {
          owned.lessonIds.push(id);
          expectedQuestionIds.forEach(questionId => addUnique(owned.questionIds, questionId));
        } else {
          addUnique(missing.lessonIds, id);
          expectedQuestionIds.forEach(questionId => addUnique(missing.questionIds, questionId));
        }
        continue;
      }
      if (belongsToImport) {
        owned[kind].push(id);
      } else {
        missing[kind].push(id);
      }
    }
  }
  return { owned, missing };
};

export const getPracticeArchiveImport = async (
  importId: string,
): Promise<PracticeImportJournal | undefined> => {
  const db = await getPracticeDb();
  const log = normalizeImportLog(await db.get(IMPORT_STORE, importId));
  if (!log) {
    return undefined;
  }
  if (log.visibility === 'hidden' && isWorkspaceArchiveImportPublished(log.importId)) {
    return { ...log, state: 'published' };
  }
  return log;
};

export const listPracticeArchiveImports = async (): Promise<PracticeImportJournal[]> => {
  const db = await getPracticeDb();
  const logs = (await db.getAll(IMPORT_STORE))
    .map(normalizeImportLog)
    .filter((log): log is PracticeImportLog => Boolean(log));
  return logs.map(log =>
    log.visibility === 'hidden' && isWorkspaceArchiveImportPublished(log.importId)
      ? { ...log, state: 'published' }
      : log,
  );
};

export type PracticeImportJournal = Omit<PracticeImportLog, 'copiedIds' | 'plannedIds'> & {
  copiedIds: PracticeImportResult['copiedIds'];
  plannedIds: PracticeImportResult['copiedIds'];
};

export const publishPracticeImportedRecords = async (
  importId: string,
  options: PracticeArchiveOperationOptions = {},
): Promise<PracticeImportPublicationResult> => {
  const execute = async (): Promise<PracticeImportPublicationResult> => {
    const db = await getPracticeDb();
    const log = normalizeImportLog(await db.get(IMPORT_STORE, importId));
    if (!log) {
      throw new Error('找不到可發布的練習匯入紀錄。');
    }
    if (log.visibility === 'visible') {
      return { importId, state: 'published', published: true, awaitingSharedReceipt: false };
    }
    const ownership = await inspectPracticeImportOwnership(db, log);
    if (Object.values(ownership.missing).some(ids => ids.length > 0)) {
      const failed = { ...log, state: 'failed' as const, updatedAt: Date.now() };
      await db.put(IMPORT_STORE, failed);
      throw new PracticeImportError('練習匯入尚未完整寫入，無法發布。', [
        { path: 'importId', message: '匯入仍有缺少或不屬於本次匯入的 planned id。' },
      ]);
    }
    if (!isWorkspaceArchiveImportPublished(importId)) {
      return {
        importId,
        state: 'staged',
        published: false,
        awaitingSharedReceipt: true,
      };
    }
    await db.put(IMPORT_STORE, { ...log, state: 'published', updatedAt: Date.now() });
    return { importId, state: 'published', published: true, awaitingSharedReceipt: false };
  };
  return withPracticeWrite(execute, options);
};

export const removePracticeImportedRecords = async (
  importId: string,
  options: PracticeArchiveOperationOptions = {},
): Promise<PracticeImportCleanupResult> => {
  const execute = async (): Promise<PracticeImportCleanupResult> => {
    const db = await getPracticeDb();
    const log = normalizeImportLog(await db.get(IMPORT_STORE, importId));
    if (!log) {
      return removePracticeRowsWithoutJournal(db, importId, options.expectedIds ?? []);
    }
    if (log.state === 'rolled_back') {
      return {
        importId,
        state: 'rolled_back',
        removedIds: emptyCopiedIds(),
        missingIds: emptyCopiedIds(),
      };
    }
    const ownership = await inspectPracticeImportOwnership(db, log);
    const tx = db.transaction(
      [PROFILE_STORE, LESSON_STORE, ATTEMPT_STORE, BOOKMARK_STORE],
      'readwrite',
    );
    for (const { kind, store } of practiceImportStores) {
      for (const id of ownership.owned[kind]) {
        await tx.objectStore(store).delete(id);
      }
    }
    await tx.done;
    const state: Extract<PracticeImportState, 'rolled_back' | 'failed'> =
      log.state === 'failed' || Object.values(ownership.missing).some(ids => ids.length > 0)
        ? 'failed'
        : 'rolled_back';
    if (state === 'rolled_back') {
      clearWorkspaceArchivePublication(importId);
    }
    await db.put(IMPORT_STORE, { ...log, state, updatedAt: Date.now() });
    return {
      importId,
      state,
      removedIds: ownership.owned,
      missingIds: ownership.missing,
    };
  };
  return withPracticeWrite(execute, options);
};

export const rollbackPracticeArchive = async (
  tokenOrResult: string | PracticeImportResult,
  options: PracticeArchiveOperationOptions = {},
): Promise<void> => {
  const token = typeof tokenOrResult === 'string' ? tokenOrResult : tokenOrResult.rollbackToken;
  const result = await removePracticeImportedRecords(token, options);
  if (result.state === 'failed') {
    throw new Error(`練習匯入回復不完整：${Object.values(result.missingIds).flat().join(', ')}`);
  }
};

export const practiceArchiveAdapter: PracticeArchiveAdapter = {
  export: exportPracticeArchive,
  import: importPracticeArchive,
  rollback: rollbackPracticeArchive,
  exportRecords: exportPracticeArchive,
  importRecords: importPracticeArchive,
  publishImportedRecords: publishPracticeImportedRecords,
  removeImportedRecords: removePracticeImportedRecords,
};

/** Explicit aliases for F1 registries that use verb-first names. */
export const exportPracticeArchiveRecords = exportPracticeArchive;
export const importPracticeArchiveRecords = importPracticeArchive;
export const rollbackPracticeArchiveImport = rollbackPracticeArchive;

export const exportPracticeJson = async (
  mode: PracticeExportMode = 'teaching-share',
  profileId?: string,
): Promise<string> => {
  const envelope =
    mode === 'f1-backup'
      ? await exportPracticeArchive()
      : await exportPracticeTeachingShare(profileId);
  return serializePracticeExport(envelope);
};

export const downloadPracticeJson = async (
  mode: PracticeExportMode = 'teaching-share',
  profileId?: string,
): Promise<{ fileName: string; text: string }> => {
  const text = await exportPracticeJson(mode, profileId);
  const fileName =
    mode === 'f1-backup' ? 'educare-practice-backup.json' : 'educare-practice-share.json';
  const objectUrl = URL.createObjectURL(new globalThis.Blob([text], { type: 'application/json' }));
  try {
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = fileName;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
  return { fileName, text };
};

export const downloadPracticeMarkdown = (lesson: PracticeLesson): string => {
  const fileName = `${lesson.title.replace(/[\\/:*?"<>|]/g, '-').trim() || 'practice-lesson'}.md`;
  const text = buildPracticeMarkdown(lesson);
  const objectUrl = URL.createObjectURL(new globalThis.Blob([text], { type: 'text/markdown' }));
  try {
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = fileName;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
  return fileName;
};

/** Test-only lifecycle helper; production callers should never clear this database. */
export const __closePracticeStoreForTesting = async (): Promise<void> => {
  if (!dbPromise) {
    return;
  }
  const db = await dbPromise;
  db.close();
  dbPromise = null;
};

export const __resetPracticeStoreForTesting = async (): Promise<void> => {
  await __closePracticeStoreForTesting();
  if (typeof globalThis.indexedDB !== 'undefined') {
    await new Promise<void>((resolve, reject) => {
      const request = globalThis.indexedDB.deleteDatabase(PRACTICE_DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => resolve();
    });
  }
};
