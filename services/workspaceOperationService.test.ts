import { afterEach, describe, expect, it } from 'vitest';
import {
  __resetWorkspaceOperationServiceForTesting,
  beginWorkspaceOperation,
  getWorkspaceOperationStatus,
  isWorkspaceOperationTokenActive,
  registerWorkspaceOperationFlusher,
  withWorkspaceOperation,
  withWorkspaceWrite,
} from './workspaceOperationService';
import { withWorkspaceDatabaseOperation } from './db';

describe('workspaceOperationService', () => {
  afterEach(() => {
    __resetWorkspaceOperationServiceForTesting();
  });

  it('drains an in-flight write before an archive operation becomes active', async () => {
    let releaseWrite: (() => void) | undefined;
    let writeStartedResolve: (() => void) | undefined;
    const writeStarted = new Promise<void>(resolve => {
      writeStartedResolve = resolve;
    });
    let writeFinished = false;
    const write = withWorkspaceWrite(
      () =>
        new Promise<void>(resolve => {
          writeStartedResolve?.();
          releaseWrite = () => {
            writeFinished = true;
            resolve();
          };
        }),
    );
    await writeStarted;

    const operationPromise = beginWorkspaceOperation('export');
    await Promise.resolve();
    expect(getWorkspaceOperationStatus()).toMatchObject({ phase: 'draining', paused: true });
    expect(writeFinished).toBe(false);

    releaseWrite?.();
    const operation = await operationPromise;
    expect(writeFinished).toBe(true);
    expect(getWorkspaceOperationStatus()).toMatchObject({ phase: 'active', paused: true });

    operation.release();
    await write;
    expect(getWorkspaceOperationStatus()).toMatchObject({ phase: 'idle', paused: false });
  });

  it('queues a write started while an operation is active and releases it afterward', async () => {
    const operation = await beginWorkspaceOperation('import');
    let started = false;
    const write = withWorkspaceWrite(async () => {
      started = true;
    });

    await new Promise(resolve => setTimeout(resolve, 0));
    expect(started).toBe(false);
    operation.release();
    await write;
    expect(started).toBe(true);
  });

  it('surfaces operation failures to observers without leaving the barrier paused', async () => {
    const phases: string[] = [];
    const unsubscribe = (
      await import('./workspaceOperationService')
    ).subscribeToWorkspaceOperations(status => phases.push(status.phase));
    const operation = await beginWorkspaceOperation('restore');
    operation.release(new Error('fixture failure'));
    unsubscribe();

    expect(phases).toContain('draining');
    expect(phases).toContain('active');
    expect(getWorkspaceOperationStatus()).toMatchObject({ phase: 'idle', paused: false });
    expect(getWorkspaceOperationStatus().lastError).toBe('fixture failure');
  });

  it('requires an active operation token for raw in-operation access', async () => {
    let releasedToken: symbol | undefined;
    await withWorkspaceOperation('export', async operationToken => {
      releasedToken = operationToken;
      expect(isWorkspaceOperationTokenActive(operationToken)).toBe(true);
      await expect(
        withWorkspaceDatabaseOperation({ operationToken }, async () => 'raw-access'),
      ).resolves.toBe('raw-access');
    });

    expect(releasedToken).toBeDefined();
    expect(isWorkspaceOperationTokenActive(releasedToken as symbol)).toBe(false);
    await expect(
      withWorkspaceDatabaseOperation(
        { operationToken: releasedToken as symbol },
        async () => 'stale-access',
      ),
    ).rejects.toThrow(/no longer active/i);
  });

  it('flushes registered work after draining and before the operation callback', async () => {
    const events: string[] = [];
    const unregister = registerWorkspaceOperationFlusher(() => {
      events.push('flush');
    });

    await withWorkspaceOperation('export', async () => {
      events.push('operation');
    });

    unregister();
    expect(events).toEqual(['flush', 'operation']);
  });

  it('fails closed and releases the barrier when a flusher rejects', async () => {
    const unregister = registerWorkspaceOperationFlusher(() => {
      throw new Error('flush failed');
    });

    await expect(beginWorkspaceOperation('export')).rejects.toThrow('flush failed');
    unregister();
    expect(getWorkspaceOperationStatus()).toMatchObject({ phase: 'idle', paused: false });
    expect(getWorkspaceOperationStatus().lastError).toBe('flush failed');
  });
});
