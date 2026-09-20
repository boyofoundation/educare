import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { AgentRunCheckpoint } from '../types';
import {
  WORKSPACE_ARCHIVE_IMPORT_ID_FIELD,
  isWorkspaceArchiveRecordVisible,
  stripWorkspaceArchiveVisibility,
  withWorkspaceDatabaseOperation,
  type WorkspaceDatabaseOperationOptions,
} from './db';
import { withWorkspaceWrite } from './workspaceOperationService';

const DB_NAME = 'agent-run-checkpoints';
const DB_VERSION = 1;
const STORE_NAME = 'checkpoints';
const SESSION_INDEX = 'by-session';
const DEFAULT_STALENESS_MS = 15_000;
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface AgentRunCheckpointDB extends DBSchema {
  [STORE_NAME]: {
    key: string;
    value: AgentRunCheckpoint;
    indexes: {
      [SESSION_INDEX]: string;
    };
  };
}

let dbPromise: Promise<IDBPDatabase<AgentRunCheckpointDB>> | null = null;

const getDb = () => {
  if (!dbPromise) {
    dbPromise = openDB<AgentRunCheckpointDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (db.objectStoreNames.contains(STORE_NAME)) {
          return;
        }

        const store = db.createObjectStore(STORE_NAME, { keyPath: 'runId' });
        store.createIndex(SESSION_INDEX, 'sessionId');
      },
    });
  }

  return dbPromise;
};

const warn = (action: string, error: unknown) => {
  console.warn(`[agentRunCheckpointService] Failed to ${action}:`, error);
};

const isSchemaV1 = (checkpoint: AgentRunCheckpoint | undefined): checkpoint is AgentRunCheckpoint =>
  checkpoint?.schemaVersion === 1;

const sortNewestFirst = (checkpoints: AgentRunCheckpoint[]): AgentRunCheckpoint[] =>
  [...checkpoints].sort((left, right) => right.createdAt - left.createdAt);

const isRetryableTerminalCheckpoint = (checkpoint: AgentRunCheckpoint): boolean => {
  const raw = checkpoint as unknown as {
    retryable?: boolean;
    failure?: { retryable?: boolean };
    failureRetryable?: boolean;
  };
  const retryable =
    checkpoint.failure?.retryable ??
    checkpoint.failureRetryable ??
    raw.failure?.retryable ??
    raw.retryable;
  return (
    checkpoint.status === 'paused' ||
    (retryable === true && (checkpoint.status === 'failed' || checkpoint.status === 'stopped'))
  );
};

const listSessionCheckpoints = async (sessionId: string): Promise<AgentRunCheckpoint[]> => {
  return withWorkspaceWrite(async () => {
    try {
      const db = await getDb();
      const checkpoints = await db.getAllFromIndex(STORE_NAME, SESSION_INDEX, sessionId);
      const invalid = checkpoints.filter(
        checkpoint => isWorkspaceArchiveRecordVisible(checkpoint) && checkpoint.schemaVersion !== 1,
      );

      if (invalid.length > 0) {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        await Promise.all(invalid.map(checkpoint => tx.store.delete(checkpoint.runId)));
        await tx.done;
      }

      return checkpoints
        .filter(isWorkspaceArchiveRecordVisible)
        .filter(isSchemaV1)
        .map(stripWorkspaceArchiveVisibility);
    } catch (error) {
      warn(`list checkpoints for session ${sessionId}`, error);
      return [];
    }
  });
};

export const saveCheckpoint = async (checkpoint: AgentRunCheckpoint): Promise<void> => {
  await withWorkspaceWrite(async () => {
    const db = await getDb();
    try {
      await db.put(STORE_NAME, checkpoint);
    } catch (error) {
      warn(`save checkpoint ${checkpoint.runId}`, error);
      throw error;
    }
  });
};

export const updateCheckpoint = async (
  runId: string,
  patch: Partial<AgentRunCheckpoint>,
): Promise<AgentRunCheckpoint | null> => {
  return withWorkspaceWrite(async () => {
    try {
      const db = await getDb();
      const existing = await db.get(STORE_NAME, runId);
      if (!isSchemaV1(existing)) {
        if (existing) {
          await db.delete(STORE_NAME, runId);
        }
        return null;
      }
      if (!isWorkspaceArchiveRecordVisible(existing)) {
        return null;
      }

      const nextCheckpoint: AgentRunCheckpoint = {
        ...existing,
        ...patch,
        runId,
        updatedAt: patch.updatedAt ?? Date.now(),
      };
      await db.put(STORE_NAME, nextCheckpoint);
      return nextCheckpoint;
    } catch (error) {
      warn(`update checkpoint ${runId}`, error);
      throw error;
    }
  });
};

export const getCheckpoint = async (runId: string): Promise<AgentRunCheckpoint | null> => {
  return withWorkspaceWrite(async () => {
    try {
      const db = await getDb();
      const checkpoint = await db.get(STORE_NAME, runId);

      if (!isSchemaV1(checkpoint)) {
        if (checkpoint) {
          await db.delete(STORE_NAME, runId);
        }
        return null;
      }

      if (!isWorkspaceArchiveRecordVisible(checkpoint)) {
        return null;
      }
      return stripWorkspaceArchiveVisibility(checkpoint);
    } catch (error) {
      warn(`read checkpoint ${runId}`, error);
      return null;
    }
  });
};

export const getInterruptedForSession = async (
  sessionId: string,
  stalenessMs = DEFAULT_STALENESS_MS,
): Promise<AgentRunCheckpoint | null> => {
  const checkpoints = sortNewestFirst(await listSessionCheckpoints(sessionId));
  const now = Date.now();

  return (
    checkpoints.find(
      checkpoint =>
        (checkpoint.status === 'running' && now - checkpoint.heartbeatAt > stalenessMs) ||
        isRetryableTerminalCheckpoint(checkpoint),
    ) ?? null
  );
};

export const claimCheckpoint = async (
  runId: string,
  stalenessMs = DEFAULT_STALENESS_MS,
): Promise<AgentRunCheckpoint | null> => {
  return withWorkspaceWrite(async () => {
    try {
      const db = await getDb();
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const existing = await tx.store.get(runId);

      if (!isSchemaV1(existing)) {
        if (existing) {
          await tx.store.delete(runId);
        }
        await tx.done;
        return null;
      }
      if (!isWorkspaceArchiveRecordVisible(existing)) {
        await tx.done;
        return null;
      }

      const retryableTerminal = isRetryableTerminalCheckpoint(existing);
      const staleRunning =
        existing.status === 'running' && Date.now() - existing.heartbeatAt > stalenessMs;
      if (!staleRunning && !retryableTerminal) {
        await tx.done;
        return null;
      }

      const claimed: AgentRunCheckpoint = {
        ...existing,
        status: 'running',
        heartbeatAt: Date.now(),
        updatedAt: Date.now(),
      };

      await tx.store.put(claimed);
      await tx.done;
      return claimed;
    } catch (error) {
      warn(`claim checkpoint ${runId}`, error);
      return null;
    }
  });
};

export const deleteCheckpoint = async (runId: string): Promise<void> => {
  await withWorkspaceWrite(async () => {
    try {
      const db = await getDb();
      await db.delete(STORE_NAME, runId);
    } catch (error) {
      warn(`delete checkpoint ${runId}`, error);
    }
  });
};

export const deleteForSession = async (sessionId: string): Promise<void> => {
  await withWorkspaceWrite(async () => {
    try {
      const db = await getDb();
      const checkpoints = (await db.getAllFromIndex(STORE_NAME, SESSION_INDEX, sessionId)).filter(
        isWorkspaceArchiveRecordVisible,
      );

      if (checkpoints.length === 0) {
        return;
      }

      const tx = db.transaction(STORE_NAME, 'readwrite');
      await Promise.all(checkpoints.map(checkpoint => tx.store.delete(checkpoint.runId)));
      await tx.done;
    } catch (error) {
      warn(`delete checkpoints for session ${sessionId}`, error);
    }
  });
};

export const sweepStale = async (maxAgeMs = DEFAULT_MAX_AGE_MS): Promise<number> => {
  return withWorkspaceWrite(async () => {
    try {
      const db = await getDb();
      const checkpoints = (await db.getAll(STORE_NAME)).filter(isWorkspaceArchiveRecordVisible);
      const now = Date.now();
      const staleRunIds = checkpoints
        .filter(
          checkpoint => checkpoint.schemaVersion !== 1 || now - checkpoint.updatedAt > maxAgeMs,
        )
        .map(checkpoint => checkpoint.runId);

      if (staleRunIds.length === 0) {
        return 0;
      }

      const tx = db.transaction(STORE_NAME, 'readwrite');
      await Promise.all(staleRunIds.map(runId => tx.store.delete(runId)));
      await tx.done;
      return staleRunIds.length;
    } catch (error) {
      warn('sweep stale checkpoints', error);
      return 0;
    }
  });
};

/**
 * Raw checkpoint records for workspace archives.  Unlike the historical
 * best-effort checkpoint helpers above, these APIs deliberately propagate
 * IndexedDB failures so an archive can fail and roll back visibly instead of
 * silently omitting a recovery record.
 */
export interface CheckpointArchiveOperationOptions extends WorkspaceDatabaseOperationOptions {
  includeHidden?: boolean;
}

const getCheckpointArchiveRecordsUnsafe = async (
  options: CheckpointArchiveOperationOptions = {},
): Promise<AgentRunCheckpoint[]> => {
  const db = await getDb();
  const records = await db.getAll(STORE_NAME);
  const invalid = records.filter(record => !isSchemaV1(record));
  if (invalid.length > 0) {
    throw new Error(
      `Cannot archive ${invalid.length} checkpoint record(s) with an unknown schema.`,
    );
  }
  if (options.includeHidden) {
    return records;
  }
  return records.filter(isWorkspaceArchiveRecordVisible).map(stripWorkspaceArchiveVisibility);
};

export const getCheckpointArchiveRecords = async (
  options: CheckpointArchiveOperationOptions = {},
): Promise<AgentRunCheckpoint[]> =>
  withWorkspaceDatabaseOperation(options, () => getCheckpointArchiveRecordsUnsafe(options));

/** Alias used by workspace archive adapters. */
export const listCheckpointsForArchive = getCheckpointArchiveRecords;

const putCheckpointArchiveRecordsUnsafe = async (records: AgentRunCheckpoint[]): Promise<void> => {
  for (const record of records) {
    if (!isSchemaV1(record)) {
      const runId = (record as unknown as { runId?: string }).runId ?? 'unknown';
      throw new Error(`Cannot import checkpoint ${runId} with an unknown schema.`);
    }
  }
  const db = await getDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  for (const record of records) {
    await tx.store.add(record);
  }
  await tx.done;
};

export const putCheckpointArchiveRecords = async (
  records: AgentRunCheckpoint[],
  options: WorkspaceDatabaseOperationOptions = {},
): Promise<void> =>
  withWorkspaceDatabaseOperation(options, () => putCheckpointArchiveRecordsUnsafe(records));

/** Alias used by workspace archive adapters. */
export const importCheckpointArchiveRecords = putCheckpointArchiveRecords;

const deleteCheckpointArchiveRecordsUnsafe = async (
  records: Pick<AgentRunCheckpoint, 'runId'>[],
  ownershipImportId?: string,
): Promise<void> => {
  const db = await getDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  for (const record of records) {
    const existing = await tx.store.get(record.runId);
    // A retry after partial rollback may legitimately find this row absent.
    // Idempotency applies only to absence; a present row still must carry the
    // exact import marker before it can be deleted below.
    if (existing && ownershipImportId !== undefined) {
      const existingImportId = (existing as unknown as Record<string, unknown>)[
        WORKSPACE_ARCHIVE_IMPORT_ID_FIELD
      ];
      if (existingImportId !== ownershipImportId) {
        throw new Error(`Cannot roll back checkpoint ${record.runId}: import ownership mismatch.`);
      }
    }
    if (existing) {
      await tx.store.delete(record.runId);
    }
  }
  await tx.done;
};

export const deleteCheckpointArchiveRecords = async (
  records: Pick<AgentRunCheckpoint, 'runId'>[],
  options: WorkspaceDatabaseOperationOptions = {},
): Promise<void> =>
  withWorkspaceDatabaseOperation(options, () =>
    deleteCheckpointArchiveRecordsUnsafe(records, options.ownershipImportId),
  );

/** Alias used by workspace archive adapters. */
export const removeCheckpointArchiveRecords = deleteCheckpointArchiveRecords;
