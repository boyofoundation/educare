import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createWorkspaceDraftArchiveProvider,
  type WorkspaceDraftArchiveStore,
} from './workspaceDraftArchiveProvider';
import {
  exportWorkspaceDrafts,
  readWorkspaceDraft,
  resetWorkspaceDraftMemory,
  type DraftPersistenceMode,
  type WorkspaceDraftArchiveEntry,
} from './workspaceDraftService';
import {
  __resetWorkspaceOperationServiceForTesting,
  withWorkspaceOperation,
} from './workspaceOperationService';
import type { WorkspaceArchiveIdMap } from './workspaceArchiveService';

const assistantDraft = {
  id: 'assistant-source',
  name: 'Draft assistant',
  description: 'A local draft',
  systemPrompt: 'Be useful.',
  ragChunks: [],
  starterPrompts: [],
  createdAt: 1,
};

const makeContext = (
  registerCreatedIds = vi.fn(),
  idMap: WorkspaceArchiveIdMap = {
    assistants: { 'assistant-source': 'assistant-copy' },
    sessions: { 'session-source': 'session-copy' },
    bundles: {},
    checkpoints: {},
    projects: {},
    providerRecords: {},
    virtualAssistants: {},
  },
) => ({
  archiveId: 'archive-1',
  importId: 'import-1',
  category: 'drafts' as const,
  idMap,
  operationToken: Symbol('operation'),
  visibility: 'hidden' as const,
  registerCreatedIds,
});

const makeStore = (entries: WorkspaceDraftArchiveEntry[] = []) => {
  let current = [...entries];
  const store: WorkspaceDraftArchiveStore = {
    listEntries: vi.fn(options =>
      [...current].filter(entry => options?.includeHidden || entry.visibility !== 'hidden'),
    ),
    stageEntries: vi.fn((staged: WorkspaceDraftArchiveEntry[], importId: string) => {
      const hidden = staged.map(entry => ({
        ...entry,
        visibility: 'hidden' as const,
        __educareWorkspaceArchiveImportId: importId,
      }));
      current = [
        ...current.filter(entry => !hidden.some(stagedEntry => stagedEntry.id === entry.id)),
        ...hidden,
      ];
      return 'persistent' as DraftPersistenceMode;
    }),
    publishEntries: vi.fn((ids, importId) => {
      current = current.map(entry =>
        ids.includes(entry.id) && entry.__educareWorkspaceArchiveImportId === importId
          ? {
              ...entry,
              visibility: undefined,
              __educareWorkspaceArchiveImportId: undefined,
            }
          : entry,
      );
      return 'persistent' as DraftPersistenceMode;
    }),
    removeEntries: vi.fn((ids, importId) => {
      current = current.filter(
        entry => !(ids.includes(entry.id) && entry.__educareWorkspaceArchiveImportId === importId),
      );
      return 'persistent' as DraftPersistenceMode;
    }),
  };
  return { store, read: () => current };
};

beforeEach(() => {
  const values = new Map<string, string>();
  vi.mocked(window.localStorage.getItem).mockImplementation(key => values.get(key) ?? null);
  vi.mocked(window.localStorage.setItem).mockImplementation((key, value) => {
    values.set(key, value);
  });
  vi.mocked(window.localStorage.removeItem).mockImplementation(key => {
    values.delete(key);
  });
  resetWorkspaceDraftMemory();
  __resetWorkspaceOperationServiceForTesting();
});

describe('workspaceDraftArchiveProvider', () => {
  it('exports only visible drafts while listExistingIds includes hidden ownership rows', async () => {
    const { store } = makeStore([
      {
        schemaVersion: 1,
        kind: 'chat',
        ownerId: 'assistant-a:session-a',
        value: 'visible',
        updatedAt: 1,
        id: 'chat:assistant-a:session-a',
      },
      {
        schemaVersion: 1,
        kind: 'chat',
        ownerId: 'assistant-b:session-b',
        value: 'hidden',
        updatedAt: 2,
        id: 'chat:assistant-b:session-b',
        visibility: 'hidden',
        __educareWorkspaceArchiveImportId: 'import-old',
      },
    ]);
    const provider = createWorkspaceDraftArchiveProvider({ store });

    await expect(provider.exportRecords()).resolves.toEqual([
      expect.objectContaining({ id: 'chat:assistant-a:session-a', value: 'visible' }),
    ]);
    await expect(provider.listExistingIds?.()).resolves.toEqual([
      'chat:assistant-a:session-a',
      'chat:assistant-b:session-b',
    ]);
  });

  it('stages remapped chat and assistant owners as hidden durable rows and returns IDs', async () => {
    const { store, read } = makeStore();
    const provider = createWorkspaceDraftArchiveProvider({ store });
    const registerCreatedIds = vi.fn();
    const context = makeContext(registerCreatedIds);

    const result = (await provider.importRecords(
      [
        {
          schemaVersion: 1,
          kind: 'chat',
          ownerId: 'assistant-source:session-source',
          value: 'chat draft',
          updatedAt: 1,
          id: 'chat:assistant-source:session-source',
        },
        {
          schemaVersion: 1,
          kind: 'assistant',
          ownerId: 'assistant-source',
          value: assistantDraft,
          updatedAt: 2,
          id: 'assistant:assistant-source',
        },
      ],
      context,
    )) as { createdIds: string[] };

    expect(result.createdIds).toEqual([
      'chat:assistant-copy:session-copy',
      'assistant:assistant-copy',
    ]);
    expect(registerCreatedIds).toHaveBeenCalledWith(result.createdIds);
    expect(read()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'chat:assistant-copy:session-copy',
          ownerId: 'assistant-copy:session-copy',
          visibility: 'hidden',
          __educareWorkspaceArchiveImportId: 'import-1',
        }),
        expect.objectContaining({
          id: 'assistant:assistant-copy',
          ownerId: 'assistant-copy',
          value: expect.objectContaining({ id: 'assistant-copy' }),
          visibility: 'hidden',
        }),
      ]),
    );
  });

  it('publishes and removes only rows owned by the import', async () => {
    const { store, read } = makeStore();
    const provider = createWorkspaceDraftArchiveProvider({ store });
    const context = makeContext();
    const imported = (await provider.importRecords(
      {
        schemaVersion: 1,
        kind: 'chat',
        ownerId: 'assistant-source:session-source',
        value: 'chat draft',
        updatedAt: 1,
        id: 'chat:assistant-source:session-source',
      },
      context,
    )) as { createdIds: string[] };
    const id = imported.createdIds[0];

    await provider.publishImportedRecords?.([id], context);
    expect(read()).toEqual([expect.objectContaining({ id, visibility: undefined })]);

    const second = (await provider.importRecords(
      {
        schemaVersion: 1,
        kind: 'chat',
        ownerId: 'assistant-source:session-source',
        value: 'another draft',
        updatedAt: 2,
        id: 'chat:assistant-source:session-source-2',
      },
      { ...context, importId: 'import-2' },
    )) as { createdIds: string[] };
    await provider.removeImportedRecords?.([second.createdIds[0]], {
      ...context,
      importId: 'import-2',
    });
    expect(read()).toEqual([expect.objectContaining({ id })]);
  });

  it('uses a unique owner/id when a draft-only copy conflicts with a visible owner', async () => {
    const existing: WorkspaceDraftArchiveEntry = {
      schemaVersion: 1,
      kind: 'chat',
      ownerId: 'assistant-source:session-source',
      value: 'old',
      updatedAt: 1,
      id: 'chat:assistant-source:session-source',
    };
    const { store } = makeStore([existing]);
    const provider = createWorkspaceDraftArchiveProvider({ store });
    const result = (await provider.importRecords(
      {
        schemaVersion: 1,
        kind: 'chat',
        ownerId: existing.ownerId,
        value: 'new',
        updatedAt: 2,
        id: existing.id,
      },
      makeContext(vi.fn(), {
        assistants: {},
        sessions: {},
        bundles: {},
        checkpoints: {},
        projects: {},
        providerRecords: {},
        virtualAssistants: {},
      }),
    )) as { createdIds: string[] };

    expect(result.createdIds).toEqual(['chat:assistant-source:session-source-copy']);
  });

  it('honors planned provider IDs after generic owner remapping', async () => {
    const { store, read } = makeStore();
    const provider = createWorkspaceDraftArchiveProvider({ store });
    const registerCreatedIds = vi.fn();
    const plannedId = 'chat:planned-target';
    const result = (await provider.importRecords(
      {
        schemaVersion: 1,
        kind: 'chat',
        ownerId: 'assistant-copy:session-copy',
        value: 'planned draft',
        updatedAt: 3,
        // This is the shape supplied after the generic archive walker has
        // already remapped the source ID to its planned provider ID.
        id: plannedId,
      },
      makeContext(registerCreatedIds, {
        assistants: { 'assistant-source': 'assistant-copy' },
        sessions: { 'session-source': 'session-copy' },
        bundles: {},
        checkpoints: {},
        projects: {},
        providerRecords: {
          drafts: { 'chat:assistant-source:session-source': plannedId },
        },
        virtualAssistants: {},
      }),
    )) as { createdIds: string[] };

    expect(result.createdIds).toEqual([plannedId]);
    expect(read()).toEqual([
      expect.objectContaining({
        id: plannedId,
        ownerId: 'assistant-copy:session-copy',
        visibility: 'hidden',
      }),
    ]);
    expect(registerCreatedIds.mock.invocationCallOrder[0]).toBeLessThan(
      (store.stageEntries as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0],
    );
  });

  it('round-trips a staged draft through the real service under the workspace barrier', async () => {
    const provider = createWorkspaceDraftArchiveProvider();
    const registerCreatedIds = vi.fn();
    const source = {
      schemaVersion: 1,
      kind: 'chat' as const,
      ownerId: 'assistant-roundtrip:session-roundtrip',
      value: 'barrier draft',
      updatedAt: 10,
      id: 'chat:assistant-roundtrip:session-roundtrip',
    };
    const context = makeContext(registerCreatedIds, {
      assistants: {},
      sessions: {},
      bundles: {},
      checkpoints: {},
      projects: {},
      providerRecords: {},
      virtualAssistants: {},
    });

    let createdIds: string[] = [];
    await withWorkspaceOperation('import', async operationToken => {
      const result = (await provider.importRecords(source, {
        ...context,
        operationToken,
      })) as { createdIds: string[] };
      createdIds = result.createdIds;
      expect(registerCreatedIds).toHaveBeenCalledWith(createdIds);
      expect(exportWorkspaceDrafts().entries).toEqual([]);
      expect(readWorkspaceDraft<string>('chat', source.ownerId).value).toBeUndefined();
    });

    expect(createdIds).toEqual([source.id]);
    await withWorkspaceOperation('import', async operationToken => {
      await provider.publishImportedRecords?.(createdIds, {
        ...context,
        operationToken,
      });
    });

    expect(readWorkspaceDraft<string>('chat', source.ownerId).value).toBe('barrier draft');
    expect(exportWorkspaceDrafts().entries).toEqual([
      expect.objectContaining({ id: source.id, value: 'barrier draft' }),
    ]);
  });
});
