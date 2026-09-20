import { describe, expect, it, vi } from 'vitest';
import {
  acquireWorkspaceRunLock,
  withWorkspaceRunLock,
  workspaceRunLockName,
} from './workspaceRunLock';

describe('workspaceRunLock', () => {
  it('fails closed when Web Locks are unavailable by default', async () => {
    const workspaceId = `fallback-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const first = await acquireWorkspaceRunLock(workspaceId, { ownerId: 'tab-a' });
    const second = await acquireWorkspaceRunLock(workspaceId, { ownerId: 'tab-b' });

    expect(first).toEqual(
      expect.objectContaining({
        acquired: false,
        lockName: workspaceRunLockName(workspaceId),
        mechanism: 'unavailable',
        caveat: 'web-locks-unavailable-fail-closed',
      }),
    );
    expect(second).toEqual(
      expect.objectContaining({
        acquired: false,
        mechanism: 'unavailable',
        caveat: 'web-locks-unavailable-fail-closed',
      }),
    );
  });

  it('requires explicit opt-in for the honest localStorage soft fallback', async () => {
    const workspaceId = `fallback-opt-in-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const options = { allowUnsafeLocalStorageFallback: true };
    const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const storage = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storage.set(key, value);
        },
        removeItem: (key: string) => {
          storage.delete(key);
        },
      },
    });

    try {
      const first = await acquireWorkspaceRunLock(workspaceId, { ...options, ownerId: 'tab-a' });
      const second = await acquireWorkspaceRunLock(workspaceId, { ...options, ownerId: 'tab-b' });

      expect(first).toEqual(
        expect.objectContaining({
          acquired: true,
          mechanism: 'local-storage-soft',
          caveat: 'local-storage-soft-limit',
        }),
      );
      expect(second).toEqual(
        expect.objectContaining({
          acquired: false,
          mechanism: 'local-storage-soft',
          caveat: 'local-storage-soft-limit',
        }),
      );

      first.release();
      const afterRelease = await withWorkspaceRunLock(
        workspaceId,
        context => `${context.mechanism}:${context.caveat}`,
        { ...options, ownerId: 'tab-b' },
      );
      expect(afterRelease).toBe('local-storage-soft:local-storage-soft-limit');
    } finally {
      if (previousStorage) {
        Object.defineProperty(globalThis, 'localStorage', previousStorage);
      } else {
        delete (globalThis as { localStorage?: unknown }).localStorage;
      }
    }
  });

  it('uses the Web Locks mutex when the browser exposes it', async () => {
    let callbackPromise: Promise<unknown> | undefined;
    const request = vi.fn(
      (
        _name: string,
        _options: { mode: 'exclusive'; ifAvailable: boolean },
        callback: (lock: object | null) => Promise<unknown> | unknown,
      ) => {
        callbackPromise = Promise.resolve(callback({}));
        return callbackPromise;
      },
    );
    const navigatorRecord = navigator as unknown as { locks?: unknown };
    const previousLocks = navigatorRecord.locks;
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: { request },
    });

    try {
      const leasePromise = acquireWorkspaceRunLock('web-lock-workspace', { ifAvailable: true });
      const lease = await leasePromise;

      expect(request).toHaveBeenCalledWith(
        'agent-run-web-lock-workspace',
        { mode: 'exclusive', ifAvailable: true },
        expect.any(Function),
      );
      expect(lease.acquired).toBe(true);
      expect(lease.mechanism).toBe('web-locks');

      lease.release();
      await callbackPromise;
    } finally {
      if (typeof previousLocks === 'undefined') {
        delete navigatorRecord.locks;
      } else {
        Object.defineProperty(navigator, 'locks', {
          configurable: true,
          value: previousLocks,
        });
      }
    }
  });
});
