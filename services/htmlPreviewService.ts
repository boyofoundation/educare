import {
  HtmlProject,
  HtmlProjectFile,
  HtmlProjectFileKind,
  HtmlProjectPreviewArtifact,
  HtmlProjectPreviewDiagnostics,
  HtmlProjectPreviewUrlType,
  PREVIEW_WARNING_KINDS,
} from '../types';
import { htmlProjectStore } from './htmlProjectStore';
import {
  buildVfsBootstrapScript,
  serializeVfsManifest,
  type VfsManifest,
  type VfsManifestEntryModule,
  type VfsManifestFile,
} from './previewVfsBootstrap';
import { rewriteModuleSpecifiers } from './previewVfsRewriter';

const EXTERNAL_REF_PATTERN = /^(?:[a-z]+:|#|\/\/)/i;

const normalizePath = (path: string): string => (path.startsWith('/') ? path : `/${path}`);

const resolveRelativePath = (basePath: string, targetPath: string): string => {
  if (EXTERNAL_REF_PATTERN.test(targetPath)) {
    return targetPath;
  }

  if (targetPath.startsWith('/')) {
    return normalizePath(targetPath);
  }

  const baseSegments = basePath.split('/').slice(0, -1);
  for (const segment of targetPath.split('/')) {
    if (!segment || segment === '.') {
      continue;
    }
    if (segment === '..') {
      baseSegments.pop();
      continue;
    }
    baseSegments.push(segment);
  }

  return normalizePath(baseSegments.join('/'));
};

const toDataUrl = (html: string): string =>
  `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;

const buildReadyDiagnostics = (warnings: string[]): HtmlProjectPreviewDiagnostics => ({
  category: warnings.length > 0 ? 'external_dependency_warning' : 'none',
  outcome: 'ready',
  repairable: false,
  summary:
    warnings.length > 0
      ? 'Preview rendered with external dependency warnings.'
      : 'Preview rendered successfully.',
  warnings,
  details: warnings.length > 0 ? warnings : undefined,
});

const buildMissingEntrypointDiagnostics = (entryFile: string): HtmlProjectPreviewDiagnostics => ({
  category: 'missing_entrypoint',
  outcome: 'repairable_error',
  repairable: true,
  summary: `Entrypoint ${entryFile} does not exist.`,
  missingPaths: [entryFile],
  details: ['Set a valid entry file or recreate the missing entrypoint file.'],
});

const buildMissingReferenceDiagnostics = (
  missingPaths: string[],
  warnings: string[],
): HtmlProjectPreviewDiagnostics => ({
  category: 'missing_reference',
  outcome: 'repairable_error',
  repairable: true,
  summary: `Missing preview dependencies: ${missingPaths.join(', ')}.`,
  missingPaths,
  warnings,
  details: ['Restore the missing file(s) or update the HTML references before retrying preview.'],
});

/**
 * G1 — Build the runtime bridge `<script>` injected into preview-ready artifacts.
 *
 * The bridge:
 *   - Reads projectId + previewVersion from a sibling `<script type="application/json" data-harness-meta>`
 *     element (never from URL parsing — sandboxed blobs have no usable query params).
 *   - Captures window 'error', 'unhandledrejection', and wraps console.error / console.warn.
 *   - Deduplicates entries by (kind+message), caps at 50, and truncates messages to ~500 chars.
 *   - On 'vfs:ready' (dispatched by the VFS bootstrap — success or degraded), drains the
 *     bootstrap's error buffer (window.__vfsErrors__) and postMessage `{ type:'ready',
 *     projectId, previewVersion }` to parent. The bootstrap always fires vfs:ready, so the
 *     ready-ack contract never deadlocks (V1/V4).
 *   - PostMessage `{ type:'runtime-errors', ... }` to parent — flushed on first error and at
 *     most every ~250ms, plus a final flush on pagehide/beforeunload.
 *
 * The bridge is self-contained (no external references) and idempotent — it guards against
 * double-install via a `window.__harnessRuntimeBridgeInstalled__` sentinel.
 */
const buildHarnessMetaScript = (projectId: string, previewVersion: number): string => {
  const meta = JSON.stringify({ projectId, previewVersion });
  return `<script type="application/json" data-harness-meta>${meta}</script>`;
};

export const buildRuntimeBridgeScript = (): string => {
  // Body is serialized as an IIFE so it cannot collide with project globals. The helper
  // implementations mirror `dedupeAndCapEntries` / `truncateMessage` in previewRuntimeDiagnostics.ts.
  const body = `
    (function () {
      if (typeof window === 'undefined' || window.__harnessRuntimeBridgeInstalled__) {
        return;
      }
      try {
        Object.defineProperty(window, '__harnessRuntimeBridgeInstalled__', {
          value: true,
          configurable: false,
          writable: false,
        });
      } catch (_) {
        window.__harnessRuntimeBridgeInstalled__ = true;
      }

      var MAX_ENTRIES = 50;
      var MAX_MESSAGE = 500;
      var FLUSH_THROTTLE = 250;

      function readMeta() {
        try {
          var node = document.currentScript
            ? document.currentScript.previousElementSibling
            : null;
          if (!node) {
            var nodes = document.querySelectorAll('script[data-harness-meta]');
            node = nodes.length > 0 ? nodes[nodes.length - 1] : null;
          }
          if (!node || !node.textContent) {
            return null;
          }
          return JSON.parse(node.textContent);
        } catch (_) {
          return null;
        }
      }

      var meta = readMeta();
      if (!meta || typeof meta.projectId !== 'string' || typeof meta.previewVersion !== 'number') {
        return;
      }

      var projectId = meta.projectId;
      var previewVersion = meta.previewVersion;
      var entries = [];
      var seen = {};
      var flushScheduled = false;
      var pendingFlush = null;

      function truncate(msg, max) {
        if (typeof msg !== 'string') {
          msg = String(msg == null ? '' : msg);
        }
        var limit = typeof max === 'number' ? max : MAX_MESSAGE;
        if (msg.length <= limit) {
          return msg;
        }
        return msg.slice(0, limit) + '\\u2026';
      }

      function addEntry(kind, message, extras) {
        if (typeof message !== 'string' || message.length === 0) {
          return;
        }
        var signature = kind + '::' + message;
        if (Object.prototype.hasOwnProperty.call(seen, signature)) {
          return;
        }
        seen[signature] = true;
        var entry = { kind: kind, message: truncate(message), timestamp: Date.now() };
        if (extras) {
          if (extras.stack) { entry.stack = truncate(extras.stack, 1000); }
          if (extras.source) { entry.source = extras.source; }
          if (typeof extras.lineno === 'number') { entry.lineno = extras.lineno; }
          if (typeof extras.colno === 'number') { entry.colno = extras.colno; }
        }
        entries.push(entry);
        if (entries.length > MAX_ENTRIES) {
          entries = entries.slice(entries.length - MAX_ENTRIES);
        }
      }

      function postToParent(type, payload) {
        try {
          var msg = Object.assign(
            { type: type, projectId: projectId, previewVersion: previewVersion },
            payload || {}
          );
          if (window.parent && typeof window.parent.postMessage === 'function') {
            window.parent.postMessage(msg, '*');
          }
        } catch (_) {
          /* swallow — never let telemetry break the page */
        }
      }

      function flushErrors(force) {
        if (!force && entries.length === 0) {
          return;
        }
        if (!force && flushScheduled) {
          return;
        }
        if (!force && pendingFlush) {
          return;
        }
        if (force) {
          if (pendingFlush) {
            clearTimeout(pendingFlush);
            pendingFlush = null;
          }
          flushScheduled = false;
          postToParent('runtime-errors', { errors: entries.slice() });
          return;
        }
        flushScheduled = true;
        pendingFlush = setTimeout(function () {
          pendingFlush = null;
          flushScheduled = false;
          postToParent('runtime-errors', { errors: entries.slice() });
        }, FLUSH_THROTTLE);
      }

      window.addEventListener('error', function (event) {
        var message = (event && (event.message || event.error && event.error.message)) || 'error';
        addEntry('error', message, {
          stack: event && event.error && event.error.stack,
          source: event && event.filename,
          lineno: event && event.lineno,
          colno: event && event.colno,
        });
        flushErrors(false);
      });

      window.addEventListener('unhandledrejection', function (event) {
        var reason = event && event.reason;
        var message = 'object' === typeof reason && reason !== null
          ? (reason.message || String(reason))
          : String(reason == null ? '' : reason);
        addEntry('unhandledrejection', message, {
          stack: reason && reason.stack,
        });
        flushErrors(false);
      });

      var origConsoleError = console.error ? console.error.bind(console) : null;
      var origConsoleWarn = console.warn ? console.warn.bind(console) : null;
      if (typeof console.error === 'function') {
        console.error = function () {
          try {
            var parts = [];
            for (var i = 0; i < arguments.length; i++) {
              parts.push(typeof arguments[i] === 'object' ? safeStringify(arguments[i]) : String(arguments[i]));
            }
            addEntry('console_error', parts.join(' '));
            flushErrors(false);
          } catch (_) { /* ignore */ }
          if (origConsoleError) {
            origConsoleError.apply(console, arguments);
          }
        };
      }
      if (typeof console.warn === 'function') {
        console.warn = function () {
          try {
            var parts = [];
            for (var i = 0; i < arguments.length; i++) {
              parts.push(typeof arguments[i] === 'object' ? safeStringify(arguments[i]) : String(arguments[i]));
            }
            addEntry('console_warn', parts.join(' '));
            flushErrors(false);
          } catch (_) { /* ignore */ }
          if (origConsoleWarn) {
            origConsoleWarn.apply(console, arguments);
          }
        };
      }

      function safeStringify(value) {
        try {
          return JSON.stringify(value);
        } catch (_) {
          return String(value);
        }
      }

      // VFS bootstrap coordination (V1/V4). The bootstrap always dispatches a 'vfs:ready'
      // CustomEvent and sets window.__vfsReady__={done:true} when the VFS is assembled (success
      // or degraded). The bridge owns the parent-facing 'ready' ack and drains the bootstrap's
      // error buffer (window.__vfsErrors__) so bootstrap-time / fetch-miss errors surface as
      // runtime-errors. Replaces the legacy window 'load' ready trigger.
      function drainVfsErrors() {
        try {
          var buffered = window.__vfsErrors__;
          if (buffered && buffered.length) {
            for (var i = 0; i < buffered.length; i++) {
              var entry = buffered[i];
              addEntry(entry.kind || 'error', entry.message || '');
            }
            window.__vfsErrors__ = [];
          }
        } catch (_) { /* ignore */ }
      }

      var readySent = false;
      function sendReady() {
        if (readySent) {
          return;
        }
        readySent = true;
        drainVfsErrors();
        flushErrors(true);
        postToParent('ready', {});
      }

      if (window.__vfsReady__ && window.__vfsReady__.done) {
        // Bootstrap already finished before the bridge installed.
        sendReady();
      } else {
        window.addEventListener('vfs:ready', sendReady);
      }

      function finalFlush() {
        flushErrors(true);
      }
      window.addEventListener('pagehide', finalFlush);
      window.addEventListener('beforeunload', finalFlush);
    })();
  `
    .replace(/\n\s*/g, '\n')
    .trim();

  return `<script data-harness-bridge>${body}</script>`;
};

/**
 * Inject the G1 runtime bridge (meta + bridge script) into the artifact HTML immediately
 * before `</body>` (or append to the end of the document if no body close tag is present).
 * No-op when `previewReady` is false.
 */
const injectRuntimeBridge = (html: string, projectId: string, previewVersion: number): string => {
  const meta = buildHarnessMetaScript(projectId, previewVersion);
  const bridge = buildRuntimeBridgeScript();
  const injection = `${meta}\n${bridge}`;

  const bodyClose = /<\/body>/i.exec(html);
  if (bodyClose) {
    return `${html.slice(0, bodyClose.index)}${injection}\n${html.slice(bodyClose.index)}`;
  }
  const htmlClose = /<\/html>/i.exec(html);
  if (htmlClose) {
    return `${html.slice(0, htmlClose.index)}${injection}\n${html.slice(htmlClose.index)}`;
  }
  return `${html}\n${injection}`;
};

// ============================================================================
// VFS sandbox (選項 A, plan v2) — manifest + bootstrap single pipeline (V1)
// ============================================================================

const MIME_BY_KIND: Record<HtmlProjectFileKind, string> = {
  html: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  json: 'application/json',
  svg: 'image/svg+xml',
  md: 'text/markdown',
  asset: 'application/octet-stream',
};

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  apng: 'image/apng',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  json: 'application/json',
  csv: 'text/csv',
  txt: 'text/plain',
  xml: 'application/xml',
};

const extOf = (path: string): string => {
  const seg = path.split('/').pop() || '';
  const dot = seg.lastIndexOf('.');
  return dot > 0 ? seg.slice(dot + 1).toLowerCase() : '';
};

const mimeForFile = (path: string, kind: HtmlProjectFileKind): string => {
  const ext = extOf(path);
  if (MIME_BY_EXT[ext]) {
    return MIME_BY_EXT[ext];
  }
  return MIME_BY_KIND[kind] || 'application/octet-stream';
};

interface VfsBuildContext {
  manifestFiles: VfsManifestFile[];
  manifestPaths: Set<string>;
  entryModules: VfsManifestEntryModule[];
  classicScriptPaths: Set<string>;
  inlineCounter: number;
}

const createVfsBuildContext = (): VfsBuildContext => ({
  manifestFiles: [],
  manifestPaths: new Set(),
  entryModules: [],
  classicScriptPaths: new Set(),
  inlineCounter: 0,
});

const addManifestFile = (ctx: VfsBuildContext, file: VfsManifestFile): void => {
  if (!ctx.manifestPaths.has(file.path)) {
    ctx.manifestPaths.add(file.path);
    ctx.manifestFiles.push(file);
  }
};

/** V10: remove `<base>` tags (they break VFS path assumptions) and record a warning each. */
const removeBaseTags = (html: string, warnings: string[]): string =>
  html.replace(/<base\b[^>]*>/gi, match => {
    warnings.push(`${PREVIEW_WARNING_KINDS.baseTagRemoved}: ${match}`);
    return '';
  });

/**
 * Extract `<script type="module">` (external + inline) from the HTML: rewrite specifiers (V3),
 * register the module source as a virtual manifest file, record the entry, and remove the tag
 * so the bootstrap can load modules via the import map AFTER it is assembled. Classic scripts
 * are handled separately by `inlineClassicScripts`.
 */
const extractModuleScripts = (
  html: string,
  entryPath: string,
  fileMap: Map<string, HtmlProjectFile>,
  warnings: string[],
  missing: Set<string>,
  ctx: VfsBuildContext,
): string => {
  const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  return html.replace(scriptPattern, (full, attrs: string, body: string) => {
    if (!/\btype\s*=\s*['"]?module['"]?/i.test(attrs)) {
      return full;
    }
    const srcMatch = /\bsrc\s*=\s*['"]([^'"]+)['"]/i.exec(attrs);
    if (srcMatch) {
      const src = srcMatch[1];
      if (EXTERNAL_REF_PATTERN.test(src)) {
        warnings.push(`保留外部模組資源：${src}`);
        return full;
      }
      const resolved = resolveRelativePath(entryPath, src);
      const file = fileMap.get(resolved);
      if (!file) {
        missing.add(resolved);
        return full;
      }
      ctx.entryModules.push({ path: resolved });
      return '';
    }
    // Inline module → synthetic file at root so relative specifiers resolve correctly.
    const syntheticPath = `/__vfs_inline_module_${ctx.inlineCounter++}.js`;
    const { code } = rewriteModuleSpecifiers(body, syntheticPath);
    addManifestFile(ctx, {
      path: syntheticPath,
      kind: 'js',
      mime: 'text/javascript',
      encoding: 'utf-8',
      content: code,
      isModule: true,
    });
    ctx.entryModules.push({ path: syntheticPath });
    return '';
  });
};

/**
 * Inline classic `<script src="local">` (module tags already removed). Tracks which JS paths
 * are classic so they are excluded from the import map (a file used as a classic script must
 * not also be resolved as a module).
 */
const inlineClassicScripts = (
  html: string,
  entryPath: string,
  fileMap: Map<string, HtmlProjectFile>,
  warnings: string[],
  missing: Set<string>,
  classicScriptPaths: Set<string>,
): string => {
  const scriptPattern = /<script([^>]*?)src=['"]([^'"]+)['"]([^>]*)><\/script>/gi;
  return html.replace(scriptPattern, (full, beforeSrc: string, src: string, afterSrc: string) => {
    if (EXTERNAL_REF_PATTERN.test(src)) {
      warnings.push(`保留外部腳本資源：${src}`);
      return full;
    }
    const resolved = resolveRelativePath(entryPath, src);
    const file = fileMap.get(resolved);
    if (!file) {
      missing.add(resolved);
      return full;
    }
    classicScriptPaths.add(resolved);
    return `<script${beforeSrc}${afterSrc} data-project-path="${resolved}">\n${file.content}\n</script>`;
  });
};

/**
 * Tag local asset references (`<img>/<source>/<video>/<audio>` src, `<link rel=icon>` href) with
 * `data-vfs="/resolved/path"` so the bootstrap can rewrite them to blob URLs at DOMContentLoaded,
 * and detect statically-missing asset references (blocking). `srcset` references are checked for
 * missing files (the bootstrap rewrites srcset independently at runtime).
 */
const tagVfsAssets = (
  html: string,
  entryPath: string,
  fileMap: Map<string, HtmlProjectFile>,
  warnings: string[],
  missing: Set<string>,
): string => {
  const checkSrcset = (srcset: string) => {
    srcset.split(',').forEach(candidate => {
      const trimmed = candidate.trim();
      if (!trimmed) {
        return;
      }
      const url = trimmed.split(/\s/)[0].split('#')[0].split('?')[0];
      if (!url || EXTERNAL_REF_PATTERN.test(url)) {
        return;
      }
      const resolved = resolveRelativePath(entryPath, url);
      if (!fileMap.has(resolved)) {
        missing.add(resolved);
      }
    });
  };

  let out = html.replace(
    /<(img|source|video|audio|image)\b([^>]*)>/gi,
    (full, _tag: string, attrs: string) => {
      let next = full;
      const srcMatch = /\bsrc\s*=\s*['"]([^'"]+)['"]/i.exec(attrs);
      if (srcMatch && !EXTERNAL_REF_PATTERN.test(srcMatch[1])) {
        const resolved = resolveRelativePath(entryPath, srcMatch[1]);
        if (!fileMap.has(resolved)) {
          missing.add(resolved);
        }
        if (!/\bdata-vfs\s*=/.test(attrs)) {
          next = `${full.slice(0, full.lastIndexOf('>'))} data-vfs="${resolved}">`;
        }
      }
      const srcsetMatch = /\bsrcset\s*=\s*['"]([^'"]+)['"]/i.exec(attrs);
      if (srcsetMatch) {
        checkSrcset(srcsetMatch[1]);
      }
      return next;
    },
  );

  // <link rel="icon"|"apple-touch-icon"|"shortcut icon" href="local">
  out = out.replace(/<link\b([^>]*)>/gi, (full, attrs: string) => {
    if (!/\brel\s*=\s*['"]?(?:icon|apple-touch-icon|shortcut icon|mask-icon)['"]?/i.test(attrs)) {
      return full;
    }
    const hrefMatch = /\bhref\s*=\s*['"]([^'"]+)['"]/i.exec(attrs);
    if (!hrefMatch || EXTERNAL_REF_PATTERN.test(hrefMatch[1])) {
      return full;
    }
    const resolved = resolveRelativePath(entryPath, hrefMatch[1]);
    if (!fileMap.has(resolved)) {
      missing.add(resolved);
      return full;
    }
    if (/\bdata-vfs\s*=/.test(attrs)) {
      return full;
    }
    return `${full.slice(0, full.lastIndexOf('>'))} data-vfs="${resolved}">`;
  });

  return out;
};

const buildVfsManifestScript = (manifest: VfsManifest): string =>
  `<script type="application/json" data-vfs-manifest>${serializeVfsManifest(manifest)}</script>`;

/**
 * Inject the VFS scaffolding (manifest + bootstrap) at the very START of `<head>` so the
 * bootstrap — which reads the sibling `<script data-vfs-manifest>` and runs before any module
 * script — is the first thing the parser executes. Falls back to before `<html>` or doc start.
 */
const injectVfsScaffolding = (
  html: string,
  manifest: VfsManifest,
  projectId: string,
  previewVersion: number,
): string => {
  const manifestScript = buildVfsManifestScript(manifest);
  const bootstrap = buildVfsBootstrapScript({ projectId, previewVersion });
  const injection = `${manifestScript}\n${bootstrap}`;

  const headOpen = /<head([^>]*)>/i.exec(html);
  if (headOpen) {
    const idx = headOpen.index + headOpen[0].length;
    return `${html.slice(0, idx)}\n${injection}${html.slice(idx)}`;
  }
  const htmlOpen = /<html([^>]*)>/i.exec(html);
  if (htmlOpen) {
    const idx = htmlOpen.index + htmlOpen[0].length;
    return `${html.slice(0, idx)}\n${injection}${html.slice(idx)}`;
  }
  return `${injection}\n${html}`;
};

class HtmlPreviewService {
  private previewUrls = new Map<string, string>();

  private inlineCss(
    html: string,
    entryFile: string,
    fileMap: Map<string, HtmlProjectFile>,
    warnings: string[],
    missing: Set<string>,
  ): string {
    const linkPattern = /<link([^>]*?)href=['"]([^'"]+)['"]([^>]*?)>/gi;

    return html.replace(linkPattern, (fullMatch, beforeHref, href, afterHref) => {
      const relAttr = `${beforeHref} ${afterHref}`;
      if (!/rel=['"]?stylesheet['"]?/i.test(relAttr)) {
        return fullMatch;
      }

      if (EXTERNAL_REF_PATTERN.test(href)) {
        warnings.push(`保留外部樣式資源：${href}`);
        return fullMatch;
      }

      const resolvedPath = resolveRelativePath(entryFile, href);
      const cssFile = fileMap.get(resolvedPath);
      if (!cssFile) {
        missing.add(resolvedPath);
        return fullMatch;
      }

      return `<style data-project-path="${resolvedPath}">\n${cssFile.content}\n</style>`;
    });
  }

  /**
   * Build a preview artifact HTML from an in-memory project + files (no store access). Exposed
   * (non-private) so the Playwright E2E can render through the REAL build pipeline rather than a
   * hand-assembled manifest, regression-covering the build→bootstrap contract (architect #4).
   */
  buildArtifact(project: HtmlProject, files: HtmlProjectFile[]): HtmlProjectPreviewArtifact {
    const fileMap = new Map(files.map(file => [file.path, file]));
    const entryFile = fileMap.get(project.entryFile);
    const warnings: string[] = [];
    const missing = new Set<string>();
    const generatedAt = Date.now();

    if (!entryFile) {
      return {
        projectId: project.id,
        previewVersion: project.previewVersion,
        entryFile: project.entryFile,
        previewReady: false,
        previewUrlType: 'blob',
        html: '',
        warnings,
        error: `Entrypoint ${project.entryFile} 不存在。`,
        diagnostics: buildMissingEntrypointDiagnostics(project.entryFile),
        generatedAt,
      };
    }

    const vfsCtx = createVfsBuildContext();
    let html = entryFile.content;

    // V10: strip <base> first (breaks VFS path assumptions).
    html = removeBaseTags(html, warnings);
    // CSS: inline <link rel=stylesheet> as <style> (preserves classic behavior; CSS files also
    // enter the manifest below so the bootstrap can resolve url()/@import to blob URLs).
    html = this.inlineCss(html, entryFile.path, fileMap, warnings, missing);
    // Modules: extract <script type=module> (V3 specifier rewrite), defer to bootstrap.
    html = extractModuleScripts(html, entryFile.path, fileMap, warnings, missing, vfsCtx);
    // Classic scripts: inline <script src> (after module tags are gone).
    html = inlineClassicScripts(
      html,
      entryFile.path,
      fileMap,
      warnings,
      missing,
      vfsCtx.classicScriptPaths,
    );
    // Assets: <img>/<source>/<video>/<audio>/<link rel=icon> → data-vfs + missing detection.
    html = tagVfsAssets(html, entryFile.path, fileMap, warnings, missing);

    if (missing.size > 0) {
      const missingPaths = Array.from(missing);
      return {
        projectId: project.id,
        previewVersion: project.previewVersion,
        entryFile: project.entryFile,
        previewReady: false,
        previewUrlType: 'blob',
        html,
        warnings,
        error: `缺少預覽所需檔案：${missingPaths.join(', ')}`,
        diagnostics: buildMissingReferenceDiagnostics(missingPaths, warnings),
        generatedAt,
      };
    }

    // Build the manifest from every project file except the entry HTML. Module JS files get
    // specifier-rewritten content (V3); classic-script JS files are excluded from the import map
    // (isModule=false) since they execute inlined. Inline-module synthetics are appended.
    for (const file of files) {
      if (file.path === entryFile.path) {
        continue;
      }
      const isClassic = vfsCtx.classicScriptPaths.has(file.path);
      const isModule = file.kind === 'js' && !isClassic;
      const content = isModule
        ? rewriteModuleSpecifiers(file.content, file.path).code
        : file.content;
      const existing = vfsCtx.manifestFiles.find(f => f.path === file.path);
      if (existing) {
        existing.content = content;
        existing.isModule = isModule;
      } else {
        addManifestFile(vfsCtx, {
          path: file.path,
          kind: file.kind,
          mime: mimeForFile(file.path, file.kind),
          encoding: file.encoding === 'base64' ? 'base64' : 'utf-8',
          content,
          isModule,
        });
      }
    }

    const manifest: VfsManifest = {
      files: vfsCtx.manifestFiles,
      entryModules: vfsCtx.entryModules,
    };

    // Embed VFS scaffolding (manifest + bootstrap in <head>) then the harness bridge (before
    // </body>). Single pipeline: even a classic-only project gets an empty VFS + bootstrap that
    // dispatches vfs-ready, so the bridge ready-ack contract never deadlocks (V1).
    let scaffoldedHtml = injectVfsScaffolding(html, manifest, project.id, project.previewVersion);
    scaffoldedHtml = injectRuntimeBridge(scaffoldedHtml, project.id, project.previewVersion);

    return {
      projectId: project.id,
      previewVersion: project.previewVersion,
      entryFile: project.entryFile,
      previewReady: true,
      previewUrlType: 'blob',
      html: scaffoldedHtml,
      warnings,
      error: null,
      diagnostics: buildReadyDiagnostics(warnings),
      generatedAt,
      vfsFileCount: vfsCtx.manifestFiles.length,
    };
  }

  async buildPreviewArtifact(projectId: string): Promise<HtmlProjectPreviewArtifact> {
    const project = await htmlProjectStore.getProject(projectId);
    if (!project) {
      throw new Error(`HTML project ${projectId} not found.`);
    }

    const descriptors = await htmlProjectStore.listFiles(projectId);
    const files = await Promise.all(
      descriptors.map(async descriptor => htmlProjectStore.readFile(projectId, descriptor.path)),
    );

    return this.buildArtifact(
      project,
      files.filter((file): file is HtmlProjectFile => Boolean(file)),
    );
  }

  revokePreviewUrl(projectId: string): void {
    const currentUrl = this.previewUrls.get(projectId);
    if (currentUrl && currentUrl.startsWith('blob:')) {
      URL.revokeObjectURL(currentUrl);
    }
    this.previewUrls.delete(projectId);
  }

  async createPreviewUrl(projectId: string): Promise<HtmlProjectPreviewArtifact> {
    const artifact = await this.buildPreviewArtifact(projectId);
    if (!artifact.previewReady) {
      this.revokePreviewUrl(projectId);
      return artifact;
    }

    this.revokePreviewUrl(projectId);

    let urlType: HtmlProjectPreviewUrlType = 'blob';
    let url: string;

    if (
      typeof URL !== 'undefined' &&
      typeof URL.createObjectURL === 'function' &&
      typeof globalThis.Blob === 'function'
    ) {
      url = URL.createObjectURL(
        new globalThis.Blob([artifact.html], { type: 'text/html;charset=utf-8' }),
      );
    } else {
      urlType = 'data';
      url = toDataUrl(artifact.html);
    }

    this.previewUrls.set(projectId, url);

    return {
      ...artifact,
      previewUrlType: urlType,
      url,
    };
  }

  async resolveProjectForPreview(projectId: string): Promise<HtmlProjectPreviewArtifact> {
    return this.createPreviewUrl(projectId);
  }
}

export const htmlPreviewService = new HtmlPreviewService();
