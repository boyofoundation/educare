import { acquireWorkspaceRunLock } from './workspaceRunLock';
import { beginWorkspaceOperation, getWorkspaceOperationStatus } from './workspaceOperationService';
import { registerOfflineUpdateGuard, type OfflineUpdateGuardResult } from './offlineService';

/** All local assistants/bundles share the same browser workspace databases. */
export const LOCAL_WORKSPACE_RUN_ID = 'educare-local-workspace';

/** Hold both capabilities until activation finishes, not just during a check. */
export async function acquireWorkspaceOfflineUpdateGuard(): Promise<OfflineUpdateGuardResult> {
  const status = getWorkspaceOperationStatus();
  if (status.paused || status.activeWrites > 0 || status.queuedWrites > 0) {
    return false;
  }
  const lease = await acquireWorkspaceRunLock(LOCAL_WORKSPACE_RUN_ID);
  if (!lease.acquired) {
    return false;
  }
  try {
    // The same barrier used for backups flushes every mounted draft owner and
    // drains persistence. A new writer cannot slip between this and activation.
    const operation = await beginWorkspaceOperation('export');
    return () => {
      operation.release();
      lease.release();
    };
  } catch (error) {
    lease.release();
    throw error;
  }
}

export const registerWorkspaceOfflineGuard = (): (() => void) =>
  registerOfflineUpdateGuard(acquireWorkspaceOfflineUpdateGuard);
