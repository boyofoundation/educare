import type {
  WorkspaceArchiveProvider,
  WorkspaceArchiveProviderImportContext,
  WorkspaceArchiveProviderImportResult,
} from './workspaceArchiveService';
import {
  exportPracticeArchive,
  importPracticeArchive,
  listPracticeArchiveImports,
  listPracticeArchiveRecordIds,
  publishPracticeImportedRecords,
  removePracticeImportedRecords,
  PRACTICE_SCHEMA_VERSION,
  type PracticeArchiveRecords,
  type PracticeArchiveImportOptions,
  type PracticeAttempt,
  type PracticeBookmark,
  type PracticeLesson,
  type PracticeProfile,
} from './practiceWorkspaceService';

type PracticeProviderKind = 'profile' | 'lesson' | 'attempt' | 'bookmark';

interface PracticeProviderRecord {
  id: string;
  sourceId: string;
  kind: PracticeProviderKind;
  value: PracticeProfile | PracticeLesson | PracticeAttempt | PracticeBookmark;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asRows = (records: unknown[] | Record<string, unknown>): PracticeProviderRecord[] => {
  if (!Array.isArray(records)) {
    throw new Error('Practice archive provider requires a record array.');
  }
  return records.map((record, index) => {
    if (
      !isRecord(record) ||
      typeof record.id !== 'string' ||
      record.id.trim().length === 0 ||
      typeof record.sourceId !== 'string' ||
      record.sourceId.trim().length === 0 ||
      (record.kind !== 'profile' &&
        record.kind !== 'lesson' &&
        record.kind !== 'attempt' &&
        record.kind !== 'bookmark') ||
      !isRecord(record.value)
    ) {
      throw new Error(`Malformed practice archive record at index ${index}.`);
    }
    return record as unknown as PracticeProviderRecord;
  });
};

const flattenPracticeArchive = (records: PracticeArchiveRecords): PracticeProviderRecord[] => [
  ...records.profiles.map(record => ({
    id: record.id,
    sourceId: record.id,
    kind: 'profile' as const,
    value: record,
  })),
  ...records.lessons.map(record => ({
    id: record.id,
    sourceId: record.id,
    kind: 'lesson' as const,
    value: record,
  })),
  ...records.attempts.map(record => ({
    id: record.id,
    sourceId: record.id,
    kind: 'attempt' as const,
    value: record,
  })),
  ...records.bookmarks.map(record => ({
    id: record.id,
    sourceId: record.id,
    kind: 'bookmark' as const,
    value: record,
  })),
];

const getPlannedIds = (
  rows: PracticeProviderRecord[],
): NonNullable<PracticeArchiveImportOptions['plannedIds']> => {
  const planned: NonNullable<PracticeArchiveImportOptions['plannedIds']> = {};
  const kinds = {
    profile: 'profiles',
    lesson: 'lessons',
    attempt: 'attempts',
    bookmark: 'bookmarks',
  } as const;
  for (const row of rows) {
    const key = kinds[row.kind];
    planned[key] ??= {};
    planned[key]![row.sourceId] = row.id;
  }
  return planned;
};

const getRecordId = (value: unknown): string | undefined =>
  isRecord(value) && typeof value.id === 'string' ? value.id : undefined;

const ensureSourceId = (row: PracticeProviderRecord): void => {
  const payloadId = getRecordId(row.value);
  if (!payloadId || payloadId !== row.sourceId) {
    throw new Error(`Practice archive record ${row.id} has inconsistent sourceId.`);
  }
};

const validateImportRows = (
  rows: PracticeProviderRecord[],
  plannedProviderIds: Record<string, string> | undefined,
): void => {
  const sourceIds = new Set<string>();
  const destinationIds = new Set<string>();
  for (const row of rows) {
    ensureSourceId(row);
    if (sourceIds.has(row.sourceId)) {
      throw new Error(`Practice archive duplicate source id: ${row.sourceId}.`);
    }
    sourceIds.add(row.sourceId);
    if (destinationIds.has(row.id)) {
      throw new Error(`Practice archive duplicate provider id: ${row.id}.`);
    }
    destinationIds.add(row.id);
  }

  if (!plannedProviderIds) {
    throw new Error('Practice archive import is missing planned provider ids.');
  }
  const plannedDestinationIds = new Set<string>();
  for (const [sourceId, plannedId] of Object.entries(plannedProviderIds)) {
    if (plannedDestinationIds.has(plannedId)) {
      throw new Error(`Practice archive duplicate planned destination id: ${plannedId}.`);
    }
    plannedDestinationIds.add(plannedId);
    if (!sourceIds.has(sourceId)) {
      throw new Error(`Practice archive planned source id is not present: ${sourceId}.`);
    }
  }
  if (Object.keys(plannedProviderIds).length !== rows.length) {
    throw new Error('Practice archive planned provider ids do not exactly match the records.');
  }
  for (const row of rows) {
    const plannedId = plannedProviderIds[row.sourceId];
    if (plannedId !== row.id) {
      throw new Error(`Practice archive row ${row.sourceId} does not match its planned id.`);
    }
  }
};

export const workspacePracticeArchiveProvider: WorkspaceArchiveProvider = {
  category: 'practice',

  async exportRecords(context): Promise<unknown[]> {
    const archive = await exportPracticeArchive({ operationToken: context?.operationToken });
    return flattenPracticeArchive(archive.records as PracticeArchiveRecords);
  },

  async listExistingIds(context): Promise<string[]> {
    // Conflict/rollback verification is an internal ownership read and must
    // include staged rows that normal app readers intentionally hide.
    return listPracticeArchiveRecordIds({ operationToken: context?.operationToken });
  },

  async importRecords(
    records: unknown[] | Record<string, unknown>,
    context: WorkspaceArchiveProviderImportContext,
  ): Promise<WorkspaceArchiveProviderImportResult> {
    if (context.visibility !== 'hidden') {
      throw new Error('Practice archive provider only accepts hidden staged imports.');
    }
    const rows = asRows(records);
    const plannedProviderIds = context.idMap.providerRecords.practice;
    validateImportRows(rows, plannedProviderIds);
    const practiceRecords: PracticeArchiveRecords = {
      schemaVersion: PRACTICE_SCHEMA_VERSION,
      profiles: rows
        .filter(
          (row): row is PracticeProviderRecord & { kind: 'profile' } => row.kind === 'profile',
        )
        .map(row => row.value as PracticeProfile),
      lessons: rows
        .filter((row): row is PracticeProviderRecord & { kind: 'lesson' } => row.kind === 'lesson')
        .map(row => row.value as PracticeLesson),
      attempts: rows
        .filter(
          (row): row is PracticeProviderRecord & { kind: 'attempt' } => row.kind === 'attempt',
        )
        .map(row => row.value as PracticeAttempt),
      bookmarks: rows
        .filter(
          (row): row is PracticeProviderRecord & { kind: 'bookmark' } => row.kind === 'bookmark',
        )
        .map(row => row.value as PracticeBookmark),
    };
    const imported = await importPracticeArchive(practiceRecords, {
      importId: context.importId,
      visibility: 'hidden',
      operationToken: context.operationToken,
      plannedIds: getPlannedIds(rows),
    });
    const createdIds = [
      ...imported.copiedIds.profileIds,
      ...imported.copiedIds.lessonIds,
      ...imported.copiedIds.questionIds,
      ...imported.copiedIds.attemptIds,
      ...imported.copiedIds.bookmarkIds,
    ];
    context.registerCreatedIds(createdIds);
    return { createdIds, metadata: { rollbackToken: imported.rollbackToken } };
  },

  async publishImportedRecords(
    _ids: string[],
    context: WorkspaceArchiveProviderImportContext,
  ): Promise<void> {
    // This only validates and observes the shared receipt. The root coordinator
    // owns markWorkspaceArchiveImportPublished and calls it after its journal.
    await publishPracticeImportedRecords(context.importId, {
      operationToken: context.operationToken,
    });
  },

  async removeImportedRecords(
    ids: string[],
    context: WorkspaceArchiveProviderImportContext,
  ): Promise<void> {
    const result = await removePracticeImportedRecords(context.importId, {
      operationToken: context.operationToken,
      expectedIds: ids,
    });
    if (result.state === 'failed') {
      throw new Error(
        `Practice import cleanup incomplete: ${Object.values(result.missingIds).flat().join(', ')}`,
      );
    }
  },
};

export const getPracticeArchiveRecovery = listPracticeArchiveImports;
