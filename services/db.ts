import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { Assistant, BundleRecord, ChatSession } from '../types';
import {
  isWorkspaceOperationTokenActive,
  withWorkspaceWrite,
  type WorkspaceOperationToken,
} from './workspaceOperationService';

const DB_NAME = 'professional-assistant-db';
const DB_VERSION = 2;
const ASSISTANTS_STORE = 'assistants';
export const SESSIONS_STORE = 'sessions';
const BUNDLES_STORE = 'bundles';

/** Shared visibility marker for staged workspace-archive records. */
export const WORKSPACE_ARCHIVE_IMPORT_ID_FIELD = '__educareWorkspaceArchiveImportId';
const WORKSPACE_ARCHIVE_PUBLICATION_RECEIPTS_KEY = 'educare.workspace.archive-publications.v1';

interface WorkspaceArchivePublicationStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const getPublicationStorage = (): WorkspaceArchivePublicationStorage => {
  try {
    const storage = globalThis.localStorage;
    if (
      !storage ||
      typeof storage.getItem !== 'function' ||
      typeof storage.setItem !== 'function'
    ) {
      throw new Error('browser storage is unavailable');
    }
    return storage;
  } catch (error) {
    throw new Error(
      `Workspace archive publication storage is unavailable: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
};

const parsePublicationReceipts = (raw: string | null): Record<string, number> => {
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => typeof value === 'number'),
    ) as Record<string, number>;
  } catch {
    return {};
  }
};

const readPublicationReceipts = (): Record<string, number> => {
  const storage = getPublicationStorage();
  return parsePublicationReceipts(storage.getItem(WORKSPACE_ARCHIVE_PUBLICATION_RECEIPTS_KEY));
};

const writePublicationReceipts = (
  storage: WorkspaceArchivePublicationStorage,
  receipts: Record<string, number>,
): void => {
  storage.setItem(WORKSPACE_ARCHIVE_PUBLICATION_RECEIPTS_KEY, JSON.stringify(receipts));
  const verified = parsePublicationReceipts(
    storage.getItem(WORKSPACE_ARCHIVE_PUBLICATION_RECEIPTS_KEY),
  );
  if (JSON.stringify(verified) !== JSON.stringify(receipts)) {
    throw new Error('Workspace archive publication receipt write could not be verified.');
  }
};

export const isWorkspaceArchiveImportPublished = (importId: string): boolean =>
  typeof readPublicationReceipts()[importId] === 'number';

/** Mark a staged import visible to all cooperating readers after final commit. */
export const markWorkspaceArchiveImportPublished = (importId: string): void => {
  const storage = getPublicationStorage();
  const receipts = parsePublicationReceipts(
    storage.getItem(WORKSPACE_ARCHIVE_PUBLICATION_RECEIPTS_KEY),
  );
  receipts[importId] = Date.now();
  writePublicationReceipts(storage, receipts);
};

export const clearWorkspaceArchivePublication = (importId: string): void => {
  const storage = getPublicationStorage();
  const receipts = parsePublicationReceipts(
    storage.getItem(WORKSPACE_ARCHIVE_PUBLICATION_RECEIPTS_KEY),
  );
  if (!(importId in receipts)) {
    return;
  }
  delete receipts[importId];
  writePublicationReceipts(storage, receipts);
};

export const tagWorkspaceArchiveRecord = <T extends object>(record: T, importId: string): T =>
  ({ ...record, [WORKSPACE_ARCHIVE_IMPORT_ID_FIELD]: importId }) as T;

export const tagWorkspaceArchiveRecords = <T extends object>(records: T[], importId: string): T[] =>
  records.map(record => tagWorkspaceArchiveRecord(record, importId));

export const isWorkspaceArchiveRecordVisible = (record: unknown): boolean => {
  if (!isRecord(record)) {
    return false;
  }
  const importId = record[WORKSPACE_ARCHIVE_IMPORT_ID_FIELD];
  return typeof importId !== 'string' || isWorkspaceArchiveImportPublished(importId);
};

export const stripWorkspaceArchiveVisibility = <T>(record: T): T => {
  if (!isRecord(record) || !(WORKSPACE_ARCHIVE_IMPORT_ID_FIELD in record)) {
    return record;
  }
  const visible = { ...record } as Record<string, unknown>;
  delete visible[WORKSPACE_ARCHIVE_IMPORT_ID_FIELD];
  return visible as T;
};

export interface WorkspaceDatabaseSnapshot {
  assistants: Assistant[];
  sessions: ChatSession[];
  bundles: BundleRecord[];
}

export interface WorkspaceDatabaseRecords {
  assistants?: Assistant[];
  sessions?: ChatSession[];
  bundles?: BundleRecord[];
}

export interface WorkspaceDatabaseOperationOptions {
  /** Opaque capability issued by withWorkspaceOperation for raw in-operation access. */
  operationToken?: WorkspaceOperationToken;
  /** Archive rollback may delete only rows carrying this import marker. */
  ownershipImportId?: string;
}

export interface WorkspaceDatabaseSnapshotOptions extends WorkspaceDatabaseOperationOptions {
  includeHidden?: boolean;
}

/** Run a raw store operation under the workspace barrier unless its active token is supplied. */
export const withWorkspaceDatabaseOperation = async <T>(
  options: WorkspaceDatabaseOperationOptions,
  operation: () => Promise<T>,
): Promise<T> => {
  if (options.operationToken !== undefined) {
    if (!isWorkspaceOperationTokenActive(options.operationToken)) {
      throw new Error('Workspace operation token is no longer active.');
    }
    return operation();
  }
  return withWorkspaceWrite(operation);
};

interface ProfessionalAssistantDB extends DBSchema {
  [ASSISTANTS_STORE]: {
    key: string;
    value: Assistant;
  };
  [SESSIONS_STORE]: {
    key: string;
    value: ChatSession;
    indexes: { 'by-assistant': string };
  };
  [BUNDLES_STORE]: {
    key: string;
    value: BundleRecord;
  };
}

export class BundleQuotaExceededError extends Error {
  constructor() {
    super('Storage quota exceeded while saving the agent bundle.');
    this.name = 'QuotaExceededError';
  }
}

let dbPromise: Promise<IDBPDatabase<ProfessionalAssistantDB>> | null = null;

const getDb = () => {
  if (!dbPromise) {
    dbPromise = openDB<ProfessionalAssistantDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(ASSISTANTS_STORE)) {
          db.createObjectStore(ASSISTANTS_STORE, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
          const sessionStore = db.createObjectStore(SESSIONS_STORE, { keyPath: 'id' });
          sessionStore.createIndex('by-assistant', 'assistantId');
        }
        if (!db.objectStoreNames.contains(BUNDLES_STORE)) {
          db.createObjectStore(BUNDLES_STORE, { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
};

// Assistant operations
export const getAllAssistants = async (): Promise<Assistant[]> => {
  const db = await getDb();
  const records = await db.getAll(ASSISTANTS_STORE);
  return records.filter(isWorkspaceArchiveRecordVisible).map(stripWorkspaceArchiveVisibility);
};

export const getAssistant = async (id: string): Promise<Assistant | undefined> => {
  const db = await getDb();
  const record = await db.get(ASSISTANTS_STORE, id);
  return record && isWorkspaceArchiveRecordVisible(record)
    ? stripWorkspaceArchiveVisibility(record)
    : undefined;
};

export const saveAssistant = async (assistant: Assistant): Promise<void> => {
  await withWorkspaceWrite(async () => {
    const db = await getDb();
    await db.put(ASSISTANTS_STORE, assistant);
  });
};

export const deleteAssistant = async (id: string): Promise<void> => {
  await withWorkspaceWrite(async () => {
    const db = await getDb();
    await db.delete(ASSISTANTS_STORE, id);
    // Also delete associated sessions
    const sessions = await getSessionsForAssistant(id);
    const tx = db.transaction(SESSIONS_STORE, 'readwrite');
    await Promise.all(sessions.map(session => tx.store.delete(session.id)));
    await tx.done;
  });
};

// Bundle operations
export const listBundles = async (): Promise<BundleRecord[]> => {
  const db = await getDb();
  const records = await db.getAll(BUNDLES_STORE);
  return records.filter(isWorkspaceArchiveRecordVisible).map(stripWorkspaceArchiveVisibility);
};

export const getBundle = async (id: string): Promise<BundleRecord | undefined> => {
  const db = await getDb();
  const record = await db.get(BUNDLES_STORE, id);
  return record && isWorkspaceArchiveRecordVisible(record)
    ? stripWorkspaceArchiveVisibility(record)
    : undefined;
};

export const saveBundle = async (bundle: BundleRecord): Promise<void> => {
  await withWorkspaceWrite(async () => {
    const db = await getDb();
    try {
      await db.put(BUNDLES_STORE, bundle);
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'name' in error &&
        error.name === 'QuotaExceededError'
      ) {
        throw new BundleQuotaExceededError();
      }
      throw error;
    }
  });
};

export const deleteBundle = async (id: string): Promise<void> => {
  await withWorkspaceWrite(async () => {
    const db = await getDb();
    await db.delete(BUNDLES_STORE, id);

    const sessions = await db.getAll(SESSIONS_STORE);
    const tx = db.transaction(SESSIONS_STORE, 'readwrite');
    await Promise.all(
      sessions
        .filter(session => session.assistantId.startsWith(`${id}:`))
        .map(session => tx.store.delete(session.id)),
    );
    await tx.done;
  });
};

// Session operations
export const getSessionsForAssistant = async (assistantId: string): Promise<ChatSession[]> => {
  const db = await getDb();
  const records = await db.getAllFromIndex(SESSIONS_STORE, 'by-assistant', assistantId);
  return records.filter(isWorkspaceArchiveRecordVisible).map(stripWorkspaceArchiveVisibility);
};

export const saveSession = async (session: ChatSession): Promise<void> => {
  await withWorkspaceWrite(async () => {
    const db = await getDb();
    await db.put(SESSIONS_STORE, session);
  });
};

export const deleteSession = async (id: string): Promise<void> => {
  await withWorkspaceWrite(async () => {
    const db = await getDb();
    await db.delete(SESSIONS_STORE, id);
  });
};

/**
 * Read all records from the primary workspace database in one readonly
 * transaction.  The archive service uses this raw API instead of composing
 * per-store reads, which keeps the IndexedDB portion of a snapshot coherent.
 */
const getWorkspaceDatabaseSnapshotUnsafe = async (
  options: WorkspaceDatabaseSnapshotOptions = {},
): Promise<WorkspaceDatabaseSnapshot> => {
  const db = await getDb();
  const tx = db.transaction([ASSISTANTS_STORE, SESSIONS_STORE, BUNDLES_STORE], 'readonly');
  const assistants = await tx.objectStore(ASSISTANTS_STORE).getAll();
  const sessions = await tx.objectStore(SESSIONS_STORE).getAll();
  const bundles = await tx.objectStore(BUNDLES_STORE).getAll();
  await tx.done;
  if (options.includeHidden) {
    return { assistants, sessions, bundles };
  }
  return {
    assistants: assistants
      .filter(isWorkspaceArchiveRecordVisible)
      .map(stripWorkspaceArchiveVisibility),
    sessions: sessions.filter(isWorkspaceArchiveRecordVisible).map(stripWorkspaceArchiveVisibility),
    bundles: bundles.filter(isWorkspaceArchiveRecordVisible).map(stripWorkspaceArchiveVisibility),
  };
};

export const getWorkspaceDatabaseSnapshot = async (
  options: WorkspaceDatabaseSnapshotOptions = {},
): Promise<WorkspaceDatabaseSnapshot> =>
  withWorkspaceDatabaseOperation(options, () => getWorkspaceDatabaseSnapshotUnsafe(options));

/** Alias for archive adapters that use a records-oriented name. */
export const getWorkspaceRecords = getWorkspaceDatabaseSnapshot;

/**
 * Publish imported primary records in one read/write transaction.  Existing
 * records are intentionally not cleared or overwritten; callers must remap
 * IDs before passing records here and use `deleteWorkspaceDatabaseRecords` for
 * rollback of only the IDs they created.
 */
const putWorkspaceDatabaseRecordsUnsafe = async (
  records: WorkspaceDatabaseRecords,
): Promise<void> => {
  const db = await getDb();
  const tx = db.transaction([ASSISTANTS_STORE, SESSIONS_STORE, BUNDLES_STORE], 'readwrite');
  for (const assistant of records.assistants ?? []) {
    await tx.objectStore(ASSISTANTS_STORE).add(assistant);
  }
  for (const session of records.sessions ?? []) {
    await tx.objectStore(SESSIONS_STORE).add(session);
  }
  for (const bundle of records.bundles ?? []) {
    await tx.objectStore(BUNDLES_STORE).add(bundle);
  }
  await tx.done;
};

export const putWorkspaceDatabaseRecords = async (
  records: WorkspaceDatabaseRecords,
  options: WorkspaceDatabaseOperationOptions = {},
): Promise<void> =>
  withWorkspaceDatabaseOperation(options, () => putWorkspaceDatabaseRecordsUnsafe(records));

/** Alias for archive adapters that use a records-oriented name. */
export const putWorkspaceRecords = putWorkspaceDatabaseRecords;

/** Delete only records created by an archive import, in one transaction. */
const deleteWorkspaceDatabaseRecordsUnsafe = async (
  records: WorkspaceDatabaseRecords,
  ownershipImportId?: string,
): Promise<void> => {
  const db = await getDb();
  const tx = db.transaction([ASSISTANTS_STORE, SESSIONS_STORE, BUNDLES_STORE], 'readwrite');
  for (const assistant of records.assistants ?? []) {
    const existing = await tx.objectStore(ASSISTANTS_STORE).get(assistant.id);
    // Rollback is intentionally idempotent: a prior attempt may have removed
    // this row before a later store failed.  Only a present row can violate
    // ownership and must fail closed below.
    if (existing && ownershipImportId !== undefined) {
      const existingImportId = (existing as unknown as Record<string, unknown>)[
        WORKSPACE_ARCHIVE_IMPORT_ID_FIELD
      ];
      if (existingImportId !== ownershipImportId) {
        throw new Error(`Cannot roll back assistant ${assistant.id}: import ownership mismatch.`);
      }
    }
    if (existing) {
      await tx.objectStore(ASSISTANTS_STORE).delete(assistant.id);
    }
  }
  for (const session of records.sessions ?? []) {
    const existing = await tx.objectStore(SESSIONS_STORE).get(session.id);
    if (existing && ownershipImportId !== undefined) {
      const existingImportId = (existing as unknown as Record<string, unknown>)[
        WORKSPACE_ARCHIVE_IMPORT_ID_FIELD
      ];
      if (existingImportId !== ownershipImportId) {
        throw new Error(`Cannot roll back session ${session.id}: import ownership mismatch.`);
      }
    }
    if (existing) {
      await tx.objectStore(SESSIONS_STORE).delete(session.id);
    }
  }
  for (const bundle of records.bundles ?? []) {
    const existing = await tx.objectStore(BUNDLES_STORE).get(bundle.id);
    if (existing && ownershipImportId !== undefined) {
      const existingImportId = (existing as unknown as Record<string, unknown>)[
        WORKSPACE_ARCHIVE_IMPORT_ID_FIELD
      ];
      if (existingImportId !== ownershipImportId) {
        throw new Error(`Cannot roll back bundle ${bundle.id}: import ownership mismatch.`);
      }
    }
    if (existing) {
      await tx.objectStore(BUNDLES_STORE).delete(bundle.id);
    }
  }
  await tx.done;
};

export const deleteWorkspaceDatabaseRecords = async (
  records: WorkspaceDatabaseRecords,
  options: WorkspaceDatabaseOperationOptions = {},
): Promise<void> =>
  withWorkspaceDatabaseOperation(options, () =>
    deleteWorkspaceDatabaseRecordsUnsafe(records, options.ownershipImportId),
  );

/** Alias for archive adapters that use a records-oriented name. */
export const deleteWorkspaceRecords = deleteWorkspaceDatabaseRecords;
