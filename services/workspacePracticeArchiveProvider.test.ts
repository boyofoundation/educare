import { describe, expect, it, vi } from 'vitest';
import { workspacePracticeArchiveProvider } from './workspacePracticeArchiveProvider';

const token = Symbol('practice-provider-test-token');

const contextFor = (planned: Record<string, string>) => ({
  archiveId: 'archive-test',
  importId: 'import-test',
  category: 'practice' as const,
  idMap: {
    assistants: {},
    sessions: {},
    bundles: {},
    checkpoints: {},
    projects: {},
    providerRecords: { practice: planned },
    virtualAssistants: {},
  },
  operationToken: token,
  visibility: 'hidden' as const,
  registerCreatedIds: vi.fn(),
});

const row = (id: string, sourceId: string, kind: 'profile' | 'lesson' = 'profile') => ({
  id,
  sourceId,
  kind,
  value: { id: sourceId },
});

describe('workspacePracticeArchiveProvider', () => {
  it('rejects duplicate source IDs before service staging', async () => {
    const rows = [row('dest-a', 'source-a'), row('dest-b', 'source-a')];

    await expect(
      workspacePracticeArchiveProvider.importRecords(
        rows,
        contextFor({
          'source-a': 'dest-a',
        }),
      ),
    ).rejects.toThrow('duplicate source id');
  });

  it('rejects duplicate provider destination IDs before service staging', async () => {
    const rows = [row('dest-a', 'source-a'), row('dest-a', 'source-b')];

    await expect(
      workspacePracticeArchiveProvider.importRecords(
        rows,
        contextFor({
          'source-a': 'dest-a',
          'source-b': 'dest-a',
        }),
      ),
    ).rejects.toThrow('duplicate provider id');
  });

  it('rejects duplicate planned destination IDs and incomplete maps', async () => {
    const rows = [row('dest-a', 'source-a'), row('dest-b', 'source-b')];

    await expect(
      workspacePracticeArchiveProvider.importRecords(
        rows,
        contextFor({
          'source-a': 'planned-dest',
          'source-b': 'planned-dest',
        }),
      ),
    ).rejects.toThrow('duplicate planned destination id');

    await expect(
      workspacePracticeArchiveProvider.importRecords(
        rows,
        contextFor({
          'source-a': 'dest-a',
        }),
      ),
    ).rejects.toThrow('do not exactly match');
  });
});
