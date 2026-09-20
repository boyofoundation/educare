/**
 * Coordination primitive for workspace-wide reads and writes.
 *
 * IndexedDB and LightningFS are separate stores, so a single database
 * transaction cannot provide a consistent workspace snapshot.  The archive
 * service uses this barrier to stop new local writes and drain writes already
 * in flight before reading the individual stores.  Other persistence owners
 * can use `withWorkspaceWrite` without importing the archive service.
 *
 * The barrier is deliberately best-effort across browser contexts.  A
 * BroadcastChannel notification lets cooperating tabs surface an operation;
 * each tab still has to enter the barrier before its own writes are paused.
 * This avoids pretending that a browser primitive can provide a distributed
 * transaction while still making the contract explicit for callers.
 */

export type WorkspaceOperationKind = 'export' | 'import' | 'restore' | 'recovery';

export type WorkspaceOperationPhase = 'idle' | 'draining' | 'active' | 'finished';

/** Opaque capability for raw store operations made inside the active barrier. */
export type WorkspaceOperationToken = symbol;

export interface WorkspaceOperationStatus {
  operationId: string | null;
  kind: WorkspaceOperationKind | null;
  phase: WorkspaceOperationPhase;
  paused: boolean;
  activeWrites: number;
  queuedWrites: number;
  startedAt: number | null;
  finishedAt: number | null;
  coordination: 'web-lock' | 'local-lease' | 'local-only';
  lastError?: string;
}

export interface WorkspaceOperationHandle {
  readonly operationId: string;
  readonly kind: WorkspaceOperationKind;
  readonly startedAt: number;
  readonly operationToken: WorkspaceOperationToken;
  waitForIdle(): Promise<void>;
  release(error?: unknown): void;
}

export type WorkspaceOperationListener = (status: WorkspaceOperationStatus) => void;

export type WorkspaceOperationFlusher = (
  operationToken: WorkspaceOperationToken,
) => Promise<void> | void;

interface OperationRecord {
  id: string;
  kind: WorkspaceOperationKind;
  startedAt: number;
  operationToken: WorkspaceOperationToken;
}

const CHANNEL_NAME = 'educare-workspace-operation-v1';
const LOCK_NAME = 'educare-workspace-operation-lock-v1';
const LEASE_STORAGE_KEY = 'educare.workspace.operation-lease.v1';
const LEASE_TTL_MS = 30_000;

type LockMode = 'exclusive' | 'shared';

interface LockManagerLike {
  request(name: string, options: { mode: LockMode }, callback: () => Promise<void>): Promise<void>;
}

interface StoredLease {
  id: string;
  expiresAt: number;
}

const sleep = (milliseconds: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, milliseconds));

const createOperationId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `workspace-operation-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error';

class WorkspaceOperationCoordinator {
  private activeWrites = 0;

  private paused = false;

  private operation: OperationRecord | null = null;

  private phase: WorkspaceOperationPhase = 'idle';

  private finishedAt: number | null = null;

  private lastError: string | undefined;

  private readonly listeners = new Set<WorkspaceOperationListener>();

  private readonly writeWaiters = new Set<() => void>();

  private readonly idleWaiters = new Set<() => void>();

  private readonly flushers = new Set<WorkspaceOperationFlusher>();

  private exclusiveLeaseId: string | null = null;

  private leaseRenewalTimer: ReturnType<typeof setInterval> | null = null;

  private releaseExclusiveLock: (() => void) | null = null;

  private channel: InstanceType<typeof globalThis.BroadcastChannel> | null | undefined;

  private getChannel(): InstanceType<typeof globalThis.BroadcastChannel> | null {
    if (this.channel !== undefined) {
      return this.channel;
    }

    if (typeof globalThis.BroadcastChannel !== 'function') {
      this.channel = null;
      return this.channel;
    }

    try {
      this.channel = new globalThis.BroadcastChannel(CHANNEL_NAME);
    } catch {
      this.channel = null;
    }
    return this.channel;
  }

  private getLockManager(): LockManagerLike | null {
    const navigatorValue = globalThis.navigator as { locks?: LockManagerLike } | undefined;
    return navigatorValue?.locks ?? null;
  }

  private coordinationMode(): 'web-lock' | 'local-lease' | 'local-only' {
    if (this.getLockManager()) {
      return 'web-lock';
    }
    try {
      return globalThis.localStorage ? 'local-lease' : 'local-only';
    } catch {
      return 'local-only';
    }
  }

  private readLease(): StoredLease | null {
    try {
      const raw = globalThis.localStorage?.getItem(LEASE_STORAGE_KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw) as Partial<StoredLease>;
      if (typeof parsed.id !== 'string' || typeof parsed.expiresAt !== 'number') {
        return null;
      }
      return { id: parsed.id, expiresAt: parsed.expiresAt };
    } catch {
      return null;
    }
  }

  private async acquireWebLock(mode: LockMode): Promise<() => void> {
    const locks = this.getLockManager();
    if (!locks) {
      return () => undefined;
    }

    let resolveAcquired: (() => void) | undefined;
    let rejectAcquired: ((error: unknown) => void) | undefined;
    let resolveReleased: (() => void) | undefined;
    const acquired = new Promise<void>((resolve, reject) => {
      resolveAcquired = resolve;
      rejectAcquired = reject;
    });
    const release = new Promise<void>(resolve => {
      resolveReleased = resolve;
    });
    const request = locks.request(LOCK_NAME, { mode }, async () => {
      resolveAcquired?.();
      await release;
    });
    void request.catch(error => rejectAcquired?.(error));
    await acquired;
    let released = false;
    return () => {
      if (!released) {
        released = true;
        resolveReleased?.();
      }
    };
  }

  private async waitForExternalLease(): Promise<void> {
    while (true) {
      const lease = this.readLease();
      if (!lease || lease.id === this.exclusiveLeaseId || lease.expiresAt <= Date.now()) {
        return;
      }
      await sleep(25);
    }
  }

  private async acquireExclusiveCrossContextLock(operationId: string): Promise<void> {
    if (this.getLockManager()) {
      this.releaseExclusiveLock = await this.acquireWebLock('exclusive');
      return;
    }

    try {
      const storage = globalThis.localStorage;
      if (!storage) {
        return;
      }
      while (true) {
        await this.waitForExternalLease();
        const candidate: StoredLease = { id: operationId, expiresAt: Date.now() + LEASE_TTL_MS };
        storage.setItem(LEASE_STORAGE_KEY, JSON.stringify(candidate));
        const observed = this.readLease();
        if (observed?.id === operationId) {
          this.exclusiveLeaseId = operationId;
          this.leaseRenewalTimer = setInterval(
            () => {
              if (this.exclusiveLeaseId !== operationId) {
                return;
              }
              try {
                const current = this.readLease();
                if (current?.id === operationId) {
                  storage.setItem(
                    LEASE_STORAGE_KEY,
                    JSON.stringify({ id: operationId, expiresAt: Date.now() + LEASE_TTL_MS }),
                  );
                }
              } catch {
                // Let the bounded lease expire if storage becomes unavailable.
              }
            },
            Math.floor(LEASE_TTL_MS / 3),
          );
          return;
        }
        if (!observed) {
          // Storage-shaped test/private-mode implementations may accept a
          // write but not expose it on read. Do not spin forever; the status
          // still advertises the best-effort local fallback.
          return;
        }
      }
    } catch {
      // Private browsing/blocked storage: BroadcastChannel remains a useful
      // notification, but the status explicitly reports local-only semantics.
      return;
    }
  }

  private releaseCrossContextLock(): void {
    if (this.leaseRenewalTimer) {
      clearInterval(this.leaseRenewalTimer);
      this.leaseRenewalTimer = null;
    }
    this.releaseExclusiveLock?.();
    this.releaseExclusiveLock = null;
    if (!this.exclusiveLeaseId) {
      return;
    }
    try {
      const current = this.readLease();
      if (current?.id === this.exclusiveLeaseId) {
        globalThis.localStorage?.removeItem(LEASE_STORAGE_KEY);
      }
    } catch {
      // A lease will expire after the bounded TTL when storage is unavailable.
    }
    this.exclusiveLeaseId = null;
  }

  private broadcast(event: 'started' | 'finished', operation = this.operation): void {
    const channel = this.getChannel();
    if (!channel || !operation) {
      return;
    }

    try {
      channel.postMessage({
        type: 'workspace-operation',
        event,
        operationId: operation.id,
        kind: operation.kind,
        timestamp: Date.now(),
      });
    } catch {
      // A closed channel must not make a local archive operation fail.
    }
  }

  private notify(): void {
    const snapshot = this.getStatus();
    this.listeners.forEach(listener => {
      try {
        listener(snapshot);
      } catch {
        // Observers are diagnostic/UI hooks and cannot break persistence.
      }
    });
  }

  private resolveIdleWaiters(): void {
    if (this.activeWrites !== 0) {
      return;
    }
    this.idleWaiters.forEach(resolve => resolve());
    this.idleWaiters.clear();
  }

  private resolveWriteWaiters(): void {
    if (this.paused) {
      return;
    }
    this.writeWaiters.forEach(resolve => resolve());
    this.writeWaiters.clear();
  }

  getStatus(): WorkspaceOperationStatus {
    return {
      operationId: this.operation?.id ?? null,
      kind: this.operation?.kind ?? null,
      phase: this.phase,
      paused: this.paused,
      activeWrites: this.activeWrites,
      queuedWrites: this.writeWaiters.size,
      startedAt: this.operation?.startedAt ?? null,
      finishedAt: this.finishedAt,
      coordination: this.coordinationMode(),
      ...(this.lastError ? { lastError: this.lastError } : {}),
    };
  }

  isOperationTokenActive(operationToken: WorkspaceOperationToken): boolean {
    return this.operation?.operationToken === operationToken && this.phase !== 'idle';
  }

  subscribe(listener: WorkspaceOperationListener): () => void {
    this.listeners.add(listener);
    listener(this.getStatus());
    return () => this.listeners.delete(listener);
  }

  registerFlusher(flusher: WorkspaceOperationFlusher): () => void {
    this.flushers.add(flusher);
    return () => this.flushers.delete(flusher);
  }

  async begin(kind: WorkspaceOperationKind): Promise<WorkspaceOperationHandle> {
    if (this.operation) {
      throw new Error(
        `A workspace ${this.operation.kind} operation is already in progress (${this.operation.id}).`,
      );
    }

    const operation: OperationRecord = {
      id: createOperationId(),
      kind,
      startedAt: Date.now(),
      operationToken: Symbol(`workspace-operation:${kind}`),
    };
    this.operation = operation;
    this.paused = true;
    this.phase = 'draining';
    this.finishedAt = null;
    this.lastError = undefined;
    this.broadcast('started');
    this.notify();
    try {
      await this.acquireExclusiveCrossContextLock(operation.id);
      await this.waitForIdle();
    } catch (error) {
      this.paused = false;
      this.operation = null;
      this.phase = 'idle';
      this.releaseCrossContextLock();
      this.resolveWriteWaiters();
      this.notify();
      throw error;
    }
    this.phase = 'active';
    this.notify();

    let released = false;
    const release = (error?: unknown): void => {
      if (released || this.operation?.id !== operation.id) {
        return;
      }
      released = true;
      this.lastError = error === undefined ? undefined : errorMessage(error);
      this.phase = 'finished';
      this.paused = false;
      this.broadcast('finished', operation);
      this.operation = null;
      this.finishedAt = Date.now();
      this.resolveWriteWaiters();
      this.resolveIdleWaiters();
      this.notify();
      this.phase = 'idle';
      this.releaseCrossContextLock();
      this.notify();
    };
    const handle: WorkspaceOperationHandle = {
      operationId: operation.id,
      kind: operation.kind,
      startedAt: operation.startedAt,
      operationToken: operation.operationToken,
      waitForIdle: () => this.waitForIdle(),
      release,
    };
    try {
      for (const flusher of [...this.flushers]) {
        await flusher(operation.operationToken);
      }
    } catch (error) {
      release(error);
      throw error;
    }
    return handle;
  }

  async waitForIdle(): Promise<void> {
    if (this.activeWrites === 0) {
      return;
    }
    await new Promise<void>(resolve => {
      this.idleWaiters.add(resolve);
    });
  }

  async acquireWrite(): Promise<() => void> {
    let releaseCrossContextWrite: (() => void) | null = null;
    while (true) {
      if (this.paused) {
        await new Promise<void>(resolve => {
          this.writeWaiters.add(resolve);
        });
      }
      if (this.getLockManager()) {
        releaseCrossContextWrite = await this.acquireWebLock('shared');
      } else {
        await this.waitForExternalLease();
      }
      if (!this.paused) {
        break;
      }
      releaseCrossContextWrite?.();
      releaseCrossContextWrite = null;
    }

    this.activeWrites += 1;
    this.notify();
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      this.activeWrites = Math.max(0, this.activeWrites - 1);
      releaseCrossContextWrite?.();
      this.resolveIdleWaiters();
      this.notify();
    };
  }

  async withWrite<T>(operation: () => Promise<T>): Promise<T> {
    const release = await this.acquireWrite();
    try {
      return await operation();
    } finally {
      release();
    }
  }

  async withOperation<T>(
    kind: WorkspaceOperationKind,
    operation: (operationToken: WorkspaceOperationToken) => Promise<T>,
  ): Promise<T> {
    const handle = await this.begin(kind);
    try {
      const result = await operation(handle.operationToken);
      handle.release();
      return result;
    } catch (error) {
      handle.release(error);
      throw error;
    }
  }

  /** Test-only reset; never called by application code. */
  resetForTesting(): void {
    this.releaseCrossContextLock();
    this.paused = false;
    this.operation = null;
    this.phase = 'idle';
    this.activeWrites = 0;
    this.finishedAt = null;
    this.lastError = undefined;
    this.resolveWriteWaiters();
    this.resolveIdleWaiters();
    this.listeners.clear();
    this.flushers.clear();
    try {
      this.channel?.close();
    } catch {
      // Ignore an already closed channel in tests.
    }
    this.channel = undefined;
  }
}

export const workspaceOperationService = new WorkspaceOperationCoordinator();

export const getWorkspaceOperationStatus = (): WorkspaceOperationStatus =>
  workspaceOperationService.getStatus();

export const isWorkspaceOperationTokenActive = (operationToken: WorkspaceOperationToken): boolean =>
  workspaceOperationService.isOperationTokenActive(operationToken);

export const subscribeToWorkspaceOperations = (
  listener: WorkspaceOperationListener,
): (() => void) => workspaceOperationService.subscribe(listener);

export const registerWorkspaceOperationFlusher = (
  flusher: WorkspaceOperationFlusher,
): (() => void) => workspaceOperationService.registerFlusher(flusher);

export const beginWorkspaceOperation = (
  kind: WorkspaceOperationKind,
): Promise<WorkspaceOperationHandle> => workspaceOperationService.begin(kind);

export const waitForWorkspaceWrites = (): Promise<void> => workspaceOperationService.waitForIdle();

export const acquireWorkspaceWrite = (): Promise<() => void> =>
  workspaceOperationService.acquireWrite();

export const withWorkspaceWrite = <T>(operation: () => Promise<T>): Promise<T> =>
  workspaceOperationService.withWrite(operation);

export const withWorkspaceOperation = <T>(
  kind: WorkspaceOperationKind,
  operation: (operationToken: WorkspaceOperationToken) => Promise<T>,
): Promise<T> => workspaceOperationService.withOperation(kind, operation);

export const __resetWorkspaceOperationServiceForTesting = (): void => {
  workspaceOperationService.resetForTesting();
};
