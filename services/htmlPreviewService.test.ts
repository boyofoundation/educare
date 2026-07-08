import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HtmlProject, HtmlProjectFile } from '../types';

const { mockGetProject, mockListFiles, mockReadFile } = vi.hoisted(() => ({
  mockGetProject: vi.fn(),
  mockListFiles: vi.fn(),
  mockReadFile: vi.fn(),
}));

vi.mock('./htmlProjectStore', () => ({
  htmlProjectStore: {
    getProject: mockGetProject,
    listFiles: mockListFiles,
    readFile: mockReadFile,
  },
}));

const project: HtmlProject = {
  id: 'project-1',
  assistantId: 'assistant-1',
  sessionId: 'session-1',
  name: 'Preview Project',
  entryFile: '/index.html',
  status: 'draft',
  previewVersion: 2,
  assetPaths: [],
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
  lastBuildError: null,
};

const htmlFile: HtmlProjectFile = {
  projectId: 'project-1',
  path: '/index.html',
  kind: 'html',
  content:
    '<!doctype html><html><head><link rel="stylesheet" href="./styles/app.css"></head><body><script src="./scripts/app.js"></script></body></html>',
  encoding: 'utf-8',
  dependencies: ['/styles/app.css', '/scripts/app.js'],
  size: 10,
  updatedAt: 1700000000000,
};

describe('htmlPreviewService', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    Object.defineProperty(URL, 'createObjectURL', {
      value: vi.fn(() => 'blob:preview-1'),
      configurable: true,
      writable: true,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: vi.fn(),
      configurable: true,
      writable: true,
    });
  });

  it('builds a ready preview artifact with inlined local CSS and JS', async () => {
    const cssFile: HtmlProjectFile = {
      projectId: 'project-1',
      path: '/styles/app.css',
      kind: 'css',
      content: 'body { color: red; }',
      encoding: 'utf-8',
      dependencies: [],
      size: 20,
      updatedAt: 1700000000000,
    };
    const jsFile: HtmlProjectFile = {
      projectId: 'project-1',
      path: '/scripts/app.js',
      kind: 'js',
      content: 'console.log("preview");',
      encoding: 'utf-8',
      dependencies: [],
      size: 24,
      updatedAt: 1700000000000,
    };

    mockGetProject.mockResolvedValue(project);
    mockListFiles.mockResolvedValue([
      { path: '/index.html' },
      { path: '/styles/app.css' },
      { path: '/scripts/app.js' },
    ]);
    mockReadFile.mockImplementation(async (_projectId: string, path: string) => {
      if (path === '/index.html') {
        return htmlFile;
      }
      if (path === '/styles/app.css') {
        return cssFile;
      }
      if (path === '/scripts/app.js') {
        return jsFile;
      }
      return undefined;
    });

    const { htmlPreviewService } = await import('./htmlPreviewService');

    const artifact = await htmlPreviewService.resolveProjectForPreview('project-1');

    expect(artifact).toMatchObject({
      projectId: 'project-1',
      previewVersion: 2,
      previewReady: true,
      previewUrlType: 'blob',
      url: 'blob:preview-1',
      error: null,
      diagnostics: {
        category: 'none',
        outcome: 'ready',
        repairable: false,
        summary: 'Preview rendered successfully.',
      },
    });
    expect(artifact.html).toContain('<style data-project-path="/styles/app.css">');
    expect(artifact.html).toContain('body { color: red; }');
    expect(artifact.html).toContain('<script  data-project-path="/scripts/app.js">');
    expect(artifact.html).toContain('console.log("preview");');
  });

  it('preview blob type 含 charset=utf-8,中文內容不亂碼 (B5 regression)', async () => {
    const chineseFile: HtmlProjectFile = {
      ...htmlFile,
      content:
        '<!doctype html><html><head></head><body><p>中文測試內容:繁體字預覽</p></body></html>',
      dependencies: [],
    };
    mockGetProject.mockResolvedValue(project);
    mockListFiles.mockResolvedValue([{ path: '/index.html' }]);
    mockReadFile.mockResolvedValue(chineseFile);

    const { htmlPreviewService } = await import('./htmlPreviewService');

    const artifact = await htmlPreviewService.resolveProjectForPreview('project-1');

    expect(artifact.previewReady).toBe(true);
    expect(artifact.html).toContain('中文測試內容:繁體字預覽');
    // 捕捉傳給 createObjectURL 的 Blob,驗證 MIME type 明確標示 charset
    // (缺 charset 時瀏覽器可能以非 utf-8 解碼,中文變亂碼)
    const createObjectURL = URL.createObjectURL as ReturnType<typeof vi.fn>;
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0][0] as InstanceType<typeof globalThis.Blob>;
    expect(blob).toBeInstanceOf(globalThis.Blob);
    expect(blob.type).toBe('text/html;charset=utf-8');
  });

  it('returns missing_reference diagnostics when preview dependencies are missing', async () => {
    mockGetProject.mockResolvedValue(project);
    mockListFiles.mockResolvedValue([{ path: '/index.html' }]);
    mockReadFile.mockResolvedValue(htmlFile);

    const { htmlPreviewService } = await import('./htmlPreviewService');

    const artifact = await htmlPreviewService.resolveProjectForPreview('project-1');

    expect(artifact.previewReady).toBe(false);
    expect(artifact.url).toBeUndefined();
    expect(artifact.error).toContain('/styles/app.css');
    expect(artifact.error).toContain('/scripts/app.js');
    expect(artifact.diagnostics).toEqual({
      category: 'missing_reference',
      outcome: 'repairable_error',
      repairable: true,
      summary: 'Missing preview dependencies: /styles/app.css, /scripts/app.js.',
      missingPaths: ['/styles/app.css', '/scripts/app.js'],
      warnings: [],
      details: [
        'Restore the missing file(s) or update the HTML references before retrying preview.',
      ],
    });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('returns missing_entrypoint diagnostics when the entry file does not exist', async () => {
    mockGetProject.mockResolvedValue(project);
    mockListFiles.mockResolvedValue([{ path: '/styles/app.css' }]);
    mockReadFile.mockResolvedValue(undefined);

    const { htmlPreviewService } = await import('./htmlPreviewService');

    const artifact = await htmlPreviewService.resolveProjectForPreview('project-1');

    expect(artifact).toMatchObject({
      previewReady: false,
      error: 'Entrypoint /index.html 不存在。',
      diagnostics: {
        category: 'missing_entrypoint',
        outcome: 'repairable_error',
        repairable: true,
        summary: 'Entrypoint /index.html does not exist.',
        missingPaths: ['/index.html'],
        details: ['Set a valid entry file or recreate the missing entrypoint file.'],
      },
    });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('returns external_dependency_warning diagnostics when external assets are preserved', async () => {
    const externalHtmlFile: HtmlProjectFile = {
      ...htmlFile,
      content:
        '<!doctype html><html><head><link rel="stylesheet" href="https://cdn.example.com/app.css"></head><body><script src="https://cdn.example.com/app.js"></script></body></html>',
      dependencies: [],
    };

    mockGetProject.mockResolvedValue(project);
    mockListFiles.mockResolvedValue([{ path: '/index.html' }]);
    mockReadFile.mockResolvedValue(externalHtmlFile);

    const { htmlPreviewService } = await import('./htmlPreviewService');

    const artifact = await htmlPreviewService.resolveProjectForPreview('project-1');

    expect(artifact).toMatchObject({
      previewReady: true,
      diagnostics: {
        category: 'external_dependency_warning',
        outcome: 'ready',
        repairable: false,
        summary: 'Preview rendered with external dependency warnings.',
        warnings: [
          '保留外部樣式資源：https://cdn.example.com/app.css',
          '保留外部腳本資源：https://cdn.example.com/app.js',
        ],
        details: [
          '保留外部樣式資源：https://cdn.example.com/app.css',
          '保留外部腳本資源：https://cdn.example.com/app.js',
        ],
      },
    });
    expect(artifact.html).toContain('https://cdn.example.com/app.css');
    expect(artifact.html).toContain('https://cdn.example.com/app.js');
  });

  describe('G1 runtime bridge injection', () => {
    it('injects the harness bridge + JSON meta when preview is ready', async () => {
      const cssFile: HtmlProjectFile = {
        projectId: 'project-1',
        path: '/styles/app.css',
        kind: 'css',
        content: 'body { color: red; }',
        encoding: 'utf-8',
        dependencies: [],
        size: 20,
        updatedAt: 1700000000000,
      };
      const jsFile: HtmlProjectFile = {
        projectId: 'project-1',
        path: '/scripts/app.js',
        kind: 'js',
        content: 'console.log("preview");',
        encoding: 'utf-8',
        dependencies: [],
        size: 24,
        updatedAt: 1700000000000,
      };

      mockGetProject.mockResolvedValue(project);
      mockListFiles.mockResolvedValue([
        { path: '/index.html' },
        { path: '/styles/app.css' },
        { path: '/scripts/app.js' },
      ]);
      mockReadFile.mockImplementation(async (_projectId: string, path: string) => {
        if (path === '/index.html') {
          return htmlFile;
        }
        if (path === '/styles/app.css') {
          return cssFile;
        }
        if (path === '/scripts/app.js') {
          return jsFile;
        }
        return undefined;
      });

      const { htmlPreviewService } = await import('./htmlPreviewService');

      const artifact = await htmlPreviewService.resolveProjectForPreview('project-1');

      expect(artifact.previewReady).toBe(true);
      // Bridge meta + script both present, with the artifact's projectId + previewVersion.
      expect(artifact.html).toContain('data-harness-meta');
      expect(artifact.html).toContain('"projectId":"project-1"');
      expect(artifact.html).toContain('"previewVersion":2');
      expect(artifact.html).toContain('data-harness-bridge');
      // Bridge is idempotent — installs a sentinel guard.
      expect(artifact.html).toContain('__harnessRuntimeBridgeInstalled__');
      // Injection lands before </body>.
      const bodyCloseIdx = artifact.html.toLowerCase().indexOf('</body>');
      const bridgeIdx = artifact.html.indexOf('data-harness-bridge');
      expect(bridgeIdx).toBeGreaterThan(-1);
      expect(bodyCloseIdx).toBeGreaterThan(bridgeIdx);
    });

    it('does NOT inject the bridge when the entrypoint is missing', async () => {
      mockGetProject.mockResolvedValue(project);
      mockListFiles.mockResolvedValue([{ path: '/styles/app.css' }]);
      mockReadFile.mockResolvedValue(undefined);

      const { htmlPreviewService } = await import('./htmlPreviewService');

      const artifact = await htmlPreviewService.resolveProjectForPreview('project-1');

      expect(artifact.previewReady).toBe(false);
      expect(artifact.html).not.toContain('data-harness-bridge');
      expect(artifact.html).not.toContain('data-harness-meta');
    });

    it('does NOT inject the bridge when referenced files are missing', async () => {
      mockGetProject.mockResolvedValue(project);
      mockListFiles.mockResolvedValue([{ path: '/index.html' }]);
      mockReadFile.mockResolvedValue(htmlFile);

      const { htmlPreviewService } = await import('./htmlPreviewService');

      const artifact = await htmlPreviewService.resolveProjectForPreview('project-1');

      expect(artifact.previewReady).toBe(false);
      expect(artifact.html).not.toContain('data-harness-bridge');
      expect(artifact.html).not.toContain('data-harness-meta');
    });

    it('injects exactly one bridge per artifact (idempotent within the document)', async () => {
      const standaloneFile: HtmlProjectFile = {
        ...htmlFile,
        content: '<!doctype html><html><head></head><body><p>hi</p></body></html>',
        dependencies: [],
      };
      mockGetProject.mockResolvedValue(project);
      mockListFiles.mockResolvedValue([{ path: '/index.html' }]);
      mockReadFile.mockResolvedValue(standaloneFile);

      const { htmlPreviewService } = await import('./htmlPreviewService');

      const artifact = await htmlPreviewService.resolveProjectForPreview('project-1');

      const occurrences = (artifact.html.match(/data-harness-bridge/g) || []).length;
      expect(occurrences).toBe(1);
      // Count the actual JSON meta tag (the bridge code references the selector internally
      // so a plain substring search would double-count).
      const metaOccurrences = (
        artifact.html.match(/type="application\/json" data-harness-meta/g) || []
      ).length;
      expect(metaOccurrences).toBe(1);
    });

    it('embeds the bridge correctly even when there is no </body> tag', async () => {
      const bodylessFile: HtmlProjectFile = {
        ...htmlFile,
        content: '<!doctype html><html><head></head><body><p>hi</p></html>',
        dependencies: [],
      };
      mockGetProject.mockResolvedValue(project);
      mockListFiles.mockResolvedValue([{ path: '/index.html' }]);
      mockReadFile.mockResolvedValue(bodylessFile);

      const { htmlPreviewService } = await import('./htmlPreviewService');

      const artifact = await htmlPreviewService.resolveProjectForPreview('project-1');

      expect(artifact.previewReady).toBe(true);
      expect(artifact.html).toContain('data-harness-bridge');
      expect(artifact.html).toContain('data-harness-meta');
      // Falls back to injecting before </html>.
      const htmlCloseIdx = artifact.html.toLowerCase().indexOf('</html>');
      const bridgeIdx = artifact.html.indexOf('data-harness-bridge');
      expect(htmlCloseIdx).toBeGreaterThan(bridgeIdx);
    });
  });
});
