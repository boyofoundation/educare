/**
 * Same-workspace run mutex.
 *
 * Web Locks provide the cross-tab mutex when available. There is no sound
 * transactional IndexedDB lock implementation in this lane, so the default
 * when Web Locks are unavailable is fail-closed. An explicitly opt-in
 * localStorage lease remains available for legacy callers, but is labelled as
 * a soft cross-tab hint and must never be described as a provider cap.
 */

export const WORKSPACE_RUN_LOCK_PREFIX = 'agent-run-';
export const DEFAULT_WORKSPACE_RUN_LOCK_TTL_MS = 15_000;

export type WorkspaceRunLockMechanism = 'web-locks' | 'local-storage-soft' | 'unavailable';
export type WorkspaceRunLockCaveat =
  | 'local-storage-soft-limit'
  | 'web-locks-unavailable-fail-closed';

export interface WorkspaceRunLockOptions {
  /** Return immediately when another tab owns the lock. Defaults to true. */
  ifAvailable?: boolean;
  /** Best-effort fallback lease duration. */
  ttlMs?: number;
  ownerId?: string;
  /**
   * Explicit compatibility escape hatch. Disabled by default because a
   * localStorage lease is not an atomic cross-tab mutex.
   */
  allowUnsafeLocalStorageFallback?: boolean;
}

export interface WorkspaceRunLockLease {
  acquired: boolean;
  workspaceId: string;
  lockName: string;
  mechanism: WorkspaceRunLockMechanism;
  /** Honest caveat for local fallback; absent for Web Locks. */
  caveat?: WorkspaceRunLockCaveat;
  release: () => void;
  /** Extend an opted-in localStorage lease; Web Locks are held by the API. */
  renew?: () => boolean;
}

export interface WorkspaceRunLockTaskContext {
  mechanism: WorkspaceRunLockMechanism;
  caveat?: WorkspaceRunLockCaveat;
  renew: () => boolean;
}

interface WorkspaceLockManager {
  request: (
    name: string,
    options: { mode: 'exclusive'; ifAvailable: boolean },
    callback: (lock: object | null) => Promise<unknown> | unknown,
  ) => Promise<unknown>;
}

interface LocalStorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

export const workspaceRunLockName = (workspaceId: string): string =>
  `${WORKSPACE_RUN_LOCK_PREFIX}${workspaceId}`;

const ownerToken = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `owner-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const isLockManager = (value: unknown): value is WorkspaceLockManager =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { request?: unknown }).request === 'function';

const getLockManager = (): WorkspaceLockManager | undefined => {
  if (typeof navigator === 'undefined') {
    return undefined;
  }
  const lockManager = (navigator as unknown as { locks?: WorkspaceLockManager }).locks;
  return isLockManager(lockManager) ? lockManager : undefined;
};

interface FallbackLeaseRecord {
  ownerId: string;
  expiresAt: number;
}

const fallbackStorageKey = (workspaceId: string): string =>
  `${WORKSPACE_RUN_LOCK_PREFIX}${workspaceId}:lease`;

const getStorage = (): LocalStorageLike | undefined => {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
};

const unavailableLease = (workspaceId: string, lockName: string): WorkspaceRunLockLease => ({
  acquired: false,
  workspaceId,
  lockName,
  mechanism: 'unavailable',
  caveat: 'web-locks-unavailable-fail-closed',
  release: () => undefined,
  renew: () => false,
});

const readFallbackRecord = (key: string): { record?: FallbackLeaseRecord; available: boolean } => {
  const storage = getStorage();
  if (!storage) {
    return { available: false };
  }

  try {
    const raw = storage.getItem(key);
    if (!raw) {
      return { available: true };
    }
    const parsed = JSON.parse(raw) as Partial<FallbackLeaseRecord>;
    if (
      typeof parsed.ownerId !== 'string' ||
      typeof parsed.expiresAt !== 'number' ||
      parsed.expiresAt <= Date.now()
    ) {
      storage.removeItem(key);
      return { available: true };
    }
    return { available: true, record: { ownerId: parsed.ownerId, expiresAt: parsed.expiresAt } };
  } catch {
    return { available: false };
  }
};

const writeFallbackRecord = (key: string, record: FallbackLeaseRecord): boolean => {
  const storage = getStorage();
  if (!storage) {
    return false;
  }

  try {
    storage.setItem(key, JSON.stringify(record));
    const raw = storage.getItem(key);
    if (!raw) {
      return false;
    }
    const written = JSON.parse(raw) as Partial<FallbackLeaseRecord>;
    return written.ownerId === record.ownerId && written.expiresAt === record.expiresAt;
  } catch {
    return false;
  }
};

const releaseFallback = (key: string, ownerId: string): void => {
  const current = readFallbackRecord(key);
  if (!current.available || !current.record || current.record.ownerId !== ownerId) {
    return;
  }
  const storage = getStorage();
  try {
    storage?.removeItem(key);
  } catch {
    // Best effort; an expired lease will be ignored on the next acquisition.
  }
};

const renewFallback = (key: string, ownerId: string, ttlMs: number): boolean => {
  const current = readFallbackRecord(key);
  if (!current.available || !current.record || current.record.ownerId !== ownerId) {
    return false;
  }
  return writeFallbackRecord(key, {
    ownerId,
    expiresAt: Date.now() + ttlMs,
  });
};

const acquireFallback = (
  workspaceId: string,
  options: WorkspaceRunLockOptions,
): WorkspaceRunLockLease => {
  const lockName = workspaceRunLockName(workspaceId);
  if (!options.allowUnsafeLocalStorageFallback) {
    return unavailableLease(workspaceId, lockName);
  }
  const key = fallbackStorageKey(workspaceId);
  const existing = readFallbackRecord(key);
  if (!existing.available) {
    return unavailableLease(workspaceId, lockName);
  }
  const ownerId = options.ownerId ?? ownerToken();
  if (existing.record && existing.record.ownerId !== ownerId) {
    return {
      acquired: false,
      workspaceId,
      lockName,
      mechanism: 'local-storage-soft',
      caveat: 'local-storage-soft-limit',
      release: () => undefined,
      renew: () => false,
    };
  }

  const ttlMs = Math.max(1_000, options.ttlMs ?? DEFAULT_WORKSPACE_RUN_LOCK_TTL_MS);
  const record: FallbackLeaseRecord = {
    ownerId,
    expiresAt: Date.now() + ttlMs,
  };
  if (!writeFallbackRecord(key, record)) {
    return unavailableLease(workspaceId, lockName);
  }
  return {
    acquired: true,
    workspaceId,
    lockName,
    mechanism: 'local-storage-soft',
    caveat: 'local-storage-soft-limit',
    release: () => releaseFallback(key, ownerId),
    renew: () => renewFallback(key, ownerId, ttlMs),
  };
};

/** Acquire a lock and keep it held until the returned lease is released. */
export const acquireWorkspaceRunLock = async (
  workspaceId: string,
  options: WorkspaceRunLockOptions = {},
): Promise<WorkspaceRunLockLease> => {
  const lockManager = getLockManager();
  const lockName = workspaceRunLockName(workspaceId);
  if (!lockManager) {
    return acquireFallback(workspaceId, options);
  }

  const ifAvailable = options.ifAvailable ?? true;
  let settled = false;
  let released = false;
  let releaseLock: (() => void) | undefined;
  let resolveLease: ((lease: WorkspaceRunLockLease) => void) | undefined;
  const leasePromise = new Promise<WorkspaceRunLockLease>(resolve => {
    resolveLease = resolve;
  });

  let operation: Promise<unknown>;
  try {
    operation = lockManager.request(lockName, { mode: 'exclusive', ifAvailable }, async lock => {
      if (!lock) {
        settled = true;
        resolveLease?.({
          acquired: false,
          workspaceId,
          lockName,
          mechanism: 'web-locks',
          release: () => undefined,
          renew: () => false,
        });
        return;
      }

      const hold = new Promise<void>(resolve => {
        releaseLock = resolve;
      });
      settled = true;
      resolveLease?.({
        acquired: true,
        workspaceId,
        lockName,
        mechanism: 'web-locks',
        release: () => {
          if (!released) {
            released = true;
            releaseLock?.();
          }
        },
        renew: () => !released,
      });
      await hold;
    });
  } catch {
    return unavailableLease(workspaceId, lockName);
  }

  void operation.catch(() => {
    if (settled) {
      return;
    }
    settled = true;
    resolveLease?.({
      acquired: false,
      workspaceId,
      lockName,
      mechanism: 'web-locks',
      release: () => undefined,
      renew: () => false,
    });
  });

  return leasePromise;
};

/**
 * Run one task while holding the same-workspace mutex. This is the preferred
 * integration API for controller/UI callers because release is exception-safe.
 */
export const withWorkspaceRunLock = async <T>(
  workspaceId: string,
  task: (context: WorkspaceRunLockTaskContext) => Promise<T> | T,
  options: WorkspaceRunLockOptions = {},
): Promise<T | undefined> => {
  const lease = await acquireWorkspaceRunLock(workspaceId, options);
  if (!lease.acquired) {
    return undefined;
  }
  const ttlMs = Math.max(1_000, options.ttlMs ?? DEFAULT_WORKSPACE_RUN_LOCK_TTL_MS);
  const renewalInterval =
    lease.mechanism === 'local-storage-soft'
      ? setInterval(
          () => {
            lease.renew?.();
          },
          Math.max(250, Math.floor(ttlMs / 3)),
        )
      : undefined;
  try {
    return await task({
      mechanism: lease.mechanism,
      caveat: lease.caveat,
      renew: () => lease.renew?.() ?? false,
    });
  } finally {
    if (renewalInterval !== undefined) {
      clearInterval(renewalInterval);
    }
    lease.release();
  }
};
