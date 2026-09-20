/** Build-time source generator: this module is not loaded by the app shell. */
export interface OfflineWorkerManifest {
  base: string;
  version: string;
  assets: string[];
}

export function createOfflineWorkerSource(manifest: OfflineWorkerManifest): string {
  return `/* EduCare static app shell. No user data or runtime responses are cached. */
'use strict';
const manifest = ${JSON.stringify(manifest)};
const base = new URL(manifest.base, self.location.origin);
const prefix = 'educare-shell:' + base.pathname + ':';
const cacheName = prefix + manifest.version;
const urls = manifest.assets.map(path => new URL(path, base).href);
const allowed = new Set(urls);
const shell = new URL('index.html', base).href;
const localClients = async () => (await self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
  .filter(client => client.url.startsWith(base.href));
const notify = async data => {
  for (const client of await localClients()) client.postMessage({ type: 'EDUCARE_OFFLINE', version: manifest.version, total: urls.length, ...data });
};
async function status() {
  const cache = await caches.open(cacheName);
  let completed = 0;
  for (const url of urls) if (await cache.match(url)) completed++;
  return { type: 'EDUCARE_OFFLINE', version: manifest.version, total: urls.length, completed, ready: completed === urls.length };
}
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(cacheName);
      let completed = 0;
      await notify({ phase: 'preparing', ready: false, completed });
      for (const url of urls) {
        const response = await fetch(new Request(url, { cache: 'reload', credentials: 'omit' }));
        if (!response.ok || response.type === 'opaque') throw new Error('Offline asset download failed');
        await cache.put(url, response);
        completed++;
        await notify({ phase: 'preparing', ready: false, completed });
      }
      await notify({ phase: 'ready', ready: true, completed });
    } catch (error) {
      await caches.delete(cacheName);
      await notify({ phase: 'error', ready: false, completed: 0 });
      throw error;
    }
  })());
});
self.addEventListener('activate', event => {
  // Previous versions are intentionally retained: an old tab can still import
  // its content-hashed lazy chunks. A failed update never destroys its shell.
  event.waitUntil(self.clients.claim());
});
self.addEventListener('message', event => {
  const reply = data => event.ports && event.ports[0] && event.ports[0].postMessage(data);
  if (event.data && event.data.type === 'EDUCARE_OFFLINE_STATUS') {
    event.waitUntil(status().then(reply));
  }
  if (event.data && event.data.type === 'EDUCARE_OFFLINE_ACTIVATE') {
    event.waitUntil((async () => {
      const clients = await localClients();
      const prepared = await status();
      if (!prepared.ready || clients.length !== 1 || !event.source || clients[0].id !== event.source.id) {
        reply({ activated: false, reason: 'Save your work and close other EduCare tabs before updating.' });
        return;
      }
      await self.skipWaiting();
      reply({ activated: true });
    })());
  }
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || request.headers.has('authorization') || url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) return;
  if (request.mode === 'navigate') {
    // Query strings may contain private share payloads; never use them as keys
    // or request them on the network through the offline cache.
    event.respondWith((async () => (await (await caches.open(cacheName)).match(shell)) || fetch(new Request(shell, { credentials: 'omit' })))());
    return;
  }
  if (url.search || (!allowed.has(url.href) && !url.pathname.startsWith(base.pathname + 'assets/'))) return;
  event.respondWith((async () => {
    const current = await caches.open(cacheName);
    const hit = await current.match(url.href);
    if (hit) return hit;
    for (const name of await caches.keys()) {
      if (name.startsWith(prefix) && name !== cacheName) {
        const previous = await (await caches.open(name)).match(url.href);
        if (previous) return previous;
      }
    }
    // A miss is not inserted. Only the immutable build manifest can populate
    // caches; AI/Turso/auth and arbitrary same-origin requests never enter it.
    return fetch(request);
  })());
});
`;
}
