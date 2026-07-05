import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDB } from 'idb';
import type { AgentRunCheckpoint } from '../types';
import {
  claimCheckpoint,
  deleteCheckpoint,
  deleteForSession,
  getCheckpoint,
  getInterruptedForSession,
  saveCheckpoint,
  sweepStale,
  updateCheckpoint,
} from './agentRunCheckpointService';

const DB_NAME = 'agent-run-checkpoints';
const DB_VERSION = 1;
const STORE_NAME = 'checkpoints';
const SESSION_INDEX = 'by-session';
const BASE_TIME = Date.parse('2026-07-05T12:00:00.000Z');

const buildCheckpoint = (overrides: Partial<AgentRunCheckpoint> = {}): AgentRunCheckpoint => ({
  schemaVersion: 1,
  runId: overrides.runId ?? 'run-1',
  sessionId: overrides.sessionId ?? 'session-1',
  assistantId: overrides.assistantId ?? 'assistant-1',
  projectId: overrides.projectId ?? 'project-1',
  status: overrides.status ?? 'running',
  turnIndex: overrides.turnIndex ?? 0,
  maxTurns: overrides.maxTurns ?? 5,
  originalMessage: overrides.originalMessage ?? 'kick off',
  committedHistoryDelta: overrides.committedHistoryDelta ?? [],
  partialText: overrides.partialText,
  toolTrace: overrides.toolTrace ?? [],
  todoSummary: overrides.todoSummary,
  snapshotVersion: overrides.snapshotVersion,
  firstTurnPackSet: overrides.firstTurnPackSet,
  tokenTotals: overrides.tokenTotals ?? {
    promptTokenCount: 0,
    candidatesTokenCount: 0,
  },
  agentHarnessEnabled: overrides.agentHarnessEnabled ?? true,
  sharedMode: overrides.sharedMode ?? false,
  createdAt: overrides.createdAt ?? BASE_TIME,
  updatedAt: overrides.updatedAt ?? BASE_TIME,
  heartbeatAt: overrides.heartbeatAt ?? BASE_TIME,
});

const resetCheckpointStore = async () => {
  const db = await openDB(DB_NAME, DB_VERSION, {
    upgrade(database) {
      if (database.objectStoreNames.contains(STORE_NAME)) {
        return;
      }

      const store = database.createObjectStore(STORE_NAME, { keyPath: 'runId' });
      store.createIndex(SESSION_INDEX, 'sessionId');
    },
  });
  const tx = db.transaction(STORE_NAME, 'readwrite');
  await tx.store.clear();
  await tx.done;
  db.close();
};

const putRawCheckpoint = async (checkpoint: AgentRunCheckpoint | Record<string, unknown>) => {
  const db = await openDB(DB_NAME, DB_VERSION);
  await db.put(STORE_NAME, checkpoint as never);
  db.close();
};

describe('agentRunCheckpointService', () => {
  beforeEach(async () => {
    await resetCheckpointStore();
  });

  afterEach(async () => {
    await resetCheckpointStore();
    vi.restoreAllMocks();
  });

  it('saveCheckpoint and getCheckpoint persist a checkpoint record', async () => {
    const checkpoint = buildCheckpoint({
      runId: 'run-save',
      partialText: 'partial output',
      toolTrace: ['inspect'],
      committedHistoryDelta: [{ role: 'model', content: 'completed turn' }],
      tokenTotals: {
        promptTokenCount: 12,
        candidatesTokenCount: 6,
      },
    });

    await saveCheckpoint(checkpoint);

    await expect(getCheckpoint('run-save')).resolves.toEqual(checkpoint);
  });

  it('updateCheckpoint merges patches, preserves runId, and refreshes updatedAt', async () => {
    const original = buildCheckpoint({
      runId: 'run-update',
      heartbeatAt: BASE_TIME - 5_000,
      updatedAt: BASE_TIME - 5_000,
    });
    await saveCheckpoint(original);

    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(BASE_TIME + 3_000);

    const updated = await updateCheckpoint('run-update', {
      runId: 'ignored-run-id' as never,
      status: 'failed',
      turnIndex: 2,
      partialText: 'streaming',
      toolTrace: ['inspect', 'writeFile'],
      tokenTotals: {
        promptTokenCount: 20,
        candidatesTokenCount: 9,
      },
      heartbeatAt: BASE_TIME + 3_000,
    });

    expect(updated).toEqual(
      expect.objectContaining({
        runId: 'run-update',
        status: 'failed',
        turnIndex: 2,
        partialText: 'streaming',
        toolTrace: ['inspect', 'writeFile'],
        tokenTotals: {
          promptTokenCount: 20,
          candidatesTokenCount: 9,
        },
        updatedAt: BASE_TIME + 3_000,
        heartbeatAt: BASE_TIME + 3_000,
      }),
    );
    expect(nowSpy).toHaveBeenCalled();
    await expect(getCheckpoint('run-update')).resolves.toEqual(updated);
  });

  it('getInterruptedForSession returns the newest stale running checkpoint for a session', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(BASE_TIME);
    await saveCheckpoint(
      buildCheckpoint({
        runId: 'run-fresh',
        sessionId: 'session-stale',
        createdAt: BASE_TIME - 4_000,
        heartbeatAt: BASE_TIME - 200,
      }),
    );
    await saveCheckpoint(
      buildCheckpoint({
        runId: 'run-older-stale',
        sessionId: 'session-stale',
        createdAt: BASE_TIME - 3_000,
        heartbeatAt: BASE_TIME - 5_000,
      }),
    );
    await saveCheckpoint(
      buildCheckpoint({
        runId: 'run-newest-stale',
        sessionId: 'session-stale',
        createdAt: BASE_TIME - 1_000,
        heartbeatAt: BASE_TIME - 7_000,
      }),
    );
    await saveCheckpoint(
      buildCheckpoint({
        runId: 'run-complete',
        sessionId: 'session-stale',
        status: 'complete',
        createdAt: BASE_TIME - 500,
        heartbeatAt: BASE_TIME - 9_000,
      }),
    );

    const interrupted = await getInterruptedForSession('session-stale', 1_000);

    expect(nowSpy).toHaveBeenCalled();
    expect(interrupted?.runId).toBe('run-newest-stale');
  });

  it('claimCheckpoint atomically refreshes a stale checkpoint and prevents a second claim', async () => {
    await saveCheckpoint(
      buildCheckpoint({
        runId: 'run-claim',
        updatedAt: BASE_TIME - 20_000,
        heartbeatAt: BASE_TIME - 20_000,
      }),
    );

    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(BASE_TIME + 4_000);

    const claimed = await claimCheckpoint('run-claim', 1_000);

    expect(claimed).toEqual(
      expect.objectContaining({
        runId: 'run-claim',
        updatedAt: BASE_TIME + 4_000,
        heartbeatAt: BASE_TIME + 4_000,
      }),
    );
    expect(nowSpy).toHaveBeenCalled();
    await expect(getCheckpoint('run-claim')).resolves.toEqual(claimed);
    await expect(claimCheckpoint('run-claim', 1_000)).resolves.toBeNull();
  });

  it('deleteCheckpoint removes a single checkpoint by runId', async () => {
    await saveCheckpoint(buildCheckpoint({ runId: 'run-delete' }));

    await deleteCheckpoint('run-delete');

    await expect(getCheckpoint('run-delete')).resolves.toBeNull();
  });

  it('deleteForSession removes all checkpoints for a session and preserves other sessions', async () => {
    await saveCheckpoint(buildCheckpoint({ runId: 'run-session-1', sessionId: 'session-delete' }));
    await saveCheckpoint(buildCheckpoint({ runId: 'run-session-2', sessionId: 'session-delete' }));
    await saveCheckpoint(buildCheckpoint({ runId: 'run-keep', sessionId: 'session-keep' }));

    await deleteForSession('session-delete');

    await expect(getCheckpoint('run-session-1')).resolves.toBeNull();
    await expect(getCheckpoint('run-session-2')).resolves.toBeNull();
    await expect(getCheckpoint('run-keep')).resolves.toEqual(
      expect.objectContaining({ runId: 'run-keep' }),
    );
  });

  it('sweepStale removes expired and invalid-schema checkpoints and returns the deletion count', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(BASE_TIME);
    await saveCheckpoint(
      buildCheckpoint({
        runId: 'run-fresh',
        updatedAt: BASE_TIME - 100,
      }),
    );
    await saveCheckpoint(
      buildCheckpoint({
        runId: 'run-expired',
        updatedAt: BASE_TIME - 50_000,
      }),
    );
    await putRawCheckpoint({
      ...buildCheckpoint({
        runId: 'run-invalid',
        sessionId: 'session-invalid',
        updatedAt: BASE_TIME - 10,
      }),
      schemaVersion: 2,
    });

    const removedCount = await sweepStale(1_000);

    expect(nowSpy).toHaveBeenCalled();
    expect(removedCount).toBe(2);
    await expect(getCheckpoint('run-fresh')).resolves.toEqual(
      expect.objectContaining({ runId: 'run-fresh' }),
    );
    await expect(getCheckpoint('run-expired')).resolves.toBeNull();
    await expect(getCheckpoint('run-invalid')).resolves.toBeNull();
  });

  it('schema cleanup removes invalid records during direct reads and interrupted-session scans', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(BASE_TIME);
    await putRawCheckpoint({
      ...buildCheckpoint({ runId: 'run-invalid-read', sessionId: 'session-invalid-read' }),
      schemaVersion: 2,
    });
    await putRawCheckpoint({
      ...buildCheckpoint({
        runId: 'run-invalid-session',
        sessionId: 'session-invalid-session',
        heartbeatAt: BASE_TIME - 10_000,
      }),
      schemaVersion: 0,
    });
    await saveCheckpoint(
      buildCheckpoint({
        runId: 'run-valid-session',
        sessionId: 'session-invalid-session',
        createdAt: BASE_TIME - 500,
        heartbeatAt: BASE_TIME - 10_000,
      }),
    );

    await expect(getCheckpoint('run-invalid-read')).resolves.toBeNull();
    await expect(getInterruptedForSession('session-invalid-session', 1_000)).resolves.toEqual(
      expect.objectContaining({ runId: 'run-valid-session' }),
    );
    expect(nowSpy).toHaveBeenCalled();
    await expect(getCheckpoint('run-invalid-read')).resolves.toBeNull();
    await expect(getCheckpoint('run-invalid-session')).resolves.toBeNull();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
