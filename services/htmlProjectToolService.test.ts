import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolCall } from './llmAdapter';

const {
  mockAssertProjectOwnership,
  mockCopyFile,
  mockDeleteFile,
  mockDeleteTodo,
  mockGetTodoSummary,
  mockListFiles,
  mockListProjectFiles,
  mockListProjectsByAssistant,
  mockListTodos,
  mockReadFile,
  mockRenameFile,
  mockReplaceTodos,
  mockResolveProjectForPreview,
  mockBuildPreviewArtifact,
  mockSearchFiles,
  mockSetEntrypoint,
  mockUpdateTodo,
  mockWriteFiles,
  mockListSnapshots,
  mockRevertToSnapshot,
  mockWaitForRuntimeDiagnostics,
  mockClearRuntimeDiagnostics,
} = vi.hoisted(() => ({
  mockAssertProjectOwnership: vi.fn(),
  mockCopyFile: vi.fn(),
  mockDeleteFile: vi.fn(),
  mockDeleteTodo: vi.fn(),
  mockGetTodoSummary: vi.fn(),
  mockListFiles: vi.fn(),
  mockListProjectFiles: vi.fn(),
  mockListProjectsByAssistant: vi.fn(),
  mockListTodos: vi.fn(),
  mockReadFile: vi.fn(),
  mockRenameFile: vi.fn(),
  mockReplaceTodos: vi.fn(),
  mockResolveProjectForPreview: vi.fn(),
  mockBuildPreviewArtifact: vi.fn(),
  mockSearchFiles: vi.fn(),
  mockSetEntrypoint: vi.fn(),
  mockUpdateTodo: vi.fn(),
  mockWriteFiles: vi.fn(),
  mockListSnapshots: vi.fn(),
  mockRevertToSnapshot: vi.fn(),
  mockWaitForRuntimeDiagnostics: vi.fn(),
  mockClearRuntimeDiagnostics: vi.fn(),
}));

vi.mock('./htmlProjectStore', async importOriginal => {
  const actual = await importOriginal<typeof import('./htmlProjectStore')>();

  return {
    ...actual,
    htmlProjectStore: {
      assertProjectOwnership: mockAssertProjectOwnership,
      copyFile: mockCopyFile,
      deleteFile: mockDeleteFile,
      deleteTodo: mockDeleteTodo,
      getTodoSummary: mockGetTodoSummary,
      listFiles: mockListFiles,
      listProjectFiles: mockListProjectFiles,
      listProjectsByAssistant: mockListProjectsByAssistant,
      listTodos: mockListTodos,
      readFile: mockReadFile,
      renameFile: mockRenameFile,
      replaceTodos: mockReplaceTodos,
      searchFiles: mockSearchFiles,
      setEntrypoint: mockSetEntrypoint,
      updateTodo: mockUpdateTodo,
      writeFiles: mockWriteFiles,
      listSnapshots: mockListSnapshots,
      revertToSnapshot: mockRevertToSnapshot,
    },
  };
});

vi.mock('./htmlPreviewService', () => ({
  htmlPreviewService: {
    resolveProjectForPreview: mockResolveProjectForPreview,
    buildPreviewArtifact: mockBuildPreviewArtifact,
  },
}));

vi.mock('./previewRuntimeDiagnostics', () => ({
  previewRuntimeDiagnostics: {
    waitForRuntimeDiagnostics: mockWaitForRuntimeDiagnostics,
    clear: mockClearRuntimeDiagnostics,
  },
}));

describe('executeHtmlProjectToolCall', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    mockAssertProjectOwnership.mockResolvedValue({
      id: 'project-1',
      assistantId: 'assistant-1',
      sessionId: 'session-1',
      name: 'Canvas MVP',
      description: 'Project description',
      entryFile: '/index.html',
      previewVersion: 3,
    });
    mockResolveProjectForPreview.mockResolvedValue({
      projectId: 'project-1',
      previewVersion: 3,
      previewReady: true,
      previewUrlType: 'blob',
      url: 'blob:preview-1',
      html: '<html></html>',
      error: null,
    });
    mockBuildPreviewArtifact.mockResolvedValue({
      projectId: 'project-1',
      previewVersion: 3,
      entryFile: '/index.html',
      previewReady: true,
      previewUrlType: 'blob',
      html: '<html></html>',
      warnings: [],
      error: null,
      diagnostics: {
        category: 'none',
        outcome: 'ready',
        repairable: false,
        summary: 'Preview rendered successfully.',
      },
      generatedAt: 1700000000000,
    });
    mockGetTodoSummary.mockResolvedValue({
      projectId: 'project-1',
      total: 0,
      pending: 0,
      inProgress: 0,
      completed: 0,
      allComplete: false,
    });
    mockListTodos.mockResolvedValue([]);
    mockListProjectFiles.mockResolvedValue([]);
    mockDeleteFile.mockResolvedValue({
      deleted: true,
      previewVersion: 4,
    });
    mockCopyFile.mockResolvedValue({
      sourcePath: '/index.html',
      destinationPath: '/index-copy.html',
      previewVersion: 4,
    });
    mockRenameFile.mockResolvedValue({
      sourcePath: '/index.html',
      destinationPath: '/pages/home.html',
      previewVersion: 4,
    });
    mockSetEntrypoint.mockResolvedValue({
      id: 'project-1',
      entryFile: '/index.html',
      previewVersion: 4,
    });
    mockWaitForRuntimeDiagnostics.mockResolvedValue({
      projectId: 'project-1',
      previewVersion: 3,
      status: 'clean',
      errors: [],
      readyAckReceived: true,
      waitedForReadyAck: false,
      waitMs: 0,
    });
    mockClearRuntimeDiagnostics.mockReturnValue(undefined);
    mockListSnapshots.mockResolvedValue({
      projectId: 'project-1',
      snapshots: [],
      retainedLimit: 20,
    });
    mockRevertToSnapshot.mockResolvedValue({
      projectId: 'project-1',
      revertedToVersion: 2,
      previewVersion: 4,
      runtimeDiagnosticsCleared: true,
      filesRestored: 3,
    });
  });

  it('accepts a single file object, infers kind from path, and forwards normalized files', async () => {
    mockWriteFiles.mockResolvedValue({
      updated: ['/index.html'],
      previewVersion: 3,
    });

    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');

    const call: ToolCall = {
      name: 'writeFiles',
      args: {
        projectId: 'project-1',
        files: {
          path: 'index.html',
          content: '<main>Hello</main>',
        },
      },
    };

    const result = await executeHtmlProjectToolCall(call, {
      assistantId: 'assistant-1',
      activeProjectId: 'project-1',
    });

    expect(mockWriteFiles).toHaveBeenCalledWith('project-1', [
      {
        path: 'index.html',
        content: '<main>Hello</main>',
        kind: 'html',
      },
    ]);
    expect(result.toolName).toBe('writeFiles');
    expect(result.result).toMatchObject({
      projectId: 'project-1',
      updated: ['/index.html'],
      previewVersion: 3,
    });
  });

  // Phase 1 靜態驗證整合測試 (writeFiles handler)
  it('writeFiles with JS syntax error attaches staticDiagnostics (non-blocking, file still written)', async () => {
    mockWriteFiles.mockResolvedValue({
      updated: ['/foo.js'],
      previewVersion: 7,
    });

    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');

    const result = await executeHtmlProjectToolCall(
      {
        name: 'writeFiles',
        args: {
          projectId: 'project-1',
          files: [
            {
              path: '/foo.js',
              content: 'items.forEach(item => {}));',
            },
          ],
        },
      },
      {
        assistantId: 'assistant-1',
        activeProjectId: 'project-1',
      },
    );

    expect(mockWriteFiles).toHaveBeenCalled();
    expect(result.toolName).toBe('writeFiles');
    const r = result.result as Record<string, unknown>;
    expect(typeof r.staticDiagnostics).toBe('string');
    expect((r.staticDiagnostics as string).toLowerCase()).toContain('js:error');
    const sv = r.staticValidation as { ok: boolean; errorCount: number };
    expect(sv.ok).toBe(false);
    expect(sv.errorCount).toBeGreaterThanOrEqual(1);
    // summary 中文尾句
    expect(result.summary).toContain('靜態驗證發現');
  });

  it('writeFiles with valid JS omits staticDiagnostics to save tokens', async () => {
    mockWriteFiles.mockResolvedValue({
      updated: ['/foo.js'],
      previewVersion: 8,
    });

    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');

    const result = await executeHtmlProjectToolCall(
      {
        name: 'writeFiles',
        args: {
          projectId: 'project-1',
          files: [
            {
              path: '/foo.js',
              content: 'export const x = 1;\n',
            },
          ],
        },
      },
      {
        assistantId: 'assistant-1',
        activeProjectId: 'project-1',
      },
    );

    const r = result.result as Record<string, unknown>;
    expect(r.staticDiagnostics).toBeUndefined();
    expect(r.staticValidation).toBeUndefined();
    expect(result.summary).not.toContain('靜態驗證發現');
  });

  it('writeFiles with .tsx file emits sandbox-unsupported warning (not SyntaxError)', async () => {
    mockWriteFiles.mockResolvedValue({
      updated: ['/app.tsx'],
      previewVersion: 9,
    });

    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');

    const result = await executeHtmlProjectToolCall(
      {
        name: 'writeFiles',
        args: {
          projectId: 'project-1',
          files: [
            {
              path: '/app.tsx',
              content: 'const x: number = 1;',
            },
          ],
        },
      },
      {
        assistantId: 'assistant-1',
        activeProjectId: 'project-1',
      },
    );

    const r = result.result as Record<string, unknown>;
    expect(typeof r.staticDiagnostics).toBe('string');
    const diag = r.staticDiagnostics as string;
    expect(diag).toContain('js:warning');
    expect(diag.toLowerCase()).toContain('typescript');
    // warning 不算 error → staticValidation.ok 仍為 true,但 warning 仍會回報
    const sv = r.staticValidation as { ok: boolean; errorCount: number; warningCount: number };
    expect(sv.ok).toBe(true);
    expect(sv.errorCount).toBe(0);
    expect(sv.warningCount).toBeGreaterThanOrEqual(1);
    // summary 中文尾句不應出現(因為沒有 error)
    expect(result.summary).not.toContain('靜態驗證發現');
  });

  it('returns missing-required-args before dispatch when writeFiles files is omitted', async () => {
    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');

    const result = await executeHtmlProjectToolCall(
      {
        name: 'writeFiles',
        args: {
          projectId: 'project-1',
        },
      },
      {
        assistantId: 'assistant-1',
        activeProjectId: 'project-1',
      },
    );

    expect(mockAssertProjectOwnership).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      toolName: 'writeFiles',
      summary: 'writeFiles is missing required arguments: files.',
      result: {
        ok: false,
        recoverable: true,
        code: 'missing-required-args',
        message: 'writeFiles is missing required arguments: files.',
        guidance: 'Retry with all required top-level arguments from the tool schema.',
        details: {
          missing: ['files'],
          required: ['files'],
        },
      },
      workspace: {
        activeProjectId: 'project-1',
        activityMessage: 'writeFiles is missing required arguments: files.',
        preview: null,
      },
    });
    expect(mockWriteFiles).not.toHaveBeenCalled();
    expect(mockResolveProjectForPreview).not.toHaveBeenCalled();
  });

  it('returns a structured recoverable result when writeFiles receives an empty files array', async () => {
    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');

    const result = await executeHtmlProjectToolCall(
      {
        name: 'writeFiles',
        args: {
          projectId: 'project-1',
          files: [],
        },
      },
      {
        assistantId: 'assistant-1',
        activeProjectId: 'project-1',
      },
    );

    expect(mockAssertProjectOwnership).toHaveBeenCalledWith('project-1', 'assistant-1');
    expect(result).toMatchObject({
      toolName: 'writeFiles',
      summary: 'writeFiles requires a non-empty files array.',
      result: {
        ok: false,
        recoverable: true,
        code: 'invalid-write-files-input',
        message: 'writeFiles requires a non-empty files array.',
        guidance:
          'Pass one or more file objects in files[]. Use writeFiles for small complete files only.',
      },
      workspace: {
        activeProjectId: 'project-1',
        activityMessage: 'writeFiles requires a non-empty files array.',
        preview: null,
      },
    });
    expect(mockWriteFiles).not.toHaveBeenCalled();
    expect(mockResolveProjectForPreview).not.toHaveBeenCalled();
  });

  it('returns missing-required-args when writeFiles receives null call args', async () => {
    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');

    const result = await executeHtmlProjectToolCall(
      {
        name: 'writeFiles',
        args: null as unknown as Record<string, unknown>,
      },
      {
        assistantId: 'assistant-1',
        activeProjectId: 'project-1',
      },
    );

    expect(mockAssertProjectOwnership).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      toolName: 'writeFiles',
      summary: 'writeFiles is missing required arguments: files.',
      result: {
        ok: false,
        recoverable: true,
        code: 'missing-required-args',
        message: 'writeFiles is missing required arguments: files.',
        details: {
          missing: ['files'],
          required: ['files'],
        },
      },
      workspace: {
        activeProjectId: 'project-1',
        activityMessage: 'writeFiles is missing required arguments: files.',
        preview: null,
      },
    });
  });

  it('returns a structured recoverable result when writeFiles contains a non-object file entry', async () => {
    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');

    const result = await executeHtmlProjectToolCall(
      {
        name: 'writeFiles',
        args: {
          projectId: 'project-1',
          files: [null],
        },
      },
      {
        assistantId: 'assistant-1',
        activeProjectId: 'project-1',
      },
    );

    expect(mockAssertProjectOwnership).toHaveBeenCalledWith('project-1', 'assistant-1');
    expect(result).toMatchObject({
      toolName: 'writeFiles',
      summary: 'writeFiles.files[0] must be an object with path and content.',
      result: {
        ok: false,
        recoverable: true,
        code: 'invalid-write-file-entry',
        message: 'writeFiles.files[0] must be an object with path and content.',
        guidance:
          'Pass files as objects like { path, content, kind? } and avoid null or primitive entries.',
      },
      workspace: {
        activeProjectId: 'project-1',
        activityMessage: 'writeFiles.files[0] must be an object with path and content.',
        preview: null,
      },
    });
    expect(mockWriteFiles).not.toHaveBeenCalled();
    expect(mockResolveProjectForPreview).not.toHaveBeenCalled();
  });

  it('returns a structured recoverable result when writeFiles path validation fails inside the store', async () => {
    const { HtmlProjectPathValidationError } = await import('./htmlProjectStore');
    mockWriteFiles.mockRejectedValue(
      new HtmlProjectPathValidationError(
        '../..',
        'path-parent-traversal',
        'Project file path must not use parent-directory traversal: ../..',
      ),
    );
    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');

    const result = await executeHtmlProjectToolCall(
      {
        name: 'writeFiles',
        args: {
          projectId: 'project-1',
          files: [
            {
              path: '../..',
              content: '<main>Hello</main>',
            },
          ],
        },
      },
      {
        assistantId: 'assistant-1',
        activeProjectId: 'project-9',
      },
    );

    expect(mockAssertProjectOwnership).toHaveBeenCalledWith('project-1', 'assistant-1');
    expect(result).toMatchObject({
      toolName: 'writeFiles',
      summary: 'Project file path must not use parent-directory traversal: ../..',
      result: {
        ok: false,
        recoverable: true,
        code: 'path-parent-traversal',
        message: 'Project file path must not use parent-directory traversal: ../..',
        guidance:
          'Use virtual project-root paths like /index.html, /src/app.js, or /data/ruby.js. Do not use host filesystem paths or URLs.',
        details: {
          path: '../..',
        },
      },
      workspace: {
        activeProjectId: 'project-1',
        activityMessage: 'Project file path must not use parent-directory traversal: ../..',
        preview: null,
      },
    });
    expect(mockResolveProjectForPreview).not.toHaveBeenCalled();
  });

  it('returns a structured recoverable result when writeFiles receives an unsupported kind', async () => {
    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');

    const result = await executeHtmlProjectToolCall(
      {
        name: 'writeFiles',
        args: {
          projectId: 'project-1',
          files: [
            {
              path: '/index.html',
              content: '<main>Hello</main>',
              kind: 'javascript',
            },
          ],
        },
      },
      {
        assistantId: 'assistant-1',
        activeProjectId: 'project-1',
      },
    );

    expect(mockAssertProjectOwnership).toHaveBeenCalledWith('project-1', 'assistant-1');
    expect(result).toMatchObject({
      toolName: 'writeFiles',
      summary: 'writeFiles.files[0] has unsupported kind "javascript".',
      result: {
        ok: false,
        recoverable: true,
        code: 'invalid-write-file-kind',
        message: 'writeFiles.files[0] has unsupported kind "javascript".',
        guidance:
          'Use one of: html, css, js, json, svg, asset, or md. Omit kind to let the tool infer it from the path.',
      },
      workspace: {
        activeProjectId: 'project-1',
        activityMessage: 'writeFiles.files[0] has unsupported kind "javascript".',
        preview: null,
      },
    });
    expect(mockWriteFiles).not.toHaveBeenCalled();
    expect(mockResolveProjectForPreview).not.toHaveBeenCalled();
  });

  it('returns a structured recoverable result when a writeFiles payload exceeds the size limit', async () => {
    const oversizedContent = 'a'.repeat(24 * 1024 + 1);
    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');

    const result = await executeHtmlProjectToolCall(
      {
        name: 'writeFiles',
        args: {
          projectId: 'project-1',
          files: [
            {
              path: '/index.html',
              content: oversizedContent,
            },
          ],
        },
      },
      {
        assistantId: 'assistant-1',
        activeProjectId: 'project-1',
      },
    );

    expect(mockAssertProjectOwnership).toHaveBeenCalledWith('project-1', 'assistant-1');
    expect(result).toMatchObject({
      toolName: 'writeFiles',
      summary: `writeFiles payload for /index.html is too large (${oversizedContent.length} bytes).`,
      result: {
        ok: false,
        recoverable: true,
        code: 'write-file-too-large',
        message: `writeFiles payload for /index.html is too large (${oversizedContent.length} bytes).`,
        guidance:
          'Use writeFiles only for small complete files. For existing files, readFile first and then use replaceInFile or modifyLinesInFile for targeted edits.',
        details: {
          path: '/index.html',
          contentBytes: oversizedContent.length,
          maxBytes: 24 * 1024,
        },
      },
      workspace: {
        activeProjectId: 'project-1',
        activityMessage: `writeFiles payload for /index.html is too large (${oversizedContent.length} bytes).`,
        preview: null,
      },
    });
    expect(mockWriteFiles).not.toHaveBeenCalled();
    expect(mockResolveProjectForPreview).not.toHaveBeenCalled();
  });

  it('replaces an exact single match inside an existing text file', async () => {
    mockReadFile.mockResolvedValue({
      path: '/index.html',
      kind: 'html',
      content: '<main>Hello</main>',
      encoding: 'utf-8',
      dependencies: [],
      size: 18,
      updatedAt: 1700000001000,
    });
    mockWriteFiles.mockResolvedValue({
      updated: ['/index.html'],
      previewVersion: 4,
    });

    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');

    const result = await executeHtmlProjectToolCall(
      {
        name: 'replaceInFile',
        args: {
          projectId: 'project-1',
          path: '/index.html',
          oldText: 'Hello',
          newText: 'Hi',
        },
      },
      {
        assistantId: 'assistant-1',
        activeProjectId: 'project-9',
      },
    );

    expect(mockAssertProjectOwnership).toHaveBeenCalledWith('project-1', 'assistant-1');
    expect(mockReadFile).toHaveBeenCalledWith('project-1', '/index.html');
    expect(mockWriteFiles).toHaveBeenCalledWith('project-1', [
      {
        path: '/index.html',
        kind: 'html',
        content: '<main>Hi</main>',
        encoding: 'utf-8',
      },
    ]);
    expect(mockResolveProjectForPreview).toHaveBeenCalledWith('project-1');
    expect(result).toMatchObject({
      toolName: 'replaceInFile',
      summary: '已更新檔案 /index.html 的指定內容。',
      result: {
        projectId: 'project-1',
        path: '/index.html',
        updated: ['/index.html'],
        previewVersion: 4,
        replaced: true,
        matchCount: 1,
      },
      workspace: {
        activeProjectId: 'project-1',
        activityMessage: '已更新檔案 /index.html 的指定內容。',
      },
    });
  });

  it('treats replaceInFile newText as a literal string', async () => {
    mockReadFile.mockResolvedValue({
      path: '/index.html',
      kind: 'html',
      content: '<main>Hello</main>',
      encoding: 'utf-8',
      dependencies: [],
      size: 18,
      updatedAt: 1700000001000,
    });
    mockWriteFiles.mockResolvedValue({
      updated: ['/index.html'],
      previewVersion: 4,
    });

    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');

    await executeHtmlProjectToolCall(
      {
        name: 'replaceInFile',
        args: {
          projectId: 'project-1',
          path: '/index.html',
          oldText: 'Hello',
          newText: '$&',
        },
      },
      {
        assistantId: 'assistant-1',
        activeProjectId: 'project-1',
      },
    );

    expect(mockWriteFiles).toHaveBeenCalledWith('project-1', [
      {
        path: '/index.html',
        kind: 'html',
        content: '<main>$&</main>',
        encoding: 'utf-8',
      },
    ]);
  });

  it('returns missing-required-args before dispatch when replaceInFile oldText is omitted', async () => {
    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');

    const result = await executeHtmlProjectToolCall(
      {
        name: 'replaceInFile',
        args: {
          projectId: 'project-1',
          path: '/index.html',
          newText: 'Hi',
        },
      },
      {
        assistantId: 'assistant-1',
        activeProjectId: 'project-1',
      },
    );

    expect(mockAssertProjectOwnership).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      toolName: 'replaceInFile',
      summary: 'replaceInFile is missing required arguments: oldText.',
      result: {
        ok: false,
        recoverable: true,
        code: 'missing-required-args',
        message: 'replaceInFile is missing required arguments: oldText.',
        guidance: 'Retry with all required top-level arguments from the tool schema.',
        details: {
          missing: ['oldText'],
          required: ['path', 'oldText', 'newText'],
        },
      },
      workspace: {
        activeProjectId: 'project-1',
        activityMessage: 'replaceInFile is missing required arguments: oldText.',
        preview: null,
      },
    });
    expect(mockReadFile).not.toHaveBeenCalled();
    expect(mockWriteFiles).not.toHaveBeenCalled();
    expect(mockResolveProjectForPreview).not.toHaveBeenCalled();
  });

  it('returns a structured recoverable result when replaceInFile oldText is blank', async () => {
    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');

    const result = await executeHtmlProjectToolCall(
      {
        name: 'replaceInFile',
        args: {
          projectId: 'project-1',
          path: '/index.html',
          oldText: '',
          newText: 'Hi',
        },
      },
      {
        assistantId: 'assistant-1',
        activeProjectId: 'project-1',
      },
    );

    expect(mockAssertProjectOwnership).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      toolName: 'replaceInFile',
      summary: 'replaceInFile is missing required arguments: oldText.',
      result: {
        ok: false,
        recoverable: true,
        code: 'missing-required-args',
        message: 'replaceInFile is missing required arguments: oldText.',
      },
    });
    expect(mockReadFile).not.toHaveBeenCalled();
    expect(mockWriteFiles).not.toHaveBeenCalled();
    expect(mockResolveProjectForPreview).not.toHaveBeenCalled();
  });

  it('returns a structured recoverable result when replaceInFile path validation fails inside the store', async () => {
    const { HtmlProjectPathValidationError } = await import('./htmlProjectStore');
    mockReadFile.mockRejectedValue(
      new HtmlProjectPathValidationError(
        '../..',
        'path-parent-traversal',
        'Project file path must not use parent-directory traversal: ../..',
      ),
    );
    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');

    const result = await executeHtmlProjectToolCall(
      {
        name: 'replaceInFile',
        args: {
          projectId: 'project-1',
          path: '../..',
          oldText: 'Hello',
          newText: 'Hi',
        },
      },
      {
        assistantId: 'assistant-1',
        activeProjectId: 'project-7',
      },
    );

    expect(mockAssertProjectOwnership).toHaveBeenCalledWith('project-1', 'assistant-1');
    expect(mockReadFile).toHaveBeenCalledWith('project-1', '../..');
    expect(result).toMatchObject({
      toolName: 'replaceInFile',
      summary: 'Project file path must not use parent-directory traversal: ../..',
      result: {
        ok: false,
        recoverable: true,
        code: 'path-parent-traversal',
        message: 'Project file path must not use parent-directory traversal: ../..',
        guidance:
          'Use virtual project-root paths like /index.html, /src/app.js, or /data/ruby.js. Do not use host filesystem paths or URLs.',
        details: {
          path: '../..',
        },
      },
      workspace: {
        activeProjectId: 'project-1',
        activityMessage: 'Project file path must not use parent-directory traversal: ../..',
        preview: null,
      },
    });
    expect(mockWriteFiles).not.toHaveBeenCalled();
    expect(mockResolveProjectForPreview).not.toHaveBeenCalled();
  });

  it('returns a structured recoverable result when replaceInFile oldText is ambiguous', async () => {
    mockReadFile.mockResolvedValue({
      path: '/index.html',
      kind: 'html',
      content: '<p>Hello</p>\n<p>Hello</p>',
      encoding: 'utf-8',
      dependencies: [],
      size: 25,
      updatedAt: 1700000001000,
    });

    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');

    const result = await executeHtmlProjectToolCall(
      {
        name: 'replaceInFile',
        args: {
          projectId: 'project-1',
          path: '/index.html',
          oldText: 'Hello',
          newText: 'Hi',
        },
      },
      {
        assistantId: 'assistant-1',
        activeProjectId: 'project-1',
      },
    );

    expect(mockAssertProjectOwnership).toHaveBeenCalledWith('project-1', 'assistant-1');
    expect(mockReadFile).toHaveBeenCalledWith('project-1', '/index.html');
    expect(result).toMatchObject({
      toolName: 'replaceInFile',
      summary: 'replaceInFile found 2 matches in /index.html.',
      result: {
        ok: false,
        recoverable: true,
        code: 'replace-old-text-ambiguous',
        message: 'replaceInFile found 2 matches in /index.html.',
        guidance:
          'Use a longer oldText snippet that uniquely identifies the section to replace, or narrow the edit after reading the file again.',
        details: {
          path: '/index.html',
          matchCount: 2,
        },
      },
      workspace: {
        activeProjectId: 'project-1',
        activityMessage: 'replaceInFile found 2 matches in /index.html.',
        preview: null,
      },
    });
    expect(mockWriteFiles).not.toHaveBeenCalled();
    expect(mockResolveProjectForPreview).not.toHaveBeenCalled();
  });

  it('modifies a specific line range with modifyLinesInFile', async () => {
    mockReadFile.mockResolvedValue({
      path: '/index.html',
      kind: 'html',
      content: '<h1>Title</h1>\n<p>Body</p>\n<footer>Footer</footer>',
      encoding: 'utf-8',
      dependencies: [],
      size: 54,
      updatedAt: 1700000001000,
    });
    mockWriteFiles.mockResolvedValue({
      updated: ['/index.html'],
      previewVersion: 4,
    });

    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');

    const result = await executeHtmlProjectToolCall(
      {
        name: 'modifyLinesInFile',
        args: {
          projectId: 'project-1',
          path: '/index.html',
          operation: 'replace',
          startLine: 2,
          content: '<p>Updated</p>',
          expectedOriginal: '<p>Body</p>',
        },
      },
      {
        assistantId: 'assistant-1',
        activeProjectId: 'project-9',
      },
    );

    expect(mockAssertProjectOwnership).toHaveBeenCalledWith('project-1', 'assistant-1');
    expect(mockReadFile).toHaveBeenCalledWith('project-1', '/index.html');
    expect(mockWriteFiles).toHaveBeenCalledWith('project-1', [
      {
        path: '/index.html',
        kind: 'html',
        content: '<h1>Title</h1>\n<p>Updated</p>\n<footer>Footer</footer>',
        encoding: 'utf-8',
      },
    ]);
    expect(mockResolveProjectForPreview).toHaveBeenCalledWith('project-1');
    expect(result).toMatchObject({
      toolName: 'modifyLinesInFile',
      summary: '已修改檔案 /index.html 的第 2 行。',
      result: {
        projectId: 'project-1',
        path: '/index.html',
        updated: ['/index.html'],
        previewVersion: 4,
        modified: true,
        operation: 'replace',
        startLine: 2,
        endLine: 2,
        totalLinesBefore: 3,
        totalLinesAfter: 3,
      },
      workspace: {
        activeProjectId: 'project-1',
        activityMessage: '已修改檔案 /index.html 的第 2 行。',
      },
    });
  });

  it('returns a recoverable result when modifyLinesInFile expectedOriginal is stale', async () => {
    mockReadFile.mockResolvedValue({
      path: '/index.html',
      kind: 'html',
      content: '<h1>Title</h1>\n<p>Body</p>\n<footer>Footer</footer>',
      encoding: 'utf-8',
      dependencies: [],
      size: 54,
      updatedAt: 1700000001000,
    });

    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');

    const result = await executeHtmlProjectToolCall(
      {
        name: 'modifyLinesInFile',
        args: {
          projectId: 'project-1',
          path: '/index.html',
          operation: 'replace',
          startLine: 2,
          content: '<p>Updated</p>',
          expectedOriginal: '<p>Old</p>',
        },
      },
      {
        assistantId: 'assistant-1',
        activeProjectId: 'project-1',
      },
    );

    expect(result).toMatchObject({
      toolName: 'modifyLinesInFile',
      summary: 'modifyLinesInFile expectedOriginal no longer matches /index.html lines 2-2.',
      result: {
        ok: false,
        recoverable: true,
        code: 'modify-lines-expected-original-mismatch',
        message: 'modifyLinesInFile expectedOriginal no longer matches /index.html lines 2-2.',
        details: {
          path: '/index.html',
          startLine: 2,
          endLine: 2,
        },
      },
      workspace: {
        activeProjectId: 'project-1',
        activityMessage:
          'modifyLinesInFile expectedOriginal no longer matches /index.html lines 2-2.',
        preview: null,
      },
    });
    expect(mockWriteFiles).not.toHaveBeenCalled();
    expect(mockResolveProjectForPreview).not.toHaveBeenCalled();
  });

  it('returns a recoverable result when modifyLinesInFile line range is outside the file', async () => {
    mockReadFile.mockResolvedValue({
      path: '/index.html',
      kind: 'html',
      content: '<h1>Title</h1>\n<p>Body</p>\n<footer>Footer</footer>',
      encoding: 'utf-8',
      dependencies: [],
      size: 54,
      updatedAt: 1700000001000,
    });

    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');

    const result = await executeHtmlProjectToolCall(
      {
        name: 'modifyLinesInFile',
        args: {
          projectId: 'project-1',
          path: '/index.html',
          operation: 'replace',
          startLine: 4,
          content: '<p>Updated</p>',
        },
      },
      {
        assistantId: 'assistant-1',
        activeProjectId: 'project-1',
      },
    );

    expect(result).toMatchObject({
      toolName: 'modifyLinesInFile',
      summary: 'modifyLinesInFile line range 4-4 is outside the file (total lines: 3).',
      result: {
        ok: false,
        recoverable: true,
        code: 'invalid-modify-lines-range',
        message: 'modifyLinesInFile line range 4-4 is outside the file (total lines: 3).',
        details: {
          startLine: 4,
          endLine: 4,
          totalLines: 3,
        },
      },
    });
    expect(mockWriteFiles).not.toHaveBeenCalled();
  });

  it('returns numberedContent and raw content from readFile', async () => {
    mockReadFile.mockResolvedValue({
      path: '/index.html',
      kind: 'html',
      content: 'alpha\nbeta\ngamma',
      encoding: 'utf-8',
      dependencies: [],
      size: 16,
      updatedAt: 1700000001000,
    });

    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');

    const result = await executeHtmlProjectToolCall(
      {
        name: 'readFile',
        args: {
          projectId: 'project-1',
          path: '/index.html',
        },
      },
      {
        assistantId: 'assistant-1',
        activeProjectId: 'project-1',
      },
    );

    expect(result).toMatchObject({
      toolName: 'readFile',
      summary: '已讀取檔案 /index.html。',
      result: {
        projectId: 'project-1',
        path: '/index.html',
        kind: 'html',
        content: 'alpha\nbeta\ngamma',
        numberedContent: '1 | alpha\n2 | beta\n3 | gamma',
        lineNumberFormat:
          'Each displayed line in numberedContent starts with "<line> | ". This prefix is only for display and is not part of the real file content.',
        lineStart: 1,
        lineEnd: 3,
        totalLines: 3,
        contentRangeOnly: false,
      },
    });
  });

  it('supports reading a line range with readFile', async () => {
    mockReadFile.mockResolvedValue({
      path: '/index.html',
      kind: 'html',
      content: 'alpha\nbeta\ngamma',
      encoding: 'utf-8',
      dependencies: [],
      size: 16,
      updatedAt: 1700000001000,
    });

    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');

    const result = await executeHtmlProjectToolCall(
      {
        name: 'readFile',
        args: {
          projectId: 'project-1',
          path: '/index.html',
          startLine: 2,
          endLine: 3,
        },
      },
      {
        assistantId: 'assistant-1',
        activeProjectId: 'project-1',
      },
    );

    expect(result).toMatchObject({
      toolName: 'readFile',
      summary: '已讀取檔案 /index.html 的第 2-3 行。',
      result: {
        content: 'beta\ngamma',
        numberedContent: '2 | beta\n3 | gamma',
        lineStart: 2,
        lineEnd: 3,
        totalLines: 3,
        contentRangeOnly: true,
      },
    });
  });

  it('clamps readFile endLine to the last line instead of failing when it overshoots', async () => {
    mockReadFile.mockResolvedValue({
      path: '/index.html',
      kind: 'html',
      content: 'alpha\nbeta\ngamma',
      encoding: 'utf-8',
      dependencies: [],
      size: 16,
      updatedAt: 1700000001000,
    });

    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');

    const result = await executeHtmlProjectToolCall(
      {
        name: 'readFile',
        args: {
          projectId: 'project-1',
          path: '/index.html',
          startLine: 1,
          endLine: 400,
        },
      },
      {
        assistantId: 'assistant-1',
        activeProjectId: 'project-1',
      },
    );

    expect(result).toMatchObject({
      toolName: 'readFile',
      summary: '已讀取檔案 /index.html 的第 1-3 行 (endLine 已收斂至檔案結尾，全檔共 3 行)。',
      result: {
        content: 'alpha\nbeta\ngamma',
        numberedContent: '1 | alpha\n2 | beta\n3 | gamma',
        lineStart: 1,
        lineEnd: 3,
        totalLines: 3,
        contentRangeOnly: true,
        endLineClamped: true,
      },
    });
  });

  it('returns a recoverable result when readFile startLine is beyond the end of the file', async () => {
    mockReadFile.mockResolvedValue({
      path: '/index.html',
      kind: 'html',
      content: 'alpha\nbeta\ngamma',
      encoding: 'utf-8',
      dependencies: [],
      size: 16,
      updatedAt: 1700000001000,
    });

    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');

    const result = await executeHtmlProjectToolCall(
      {
        name: 'readFile',
        args: {
          projectId: 'project-1',
          path: '/index.html',
          startLine: 10,
          endLine: 20,
        },
      },
      {
        assistantId: 'assistant-1',
        activeProjectId: 'project-1',
      },
    );

    expect(result).toMatchObject({
      toolName: 'readFile',
      summary: 'readFile startLine 10 is outside the file (total lines: 3).',
      result: {
        ok: false,
        recoverable: true,
        code: 'invalid-read-file-range',
        message: 'readFile startLine 10 is outside the file (total lines: 3).',
        details: {
          startLine: 10,
          endLine: 20,
          totalLines: 3,
        },
      },
    });
  });

  it('lists project todos for the owned project', async () => {
    mockListTodos.mockResolvedValue([
      {
        projectId: 'project-1',
        id: 'todo-1',
        title: 'Plan work',
        status: 'pending',
        order: 0,
        createdAt: 1700000001000,
        updatedAt: 1700000001000,
        completedAt: null,
      },
    ]);
    mockGetTodoSummary.mockResolvedValue({
      projectId: 'project-1',
      total: 1,
      pending: 1,
      inProgress: 0,
      completed: 0,
      allComplete: false,
    });

    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');

    const result = await executeHtmlProjectToolCall(
      {
        name: 'listProjectTodos',
        args: {
          projectId: 'project-1',
        },
      },
      {
        assistantId: 'assistant-1',
        activeProjectId: 'project-1',
      },
    );

    expect(result).toMatchObject({
      toolName: 'listProjectTodos',
      summary: '目前專案共有 1 項待辦。',
      result: {
        projectId: 'project-1',
        todos: [
          {
            id: 'todo-1',
            title: 'Plan work',
          },
        ],
        summary: {
          total: 1,
          pending: 1,
        },
      },
    });
  });

  it('sets project todos with normalized summary', async () => {
    mockReplaceTodos.mockResolvedValue({
      todos: [
        {
          projectId: 'project-1',
          id: 'todo-1',
          title: 'Plan work',
          status: 'pending',
          order: 0,
          createdAt: 1700000001000,
          updatedAt: 1700000001000,
          completedAt: null,
        },
      ],
      summary: {
        projectId: 'project-1',
        total: 1,
        pending: 1,
        inProgress: 0,
        completed: 0,
        allComplete: false,
      },
    });

    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');

    const result = await executeHtmlProjectToolCall(
      {
        name: 'setProjectTodos',
        args: {
          projectId: 'project-1',
          todos: [{ title: 'Plan work' }],
        },
      },
      {
        assistantId: 'assistant-1',
        activeProjectId: 'project-1',
      },
    );

    expect(mockReplaceTodos).toHaveBeenCalledWith('project-1', [
      {
        title: 'Plan work',
        description: undefined,
        status: 'pending',
        order: 0,
        id: undefined,
      },
    ]);
    expect(result).toMatchObject({
      toolName: 'setProjectTodos',
      summary: '已更新專案待辦清單。共 1 項待辦，未開始 1 項、進行中 0 項、已完成 0 項。',
    });
  });

  it('updates a project todo status', async () => {
    mockUpdateTodo.mockResolvedValue({
      todo: {
        projectId: 'project-1',
        id: 'todo-1',
        title: 'Plan work',
        status: 'completed',
        order: 0,
        createdAt: 1700000001000,
        updatedAt: 1700000002000,
        completedAt: 1700000002000,
      },
      summary: {
        projectId: 'project-1',
        total: 1,
        pending: 0,
        inProgress: 0,
        completed: 1,
        allComplete: true,
      },
    });

    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');

    const result = await executeHtmlProjectToolCall(
      {
        name: 'updateProjectTodo',
        args: {
          projectId: 'project-1',
          todoId: 'todo-1',
          status: 'completed',
        },
      },
      {
        assistantId: 'assistant-1',
        activeProjectId: 'project-1',
      },
    );

    expect(mockUpdateTodo).toHaveBeenCalledWith('project-1', 'todo-1', {
      status: 'completed',
    });
    expect(result).toMatchObject({
      toolName: 'updateProjectTodo',
      result: {
        todo: {
          id: 'todo-1',
          status: 'completed',
        },
        summary: {
          allComplete: true,
        },
      },
    });
  });

  it('deletes a project todo item', async () => {
    mockDeleteTodo.mockResolvedValue({
      deleted: 'todo-1',
      summary: {
        projectId: 'project-1',
        total: 0,
        pending: 0,
        inProgress: 0,
        completed: 0,
        allComplete: false,
      },
    });

    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');

    const result = await executeHtmlProjectToolCall(
      {
        name: 'deleteProjectTodo',
        args: {
          projectId: 'project-1',
          todoId: 'todo-1',
        },
      },
      {
        assistantId: 'assistant-1',
        activeProjectId: 'project-1',
      },
    );

    expect(result).toMatchObject({
      toolName: 'deleteProjectTodo',
      result: {
        deleted: 'todo-1',
        summary: {
          total: 0,
        },
      },
    });
  });

  it('checks whether all project todos are complete', async () => {
    mockListTodos.mockResolvedValue([
      {
        projectId: 'project-1',
        id: 'todo-1',
        title: 'Plan work',
        status: 'completed',
        order: 0,
        createdAt: 1700000001000,
        updatedAt: 1700000001000,
        completedAt: 1700000001000,
      },
    ]);
    mockGetTodoSummary.mockResolvedValue({
      projectId: 'project-1',
      total: 1,
      pending: 0,
      inProgress: 0,
      completed: 1,
      allComplete: true,
    });

    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');

    const result = await executeHtmlProjectToolCall(
      {
        name: 'checkProjectTodos',
        args: {
          projectId: 'project-1',
        },
      },
      {
        assistantId: 'assistant-1',
        activeProjectId: 'project-1',
      },
    );

    expect(result).toMatchObject({
      toolName: 'checkProjectTodos',
      summary: '所有專案待辦都已完成。',
      result: {
        allComplete: true,
        incompleteTodos: [],
      },
    });
  });

  it('returns missing-required-args before dispatch when readFile path is omitted or null', async () => {
    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');

    const omittedPathResult = await executeHtmlProjectToolCall(
      {
        name: 'readFile',
        args: {
          projectId: 'project-1',
        },
      },
      {
        assistantId: 'assistant-1',
        activeProjectId: 'project-1',
      },
    );

    const nullPathResult = await executeHtmlProjectToolCall(
      {
        name: 'readFile',
        args: {
          projectId: 'project-1',
          path: null,
        },
      },
      {
        assistantId: 'assistant-1',
        activeProjectId: 'project-1',
      },
    );

    expect(mockAssertProjectOwnership).not.toHaveBeenCalled();
    expect(mockReadFile).not.toHaveBeenCalled();
    expect(omittedPathResult).toMatchObject({
      toolName: 'readFile',
      summary: 'readFile is missing required arguments: path.',
      result: {
        ok: false,
        recoverable: true,
        code: 'missing-required-args',
        message: 'readFile is missing required arguments: path.',
        guidance: 'Retry with all required top-level arguments from the tool schema.',
        details: {
          missing: ['path'],
          required: ['path'],
        },
      },
      workspace: {
        activeProjectId: 'project-1',
        activityMessage: 'readFile is missing required arguments: path.',
        preview: null,
      },
    });
    expect(nullPathResult).toMatchObject({
      toolName: 'readFile',
      summary: 'readFile is missing required arguments: path.',
      result: {
        ok: false,
        recoverable: true,
        code: 'missing-required-args',
        message: 'readFile is missing required arguments: path.',
      },
    });
  });

  it('returns a structured recoverable result when readFile cannot find the requested path', async () => {
    mockReadFile.mockResolvedValue(undefined);

    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');

    const result = await executeHtmlProjectToolCall(
      {
        name: 'readFile',
        args: {
          projectId: 'project-1',
          path: '/missing.html',
        },
      },
      {
        assistantId: 'assistant-1',
        activeProjectId: 'project-1',
      },
    );

    expect(mockAssertProjectOwnership).toHaveBeenCalledWith('project-1', 'assistant-1');
    expect(mockReadFile).toHaveBeenCalledWith('project-1', '/missing.html');
    expect(result).toMatchObject({
      toolName: 'readFile',
      summary: 'Project file /missing.html not found.',
      result: {
        ok: false,
        recoverable: true,
        code: 'read-file-not-found',
        message: 'Project file /missing.html not found.',
        guidance:
          'Call listFiles or searchFiles first to confirm the exact virtual project path before retrying readFile.',
        details: {
          path: '/missing.html',
        },
      },
      workspace: {
        activeProjectId: 'project-1',
        activityMessage: 'Project file /missing.html not found.',
        preview: null,
      },
    });
  });

  it('lists assistant-scoped projects', async () => {
    mockListProjectsByAssistant.mockResolvedValue([
      {
        id: 'project-2',
        name: 'Landing Page',
        description: 'Marketing page',
        entryFile: '/landing.html',
        updatedAt: 1700000002000,
        previewVersion: 5,
      },
      {
        id: 'project-1',
        name: 'Canvas MVP',
        description: 'Project description',
        entryFile: '/index.html',
        updatedAt: 1700000001000,
        previewVersion: 3,
      },
    ]);

    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');

    const result = await executeHtmlProjectToolCall(
      {
        name: 'listProjects',
        args: {},
      },
      {
        assistantId: 'assistant-1',
        activeProjectId: 'project-1',
      },
    );

    expect(mockListProjectsByAssistant).toHaveBeenCalledWith('assistant-1');
    expect(result).toMatchObject({
      toolName: 'listProjects',
      summary: '目前 assistant 共有 2 個 HTML 專案。',
      result: {
        projects: [
          {
            projectId: 'project-2',
            name: 'Landing Page',
            description: 'Marketing page',
            entryFile: '/landing.html',
            updatedAt: 1700000002000,
            previewVersion: 5,
          },
          {
            projectId: 'project-1',
            name: 'Canvas MVP',
            description: 'Project description',
            entryFile: '/index.html',
            updatedAt: 1700000001000,
            previewVersion: 3,
          },
        ],
      },
      workspace: {
        activeProjectId: 'project-1',
        activityMessage: '目前 assistant 共有 2 個 HTML 專案。',
        preview: null,
      },
    });
  });

  it('opens an owned project and returns preview metadata', async () => {
    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');

    const result = await executeHtmlProjectToolCall(
      {
        name: 'openProject',
        args: {
          projectId: 'project-1',
        },
      },
      {
        assistantId: 'assistant-1',
        activeProjectId: null,
      },
    );

    expect(mockAssertProjectOwnership).toHaveBeenCalledWith('project-1', 'assistant-1');
    expect(mockResolveProjectForPreview).toHaveBeenCalledWith('project-1');
    expect(result).toMatchObject({
      toolName: 'openProject',
      summary: '已開啟既有 HTML 專案「Canvas MVP」。',
      result: {
        projectId: 'project-1',
        name: 'Canvas MVP',
        entryFile: '/index.html',
        previewVersion: 3,
      },
      workspace: {
        activeProjectId: 'project-1',
        activityMessage: '已開啟既有 HTML 專案「Canvas MVP」。',
        preview: {
          projectId: 'project-1',
          previewVersion: 3,
        },
      },
    });
  });

  it('returns a project summary with preview diagnostics and suggested next action', async () => {
    mockListFiles.mockResolvedValue([
      {
        path: '/index.html',
        kind: 'html',
        size: 18,
        updatedAt: 1700000001000,
        dependencies: ['/scripts/app.js'],
      },
    ]);
    mockGetTodoSummary.mockResolvedValue({
      projectId: 'project-1',
      total: 2,
      pending: 1,
      inProgress: 1,
      completed: 0,
      allComplete: false,
    });
    mockBuildPreviewArtifact.mockResolvedValue({
      projectId: 'project-1',
      previewVersion: 3,
      entryFile: '/index.html',
      previewReady: false,
      previewUrlType: 'blob',
      html: '<html></html>',
      warnings: ['保留外部腳本資源：https://cdn.example.com/app.js'],
      error: '缺少預覽所需檔案：/scripts/app.js',
      diagnostics: {
        category: 'missing_reference',
        outcome: 'repairable_error',
        repairable: true,
        summary: 'Missing preview dependencies: /scripts/app.js.',
        missingPaths: ['/scripts/app.js'],
        warnings: ['保留外部腳本資源：https://cdn.example.com/app.js'],
        details: [
          'Restore the missing file(s) or update the HTML references before retrying preview.',
        ],
      },
      generatedAt: 1700000000000,
    });

    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');

    const result = await executeHtmlProjectToolCall(
      {
        name: 'getProjectSummary',
        args: {
          projectId: 'project-1',
        },
      },
      {
        assistantId: 'assistant-1',
        activeProjectId: 'project-9',
      },
    );

    expect(mockAssertProjectOwnership).toHaveBeenCalledWith('project-1', 'assistant-1');
    expect(mockListFiles).toHaveBeenCalledWith('project-1');
    expect(mockGetTodoSummary).toHaveBeenCalledWith('project-1');
    expect(mockBuildPreviewArtifact).toHaveBeenCalledWith('project-1');
    expect(result).toMatchObject({
      toolName: 'getProjectSummary',
      result: {
        projectSummary: {
          projectId: 'project-1',
          name: 'Canvas MVP',
          entryFile: '/index.html',
          previewReady: false,
          fileCount: 1,
          todoSummary: {
            total: 2,
            pending: 1,
            inProgress: 1,
            completed: 0,
            allComplete: false,
          },
          previewDiagnostics: {
            category: 'missing_reference',
            outcome: 'repairable_error',
            repairable: true,
          },
          suggestedNextActionCategory: 'repair_preview',
        },
      },
      workspace: {
        activeProjectId: 'project-1',
        activityMessage: expect.stringContaining('建議下一步：repair_preview'),
        preview: null,
      },
    });
  });

  it('returns renderPreview diagnostics when the preview is still broken', async () => {
    mockResolveProjectForPreview.mockResolvedValue({
      projectId: 'project-1',
      previewVersion: 4,
      entryFile: '/index.html',
      previewReady: false,
      previewUrlType: 'blob',
      html: '<html></html>',
      warnings: ['保留外部樣式資源：https://cdn.example.com/app.css'],
      error: '缺少預覽所需檔案：/styles/app.css',
      diagnostics: {
        category: 'missing_reference',
        outcome: 'repairable_error',
        repairable: true,
        summary: 'Missing preview dependencies: /styles/app.css.',
        missingPaths: ['/styles/app.css'],
        warnings: ['保留外部樣式資源：https://cdn.example.com/app.css'],
        details: [
          'Restore the missing file(s) or update the HTML references before retrying preview.',
        ],
      },
      generatedAt: 1700000000000,
    });

    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');

    const result = await executeHtmlProjectToolCall(
      {
        name: 'renderPreview',
        args: {
          projectId: 'project-1',
        },
      },
      {
        assistantId: 'assistant-1',
        activeProjectId: 'project-1',
      },
    );

    expect(mockAssertProjectOwnership).toHaveBeenCalledWith('project-1', 'assistant-1');
    expect(mockResolveProjectForPreview).toHaveBeenCalledWith('project-1');
    expect(result).toMatchObject({
      toolName: 'renderPreview',
      summary: '預覽重建失敗：缺少預覽所需檔案：/styles/app.css',
      result: {
        projectId: 'project-1',
        previewVersion: 4,
        entryFile: '/index.html',
        previewReady: false,
        error: '缺少預覽所需檔案：/styles/app.css',
        diagnostics: {
          category: 'missing_reference',
          outcome: 'repairable_error',
          repairable: true,
        },
      },
      workspace: {
        activeProjectId: 'project-1',
        activityMessage: '預覽重建失敗：缺少預覽所需檔案：/styles/app.css',
        preview: {
          projectId: 'project-1',
          previewVersion: 4,
          previewReady: false,
        },
      },
    });
  });

  it('searches files in the owned project', async () => {
    mockSearchFiles.mockResolvedValue({
      projectId: 'project-1',
      query: 'needle',
      caseSensitive: false,
      scannedFiles: 2,
      truncated: true,
      matches: [
        {
          path: '/index.html',
          kind: 'html',
          line: 1,
          column: 7,
          snippet: '...needle...',
          matchCount: 1,
        },
      ],
      skippedFiles: [{ path: '/assets/logo.bin', reason: 'unsupported-kind' }],
    });

    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');

    const result = await executeHtmlProjectToolCall(
      {
        name: 'searchFiles',
        args: {
          projectId: 'project-1',
          query: 'needle',
        },
      },
      {
        assistantId: 'assistant-1',
        activeProjectId: 'project-9',
      },
    );

    expect(mockAssertProjectOwnership).toHaveBeenCalledWith('project-1', 'assistant-1');
    expect(mockSearchFiles).toHaveBeenCalledWith('project-1', {
      query: 'needle',
      caseSensitive: undefined,
    });
    expect(result).toMatchObject({
      toolName: 'searchFiles',
      summary: '在 2 個可搜尋檔案中找到 1 個「needle」結果，結果已截斷。',
      result: {
        projectId: 'project-1',
        query: 'needle',
        truncated: true,
      },
      workspace: {
        activeProjectId: 'project-1',
        activityMessage: '在 2 個可搜尋檔案中找到 1 個「needle」結果，結果已截斷。',
      },
    });
  });

  it('lists files for the owned project', async () => {
    mockListFiles.mockResolvedValue([
      {
        path: '/index.html',
        kind: 'html',
        content: '<main>Hello</main>',
        encoding: 'utf-8',
        dependencies: [],
        size: 18,
        updatedAt: 1700000001000,
      },
      {
        path: '/styles.css',
        kind: 'css',
        content: 'body { color: red; }',
        encoding: 'utf-8',
        dependencies: [],
        size: 20,
        updatedAt: 1700000001000,
      },
    ]);

    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');

    const result = await executeHtmlProjectToolCall(
      {
        name: 'listFiles',
        args: {
          projectId: 'project-1',
        },
      },
      {
        assistantId: 'assistant-1',
        activeProjectId: 'project-9',
      },
    );

    expect(mockAssertProjectOwnership).toHaveBeenCalledWith('project-1', 'assistant-1');
    expect(mockListFiles).toHaveBeenCalledWith('project-1');
    expect(result).toMatchObject({
      toolName: 'listFiles',
      summary: '目前專案共有 2 個檔案。',
      result: {
        projectId: 'project-1',
        entryFile: '/index.html',
        previewVersion: 3,
        files: [
          { path: '/index.html', kind: 'html' },
          { path: '/styles.css', kind: 'css' },
        ],
      },
      workspace: {
        activeProjectId: 'project-1',
        activityMessage: '目前專案共有 2 個檔案。',
        preview: null,
      },
    });
  });

  it('denies explicit project access when the project belongs to another assistant', async () => {
    mockAssertProjectOwnership.mockRejectedValue(new Error('HTML project project-2 not found.'));

    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');

    await expect(
      executeHtmlProjectToolCall(
        {
          name: 'searchFiles',
          args: {
            projectId: 'project-2',
            query: 'needle',
          },
        },
        {
          assistantId: 'assistant-1',
          activeProjectId: 'project-1',
        },
      ),
    ).rejects.toThrow('HTML project project-2 not found.');

    expect(mockAssertProjectOwnership).toHaveBeenCalledWith('project-2', 'assistant-1');
    expect(mockSearchFiles).not.toHaveBeenCalled();
  });

  it('copies a project file and refreshes preview metadata', async () => {
    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');

    const result = await executeHtmlProjectToolCall(
      {
        name: 'copyFile',
        args: {
          projectId: 'project-1',
          sourcePath: '/index.html',
          destinationPath: '/index-copy.html',
        },
      },
      {
        assistantId: 'assistant-1',
        activeProjectId: 'project-1',
      },
    );

    expect(mockCopyFile).toHaveBeenCalledWith('project-1', '/index.html', '/index-copy.html');
    expect(mockResolveProjectForPreview).toHaveBeenCalledWith('project-1');
    expect(result).toMatchObject({
      toolName: 'copyFile',
      summary: '已複製檔案 /index.html -> /index-copy.html。',
      result: {
        projectId: 'project-1',
        sourcePath: '/index.html',
        destinationPath: '/index-copy.html',
        copied: true,
        previewVersion: 4,
      },
      workspace: {
        activeProjectId: 'project-1',
        activityMessage: '已複製檔案 /index.html -> /index-copy.html。',
      },
    });
  });

  it('renames a project file and refreshes preview metadata', async () => {
    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');

    const result = await executeHtmlProjectToolCall(
      {
        name: 'renameFile',
        args: {
          projectId: 'project-1',
          sourcePath: '/index.html',
          destinationPath: '/pages/home.html',
        },
      },
      {
        assistantId: 'assistant-1',
        activeProjectId: 'project-1',
      },
    );

    expect(mockRenameFile).toHaveBeenCalledWith('project-1', '/index.html', '/pages/home.html');
    expect(mockResolveProjectForPreview).toHaveBeenCalledWith('project-1');
    expect(result).toMatchObject({
      toolName: 'renameFile',
      summary: '已重新命名檔案 /index.html -> /pages/home.html。',
      result: {
        projectId: 'project-1',
        sourcePath: '/index.html',
        destinationPath: '/pages/home.html',
        renamed: true,
        previewVersion: 4,
      },
      workspace: {
        activeProjectId: 'project-1',
        activityMessage: '已重新命名檔案 /index.html -> /pages/home.html。',
      },
    });
  });

  it('returns a recoverable result when copyFile source and destination normalize to the same path', async () => {
    mockCopyFile.mockRejectedValue(new Error('Source and destination paths must be different.'));

    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');

    const result = await executeHtmlProjectToolCall(
      {
        name: 'copyFile',
        args: {
          projectId: 'project-1',
          sourcePath: '/index.html',
          destinationPath: './index.html',
        },
      },
      {
        assistantId: 'assistant-1',
        activeProjectId: 'project-1',
      },
    );

    expect(result).toMatchObject({
      toolName: 'copyFile',
      summary: 'Source and destination paths must be different.',
      result: {
        ok: false,
        recoverable: true,
        code: 'copy-file-same-path',
      },
    });
    expect(mockResolveProjectForPreview).not.toHaveBeenCalled();
  });

  it('returns a recoverable result when copyFile destination already exists', async () => {
    mockCopyFile.mockRejectedValue(new Error('Project file /index-copy.html already exists.'));

    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');

    const result = await executeHtmlProjectToolCall(
      {
        name: 'copyFile',
        args: {
          projectId: 'project-1',
          sourcePath: '/index.html',
          destinationPath: '/index-copy.html',
        },
      },
      {
        assistantId: 'assistant-1',
        activeProjectId: 'project-1',
      },
    );

    expect(result).toMatchObject({
      toolName: 'copyFile',
      summary: 'Project file /index-copy.html already exists.',
      result: {
        ok: false,
        recoverable: true,
        code: 'copy-file-destination-exists',
        details: {
          destinationPath: '/index-copy.html',
        },
      },
    });
    expect(mockResolveProjectForPreview).not.toHaveBeenCalled();
  });

  it('returns a recoverable result when renameFile source is missing', async () => {
    mockRenameFile.mockRejectedValue(new Error('Project file /missing.html not found.'));

    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');

    const result = await executeHtmlProjectToolCall(
      {
        name: 'renameFile',
        args: {
          projectId: 'project-1',
          sourcePath: '/missing.html',
          destinationPath: '/pages/home.html',
        },
      },
      {
        assistantId: 'assistant-1',
        activeProjectId: 'project-1',
      },
    );

    expect(result).toMatchObject({
      toolName: 'renameFile',
      summary: 'Project file /missing.html not found.',
      result: {
        ok: false,
        recoverable: true,
        code: 'rename-file-source-not-found',
        details: {
          sourcePath: '/missing.html',
        },
      },
    });
    expect(mockResolveProjectForPreview).not.toHaveBeenCalled();
  });
});

describe('getHtmlProjectToolDefinitions', () => {
  it('includes project summary and preview tool guidance alongside edit definitions', async () => {
    const { getHtmlProjectToolDefinitions } = await import('./htmlProjectToolService');

    const definitions = getHtmlProjectToolDefinitions();
    const getProjectSummaryDefinition = definitions.find(
      ({ name }) => name === 'getProjectSummary',
    );
    const writeFilesDefinition = definitions.find(({ name }) => name === 'writeFiles');
    const replaceInFileDefinition = definitions.find(({ name }) => name === 'replaceInFile');
    const modifyLinesInFileDefinition = definitions.find(
      ({ name }) => name === 'modifyLinesInFile',
    );
    const copyFileDefinition = definitions.find(({ name }) => name === 'copyFile');
    const renameFileDefinition = definitions.find(({ name }) => name === 'renameFile');
    const listProjectTodosDefinition = definitions.find(({ name }) => name === 'listProjectTodos');
    const setProjectTodosDefinition = definitions.find(({ name }) => name === 'setProjectTodos');
    const readFileDefinition = definitions.find(({ name }) => name === 'readFile');
    const renderPreviewDefinition = definitions.find(({ name }) => name === 'renderPreview');

    expect(getProjectSummaryDefinition).toMatchObject({
      name: 'getProjectSummary',
      parameters: {
        required: [],
      },
    });
    expect(replaceInFileDefinition).toMatchObject({
      name: 'replaceInFile',
      parameters: {
        required: ['path', 'oldText', 'newText'],
      },
    });
    expect(modifyLinesInFileDefinition).toMatchObject({
      name: 'modifyLinesInFile',
      parameters: {
        required: ['path', 'operation', 'startLine'],
      },
    });
    expect(copyFileDefinition).toMatchObject({
      name: 'copyFile',
      parameters: {
        required: ['sourcePath', 'destinationPath'],
      },
    });
    expect(renameFileDefinition).toMatchObject({
      name: 'renameFile',
      parameters: {
        required: ['sourcePath', 'destinationPath'],
      },
    });
    expect(listProjectTodosDefinition).toMatchObject({
      name: 'listProjectTodos',
    });
    expect(setProjectTodosDefinition).toMatchObject({
      name: 'setProjectTodos',
      parameters: {
        required: ['todos'],
      },
    });
    expect(getProjectSummaryDefinition?.description).toContain('compact summary');
    expect(getProjectSummaryDefinition?.description).toContain('suggested next action');
    expect(writeFilesDefinition?.description).toContain(
      'Write or overwrite one or more small complete project files in a single tool call.',
    );
    expect(writeFilesDefinition?.description).toContain(
      'Use virtual project-root paths like /index.html, /src/app.js, or /data/ruby.js.',
    );
    expect(writeFilesDefinition?.description).toContain(
      'For existing files, prefer readFile plus replaceInFile or modifyLinesInFile over sending a large full-file rewrite.',
    );
    expect(copyFileDefinition?.description).toContain('virtual project-root path');
    expect(copyFileDefinition?.description).toContain('file duplication');
    expect(renameFileDefinition?.description).toContain('virtual project-root path');
    expect(renameFileDefinition?.description).toContain('path changes');
    expect(readFileDefinition?.description).toContain('numberedContent');
    expect(readFileDefinition?.description).toContain(
      'that prefix is not part of the real file content',
    );
    expect(renderPreviewDefinition?.description).toContain('preview refresh/recheck');
    expect(renderPreviewDefinition?.description).toContain(
      'repair diagnostics require revalidation',
    );
  });
});

// ============================================================================
// T4 Harness tool tests (G2/G1/G11)
// ============================================================================

describe('getHtmlProjectToolNamesForPacks (harness-resident tools)', () => {
  it('auto-attaches all 5 harness-resident tools for any non-empty HTML pack set', async () => {
    const { getHtmlProjectToolNamesForPacks } = await import('./htmlProjectToolService');

    const residentTools = [
      'reportTurnOutcome',
      'getPreviewRuntimeErrors',
      'listSnapshots',
      'revertToSnapshot',
      'lintProject',
    ];

    for (const pack of [
      'bootstrap',
      'inspect',
      'edit',
      'todo_finalize',
      'preview_recheck',
    ] as const) {
      const names = getHtmlProjectToolNamesForPacks([pack]);
      for (const tool of residentTools) {
        expect(names).toContain(tool);
      }
    }
  });

  it('returns empty array (no resident tools) when pack set is empty', async () => {
    const { getHtmlProjectToolNamesForPacks } = await import('./htmlProjectToolService');
    expect(getHtmlProjectToolNamesForPacks([])).toEqual([]);
  });

  it('dedupes resident tools when multiple packs are selected', async () => {
    const { getHtmlProjectToolNamesForPacks } = await import('./htmlProjectToolService');
    const names = getHtmlProjectToolNamesForPacks(['inspect', 'edit']);
    const reportCount = names.filter(n => n === 'reportTurnOutcome').length;
    const lintCount = names.filter(n => n === 'lintProject').length;
    expect(reportCount).toBe(1);
    expect(lintCount).toBe(1);
  });
});

describe('executeHtmlProjectToolCall — harness tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssertProjectOwnership.mockResolvedValue({
      id: 'project-1',
      assistantId: 'assistant-1',
      sessionId: 'session-1',
      name: 'Canvas MVP',
      description: 'Project description',
      entryFile: '/index.html',
      previewVersion: 3,
    });
    mockListProjectFiles.mockResolvedValue([]);
  });

  it('reportTurnOutcome returns outcome + todoSummary + previewDiagnosticState', async () => {
    mockGetTodoSummary.mockResolvedValueOnce({
      projectId: 'project-1',
      total: 4,
      pending: 1,
      inProgress: 1,
      completed: 2,
      allComplete: false,
    });
    mockWaitForRuntimeDiagnostics.mockResolvedValueOnce({
      projectId: 'project-1',
      previewVersion: 3,
      status: 'clean',
      errors: [],
      readyAckReceived: true,
      waitedForReadyAck: false,
      waitMs: 0,
    });

    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');
    const result = await executeHtmlProjectToolCall(
      {
        name: 'reportTurnOutcome',
        args: { outcome: 'continue_needed', notes: 'still fixing preview' },
      },
      { assistantId: 'assistant-1', sessionId: 'session-1', activeProjectId: 'project-1' },
    );

    expect(result.toolName).toBe('reportTurnOutcome');
    expect(result.result.outcome).toBe('continue_needed');
    expect(result.result.notes).toBe('still fixing preview');
    expect(result.result.todoSummary).toMatchObject({ total: 4, completed: 2 });
    expect(result.result.previewDiagnosticState).toBe('clean');
  });

  it('reportTurnOutcome defaults invalid outcome to complete', async () => {
    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');
    const result = await executeHtmlProjectToolCall(
      { name: 'reportTurnOutcome', args: { outcome: 'unknown-value' } },
      { assistantId: 'assistant-1', activeProjectId: 'project-1' },
    );
    expect(result.result.outcome).toBe('complete');
  });

  it('getPreviewRuntimeErrors clamps waitMs to [0, 5000] and defaults to 1500', async () => {
    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');

    // Default 1500
    await executeHtmlProjectToolCall(
      { name: 'getPreviewRuntimeErrors', args: {} },
      { assistantId: 'assistant-1', activeProjectId: 'project-1' },
    );
    expect(mockWaitForRuntimeDiagnostics).toHaveBeenLastCalledWith('project-1', 3, 1500);

    // Clamp high
    await executeHtmlProjectToolCall(
      { name: 'getPreviewRuntimeErrors', args: { waitMs: 99999 } },
      { assistantId: 'assistant-1', activeProjectId: 'project-1' },
    );
    expect(mockWaitForRuntimeDiagnostics).toHaveBeenLastCalledWith('project-1', 3, 5000);

    // Clamp negative
    await executeHtmlProjectToolCall(
      { name: 'getPreviewRuntimeErrors', args: { waitMs: -100 } },
      { assistantId: 'assistant-1', activeProjectId: 'project-1' },
    );
    expect(mockWaitForRuntimeDiagnostics).toHaveBeenLastCalledWith('project-1', 3, 0);
  });

  it('listSnapshots returns the store result', async () => {
    mockListSnapshots.mockResolvedValueOnce({
      projectId: 'project-1',
      snapshots: [
        { projectId: 'project-1', version: 3, files: ['/index.html'], createdAt: 1 },
        { projectId: 'project-1', version: 2, files: ['/index.html'], createdAt: 2 },
      ],
      retainedLimit: 20,
    });

    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');
    const result = await executeHtmlProjectToolCall(
      { name: 'listSnapshots', args: {} },
      { assistantId: 'assistant-1', activeProjectId: 'project-1' },
    );

    expect(result.toolName).toBe('listSnapshots');
    expect(result.result.snapshots).toHaveLength(2);
    expect(result.result.retainedLimit).toBe(20);
  });

  it('revertToSnapshot calls store + clears runtime diagnostics', async () => {
    mockRevertToSnapshot.mockResolvedValueOnce({
      projectId: 'project-1',
      revertedToVersion: 2,
      previewVersion: 4,
      runtimeDiagnosticsCleared: true,
      filesRestored: 3,
    });

    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');
    const result = await executeHtmlProjectToolCall(
      { name: 'revertToSnapshot', args: { version: 2 } },
      { assistantId: 'assistant-1', activeProjectId: 'project-1' },
    );

    expect(mockRevertToSnapshot).toHaveBeenCalledWith('project-1', 2);
    expect(mockClearRuntimeDiagnostics).toHaveBeenCalledWith('project-1');
    expect(result.toolName).toBe('revertToSnapshot');
    expect(result.result).toMatchObject({
      revertedToVersion: 2,
      previewVersion: 4,
      runtimeDiagnosticsCleared: true,
      filesRestored: 3,
    });
  });

  it('revertToSnapshot returns recoverable error for non-numeric version', async () => {
    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');
    const result = await executeHtmlProjectToolCall(
      { name: 'revertToSnapshot', args: { version: 'abc' } },
      { assistantId: 'assistant-1', activeProjectId: 'project-1' },
    );

    expect(result.result).toMatchObject({
      ok: false,
      recoverable: true,
      code: 'invalid-revert-version',
    });
    expect(mockRevertToSnapshot).not.toHaveBeenCalled();
  });

  it('lintProject returns zero-count validation results for a clean project', async () => {
    mockListProjectFiles.mockResolvedValueOnce([
      {
        path: '/index.html',
        kind: 'html',
        content: '<main>Hello</main>',
        encoding: 'utf-8',
      },
      {
        path: '/styles.css',
        kind: 'css',
        content: 'body { color: red; }',
        encoding: 'utf-8',
      },
    ]);

    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');
    const result = await executeHtmlProjectToolCall(
      { name: 'lintProject', args: {} },
      { assistantId: 'assistant-1', activeProjectId: 'project-1' },
    );

    expect(mockAssertProjectOwnership).toHaveBeenCalledWith('project-1', 'assistant-1');
    expect(mockListProjectFiles).toHaveBeenCalledWith('project-1');
    expect(result).toMatchObject({
      toolName: 'lintProject',
      summary: 'lintProject 已檢查整個專案，未發現靜態驗證問題。',
      result: {
        projectId: 'project-1',
        checkedPaths: ['/index.html', '/styles.css'],
        ok: true,
        errorCount: 0,
        warningCount: 0,
        staticValidation: {
          ok: true,
          errorCount: 0,
          warningCount: 0,
        },
      },
      workspace: {
        activeProjectId: 'project-1',
        activityMessage: 'lintProject 已檢查整個專案，未發現靜態驗證問題。',
        preview: null,
      },
    });
  });

  it('lintProject uses the active project when projectId is omitted', async () => {
    mockListProjectFiles.mockResolvedValueOnce([
      {
        path: '/index.html',
        kind: 'html',
        content: '<main>Hello</main>',
        encoding: 'utf-8',
      },
    ]);

    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');
    const result = await executeHtmlProjectToolCall(
      { name: 'lintProject', args: {} },
      { assistantId: 'assistant-1', activeProjectId: 'project-1' },
    );

    expect(mockAssertProjectOwnership).toHaveBeenCalledWith('project-1', 'assistant-1');
    expect(mockListProjectFiles).toHaveBeenCalledWith('project-1');
    expect(result).toMatchObject({
      toolName: 'lintProject',
      result: {
        projectId: 'project-1',
        checkedPaths: ['/index.html'],
        errorCount: 0,
        warningCount: 0,
      },
    });
  });

  it('lintProject returns a recoverable error when requested paths are missing', async () => {
    mockListProjectFiles.mockResolvedValueOnce([
      {
        path: '/index.html',
        kind: 'html',
        content: '<main>Hello</main>',
        encoding: 'utf-8',
      },
    ]);

    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');
    const result = await executeHtmlProjectToolCall(
      { name: 'lintProject', args: { projectId: 'project-1', paths: ['/missing.js'] } },
      { assistantId: 'assistant-1', activeProjectId: 'project-1' },
    );

    expect(result).toMatchObject({
      toolName: 'lintProject',
      summary: 'lintProject could not find 1 requested path(s).',
      result: {
        ok: false,
        recoverable: true,
        code: 'lint-path-not-found',
        message: 'lintProject could not find 1 requested path(s).',
        details: {
          missingPaths: ['/missing.js'],
          availablePaths: ['/index.html'],
        },
      },
    });
  });

  it('lintProject enforces the maximum file count limit', async () => {
    mockListProjectFiles.mockResolvedValueOnce(
      Array.from({ length: 51 }, (_, index) => ({
        path: `/file-${index}.js`,
        kind: 'js',
        content: 'export const value = 1;',
        encoding: 'utf-8',
      })),
    );

    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');
    const result = await executeHtmlProjectToolCall(
      { name: 'lintProject', args: { projectId: 'project-1' } },
      { assistantId: 'assistant-1', activeProjectId: 'project-1' },
    );

    expect(result).toMatchObject({
      toolName: 'lintProject',
      summary: 'lintProject can validate at most 50 files per call.',
      result: {
        ok: false,
        recoverable: true,
        code: 'lint-too-many-files',
        message: 'lintProject can validate at most 50 files per call.',
        details: {
          fileCount: 51,
          maxFiles: 50,
        },
      },
    });
  });

  it('lintProject enforces the maximum payload size limit', async () => {
    mockListProjectFiles.mockResolvedValueOnce([
      {
        path: '/large.js',
        kind: 'js',
        content: 'a'.repeat(512 * 1024 + 1),
        encoding: 'utf-8',
      },
    ]);

    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');
    const result = await executeHtmlProjectToolCall(
      { name: 'lintProject', args: { projectId: 'project-1' } },
      { assistantId: 'assistant-1', activeProjectId: 'project-1' },
    );

    expect(result).toMatchObject({
      toolName: 'lintProject',
      summary: `lintProject input is too large (${512 * 1024 + 1} bytes).`,
      result: {
        ok: false,
        recoverable: true,
        code: 'lint-payload-too-large',
        message: `lintProject input is too large (${512 * 1024 + 1} bytes).`,
        details: {
          fileCount: 1,
          totalBytes: 512 * 1024 + 1,
          maxBytes: 512 * 1024,
        },
      },
    });
  });
});

describe('write-tool dynamic-code syntax warnings (G11)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('flags new Function( in writeFiles content', async () => {
    mockWriteFiles.mockResolvedValueOnce({ updated: ['/evil.js'], previewVersion: 4 });

    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');
    const result = await executeHtmlProjectToolCall(
      {
        name: 'writeFiles',
        args: {
          files: [{ path: '/evil.js', content: 'var x = new Function("return 1")' }],
        },
      },
      { assistantId: 'assistant-1', activeProjectId: 'project-1' },
    );

    expect(result.result.warnings).toEqual([
      'Detected dynamic code pattern (new Function/DOMParser); ensure this is intended.',
    ]);
    expect(result.result.moduleSyntaxSkipped).toBeUndefined();
  });

  it('skips warning and sets moduleSyntaxSkipped for ESM content', async () => {
    mockWriteFiles.mockResolvedValueOnce({ updated: ['/mod.js'], previewVersion: 4 });

    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');
    const result = await executeHtmlProjectToolCall(
      {
        name: 'writeFiles',
        args: {
          files: [
            {
              path: '/mod.js',
              content: 'import { foo } from "./bar";\nexport const x = new Function("return 1");',
            },
          ],
        },
      },
      { assistantId: 'assistant-1', activeProjectId: 'project-1' },
    );

    expect(result.result.warnings).toBeUndefined();
    expect(result.result.moduleSyntaxSkipped).toBe(true);
  });

  it('does not flag benign content', async () => {
    mockWriteFiles.mockResolvedValueOnce({ updated: ['/index.html'], previewVersion: 4 });

    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');
    const result = await executeHtmlProjectToolCall(
      {
        name: 'writeFiles',
        args: {
          files: [{ path: '/index.html', content: '<div>hello world</div>' }],
        },
      },
      { assistantId: 'assistant-1', activeProjectId: 'project-1' },
    );

    expect(result.result.warnings).toBeUndefined();
    expect(result.result.moduleSyntaxSkipped).toBeUndefined();
  });

  it('flags DOMParser usage in replaceInFile', async () => {
    mockReadFile.mockResolvedValueOnce({
      projectId: 'project-1',
      path: '/parse.js',
      kind: 'js',
      content: 'var old;',
      encoding: 'utf-8',
      size: 8,
      updatedAt: 1,
    });
    mockWriteFiles.mockResolvedValueOnce({ updated: ['/parse.js'], previewVersion: 4 });

    const { executeHtmlProjectToolCall } = await import('./htmlProjectToolService');
    const result = await executeHtmlProjectToolCall(
      {
        name: 'replaceInFile',
        args: {
          path: '/parse.js',
          oldText: 'old',
          newText: 'new DOMParser().parseFromString(html, "text/html")',
        },
      },
      { assistantId: 'assistant-1', activeProjectId: 'project-1' },
    );

    expect(result.result.warnings).toEqual([
      'Detected dynamic code pattern (new Function/DOMParser); ensure this is intended.',
    ]);
  });
});

describe('harness tool definitions', () => {
  it('exposes all 5 resident tool definitions', async () => {
    const { getHtmlProjectToolDefinitions } = await import('./htmlProjectToolService');
    const names = getHtmlProjectToolDefinitions().map(d => d.name);
    expect(names).toContain('reportTurnOutcome');
    expect(names).toContain('getPreviewRuntimeErrors');
    expect(names).toContain('listSnapshots');
    expect(names).toContain('revertToSnapshot');
    expect(names).toContain('lintProject');
  });

  it('exports write-pack names as a subset of known HTML project packs', async () => {
    const { getHtmlProjectToolPackNames, HTML_PROJECT_WRITE_PACK_NAMES } = await import(
      './htmlProjectToolService'
    );
    const packNames = new Set(getHtmlProjectToolPackNames());
    expect(HTML_PROJECT_WRITE_PACK_NAMES.length).toBeGreaterThan(0);
    for (const packName of HTML_PROJECT_WRITE_PACK_NAMES) {
      expect(packNames.has(packName)).toBe(true);
    }
  });
});
