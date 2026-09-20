/// <reference types="vite/client" />
/* global ServiceWorkerRegistration, ServiceWorker, MessageChannel */

export interface OfflineState {
  phase: 'idle' | 'unsupported' | 'preparing' | 'ready' | 'error';
  completed: number;
  total: number;
  ready: boolean;
  updateAvailable: boolean;
  online: boolean;
  error?: string;
  version?: string;
}

let state: OfflineState = {
  phase: 'idle',
  completed: 0,
  total: 0,
  ready: false,
  updateAvailable: false,
  online: typeof navigator === 'undefined' || navigator.onLine,
};
let registration: ServiceWorkerRegistration | undefined;
let initialization: Promise<void> | undefined;
const listeners = new Set<() => void>();
export type OfflineUpdateGuardResult = boolean | (() => void);
const updateGuards = new Set<() => Promise<OfflineUpdateGuardResult>>();

const publish = (patch: Partial<OfflineState>) => {
  state = { ...state, ...patch };
  listeners.forEach(listener => listener());
};

export const getOfflineState = () => state;
export const subscribeOfflineState = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** The app must flush drafts and reject updates during runs/imports/git writes. */
export function registerOfflineUpdateGuard(
  guard: () => Promise<OfflineUpdateGuardResult>,
): () => void {
  updateGuards.add(guard);
  return () => {
    updateGuards.delete(guard);
  };
}

function messageWorker(worker: ServiceWorker, type: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = setTimeout(() => {
      channel.port1.close();
      reject(new Error('離線準備狀態暫時無法讀取，請保持連線後重試。'));
    }, 5000);
    channel.port1.onmessage = event => {
      clearTimeout(timeout);
      channel.port1.close();
      resolve(event.data as Record<string, unknown>);
    };
    worker.postMessage({ type }, [channel.port2]);
  });
}

function acceptStatus(data: Record<string, unknown>, fromCandidate = false) {
  if (data.type !== 'EDUCARE_OFFLINE') {
    return;
  }
  // A failed or partial candidate download must not revoke the usable active
  // version. A direct active-worker query still detects eviction accurately.
  const retainActive = fromCandidate && state.ready;
  const ready = retainActive || data.ready === true;
  publish({
    ready,
    phase: data.phase === 'error' ? 'error' : ready ? 'ready' : 'preparing',
    completed: typeof data.completed === 'number' ? data.completed : 0,
    total: typeof data.total === 'number' ? data.total : 0,
    version: retainActive
      ? state.version
      : typeof data.version === 'string'
        ? data.version
        : undefined,
    error:
      data.phase === 'error'
        ? '離線準備未完成：網路或儲存容量不足。既有資料與可用版本未刪除。'
        : undefined,
  });
}

export async function refreshOfflineStatus(): Promise<void> {
  if (!registration) {
    return;
  }
  const worker = registration.active ?? registration.waiting;
  if (worker) {
    acceptStatus(await messageWorker(worker, 'EDUCARE_OFFLINE_STATUS'));
  }
  publish({ updateAvailable: Boolean(registration.waiting) });
}

export function initializeOffline(): Promise<void> {
  if (initialization) {
    return initialization;
  }
  initialization = (async () => {
    if (!import.meta.env.PROD) {
      return;
    }
    if (!('serviceWorker' in navigator) || !globalThis.isSecureContext) {
      publish({ phase: 'unsupported', error: '此環境不支援離線準備；請使用 HTTPS 或 localhost。' });
      return;
    }
    const networkChanged = () => publish({ online: navigator.onLine });
    window.addEventListener('online', networkChanged);
    window.addEventListener('offline', networkChanged);
    navigator.serviceWorker.addEventListener('message', event => {
      if (event.data && typeof event.data === 'object') {
        acceptStatus(event.data, event.source !== registration?.active);
      }
    });
    try {
      registration = await navigator.serviceWorker.register(
        `${import.meta.env.BASE_URL}service-worker.js`,
        {
          scope: import.meta.env.BASE_URL,
          updateViaCache: 'none',
        },
      );
      const watchInstalling = () => {
        const installing = registration?.installing;
        if (!installing) {
          return;
        }
        publish({ phase: 'preparing' });
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' || installing.state === 'activated') {
            void refreshOfflineStatus().catch(() => undefined);
          } else if (installing.state === 'redundant') {
            publish({
              phase: 'error',
              error: '新版下載未完成，仍保留上一版；重新連線後可再檢查更新。',
            });
          }
        });
      };
      registration.addEventListener('updatefound', watchInstalling);
      watchInstalling();
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        // Never reload automatically. Even a user-approved activation may be
        // followed by editing in another tab; old chunks remain available.
        void refreshOfflineStatus().catch(() => undefined);
      });
      await refreshOfflineStatus();
    } catch {
      publish({
        phase: 'error',
        ready: false,
        error: '離線準備失敗。請保持連線並檢查網站儲存容量；既有教學資料未刪除。',
      });
    }
  })();
  return initialization;
}

export async function checkOfflineUpdate(): Promise<void> {
  if (!registration) {
    throw new Error('離線服務尚未啟用。');
  }
  try {
    await registration.update();
    await refreshOfflineStatus();
  } catch {
    throw new Error('目前無法下載更新；現有離線版本仍保留，請重新連線後重試。');
  }
}

export async function activateOfflineUpdate(): Promise<void> {
  if (!registration?.waiting) {
    throw new Error('目前沒有已下載完成的更新。');
  }
  if (updateGuards.size === 0) {
    throw new Error('儲存檢查尚未就緒，請稍後重試。');
  }
  const releases: Array<() => void> = [];
  try {
    for (const guard of updateGuards) {
      const result = await guard();
      if (!result) {
        throw new Error('請先保存內容，並等待對話、匯入或作品寫入完成後再更新。');
      }
      if (typeof result === 'function') {
        releases.push(result);
      }
    }
    const result = await messageWorker(registration.waiting, 'EDUCARE_OFFLINE_ACTIVATE');
    if (!result.activated) {
      throw new Error('請先保存內容並關閉其他 EduCare 分頁，再套用更新。');
    }
    // Activation never reloads or repeats a cloud request. Keep acquired run
    // and persistence leases held through the worker's acknowledgement.
    publish({ updateAvailable: false });
  } finally {
    releases.reverse().forEach(release => release());
  }
}
