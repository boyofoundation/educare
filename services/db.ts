import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { Assistant, BundleRecord, ChatSession } from '../types';

const DB_NAME = 'professional-assistant-db';
const DB_VERSION = 2;
const ASSISTANTS_STORE = 'assistants';
export const SESSIONS_STORE = 'sessions';
const BUNDLES_STORE = 'bundles';

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
  return db.getAll(ASSISTANTS_STORE);
};

export const getAssistant = async (id: string): Promise<Assistant | undefined> => {
  const db = await getDb();
  return db.get(ASSISTANTS_STORE, id);
};

export const saveAssistant = async (assistant: Assistant): Promise<void> => {
  const db = await getDb();
  await db.put(ASSISTANTS_STORE, assistant);
};

export const deleteAssistant = async (id: string): Promise<void> => {
  const db = await getDb();
  await db.delete(ASSISTANTS_STORE, id);
  // Also delete associated sessions
  const sessions = await getSessionsForAssistant(id);
  const tx = db.transaction(SESSIONS_STORE, 'readwrite');
  await Promise.all(sessions.map(session => tx.store.delete(session.id)));
  await tx.done;
};

// Bundle operations
export const listBundles = async (): Promise<BundleRecord[]> => {
  const db = await getDb();
  return db.getAll(BUNDLES_STORE);
};

export const getBundle = async (id: string): Promise<BundleRecord | undefined> => {
  const db = await getDb();
  return db.get(BUNDLES_STORE, id);
};

export const saveBundle = async (bundle: BundleRecord): Promise<void> => {
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
};

export const deleteBundle = async (id: string): Promise<void> => {
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
};

// Session operations
export const getSessionsForAssistant = async (assistantId: string): Promise<ChatSession[]> => {
  const db = await getDb();
  return db.getAllFromIndex(SESSIONS_STORE, 'by-assistant', assistantId);
};

export const saveSession = async (session: ChatSession): Promise<void> => {
  const db = await getDb();
  await db.put(SESSIONS_STORE, session);
};

export const deleteSession = async (id: string): Promise<void> => {
  const db = await getDb();
  await db.delete(SESSIONS_STORE, id);
};
