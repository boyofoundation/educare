import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  acquireWorkspaceOfflineUpdateGuard,
  LOCAL_WORKSPACE_RUN_ID,
} from './workspaceOfflineGuard';
import { acquireWorkspaceRunLock } from './workspaceRunLock';
import { beginWorkspaceOperation, getWorkspaceOperationStatus } from './workspaceOperationService';

vi.mock('./workspaceRunLock', () => ({ acquireWorkspaceRunLock: vi.fn() }));
vi.mock('./workspaceOperationService', () => ({
  beginWorkspaceOperation: vi.fn(),
  getWorkspaceOperationStatus: vi.fn(),
}));
vi.mock('./offlineService', () => ({ registerOfflineUpdateGuard: vi.fn() }));

describe('offline update workspace protection', () => {
  const releaseRun = vi.fn();
  const releaseWrites = vi.fn();
  const idleStatus: ReturnType<typeof getWorkspaceOperationStatus> = {
    operationId: null,
    kind: null,
    phase: 'idle',
    paused: false,
    activeWrites: 0,
    queuedWrites: 0,
    startedAt: null,
    finishedAt: null,
    coordination: 'web-lock',
  };
  const runLease: Awaited<ReturnType<typeof acquireWorkspaceRunLock>> = {
    acquired: true,
    release: releaseRun,
    workspaceId: LOCAL_WORKSPACE_RUN_ID,
    lockName: 'agent-run-educare-local-workspace',
    mechanism: 'web-locks',
  };
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getWorkspaceOperationStatus).mockReturnValue(idleStatus);
    vi.mocked(acquireWorkspaceRunLock).mockResolvedValue(runLease);
    vi.mocked(beginWorkspaceOperation).mockResolvedValue({
      release: releaseWrites,
      operationId: 'update',
      kind: 'export',
      startedAt: 1,
      operationToken: Symbol('update'),
      waitForIdle: async () => undefined,
    });
  });

  it('holds the run mutex and flushed write barrier until activation releases them', async () => {
    const release = await acquireWorkspaceOfflineUpdateGuard();
    expect(acquireWorkspaceRunLock).toHaveBeenCalledWith(LOCAL_WORKSPACE_RUN_ID);
    expect(beginWorkspaceOperation).toHaveBeenCalledWith('export');
    expect(releaseRun).not.toHaveBeenCalled();
    expect(releaseWrites).not.toHaveBeenCalled();
    expect(typeof release).toBe('function');
    if (typeof release === 'function') {
      release();
    }
    expect(releaseWrites).toHaveBeenCalledOnce();
    expect(releaseRun).toHaveBeenCalledOnce();
  });

  it.each(['paused', 'activeWrites', 'queuedWrites'] as const)('rejects %s activity', async key => {
    vi.mocked(getWorkspaceOperationStatus).mockReturnValue({
      ...idleStatus,
      [key]: key === 'paused' ? true : 1,
    });
    expect(await acquireWorkspaceOfflineUpdateGuard()).toBe(false);
    expect(acquireWorkspaceRunLock).not.toHaveBeenCalled();
  });

  it('does not activate or flush while another tab holds a run', async () => {
    vi.mocked(acquireWorkspaceRunLock).mockResolvedValue({
      ...runLease,
      acquired: false,
    });
    expect(await acquireWorkspaceOfflineUpdateGuard()).toBe(false);
    expect(beginWorkspaceOperation).not.toHaveBeenCalled();
  });

  it('releases the run lock when draft flushing or storage fails', async () => {
    vi.mocked(beginWorkspaceOperation).mockRejectedValue(new Error('draft quota'));
    await expect(acquireWorkspaceOfflineUpdateGuard()).rejects.toThrow('draft quota');
    expect(releaseRun).toHaveBeenCalledOnce();
  });
});
