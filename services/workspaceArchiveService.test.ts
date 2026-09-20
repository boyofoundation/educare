import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { openDB } from 'idb';
import type { AgentRunCheckpoint, Assistant, BundleRecord, ChatSession } from '../types';
import { getCheckpointArchiveRecords } from './agentRunCheckpointService';
import {
  __resetWorkspaceArchiveForTesting,
  buildWorkspaceArchive,
  exportWorkspaceArchive,
  getWorkspaceImportRecoveryStatus,
  importWorkspaceArchive,
  listWorkspaceImportRecovery,
  parseWorkspaceArchive,
  previewWorkspaceArchive,
  registerWorkspaceArchiveProvider,
  resumeWorkspaceImport,
  rollbackWorkspaceImport,
  type WorkspaceArchiveProvider,
  WorkspaceArchiveImportError,
} from './workspaceArchiveService';
import {
  clearWorkspaceArchivePublication,
  deleteWorkspaceDatabaseRecords,
  getWorkspaceDatabaseSnapshot,
  isWorkspaceArchiveImportPublished,
  markWorkspaceArchiveImportPublished,
  putWorkspaceDatabaseRecords,
  tagWorkspaceArchiveRecord,
} from './db';

const createPersistentTestStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string): string | null => values.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      values.set(key, value);
    },
    removeItem: (key: string): void => {
      values.delete(key);
    },
    clear: (): void => {
      values.clear();
    },
  };
};

const JOURNAL_DB_NAME = 'educare-workspace-archive-journal';
const JOURNAL_STORE_NAME = 'imports';

const createJournalRecord = (overrides: Record<string, unknown> = {}) => ({
  importId: 'recovery-fixture',
  archiveId: 'recovery-archive',
  state: 'rollback_pending',
  hidden: true,
  createdAt: 1,
  updatedAt: 2,
  archiveBytes: new Uint8Array([1, 2, 3]),
  idMap: {
    assistants: {},
    sessions: {},
    bundles: {},
    checkpoints: {},
    projects: {},
    providerRecords: {},
    virtualAssistants: {},
  },
  createdRecords: {},
  createdCheckpoints: [],
  providerCreatedIds: {},
  completedCategories: [],
  ...overrides,
});

const putJournalRecord = async (record: Record<string, unknown>): Promise<void> => {
  const db = await openDB(JOURNAL_DB_NAME, 1, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(JOURNAL_STORE_NAME)) {
        database.createObjectStore(JOURNAL_STORE_NAME, { keyPath: 'importId' });
      }
    },
  });
  await db.put(JOURNAL_STORE_NAME, record as never);
  db.close();
};

const assistant = (id: string): Assistant => ({
  id,
  name: `Assistant ${id}`,
  description: 'Archive fixture',
  systemPrompt: 'Be helpful.',
  starterPrompts: [],
  ragChunks: [],
  createdAt: 1,
});

const session = (id: string, assistantId: string): ChatSession => ({
  id,
  assistantId,
  title: `Session ${id}`,
  messages: [{ role: 'user', content: 'hello' }],
  createdAt: 1,
  updatedAt: 2,
  tokenCount: 1,
});

const bundle = (id: string): BundleRecord => ({
  id,
  importedAt: 1,
  sizeBytes: 10,
  bundle: {
    manifest: {
      format: 'educare-agent-bundle',
      schemaVersion: 1,
      name: 'Fixture bundle',
      description: 'Bundle',
      version: '1.0.0',
      exportedAt: 1,
      entryAgentId: 'virtual-agent',
    },
    agents: [
      {
        id: 'virtual-agent',
        name: 'Virtual agent',
        description: 'Agent',
        systemPrompt: 'Answer.',
        starterPrompts: [],
        ragChunks: [],
      },
    ],
    routes: [],
    encryptedProviderSettings: {
      v: 1,
      algorithm: 'AES-GCM',
      kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 100_000 },
      salt: 'abcdefghijklmnopqrstuv',
      iv: 'abcdefghijklmnop',
      ciphertext: 'abcdefghijklmnop',
    },
  },
});

const checkpoint = (
  runId: string,
  assistantId: string,
  sessionId: string,
  status: AgentRunCheckpoint['status'] = 'stopped',
): AgentRunCheckpoint => ({
  schemaVersion: 1,
  runId,
  sessionId,
  assistantId,
  projectId: null,
  status,
  turnIndex: 0,
  maxTurns: 1,
  originalMessage: 'resume me',
  committedHistoryDelta: [],
  toolTrace: [],
  tokenTotals: { promptTokenCount: 0, candidatesTokenCount: 0 },
  agentHarnessEnabled: false,
  sharedMode: false,
  createdAt: 1,
  updatedAt: 1,
  heartbeatAt: 1,
});

describe('workspaceArchiveService', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createPersistentTestStorage());
  });

  afterEach(async () => {
    await __resetWorkspaceArchiveForTesting();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('exports explicit categories, excludes encrypted provider settings, and round-trips checksums', async () => {
    const result = await buildWorkspaceArchive(
      {
        assistants: [assistant('assistant-1')],
        sessions: [session('session-1', 'assistant-1')],
        bundles: [bundle('bundle-1')],
        checkpoints: [checkpoint('run-1', 'assistant-1', 'session-1')],
      },
      {
        categories: ['assistants', 'sessions', 'bundles', 'checkpoints'],
        now: 123,
        archiveId: 'archive-fixture',
      },
    );

    expect(result.manifest.archiveId).toBe('archive-fixture');
    expect(result.manifest.includedCategories).toEqual([
      'assistants',
      'sessions',
      'bundles',
      'checkpoints',
    ]);
    expect(result.manifest.excludedFields).toContain('encryptedProviderSettings');
    const parsed = await parseWorkspaceArchive(result.bytes);
    const importedBundle = parsed.records.bundles?.[0] as BundleRecord;
    expect(importedBundle.bundle.encryptedProviderSettings).toBeUndefined();
    expect(parsed.preview.totalEntries).toBe(5);
    expect(parsed.preview.totalUncompressedBytes).toBeGreaterThan(0);
  });

  it('warns when an allowlisted preference is omitted and does not mark backup complete', async () => {
    const getItem = vi.spyOn(globalThis.localStorage, 'getItem').mockImplementation(key => {
      if (key === 'educare.appearance.v1') {
        throw new Error('storage blocked');
      }
      return null;
    });
    const setItem = vi.spyOn(globalThis.localStorage, 'setItem');
    try {
      const result = await exportWorkspaceArchive({ categories: ['assistants'] });
      expect(result.preview.warnings).toContain(
        'Allowlisted preference educare.appearance.v1 could not be read and was omitted.',
      );
      expect(setItem).not.toHaveBeenCalledWith(
        'educare.workspace.last-backup.v1',
        expect.any(String),
      );
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });

  it('rejects tampered content, undeclared paths, and malformed record schemas before writes', async () => {
    const result = await buildWorkspaceArchive(
      { assistants: [assistant('assistant-1')] },
      { categories: ['assistants'], archiveId: 'tamper-fixture' },
    );
    const entries = unzipSync(result.bytes);
    entries['records/assistants.json'] = strToU8(JSON.stringify([{ id: 'tampered' }]));
    await expect(parseWorkspaceArchive(zipSync(entries))).rejects.toThrow(/checksum|size/i);

    const unsafe = {
      'manifest.json': strToU8(
        JSON.stringify({
          ...result.manifest,
          entries: [{ ...result.manifest.entries[0], path: 'records/../unsafe.json' }],
        }),
      ),
      'records/../unsafe.json': strToU8('[]'),
    };
    await expect(parseWorkspaceArchive(zipSync(unsafe))).rejects.toThrow(/unsafe/i);

    // Both malformed built-in records are rejected before any import writes.
    await expect(
      buildWorkspaceArchive(
        { assistants: [{ id: 'assistant-only' } as Assistant] },
        { categories: ['assistants'], archiveId: 'malformed-fixture' },
      ),
    ).rejects.toThrow(/assistants.*invalid shape/i);
    await expect(
      buildWorkspaceArchive(
        { bundles: [{ id: 'bundle-only' } as BundleRecord] },
        { categories: ['bundles'], archiveId: 'malformed-bundle-fixture' },
      ),
    ).rejects.toThrow(/invalid shape/i);
  });

  it('previews conflicts and imports a copy with remapped foreign keys and virtual assistants', async () => {
    const result = await buildWorkspaceArchive(
      {
        assistants: [assistant('assistant-copy')],
        sessions: [session('session-copy', 'assistant-copy')],
        bundles: [bundle('bundle-copy')],
        checkpoints: [checkpoint('run-copy', 'assistant-copy', 'session-copy', 'running')],
      },
      {
        categories: ['assistants', 'sessions', 'bundles', 'checkpoints'],
        archiveId: 'copy-fixture',
      },
    );
    const preview = await previewWorkspaceArchive(result.bytes);
    expect(preview.conflictCounts).toEqual({});

    const imported = await importWorkspaceArchive(result.bytes);
    expect(imported.state).toBe('published');
    expect(imported.idMap.assistants['assistant-copy']).not.toBe('assistant-copy');
    expect(imported.idMap.sessions['session-copy']).not.toBe('session-copy');
    expect(imported.idMap.bundles['bundle-copy']).not.toBe('bundle-copy');
    expect(imported.idMap.checkpoints['run-copy']).not.toBe('run-copy');
    const importedCheckpoint = (await getCheckpointArchiveRecords()).find(
      record => record.runId === imported.idMap.checkpoints['run-copy'],
    );
    expect(importedCheckpoint?.status).toBe('stopped');
    expect(Object.values(imported.idMap.virtualAssistants)).toContain(
      `${imported.idMap.bundles['bundle-copy']}:virtual-agent`,
    );
    expect(await getWorkspaceImportRecoveryStatus(imported.importId)).toMatchObject({
      state: 'published',
      hidden: false,
      rollbackAvailable: false,
    });
    await expect(rollbackWorkspaceImport(imported.importId)).rejects.toThrow(/not eligible/i);
  });

  it('rolls back primary records when a provider import fails and leaves a hidden recovery record', async () => {
    const removeImportedRecords = vi.fn().mockResolvedValue(undefined);
    const provider: WorkspaceArchiveProvider = {
      category: 'projects',
      exportRecords: async () => [{ id: 'project-1', name: 'Project' }],
      importRecords: async (_records, context) => {
        context.registerCreatedIds(['project-created']);
        throw new Error('provider write failed');
      },
      removeImportedRecords,
    };
    registerWorkspaceArchiveProvider(provider);
    const result = await buildWorkspaceArchive(
      { assistants: [assistant('provider-assistant')], projects: [{ id: 'project-1' }] },
      { categories: ['assistants', 'projects'], archiveId: 'rollback-fixture' },
    );

    const error = await importWorkspaceArchive(result.bytes).catch(value => value);
    expect(error).toBeInstanceOf(WorkspaceArchiveImportError);
    expect((error as WorkspaceArchiveImportError).state).toBe('rolled_back');
    expect(removeImportedRecords).toHaveBeenCalledWith(
      expect.arrayContaining(['project-1-copy', 'project-created']),
      expect.objectContaining({ category: 'projects' }),
    );
    expect(
      await getWorkspaceImportRecoveryStatus((error as WorkspaceArchiveImportError).importId),
    ).toMatchObject({
      state: 'rolled_back',
      hidden: true,
    });
  });

  it('keeps recovery failed when a provider cannot prove created ownership', async () => {
    registerWorkspaceArchiveProvider({
      category: 'projects',
      exportRecords: async () => [],
      importRecords: async () => undefined,
    });
    const result = await buildWorkspaceArchive(
      { assistants: [assistant('unknown-provider-assistant')], projects: [{ name: 'Untracked' }] },
      { categories: ['assistants', 'projects'], archiveId: 'unknown-owner-fixture' },
    );

    const error = await importWorkspaceArchive(result.bytes).catch(value => value);
    expect(error).toBeInstanceOf(WorkspaceArchiveImportError);
    expect((error as WorkspaceArchiveImportError).state).toBe('failed');
    expect((error as WorkspaceArchiveImportError).message).toMatch(
      /created IDs|rollback incomplete/i,
    );
    expect((error as WorkspaceArchiveImportError).recoveryStatus.resumable).toBe(true);
  });

  it('fails closed when publication receipt storage is unavailable and verifies revocation', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(() => markWorkspaceArchiveImportPublished('missing-storage')).toThrow(/storage/i);
    expect(() => isWorkspaceArchiveImportPublished('missing-storage')).toThrow(/storage/i);

    const unverifiableSetItem = vi.fn();
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: unverifiableSetItem,
    });
    expect(() => markWorkspaceArchiveImportPublished('unverifiable-import')).toThrow(
      /could not be verified/i,
    );
    expect(unverifiableSetItem).toHaveBeenCalled();

    const storage = createPersistentTestStorage();
    vi.stubGlobal('localStorage', storage);
    markWorkspaceArchiveImportPublished('revoked-import');
    expect(isWorkspaceArchiveImportPublished('revoked-import')).toBe(true);
    clearWorkspaceArchivePublication('revoked-import');
    expect(isWorkspaceArchiveImportPublished('revoked-import')).toBe(false);

    const failingStorage = createPersistentTestStorage();
    vi.stubGlobal('localStorage', failingStorage);
    markWorkspaceArchiveImportPublished('clear-failure');
    failingStorage.setItem = () => {
      throw new Error('storage write blocked');
    };
    expect(() => clearWorkspaceArchivePublication('clear-failure')).toThrow(/blocked/i);
  });

  it('does not delete a primary record owned by a different archive import', async () => {
    const ownedByOtherImport = tagWorkspaceArchiveRecord(
      assistant('ownership-mismatch-assistant'),
      'other-import',
    );
    await putWorkspaceDatabaseRecords({ assistants: [ownedByOtherImport] });

    await expect(
      deleteWorkspaceDatabaseRecords(
        { assistants: [assistant('ownership-mismatch-assistant')] },
        { ownershipImportId: 'requested-import' },
      ),
    ).rejects.toThrow(/ownership mismatch/i);
    await expect(getWorkspaceDatabaseSnapshot({ includeHidden: true })).resolves.toEqual(
      expect.objectContaining({
        assistants: expect.arrayContaining([
          expect.objectContaining({
            id: 'ownership-mismatch-assistant',
          }),
        ]),
      }),
    );

    // Remove the fixture without an ownership assertion so it cannot leak into later tests.
    await deleteWorkspaceDatabaseRecords({ assistants: [ownedByOtherImport] });
  });

  it('makes primary rollback idempotent after partial cleanup while preserving owner mismatch checks', async () => {
    const owner = 'retry-primary-import';
    const importedAssistant = tagWorkspaceArchiveRecord(
      assistant('retry-primary-assistant'),
      owner,
    );
    const importedSession = tagWorkspaceArchiveRecord(
      session('retry-primary-session', 'retry-primary-assistant'),
      owner,
    );
    await putWorkspaceDatabaseRecords({
      assistants: [importedAssistant],
      sessions: [importedSession],
    });

    // Model a partial rollback that removed one store before another store failed.
    await deleteWorkspaceDatabaseRecords(
      { assistants: [importedAssistant] },
      { ownershipImportId: owner },
    );
    await expect(
      deleteWorkspaceDatabaseRecords(
        { assistants: [importedAssistant], sessions: [importedSession] },
        { ownershipImportId: owner },
      ),
    ).resolves.toBeUndefined();
    // A second retry must tolerate both rows already being absent.
    await expect(
      deleteWorkspaceDatabaseRecords(
        { assistants: [importedAssistant], sessions: [importedSession] },
        { ownershipImportId: owner },
      ),
    ).resolves.toBeUndefined();

    const mismatch = tagWorkspaceArchiveRecord(
      assistant('retry-primary-mismatch'),
      'different-owner',
    );
    await putWorkspaceDatabaseRecords({ assistants: [mismatch] });
    await expect(
      deleteWorkspaceDatabaseRecords(
        { assistants: [assistant('retry-primary-mismatch')] },
        { ownershipImportId: owner },
      ),
    ).rejects.toThrow(/ownership mismatch/i);
    await deleteWorkspaceDatabaseRecords({ assistants: [mismatch] });
  });

  it('keeps rollback-pending recovery hidden across journal reload and gates resume on archive bytes', async () => {
    const pendingImportId = 'rollback-pending-reload';
    await putJournalRecord(
      createJournalRecord({
        importId: pendingImportId,
        state: 'rollback_pending',
        archiveBytes: new Uint8Array([1, 2, 3]),
      }),
    );

    await expect(getWorkspaceImportRecoveryStatus(pendingImportId)).resolves.toMatchObject({
      importId: pendingImportId,
      state: 'rollback_pending',
      hidden: true,
      resumable: false,
      rollbackAvailable: true,
    });
    expect(isWorkspaceArchiveImportPublished(pendingImportId)).toBe(false);
    await expect(listWorkspaceImportRecovery()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ importId: pendingImportId, state: 'rollback_pending' }),
      ]),
    );
    // Reloading a pending journal must never synthesize a publication receipt.
    expect(isWorkspaceArchiveImportPublished(pendingImportId)).toBe(false);
    await expect(resumeWorkspaceImport(pendingImportId)).rejects.toThrow(/not resumable/i);

    const missingBytesImportId = 'failed-without-recovery-bytes';
    await putJournalRecord(
      createJournalRecord({
        importId: missingBytesImportId,
        state: 'failed',
        archiveBytes: new Uint8Array(),
      }),
    );
    await expect(getWorkspaceImportRecoveryStatus(missingBytesImportId)).resolves.toMatchObject({
      state: 'failed',
      hidden: true,
      resumable: false,
      rollbackAvailable: true,
    });
    await expect(resumeWorkspaceImport(missingBytesImportId)).rejects.toThrow(/not resumable/i);
  });

  it('imports a default archive without requiring unregistered empty providers', async () => {
    const result = await buildWorkspaceArchive({ assistants: [assistant('default-assistant')] });

    const imported = await importWorkspaceArchive(result.bytes);

    expect(imported.state).toBe('published');
    expect(imported.skippedCategories).toEqual(
      expect.arrayContaining(['projects', 'snapshots', 'git', 'drafts', 'practice']),
    );
  });

  it('redacts provider settings and rejects manifest category mismatches', async () => {
    const result = await buildWorkspaceArchive(
      {
        projects: [
          {
            id: 'project-sensitive',
            providerSettings: { apiKey: 'must-not-export' },
            value: 'safe',
          },
        ],
      },
      { categories: ['projects'], archiveId: 'redaction-fixture' },
    );
    const parsed = await parseWorkspaceArchive(result.bytes);
    expect(parsed.records.projects?.[0]).toEqual({ id: 'project-sensitive', value: 'safe' });

    const entries = unzipSync(result.bytes);
    entries['manifest.json'] = strToU8(
      JSON.stringify({ ...result.manifest, includedCategories: [] }),
    );
    await expect(parseWorkspaceArchive(zipSync(entries))).rejects.toThrow(/archive category/i);
  });

  it('remaps composite draft owners along with assistant and session copies', async () => {
    let importedDrafts: unknown[] = [];
    registerWorkspaceArchiveProvider({
      category: 'drafts',
      exportRecords: async () => [],
      importRecords: async records => {
        importedDrafts = records as unknown[];
      },
    });
    const result = await buildWorkspaceArchive(
      {
        assistants: [assistant('draft-assistant')],
        sessions: [session('draft-session', 'draft-assistant')],
        drafts: [
          {
            id: 'draft-entry',
            ownerId: 'draft-assistant:draft-session',
            sourceSessionId: 'draft-session',
            value: 'draft text',
          },
        ],
      },
      { categories: ['assistants', 'sessions', 'drafts'], archiveId: 'draft-owner-fixture' },
    );

    const imported = await importWorkspaceArchive(result.bytes);

    expect(importedDrafts[0]).toMatchObject({
      ownerId: `${imported.idMap.assistants['draft-assistant']}:${imported.idMap.sessions['draft-session']}`,
      sourceSessionId: imported.idMap.sessions['draft-session'],
    });
  });

  it('remaps the full foreign-key closure across primary, checkpoint, and provider records', async () => {
    let importedProjects: unknown[] = [];
    let importedSnapshots: unknown[] = [];
    registerWorkspaceArchiveProvider({
      category: 'projects',
      exportRecords: async () => [],
      listExistingIds: async () => [],
      importRecords: async (records, context) => {
        importedProjects = records as unknown[];
        context.registerCreatedIds(
          importedProjects.flatMap(record =>
            typeof record === 'object' && record && 'id' in record && typeof record.id === 'string'
              ? [record.id]
              : [],
          ),
        );
      },
      removeImportedRecords: async () => undefined,
    });
    registerWorkspaceArchiveProvider({
      category: 'snapshots',
      exportRecords: async () => [],
      listExistingIds: async () => [],
      importRecords: async (records, context) => {
        importedSnapshots = records as unknown[];
        context.registerCreatedIds(
          importedSnapshots.flatMap(record =>
            typeof record === 'object' && record && 'id' in record && typeof record.id === 'string'
              ? [record.id]
              : [],
          ),
        );
      },
      removeImportedRecords: async () => undefined,
    });

    const sourceAssistant = {
      ...assistant('closure-assistant'),
      routableAssistantIds: ['closure-assistant'],
      routableTargets: [
        { id: 'closure-assistant', name: 'Closure assistant', description: 'Target' },
      ],
    } as Assistant & {
      routableTargets: Array<{ id: string; name: string; description: string }>;
    };
    const sourceSession = {
      ...session('closure-session', 'closure-assistant'),
      sourceSessionId: 'closure-session',
      activeProjectId: 'closure-project',
      handoffContext: {
        fromAssistantId: 'closure-assistant',
        fromAssistantName: 'Closure assistant',
        reason: 'test',
        summary: 'test',
        sourceSessionId: 'closure-session',
        createdAt: 1,
      },
    };
    const sourceCheckpoint = {
      ...checkpoint('closure-run', 'closure-assistant', 'closure-session'),
      projectId: 'closure-project',
      routableTargets: [
        { id: 'closure-assistant', name: 'Closure assistant', description: 'Target' },
      ],
    };
    const result = await buildWorkspaceArchive(
      {
        assistants: [sourceAssistant],
        sessions: [sourceSession],
        checkpoints: [sourceCheckpoint],
        projects: [{ id: 'closure-project', name: 'Closure project' }],
        snapshots: [{ id: 'closure-snapshot', projectId: 'closure-project' }],
      },
      {
        categories: ['assistants', 'sessions', 'checkpoints', 'projects', 'snapshots'],
        archiveId: 'foreign-key-closure-fixture',
      },
    );

    const imported = await importWorkspaceArchive(result.bytes);
    const assistantId = imported.idMap.assistants['closure-assistant'];
    const sessionId = imported.idMap.sessions['closure-session'];
    const projectId = imported.idMap.projects['closure-project'];

    expect(importedProjects[0]).toMatchObject({ id: projectId });
    expect(importedSnapshots[0]).toMatchObject({
      id: imported.idMap.providerRecords.snapshots?.['closure-snapshot'],
      projectId,
    });
    const importedPrimary = await getWorkspaceDatabaseSnapshot();
    expect(importedPrimary.assistants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: assistantId,
          routableAssistantIds: [assistantId],
          routableTargets: [expect.objectContaining({ id: assistantId })],
        }),
      ]),
    );
    expect(importedPrimary.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: sessionId,
          assistantId,
          sourceSessionId: sessionId,
          activeProjectId: projectId,
          handoffContext: expect.objectContaining({
            fromAssistantId: assistantId,
            sourceSessionId: sessionId,
          }),
        }),
      ]),
    );
    await expect(getCheckpointArchiveRecords()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          runId: imported.idMap.checkpoints['closure-run'],
          assistantId,
          sessionId,
          projectId,
          routableTargets: [expect.objectContaining({ id: assistantId })],
        }),
      ]),
    );
  });
});
