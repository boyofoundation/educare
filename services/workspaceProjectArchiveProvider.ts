import type { HtmlProjectSnapshot } from '../types';
import * as gitService from './htmlProjectGitService';
import {
  htmlProjectStore,
  type HtmlProjectArchive,
  type HtmlProjectListOptions,
  type ImportHtmlProjectArchiveOptions,
  type ImportedProjectCleanupResult,
} from './htmlProjectStore';
import type { WorkspaceOperationToken } from './workspaceOperationService';

/** Shared staged-row marker consumed by all workspace archive readers. */
export const WORKSPACE_PROJECT_ARCHIVE_IMPORT_ID_FIELD = '__educareWorkspaceArchiveImportId';

export interface WorkspaceProjectArchiveCounts {
  /** Number of raw repository entries, including git internals and metadata. */
  git: number;
  /** Number of snapshot commits represented by the nested git history. */
  snapshots: number;
  /** Number of project todo rows included in the nested project archive. */
  todos: number;
}

/**
 * One project record owns its metadata, todos, snapshots, and complete raw
 * repository.  Snapshots and git are intentionally nested rather than
 * imported again through separate providers.
 */
export interface WorkspaceProjectArchiveRecord extends HtmlProjectArchive {
  id: string;
  snapshots: HtmlProjectSnapshot[];
  counts: WorkspaceProjectArchiveCounts;
}

export interface WorkspaceProjectArchiveImportContext {
  archiveId: string;
  /** Newer archive coordinators pass the durable journal id explicitly. */
  importId: string;
  category: string;
  idMap: unknown;
  operationToken: WorkspaceOperationToken;
  visibility: 'hidden';
  registerCreatedIds: (ids: string[]) => void;
}

export interface WorkspaceProjectArchiveExportContext {
  operationToken?: WorkspaceOperationToken;
}

export interface WorkspaceProjectArchiveProvider {
  readonly category: 'projects';
  exportRecords: (
    context?: WorkspaceProjectArchiveExportContext,
  ) => Promise<WorkspaceProjectArchiveRecord[]>;
  importRecords: (
    records: unknown[] | Record<string, unknown>,
    context: WorkspaceProjectArchiveImportContext,
  ) => Promise<{
    createdIds: string[];
    metadata: Record<string, unknown>;
  }>;
  publishImportedRecords: (
    ids: string[],
    context: WorkspaceProjectArchiveImportContext,
  ) => Promise<void>;
  removeImportedRecords: (
    ids: string[],
    context: WorkspaceProjectArchiveImportContext,
  ) => Promise<void>;
  listExistingIds: () => Promise<string[]>;
}

export interface WorkspaceProjectArchiveStore {
  listProjects: (options?: HtmlProjectListOptions) => Promise<unknown[]>;
  listProjectIds: (options?: HtmlProjectListOptions) => Promise<string[]>;
  exportProjectArchive: (
    projectId: string,
    options?: Pick<ImportHtmlProjectArchiveOptions, 'operationToken'>,
  ) => Promise<HtmlProjectArchive>;
  listSnapshots: (
    projectId: string,
    options?: Pick<ImportHtmlProjectArchiveOptions, 'operationToken'>,
  ) => Promise<{ snapshots: HtmlProjectSnapshot[] }>;
  importProjectArchive: (
    archive: HtmlProjectArchive,
    options?: ImportHtmlProjectArchiveOptions,
  ) => Promise<unknown>;
  publishImportedProjectRecords: (
    projectIds: string[],
    importId: string,
    options?: Pick<ImportHtmlProjectArchiveOptions, 'operationToken'>,
  ) => Promise<void>;
  removeImportedProjectRecords: (
    projectIds: string[],
    importId: string,
    options?: Pick<ImportHtmlProjectArchiveOptions, 'operationToken'>,
  ) => Promise<ImportedProjectCleanupResult>;
}

export interface WorkspaceProjectArchiveProviderDependencies {
  store?: WorkspaceProjectArchiveStore;
  git?: Pick<typeof gitService, 'flush'>;
}

const defaultStore = htmlProjectStore as unknown as WorkspaceProjectArchiveStore;
const defaultGit = gitService;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asRecords = (value: unknown[] | Record<string, unknown>): Record<string, unknown>[] => {
  if (!Array.isArray(value)) {
    return [value];
  }
  return value.map((record, index) => {
    if (!isRecord(record)) {
      throw new Error(`Workspace project archive record ${index} is not an object.`);
    }
    return record;
  });
};

const getImportId = (context: WorkspaceProjectArchiveImportContext): string => {
  const importId = context.importId;
  if (!importId || !importId.trim()) {
    throw new Error('Workspace project archive operation requires a durable importId.');
  }
  return importId;
};

const getProjectIdMap = (context: WorkspaceProjectArchiveImportContext): Record<string, string> => {
  if (!isRecord(context.idMap)) {
    return {};
  }
  const projects = context.idMap.projects;
  if (!isRecord(projects)) {
    return {};
  }
  return Object.entries(projects).reduce<Record<string, string>>((result, [sourceId, targetId]) => {
    if (typeof targetId === 'string') {
      result[sourceId] = targetId;
    }
    return result;
  }, {});
};

const isNonNegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const requireProjectRecord = (value: Record<string, unknown>): WorkspaceProjectArchiveRecord => {
  const project = value.project;
  const repository = value.repository;
  const todos = value.todos;
  const snapshots = value.snapshots;
  const counts = value.counts;
  if (
    typeof value.id !== 'string' ||
    !isRecord(project) ||
    !isRecord(repository) ||
    !Array.isArray(todos) ||
    !Array.isArray(snapshots) ||
    !isRecord(counts) ||
    !Array.isArray(repository.entries) ||
    !isNonNegativeInteger(counts.git) ||
    !isNonNegativeInteger(counts.snapshots) ||
    !isNonNegativeInteger(counts.todos) ||
    counts.git !== repository.entries.length ||
    counts.snapshots !== snapshots.length ||
    counts.todos !== todos.length
  ) {
    throw new Error('Workspace project archive record has an invalid shape.');
  }
  return value as unknown as WorkspaceProjectArchiveRecord;
};

const buildArchiveForImport = (
  value: Record<string, unknown>,
  projectIdMap: Record<string, string>,
): { targetId: string; archive: HtmlProjectArchive } => {
  const record = requireProjectRecord(value);
  const sourceProject = record.project;
  const sourceId = record.id;
  const targetId = projectIdMap[sourceId] ?? sourceId;
  const project = { ...sourceProject, id: targetId };
  const repository = { ...record.repository, projectId: targetId };
  const todos = record.todos.map(todo => ({ ...todo, projectId: targetId }));
  return {
    targetId,
    archive: {
      schemaVersion: 1,
      project,
      repository,
      todos,
    } as HtmlProjectArchive,
  };
};

export const createWorkspaceProjectArchiveProvider = (
  dependencies: WorkspaceProjectArchiveProviderDependencies = {},
): WorkspaceProjectArchiveProvider => {
  const store = dependencies.store ?? defaultStore;
  const git = dependencies.git ?? defaultGit;

  return {
    category: 'projects',

    async exportRecords(
      context: WorkspaceProjectArchiveExportContext = {},
    ): Promise<WorkspaceProjectArchiveRecord[]> {
      // Export is called while the outer coordinator owns the exclusive
      // operation.  Flush first to drain every prior LightningFS write, then
      // pass the opaque capability through each nested store operation rather
      // than exposing a freely reusable barrier bypass.
      const operationOptions =
        context.operationToken === undefined
          ? undefined
          : { operationToken: context.operationToken };
      await git.flush(operationOptions);
      const projects = await store.listProjects();
      const records: WorkspaceProjectArchiveRecord[] = [];
      for (const value of projects) {
        if (!isRecord(value) || typeof value.id !== 'string') {
          continue;
        }
        const archive = await store.exportProjectArchive(value.id, operationOptions);
        const snapshotResult = await store.listSnapshots(value.id, operationOptions);
        const snapshots = snapshotResult.snapshots.map(snapshot => ({ ...snapshot }));
        records.push({
          ...archive,
          id: archive.project.id,
          snapshots,
          counts: {
            git: archive.repository.entries.length,
            snapshots: snapshots.length,
            todos: archive.todos.length,
          },
        });
      }
      return records;
    },

    async importRecords(
      records: unknown[] | Record<string, unknown>,
      context: WorkspaceProjectArchiveImportContext,
    ) {
      if (context.visibility !== 'hidden') {
        throw new Error('Workspace project archive imports must stage records as hidden.');
      }
      const importId = getImportId(context);
      const projectIdMap = getProjectIdMap(context);
      const createdIds: string[] = [];
      let gitEntryCount = 0;
      let snapshotCount = 0;
      let todoCount = 0;
      for (const value of asRecords(records)) {
        const { targetId, archive } = buildArchiveForImport(value, projectIdMap);
        await store.importProjectArchive(archive, {
          projectId: targetId,
          assistantId: archive.project.assistantId,
          sessionId: archive.project.sessionId,
          importId,
          visibility: 'hidden',
          operationToken: context.operationToken,
        });
        createdIds.push(targetId);
        context.registerCreatedIds([targetId]);
        const source = requireProjectRecord(value);
        gitEntryCount += source.counts.git;
        snapshotCount += source.counts.snapshots;
        todoCount += source.counts.todos;
      }
      return {
        createdIds,
        metadata: {
          projectCount: createdIds.length,
          gitEntryCount,
          snapshotCount,
          todoCount,
        },
      };
    },

    async publishImportedRecords(ids, context) {
      const importId = getImportId(context);
      await store.publishImportedProjectRecords(ids, importId, {
        operationToken: context.operationToken,
      });
    },

    async removeImportedRecords(ids, context) {
      const importId = getImportId(context);
      await store.removeImportedProjectRecords(ids, importId, {
        operationToken: context.operationToken,
      });
    },

    async listExistingIds() {
      // Include hidden rows so a crashed staging attempt cannot be overwritten
      // by a later import before journal recovery removes its owned IDs.
      return store.listProjectIds({ includeHidden: true });
    },
  };
};

/** Production provider instance; root registration owns its lifecycle. */
export const workspaceProjectArchiveProvider = createWorkspaceProjectArchiveProvider();
