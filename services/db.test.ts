import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IDBPTransaction } from 'idb';
import { SESSIONS_STORE } from './db';
import {
  getAllAssistants,
  getAssistant,
  saveAssistant,
  deleteAssistant,
  getSessionsForAssistant,
  saveSession,
  deleteSession,
  saveBundle,
  BundleQuotaExceededError,
} from './db';
import { Assistant, BundleRecord, ChatSession } from '../types';
import type { IDBPDatabase } from 'idb';

// Mock idb module
vi.mock('idb', async () => {
  const actual = await vi.importActual('idb');
  const mockDB = {
    getAll: vi.fn(),
    get: vi.fn(),
    getAllFromIndex: vi.fn(),
    add: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    transaction: vi.fn(),
    close: vi.fn(),
  };

  const mockTx = {
    store: {
      delete: vi.fn(),
    },
    done: Promise.resolve(),
  };

  // Ensure transaction() returns a mock transaction object
  mockDB.transaction.mockReturnValue(
    mockTx as unknown as IDBPTransaction<unknown, [typeof SESSIONS_STORE], 'readwrite'>,
  );

  return {
    ...actual,
    openDB: vi.fn().mockResolvedValue(mockDB),
  };
});

describe('Database Service', () => {
  const mockAssistant: Assistant = {
    id: 'test-id',
    name: 'Test Assistant',
    description: 'A test assistant',
    systemPrompt: 'You are a test assistant',
    ragChunks: [],
    createdAt: Date.now(),
  };

  const mockSession: ChatSession = {
    id: 'session-id',
    assistantId: 'test-id',
    title: 'Test Session',
    messages: [],
    createdAt: Date.now(),
    tokenCount: 0,
  };

  const mockTx = {
    store: {
      delete: vi.fn(),
    },
    done: Promise.resolve(),
  };

  const mockDB = {
    getAll: vi.fn(),
    get: vi.fn(),
    getAllFromIndex: vi.fn(),
    add: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    transaction: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const { openDB } = await import('idb');
    vi.mocked(openDB).mockResolvedValue(mockDB as unknown as IDBPDatabase<unknown>);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('getAllAssistants', () => {
    it('should return all assistants from database', async () => {
      const mockAssistants = [mockAssistant];
      mockDB.getAll.mockResolvedValue(mockAssistants);

      const result = await getAllAssistants();

      expect(mockDB.getAll).toHaveBeenCalledWith('assistants');
      expect(result).toEqual(mockAssistants);
    });

    it('should handle database errors', async () => {
      mockDB.getAll.mockRejectedValue(new Error('Database error'));

      await expect(getAllAssistants()).rejects.toThrow('Database error');
    });
  });

  describe('getAssistant', () => {
    it('should return specific assistant by id', async () => {
      mockDB.get.mockResolvedValue(mockAssistant);

      const result = await getAssistant('test-id');

      expect(mockDB.get).toHaveBeenCalledWith('assistants', 'test-id');
      expect(result).toEqual(mockAssistant);
    });

    it('should return undefined for non-existent assistant', async () => {
      mockDB.get.mockResolvedValue(undefined);

      const result = await getAssistant('non-existent');

      expect(result).toBeUndefined();
    });
  });

  describe('saveAssistant', () => {
    it('should save assistant to database', async () => {
      mockDB.put.mockResolvedValue(undefined);

      await saveAssistant(mockAssistant);

      expect(mockDB.put).toHaveBeenCalledWith('assistants', mockAssistant);
    });
  });

  describe('deleteAssistant', () => {
    it('should delete assistant from database', async () => {
      mockDB.transaction.mockReturnValue(
        mockTx as unknown as IDBPTransaction<unknown, [typeof SESSIONS_STORE], 'readwrite'>,
      );
      mockDB.getAllFromIndex.mockResolvedValue([]);
      mockDB.delete.mockResolvedValue(undefined);

      await deleteAssistant('test-id');

      expect(mockDB.delete).toHaveBeenCalledWith('assistants', 'test-id');
      expect(mockDB.getAllFromIndex).toHaveBeenCalledWith('sessions', 'by-assistant', 'test-id');
    });

    it('should delete associated sessions when deleting an assistant', async () => {
      mockDB.getAllFromIndex.mockResolvedValue([mockSession]);
      mockDB.transaction.mockReturnValue(
        mockTx as unknown as IDBPTransaction<unknown, [typeof SESSIONS_STORE], 'readwrite'>,
      );
      mockTx.store.delete.mockResolvedValue(undefined);

      await deleteAssistant('test-id');

      expect(mockDB.getAllFromIndex).toHaveBeenCalledWith('sessions', 'by-assistant', 'test-id');
      expect(mockDB.transaction).toHaveBeenCalledWith('sessions', 'readwrite');
      expect(mockTx.store.delete).toHaveBeenCalledWith('session-id');
    });
  });

  describe('saveBundle', () => {
    it('surfaces storage quota failures as BundleQuotaExceededError', async () => {
      // Arrange
      const bundle: BundleRecord = {
        id: 'bundle-quota',
        importedAt: 1,
        sizeBytes: 100,
        bundle: {
          manifest: {
            format: 'educare-agent-bundle',
            schemaVersion: 1,
            name: 'Quota test bundle',
            description: 'Verifies quota errors are actionable.',
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
      };
      mockDB.put.mockRejectedValue(
        Object.assign(new Error('Storage is full.'), { name: 'QuotaExceededError' }),
      );

      // Act / Assert
      await expect(saveBundle(bundle)).rejects.toBeInstanceOf(BundleQuotaExceededError);
    });
  });

  describe('getSessionsForAssistant', () => {
    it('should return all sessions for a given assistant', async () => {
      const mockSessions = [mockSession];
      mockDB.getAllFromIndex.mockResolvedValue(mockSessions);

      const result = await getSessionsForAssistant('test-id');

      expect(mockDB.getAllFromIndex).toHaveBeenCalledWith('sessions', 'by-assistant', 'test-id');
      expect(result).toEqual(mockSessions);
    });
  });

  describe('saveSession', () => {
    it('should save a session to the database', async () => {
      await saveSession(mockSession);
      expect(mockDB.put).toHaveBeenCalledWith('sessions', mockSession);
    });
  });

  describe('deleteSession', () => {
    it('should delete a session from the database', async () => {
      await deleteSession('session-id');
      expect(mockDB.delete).toHaveBeenCalledWith('sessions', 'session-id');
    });
  });
});
