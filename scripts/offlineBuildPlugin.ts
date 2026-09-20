import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { Plugin, ResolvedConfig } from 'vite';
import { createOfflineWorkerSource } from '../services/offlineWorkerSource';

/** Native SW, built from the actual production output (including lazy chunks). */
export function offlineBuildPlugin(): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'educare-offline-shell',
    apply: 'build',
    configResolved(resolved) {
      config = resolved;
    },
    async closeBundle() {
      const output = path.resolve(config.root, config.build.outDir);
      const require = createRequire(path.join(config.root, 'package.json'));
      await mkdir(path.join(output, 'js'), { recursive: true });
      await copyFile(
        require.resolve('pdfjs-dist/build/pdf.worker.min.mjs'),
        path.join(output, 'js/pdf.worker.js'),
      );
      for (const name of ['manifest.webmanifest', 'app-icon.svg']) {
        await copyFile(path.join(config.root, 'static', name), path.join(output, name));
      }
      const assetPaths: string[] = [];
      async function walk(relative: string) {
        for (const entry of await readdir(path.join(output, relative), { withFileTypes: true })) {
          const file = path.posix.join(relative, entry.name);
          if (entry.isDirectory()) {
            await walk(file);
          } else if (!file.endsWith('.map')) {
            assetPaths.push(file);
          }
        }
      }
      await walk('assets');
      const assets = [
        'index.html',
        'manifest.webmanifest',
        'app-icon.svg',
        'js/pdf.worker.js',
        ...assetPaths,
      ].sort();
      const hash = createHash('sha256');
      for (const file of assets) {
        hash.update(file).update(await readFile(path.join(output, file)));
      }
      const manifest = { base: config.base, version: hash.digest('hex').slice(0, 20), assets };
      await writeFile(path.join(output, 'service-worker.js'), createOfflineWorkerSource(manifest));
      await writeFile(
        path.join(output, 'offline-manifest.json'),
        JSON.stringify(manifest, null, 2),
      );
    },
  };
}
