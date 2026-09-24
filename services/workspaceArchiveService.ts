import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { zipSync } from 'fflate';
import type { AgentRunCheckpoint, Assistant, BundleRecord, ChatSession } from '../types';
import { unzipAssistantPackage } from './assistantPackageService';
import {
  WORKSPACE_ARCHIVE_IMPORT_ID_FIELD,
  clearWorkspaceArchivePublication,
  deleteWorkspaceDatabaseRecords,
  getWorkspaceDatabaseSnapshot,
  isWorkspaceArchiveImportPublished,
  markWorkspaceArchiveImportPublished,
  putWorkspaceDatabaseRecords,
  tagWorkspaceArchiveRecords,
  type WorkspaceDatabaseRecords,
} from './db';
import {
  deleteCheckpointArchiveRecords,
  getCheckpointArchiveRecords,
  putCheckpointArchiveRecords,
} from './agentRunCheckpointService';
import {
  beginWorkspaceOperation,
  getWorkspaceOperationStatus,
  withWorkspaceOperation,
  type WorkspaceOperationHandle,
  type WorkspaceOperationToken,
} from './workspaceOperationService';

export const WORKSPACE_ARCHIVE_FORMAT = 'educare-workspace-archive';
export const WORKSPACE_ARCHIVE_SCHEMA_VERSION = 1;
export const WORKSPACE_ARCHIVE_MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
export const WORKSPACE_ARCHIVE_MAX_ENTRIES = 5_000;
export const WORKSPACE_ARCHIVE_MAX_BYTES = WORKSPACE_ARCHIVE_MAX_UNCOMPRESSED_BYTES;
export const MAX_ARCHIVE_SIZE_BYTES = WORKSPACE_ARCHIVE_MAX_UNCOMPRESSED_BYTES;
export const MAX_ARCHIVE_ENTRIES = WORKSPACE_ARCHIVE_MAX_ENTRIES;

const MANIFEST_PATH = 'manifest.json';
const RECORDS_PREFIX = 'records/';
const JOURNAL_DB_NAME = 'educare-workspace-archive-journal';
const JOURNAL_DB_VERSION = 1;
const JOURNAL_STORE = 'imports';
export const WORKSPACE_ARCHIVE_LAST_BACKUP_KEY = 'educare.workspace.last-backup.v1';

export const WORKSPACE_ARCHIVE_PREFERENCE_KEYS = [
  'educare.appearance.v1',
  'educare:onboarding-preferences',
  'sidebarCollapsed',
  'embeddingConfig',
  'gemini_assistant_rag_settings',
] as const;

export const WORKSPACE_ARCHIVE_EXCLUDED_STORES = [
  'providerSettings',
  'htmlProjectAgentTelemetry',
  'bundleMetricsService',
  'sourcePdfOrDocxWhenOnlyParsedChunksExist',
] as const;

export const WORKSPACE_ARCHIVE_CATEGORIES = [
  'assistants',
  'sessions',
  'bundles',
  'projects',
  'snapshots',
  'git',
  'checkpoints',
  'drafts',
  'preferences',
  'practice',
] as const;

export type WorkspaceArchiveCategory = (typeof WORKSPACE_ARCHIVE_CATEGORIES)[number];

export type WorkspaceArchiveJournalState =
  | 'staging'
  | 'rollback_pending'
  | 'published'
  | 'rolled_back'
  | 'failed';

export interface WorkspaceArchiveCategorySummary {
  category: WorkspaceArchiveCategory;
  recordCount: number;
  byteCount: number;
  included: boolean;
  reason?: string;
}

export interface WorkspaceArchiveEntry {
  path: string;
  category: WorkspaceArchiveCategory;
  size: number;
  checksum: string;
  recordCount: number;
}

export interface WorkspaceArchiveManifest {
  format: typeof WORKSPACE_ARCHIVE_FORMAT;
  schemaVersion: typeof WORKSPACE_ARCHIVE_SCHEMA_VERSION;
  archiveId: string;
  exportedAt: number;
  includedCategories: WorkspaceArchiveCategory[];
  excludedCategories: Array<{ category: WorkspaceArchiveCategory; reason: string }>;
  entries: WorkspaceArchiveEntry[];
  totalUncompressedBytes: number;
  totalEntries: number;
  /** Sensitive provider fields are intentionally always excluded. */
  excludedFields: string[];
  /** Durable stores not covered by the archive contract are explicit. */
  excludedStores: string[];
}

export interface WorkspaceArchiveSource {
  assistants?: Assistant[];
  sessions?: ChatSession[];
  bundles?: BundleRecord[];
  checkpoints?: AgentRunCheckpoint[];
  /** Provider-owned categories are represented as serializable records. */
  projects?: unknown[];
  snapshots?: unknown[];
  git?: unknown[];
  drafts?: unknown[];
  preferences?: Record<string, unknown> | unknown[];
  practice?: unknown[];
  [category: string]: unknown;
}

export interface WorkspaceArchiveProviderImportContext {
  archiveId: string;
  importId: string;
  category: WorkspaceArchiveCategory;
  idMap: WorkspaceArchiveIdMap;
  /** Opaque capability for provider raw writes within the root barrier. */
  operationToken: WorkspaceOperationToken;
  /** Providers must stage imported rows as hidden until the final publish hook. */
  visibility: 'hidden';
  /** IDs created by the provider must be returned from importRecords as well. */
  registerCreatedIds(ids: string[]): void;
}

export interface WorkspaceArchiveProviderExportContext {
  /** Opaque capability for provider reads that must share the root barrier. */
  operationToken?: WorkspaceOperationToken;
}

export interface WorkspaceArchiveProviderImportResult {
  createdIds?: string[];
  metadata?: Record<string, unknown>;
}

export interface WorkspaceArchiveProvider {
  category: Exclude<
    WorkspaceArchiveCategory,
    'assistants' | 'sessions' | 'bundles' | 'checkpoints'
  >;
  exportRecords: (
    context?: WorkspaceArchiveProviderExportContext,
  ) => Promise<unknown[] | Record<string, unknown> | undefined>;
  importRecords: (
    records: unknown[] | Record<string, unknown>,
    context: WorkspaceArchiveProviderImportContext,
  ) => Promise<WorkspaceArchiveProviderImportResult | void>;
  /** Optional second phase for providers whose metadata has a visible index. */
  publishImportedRecords?: (
    ids: string[],
    context: WorkspaceArchiveProviderImportContext,
  ) => Promise<void>;
  removeImportedRecords?: (
    ids: string[],
    context: WorkspaceArchiveProviderImportContext,
  ) => Promise<void>;
  listExistingIds?: (context?: WorkspaceArchiveProviderExportContext) => Promise<string[]>;
}

export interface WorkspaceArchiveExportOptions {
  categories?: WorkspaceArchiveCategory[];
  excludeCategories?: WorkspaceArchiveCategory[];
  /** Pure source override used by tests and adapters. */
  source?: WorkspaceArchiveSource;
  /** Explicitly allowlisted preferences. Never accepts provider settings. */
  preferences?: Record<string, unknown>;
  now?: number;
  archiveId?: string;
}

export interface WorkspaceArchiveExportResult {
  bytes: Uint8Array;
  blob: globalThis.Blob;
  fileName: string;
  manifest: WorkspaceArchiveManifest;
  preview: WorkspaceArchivePreview;
}

export interface WorkspaceArchivePreview {
  archiveId: string;
  exportedAt: number;
  schemaVersion: number;
  totalUncompressedBytes: number;
  totalEntries: number;
  categories: WorkspaceArchiveCategorySummary[];
  includedCategories: WorkspaceArchiveCategory[];
  excludedCategories: Array<{ category: WorkspaceArchiveCategory; reason: string }>;
  excludedFields: string[];
  excludedStores: string[];
  conflictCounts: Partial<Record<WorkspaceArchiveCategory, number>>;
  warnings: string[];
}

export interface ParsedWorkspaceArchive {
  bytes: Uint8Array;
  manifest: WorkspaceArchiveManifest;
  entries: Record<string, Uint8Array>;
  records: WorkspaceArchiveSource;
  preview: WorkspaceArchivePreview;
}

export interface WorkspaceArchiveIdMap {
  assistants: Record<string, string>;
  sessions: Record<string, string>;
  bundles: Record<string, string>;
  checkpoints: Record<string, string>;
  projects: Record<string, string>;
  providerRecords: Partial<Record<WorkspaceArchiveCategory, Record<string, string>>>;
  virtualAssistants: Record<string, string>;
}

export interface WorkspaceArchiveImportOptions {
  /** Optional callback for provider-owned preferences. */
  applyPreferences?: (preferences: Record<string, unknown>) => Promise<void> | void;
  /** Read current allowlisted preferences before staging, for rollback. */
  readPreferences?: () => Promise<Record<string, unknown>> | Record<string, unknown>;
  /** Restore the preference snapshot if a later store fails. */
  restorePreferences?: (preferences: Record<string, unknown>) => Promise<void> | void;
  /** Set false only for a trusted migration which intentionally preserves IDs. */
  copy?: boolean;
  /** Expose journal bytes for a caller that wants a durable recovery UI. */
  now?: number;
}

export interface WorkspaceArchiveImportResult {
  importId: string;
  archiveId: string;
  state: WorkspaceArchiveJournalState;
  idMap: WorkspaceArchiveIdMap;
  created: Partial<Record<WorkspaceArchiveCategory, number>>;
  conflicts: Partial<Record<WorkspaceArchiveCategory, number>>;
  skippedCategories: WorkspaceArchiveCategory[];
  recoveryStatus: WorkspaceArchiveRecoveryStatus;
}

export interface WorkspaceArchiveRecoveryStatus {
  importId: string;
  archiveId: string;
  state: WorkspaceArchiveJournalState;
  hidden: boolean;
  resumable: boolean;
  rollbackAvailable: boolean;
  error?: string;
  updatedAt: number;
}

export interface WorkspaceArchiveMetadata {
  lastBackupAt: number | null;
  recoveryStatus: WorkspaceArchiveRecoveryStatus[];
}

interface WorkspaceArchiveJournalRecord {
  importId: string;
  archiveId: string;
  state: WorkspaceArchiveJournalState;
  hidden: boolean;
  createdAt: number;
  updatedAt: number;
  archiveBytes: Uint8Array;
  idMap: WorkspaceArchiveIdMap;
  createdRecords: WorkspaceDatabaseRecords;
  createdCheckpoints: Array<
    Pick<AgentRunCheckpoint, 'runId'> &
      Partial<Record<typeof WORKSPACE_ARCHIVE_IMPORT_ID_FIELD, string>>
  >;
  providerCreatedIds: Partial<Record<WorkspaceArchiveCategory, string[]>>;
  completedCategories: WorkspaceArchiveCategory[];
  previousPreferences?: Record<string, unknown>;
  error?: string;
}

interface WorkspaceArchiveJournalDb extends DBSchema {
  [JOURNAL_STORE]: {
    key: string;
    value: WorkspaceArchiveJournalRecord;
  };
}

const providerRegistry = new Map<WorkspaceArchiveCategory, WorkspaceArchiveProvider>();
let journalDbPromise: Promise<IDBPDatabase<WorkspaceArchiveJournalDb>> | null = null;

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: false });
const BINARY_MARKER = '__educareWorkspaceArchiveBinaryV1';
let workspacePreferenceWarnings: string[] = [];

const isByteArray = (value: unknown): value is Uint8Array => value instanceof Uint8Array;

const bytesToBase64 = (bytes: Uint8Array): string => {
  if (typeof globalThis.btoa !== 'function') {
    throw new Error('Base64 encoding is not available in this environment.');
  }
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return globalThis.btoa(binary);
};

const base64ToBytes = (value: string): Uint8Array => {
  if (typeof globalThis.atob !== 'function') {
    throw new Error('Base64 decoding is not available in this environment.');
  }
  const binary = globalThis.atob(value);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
};

const encodeArchiveValue = (value: unknown): unknown => {
  if (isByteArray(value)) {
    return { [BINARY_MARKER]: bytesToBase64(value) };
  }
  if (Array.isArray(value)) {
    return value.map(encodeArchiveValue);
  }
  if (!isRecord(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [key, encodeArchiveValue(nested)]),
  );
};

const decodeArchiveValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(decodeArchiveValue);
  }
  if (!isRecord(value)) {
    return value;
  }
  if (Object.keys(value).length === 1 && typeof value[BINARY_MARKER] === 'string') {
    return base64ToBytes(value[BINARY_MARKER]);
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [key, decodeArchiveValue(nested)]),
  );
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && !isByteArray(value);

const clone = <T>(value: T): T => {
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
};

const createId = (prefix: string): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
};

const bytesForJson = (value: unknown): Uint8Array => {
  const serialized = JSON.stringify(encodeArchiveValue(value));
  if (serialized === undefined) {
    throw new Error('Workspace archive records must be JSON serializable.');
  }
  return encoder.encode(serialized);
};

const checksumFor = async (bytes: Uint8Array): Promise<string> => {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('Web Crypto SHA-256 is required to create or validate a workspace archive.');
  }
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
};

const ensureUint8Array = (value: Uint8Array): Uint8Array =>
  value instanceof Uint8Array ? value : new Uint8Array(value);

const validCategory = (value: unknown): value is WorkspaceArchiveCategory =>
  typeof value === 'string' && (WORKSPACE_ARCHIVE_CATEGORIES as readonly string[]).includes(value);

const normalizeCategoryList = (
  categories: WorkspaceArchiveCategory[] | undefined,
): WorkspaceArchiveCategory[] => {
  const source =
    categories && categories.length > 0 ? categories : [...WORKSPACE_ARCHIVE_CATEGORIES];
  const seen = new Set<WorkspaceArchiveCategory>();
  for (const category of source) {
    if (!validCategory(category)) {
      throw new Error(`Unknown workspace archive category: ${String(category)}.`);
    }
    seen.add(category);
  }
  return [...seen];
};

const validateArchivePath = (path: string): string => {
  if (
    !path ||
    path.includes('\\') ||
    path.includes('\0') ||
    path.startsWith('/') ||
    path.startsWith('~') ||
    path.split('/').some(segment => segment === '..' || segment === '')
  ) {
    throw new Error(`Unsafe workspace archive path: ${path}`);
  }
  if (
    path
      .split('/')
      .some(segment => segment === '.' || [...segment].some(char => char.charCodeAt(0) <= 31))
  ) {
    throw new Error(`Unsafe workspace archive path: ${path}`);
  }
  return path;
};

const sensitiveField =
  /(?:api[_-]?key|secret|password|credential|authorization|bearer|access[_-]?token|refresh[_-]?token|private[_-]?key|encryptedprovider|providercredentials?|provider[_-]?settings?)/i;

const scrubSensitive = (value: unknown, fieldName?: string): unknown => {
  if (fieldName && sensitiveField.test(fieldName)) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.map(item => scrubSensitive(item));
  }
  if (isByteArray(value)) {
    return value;
  }
  if (!isRecord(value)) {
    return value;
  }

  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    const sanitized = scrubSensitive(nested, key);
    if (sanitized !== undefined) {
      result[key] = sanitized;
    }
  }
  return result;
};

const scrubRecords = (category: WorkspaceArchiveCategory, value: unknown): unknown => {
  if (category === 'preferences') {
    if (!isRecord(value)) {
      return {};
    }
    const allowed = new Set<string>(WORKSPACE_ARCHIVE_PREFERENCE_KEYS);
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => allowed.has(key))
        .map(([key, nested]) => [key, scrubSensitive(nested, key)])
        .filter(([, nested]) => nested !== undefined),
    );
  }
  return scrubSensitive(value);
};

/** Read only the small, non-secret preference allowlist used by workspace archives. */
export const collectWorkspacePreferences = (): Record<string, unknown> => {
  workspacePreferenceWarnings = [];
  let storage: { getItem: (key: string) => string | null } | undefined;
  try {
    storage = globalThis.localStorage;
  } catch {
    workspacePreferenceWarnings = [
      'Allowlisted preferences could not be read from browser storage.',
    ];
    console.warn(
      '[workspaceArchiveService] Allowlisted preferences were omitted from the archive.',
    );
    return {};
  }
  if (!storage || typeof storage.getItem !== 'function') {
    workspacePreferenceWarnings = [
      'Allowlisted preferences are unavailable in this browser context.',
    ];
    return {};
  }
  const preferences: Record<string, unknown> = {};
  for (const key of WORKSPACE_ARCHIVE_PREFERENCE_KEYS) {
    try {
      const raw = storage.getItem(key);
      if (raw === null || raw === undefined) {
        continue;
      }
      try {
        preferences[key] = JSON.parse(raw);
      } catch {
        preferences[key] = raw;
      }
    } catch {
      const warning = `Allowlisted preference ${key} could not be read and was omitted.`;
      workspacePreferenceWarnings.push(warning);
      console.warn(`[workspaceArchiveService] ${warning}`);
    }
  }
  return preferences;
};

const resetWorkspacePreferenceWarnings = (): void => {
  workspacePreferenceWarnings = [];
};

export const getWorkspacePreferenceWarnings = (): string[] => [...workspacePreferenceWarnings];

const normalizeProviderRecords = (
  category: WorkspaceArchiveCategory,
  records: unknown[] | Record<string, unknown> | undefined,
): unknown[] | Record<string, unknown> => {
  if (category === 'preferences') {
    if (records === undefined) {
      return {};
    }
    if (!isRecord(records)) {
      throw new Error('Workspace archive category preferences must contain an object.');
    }
    return scrubRecords(category, records) as Record<string, unknown>;
  }
  if (records === undefined) {
    return [];
  }
  if (!Array.isArray(records)) {
    throw new Error(`Workspace archive category ${category} must contain an array.`);
  }
  return records.map(record => scrubRecords(category, record));
};

const sourceRecordsForCategory = (
  source: WorkspaceArchiveSource,
  category: WorkspaceArchiveCategory,
): unknown[] | Record<string, unknown> => {
  const value = source[category];
  if (category === 'preferences') {
    if (value === undefined) {
      return {};
    }
    if (!isRecord(value)) {
      throw new Error('Workspace archive category preferences must contain an object.');
    }
    return value;
  }
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`Workspace archive category ${category} must contain an array.`);
  }
  return value;
};

const getJournalDb = (): Promise<IDBPDatabase<WorkspaceArchiveJournalDb>> => {
  if (!journalDbPromise) {
    journalDbPromise = openDB<WorkspaceArchiveJournalDb>(JOURNAL_DB_NAME, JOURNAL_DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(JOURNAL_STORE)) {
          db.createObjectStore(JOURNAL_STORE, { keyPath: 'importId' });
        }
      },
    });
  }
  return journalDbPromise;
};

const persistJournal = async (record: WorkspaceArchiveJournalRecord): Promise<void> => {
  const db = await getJournalDb();
  await db.put(JOURNAL_STORE, record);
};

const readJournal = async (
  importId: string,
): Promise<WorkspaceArchiveJournalRecord | undefined> => {
  const db = await getJournalDb();
  return db.get(JOURNAL_STORE, importId);
};

const toRecoveryStatus = (
  journal: WorkspaceArchiveJournalRecord,
): WorkspaceArchiveRecoveryStatus => ({
  importId: journal.importId,
  archiveId: journal.archiveId,
  state: journal.state,
  hidden: journal.hidden,
  resumable:
    journal.hidden &&
    (journal.state === 'failed' || journal.state === 'staging') &&
    journal.archiveBytes.byteLength > 0,
  rollbackAvailable:
    journal.hidden &&
    (journal.state === 'failed' ||
      journal.state === 'staging' ||
      journal.state === 'rollback_pending'),
  ...(journal.error ? { error: journal.error } : {}),
  updatedAt: journal.updatedAt,
});

const createEmptyIdMap = (): WorkspaceArchiveIdMap => ({
  assistants: {},
  sessions: {},
  bundles: {},
  checkpoints: {},
  projects: {},
  providerRecords: {},
  virtualAssistants: {},
});

const copyId = (prefix: string, original: string, used: Set<string>, copy: boolean): string => {
  if (!copy && !used.has(original)) {
    used.add(original);
    return original;
  }

  let candidate = `${original}-copy`;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${original}-copy-${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate || createId(prefix);
};

const setMapped = (map: Record<string, string>, original: unknown, mapped: string): void => {
  if (typeof original === 'string' && original.length > 0) {
    map[original] = mapped;
  }
};

const remapProviderReference = (
  value: string,
  category: WorkspaceArchiveCategory,
  idMap: WorkspaceArchiveIdMap,
): string => idMap.providerRecords[category]?.[value] ?? value;

const remapReference = (value: unknown, key: string, idMap: WorkspaceArchiveIdMap): unknown => {
  if (typeof value !== 'string') {
    return value;
  }
  if (key === 'ownerId') {
    if (idMap.assistants[value] || idMap.virtualAssistants[value]) {
      return idMap.assistants[value] ?? idMap.virtualAssistants[value];
    }
    if (idMap.sessions[value]) {
      return idMap.sessions[value];
    }
    const assistantIds = [
      ...Object.keys(idMap.assistants),
      ...Object.keys(idMap.virtualAssistants),
    ].sort((left, right) => right.length - left.length);
    for (const assistantId of assistantIds) {
      const prefix = `${assistantId}:`;
      if (!value.startsWith(prefix)) {
        continue;
      }
      const mappedAssistantId =
        idMap.assistants[assistantId] ?? idMap.virtualAssistants[assistantId] ?? assistantId;
      const sessionId = value.slice(prefix.length);
      return `${mappedAssistantId}:${idMap.sessions[sessionId] ?? sessionId}`;
    }
    return value;
  }
  if (
    key === 'assistantId' ||
    key === 'targetAssistantId' ||
    key === 'sourceAssistantId' ||
    key === 'fromAssistantId' ||
    key === 'toAssistantId' ||
    key === 'agentId' ||
    key === 'sourceAgentId' ||
    key === 'targetAgentId'
  ) {
    return idMap.assistants[value] ?? idMap.virtualAssistants[value] ?? value;
  }
  if (key === 'sessionId' || key === 'sourceSessionId') {
    return idMap.sessions[value] ?? value;
  }
  if (key === 'projectId' || key === 'activeProjectId') {
    return idMap.projects[value] ?? value;
  }
  if (key === 'snapshotId') {
    return remapProviderReference(value, 'snapshots', idMap);
  }
  if (key === 'gitId' || key === 'repositoryId') {
    return remapProviderReference(value, 'git', idMap);
  }
  if (key === 'draftId') {
    return remapProviderReference(value, 'drafts', idMap);
  }
  if (key === 'practiceId') {
    return remapProviderReference(value, 'practice', idMap);
  }
  if (key === 'runId') {
    return idMap.checkpoints[value] ?? value;
  }
  if (key === 'bundleId') {
    return idMap.bundles[value] ?? value;
  }
  return value;
};

const remapRecord = (value: unknown, idMap: WorkspaceArchiveIdMap): unknown => {
  if (Array.isArray(value)) {
    return value.map(item => remapRecord(item, idMap));
  }
  if (!isRecord(value)) {
    return value;
  }
  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (
      ['assistantIds', 'sourceAssistantIds', 'targetAssistantIds', 'routableAssistantIds'].includes(
        key,
      ) &&
      Array.isArray(nested)
    ) {
      result[key] = nested.map(id =>
        typeof id === 'string' ? (idMap.assistants[id] ?? idMap.virtualAssistants[id] ?? id) : id,
      );
      continue;
    }
    if (
      ['sessionIds', 'sourceSessionIds', 'targetSessionIds'].includes(key) &&
      Array.isArray(nested)
    ) {
      result[key] = nested.map(id => (typeof id === 'string' ? (idMap.sessions[id] ?? id) : id));
      continue;
    }
    if (
      ['projectIds', 'sourceProjectIds', 'targetProjectIds'].includes(key) &&
      Array.isArray(nested)
    ) {
      result[key] = nested.map(id => (typeof id === 'string' ? (idMap.projects[id] ?? id) : id));
      continue;
    }
    if (key === 'routableTargets' && Array.isArray(nested)) {
      result[key] = nested.map(target => {
        if (!isRecord(target) || typeof target.id !== 'string') {
          return remapRecord(target, idMap);
        }
        return {
          ...(remapRecord(target, idMap) as Record<string, unknown>),
          id: idMap.assistants[target.id] ?? idMap.virtualAssistants[target.id] ?? target.id,
        };
      });
      continue;
    }
    const remapped = remapReference(nested, key, idMap);
    result[key] = remapped === nested ? remapRecord(nested, idMap) : remapped;
  }
  return result;
};

const remapBundle = (
  bundleRecord: BundleRecord,
  mappedBundleId: string,
  idMap: WorkspaceArchiveIdMap,
): BundleRecord => {
  const bundle = clone(scrubRecords('bundles', bundleRecord) as BundleRecord);
  const agentMap = new Map<string, string>();
  const agents = bundle.bundle.agents.map(agent => {
    const original = agent.id;
    const separator = original.lastIndexOf(':');
    const bareId = separator > -1 ? original.slice(separator + 1) : original;
    const mapped = `${mappedBundleId}:${bareId}`;
    agentMap.set(original, mapped);
    agentMap.set(bareId, mapped);
    idMap.virtualAssistants[original] = mapped;
    idMap.virtualAssistants[`${bundleRecord.id}:${bareId}`] = mapped;
    return { ...(remapRecord(agent, idMap) as typeof agent), id: mapped };
  });
  const remapAgent = (id: string): string => agentMap.get(id) ?? idMap.virtualAssistants[id] ?? id;
  return {
    ...bundle,
    id: mappedBundleId,
    bundle: {
      ...bundle.bundle,
      manifest: {
        ...bundle.bundle.manifest,
        entryAgentId: remapAgent(bundle.bundle.manifest.entryAgentId),
      },
      agents,
      routes: bundle.bundle.routes.map(route => ({
        ...route,
        fromAgentId: remapAgent(route.fromAgentId),
        toAgentId: remapAgent(route.toAgentId),
      })),
    },
  };
};

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const buildCategorySummaries = (
  manifest: WorkspaceArchiveManifest,
  records: WorkspaceArchiveSource,
): WorkspaceArchiveCategorySummary[] => {
  const excludedReasons = new Map(
    manifest.excludedCategories.map(item => [item.category, item.reason]),
  );
  return WORKSPACE_ARCHIVE_CATEGORIES.map(category => {
    const entry = manifest.entries.find(item => item.category === category);
    const raw = sourceRecordsForCategory(records, category);
    const recordCount =
      category === 'preferences' && isRecord(raw) ? Object.keys(raw).length : asArray(raw).length;
    return {
      category,
      recordCount: entry?.recordCount ?? recordCount,
      byteCount: entry?.size ?? 0,
      included: Boolean(entry),
      ...(excludedReasons.has(category) ? { reason: excludedReasons.get(category) } : {}),
    };
  });
};

const buildPreview = (
  manifest: WorkspaceArchiveManifest,
  records: WorkspaceArchiveSource,
  conflictCounts: Partial<Record<WorkspaceArchiveCategory, number>> = {},
): WorkspaceArchivePreview => ({
  archiveId: manifest.archiveId,
  exportedAt: manifest.exportedAt,
  schemaVersion: manifest.schemaVersion,
  totalUncompressedBytes: manifest.totalUncompressedBytes,
  totalEntries: manifest.totalEntries,
  categories: buildCategorySummaries(manifest, records),
  includedCategories: [...manifest.includedCategories],
  excludedCategories: [...manifest.excludedCategories],
  excludedFields: [...manifest.excludedFields],
  excludedStores: [...manifest.excludedStores],
  conflictCounts,
  warnings: manifest.excludedCategories.map(item => `${item.category}: ${item.reason}`),
});

const parseJson = (bytes: Uint8Array, path: string): unknown => {
  try {
    return decodeArchiveValue(JSON.parse(decoder.decode(bytes)));
  } catch {
    throw new Error(`Workspace archive entry ${path} contains invalid JSON.`);
  }
};

const parseManifest = (value: unknown): WorkspaceArchiveManifest => {
  if (!isRecord(value) || value.format !== WORKSPACE_ARCHIVE_FORMAT) {
    throw new Error('This is not an EduCare workspace archive.');
  }
  if (value.schemaVersion !== WORKSPACE_ARCHIVE_SCHEMA_VERSION) {
    throw new Error(`Unsupported workspace archive schema: ${String(value.schemaVersion)}.`);
  }
  if (typeof value.archiveId !== 'string' || !value.archiveId) {
    throw new Error('Workspace archive manifest is missing archiveId.');
  }
  if (!Array.isArray(value.includedCategories) || !value.includedCategories.every(validCategory)) {
    throw new Error('Workspace archive manifest has invalid included categories.');
  }
  const includedCategories = value.includedCategories as WorkspaceArchiveCategory[];
  if (new Set(includedCategories).size !== includedCategories.length) {
    throw new Error('Workspace archive manifest repeats an included category.');
  }
  if (
    !Array.isArray(value.excludedCategories) ||
    !value.excludedCategories.every(
      item => isRecord(item) && validCategory(item.category) && typeof item.reason === 'string',
    )
  ) {
    throw new Error('Workspace archive manifest has invalid excluded categories.');
  }
  if (!Array.isArray(value.entries)) {
    throw new Error('Workspace archive manifest is missing entries.');
  }
  const excludedCategories = value.excludedCategories as Array<{
    category: WorkspaceArchiveCategory;
    reason: string;
  }>;
  const excludedCategoryNames = excludedCategories.map(item => item.category);
  if (new Set(excludedCategoryNames).size !== excludedCategoryNames.length) {
    throw new Error('Workspace archive manifest repeats an excluded category.');
  }
  if (excludedCategoryNames.some(category => includedCategories.includes(category))) {
    throw new Error('Workspace archive manifest includes and excludes the same category.');
  }
  const declaredCategories = new Set([...includedCategories, ...excludedCategoryNames]);
  if (
    declaredCategories.size !== WORKSPACE_ARCHIVE_CATEGORIES.length ||
    WORKSPACE_ARCHIVE_CATEGORIES.some(category => !declaredCategories.has(category))
  ) {
    throw new Error('Workspace archive manifest does not declare every archive category.');
  }
  const entries = value.entries.map((entry, index): WorkspaceArchiveEntry => {
    const candidate = isRecord(entry) ? entry : {};
    if (
      !isRecord(entry) ||
      typeof candidate.path !== 'string' ||
      !validCategory(candidate.category) ||
      !Number.isInteger(candidate.size) ||
      (candidate.size as number) < 0 ||
      typeof candidate.checksum !== 'string' ||
      !/^[0-9a-f]{64}$/i.test(candidate.checksum) ||
      !Number.isInteger(candidate.recordCount) ||
      (candidate.recordCount as number) < 0
    ) {
      throw new Error(`Workspace archive manifest entry #${index + 1} is invalid.`);
    }
    return {
      path: candidate.path as string,
      category: candidate.category as WorkspaceArchiveCategory,
      size: candidate.size as number,
      checksum: candidate.checksum as string,
      recordCount: candidate.recordCount as number,
    };
  });
  const entryCategories = entries.map(entry => entry.category);
  if (
    new Set(entryCategories).size !== entryCategories.length ||
    entryCategories.length !== includedCategories.length ||
    entryCategories.some(category => !includedCategories.includes(category)) ||
    includedCategories.some(category => !entryCategories.includes(category))
  ) {
    throw new Error('Workspace archive manifest entries do not match included categories.');
  }
  for (const entry of entries) {
    if (entry.path !== `${RECORDS_PREFIX}${entry.category}.json`) {
      throw new Error(`Workspace archive entry ${entry.path} does not match its category.`);
    }
  }
  const totalUncompressedBytesValue = value.totalUncompressedBytes;
  const totalEntriesValue = value.totalEntries;
  if (
    !Number.isInteger(totalUncompressedBytesValue) ||
    (totalUncompressedBytesValue as number) < 0 ||
    !Number.isInteger(totalEntriesValue) ||
    (totalEntriesValue as number) < 0
  ) {
    throw new Error('Workspace archive manifest has invalid size limits.');
  }
  const totalUncompressedBytes = totalUncompressedBytesValue as number;
  const totalEntries = totalEntriesValue as number;
  const excludedFields = Array.isArray(value.excludedFields)
    ? value.excludedFields.filter((field): field is string => typeof field === 'string')
    : [];
  const excludedStores = Array.isArray(value.excludedStores)
    ? value.excludedStores.filter((store): store is string => typeof store === 'string')
    : [...WORKSPACE_ARCHIVE_EXCLUDED_STORES];
  return {
    format: WORKSPACE_ARCHIVE_FORMAT,
    schemaVersion: WORKSPACE_ARCHIVE_SCHEMA_VERSION,
    archiveId: value.archiveId,
    exportedAt: typeof value.exportedAt === 'number' ? value.exportedAt : 0,
    includedCategories: [...includedCategories],
    excludedCategories: excludedCategories.map(item => ({
      category: (item as { category: WorkspaceArchiveCategory }).category,
      reason: (item as { reason: string }).reason,
    })),
    entries,
    totalUncompressedBytes: totalUncompressedBytes as number,
    totalEntries: totalEntries as number,
    excludedFields,
    excludedStores,
  };
};

const validateArchiveRecords = (
  records: WorkspaceArchiveSource,
  manifest: WorkspaceArchiveManifest,
): void => {
  const isFiniteNumber = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value);
  const isStringArray = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every(item => typeof item === 'string');
  const isRagChunkArray = (value: unknown): boolean =>
    Array.isArray(value) &&
    value.every(
      chunk =>
        isRecord(chunk) &&
        typeof chunk.fileName === 'string' &&
        typeof chunk.content === 'string' &&
        (chunk.vector === undefined ||
          (Array.isArray(chunk.vector) && chunk.vector.every(isFiniteNumber))) &&
        (chunk.relevanceScore === undefined || isFiniteNumber(chunk.relevanceScore)),
    );
  const validateIds = (category: WorkspaceArchiveCategory, field: string, value: unknown): void => {
    const ids = new Set<string>();
    for (const [index, record] of asArray(value).entries()) {
      if (!isRecord(record) || typeof record[field] !== 'string' || !record[field]) {
        throw new Error(`Workspace archive ${category} record #${index + 1} is missing ${field}.`);
      }
      const id = record[field] as string;
      if (ids.has(id)) {
        throw new Error(`Workspace archive ${category} repeats identifier ${id}.`);
      }
      ids.add(id);
    }
  };
  validateIds('assistants', 'id', records.assistants);
  validateIds('sessions', 'id', records.sessions);
  validateIds('bundles', 'id', records.bundles);
  validateIds('checkpoints', 'runId', records.checkpoints);
  for (const [index, record] of asArray(records.assistants).entries()) {
    if (
      !isRecord(record) ||
      typeof record.name !== 'string' ||
      typeof record.description !== 'string' ||
      typeof record.systemPrompt !== 'string' ||
      !isFiniteNumber(record.createdAt) ||
      (record.ragChunks !== undefined && !isRagChunkArray(record.ragChunks)) ||
      (record.starterPrompts !== undefined && !isStringArray(record.starterPrompts)) ||
      (record.routableAssistantIds !== undefined && !isStringArray(record.routableAssistantIds))
    ) {
      throw new Error(`Workspace archive assistants record #${index + 1} has an invalid shape.`);
    }
  }
  for (const [index, record] of asArray(records.sessions).entries()) {
    if (
      !isRecord(record) ||
      typeof record.assistantId !== 'string' ||
      !Array.isArray(record.messages) ||
      typeof record.title !== 'string' ||
      !isFiniteNumber(record.createdAt) ||
      !isFiniteNumber(record.tokenCount)
    ) {
      throw new Error(`Workspace archive sessions record #${index + 1} has an invalid shape.`);
    }
  }
  for (const [index, record] of asArray(records.bundles).entries()) {
    const bundle = isRecord(record) && isRecord(record.bundle) ? record.bundle : undefined;
    const manifestRecord = bundle && isRecord(bundle.manifest) ? bundle.manifest : undefined;
    if (
      !isRecord(record) ||
      !isRecord(bundle) ||
      !manifestRecord ||
      !Array.isArray(bundle.agents) ||
      !Array.isArray(bundle.routes) ||
      manifestRecord.format !== 'educare-agent-bundle' ||
      (manifestRecord.schemaVersion !== 1 && manifestRecord.schemaVersion !== 2) ||
      typeof manifestRecord.name !== 'string' ||
      typeof manifestRecord.description !== 'string' ||
      typeof manifestRecord.version !== 'string' ||
      !isFiniteNumber(manifestRecord.exportedAt) ||
      typeof manifestRecord.entryAgentId !== 'string'
    ) {
      throw new Error(`Workspace archive bundles record #${index + 1} has an invalid shape.`);
    }
    const agents = bundle.agents as unknown[];
    const agentIds = new Set<string>();
    for (const agent of agents) {
      if (
        !isRecord(agent) ||
        typeof agent.id !== 'string' ||
        !agent.id ||
        typeof agent.name !== 'string' ||
        typeof agent.description !== 'string' ||
        typeof agent.systemPrompt !== 'string' ||
        !isStringArray(agent.starterPrompts) ||
        !isRagChunkArray(agent.ragChunks) ||
        (agent.icon !== undefined && typeof agent.icon !== 'string') ||
        (agent.mathToolsEnabled !== undefined && typeof agent.mathToolsEnabled !== 'boolean') ||
        (agent.webSpeechToolsEnabled !== undefined &&
          typeof agent.webSpeechToolsEnabled !== 'boolean') ||
        (agent.modelParams !== undefined && !isRecord(agent.modelParams))
      ) {
        throw new Error(`Workspace archive bundles record #${index + 1} has an invalid agent.`);
      }
      if (agentIds.has(agent.id)) {
        throw new Error(`Workspace archive bundles record #${index + 1} repeats an agent.`);
      }
      agentIds.add(agent.id);
    }
    if (
      typeof manifestRecord.entryAgentId !== 'string' ||
      !agentIds.has(manifestRecord.entryAgentId)
    ) {
      throw new Error(`Workspace archive bundles record #${index + 1} has a dangling entry agent.`);
    }
    for (const route of bundle.routes) {
      if (
        !isRecord(route) ||
        typeof route.fromAgentId !== 'string' ||
        typeof route.toAgentId !== 'string' ||
        (route.condition !== undefined && typeof route.condition !== 'string') ||
        !agentIds.has(route.fromAgentId) ||
        !agentIds.has(route.toAgentId)
      ) {
        throw new Error(`Workspace archive bundles record #${index + 1} has a dangling route.`);
      }
    }
  }
  for (const [index, record] of asArray(records.checkpoints).entries()) {
    if (
      !isRecord(record) ||
      record.schemaVersion !== 1 ||
      typeof record.sessionId !== 'string' ||
      typeof record.assistantId !== 'string' ||
      (record.projectId !== null && typeof record.projectId !== 'string') ||
      !['running', 'paused', 'stopped', 'complete', 'failed', 'aborted'].includes(
        String(record.status),
      ) ||
      !Number.isInteger(record.turnIndex) ||
      !Number.isInteger(record.maxTurns) ||
      typeof record.originalMessage !== 'string' ||
      !Array.isArray(record.committedHistoryDelta) ||
      record.committedHistoryDelta.some(item => !isRecord(item)) ||
      !isStringArray(record.toolTrace) ||
      !isRecord(record.tokenTotals) ||
      !isFiniteNumber(record.tokenTotals.promptTokenCount) ||
      !isFiniteNumber(record.tokenTotals.candidatesTokenCount) ||
      typeof record.agentHarnessEnabled !== 'boolean' ||
      (record.openJevExperimentEnabled !== undefined &&
        typeof record.openJevExperimentEnabled !== 'boolean') ||
      typeof record.sharedMode !== 'boolean' ||
      !isFiniteNumber(record.createdAt) ||
      !isFiniteNumber(record.updatedAt) ||
      !isFiniteNumber(record.heartbeatAt)
    ) {
      throw new Error(`Workspace archive checkpoints record #${index + 1} has an invalid schema.`);
    }
    if (
      record.routableTargets !== undefined &&
      (!Array.isArray(record.routableTargets) ||
        record.routableTargets.some(
          target =>
            !isRecord(target) ||
            typeof target.id !== 'string' ||
            typeof target.name !== 'string' ||
            typeof target.description !== 'string',
        ))
    ) {
      throw new Error(`Workspace archive checkpoints record #${index + 1} has invalid targets.`);
    }
  }
  for (const entry of manifest.entries) {
    const recordValue = sourceRecordsForCategory(records, entry.category);
    const actualCount =
      entry.category === 'preferences' && isRecord(recordValue)
        ? Object.keys(recordValue).length
        : asArray(recordValue).length;
    if (actualCount !== entry.recordCount) {
      throw new Error(`Workspace archive entry ${entry.path} has an incorrect record count.`);
    }
  }
};

const assertArchiveLimits = (entries: Record<string, Uint8Array>): void => {
  const names = Object.keys(entries);
  if (names.length > WORKSPACE_ARCHIVE_MAX_ENTRIES) {
    throw new Error(
      `Workspace archive contains more than ${WORKSPACE_ARCHIVE_MAX_ENTRIES} entries.`,
    );
  }
  const totalBytes = names.reduce((sum, name) => sum + entries[name].byteLength, 0);
  if (totalBytes > WORKSPACE_ARCHIVE_MAX_UNCOMPRESSED_BYTES) {
    throw new Error(
      `Workspace archive expands beyond the ${WORKSPACE_ARCHIVE_MAX_UNCOMPRESSED_BYTES} byte limit.`,
    );
  }
};

const buildIdMap = async (
  records: WorkspaceArchiveSource,
  existing: WorkspaceArchiveSource,
  copy: boolean,
  operationToken?: WorkspaceOperationToken,
): Promise<WorkspaceArchiveIdMap> => {
  const idMap = createEmptyIdMap();
  const assistantIds = new Set(
    asArray(existing.assistants).flatMap(item =>
      isRecord(item) && typeof item.id === 'string' ? [item.id] : [],
    ),
  );
  const sessionIds = new Set(
    asArray(existing.sessions).flatMap(item =>
      isRecord(item) && typeof item.id === 'string' ? [item.id] : [],
    ),
  );
  const bundleIds = new Set(
    asArray(existing.bundles).flatMap(item =>
      isRecord(item) && typeof item.id === 'string' ? [item.id] : [],
    ),
  );
  const checkpointIds = new Set(
    asArray(existing.checkpoints).flatMap(item =>
      isRecord(item) && typeof item.runId === 'string' ? [item.runId] : [],
    ),
  );

  for (const assistant of asArray(records.assistants)) {
    if (isRecord(assistant) && typeof assistant.id === 'string') {
      setMapped(
        idMap.assistants,
        assistant.id,
        copyId('assistant', assistant.id, assistantIds, copy),
      );
    }
  }
  for (const session of asArray(records.sessions)) {
    if (isRecord(session) && typeof session.id === 'string') {
      setMapped(idMap.sessions, session.id, copyId('session', session.id, sessionIds, copy));
    }
  }
  for (const bundle of asArray(records.bundles)) {
    if (isRecord(bundle) && typeof bundle.id === 'string') {
      setMapped(idMap.bundles, bundle.id, copyId('bundle', bundle.id, bundleIds, copy));
    }
  }
  // Build virtual assistant mappings before remapping sessions/checkpoints so
  // route proposals and handoff metadata can point at copied bundle agents.
  for (const bundle of asArray(records.bundles)) {
    if (!isRecord(bundle) || typeof bundle.id !== 'string' || !isRecord(bundle.bundle)) {
      continue;
    }
    const mappedBundleId = idMap.bundles[bundle.id] ?? bundle.id;
    const agents = Array.isArray(bundle.bundle.agents) ? bundle.bundle.agents : [];
    for (const agent of agents) {
      if (!isRecord(agent) || typeof agent.id !== 'string') {
        continue;
      }
      const separator = agent.id.lastIndexOf(':');
      const bareId = separator > -1 ? agent.id.slice(separator + 1) : agent.id;
      const mapped = `${mappedBundleId}:${bareId}`;
      idMap.virtualAssistants[agent.id] = mapped;
      idMap.virtualAssistants[`${bundle.id}:${bareId}`] = mapped;
      idMap.virtualAssistants[bareId] = mapped;
    }
  }
  for (const checkpoint of asArray(records.checkpoints)) {
    if (isRecord(checkpoint) && typeof checkpoint.runId === 'string') {
      setMapped(
        idMap.checkpoints,
        checkpoint.runId,
        copyId('run', checkpoint.runId, checkpointIds, copy),
      );
    }
  }

  const projectRecords = asArray(records.projects);
  const projectIds = new Set<string>();
  for (const project of asArray(existing.projects)) {
    if (isRecord(project) && typeof project.id === 'string') {
      projectIds.add(project.id);
    }
  }
  for (const project of projectRecords) {
    if (isRecord(project)) {
      const original = typeof project.id === 'string' ? project.id : project.projectId;
      if (typeof original === 'string') {
        setMapped(idMap.projects, original, copyId('project', original, projectIds, copy));
      }
    }
  }
  if (Object.keys(idMap.projects).length > 0) {
    idMap.providerRecords.projects = { ...idMap.projects };
  }

  for (const category of ['snapshots', 'git', 'drafts', 'practice'] as const) {
    const categoryMap: Record<string, string> = {};
    const used = new Set<string>();
    for (const record of asArray(records[category])) {
      if (!isRecord(record)) {
        continue;
      }
      const original = typeof record.id === 'string' ? record.id : undefined;
      if (original) {
        setMapped(categoryMap, original, copyId(category, original, used, copy));
      }
    }
    if (Object.keys(categoryMap).length > 0) {
      idMap.providerRecords[category] = categoryMap;
    }
  }

  for (const provider of providerRegistry.values()) {
    if (!provider.listExistingIds) {
      continue;
    }
    const existingIds = await provider.listExistingIds({ operationToken });
    const categoryMap = idMap.providerRecords[provider.category] ?? {};
    const used = new Set(existingIds);
    for (const record of asArray(records[provider.category])) {
      if (!isRecord(record) || typeof record.id !== 'string') {
        continue;
      }
      const mapped = copyId(provider.category, record.id, used, copy);
      setMapped(categoryMap, record.id, mapped);
      if (provider.category === 'projects') {
        idMap.projects[record.id] = mapped;
      }
    }
    idMap.providerRecords[provider.category] = categoryMap;
  }
  return idMap;
};

const buildImportedRecords = (
  records: WorkspaceArchiveSource,
  idMap: WorkspaceArchiveIdMap,
): {
  assistants: Assistant[];
  sessions: ChatSession[];
  bundles: BundleRecord[];
  checkpoints: AgentRunCheckpoint[];
  providers: WorkspaceArchiveSource;
} => {
  const assistants = asArray(records.assistants).map(item => {
    const remapped = remapRecord(scrubSensitive(item), idMap) as Assistant;
    return { ...remapped, id: idMap.assistants[remapped.id] ?? remapped.id };
  });
  const sessions = asArray(records.sessions).map(item => {
    const remapped = remapRecord(scrubSensitive(item), idMap) as ChatSession;
    return { ...remapped, id: idMap.sessions[remapped.id] ?? remapped.id };
  });
  const bundles = asArray(records.bundles).map(item => {
    const raw = item as BundleRecord;
    const mappedId = idMap.bundles[raw.id] ?? raw.id;
    return remapBundle(raw, mappedId, idMap);
  });
  const checkpoints = asArray(records.checkpoints).map(item => {
    const remapped = remapRecord(scrubSensitive(item), idMap) as AgentRunCheckpoint;
    return {
      ...remapped,
      runId: idMap.checkpoints[remapped.runId] ?? remapped.runId,
      // Imported runs must never be treated as an in-flight operation and
      // auto-resumed merely because the source tab crashed mid-turn.
      status: remapped.status === 'running' ? 'stopped' : remapped.status,
    };
  });
  const providers: WorkspaceArchiveSource = {};
  for (const category of WORKSPACE_ARCHIVE_CATEGORIES) {
    if (
      category === 'assistants' ||
      category === 'sessions' ||
      category === 'bundles' ||
      category === 'checkpoints'
    ) {
      continue;
    }
    const raw = sourceRecordsForCategory(records, category);
    if (category === 'preferences') {
      providers.preferences = scrubRecords(category, raw) as Record<string, unknown>;
      continue;
    }
    const mapped = asArray(raw).map(item => remapRecord(scrubRecords(category, item), idMap));
    const categoryMap = idMap.providerRecords[category];
    providers[category] = categoryMap
      ? mapped.map(item => {
          if (!isRecord(item) || typeof item.id !== 'string') {
            return item;
          }
          return { ...item, id: categoryMap[item.id] ?? item.id };
        })
      : mapped;
  }
  return { assistants, sessions, bundles, checkpoints, providers };
};

const validateMappedForeignKeys = async (
  imported: ReturnType<typeof buildImportedRecords>,
  existing: WorkspaceArchiveSource,
  operationToken: WorkspaceOperationToken,
): Promise<void> => {
  const assistantIds = new Set<string>([
    ...asArray(existing.assistants).flatMap(record =>
      isRecord(record) && typeof record.id === 'string' ? [record.id] : [],
    ),
    ...imported.assistants.map(record => record.id),
  ]);
  const virtualAssistantIds = new Set(
    Object.values(imported.bundles).flatMap(bundle => bundle.bundle.agents.map(agent => agent.id)),
  );
  const assistantReferenceIds = new Set([...assistantIds, ...virtualAssistantIds]);
  const sessionIds = new Set<string>([
    ...asArray(existing.sessions).flatMap(record =>
      isRecord(record) && typeof record.id === 'string' ? [record.id] : [],
    ),
    ...imported.sessions.map(record => record.id),
  ]);
  const checkpointIds = new Set<string>([
    ...asArray(existing.checkpoints).flatMap(record =>
      isRecord(record) && typeof record.runId === 'string' ? [record.runId] : [],
    ),
    ...imported.checkpoints.map(record => record.runId),
  ]);
  const projectIds = new Set<string>(
    asArray(imported.providers.projects).flatMap(record => {
      if (!isRecord(record)) {
        return [];
      }
      const id = typeof record.id === 'string' ? record.id : record.projectId;
      return typeof id === 'string' ? [id] : [];
    }),
  );
  const projectProvider = providerRegistry.get('projects');
  if (projectProvider?.listExistingIds) {
    (await projectProvider.listExistingIds({ operationToken })).forEach(id => projectIds.add(id));
  }
  const assertKnown = (value: unknown, allowed: Set<string>, field: string): void => {
    if (typeof value === 'string' && !allowed.has(value)) {
      throw new Error(`Workspace archive ${field} references an unknown identifier: ${value}.`);
    }
  };

  for (const session of imported.sessions) {
    assertKnown(session.assistantId, assistantReferenceIds, 'sessions.assistantId');
    const sourceSessionId = (session as unknown as Record<string, unknown>).sourceSessionId;
    assertKnown(sourceSessionId, sessionIds, 'sessions.sourceSessionId');
  }
  for (const assistant of imported.assistants) {
    const routableAssistantIds = (assistant as unknown as Record<string, unknown>)
      .routableAssistantIds;
    if (Array.isArray(routableAssistantIds)) {
      routableAssistantIds.forEach(id => {
        if (typeof id === 'string' && !assistantIds.has(id) && !virtualAssistantIds.has(id)) {
          throw new Error(
            `Workspace archive assistants.routableAssistantIds references an unknown identifier: ${id}.`,
          );
        }
      });
    }
    const routableTargets = (assistant as unknown as Record<string, unknown>).routableTargets;
    if (Array.isArray(routableTargets)) {
      routableTargets.forEach(target => {
        if (isRecord(target)) {
          const targetId = target.id;
          if (
            typeof targetId === 'string' &&
            !assistantIds.has(targetId) &&
            !virtualAssistantIds.has(targetId)
          ) {
            throw new Error(
              `Workspace archive assistants.routableTargets references an unknown identifier: ${targetId}.`,
            );
          }
        }
      });
    }
  }
  for (const checkpoint of imported.checkpoints) {
    assertKnown(checkpoint.sessionId, sessionIds, 'checkpoints.sessionId');
    assertKnown(checkpoint.assistantId, assistantReferenceIds, 'checkpoints.assistantId');
    assertKnown(checkpoint.runId, checkpointIds, 'checkpoints.runId');
    if (
      typeof checkpoint.projectId === 'string' &&
      projectIds.size > 0 &&
      !projectIds.has(checkpoint.projectId)
    ) {
      throw new Error(
        `Workspace archive checkpoints.projectId references an unknown identifier: ${checkpoint.projectId}.`,
      );
    }
    if (Array.isArray(checkpoint.routableTargets)) {
      checkpoint.routableTargets.forEach(target => {
        if (
          !assistantIds.has(target.id) &&
          !virtualAssistantIds.has(target.id) &&
          typeof target.id === 'string'
        ) {
          throw new Error(
            `Workspace archive checkpoints.routableTargets references an unknown identifier: ${target.id}.`,
          );
        }
      });
    }
  }
  const validateProviderProjectReferences = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(validateProviderProjectReferences);
      return;
    }
    if (!isRecord(value)) {
      return;
    }
    for (const [key, nested] of Object.entries(value)) {
      if (
        key === 'projectId' &&
        typeof nested === 'string' &&
        projectIds.size > 0 &&
        !projectIds.has(nested)
      ) {
        throw new Error(
          `Workspace archive provider record projectId references an unknown identifier: ${nested}.`,
        );
      }
      validateProviderProjectReferences(nested);
    }
  };
  for (const category of ['projects', 'snapshots', 'git', 'drafts', 'practice'] as const) {
    validateProviderProjectReferences(imported.providers[category]);
  }
};

export const registerWorkspaceArchiveProvider = (
  provider: WorkspaceArchiveProvider,
): (() => void) => {
  if (
    !validCategory(provider.category) ||
    ['assistants', 'sessions', 'bundles', 'checkpoints'].includes(provider.category)
  ) {
    throw new Error(`Invalid workspace archive provider category: ${provider.category}.`);
  }
  if (providerRegistry.has(provider.category)) {
    throw new Error(`Workspace archive provider already registered for ${provider.category}.`);
  }
  providerRegistry.set(provider.category, provider);
  return () => {
    if (providerRegistry.get(provider.category) === provider) {
      providerRegistry.delete(provider.category);
    }
  };
};

export const unregisterWorkspaceArchiveProvider = (category: WorkspaceArchiveCategory): void => {
  providerRegistry.delete(category);
};

export const getWorkspaceArchiveProvider = (
  category: WorkspaceArchiveCategory,
): WorkspaceArchiveProvider | undefined => providerRegistry.get(category);

export const buildWorkspaceArchive = async (
  source: WorkspaceArchiveSource,
  options: Omit<WorkspaceArchiveExportOptions, 'source'> = {},
): Promise<WorkspaceArchiveExportResult> => {
  const now = options.now ?? Date.now();
  const archiveId = options.archiveId ?? createId('archive');
  const requested = normalizeCategoryList(options.categories);
  const excluded = new Set(options.excludeCategories ?? []);
  for (const category of excluded) {
    if (!validCategory(category)) {
      throw new Error(`Unknown workspace archive category: ${String(category)}.`);
    }
  }

  const entries: Record<string, Uint8Array> = {};
  const manifestEntries: WorkspaceArchiveEntry[] = [];
  const excludedCategories: Array<{ category: WorkspaceArchiveCategory; reason: string }> = [];
  for (const category of WORKSPACE_ARCHIVE_CATEGORIES) {
    if (!requested.includes(category) || excluded.has(category)) {
      excludedCategories.push({
        category,
        reason: excluded.has(category) ? 'excluded by export policy' : 'not requested',
      });
      continue;
    }
    const provider = providerRegistry.get(category);
    let raw: unknown[] | Record<string, unknown> = sourceRecordsForCategory(source, category);
    if (source[category] === undefined && provider) {
      raw = (await provider.exportRecords()) ?? (category === 'preferences' ? {} : []);
    }
    const normalized = normalizeProviderRecords(category, raw);
    const recordCount =
      category === 'preferences' && isRecord(normalized)
        ? Object.keys(normalized).length
        : asArray(normalized).length;
    if (category !== 'preferences' && !Array.isArray(normalized)) {
      throw new Error(`Workspace archive category ${category} must be an array.`);
    }
    const path = `${RECORDS_PREFIX}${category}.json`;
    validateArchivePath(path);
    const bytes = bytesForJson(normalized);
    entries[path] = bytes;
    manifestEntries.push({
      path,
      category,
      size: bytes.byteLength,
      checksum: await checksumFor(bytes),
      recordCount,
    });
  }

  const totalUncompressedBytes = Object.values(entries).reduce(
    (sum, bytes) => sum + bytes.byteLength,
    0,
  );
  const totalEntries = Object.keys(entries).length + 1;
  if (totalEntries > WORKSPACE_ARCHIVE_MAX_ENTRIES) {
    throw new Error(
      `Workspace archive contains more than ${WORKSPACE_ARCHIVE_MAX_ENTRIES} entries.`,
    );
  }
  if (totalUncompressedBytes > WORKSPACE_ARCHIVE_MAX_UNCOMPRESSED_BYTES) {
    throw new Error(
      `Workspace archive exceeds the ${WORKSPACE_ARCHIVE_MAX_UNCOMPRESSED_BYTES} byte limit before writing.`,
    );
  }

  const manifest: WorkspaceArchiveManifest = {
    format: WORKSPACE_ARCHIVE_FORMAT,
    schemaVersion: WORKSPACE_ARCHIVE_SCHEMA_VERSION,
    archiveId,
    exportedAt: now,
    includedCategories: manifestEntries.map(entry => entry.category),
    excludedCategories,
    entries: manifestEntries,
    totalUncompressedBytes,
    totalEntries,
    excludedFields: [
      'providerSettings',
      'apiKey',
      'secret',
      'password',
      'encryptedProviderSettings',
    ],
    excludedStores: [...WORKSPACE_ARCHIVE_EXCLUDED_STORES],
  };
  const manifestBytes = bytesForJson(manifest);
  if (
    totalUncompressedBytes + manifestBytes.byteLength >
    WORKSPACE_ARCHIVE_MAX_UNCOMPRESSED_BYTES
  ) {
    throw new Error(
      `Workspace archive exceeds the ${WORKSPACE_ARCHIVE_MAX_UNCOMPRESSED_BYTES} byte limit before writing.`,
    );
  }
  const zipEntries = { ...entries, [MANIFEST_PATH]: manifestBytes };
  const bytes = zipSync(zipEntries, { level: 6 });
  const parsed = await parseWorkspaceArchive(bytes);
  const preview = parsed.preview;
  const blob = new globalThis.Blob([bytes], { type: 'application/zip' });
  return {
    bytes,
    blob,
    fileName: `educare-workspace-${archiveId}.zip`,
    manifest,
    preview,
  };
};

export const parseWorkspaceArchive = async (
  archiveBytes: Uint8Array,
): Promise<ParsedWorkspaceArchive> => {
  const bytes = ensureUint8Array(archiveBytes);
  if (bytes.byteLength > WORKSPACE_ARCHIVE_MAX_UNCOMPRESSED_BYTES) {
    throw new Error('Workspace archive input exceeds the safe size limit.');
  }
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipAssistantPackage(bytes);
  } catch (error) {
    // The shared helper validates material paths during central-directory
    // inspection. Preserve the archive service's stable English safety signal
    // for callers instead of leaking the helper's localized diagnostic.
    if (error instanceof Error && /不安全|路徑/.test(error.message)) {
      throw new Error('Workspace archive contains an unsafe path.');
    }
    throw new Error('Workspace archive is not a readable ZIP file.');
  }
  assertArchiveLimits(entries);
  const paths = Object.keys(entries).map(validateArchivePath);
  if (!paths.includes(MANIFEST_PATH)) {
    throw new Error('Workspace archive is missing manifest.json.');
  }
  const manifest = parseManifest(parseJson(entries[MANIFEST_PATH], MANIFEST_PATH));
  if (
    manifest.totalEntries !== paths.length ||
    manifest.totalEntries > WORKSPACE_ARCHIVE_MAX_ENTRIES
  ) {
    throw new Error('Workspace archive manifest entry count does not match the ZIP.');
  }
  const actualTotalBytes =
    paths.reduce((sum, path) => sum + entries[path].byteLength, 0) -
    entries[MANIFEST_PATH].byteLength;
  if (
    actualTotalBytes !== manifest.totalUncompressedBytes ||
    actualTotalBytes > WORKSPACE_ARCHIVE_MAX_UNCOMPRESSED_BYTES
  ) {
    throw new Error('Workspace archive manifest size does not match the ZIP contents.');
  }

  const manifestPaths = new Set<string>();
  for (const entry of manifest.entries) {
    validateArchivePath(entry.path);
    if (
      entry.path === MANIFEST_PATH ||
      manifestPaths.has(entry.path) ||
      !entry.path.startsWith(RECORDS_PREFIX)
    ) {
      throw new Error(
        `Workspace archive manifest has a duplicate or unsafe entry path: ${entry.path}.`,
      );
    }
    manifestPaths.add(entry.path);
    const entryBytes = entries[entry.path];
    if (!entryBytes) {
      throw new Error(`Workspace archive is missing declared entry ${entry.path}.`);
    }
    if (entryBytes.byteLength !== entry.size) {
      throw new Error(`Workspace archive entry ${entry.path} has an incorrect size.`);
    }
    if ((await checksumFor(entryBytes)).toLowerCase() !== entry.checksum.toLowerCase()) {
      throw new Error(`Workspace archive entry ${entry.path} failed checksum validation.`);
    }
  }
  for (const path of paths) {
    if (path !== MANIFEST_PATH && !manifestPaths.has(path)) {
      throw new Error(`Workspace archive contains an undeclared entry: ${path}.`);
    }
  }

  const records: WorkspaceArchiveSource = {};
  for (const entry of manifest.entries) {
    const category = entry.category;
    const decoded = parseJson(entries[entry.path], entry.path);
    if (category === 'preferences') {
      if (!isRecord(decoded)) {
        throw new Error('Workspace archive preferences entry must be an object.');
      }
      records.preferences = decoded;
      if (Object.keys(decoded).length !== entry.recordCount) {
        throw new Error(`Workspace archive entry ${entry.path} has an incorrect record count.`);
      }
    } else {
      if (!Array.isArray(decoded)) {
        throw new Error(`Workspace archive entry ${entry.path} must contain an array.`);
      }
      records[category] = decoded;
      if (decoded.length !== entry.recordCount) {
        throw new Error(`Workspace archive entry ${entry.path} has an incorrect record count.`);
      }
    }
  }
  validateArchiveRecords(records, manifest);
  return {
    bytes,
    manifest,
    entries,
    records,
    preview: buildPreview(manifest, records),
  };
};

const buildConflicts = async (
  parsed: ParsedWorkspaceArchive,
  operationToken?: WorkspaceOperationToken,
): Promise<Partial<Record<WorkspaceArchiveCategory, number>>> => {
  const operationOptions = operationToken ? { operationToken } : {};
  const existing = await getWorkspaceDatabaseSnapshot(operationOptions);
  const existingCheckpoints = await getCheckpointArchiveRecords(operationOptions);
  const conflicts: Partial<Record<WorkspaceArchiveCategory, number>> = {};
  for (const category of ['assistants', 'sessions', 'bundles', 'checkpoints'] as const) {
    const existingIds = new Set(
      category === 'checkpoints'
        ? existingCheckpoints.map(record => record.runId)
        : existing[category].map(record => record.id),
    );
    const incoming = asArray(parsed.records[category]);
    const count = incoming.filter(record => {
      if (!isRecord(record)) {
        return false;
      }
      const id = category === 'checkpoints' ? record.runId : record.id;
      return typeof id === 'string' && existingIds.has(id);
    }).length;
    if (count > 0) {
      conflicts[category] = count;
    }
  }
  for (const provider of providerRegistry.values()) {
    if (!provider.listExistingIds) {
      continue;
    }
    const incoming = asArray(parsed.records[provider.category]);
    if (incoming.length === 0) {
      continue;
    }
    const existingIds = new Set(await provider.listExistingIds({ operationToken }));
    const count = incoming.filter(
      record => isRecord(record) && typeof record.id === 'string' && existingIds.has(record.id),
    ).length;
    if (count > 0) {
      conflicts[provider.category] = count;
    }
  }
  return conflicts;
};

export const previewWorkspaceArchive = async (
  archiveBytes: Uint8Array,
): Promise<WorkspaceArchivePreview> => {
  const parsed = await parseWorkspaceArchive(archiveBytes);
  return buildPreview(parsed.manifest, parsed.records, await buildConflicts(parsed));
};

const readSourceForExport = async (
  options: WorkspaceArchiveExportOptions,
  operationToken: WorkspaceOperationToken,
): Promise<WorkspaceArchiveSource> => {
  if (options.source) {
    return options.source;
  }
  const operationOptions = { operationToken };
  const snapshot = await getWorkspaceDatabaseSnapshot(operationOptions);
  const source: WorkspaceArchiveSource = {
    assistants: snapshot.assistants,
    sessions: snapshot.sessions,
    bundles: snapshot.bundles,
    checkpoints: await getCheckpointArchiveRecords(operationOptions),
  };
  source.preferences = options.preferences ?? collectWorkspacePreferences();
  for (const provider of providerRegistry.values()) {
    (source as Record<string, unknown>)[provider.category] = await provider.exportRecords({
      operationToken,
    });
  }
  return source;
};

export const exportWorkspaceArchive = async (
  options: WorkspaceArchiveExportOptions = {},
): Promise<WorkspaceArchiveExportResult> =>
  withWorkspaceOperation('export', async operationToken => {
    resetWorkspacePreferenceWarnings();
    const result = await buildWorkspaceArchive(
      await readSourceForExport(options, operationToken),
      options,
    );
    const preferenceWarnings = getWorkspacePreferenceWarnings();
    if (getWorkspaceOperationStatus().coordination === 'local-only') {
      preferenceWarnings.push(
        'Workspace coordination is local-only; allowlisted preference snapshots may not include writes from another tab.',
      );
    }
    if (preferenceWarnings.length === 0) {
      try {
        globalThis.localStorage?.setItem(WORKSPACE_ARCHIVE_LAST_BACKUP_KEY, String(Date.now()));
      } catch {
        // A blocked/quota-limited preference store must not discard a valid archive.
      }
    }
    return preferenceWarnings.length === 0
      ? result
      : {
          ...result,
          preview: {
            ...result.preview,
            warnings: [...result.preview.warnings, ...preferenceWarnings],
          },
        };
  });

const persistInitialJournal = async (
  parsed: ParsedWorkspaceArchive,
  idMap: WorkspaceArchiveIdMap,
  now: number,
  plannedRecords: WorkspaceDatabaseRecords,
  plannedCheckpoints: Array<Pick<AgentRunCheckpoint, 'runId'>>,
  plannedProviderIds: Partial<Record<WorkspaceArchiveCategory, string[]>>,
  previousPreferences?: Record<string, unknown>,
): Promise<WorkspaceArchiveJournalRecord> => {
  // Keep only a sanitized canonical payload in the recovery journal. The
  // original ZIP may have been supplied by an untrusted caller and must not be
  // retained indefinitely with secrets or arbitrary extra fields.
  const canonical = await buildWorkspaceArchive(parsed.records, {
    categories: parsed.manifest.includedCategories,
    archiveId: parsed.manifest.archiveId,
    now: parsed.manifest.exportedAt,
  });
  const journal: WorkspaceArchiveJournalRecord = {
    importId: createId('import'),
    archiveId: parsed.manifest.archiveId,
    state: 'staging',
    hidden: true,
    createdAt: now,
    updatedAt: now,
    archiveBytes: canonical.bytes,
    idMap,
    createdRecords: plannedRecords,
    createdCheckpoints: plannedCheckpoints,
    providerCreatedIds: plannedProviderIds,
    completedCategories: [],
    ...(previousPreferences ? { previousPreferences } : {}),
  };
  await persistJournal(journal);
  return journal;
};

const updateJournal = async (
  journal: WorkspaceArchiveJournalRecord,
  patch: Partial<WorkspaceArchiveJournalRecord>,
): Promise<void> => {
  Object.assign(journal, patch, { updatedAt: Date.now() });
  await persistJournal(journal);
};

const rollbackJournal = async (
  journal: WorkspaceArchiveJournalRecord,
  options: WorkspaceArchiveImportOptions = {},
  operationToken: WorkspaceOperationToken,
): Promise<{ complete: boolean; error?: string }> => {
  const errors: string[] = [];
  const operationOptions = { operationToken, ownershipImportId: journal.importId };
  try {
    clearWorkspaceArchivePublication(journal.importId);
  } catch (error) {
    errors.push(`publication receipt: ${error instanceof Error ? error.message : String(error)}`);
  }
  for (const [category, ids] of Object.entries(journal.providerCreatedIds)) {
    const provider = providerRegistry.get(category as WorkspaceArchiveCategory);
    if (!ids) {
      continue;
    }
    if (ids.length === 0) {
      errors.push(`${category}: provider did not report created IDs for rollback`);
      continue;
    }
    if (!provider?.removeImportedRecords) {
      errors.push(`${category}: provider has no rollback hook`);
      continue;
    }
    try {
      await provider.removeImportedRecords(ids, {
        archiveId: journal.archiveId,
        importId: journal.importId,
        category: category as WorkspaceArchiveCategory,
        idMap: journal.idMap,
        operationToken,
        visibility: 'hidden',
        registerCreatedIds: () => undefined,
      });
    } catch (error) {
      errors.push(`${category}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  try {
    if (journal.createdCheckpoints.length > 0) {
      await deleteCheckpointArchiveRecords(journal.createdCheckpoints, operationOptions);
    }
  } catch (error) {
    errors.push(`checkpoints: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    await deleteWorkspaceDatabaseRecords(journal.createdRecords, operationOptions);
  } catch (error) {
    errors.push(`database: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    const remaining = await getWorkspaceDatabaseSnapshot({
      includeHidden: true,
      ...operationOptions,
    });
    for (const [category, records] of Object.entries(journal.createdRecords)) {
      const ids = new Set(
        (records ?? [])
          .map((record: { id?: string }) => record.id)
          .filter((id: string | undefined): id is string => Boolean(id)),
      );
      const survivors = (remaining[category as keyof WorkspaceDatabaseRecords] ?? []).filter(
        record =>
          ids.has(record.id) &&
          (record as unknown as Record<string, unknown>)[WORKSPACE_ARCHIVE_IMPORT_ID_FIELD] ===
            journal.importId,
      );
      if (survivors.length > 0) {
        errors.push(`database.${category}: ${survivors.length} record(s) remain after rollback`);
      }
    }
  } catch (error) {
    errors.push(`database verification: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    const remainingCheckpoints = await getCheckpointArchiveRecords({
      includeHidden: true,
      ...operationOptions,
    });
    const checkpointIds = new Set(journal.createdCheckpoints.map(record => record.runId));
    const survivors = remainingCheckpoints.filter(
      record =>
        checkpointIds.has(record.runId) &&
        (record as unknown as Record<string, unknown>)[WORKSPACE_ARCHIVE_IMPORT_ID_FIELD] ===
          journal.importId,
    );
    if (survivors.length > 0) {
      errors.push(`checkpoints: ${survivors.length} record(s) remain after rollback`);
    }
  } catch (error) {
    errors.push(
      `checkpoint verification: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  for (const [category, ids] of Object.entries(journal.providerCreatedIds)) {
    const provider = providerRegistry.get(category as WorkspaceArchiveCategory);
    if (!provider?.listExistingIds || !ids || ids.length === 0) {
      continue;
    }
    try {
      const existingIds = new Set(await provider.listExistingIds({ operationToken }));
      const survivors = ids.filter(id => existingIds.has(id));
      if (survivors.length > 0) {
        errors.push(`${category}: ${survivors.length} record(s) remain after rollback`);
      }
    } catch (error) {
      errors.push(
        `${category} verification: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (journal.previousPreferences) {
    if (!options.restorePreferences) {
      errors.push('preferences: restore callback is required to complete rollback');
    } else {
      try {
        await options.restorePreferences(journal.previousPreferences);
      } catch (error) {
        errors.push(`preferences: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  return errors.length === 0 ? { complete: true } : { complete: false, error: errors.join('; ') };
};

const plannedProviderIdsForImport = (
  imported: ReturnType<typeof buildImportedRecords>,
): Partial<Record<WorkspaceArchiveCategory, string[]>> => {
  const planned: Partial<Record<WorkspaceArchiveCategory, string[]>> = {};
  for (const category of WORKSPACE_ARCHIVE_CATEGORIES) {
    if (
      category === 'assistants' ||
      category === 'sessions' ||
      category === 'bundles' ||
      category === 'checkpoints' ||
      category === 'preferences' ||
      !providerRegistry.has(category)
    ) {
      continue;
    }
    const ids = asArray(imported.providers[category]).flatMap(record => {
      if (!isRecord(record)) {
        return [];
      }
      const id =
        typeof record.id === 'string'
          ? record.id
          : typeof record.projectId === 'string'
            ? record.projectId
            : undefined;
      return id ? [id] : [];
    });
    if (ids.length > 0) {
      planned[category] = [...new Set(ids)];
    }
  }
  return planned;
};

const importWithinOperation = async (
  parsed: ParsedWorkspaceArchive,
  options: WorkspaceArchiveImportOptions,
  operationToken: WorkspaceOperationToken,
): Promise<WorkspaceArchiveImportResult> => {
  const operationOptions = { operationToken };
  const existing = await getWorkspaceDatabaseSnapshot(operationOptions);
  const existingCheckpoints = await getCheckpointArchiveRecords(operationOptions);
  const existingSource: WorkspaceArchiveSource = { ...existing, checkpoints: existingCheckpoints };
  const idMap = await buildIdMap(
    parsed.records,
    existingSource,
    options.copy !== false,
    operationToken,
  );
  const imported = buildImportedRecords(parsed.records, idMap);
  await validateMappedForeignKeys(imported, existingSource, operationToken);
  const conflicts = await buildConflicts(parsed, operationToken);
  const preferences = imported.providers.preferences;
  const hasPreferenceCallback = Boolean(
    options.applyPreferences || options.readPreferences || options.restorePreferences,
  );
  const hasCompletePreferenceCallbacks = Boolean(
    options.applyPreferences && options.readPreferences && options.restorePreferences,
  );
  if (hasPreferenceCallback && !hasCompletePreferenceCallbacks) {
    throw new Error(
      'Workspace archive preference import requires apply, read, and restore callbacks together.',
    );
  }
  const canApplyPreferences = Boolean(hasCompletePreferenceCallbacks && isRecord(preferences));
  let previousPreferences: Record<string, unknown> | undefined;
  if (canApplyPreferences) {
    const currentPreferences = await options.readPreferences?.();
    if (!isRecord(currentPreferences)) {
      throw new Error('Workspace archive preference snapshot must be an object.');
    }
    previousPreferences = scrubRecords('preferences', currentPreferences) as Record<
      string,
      unknown
    >;
  }
  const plannedRecords: WorkspaceDatabaseRecords = {
    assistants: imported.assistants,
    sessions: imported.sessions,
    bundles: imported.bundles,
  };
  const plannedCheckpoints = imported.checkpoints.map(record => ({ runId: record.runId }));
  const journal = await persistInitialJournal(
    parsed,
    idMap,
    options.now ?? Date.now(),
    plannedRecords,
    plannedCheckpoints,
    plannedProviderIdsForImport(imported),
    previousPreferences,
  );
  const created: Partial<Record<WorkspaceArchiveCategory, number>> = {};
  const skippedCategories: WorkspaceArchiveCategory[] = [];
  try {
    const primary: WorkspaceDatabaseRecords = {
      assistants: tagWorkspaceArchiveRecords(imported.assistants, journal.importId),
      sessions: tagWorkspaceArchiveRecords(imported.sessions, journal.importId),
      bundles: tagWorkspaceArchiveRecords(imported.bundles, journal.importId),
    };
    const stagedCheckpoints = tagWorkspaceArchiveRecords(imported.checkpoints, journal.importId);
    journal.createdRecords = primary;
    journal.createdCheckpoints = stagedCheckpoints.map(record => ({
      runId: record.runId,
      [WORKSPACE_ARCHIVE_IMPORT_ID_FIELD]: journal.importId,
    }));
    await updateJournal(journal, {
      createdRecords: primary,
      createdCheckpoints: [...journal.createdCheckpoints],
    });
    await putWorkspaceDatabaseRecords(primary, operationOptions);
    journal.completedCategories.push('assistants', 'sessions', 'bundles');
    created.assistants = imported.assistants.length;
    created.sessions = imported.sessions.length;
    created.bundles = imported.bundles.length;
    await updateJournal(journal, { completedCategories: [...journal.completedCategories] });

    if (stagedCheckpoints.length > 0) {
      await putCheckpointArchiveRecords(stagedCheckpoints, operationOptions);
      journal.completedCategories.push('checkpoints');
      created.checkpoints = stagedCheckpoints.length;
      await updateJournal(journal, { completedCategories: [...journal.completedCategories] });
    }

    for (const category of WORKSPACE_ARCHIVE_CATEGORIES) {
      if (
        category === 'assistants' ||
        category === 'sessions' ||
        category === 'bundles' ||
        category === 'checkpoints'
      ) {
        continue;
      }
      const raw = imported.providers[category];
      const included = parsed.manifest.includedCategories.includes(category);
      if (!included) {
        skippedCategories.push(category);
        continue;
      }
      if (category === 'preferences') {
        if (!canApplyPreferences) {
          skippedCategories.push(category);
        }
        continue;
      }
      const provider = providerRegistry.get(category);
      if (!provider) {
        const hasRecords = asArray(raw).length > 0;
        if (!hasRecords) {
          skippedCategories.push(category);
          continue;
        }
        throw new Error(
          `Workspace archive category ${category} requires its storage provider before import.`,
        );
      }
      const registeredIds: string[] = [];
      let result: WorkspaceArchiveProviderImportResult | void;
      try {
        result = await provider.importRecords(raw as unknown[], {
          archiveId: parsed.manifest.archiveId,
          importId: journal.importId,
          category,
          idMap,
          operationToken,
          visibility: 'hidden',
          registerCreatedIds: ids => registeredIds.push(...ids),
        });
      } catch (error) {
        journal.providerCreatedIds[category] = [
          ...new Set([...(journal.providerCreatedIds[category] ?? []), ...registeredIds]),
        ];
        await updateJournal(journal, {
          providerCreatedIds: { ...journal.providerCreatedIds },
        });
        throw error;
      }
      const createdIds = [
        ...new Set([
          ...(journal.providerCreatedIds[category] ?? []),
          ...registeredIds,
          ...(result?.createdIds ?? []),
        ]),
      ];
      if (asArray(raw).length > 0 && createdIds.length === 0) {
        // Preserve an explicit empty marker so rollback reports FAILED rather
        // than claiming success when ownership cannot be proven.
        journal.providerCreatedIds[category] = [];
        await updateJournal(journal, {
          providerCreatedIds: { ...journal.providerCreatedIds },
        });
        throw new Error(`Provider ${category} did not report created IDs.`);
      }
      if (createdIds.length > 0) {
        journal.providerCreatedIds[category] = createdIds;
      } else {
        delete journal.providerCreatedIds[category];
      }
      journal.completedCategories.push(category);
      created[category] = Array.isArray(raw) ? raw.length : 0;
      await updateJournal(journal, {
        providerCreatedIds: { ...journal.providerCreatedIds },
        completedCategories: [...journal.completedCategories],
      });
    }

    for (const [category, ids] of Object.entries(journal.providerCreatedIds)) {
      const provider = providerRegistry.get(category as WorkspaceArchiveCategory);
      if (!provider?.publishImportedRecords || !ids || ids.length === 0) {
        continue;
      }
      await provider.publishImportedRecords(ids, {
        archiveId: parsed.manifest.archiveId,
        importId: journal.importId,
        category: category as WorkspaceArchiveCategory,
        idMap,
        operationToken,
        visibility: 'hidden',
        registerCreatedIds: () => undefined,
      });
    }

    if (canApplyPreferences && isRecord(preferences)) {
      await options.applyPreferences?.(preferences);
      journal.completedCategories.push('preferences');
      created.preferences = Object.keys(preferences).length;
      await updateJournal(journal, { completedCategories: [...journal.completedCategories] });
    }

    // Keep all tagged records hidden while the journal receipt is committed.
    await updateJournal(journal, { state: 'published', hidden: false });
    markWorkspaceArchiveImportPublished(journal.importId);
    // The sanitized canonical payload is only needed while a staged import can
    // still be resumed. Published imports retain ownership/status but release
    // potentially large recovery bytes.
    try {
      await updateJournal(journal, { archiveBytes: new Uint8Array() });
    } catch (error) {
      // Publication is already durable and visible. A journal-byte cleanup
      // failure must not roll back the successfully published records.
      console.warn(
        '[workspaceArchiveService] Published import recovery bytes could not be cleared:',
        error,
      );
    }
    return {
      importId: journal.importId,
      archiveId: journal.archiveId,
      state: journal.state,
      idMap,
      created,
      conflicts,
      skippedCategories,
      recoveryStatus: toRecoveryStatus(journal),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await updateJournal(journal, { state: 'rollback_pending', hidden: true, error: message });
    } catch (intentError) {
      console.warn(
        '[workspaceArchiveService] Rollback intent could not be persisted:',
        intentError,
      );
      throw new WorkspaceArchiveImportError(
        journal.importId,
        journal.state,
        `${message}; rollback intent persistence failed: ${
          intentError instanceof Error ? intentError.message : String(intentError)
        }`,
        toRecoveryStatus(journal),
      );
    }
    const rollback = await rollbackJournal(journal, options, operationToken);
    const finalError = rollback.complete
      ? message
      : `${message}; rollback incomplete: ${rollback.error}`;
    try {
      await updateJournal(journal, {
        state: rollback.complete ? 'rolled_back' : 'failed',
        hidden: true,
        archiveBytes: rollback.complete ? new Uint8Array() : journal.archiveBytes,
        error: finalError,
      });
    } catch (journalError) {
      throw new WorkspaceArchiveImportError(
        journal.importId,
        journal.state,
        `${finalError}; journal update failed: ${
          journalError instanceof Error ? journalError.message : String(journalError)
        }`,
        toRecoveryStatus(journal),
      );
    }
    throw new WorkspaceArchiveImportError(
      journal.importId,
      journal.state,
      journal.error ?? finalError,
      toRecoveryStatus(journal),
    );
  }
};

export class WorkspaceArchiveImportError extends Error {
  readonly importId: string;

  readonly state: WorkspaceArchiveJournalState;

  readonly recoveryStatus: WorkspaceArchiveRecoveryStatus;

  constructor(
    importId: string,
    state: WorkspaceArchiveJournalState,
    message: string,
    recoveryStatus: WorkspaceArchiveRecoveryStatus,
  ) {
    super(message);
    this.name = 'WorkspaceArchiveImportError';
    this.importId = importId;
    this.state = state;
    this.recoveryStatus = recoveryStatus;
  }
}

export const importWorkspaceArchive = async (
  archiveBytes: Uint8Array,
  options: WorkspaceArchiveImportOptions = {},
): Promise<WorkspaceArchiveImportResult> => {
  const parsed = await parseWorkspaceArchive(archiveBytes);
  return withWorkspaceOperation('import', operationToken =>
    importWithinOperation(parsed, options, operationToken),
  );
};

export const restoreWorkspaceArchive = importWorkspaceArchive;

export const getWorkspaceImportRecoveryStatus = async (
  importId: string,
): Promise<WorkspaceArchiveRecoveryStatus | null> => {
  const journal = await readJournal(importId);
  if (journal?.state === 'published' && !isWorkspaceArchiveImportPublished(importId)) {
    markWorkspaceArchiveImportPublished(importId);
  }
  return journal ? toRecoveryStatus(journal) : null;
};

export const listWorkspaceImportRecovery = async (): Promise<WorkspaceArchiveRecoveryStatus[]> => {
  const db = await getJournalDb();
  const journals = await db.getAll(JOURNAL_STORE);
  for (const journal of journals) {
    if (journal.state === 'published' && !isWorkspaceArchiveImportPublished(journal.importId)) {
      markWorkspaceArchiveImportPublished(journal.importId);
    }
  }
  return journals
    .filter(
      journal =>
        journal.hidden &&
        (journal.state === 'staging' ||
          journal.state === 'failed' ||
          journal.state === 'rollback_pending'),
    )
    .map(toRecoveryStatus);
};

export const rollbackWorkspaceImport = async (
  importId: string,
  options: WorkspaceArchiveImportOptions = {},
): Promise<WorkspaceArchiveRecoveryStatus> =>
  withWorkspaceOperation('recovery', async operationToken => {
    const journal = await readJournal(importId);
    if (!journal) {
      throw new Error(`Workspace import ${importId} was not found.`);
    }
    if (!journal.hidden || !['staging', 'failed', 'rollback_pending'].includes(journal.state)) {
      throw new Error(`Workspace import ${importId} is not eligible for rollback.`);
    }
    if (journal.state !== 'rollback_pending') {
      await updateJournal(journal, { state: 'rollback_pending', hidden: true, error: undefined });
    }
    const result = await rollbackJournal(journal, options, operationToken);
    if (!result.complete) {
      await updateJournal(journal, { state: 'failed', hidden: true, error: result.error });
      throw new WorkspaceArchiveImportError(
        importId,
        journal.state,
        result.error ?? 'Workspace import rollback failed.',
        toRecoveryStatus(journal),
      );
    }
    await updateJournal(journal, {
      state: 'rolled_back',
      hidden: true,
      archiveBytes: new Uint8Array(),
      error: undefined,
    });
    return toRecoveryStatus(journal);
  });

export const resumeWorkspaceImport = async (
  importId: string,
  options: WorkspaceArchiveImportOptions = {},
): Promise<WorkspaceArchiveImportResult> => {
  const journal = await readJournal(importId);
  if (!journal) {
    throw new Error(`Workspace import ${importId} was not found.`);
  }
  if (
    !journal.hidden ||
    (journal.state !== 'staging' && journal.state !== 'failed') ||
    journal.archiveBytes.byteLength === 0
  ) {
    throw new Error(`Workspace import ${importId} is not resumable.`);
  }
  const archiveBytes = journal.archiveBytes;
  // Roll back staged records before replaying from the original archive.  This
  // keeps resume idempotent even when a provider failed after partial writes.
  await rollbackWorkspaceImport(importId, options);
  return importWorkspaceArchive(archiveBytes, options);
};

export const getWorkspaceRecoveryStatus = listWorkspaceImportRecovery;

export const getWorkspaceArchiveMetadata = async (): Promise<WorkspaceArchiveMetadata> => {
  let lastBackupAt: number | null = null;
  try {
    const raw = globalThis.localStorage?.getItem(WORKSPACE_ARCHIVE_LAST_BACKUP_KEY);
    const parsed = raw ? Number(raw) : NaN;
    if (Number.isFinite(parsed)) {
      lastBackupAt = parsed;
    }
  } catch {
    // Keep metadata available even when browser storage is unavailable.
  }
  return { lastBackupAt, recoveryStatus: await listWorkspaceImportRecovery() };
};

/** Backwards-compatible names for callers that call the file an archive/backup interchangeably. */
export const createWorkspaceArchive = buildWorkspaceArchive;
export const exportWorkspaceBackup = exportWorkspaceArchive;
export const parseWorkspaceBackup = parseWorkspaceArchive;
export const validateWorkspaceArchive = parseWorkspaceArchive;
export const previewWorkspaceBackup = previewWorkspaceArchive;
export const importWorkspaceBackup = importWorkspaceArchive;
export const restoreWorkspaceBackup = restoreWorkspaceArchive;
export const listIncompleteWorkspaceImports = listWorkspaceImportRecovery;
export const getWorkspaceBackupMetadata = getWorkspaceArchiveMetadata;

export const __resetWorkspaceArchiveForTesting = async (): Promise<void> => {
  providerRegistry.clear();
  resetWorkspacePreferenceWarnings();
  if (journalDbPromise) {
    const db = await journalDbPromise;
    await db.clear(JOURNAL_STORE);
    db.close();
  }
  journalDbPromise = null;
};

/** Re-exported for adapters that need to coordinate a long-running transfer. */
export type WorkspaceArchiveOperation = WorkspaceOperationHandle;
export { beginWorkspaceOperation };
