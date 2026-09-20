import type {
  Assistant,
  ChatMessage,
  ChatSession,
  OriginalHistoryMetadata,
  RagChunk,
} from '../types';
import {
  isWorkspaceOperationTokenActive,
  registerWorkspaceOperationFlusher,
  withWorkspaceWrite,
  type WorkspaceOperationToken,
} from './workspaceOperationService';

/**
 * Versioned, local-only draft storage shared by chat and assistant editors.
 *
 * Drafts intentionally use localStorage rather than the application database:
 * they are transient working copies, must be available synchronously while a
 * React editor is hydrating, and should remain recoverable when IndexedDB is
 * unavailable. The service still exposes structured export/import functions so
 * the workspace archive can include drafts without knowing the storage format.
 */

export const WORKSPACE_DRAFT_STORAGE_KEY = 'educare.workspace-drafts.v1';
export const LEGACY_CHAT_DRAFT_STORAGE_KEY = 'educare.chat-drafts.v1';
export const WORKSPACE_DRAFT_SCHEMA_VERSION = 1 as const;
export const WORKSPACE_DRAFT_SAVE_DELAY_MS = 500;
export const WORKSPACE_DRAFT_ARCHIVE_IMPORT_ID_FIELD = '__educareWorkspaceArchiveImportId';

export type WorkspaceDraftKind = 'chat' | 'assistant';
export type DraftPersistenceMode = 'persistent' | 'session';
export type WorkspaceDraftVisibility = 'visible' | 'hidden';

export interface WorkspaceDraftEntry<T = unknown> {
  schemaVersion: typeof WORKSPACE_DRAFT_SCHEMA_VERSION;
  kind: WorkspaceDraftKind;
  ownerId: string;
  value: T;
  updatedAt: number;
  /** Provider-owned identifier used by workspace archive staging/rollback. */
  id?: string;
  /** Hidden rows remain durable but are invisible to normal draft reads/exports. */
  visibility?: WorkspaceDraftVisibility;
  [WORKSPACE_DRAFT_ARCHIVE_IMPORT_ID_FIELD]?: string;
}

export interface WorkspaceDraftArchiveEntry<T = unknown> extends WorkspaceDraftEntry<T> {
  id: string;
}

export interface WorkspaceDraftArchive {
  format: 'educare-workspace-drafts';
  schemaVersion: typeof WORKSPACE_DRAFT_SCHEMA_VERSION;
  exportedAt: number;
  entries: WorkspaceDraftEntry[];
}

export interface WorkspaceDraftReadResult<T = unknown> {
  value: T | undefined;
  mode: DraftPersistenceMode;
  updatedAt?: number;
}

export interface WorkspaceDraftImportResult {
  imported: number;
  skipped: number;
  mode: DraftPersistenceMode;
}

export interface WorkspaceDraftStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

type StoredDraftMap = Record<string, string>;

const memoryDrafts = new Map<string, { value: unknown | null; updatedAt: number }>();

const draftKey = (kind: WorkspaceDraftKind, ownerId: string): string => `${kind}:${ownerId}`;

const isDraftKind = (value: unknown): value is WorkspaceDraftKind =>
  value === 'chat' || value === 'assistant';

const isRagChunk = (value: unknown): value is RagChunk => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<RagChunk>;
  return (
    typeof candidate.fileName === 'string' &&
    typeof candidate.content === 'string' &&
    (candidate.vector === undefined ||
      (Array.isArray(candidate.vector) &&
        candidate.vector.every(item => typeof item === 'number'))) &&
    (candidate.relevanceScore === undefined ||
      (typeof candidate.relevanceScore === 'number' && Number.isFinite(candidate.relevanceScore)))
  );
};

/** Runtime validation for assistant drafts crossing the local archive boundary. */
export const isAssistantWorkspaceDraft = (value: unknown): value is Assistant => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<Assistant>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.description === 'string' &&
    typeof candidate.systemPrompt === 'string' &&
    typeof candidate.createdAt === 'number' &&
    Number.isFinite(candidate.createdAt) &&
    Array.isArray(candidate.ragChunks) &&
    candidate.ragChunks.every(isRagChunk) &&
    Array.isArray(candidate.starterPrompts) &&
    candidate.starterPrompts.every(prompt => typeof prompt === 'string') &&
    (candidate.isPinned === undefined || typeof candidate.isPinned === 'boolean') &&
    (candidate.category === undefined || typeof candidate.category === 'string') &&
    (candidate.lastOpenedAt === undefined ||
      (typeof candidate.lastOpenedAt === 'number' && Number.isFinite(candidate.lastOpenedAt))) &&
    (candidate.isShared === undefined || typeof candidate.isShared === 'boolean') &&
    (candidate.subagentDelegationEnabled === undefined ||
      typeof candidate.subagentDelegationEnabled === 'boolean') &&
    (candidate.mathToolsEnabled === undefined || typeof candidate.mathToolsEnabled === 'boolean') &&
    (candidate.webSpeechToolsEnabled === undefined ||
      typeof candidate.webSpeechToolsEnabled === 'boolean') &&
    (candidate.routableAssistantIds === undefined ||
      (Array.isArray(candidate.routableAssistantIds) &&
        candidate.routableAssistantIds.every(id => typeof id === 'string')))
  );
};

/** Validate values independently of their draft kind before reading/importing them. */
export const isWorkspaceDraftValue = (
  kind: WorkspaceDraftKind,
  value: unknown,
): value is string | Assistant =>
  kind === 'chat' ? typeof value === 'string' : isAssistantWorkspaceDraft(value);

const isDraftEntry = (value: unknown): value is WorkspaceDraftEntry => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Partial<WorkspaceDraftEntry>;
  const importId = candidate[WORKSPACE_DRAFT_ARCHIVE_IMPORT_ID_FIELD];
  return (
    candidate.schemaVersion === WORKSPACE_DRAFT_SCHEMA_VERSION &&
    isDraftKind(candidate.kind) &&
    typeof candidate.ownerId === 'string' &&
    candidate.ownerId.length > 0 &&
    'value' in candidate &&
    isWorkspaceDraftValue(candidate.kind, candidate.value) &&
    typeof candidate.updatedAt === 'number' &&
    Number.isFinite(candidate.updatedAt) &&
    (candidate.id === undefined || (typeof candidate.id === 'string' && candidate.id.length > 0)) &&
    (candidate.visibility === undefined ||
      candidate.visibility === 'visible' ||
      candidate.visibility === 'hidden') &&
    (importId === undefined || (typeof importId === 'string' && importId.length > 0)) &&
    (candidate.visibility !== 'hidden' || typeof importId === 'string')
  );
};

const isHiddenDraftEntry = (entry: WorkspaceDraftEntry): boolean => entry.visibility === 'hidden';

const getStorage = (): WorkspaceDraftStorage | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const storage = window.localStorage;
    if (
      storage &&
      typeof storage.getItem === 'function' &&
      typeof storage.setItem === 'function' &&
      typeof storage.removeItem === 'function'
    ) {
      return storage;
    }
  } catch {
    // Private browsing and embedded previews can throw while reading storage.
  }

  return null;
};

const parseStoredValue = (raw: string | null): unknown => {
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
};

const normalizeEntries = (value: unknown): WorkspaceDraftEntry[] => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }

  const entries = (value as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries.filter(isDraftEntry);
};

const normalizeLegacyChatDrafts = (value: unknown): StoredDraftMap => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter(([, draft]) => typeof draft === 'string'),
  ) as StoredDraftMap;
};

const readStorageValue = (
  storage: WorkspaceDraftStorage,
  key: string,
): { value: unknown; mode: DraftPersistenceMode } => {
  try {
    const raw = storage.getItem(key);
    if (raw === null) {
      return { value: null, mode: 'persistent' };
    }
    const parsed = parseStoredValue(raw);
    return {
      value: parsed,
      mode: parsed === null && raw.trim() !== 'null' ? 'session' : 'persistent',
    };
  } catch {
    return { value: null, mode: 'session' };
  }
};

const readStoredEntries = (): {
  entries: WorkspaceDraftEntry[];
  mode: DraftPersistenceMode;
} => {
  const storage = getStorage();
  if (!storage) {
    return { entries: [], mode: 'session' };
  }

  const { value, mode } = readStorageValue(storage, WORKSPACE_DRAFT_STORAGE_KEY);
  const entries = normalizeEntries(value);
  if (entries.length > 0) {
    return { entries, mode };
  }

  // A plain object is the pre-service chat-draft format. Treat it as a legacy
  // source as well; this also keeps old drafts readable during a one-release
  // migration window.
  const legacyInNewKey = normalizeLegacyChatDrafts(value);
  if (Object.keys(legacyInNewKey).length > 0) {
    return {
      entries: Object.entries(legacyInNewKey).map(([ownerId, draft]) => ({
        schemaVersion: WORKSPACE_DRAFT_SCHEMA_VERSION,
        kind: 'chat',
        ownerId,
        value: draft,
        updatedAt: 0,
      })),
      mode,
    };
  }

  return { entries: [], mode };
};

const readLegacyChatDrafts = (): {
  drafts: StoredDraftMap;
  mode: DraftPersistenceMode;
} => {
  const storage = getStorage();
  if (!storage) {
    return { drafts: {}, mode: 'session' };
  }

  const { value, mode } = readStorageValue(storage, LEGACY_CHAT_DRAFT_STORAGE_KEY);
  return { drafts: normalizeLegacyChatDrafts(value), mode };
};

const mergeEntries = (
  entries: WorkspaceDraftEntry[],
  replacements: WorkspaceDraftEntry[],
): WorkspaceDraftEntry[] => {
  const byKey = new Map(entries.map(entry => [draftKey(entry.kind, entry.ownerId), entry]));
  replacements.forEach(entry => byKey.set(draftKey(entry.kind, entry.ownerId), entry));
  return [...byKey.values()].sort((left, right) => left.updatedAt - right.updatedAt);
};

const persistEntries = (entries: WorkspaceDraftEntry[]): DraftPersistenceMode => {
  const storage = getStorage();
  if (!storage) {
    return 'session';
  }

  try {
    if (entries.length === 0) {
      storage.removeItem(WORKSPACE_DRAFT_STORAGE_KEY);
    } else {
      storage.setItem(
        WORKSPACE_DRAFT_STORAGE_KEY,
        JSON.stringify({
          schemaVersion: WORKSPACE_DRAFT_SCHEMA_VERSION,
          entries,
        }),
      );
    }
    return 'persistent';
  } catch {
    return 'session';
  }
};

const originalMessageKey = (message: ChatMessage): string => JSON.stringify(message);

const appendOriginalMessages = (
  existing: ChatMessage[],
  incoming: ChatMessage[],
): ChatMessage[] => {
  if (existing.length === 0) {
    return [...incoming];
  }
  if (incoming.length === 0) {
    return [...existing];
  }

  // The compact provider history is an overlapping window of the full history.
  // Match only its longest suffix/prefix overlap rather than de-duplicating by a
  // global Set: two legacy turns can be byte-for-byte identical and both must survive.
  const maxOverlap = Math.min(existing.length, incoming.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    const existingStart = existing.length - overlap;
    const overlaps = incoming.every(
      (message, index) =>
        index >= overlap ||
        originalMessageKey(existing[existingStart + index]) === originalMessageKey(message),
    );
    if (overlaps) {
      return [...existing, ...incoming.slice(overlap)];
    }
  }

  return [...existing, ...incoming];
};

/** Build full-history metadata without inventing messages discarded by legacy compaction. */
export const buildOriginalHistoryMetadata = (session: ChatSession): OriginalHistoryMetadata => {
  const existing = session.originalHistory;
  const legacyCompaction = Boolean(session.compactContext && !existing);
  const messages = appendOriginalMessages(existing?.messages ?? [], session.messages);
  const unrecoverableMessageCount =
    existing?.unrecoverableMessageCount ??
    (legacyCompaction ? session.compactContext?.compressedFromMessages : undefined);

  return {
    schemaVersion: 1,
    messages,
    completeness: existing?.completeness ?? (legacyCompaction ? 'unrecoverable' : 'complete'),
    ...(unrecoverableMessageCount !== undefined ? { unrecoverableMessageCount } : {}),
  };
};

/** Load/export migration helper for sessions created before originalHistory existed. */
export const ensureOriginalHistoryMetadata = (session: ChatSession): ChatSession => ({
  ...session,
  originalHistory: buildOriginalHistoryMetadata(session),
});

const rememberInMemory = (key: string, value: unknown | null, updatedAt = Date.now()): void => {
  memoryDrafts.set(key, { value, updatedAt });
};

const clearInMemory = (key: string): void => {
  memoryDrafts.delete(key);
};

const requireActiveOperationToken = (operationToken: WorkspaceOperationToken): void => {
  if (!isWorkspaceOperationTokenActive(operationToken)) {
    throw new Error('Workspace draft raw access requires an active operation token.');
  }
};

/** Build the stable owner id used by chat draft entries. */
export const buildChatDraftOwnerId = (assistantId: string, sessionId: string): string =>
  `${assistantId}:${sessionId}`;

/** Build the stable owner id used by assistant editor entries. */
export const buildAssistantDraftOwnerId = (assistantId?: string | null): string =>
  assistantId || 'new-assistant';

export const readWorkspaceDraft = <T = unknown>(
  kind: WorkspaceDraftKind,
  ownerId: string,
): WorkspaceDraftReadResult<T> => {
  const key = draftKey(kind, ownerId);
  const memory = memoryDrafts.get(key);
  if (memory) {
    return {
      value: memory.value === null ? undefined : (memory.value as T),
      mode: 'session',
      updatedAt: memory.updatedAt,
    };
  }

  const stored = readStoredEntries();
  const entry = stored.entries.find(
    item => !isHiddenDraftEntry(item) && draftKey(item.kind, item.ownerId) === key,
  );
  if (entry) {
    return { value: entry.value as T, mode: stored.mode, updatedAt: entry.updatedAt };
  }

  if (kind === 'chat') {
    const legacy = readLegacyChatDrafts();
    const legacyValue = legacy.drafts[ownerId];
    if (legacyValue !== undefined) {
      return { value: legacyValue as T, mode: legacy.mode, updatedAt: 0 };
    }
    // Legacy reads used the same `assistantId:sessionId` owner id, so accept
    // the value returned by a storage implementation that aliases the keys.
  }

  return { value: undefined, mode: stored.mode };
};

const writeWorkspaceDraftRaw = <T = unknown>(
  kind: WorkspaceDraftKind,
  ownerId: string,
  value: T,
  updatedAt = Date.now(),
): DraftPersistenceMode => {
  if (!isWorkspaceDraftValue(kind, value)) {
    return 'session';
  }

  const key = draftKey(kind, ownerId);
  const entry: WorkspaceDraftEntry<T> = {
    schemaVersion: WORKSPACE_DRAFT_SCHEMA_VERSION,
    kind,
    ownerId,
    value,
    updatedAt,
  };

  const stored = readStoredEntries();
  const visibleEntries = stored.entries.filter(entry => !isHiddenDraftEntry(entry));
  const hiddenEntries = stored.entries.filter(isHiddenDraftEntry);
  const mode = persistEntries([...hiddenEntries, ...mergeEntries(visibleEntries, [entry])]);
  if (mode === 'persistent') {
    clearInMemory(key);
  } else {
    rememberInMemory(key, value, updatedAt);
  }
  return mode;
};

/**
 * Synchronous compatibility API for callers that already own a local write.
 * UI debounce/leave paths should use writeWorkspaceDraftAsync so archive
 * operations can pause and drain them through the workspace barrier.
 */
export const writeWorkspaceDraft = <T = unknown>(
  kind: WorkspaceDraftKind,
  ownerId: string,
  value: T,
  updatedAt = Date.now(),
): DraftPersistenceMode => writeWorkspaceDraftRaw(kind, ownerId, value, updatedAt);

/** Normal draft writes participate in the workspace write barrier. */
export const writeWorkspaceDraftAsync = <T = unknown>(
  kind: WorkspaceDraftKind,
  ownerId: string,
  value: T,
  updatedAt = Date.now(),
): Promise<DraftPersistenceMode> =>
  withWorkspaceWrite(async () => writeWorkspaceDraftRaw(kind, ownerId, value, updatedAt));

/** Raw draft write for the active archive operation's opaque capability. */
export const writeWorkspaceDraftWithOperationToken = <T = unknown>(
  operationToken: WorkspaceOperationToken,
  kind: WorkspaceDraftKind,
  ownerId: string,
  value: T,
  updatedAt = Date.now(),
): DraftPersistenceMode => {
  requireActiveOperationToken(operationToken);
  return writeWorkspaceDraftRaw(kind, ownerId, value, updatedAt);
};

const clearWorkspaceDraftRaw = (
  kind: WorkspaceDraftKind,
  ownerId: string,
): DraftPersistenceMode => {
  const key = draftKey(kind, ownerId);
  // Set a tombstone before touching storage so a failed clear cannot resurrect
  // an older durable value on the next render.
  rememberInMemory(key, null);
  const stored = readStoredEntries();
  const remaining = stored.entries.filter(
    entry => isHiddenDraftEntry(entry) || draftKey(entry.kind, entry.ownerId) !== key,
  );
  const mode = persistEntries(remaining);
  const storage = getStorage();

  try {
    if (storage && kind === 'chat') {
      const legacy = readLegacyChatDrafts().drafts;
      if (Object.prototype.hasOwnProperty.call(legacy, ownerId)) {
        delete legacy[ownerId];
        if (Object.keys(legacy).length === 0) {
          storage.removeItem(LEGACY_CHAT_DRAFT_STORAGE_KEY);
        } else {
          storage.setItem(LEGACY_CHAT_DRAFT_STORAGE_KEY, JSON.stringify(legacy));
        }
      }
    }
  } catch {
    return 'session';
  }

  if (mode === 'persistent') {
    clearInMemory(key);
  }
  return mode;
};

export const clearWorkspaceDraft = (
  kind: WorkspaceDraftKind,
  ownerId: string,
): DraftPersistenceMode => clearWorkspaceDraftRaw(kind, ownerId);

/** Raw draft clear for an active archive operation's opaque capability. */
export const clearWorkspaceDraftWithOperationToken = (
  operationToken: WorkspaceOperationToken,
  kind: WorkspaceDraftKind,
  ownerId: string,
): DraftPersistenceMode => {
  requireActiveOperationToken(operationToken);
  return clearWorkspaceDraftRaw(kind, ownerId);
};

/** Normal draft clears participate in the workspace write barrier. */
export const clearWorkspaceDraftAsync = (
  kind: WorkspaceDraftKind,
  ownerId: string,
): Promise<DraftPersistenceMode> =>
  withWorkspaceWrite(async () => clearWorkspaceDraftRaw(kind, ownerId));

export const exportWorkspaceDrafts = (): WorkspaceDraftArchive => {
  const stored = readStoredEntries();
  const tombstones = new Set(
    [...memoryDrafts.entries()].filter(([, draft]) => draft.value === null).map(([key]) => key),
  );
  const entries = stored.entries.filter(
    entry => !isHiddenDraftEntry(entry) && !tombstones.has(draftKey(entry.kind, entry.ownerId)),
  );
  const byKey = new Set(entries.map(entry => draftKey(entry.kind, entry.ownerId)));

  const legacy = readLegacyChatDrafts().drafts;
  Object.entries(legacy).forEach(([ownerId, value]) => {
    const key = draftKey('chat', ownerId);
    if (!tombstones.has(key) && !byKey.has(key)) {
      entries.push({
        schemaVersion: WORKSPACE_DRAFT_SCHEMA_VERSION,
        kind: 'chat',
        ownerId,
        value,
        updatedAt: 0,
      });
    }
  });

  memoryDrafts.forEach((draft, key) => {
    const separator = key.indexOf(':');
    const kind = key.slice(0, separator);
    const ownerId = key.slice(separator + 1);
    if (!isDraftKind(kind) || draft.value === null) {
      return;
    }
    const index = entries.findIndex(entry => draftKey(entry.kind, entry.ownerId) === key);
    const entry: WorkspaceDraftEntry = {
      schemaVersion: WORKSPACE_DRAFT_SCHEMA_VERSION,
      kind,
      ownerId,
      value: draft.value,
      updatedAt: draft.updatedAt,
    };
    if (index === -1) {
      entries.push(entry);
    } else {
      entries[index] = entry;
    }
  });

  return {
    format: 'educare-workspace-drafts',
    schemaVersion: WORKSPACE_DRAFT_SCHEMA_VERSION,
    exportedAt: Date.now(),
    entries: entries.sort((left, right) => left.updatedAt - right.updatedAt),
  };
};

export const buildWorkspaceDraftArchiveEntryId = (
  entry: Pick<WorkspaceDraftEntry, 'kind' | 'ownerId'>,
): string => `${entry.kind}:${entry.ownerId}`;

const asArchiveEntry = (entry: WorkspaceDraftEntry): WorkspaceDraftArchiveEntry => ({
  ...entry,
  id: entry.id ?? buildWorkspaceDraftArchiveEntryId(entry),
});

/**
 * Return provider-shaped draft rows. Hidden rows are intentionally opt-in so
 * normal UI reads and exports cannot expose an incomplete archive import.
 */
export const listWorkspaceDraftArchiveEntries = (
  options: {
    includeHidden?: boolean;
    operationToken?: WorkspaceOperationToken;
  } = {},
): WorkspaceDraftArchiveEntry[] => {
  if (options.operationToken !== undefined) {
    requireActiveOperationToken(options.operationToken);
  }
  const visible = exportWorkspaceDrafts().entries.map(asArchiveEntry);
  if (!options.includeHidden) {
    return visible;
  }

  const hidden = readStoredEntries().entries.filter(isHiddenDraftEntry).map(asArchiveEntry);
  return [...visible, ...hidden].sort((left, right) => left.updatedAt - right.updatedAt);
};

const persistArchiveEntries = (
  entries: WorkspaceDraftEntry[],
  operationToken: WorkspaceOperationToken,
): DraftPersistenceMode => {
  requireActiveOperationToken(operationToken);
  const mode = persistEntries(entries);
  if (mode !== 'persistent') {
    throw new Error('Workspace draft archive staging requires persistent storage.');
  }
  return mode;
};

const archiveEntryWithoutVisibility = (entry: WorkspaceDraftEntry): WorkspaceDraftEntry => {
  const visibleEntry = { ...entry };
  delete visibleEntry.visibility;
  delete visibleEntry[WORKSPACE_DRAFT_ARCHIVE_IMPORT_ID_FIELD];
  return visibleEntry;
};

/** Durable hidden staging used by the workspace archive provider. */
export const stageWorkspaceDraftArchiveEntries = (
  entries: WorkspaceDraftArchiveEntry[],
  importId: string,
  operationToken: WorkspaceOperationToken,
): DraftPersistenceMode => {
  requireActiveOperationToken(operationToken);
  if (!importId.trim()) {
    throw new Error('Workspace draft archive staging requires an importId.');
  }

  const normalized = entries.map(entry => ({ ...entry, id: entry.id ?? '' }));
  const ids = new Set<string>();
  const owners = new Set<string>();
  for (const entry of normalized) {
    if (!isDraftEntry(entry) || !entry.id) {
      throw new Error('Workspace draft archive entry has an invalid shape.');
    }
    if (ids.has(entry.id)) {
      throw new Error(`Workspace draft archive repeats identifier ${entry.id}.`);
    }
    const ownerKey = draftKey(entry.kind, entry.ownerId);
    if (owners.has(ownerKey)) {
      throw new Error(`Workspace draft archive repeats owner ${ownerKey}.`);
    }
    ids.add(entry.id);
    owners.add(ownerKey);
  }

  const current = readStoredEntries().entries;
  for (const entry of normalized) {
    const ownerKey = draftKey(entry.kind, entry.ownerId);
    const ownerConflict = current.find(item => draftKey(item.kind, item.ownerId) === ownerKey);
    if (
      ownerConflict &&
      !(
        isHiddenDraftEntry(ownerConflict) &&
        ownerConflict[WORKSPACE_DRAFT_ARCHIVE_IMPORT_ID_FIELD] === importId
      )
    ) {
      throw new Error(`Workspace draft archive owner already exists: ${ownerKey}.`);
    }
    const idConflict = current.find(item => item.id === entry.id);
    if (idConflict && idConflict[WORKSPACE_DRAFT_ARCHIVE_IMPORT_ID_FIELD] !== importId) {
      throw new Error(`Workspace draft archive identifier already exists: ${entry.id}.`);
    }
  }

  const stagedEntries = normalized.map(entry => ({
    ...entry,
    visibility: 'hidden' as const,
    [WORKSPACE_DRAFT_ARCHIVE_IMPORT_ID_FIELD]: importId,
  }));
  const replaced = current.filter(
    entry =>
      !(
        entry[WORKSPACE_DRAFT_ARCHIVE_IMPORT_ID_FIELD] === importId &&
        (ids.has(entry.id ?? '') || owners.has(draftKey(entry.kind, entry.ownerId)))
      ),
  );
  return persistArchiveEntries([...replaced, ...stagedEntries], operationToken);
};

/** Publish only rows owned by this import; never reveal another import's rows. */
export const publishWorkspaceDraftArchiveEntries = (
  ids: string[],
  importId: string,
  operationToken: WorkspaceOperationToken,
): DraftPersistenceMode => {
  requireActiveOperationToken(operationToken);
  const idSet = new Set(ids);
  const current = readStoredEntries().entries;
  const owned = current.filter(
    entry =>
      idSet.has(entry.id ?? '') &&
      isHiddenDraftEntry(entry) &&
      entry[WORKSPACE_DRAFT_ARCHIVE_IMPORT_ID_FIELD] === importId,
  );
  if (owned.length !== idSet.size) {
    throw new Error('Workspace draft archive publish ownership could not be proven.');
  }
  const next = current.map(entry =>
    owned.some(item => item.id === entry.id) ? archiveEntryWithoutVisibility(entry) : entry,
  );
  const mode = persistArchiveEntries(next, operationToken);
  if (mode === 'persistent') {
    owned.forEach(entry => clearInMemory(draftKey(entry.kind, entry.ownerId)));
  }
  return mode;
};

/** Remove only hidden rows tagged by this import, preserving pre-existing drafts. */
export const removeWorkspaceDraftArchiveEntries = (
  ids: string[],
  importId: string,
  operationToken: WorkspaceOperationToken,
): DraftPersistenceMode => {
  requireActiveOperationToken(operationToken);
  const idSet = new Set(ids);
  const current = readStoredEntries().entries;
  const next = current.filter(
    entry =>
      !(
        idSet.has(entry.id ?? '') &&
        isHiddenDraftEntry(entry) &&
        entry[WORKSPACE_DRAFT_ARCHIVE_IMPORT_ID_FIELD] === importId
      ),
  );
  return persistArchiveEntries(next, operationToken);
};

const flushWorkspaceDraftMemoryRaw = (): DraftPersistenceMode => {
  const stored = readStoredEntries();
  const tombstones = new Set(
    [...memoryDrafts.entries()].filter(([, draft]) => draft.value === null).map(([key]) => key),
  );
  const hiddenEntries = stored.entries.filter(isHiddenDraftEntry);
  const visibleEntries = stored.entries.filter(
    entry => !isHiddenDraftEntry(entry) && !tombstones.has(draftKey(entry.kind, entry.ownerId)),
  );
  const memoryEntries: WorkspaceDraftEntry[] = [];
  memoryDrafts.forEach((draft, key) => {
    if (draft.value === null) {
      return;
    }
    const separator = key.indexOf(':');
    const kind = key.slice(0, separator);
    const ownerId = key.slice(separator + 1);
    if (!isDraftKind(kind) || !isWorkspaceDraftValue(kind, draft.value)) {
      return;
    }
    memoryEntries.push({
      schemaVersion: WORKSPACE_DRAFT_SCHEMA_VERSION,
      kind,
      ownerId,
      value: draft.value,
      updatedAt: draft.updatedAt,
    });
  });
  const mode = persistEntries([...hiddenEntries, ...mergeEntries(visibleEntries, memoryEntries)]);
  if (mode !== 'persistent') {
    return mode;
  }

  const storage = getStorage();
  if (storage) {
    try {
      const legacy = readLegacyChatDrafts().drafts;
      let legacyChanged = false;
      tombstones.forEach(key => {
        if (!key.startsWith('chat:')) {
          return;
        }
        const ownerId = key.slice('chat:'.length);
        if (Object.prototype.hasOwnProperty.call(legacy, ownerId)) {
          delete legacy[ownerId];
          legacyChanged = true;
        }
      });
      if (legacyChanged) {
        if (Object.keys(legacy).length === 0) {
          storage.removeItem(LEGACY_CHAT_DRAFT_STORAGE_KEY);
        } else {
          storage.setItem(LEGACY_CHAT_DRAFT_STORAGE_KEY, JSON.stringify(legacy));
        }
      }
    } catch {
      return 'session';
    }
  }

  memoryDrafts.clear();
  return mode;
};

/** Flush memory fallbacks through the active archive operation capability. */
export const flushWorkspaceDraftForOperation = (
  operationToken: WorkspaceOperationToken,
): DraftPersistenceMode => {
  requireActiveOperationToken(operationToken);
  return flushWorkspaceDraftMemoryRaw();
};

/**
 * Persist the current value immediately for session switches/pagehide, or
 * flush all memory fallbacks when passed an active archive operation token.
 * The legacy four-argument shape remains supported for existing callers.
 */
export const flushWorkspaceDraft = <T = unknown>(
  first?: WorkspaceOperationToken | WorkspaceDraftKind,
  ownerId?: string,
  value?: T,
  updatedAt = Date.now(),
): DraftPersistenceMode => {
  if (first === undefined || typeof first === 'symbol') {
    return first === undefined
      ? flushWorkspaceDraftMemoryRaw()
      : flushWorkspaceDraftForOperation(first);
  }
  if (ownerId === undefined) {
    throw new Error('Workspace draft flush requires an ownerId.');
  }
  return writeWorkspaceDraftRaw(first, ownerId, value, updatedAt);
};

/** Register the draft flusher once; root archive setup may call this again safely. */
export const registerWorkspaceDraftOperationFlusher = (): (() => void) =>
  registerWorkspaceOperationFlusher(operationToken => {
    flushWorkspaceDraftForOperation(operationToken);
  });

const validateArchive = (archive: unknown): archive is WorkspaceDraftArchive => {
  if (!archive || typeof archive !== 'object' || Array.isArray(archive)) {
    return false;
  }
  const candidate = archive as Partial<WorkspaceDraftArchive>;
  return (
    candidate.format === 'educare-workspace-drafts' &&
    candidate.schemaVersion === WORKSPACE_DRAFT_SCHEMA_VERSION &&
    Array.isArray(candidate.entries)
  );
};

export const importWorkspaceDrafts = (
  archive: unknown,
  options: { replace?: boolean } = {},
): WorkspaceDraftImportResult => {
  if (!validateArchive(archive)) {
    throw new Error('Invalid workspace draft archive.');
  }

  const importedEntries = archive.entries
    .filter(isDraftEntry)
    .map(entry => archiveEntryWithoutVisibility(entry));
  const skipped = archive.entries.length - importedEntries.length;
  const stored = readStoredEntries();
  const legacy = readLegacyChatDrafts().drafts;
  const previousKeys = new Set([
    ...stored.entries
      .filter(entry => !isHiddenDraftEntry(entry))
      .map(entry => draftKey(entry.kind, entry.ownerId)),
    ...Object.keys(legacy).map(ownerId => draftKey('chat', ownerId)),
    ...memoryDrafts.keys(),
  ]);
  const hiddenEntries = stored.entries.filter(isHiddenDraftEntry);
  const visibleEntries = stored.entries.filter(entry => !isHiddenDraftEntry(entry));
  const nextEntries = options.replace
    ? [...hiddenEntries, ...importedEntries]
    : [...hiddenEntries, ...mergeEntries(visibleEntries, importedEntries)];
  let mode = persistEntries(nextEntries);

  if (options.replace) {
    const storage = getStorage();
    let legacyCleared = true;
    if (storage) {
      try {
        storage.removeItem(LEGACY_CHAT_DRAFT_STORAGE_KEY);
      } catch {
        legacyCleared = false;
      }
    } else if (Object.keys(legacy).length > 0) {
      legacyCleared = false;
    }

    if (!legacyCleared) {
      mode = 'session';
    }

    memoryDrafts.clear();
    if (mode === 'session') {
      const importedKeys = new Set(
        importedEntries.map(entry => draftKey(entry.kind, entry.ownerId)),
      );
      previousKeys.forEach(key => {
        if (!importedKeys.has(key)) {
          rememberInMemory(key, null);
        }
      });
    }
  }

  importedEntries.forEach(entry => {
    const key = draftKey(entry.kind, entry.ownerId);
    if (mode === 'persistent') {
      clearInMemory(key);
    } else {
      rememberInMemory(key, entry.value, entry.updatedAt);
    }
  });

  return {
    imported: importedEntries.length,
    skipped,
    mode,
  };
};

/** Test-only reset; production callers should clear individual owners. */
export const resetWorkspaceDraftMemory = (): void => {
  memoryDrafts.clear();
};

// Archive operations must flush draft fallbacks after draining normal writes
// and before taking a cross-store snapshot. The registration is intentionally
// module-local; root setup only needs to import the provider/service once.
registerWorkspaceDraftOperationFlusher();

// Keep the public type useful to consumers that want to constrain assistant draft values.
export type AssistantWorkspaceDraft = WorkspaceDraftEntry<Assistant>;
