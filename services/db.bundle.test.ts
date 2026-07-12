import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { openDB } from 'idb';
import type { Assistant, BundleRecord, ChatSession } from '../types';

const DB_NAME = 'professional-assistant-db';
const DB_VERSION = 2;
const ASSISTANTS_STORE = 'assistants';
const SESSIONS_STORE = 'sessions';

const createAssistant = (id: string): Assistant => ({
  id,
  name: `Assistant ${id}`,
  description: 'Test assistant',
  systemPrompt: 'Be helpful.',
  ragChunks: [],
  createdAt: 1,
});

const createSession = (id: string, assistantId: string): ChatSession => ({
  id,
  assistantId,
  title: `Session ${id}`,
  messages: [],
  createdAt: 1,
  tokenCount: 0,
});

const createBundle = (id: string): BundleRecord => ({
  id,
  importedAt: 1,
  sizeBytes: 100,
  bundle: {
    manifest: {
      format: 'educare-agent-bundle',
      schemaVersion: 1,
      name: 'Test bundle',
      description: 'Bundle for database tests',
      version: '1.0.0',
      exportedAt: 1,
      entryAgentId: 'agent-1',
    },
    agents: [
      {
        id: 'agent-1',
        name: 'Agent one',
        description: 'Test agent',
        systemPrompt: 'Be helpful.',
        starterPrompts: [],
        ragChunks: [],
      },
    ],
    routes: [],
  },
});

const deleteDatabase = () =>
  new Promise<void>((resolve, reject) => {
    const request = globalThis.indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Database deletion was blocked.'));
  });

const createVersionOneDatabase = async (assistant: Assistant, session: ChatSession) => {
  const db = await openDB(DB_NAME, 1, {
    upgrade(database) {
      database.createObjectStore(ASSISTANTS_STORE, { keyPath: 'id' });
      const sessionStore = database.createObjectStore(SESSIONS_STORE, { keyPath: 'id' });
      sessionStore.createIndex('by-assistant', 'assistantId');
    },
  });

  await db.put(ASSISTANTS_STORE, assistant);
  await db.put(SESSIONS_STORE, session);
  db.close();
};

const clearDatabase = async () => {
  const db = await openDB(DB_NAME, DB_VERSION);
  const tx = db.transaction([ASSISTANTS_STORE, SESSIONS_STORE, 'bundles'], 'readwrite');
  await Promise.all([
    tx.objectStore(ASSISTANTS_STORE).clear(),
    tx.objectStore(SESSIONS_STORE).clear(),
    tx.objectStore('bundles').clear(),
  ]);
  await tx.done;
  db.close();
};

describe('Database Service bundle persistence', () => {
  beforeAll(deleteDatabase);

  afterEach(async () => {
    vi.restoreAllMocks();
    await clearDatabase();
  });

  it('migrates v1 data to v2 without losing assistants or sessions', async () => {
    // Arrange
    const assistant = createAssistant('legacy-assistant');
    const session = createSession('legacy-session', assistant.id);
    await createVersionOneDatabase(assistant, session);
    const db = await import('./db');

    // Act
    const [assistants, sessions] = await Promise.all([
      db.getAllAssistants(),
      db.getSessionsForAssistant(assistant.id),
    ]);

    // Assert
    expect(assistants).toEqual([assistant]);
    expect(sessions).toEqual([session]);

    const rawDb = await openDB(DB_NAME, DB_VERSION);
    expect(rawDb.objectStoreNames.contains('bundles')).toBe(true);
    rawDb.close();
  });

  it('persists, lists, reads, and deletes bundles', async () => {
    // Arrange
    const bundle = createBundle('bundle-1');
    const db = await import('./db');

    // Act
    await db.saveBundle(bundle);

    // Assert
    await expect(db.getBundle(bundle.id)).resolves.toEqual(bundle);
    await expect(db.listBundles()).resolves.toEqual([bundle]);

    // Act
    await db.deleteBundle(bundle.id);

    // Assert
    await expect(db.getBundle(bundle.id)).resolves.toBeUndefined();
    await expect(db.listBundles()).resolves.toEqual([]);
  });

  it('deletes only sessions whose assistant ids use the exact bundle prefix', async () => {
    // Arrange
    const bundle = createBundle('bundle-1');
    const db = await import('./db');
    await db.saveBundle(bundle);

    const bundledSessions = [
      createSession('session-bundled-1', 'bundle-1:agent-1'),
      createSession('session-bundled-2', 'bundle-1:agent-2'),
    ];
    const unrelatedSimilarPrefixSession = createSession(
      'session-unrelated-similar-prefix',
      'bundle-10:agent-1',
    );
    const unrelatedUnqualifiedSession = createSession('session-unrelated-unqualified', 'bundle-1');

    await Promise.all([
      ...bundledSessions.map(session => db.saveSession(session)),
      db.saveSession(unrelatedSimilarPrefixSession),
      db.saveSession(unrelatedUnqualifiedSession),
    ]);

    // Act
    await db.deleteBundle(bundle.id);

    // Assert
    await Promise.all(
      bundledSessions.map(session =>
        expect(db.getSessionsForAssistant(session.assistantId)).resolves.toEqual([]),
      ),
    );
    await expect(
      db.getSessionsForAssistant(unrelatedSimilarPrefixSession.assistantId),
    ).resolves.toEqual([unrelatedSimilarPrefixSession]);
    await expect(
      db.getSessionsForAssistant(unrelatedUnqualifiedSession.assistantId),
    ).resolves.toEqual([unrelatedUnqualifiedSession]);
  });
});
