/* global URL, console, process */

import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const DEFAULT_URL = 'http://127.0.0.1:4178/educare/';
const DEFAULT_SAMPLES = 5;
const VIEWPORT = { width: 390, height: 844 };
const CPU_RATE = 4;
const DOWNLOAD_THROUGHPUT = (1.6 * 1024 * 1024) / 8;
const UPLOAD_THROUGHPUT = (750 * 1024) / 8;
const LATENCY_MS = 150;
const REPOSITORY_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

const parseArgs = argv => {
  const options = {
    url: process.env.UIUX_URL || DEFAULT_URL,
    samples: Number(process.env.UIUX_SAMPLES || DEFAULT_SAMPLES),
    output: process.env.UIUX_OUTPUT || '',
    compare: process.env.UIUX_COMPARE || '',
    artifactDir: process.env.UIUX_ARTIFACT_DIR || '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--url' && argv[index + 1]) {
      options.url = argv[++index];
    } else if (argument === '--samples' && argv[index + 1]) {
      options.samples = Number(argv[++index]);
    } else if (argument === '--output' && argv[index + 1]) {
      options.output = argv[++index];
    } else if (argument === '--compare' && argv[index + 1]) {
      options.compare = argv[++index];
    } else if (argument === '--artifact-dir' && argv[index + 1]) {
      options.artifactDir = argv[++index];
    }
  }

  if (!Number.isInteger(options.samples) || options.samples < 1) {
    throw new Error(`--samples must be a positive integer (received ${options.samples})`);
  }
  return options;
};

const median = values => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
};

const getDistAssetPath = resourceUrl => {
  try {
    const pathname = new URL(resourceUrl).pathname;
    const baseMarker = '/educare/';
    const baseIndex = pathname.indexOf(baseMarker);
    const relativePath =
      baseIndex >= 0 ? pathname.slice(baseIndex + baseMarker.length) : pathname.replace(/^\//, '');
    if (!relativePath.startsWith('assets/')) {
      return null;
    }
    return resolve(REPOSITORY_ROOT, 'dist', relativePath);
  } catch {
    return null;
  }
};

const collectGzipMetrics = async scripts => {
  const metrics = await Promise.all(
    scripts.map(async script => {
      const assetPath = getDistAssetPath(script.name);
      if (!assetPath) {
        return { ...script, gzipBytes: null, assetPath: null };
      }
      try {
        const contents = await readFile(assetPath);
        return {
          ...script,
          gzipBytes: gzipSync(contents, { level: 9 }).byteLength,
          assetPath,
        };
      } catch {
        return { ...script, gzipBytes: null, assetPath };
      }
    }),
  );
  const gzipBytes = entries => entries.reduce((total, entry) => total + (entry.gzipBytes || 0), 0);
  return {
    scripts: metrics,
    initialJsGzipBytes: gzipBytes(metrics.filter(entry => entry.initial)),
    allJsGzipBytes: gzipBytes(metrics),
  };
};

const collectSample = async (browser, url, index, options) => {
  const artifactDir = options.artifactDir && index === 1 ? resolve(options.artifactDir) : null;
  if (artifactDir) {
    await mkdir(artifactDir, { recursive: true });
  }
  const context = await browser.newContext({
    viewport: VIEWPORT,
    ...(artifactDir
      ? { recordHar: { path: resolve(artifactDir, `sample-${index}.har`), mode: 'full' } }
      : {}),
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  if (artifactDir) {
    await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
  }

  await cdp.send('Network.enable');
  await cdp.send('Performance.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: LATENCY_MS,
    downloadThroughput: DOWNLOAD_THROUGHPUT,
    uploadThroughput: UPLOAD_THROUGHPUT,
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_RATE });

  await page.addInitScript(() => {
    globalThis.__uiuxLcp = null;
    try {
      const observer = new globalThis.PerformanceObserver(list => {
        const latest = list.getEntries().at(-1);
        if (latest) {
          globalThis.__uiuxLcp = latest.startTime;
        }
      });
      observer.observe({ type: 'largest-contentful-paint', buffered: true });
    } catch {
      // Some headless Chromium builds omit LCP. Keep the result explicit below.
    }
  });

  const startedAt = Date.now();
  const response = await page.goto(url, { waitUntil: 'load', timeout: 120_000 });
  await page.waitForTimeout(2_000);
  const metrics = await page.evaluate(() => {
    const lcpEntries = globalThis.performance.getEntriesByType('largest-contentful-paint');
    const latestLcp = lcpEntries.at(-1);
    const lcp = latestLcp?.startTime ?? globalThis.__uiuxLcp ?? null;
    const resources = globalThis.performance.getEntriesByType('resource');
    const scripts = resources.filter(
      entry => entry.initiatorType === 'script' || /\/assets\/[^/]+\.js(?:$|\?)/.test(entry.name),
    );
    const initialScripts = scripts.filter(
      entry => entry.responseEnd <= Math.max(lcp ?? 2_000, 2_000),
    );
    const transferBytes = entries =>
      entries.reduce(
        (total, entry) => total + (entry.transferSize || entry.encodedBodySize || 0),
        0,
      );

    return {
      lcpMs: lcp,
      initialJsTransferBytes: transferBytes(initialScripts),
      allJsTransferBytes: transferBytes(scripts),
      scriptTimings: scripts.map(entry => ({
        name: entry.name,
        startTime: entry.startTime,
        responseEnd: entry.responseEnd,
        duration: entry.duration,
        transferSize: entry.transferSize || 0,
        encodedBodySize: entry.encodedBodySize || 0,
        decodedBodySize: entry.decodedBodySize || 0,
        initial: initialScripts.includes(entry),
      })),
      resourceCount: resources.length,
      readyState: globalThis.document.readyState,
      horizontalOverflow: globalThis.document.documentElement.scrollWidth > globalThis.innerWidth,
    };
  });

  const performanceSnapshot = await cdp.send('Performance.getMetrics');
  const browserMetrics = Object.fromEntries(
    performanceSnapshot.metrics
      .filter(metric =>
        [
          'ScriptDuration',
          'TaskDuration',
          'LayoutDuration',
          'RecalcStyleDuration',
          'JSHeapUsedSize',
        ].includes(metric.name),
      )
      .map(metric => [
        metric.name.endsWith('Duration') ? `${metric.name}Ms` : metric.name,
        metric.name.endsWith('Duration') ? metric.value * 1000 : metric.value,
      ]),
  );

  const gzipMetrics = await collectGzipMetrics(metrics.scriptTimings);
  if (artifactDir) {
    await context.tracing.stop({ path: resolve(artifactDir, `sample-${index}.trace.zip`) });
  }
  await context.close();
  return {
    sample: index,
    elapsedMs: Date.now() - startedAt,
    httpStatus: response?.status() ?? null,
    artifacts: artifactDir
      ? {
          har: resolve(artifactDir, `sample-${index}.har`),
          trace: resolve(artifactDir, `sample-${index}.trace.zip`),
        }
      : undefined,
    ...metrics,
    ...gzipMetrics,
    browserMetrics,
  };
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  const browser = await chromium.launch({ headless: true });
  const samples = [];
  try {
    for (let index = 1; index <= options.samples; index += 1) {
      samples.push(await collectSample(browser, options.url, index, options));
    }
  } finally {
    await browser.close();
  }

  const result = {
    measuredAt: new Date().toISOString(),
    url: options.url,
    conditions: {
      browserVersion: browser.version(),
      headless: true,
      viewport: `${VIEWPORT.width}x${VIEWPORT.height}`,
      cpuRate: CPU_RATE,
      downloadMbps: 1.6,
      latencyMs: LATENCY_MS,
    },
    samples,
    medianLcpMs: median(samples.map(sample => sample.lcpMs).filter(value => value != null)),
    medianInitialJsTransferBytes: median(samples.map(sample => sample.initialJsTransferBytes)),
    medianAllJsTransferBytes: median(samples.map(sample => sample.allJsTransferBytes)),
    medianInitialJsGzipBytes: median(samples.map(sample => sample.initialJsGzipBytes)),
    medianAllJsGzipBytes: median(samples.map(sample => sample.allJsGzipBytes)),
  };

  if (options.compare) {
    const baseline = JSON.parse(await readFile(resolve(options.compare), 'utf8'));
    result.comparison = {
      baselineMedianLcpMs: baseline.medianLcpMs ?? null,
      lcpDeltaMs:
        result.medianLcpMs == null || baseline.medianLcpMs == null
          ? null
          : result.medianLcpMs - baseline.medianLcpMs,
      lcpDeltaPercent:
        result.medianLcpMs == null || baseline.medianLcpMs == null || baseline.medianLcpMs === 0
          ? null
          : ((result.medianLcpMs - baseline.medianLcpMs) / baseline.medianLcpMs) * 100,
      baselineMedianInitialJsTransferBytes: baseline.medianInitialJsTransferBytes ?? null,
      initialJsTransferDeltaBytes:
        result.medianInitialJsTransferBytes == null || baseline.medianInitialJsTransferBytes == null
          ? null
          : result.medianInitialJsTransferBytes - baseline.medianInitialJsTransferBytes,
      baselineMedianInitialJsGzipBytes: baseline.medianInitialJsGzipBytes ?? null,
      initialJsGzipDeltaBytes:
        result.medianInitialJsGzipBytes == null || baseline.medianInitialJsGzipBytes == null
          ? null
          : result.medianInitialJsGzipBytes - baseline.medianInitialJsGzipBytes,
    };
  }

  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  if (options.output) {
    const outputPath = resolve(options.output);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, serialized, 'utf8');
  }
  process.stdout.write(serialized);
};

main().catch(error => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
