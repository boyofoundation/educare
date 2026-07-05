import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { AgentRunCheckpoint } from '../types';

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

const listSessionCheckpoints = async (sessionId: string): Promise<AgentRunCheckpoint[]> => {
  try {
    const db = await getDb();
    const checkpoints = await db.getAllFromIndex(STORE_NAME, SESSION_INDEX, sessionId);
    const invalid = checkpoints.filter(checkpoint => checkpoint.schemaVersion !== 1);

    if (invalid.length > 0) {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      await Promise.all(invalid.map(checkpoint => tx.store.delete(checkpoint.runId)));
      await tx.done;
    }

    return checkpoints.filter(isSchemaV1);
  } catch (error) {
    warn(`list checkpoints for session ${sessionId}`, error);
    return [];
  }
};

export const saveCheckpoint = async (checkpoint: AgentRunCheckpoint): Promise<void> => {
  try {
    const db = await getDb();
    await db.put(STORE_NAME, checkpoint);
  } catch (error) {
    warn(`save checkpoint ${checkpoint.runId}`, error);
  }
};

export const updateCheckpoint = async (
  runId: string,
  patch: Partial<AgentRunCheckpoint>,
): Promise<AgentRunCheckpoint | null> => {
  try {
    const db = await getDb();
    const existing = await db.get(STORE_NAME, runId);
    if (!isSchemaV1(existing)) {
      if (existing) {
        await db.delete(STORE_NAME, runId);
      }
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
    return null;
  }
};

export const getCheckpoint = async (runId: string): Promise<AgentRunCheckpoint | null> => {
  try {
    const db = await getDb();
    const checkpoint = await db.get(STORE_NAME, runId);

    if (!isSchemaV1(checkpoint)) {
      if (checkpoint) {
        await db.delete(STORE_NAME, runId);
      }
      return null;
    }

    return checkpoint;
  } catch (error) {
    warn(`read checkpoint ${runId}`, error);
    return null;
  }
};

export const getInterruptedForSession = async (
  sessionId: string,
  stalenessMs = DEFAULT_STALENESS_MS,
): Promise<AgentRunCheckpoint | null> => {
  const checkpoints = sortNewestFirst(await listSessionCheckpoints(sessionId));
  const now = Date.now();

  return (
    checkpoints.find(
      checkpoint => checkpoint.status === 'running' && now - checkpoint.heartbeatAt > stalenessMs,
    ) ?? null
  );
};

export const claimCheckpoint = async (
  runId: string,
  stalenessMs = DEFAULT_STALENESS_MS,
): Promise<AgentRunCheckpoint | null> => {
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

    if (existing.status !== 'running' || Date.now() - existing.heartbeatAt <= stalenessMs) {
      await tx.done;
      return null;
    }

    const claimed: AgentRunCheckpoint = {
      ...existing,
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
};

export const deleteCheckpoint = async (runId: string): Promise<void> => {
  try {
    const db = await getDb();
    await db.delete(STORE_NAME, runId);
  } catch (error) {
    warn(`delete checkpoint ${runId}`, error);
  }
};

export const deleteForSession = async (sessionId: string): Promise<void> => {
  try {
    const db = await getDb();
    const checkpoints = await db.getAllFromIndex(STORE_NAME, SESSION_INDEX, sessionId);

    if (checkpoints.length === 0) {
      return;
    }

    const tx = db.transaction(STORE_NAME, 'readwrite');
    await Promise.all(checkpoints.map(checkpoint => tx.store.delete(checkpoint.runId)));
    await tx.done;
  } catch (error) {
    warn(`delete checkpoints for session ${sessionId}`, error);
  }
};

export const sweepStale = async (maxAgeMs = DEFAULT_MAX_AGE_MS): Promise<number> => {
  try {
    const db = await getDb();
    const checkpoints = await db.getAll(STORE_NAME);
    const now = Date.now();
    const staleRunIds = checkpoints
      .filter(checkpoint => checkpoint.schemaVersion !== 1 || now - checkpoint.updatedAt > maxAgeMs)
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
};
