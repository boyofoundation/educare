import { runInNewContext } from 'node:vm';
/* global RequestInit */
import { describe, expect, it, vi } from 'vitest';
import { createOfflineWorkerSource } from './offlineWorkerSource';

const base = 'https://school.test/educare/';
const assets = ['index.html', 'assets/app-v1.js', 'assets/lazy-v1.js'];

function harness(version = 'v1', existing = new Map<string, Map<string, Response>>()) {
  const handlers = new Map<string, (event: unknown) => void>();
  const notices: unknown[] = [];
  const fetcher = vi.fn(async (request: Request) => new Response(request.url));
  const skipWaiting = vi.fn();
  const clients = [{ id: 'tab-1', url: base, postMessage: (data: unknown) => notices.push(data) }];
  const caches = {
    keys: async () => [...existing.keys()],
    delete: async (name: string) => existing.delete(name),
    open: async (name: string) => {
      if (!existing.has(name)) {
        existing.set(name, new Map());
      }
      const cache = existing.get(name)!;
      return {
        put: async (request: Request | string, response: Response) => {
          cache.set(typeof request === 'string' ? request : request.url, response.clone());
        },
        match: async (request: Request | string) =>
          cache.get(typeof request === 'string' ? request : request.url)?.clone(),
        keys: async () => [...cache.keys()].map(url => new Request(url)),
      };
    },
  };
  runInNewContext(createOfflineWorkerSource({ base: '/educare/', version, assets }), {
    self: {
      location: { origin: 'https://school.test' },
      registration: { scope: base },
      addEventListener: (type: string, handler: (event: unknown) => void) =>
        handlers.set(type, handler),
      clients: { matchAll: async () => clients, claim: vi.fn() },
      skipWaiting,
    },
    caches,
    fetch: fetcher,
    Request,
    Response,
    URL,
    Set,
    Promise,
  });
  const lifetime = async (type: string, fields = {}) => {
    let work: Promise<unknown> = Promise.resolve();
    handlers.get(type)!({
      ...fields,
      waitUntil: (promise: Promise<unknown>) => {
        work = promise;
      },
    });
    return work;
  };
  const request = async (url: string, options: RequestInit = {}, mode?: string) => {
    let result: Promise<Response> | undefined;
    const actual = new Request(url, options);
    handlers.get('fetch')!({
      request: mode
        ? { url: actual.url, method: actual.method, headers: actual.headers, mode }
        : actual,
      respondWith: (promise: Promise<Response>) => {
        result = promise;
      },
    });
    return result;
  };
  return { lifetime, request, existing, caches, fetcher, notices, skipWaiting };
}

describe('offline service worker lifecycle and cache boundaries', () => {
  it('prepares every lazy asset before reporting ready', async () => {
    const app = harness();
    await app.lifetime('install');
    expect(app.fetcher).toHaveBeenCalledTimes(3);
    expect(app.notices.at(-1)).toMatchObject({
      type: 'EDUCARE_OFFLINE',
      ready: true,
      completed: 3,
      total: 3,
    });
    expect(app.skipWaiting).not.toHaveBeenCalled();
  });

  it('deletes only the incomplete new cache when downloading fails', async () => {
    const old = harness();
    await old.lifetime('install');
    const update = harness('v2', old.existing);
    update.fetcher.mockRejectedValueOnce(new Error('quota or network failure'));
    await expect(update.lifetime('install')).rejects.toThrow('quota or network failure');
    expect([...old.existing.keys()]).toEqual(['educare-shell:/educare/:v1']);
    expect(update.notices.at(-1)).toMatchObject({ ready: false, phase: 'error' });
  });

  it('serves the fixed shell for sensitive navigation without caching the URL', async () => {
    const app = harness();
    await app.lifetime('install');
    const response = await app.request(`${base}?share=SECRET`, {}, 'navigate');
    expect(await response?.text()).toBe(`${base}index.html`);
    expect([...app.existing.values()].flatMap(cache => [...cache.keys()]).join()).not.toContain(
      'SECRET',
    );
    expect(app.fetcher).toHaveBeenCalledTimes(3);
  });

  it('never handles API, authorization, query-bearing assets or outside-scope requests', async () => {
    const app = harness();
    await app.lifetime('install');
    for (const url of [
      'https://ai.test/chat',
      `${base}api/chat`,
      `${base}assets/app-v1.js?key=SECRET`,
      'https://school.test/other/',
    ]) {
      expect(await app.request(url)).toBeUndefined();
    }
    expect(
      await app.request(`${base}assets/app-v1.js`, { headers: { Authorization: 'Bearer SECRET' } }),
    ).toBeUndefined();
    expect(await app.request(`${base}index.html`, { method: 'POST' })).toBeUndefined();
  });

  it('keeps prior versions usable for existing tabs and never forces activation', async () => {
    const app = harness();
    await app.lifetime('install');
    await app.lifetime('activate');
    expect(app.skipWaiting).not.toHaveBeenCalled();
    const cache = await app.caches.open('educare-shell:/educare/:previous');
    await cache.put(`${base}assets/old-lazy.js`, new Response('old lazy chunk'));
    expect(await (await app.request(`${base}assets/old-lazy.js`))?.text()).toBe('old lazy chunk');
    expect(app.existing.size).toBe(2);
  });

  it('does not report ready after partial cache eviction', async () => {
    const app = harness();
    await app.lifetime('install');
    app.existing.values().next().value?.delete(`${base}assets/lazy-v1.js`);
    const reply = vi.fn();
    await app.lifetime('message', {
      data: { type: 'EDUCARE_OFFLINE_STATUS' },
      ports: [{ postMessage: reply }],
    });
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({ ready: false, completed: 2, total: 3 }),
    );
  });
});
