import { describe, expect, it, vi } from 'vitest';
import {
  createWorkspaceProjectArchiveProvider,
  type WorkspaceProjectArchiveStore,
} from './workspaceProjectArchiveProvider';
import type { HtmlProjectArchive } from './htmlProjectStore';
import type { HtmlProject, HtmlProjectSnapshot, HtmlProjectTodo } from '../types';

const project: HtmlProject = {
  id: 'project-source',
  assistantId: 'assistant-source',
  sessionId: 'session-source',
  name: 'Source project',
  entryFile: '/index.html',
  status: 'draft',
  previewVersion: 2,
  assetPaths: [],
  createdAt: 1,
  updatedAt: 2,
};

const todo: HtmlProjectTodo = {
  projectId: project.id,
  id: 'todo-1',
  title: 'Todo',
  status: 'pending',
  order: 0,
  createdAt: 1,
  updatedAt: 1,
};

const snapshot: HtmlProjectSnapshot = {
  projectId: project.id,
  version: 1,
  files: ['/index.html'],
  createdAt: 1,
  oid: 'snapshot-oid',
};

const archive: HtmlProjectArchive = {
  schemaVersion: 1,
  project,
  repository: {
    schemaVersion: 1,
    projectId: project.id,
    entries: [{ path: '.git/HEAD', data: new Uint8Array([1, 2, 3]) }],
    currentBranch: 'main',
    headOid: 'head-oid',
    byteCount: 3,
  },
  todos: [todo],
};

const makeStore = () => {
  const store = {
    listProjects: vi.fn().mockResolvedValue([project]),
    listProjectIds: vi.fn().mockResolvedValue([project.id]),
    exportProjectArchive: vi.fn().mockResolvedValue(archive),
    listSnapshots: vi.fn().mockResolvedValue({ snapshots: [snapshot] }),
    importProjectArchive: vi.fn().mockResolvedValue(project),
    publishImportedProjectRecords: vi.fn().mockResolvedValue(undefined),
    removeImportedProjectRecords: vi.fn().mockResolvedValue({ removedIds: [project.id] }),
  } as unknown as WorkspaceProjectArchiveStore;
  return store;
};

describe('workspaceProjectArchiveProvider', () => {
  it('exports complete nested project/git/snapshot/todo records after flushing', async () => {
    const store = makeStore();
    const flush = vi.fn().mockResolvedValue(undefined);
    const provider = createWorkspaceProjectArchiveProvider({ store, git: { flush } });
    const operationToken = Symbol('workspace-operation');

    const records = await provider.exportRecords({ operationToken });

    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith({ operationToken });
    expect(store.exportProjectArchive).toHaveBeenCalledWith(project.id, { operationToken });
    expect(store.listSnapshots).toHaveBeenCalledWith(project.id, { operationToken });
    expect(records).toEqual([
      expect.objectContaining({
        id: project.id,
        snapshots: [snapshot],
        counts: { git: 1, snapshots: 1, todos: 1 },
      }),
    ]);
  });

  it('stages remapped records hidden and exposes publish/cleanup hooks', async () => {
    const store = makeStore();
    const provider = createWorkspaceProjectArchiveProvider({ store });
    const registerCreatedIds = vi.fn();
    const operationToken = Symbol('workspace-operation');

    const result = await provider.importRecords(
      [
        {
          ...archive,
          id: project.id,
          snapshots: [snapshot],
          counts: { git: 1, snapshots: 1, todos: 1 },
        },
      ],
      {
        archiveId: 'archive-1',
        importId: 'import-1',
        category: 'projects',
        idMap: { projects: { [project.id]: 'project-target' } },
        operationToken,
        visibility: 'hidden',
        registerCreatedIds,
      },
    );

    expect(store.importProjectArchive).toHaveBeenCalledWith(
      expect.objectContaining({
        project: expect.objectContaining({ id: 'project-target' }),
        repository: expect.objectContaining({ projectId: 'project-target' }),
        todos: [expect.objectContaining({ projectId: 'project-target' })],
      }),
      expect.objectContaining({
        projectId: 'project-target',
        importId: 'import-1',
        visibility: 'hidden',
        operationToken,
      }),
    );
    expect(registerCreatedIds).toHaveBeenCalledWith(['project-target']);
    expect(result.createdIds).toEqual(['project-target']);

    await provider.publishImportedRecords(['project-target'], {
      archiveId: 'archive-1',
      importId: 'import-1',
      category: 'projects',
      idMap: { projects: { [project.id]: 'project-target' } },
      operationToken,
      visibility: 'hidden',
      registerCreatedIds,
    });
    await provider.removeImportedRecords(['project-target'], {
      archiveId: 'archive-1',
      importId: 'import-1',
      category: 'projects',
      idMap: { projects: { [project.id]: 'project-target' } },
      operationToken,
      visibility: 'hidden',
      registerCreatedIds,
    });

    expect(store.publishImportedProjectRecords).toHaveBeenCalledWith(
      ['project-target'],
      'import-1',
      { operationToken },
    );
    expect(store.removeImportedProjectRecords).toHaveBeenCalledWith(
      ['project-target'],
      'import-1',
      { operationToken },
    );
  });
});
