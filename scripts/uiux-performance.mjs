/* global console, process */

import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const DEFAULT_URL = 'http://127.0.0.1:4178/educare/';
const DEFAULT_SAMPLES = 5;
const VIEWPORT = { width: 390, height: 844 };
const CPU_RATE = 4;
const DOWNLOAD_THROUGHPUT = (1.6 * 1024 * 1024) / 8;
const UPLOAD_THROUGHPUT = (750 * 1024) / 8;
const LATENCY_MS = 150;

const parseArgs = argv => {
  const options = {
    url: process.env.UIUX_URL || DEFAULT_URL,
    samples: Number(process.env.UIUX_SAMPLES || DEFAULT_SAMPLES),
    output: process.env.UIUX_OUTPUT || '',
    compare: process.env.UIUX_COMPARE || '',
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

const collectSample = async (browser, url, index) => {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);

  await cdp.send('Network.enable');
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
      resourceCount: resources.length,
      readyState: globalThis.document.readyState,
      horizontalOverflow: globalThis.document.documentElement.scrollWidth > globalThis.innerWidth,
    };
  });

  await context.close();
  return {
    sample: index,
    elapsedMs: Date.now() - startedAt,
    httpStatus: response?.status() ?? null,
    ...metrics,
  };
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  const browser = await chromium.launch({ headless: true });
  const samples = [];
  try {
    for (let index = 1; index <= options.samples; index += 1) {
      samples.push(await collectSample(browser, options.url, index));
    }
  } finally {
    await browser.close();
  }

  const result = {
    measuredAt: new Date().toISOString(),
    url: options.url,
    conditions: {
      viewport: `${VIEWPORT.width}x${VIEWPORT.height}`,
      cpuRate: CPU_RATE,
      downloadMbps: 1.6,
      latencyMs: LATENCY_MS,
    },
    samples,
    medianLcpMs: median(samples.map(sample => sample.lcpMs).filter(value => value != null)),
    medianInitialJsTransferBytes: median(samples.map(sample => sample.initialJsTransferBytes)),
    medianAllJsTransferBytes: median(samples.map(sample => sample.allJsTransferBytes)),
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
