import type {
  WorkspaceArchiveProvider,
  WorkspaceArchiveProviderExportContext,
  WorkspaceArchiveProviderImportContext,
} from './workspaceArchiveService';
import type { WorkspaceOperationToken } from './workspaceOperationService';
import {
  buildWorkspaceDraftArchiveEntryId,
  isWorkspaceDraftValue,
  listWorkspaceDraftArchiveEntries,
  publishWorkspaceDraftArchiveEntries,
  removeWorkspaceDraftArchiveEntries,
  stageWorkspaceDraftArchiveEntries,
  type DraftPersistenceMode,
  type WorkspaceDraftArchiveEntry,
  type WorkspaceDraftKind,
  WORKSPACE_DRAFT_ARCHIVE_IMPORT_ID_FIELD as DRAFT_ARCHIVE_IMPORT_ID_FIELD,
} from './workspaceDraftService';

/** Durable hidden-row marker shared with the workspace archive journal. */
export const WORKSPACE_DRAFT_ARCHIVE_IMPORT_ID_FIELD = DRAFT_ARCHIVE_IMPORT_ID_FIELD;

export interface WorkspaceDraftArchiveStore {
  listEntries: (options?: {
    includeHidden?: boolean;
    operationToken?: WorkspaceOperationToken;
  }) => WorkspaceDraftArchiveEntry[];
  stageEntries: (
    entries: WorkspaceDraftArchiveEntry[],
    importId: string,
    operationToken: WorkspaceOperationToken,
  ) => DraftPersistenceMode;
  publishEntries: (
    ids: string[],
    importId: string,
    operationToken: WorkspaceOperationToken,
  ) => DraftPersistenceMode;
  removeEntries: (
    ids: string[],
    importId: string,
    operationToken: WorkspaceOperationToken,
  ) => DraftPersistenceMode;
}

export interface WorkspaceDraftArchiveProviderDependencies {
  store?: WorkspaceDraftArchiveStore;
}

export interface WorkspaceDraftArchiveRecord extends WorkspaceDraftArchiveEntry {
  id: string;
}

const defaultStore: WorkspaceDraftArchiveStore = {
  listEntries: options => listWorkspaceDraftArchiveEntries(options),
  stageEntries: (entries, importId, operationToken) =>
    stageWorkspaceDraftArchiveEntries(entries, importId, operationToken),
  publishEntries: (ids, importId, operationToken) =>
    publishWorkspaceDraftArchiveEntries(ids, importId, operationToken),
  removeEntries: (ids, importId, operationToken) =>
    removeWorkspaceDraftArchiveEntries(ids, importId, operationToken),
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asRecords = (value: unknown[] | Record<string, unknown>): Record<string, unknown>[] => {
  if (!Array.isArray(value)) {
    return [value];
  }
  return value.map((record, index) => {
    if (!isRecord(record)) {
      throw new Error(`Workspace draft archive record ${index} is not an object.`);
    }
    return record;
  });
};

const getImportId = (context: WorkspaceArchiveProviderImportContext): string => {
  if (!context.importId || !context.importId.trim()) {
    throw new Error('Workspace draft archive operation requires a durable importId.');
  }
  return context.importId;
};

const getAssistantMap = (context: WorkspaceArchiveProviderImportContext): Record<string, string> =>
  context.idMap.assistants ?? {};

const getSessionMap = (context: WorkspaceArchiveProviderImportContext): Record<string, string> =>
  context.idMap.sessions ?? {};

/** Remap composite chat owners even when a provider is called without the generic walker. */
const remapOwnerId = (ownerId: string, context: WorkspaceArchiveProviderImportContext): string => {
  const assistantMap = getAssistantMap(context);
  const sessionMap = getSessionMap(context);
  if (assistantMap[ownerId]) {
    return assistantMap[ownerId];
  }
  if (sessionMap[ownerId]) {
    return sessionMap[ownerId];
  }

  const assistantIds = Object.keys(assistantMap).sort((left, right) => right.length - left.length);
  for (const assistantId of assistantIds) {
    const prefix = `${assistantId}:`;
    if (!ownerId.startsWith(prefix)) {
      continue;
    }
    const sessionId = ownerId.slice(prefix.length);
    return `${assistantMap[assistantId]}:${sessionMap[sessionId] ?? sessionId}`;
  }
  return ownerId;
};

const remapDraftValue = (
  kind: WorkspaceDraftKind,
  value: unknown,
  ownerId: string,
  context: WorkspaceArchiveProviderImportContext,
): string | Record<string, unknown> => {
  if (kind === 'chat') {
    return value as string;
  }

  const assistant = value as Record<string, unknown>;
  const mappedId =
    typeof assistant.id === 'string'
      ? (context.idMap.assistants[assistant.id] ?? ownerId)
      : ownerId;
  return { ...assistant, id: assistant.id ? mappedId : assistant.id };
};

const requireDraftRecord = (
  value: Record<string, unknown>,
  index: number,
  context: WorkspaceArchiveProviderImportContext,
): WorkspaceDraftArchiveRecord => {
  const kind = value.kind;
  const ownerId = value.ownerId;
  const sourceId = value.id;
  const updatedAt = value.updatedAt;
  if (
    (kind !== 'chat' && kind !== 'assistant') ||
    typeof ownerId !== 'string' ||
    ownerId.length === 0 ||
    typeof sourceId !== 'string' ||
    sourceId.length === 0 ||
    typeof updatedAt !== 'number' ||
    !Number.isFinite(updatedAt) ||
    value.schemaVersion !== 1 ||
    !isWorkspaceDraftValue(kind, value.value)
  ) {
    throw new Error(`Workspace draft archive record ${index + 1} has an invalid shape.`);
  }

  const mappedOwnerId = remapOwnerId(ownerId, context);
  const mappedValue = remapDraftValue(kind, value.value, mappedOwnerId, context);
  return {
    schemaVersion: 1,
    kind,
    ownerId: mappedOwnerId,
    value: mappedValue,
    updatedAt,
    // Keep the provider/source identifier intact here. The generic archive
    // walker may already have replaced this with the planned target ID before
    // the provider is invoked; importRecords resolves both shapes against the
    // same providerRecords map instead of deriving a new ID from ownerId.
    id: sourceId,
  } as WorkspaceDraftArchiveRecord;
};

const makeUniqueTargetId = (id: string, existingIds: Set<string>, usedIds: Set<string>): string => {
  if (!existingIds.has(id) && !usedIds.has(id)) {
    return id;
  }
  let candidate = `${id}-copy`;
  let suffix = 2;
  while (existingIds.has(candidate) || usedIds.has(candidate)) {
    candidate = `${id}-copy-${suffix}`;
    suffix += 1;
  }
  return candidate;
};

const withTargetId = (
  record: WorkspaceDraftArchiveRecord,
  targetId: string,
  targetOwnerId = record.ownerId,
): WorkspaceDraftArchiveRecord => {
  const value =
    record.kind === 'assistant' &&
    isRecord(record.value) &&
    typeof record.value.id === 'string' &&
    record.value.id.length > 0
      ? { ...record.value, id: targetOwnerId }
      : record.value;
  return { ...record, id: targetId, ownerId: targetOwnerId, value };
};

export const createWorkspaceDraftArchiveProvider = (
  dependencies: WorkspaceDraftArchiveProviderDependencies = {},
): WorkspaceArchiveProvider => {
  const store = dependencies.store ?? defaultStore;

  return {
    category: 'drafts',

    async exportRecords(
      context: WorkspaceArchiveProviderExportContext = {},
    ): Promise<WorkspaceDraftArchiveRecord[]> {
      // The workspace operation flusher has already drained normal writes. The
      // token is still forwarded to keep this read operation tied to the
      // active barrier in stores that enforce token-scoped raw access.
      const entries = store.listEntries({
        includeHidden: false,
        operationToken: context.operationToken,
      });
      return entries.map(entry => ({ ...entry, id: entry.id }));
    },

    async importRecords(
      records: unknown[] | Record<string, unknown>,
      context: WorkspaceArchiveProviderImportContext,
    ) {
      if (context.visibility !== 'hidden') {
        throw new Error('Workspace draft archive imports must stage records as hidden.');
      }
      const importId = getImportId(context);
      const parsed = asRecords(records).map((record, index) =>
        requireDraftRecord(record, index, context),
      );
      const existingIds = new Set(
        store
          .listEntries({
            includeHidden: true,
            operationToken: context.operationToken,
          })
          .map(entry => entry.id),
      );
      const existingOwners = new Set(
        store
          .listEntries({
            includeHidden: true,
            operationToken: context.operationToken,
          })
          .map(entry => `${entry.kind}:${entry.ownerId}`),
      );
      const usedIds = new Set<string>();
      const usedOwners = new Set<string>();
      const providerRecordMap = context.idMap.providerRecords.drafts ?? {};
      const staged = parsed.map(record => {
        const mappedId =
          providerRecordMap[record.id] ??
          Object.entries(providerRecordMap).find(([, targetId]) => targetId === record.id)?.[1] ??
          buildWorkspaceDraftArchiveEntryId(record);
        const targetId = makeUniqueTargetId(mappedId, existingIds, usedIds);
        usedIds.add(targetId);
        let targetOwnerId = record.ownerId;
        let ownerKey = `${record.kind}:${targetOwnerId}`;
        if (existingOwners.has(ownerKey) || usedOwners.has(ownerKey)) {
          let suffix = 1;
          do {
            const suffixLabel = suffix === 1 ? '-copy' : `-copy-${suffix}`;
            targetOwnerId = `${record.ownerId}${suffixLabel}`;
            ownerKey = `${record.kind}:${targetOwnerId}`;
            suffix += 1;
          } while (existingOwners.has(ownerKey) || usedOwners.has(ownerKey));
        }
        usedOwners.add(ownerKey);
        return withTargetId(record, targetId, targetOwnerId);
      });

      if (staged.length > 0) {
        const createdIds = staged.map(entry => entry.id);
        // Register planned IDs before mutating durable storage. If staging
        // partially writes and then throws, the archive journal still has the
        // exact ownership set needed for rollback.
        context.registerCreatedIds(createdIds);
        store.stageEntries(staged, importId, context.operationToken);
        return {
          createdIds,
          metadata: { draftCount: staged.length },
        };
      }

      return { createdIds: [], metadata: { draftCount: 0 } };
    },

    async publishImportedRecords(ids, context) {
      const importId = getImportId(context);
      store.publishEntries(ids, importId, context.operationToken);
    },

    async removeImportedRecords(ids, context) {
      const importId = getImportId(context);
      store.removeEntries(ids, importId, context.operationToken);
    },

    async listExistingIds(context = {}) {
      return store
        .listEntries({ includeHidden: true, operationToken: context.operationToken })
        .map(entry => entry.id);
    },
  };
};

/** Production provider instance; root archive setup owns registration. */
export const workspaceDraftArchiveProvider = createWorkspaceDraftArchiveProvider();
