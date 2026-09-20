import {
  getWorkspaceArchiveMetadata,
  registerWorkspaceArchiveProvider,
  WORKSPACE_ARCHIVE_PREFERENCE_KEYS,
  type WorkspaceArchiveImportOptions,
} from './workspaceArchiveService';

const preferenceKeys = new Set<string>(WORKSPACE_ARCHIVE_PREFERENCE_KEYS);

/** Raw strings preserve the exact pre-import state, including absent keys. */
function readPreferences(): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of preferenceKeys) {
    const value = localStorage.getItem(key);
    if (value !== null) {
      result[key] = value;
    }
  }
  return result;
}

function restorePreferences(previous: Record<string, unknown>): void {
  // Attempt every key even if one write fails; the journal remains recoverable
  // until the coordinator can prove this rollback succeeded completely.
  const failed: string[] = [];
  for (const key of preferenceKeys) {
    try {
      const value = previous[key];
      if (value === undefined) {
        localStorage.removeItem(key);
      } else if (typeof value === 'string') {
        localStorage.setItem(key, value);
      } else {
        throw new Error('Invalid preference rollback value.');
      }
    } catch {
      failed.push(key);
    }
  }
  if (failed.length) {
    throw new Error('部分偏好尚未回復；請保留備份，在儲存空間可用後重試恢復。');
  }
}

function applyPreferences(incoming: Record<string, unknown>): void {
  // Serialize and validate the entire allowlist before the first mutation.
  const values = Object.entries(incoming).map(([key, value]) => {
    if (!preferenceKeys.has(key)) {
      throw new Error('備份含有不支援的偏好設定。');
    }
    const serialized = JSON.stringify(value);
    if (serialized === undefined || serialized.length > 64 * 1024) {
      throw new Error('備份的偏好設定格式或容量不正確。');
    }
    return [key, serialized] as const;
  });
  for (const [key, value] of values) {
    localStorage.setItem(key, value);
  }
}

/** Preferences participate in the archive journal's rollback contract. */
export const workspaceArchiveImportOptions: WorkspaceArchiveImportOptions = {
  copy: true,
  readPreferences,
  applyPreferences,
  restorePreferences,
};

let preparation: Promise<void> | undefined;

/** Register real persistence owners before any workspace backup or recovery. */
export async function prepareWorkspaceArchive(): Promise<void> {
  if (!preparation) {
    preparation = (async () => {
      const [projects, drafts, practice] = await Promise.all([
        import('./workspaceProjectArchiveProvider'),
        import('./workspaceDraftArchiveProvider'),
        import('./workspacePracticeArchiveProvider'),
      ]);
      const cleanups: Array<() => void> = [];
      try {
        cleanups.push(registerWorkspaceArchiveProvider(projects.workspaceProjectArchiveProvider));
        cleanups.push(registerWorkspaceArchiveProvider(drafts.workspaceDraftArchiveProvider));
        cleanups.push(registerWorkspaceArchiveProvider(practice.workspacePracticeArchiveProvider));
      } catch (error) {
        cleanups.reverse().forEach(cleanup => cleanup());
        throw error;
      }
    })().catch(error => {
      preparation = undefined;
      throw error;
    });
  }
  await preparation;
  // Published journals may need their cross-store visibility receipt restored
  // after a reload. Interrupted imports are listed, never silently replayed.
  await getWorkspaceArchiveMetadata();
}
