import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('offline activation leases', () => {
  const events: string[] = [];
  let activationAllowed = true;

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('PROD', true);
    events.length = 0;
    activationAllowed = true;
    class Channel {
      port1 = {
        onmessage: undefined as undefined | ((event: { data: unknown }) => void),
        close: vi.fn(),
      };
      port2 = {
        postMessage: (data: unknown) =>
          globalThis.queueMicrotask(() => this.port1.onmessage?.({ data })),
      };
    }
    vi.stubGlobal('MessageChannel', Channel);
    vi.stubGlobal('isSecureContext', true);
    const worker = {
      postMessage: (
        message: { type: string },
        ports: Array<{ postMessage(data: unknown): void }>,
      ) => {
        if (message.type === 'EDUCARE_OFFLINE_ACTIVATE') {
          events.push('activate');
          ports[0].postMessage({ activated: activationAllowed });
        } else {
          ports[0].postMessage({ type: 'EDUCARE_OFFLINE', ready: true, completed: 1, total: 1 });
        }
      },
    };
    vi.stubGlobal('navigator', {
      onLine: true,
      serviceWorker: {
        addEventListener: vi.fn(),
        register: vi.fn().mockResolvedValue({
          active: worker,
          waiting: worker,
          installing: null,
          addEventListener: vi.fn(),
        }),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('holds guards through worker acknowledgement and releases afterward', async () => {
    const service = await import('./offlineService');
    await service.initializeOffline();
    service.registerOfflineUpdateGuard(async () => {
      events.push('acquire');
      return () => {
        events.push('release');
      };
    });
    await service.activateOfflineUpdate();
    expect(events).toEqual(['acquire', 'activate', 'release']);
    expect(service.getOfflineState().updateAvailable).toBe(false);
  });

  it('releases earlier leases when a later guard refuses and never activates', async () => {
    const service = await import('./offlineService');
    await service.initializeOffline();
    service.registerOfflineUpdateGuard(async () => () => {
      events.push('release');
    });
    service.registerOfflineUpdateGuard(async () => false);
    await expect(service.activateOfflineUpdate()).rejects.toThrow('等待對話');
    expect(events).toEqual(['release']);
  });

  it('releases all leases in reverse order when another tab prevents activation', async () => {
    activationAllowed = false;
    const service = await import('./offlineService');
    await service.initializeOffline();
    service.registerOfflineUpdateGuard(async () => () => {
      events.push('first');
    });
    service.registerOfflineUpdateGuard(async () => () => {
      events.push('second');
    });
    await expect(service.activateOfflineUpdate()).rejects.toThrow('關閉其他');
    expect(events).toEqual(['activate', 'second', 'first']);
    expect(service.getOfflineState().updateAvailable).toBe(true);
  });

  it('fails closed when the mounted app has no save protection', async () => {
    const service = await import('./offlineService');
    await service.initializeOffline();
    await expect(service.activateOfflineUpdate()).rejects.toThrow('儲存檢查尚未就緒');
    expect(events).toEqual([]);
  });
});
