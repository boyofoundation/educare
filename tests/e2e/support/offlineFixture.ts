import type { BrowserContext, Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createOfflineWorkerSource } from '../../../services/offlineWorkerSource';

type Failure = 'network' | 'quota' | undefined;

/** Serve actual dist assets, with a controllable new release and install faults.
 * No Playwright routing: these requests originate inside a real service worker.
 */
export async function releaseServer() {
  const dist = path.resolve('dist');
  const manifest = JSON.parse(await readFile(path.join(dist, 'offline-manifest.json'), 'utf8'));
  let release = 'N';
  let failure: Failure;
  let faults = 0;
  const mime: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.webmanifest': 'application/manifest+json',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.ttf': 'font/ttf',
  };
  const server: Server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const name = decodeURIComponent(url.pathname.replace(/^\/educare\//, '')) || 'index.html';
      if (!url.pathname.startsWith('/educare/') || name.split('/').some(p => p === '..')) {
        response.writeHead(404).end();
        return;
      }
      const probe = `assets/release-${release}.js`;
      const current = {
        ...manifest,
        version: `${manifest.version}-${release}`,
        assets: [...manifest.assets, probe],
      };
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Content-Type', mime[path.extname(name)] ?? 'application/octet-stream');
      if (name === 'service-worker.js') {
        // Fault injection is confined to this fixture's newly installing worker.
        // It exercises real browser install/rollback, not a mocked SW lifecycle.
        const quota =
          failure === 'quota'
            ? `
let writes = 0;
const originalPut = Cache.prototype.put;
Cache.prototype.put = function(...args) {
  if (++writes === 3) return Promise.reject(new DOMException('fixture quota exhausted', 'QuotaExceededError'));
  return originalPut.apply(this, args);
};\n`
            : '';
        response.end(quota + createOfflineWorkerSource(current));
      } else if (name === 'offline-manifest.json') {
        response.end(JSON.stringify(current));
      } else if (name === probe) {
        if (failure === 'network') {
          faults++;
          response.writeHead(503).end('fixture interrupted download');
        } else {
          response.end(`export const release = ${JSON.stringify(release)};`);
        }
      } else if (name.startsWith('assets/release-')) {
        response.writeHead(404).end('old release removed from server');
      } else {
        let body = await readFile(path.join(dist, name));
        if (name === 'index.html') {
          body = Buffer.from(
            body
              .toString()
              .replace('</head>', `<meta name="fixture-release" content="${release}"></head>`),
          );
        }
        response.end(body);
      }
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('fixture server did not bind');
  }
  let closed = false;
  const close = async () => {
    if (closed) {
      return;
    }
    closed = true;
    await new Promise<void>((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
  };
  return {
    url: `http://127.0.0.1:${address.port}/educare/`,
    version: (value: string) => `${manifest.version}-${value}`,
    deploy: (value: string, fault?: Failure) => {
      release = value;
      failure = fault;
    },
    faults: () => faults,
    close,
    disconnect: async (page: Page, context: BrowserContext, browserName: string) => {
      // Stop the actual origin for both engines. WebKit's setOffline(true)
      // fails cached navigations with an internal error in this pinned runner;
      // a stopped origin plus an uncached-fetch oracle tests real unavailability.
      await close();
      const uncachedFails = await page.evaluate(async () => {
        try {
          await fetch('./uncached-network-proof?offline=1', { cache: 'no-store' });
          return false;
        } catch {
          return true;
        }
      });
      if (!uncachedFails) {
        throw new Error('Offline fixture still has network access');
      }
      if (browserName !== 'webkit') {
        await context.setOffline(true);
      }
    },
  };
}
