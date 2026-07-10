import {
  HtmlProject,
  HtmlProjectFileKind,
  HtmlProjectGitBranchesResult,
  HtmlProjectGitCommitResult,
  HtmlProjectGitDiffResult,
  HtmlProjectGitLogResult,
  HtmlProjectGitStatusResult,
  HtmlProjectHarnessToolName,
  HtmlProjectListSnapshotsResult,
  HtmlProjectPreviewArtifact,
  HtmlProjectRevertToSnapshotResult,
  HtmlProjectRuntimeDiagnosticResult,
  HtmlProjectRuntimeDiagnosticStatus,
  HtmlProjectSummary,
  HtmlProjectTodoStatus,
  HtmlProjectToolExecutionResult,
  HtmlProjectToolPackName,
  HtmlProjectWorkspaceUpdate,
  ReportTurnOutcome,
  ReportTurnOutcomeResult,
} from '../types';
import type { ToolCall, ToolDefinition } from './llmAdapter';
import { htmlPreviewService } from './htmlPreviewService';
import * as gitService from './htmlProjectGitService';
import {
  HtmlProjectPathValidationError,
  htmlProjectStore,
  type WriteHtmlProjectFileInput,
} from './htmlProjectStore';
import { getTemplateFiles, type HtmlProjectTemplate } from './htmlProjectTemplates';
import { previewRuntimeDiagnostics } from './previewRuntimeDiagnostics';
import {
  formatStaticDiagnosticsForLlm,
  preloadStaticValidationParsers,
  validateProjectFiles,
  type StaticValidationFileInput,
} from './staticValidationService';

const HTML_PROJECT_TOOL_NAMES = [
  'createProject',
  'listProjects',
  'openProject',
  'getProjectSummary',
  'searchFiles',
  'writeFiles',
  'replaceInFile',
  'modifyLinesInFile',
  'listFiles',
  'readFile',
  'listProjectTodos',
  'setProjectTodos',
  'updateProjectTodo',
  'deleteProjectTodo',
  'checkProjectTodos',
  'deleteFile',
  'copyFile',
  'renameFile',
  'setEntrypoint',
  'renderPreview',
  // G2/G1/G11 harness-resident tools (auto-attached for any non-empty HTML pack set)
  'reportTurnOutcome',
  'getPreviewRuntimeErrors',
  'listSnapshots',
  'revertToSnapshot',
  'lintProject',
  // Phase 3 本地 git 工具 (走 pack 分發,非 harness-resident)
  'gitStatus',
  'gitLog',
  'gitDiff',
  'gitCommit',
  'gitListBranches',
  'gitSwitchBranch',
] as const;

type HtmlProjectToolName = (typeof HTML_PROJECT_TOOL_NAMES)[number];

/**
 * G2:Harness 常駐工具。任一 HTML pack 曝光即自動附加 (不綁定單一 pack)。
 */
const HARNESS_RESIDENT_TOOL_NAMES: HtmlProjectHarnessToolName[] = [
  'reportTurnOutcome',
  'getPreviewRuntimeErrors',
  'listSnapshots',
  'revertToSnapshot',
  'lintProject',
];

const HTML_PROJECT_TOOL_PACKS: Record<HtmlProjectToolPackName, HtmlProjectToolName[]> = {
  bootstrap: ['createProject', 'listProjects', 'openProject'],
  inspect: [
    'getProjectSummary',
    'listFiles',
    'searchFiles',
    'readFile',
    'listProjectTodos',
    'gitStatus',
    'gitLog',
    'gitDiff',
    'gitListBranches',
  ],
  edit: [
    'writeFiles',
    'replaceInFile',
    'modifyLinesInFile',
    'copyFile',
    'renameFile',
    'deleteFile',
    'setEntrypoint',
    'setProjectTodos',
    'updateProjectTodo',
    'deleteProjectTodo',
    'gitCommit',
    'gitSwitchBranch',
  ],
  todo_finalize: ['checkProjectTodos'],
  preview_recheck: ['renderPreview'],
};

export const HTML_PROJECT_WRITE_PACK_NAMES: HtmlProjectToolPackName[] = [
  'bootstrap',
  'edit',
  'todo_finalize',
  'preview_recheck',
];

interface HtmlProjectToolContext {
  assistantId: string;
  sessionId?: string | null;
  activeProjectId?: string | null;
}

interface CreateProjectArgs {
  name: string;
  description?: string;
  template?: HtmlProjectTemplate;
}

interface OpenProjectArgs {
  projectId: string;
}

interface GetProjectSummaryArgs {
  projectId?: string;
}

interface SearchFilesArgs {
  projectId?: string;
  query: string;
  caseSensitive?: boolean;
}

interface WriteFilesArgs {
  projectId?: string;
  files:
    | Array<{
        path: string;
        content: string;
        kind?: HtmlProjectFileKind;
      }>
    | {
        path: string;
        content: string;
        kind?: HtmlProjectFileKind;
      };
}

interface ReadFileArgs {
  projectId?: string;
  path: string;
  startLine?: number;
  endLine?: number;
}

interface ReplaceInFileArgs {
  projectId?: string;
  path: string;
  oldText: string;
  newText: string;
}

interface ModifyLinesInFileArgs {
  projectId?: string;
  path: string;
  operation: 'replace' | 'insertBefore' | 'insertAfter' | 'delete';
  startLine: number;
  endLine?: number;
  content?: string;
  expectedOriginal?: string;
}

interface DeleteFileArgs {
  projectId?: string;
  path: string;
}

interface CopyFileArgs {
  projectId?: string;
  sourcePath: string;
  destinationPath: string;
}

interface RenameFileArgs {
  projectId?: string;
  sourcePath: string;
  destinationPath: string;
}

interface SetEntrypointArgs {
  projectId?: string;
  path: string;
}

interface RenderPreviewArgs {
  projectId?: string;
}

interface ListProjectTodosArgs {
  projectId?: string;
}

interface SetProjectTodosArgs {
  projectId?: string;
  todos: Array<{
    id?: string;
    title: string;
    description?: string;
    status?: HtmlProjectTodoStatus;
    order?: number;
  }>;
}

interface UpdateProjectTodoArgs {
  projectId?: string;
  todoId: string;
  title?: string;
  description?: string;
  status?: HtmlProjectTodoStatus;
  order?: number;
}

interface DeleteProjectTodoArgs {
  projectId?: string;
  todoId: string;
}

interface CheckProjectTodosArgs {
  projectId?: string;
}

interface ReportTurnOutcomeArgs {
  projectId?: string;
  outcome: ReportTurnOutcome;
  notes?: string;
}

interface GetPreviewRuntimeErrorsArgs {
  projectId?: string;
  waitMs?: number;
}

interface ListSnapshotsArgs {
  projectId?: string;
}

interface RevertToSnapshotArgs {
  projectId?: string;
  version: number;
}

interface LintProjectArgs {
  projectId?: string;
  paths?: string[];
}

// --- Phase 3 git 工具 Args ---

interface GitStatusArgs {
  projectId?: string;
}

interface GitLogArgs {
  projectId?: string;
  depth?: number;
}

interface GitDiffArgs {
  projectId?: string;
  refA?: string;
  refB?: string;
}

interface GitCommitArgs {
  projectId?: string;
  message: string;
}

interface GitListBranchesArgs {
  projectId?: string;
}

interface GitSwitchBranchArgs {
  projectId?: string;
  ref: string;
}

interface ToolRequiredArgsMeta {
  required: string[];
}

const createWorkspaceUpdate = (
  activeProjectId: string | null,
  activityMessage: string,
  preview: HtmlProjectWorkspaceUpdate['preview'] = null,
): HtmlProjectWorkspaceUpdate => ({
  activeProjectId,
  preview,
  activityMessage,
});

const requireProjectId = (
  explicitProjectId: string | undefined,
  activeProjectId: string | null | undefined,
): string => {
  const projectId = explicitProjectId || activeProjectId;
  if (!projectId) {
    throw new Error('No active HTML project is available for this tool call.');
  }
  return projectId;
};

const requireOwnedProject = async (
  explicitProjectId: string | undefined,
  context: HtmlProjectToolContext,
): Promise<HtmlProject> => {
  const projectId = requireProjectId(explicitProjectId, context.activeProjectId);
  return htmlProjectStore.assertProjectOwnership(projectId, context.assistantId);
};

const summarizeSearchResult = (result: {
  query: string;
  scannedFiles: number;
  matches: unknown[];
  truncated: boolean;
}): string => {
  if (result.matches.length === 0) {
    return `在 ${result.scannedFiles} 個可搜尋檔案中找不到「${result.query}」的結果。`;
  }

  const suffix = result.truncated ? '結果已截斷。' : '結果完整。';
  return `在 ${result.scannedFiles} 個可搜尋檔案中找到 ${result.matches.length} 個「${result.query}」結果，${suffix}`;
};

const summarizeFileList = (paths: string[]): string => paths.join(', ');

const normalizeLintPaths = (paths: string[] | undefined): string[] => {
  if (!Array.isArray(paths)) {
    return [];
  }

  const normalizedPaths: string[] = [];
  for (const path of paths) {
    if (typeof path !== 'string') {
      continue;
    }
    const trimmed = path.trim();
    if (trimmed.length > 0) {
      normalizedPaths.push(trimmed);
    }
  }

  return normalizedPaths;
};

/**
 * G11 防禦性檢查:偵測寫入內容是否包含動態程式碼模式 (new Function / DOMParser eval)。
 * - ESM (含 import/export) 跳過檢查,回傳 moduleSyntaxSkipped:true。
 * - 非阻塞警告,僅作為提示。
 */
const DYNAMIC_CODE_WARNING_MESSAGE =
  'Detected dynamic code pattern (new Function/DOMParser); ensure this is intended.';

interface DynamicCodeWarningResult {
  warnings?: string[];
  moduleSyntaxSkipped?: boolean;
}

const evaluateDynamicCodeWarning = (content: string): DynamicCodeWarningResult => {
  if (!content) {
    return {};
  }
  // ESM module syntax — skip warning to avoid false positives on import/export
  if (/\bimport\b|\bexport\b/.test(content)) {
    return { moduleSyntaxSkipped: true };
  }
  if (/new\s+Function\s*\(|\bDOMParser\b/.test(content)) {
    return { warnings: [DYNAMIC_CODE_WARNING_MESSAGE] };
  }
  return {};
};

// ---------------------------------------------------------------------------
// Static validation (Phase 1 MVP) — non-blocking 靜態語法驗證
// 寫入完成後跑 acorn/css-tree/parse5,把診斷以 result.staticDiagnostics
// 回傳 LLM;寫入工具在 ok 時可省略欄位以節省 token,主動 lintProject 則必須回傳 0-count 結果。
// ---------------------------------------------------------------------------

interface StaticValidationToolPayload {
  /** 格式化後的診斷字串 (LLM-friendly)。ok 時省略。 */
  staticDiagnostics?: string;
  /** 結構化 summary 供 telemetry / UI。主動 lint 時不可省略。 */
  staticValidation?: {
    ok: boolean;
    errorCount: number;
    warningCount: number;
    durationMs: number;
  };
  /** summary 尾端中文一句,有 error 時附加,給 createWorkspaceUpdate 進 UI。 */
  summarySuffix: string;
}

const buildStaticValidationSuffix = (errorCount: number): string =>
  errorCount > 0 ? `靜態驗證發現 ${errorCount} 項錯誤，見 staticDiagnostics。` : '';

const getToolRequiredArgs = (toolName: string): string[] => {
  const cached = toolRequiredArgsCache.get(toolName);
  if (cached) {
    return cached.required;
  }

  const definition = getHtmlProjectToolDefinitions().find(tool => tool.name === toolName);
  const required = Array.isArray(definition?.parameters?.required)
    ? definition.parameters.required.filter(
        (value): value is string => typeof value === 'string' && value.length > 0,
      )
    : [];

  toolRequiredArgsCache.set(toolName, { required });
  return required;
};

const validateRequiredToolArgs = (
  toolName: string,
  safeArgs: Record<string, unknown>,
): RecoverableToolErrorResult | null => {
  const required = getToolRequiredArgs(toolName);
  if (required.length === 0) {
    return null;
  }

  const missing = required.filter(key => {
    const value = safeArgs[key];
    return (
      value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
    );
  });

  if (missing.length === 0) {
    return null;
  }

  return {
    ok: false,
    recoverable: true,
    code: 'missing-required-args',
    message: `${toolName} is missing required arguments: ${missing.join(', ')}.`,
    guidance: 'Retry with all required top-level arguments from the tool schema.',
    details: {
      missing,
      required,
    },
  };
};

/** 把 runStaticValidation 結果攤到 result 物件;ok 時兩個欄位都不會出現 */
const spreadStaticValidationFields = (
  payload: StaticValidationToolPayload,
): Record<string, unknown> => ({
  ...(payload.staticDiagnostics ? { staticDiagnostics: payload.staticDiagnostics } : {}),
  ...(payload.staticValidation ? { staticValidation: payload.staticValidation } : {}),
});

const summarizeLintProjectResult = (
  errorCount: number,
  warningCount: number,
  scopedPathCount: number | null,
): string => {
  const scopeLabel = scopedPathCount === null ? '整個專案' : `${scopedPathCount} 個指定檔案`;

  if (errorCount === 0 && warningCount === 0) {
    return `lintProject 已檢查${scopeLabel}，未發現靜態驗證問題。`;
  }

  return `lintProject 已檢查${scopeLabel}，發現 ${errorCount} 項錯誤、${warningCount} 項警告。`;
};

const runStaticValidation = async (
  files: StaticValidationFileInput[],
  options?: { includeZeroCounts?: boolean },
): Promise<StaticValidationToolPayload> => {
  // 預熱 parser bundle (no-op 若已載入),讓 handler 內的 stats 不被首次 import 影響
  await preloadStaticValidationParsers();
  const result = await validateProjectFiles(files);
  const errorCount = result.diagnostics.filter(d => d.severity === 'error').length;
  const warningCount = result.diagnostics.filter(d => d.severity === 'warning').length;

  if (result.diagnostics.length === 0 && !options?.includeZeroCounts) {
    return { summarySuffix: '' };
  }

  return {
    staticDiagnostics:
      result.diagnostics.length > 0 ? formatStaticDiagnosticsForLlm(result.diagnostics) : undefined,
    staticValidation: {
      ok: result.ok,
      errorCount,
      warningCount,
      durationMs: result.stats.durationMs,
    },
    summarySuffix: buildStaticValidationSuffix(errorCount),
  };
};

const summarizeTodoSummary = ({
  total,
  pending,
  inProgress,
  completed,
}: {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
}): string =>
  `共 ${total} 項待辦，未開始 ${pending} 項、進行中 ${inProgress} 項、已完成 ${completed} 項。`;

const VIRTUAL_PROJECT_PATH_GUIDANCE =
  'Use virtual project-root paths like /index.html, /src/app.js, or /data/ruby.js. Do not use host filesystem paths or URLs.';
const LINE_NUMBER_PREFIX_GUIDANCE =
  'Each displayed line in numberedContent starts with "<line> | ". This prefix is only for display and is not part of the real file content.';
const WRITE_FILE_MAX_BYTES = 24 * 1024;
const WRITE_FILES_MAX_BYTES = 64 * 1024;
const MODIFY_LINES_CONTENT_MAX_BYTES = 64 * 1024;
const LINT_PROJECT_MAX_FILES = 50;
const LINT_PROJECT_MAX_BYTES = 512 * 1024;
const textEncoder = new TextEncoder();
const toolRequiredArgsCache = new Map<string, ToolRequiredArgsMeta>();

interface RecoverableToolErrorResult {
  ok: false;
  recoverable: true;
  code: string;
  message: string;
  guidance: string;
  details?: Record<string, unknown>;
}

class HtmlProjectToolRecoverableError extends Error {
  readonly result: RecoverableToolErrorResult;

  constructor(result: RecoverableToolErrorResult) {
    super(result.message);
    this.name = 'HtmlProjectToolRecoverableError';
    this.result = result;
  }
}

const createRecoverableToolExecutionResult = (
  toolName: string,
  error: RecoverableToolErrorResult,
  activeProjectId: string | null | undefined,
): HtmlProjectToolExecutionResult => ({
  toolName,
  summary: error.message,
  result: { ...error },
  workspace: createWorkspaceUpdate(activeProjectId ?? null, error.message),
});

const resolveProjectSuggestedNextAction = (
  project: HtmlProject,
  preview: HtmlProjectPreviewArtifact,
  fileCount: number,
  todoSummary: HtmlProjectSummary['todoSummary'],
): HtmlProjectSummary['suggestedNextActionCategory'] => {
  if (!preview.previewReady && preview.diagnostics?.repairable) {
    return 'repair_preview';
  }

  if (fileCount === 0) {
    return 'bootstrap';
  }

  if (todoSummary.total > 0 && !todoSummary.allComplete) {
    return 'resume_todos';
  }

  if (todoSummary.allComplete) {
    return 'finalize';
  }

  if (project.lastBuildError) {
    return 'inspect';
  }

  return 'edit';
};

const buildProjectSummary = async (project: HtmlProject): Promise<HtmlProjectSummary> => {
  const [files, todoSummary, preview] = await Promise.all([
    htmlProjectStore.listFiles(project.id),
    htmlProjectStore.getTodoSummary(project.id),
    htmlPreviewService.buildPreviewArtifact(project.id),
  ]);

  return {
    projectId: project.id,
    name: project.name,
    entryFile: project.entryFile,
    previewVersion: project.previewVersion,
    previewReady: preview.previewReady,
    files,
    fileCount: files.length,
    todoSummary,
    lastBuildError: project.lastBuildError ?? null,
    warnings: preview.warnings,
    previewDiagnostics: preview.diagnostics ?? {
      category: project.lastBuildError ? 'build_error' : 'unknown',
      outcome: project.lastBuildError ? 'repairable_error' : 'non_repairable_error',
      repairable: Boolean(project.lastBuildError),
      summary: project.lastBuildError || 'Preview diagnostics unavailable.',
      warnings: preview.warnings,
      details: project.lastBuildError ? [project.lastBuildError] : undefined,
    },
    suggestedNextActionCategory: resolveProjectSuggestedNextAction(
      project,
      preview,
      files.length,
      todoSummary,
    ),
  };
};

const getRecoverableActiveProjectId = (
  args: unknown,
  activeProjectId: string | null | undefined,
): string | null => {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return activeProjectId || null;
  }

  const explicitProjectId =
    typeof (args as { projectId?: unknown }).projectId === 'string'
      ? ((args as { projectId?: string }).projectId ?? null)
      : null;
  return explicitProjectId || activeProjectId || null;
};

const getContentSizeInBytes = (content: string): number => textEncoder.encode(content).length;

const splitLines = (content: string): string[] => {
  if (!content) {
    return [];
  }

  return content.split('\n');
};

const splitInsertedLines = (content: string): string[] => {
  return content === '' ? [''] : content.split('\n');
};

const getTotalLines = (content: string): number => splitLines(content).length;

const padLineNumber = (lineNumber: number, width: number): string =>
  String(lineNumber).padStart(width, ' ');

const formatNumberedContent = (content: string, startLine: number): string => {
  const lines = splitLines(content);
  if (lines.length === 0) {
    return '';
  }

  const maxLineNumber = startLine + lines.length - 1;
  const width = String(maxLineNumber).length;
  return lines
    .map((line, index) => `${padLineNumber(startLine + index, width)} | ${line}`)
    .join('\n');
};

const normalizeOptionalLineNumber = (value: unknown): number | undefined => {
  if (typeof value === 'undefined') {
    return undefined;
  }

  return typeof value === 'number' ? value : Number.NaN;
};

const normalizeReadFileRange = (
  startLineValue: unknown,
  endLineValue: unknown,
  totalLines: number,
): { startLine: number; endLine: number; contentRangeOnly: boolean; endLineClamped: boolean } => {
  const normalizedStartLine = normalizeOptionalLineNumber(startLineValue);
  const normalizedEndLine = normalizeOptionalLineNumber(endLineValue);

  if (typeof normalizedStartLine === 'undefined' && typeof normalizedEndLine === 'undefined') {
    return {
      startLine: totalLines > 0 ? 1 : 0,
      endLine: totalLines,
      contentRangeOnly: false,
      endLineClamped: false,
    };
  }

  if (
    typeof normalizedStartLine !== 'number' ||
    !Number.isInteger(normalizedStartLine) ||
    normalizedStartLine < 1
  ) {
    throw new HtmlProjectToolRecoverableError({
      ok: false,
      recoverable: true,
      code: 'invalid-read-file-range',
      message: 'readFile startLine must be a positive integer when provided.',
      guidance:
        'Use 1-based inclusive line numbers from readFile.numberedContent or searchFiles results.',
    });
  }

  const effectiveEndLine =
    typeof normalizedEndLine === 'undefined' ? normalizedStartLine : normalizedEndLine;
  if (!Number.isInteger(effectiveEndLine) || effectiveEndLine < normalizedStartLine) {
    throw new HtmlProjectToolRecoverableError({
      ok: false,
      recoverable: true,
      code: 'invalid-read-file-range',
      message: 'readFile endLine must be a positive integer greater than or equal to startLine.',
      guidance: 'Use 1-based inclusive line ranges such as startLine=10 and endLine=14.',
    });
  }

  if (totalLines === 0) {
    throw new HtmlProjectToolRecoverableError({
      ok: false,
      recoverable: true,
      code: 'invalid-read-file-range',
      message: 'readFile cannot select a line range from an empty file.',
      guidance: 'Retry readFile without a line range, or write new content into the file first.',
    });
  }

  if (normalizedStartLine > totalLines) {
    throw new HtmlProjectToolRecoverableError({
      ok: false,
      recoverable: true,
      code: 'invalid-read-file-range',
      message: `readFile startLine ${normalizedStartLine} is outside the file (total lines: ${totalLines}).`,
      guidance: `Use a startLine between 1 and ${totalLines}, or call readFile without a range to read the whole file.`,
      details: {
        startLine: normalizedStartLine,
        endLine: effectiveEndLine,
        totalLines,
      },
    });
  }

  return {
    startLine: normalizedStartLine,
    endLine: Math.min(effectiveEndLine, totalLines),
    contentRangeOnly: true,
    endLineClamped: effectiveEndLine > totalLines,
  };
};

const extractLineRangeContent = (content: string, startLine: number, endLine: number): string => {
  if (startLine === 0 && endLine === 0) {
    return '';
  }

  return splitLines(content)
    .slice(startLine - 1, endLine)
    .join('\n');
};

const normalizeModifyOperation = (
  operation: unknown,
): ModifyLinesInFileArgs['operation'] | null => {
  switch (operation) {
    case 'replace':
    case 'insertBefore':
    case 'insertAfter':
    case 'delete':
      return operation;
    default:
      return null;
  }
};

const normalizeModifyLinesRange = (
  operation: ModifyLinesInFileArgs['operation'],
  startLineValue: unknown,
  endLineValue: unknown,
  totalLines: number,
): { startLine: number; endLine: number } => {
  const startLine = typeof startLineValue === 'number' ? startLineValue : Number.NaN;
  const endLineRaw = normalizeOptionalLineNumber(endLineValue);

  if (!Number.isInteger(startLine) || startLine < 1) {
    throw new HtmlProjectToolRecoverableError({
      ok: false,
      recoverable: true,
      code: 'invalid-modify-lines-range',
      message: 'modifyLinesInFile startLine must be a positive integer.',
      guidance:
        'Use 1-based line numbers from readFile.numberedContent or searchFiles results before retrying.',
    });
  }

  if (operation === 'insertBefore' || operation === 'insertAfter') {
    if (totalLines === 0 || startLine > totalLines) {
      throw new HtmlProjectToolRecoverableError({
        ok: false,
        recoverable: true,
        code: 'invalid-modify-lines-range',
        message: `modifyLinesInFile anchor line ${startLine} is outside the file (total lines: ${totalLines}).`,
        guidance: 'Read the file again and retry with a valid existing 1-based anchor line.',
        details: {
          startLine,
          totalLines,
        },
      });
    }

    if (typeof endLineRaw !== 'undefined' && endLineRaw !== startLine) {
      throw new HtmlProjectToolRecoverableError({
        ok: false,
        recoverable: true,
        code: 'invalid-modify-lines-range',
        message: `${operation} only supports a single anchor line.`,
        guidance: 'Omit endLine, or set endLine to the same value as startLine.',
      });
    }

    return { startLine, endLine: startLine };
  }

  const endLine = typeof endLineRaw === 'undefined' ? startLine : endLineRaw;
  if (!Number.isInteger(endLine) || endLine < startLine) {
    throw new HtmlProjectToolRecoverableError({
      ok: false,
      recoverable: true,
      code: 'invalid-modify-lines-range',
      message:
        'modifyLinesInFile endLine must be a positive integer greater than or equal to startLine.',
      guidance: 'Use 1-based inclusive line ranges such as startLine=10 and endLine=14.',
    });
  }

  if (totalLines === 0 || startLine > totalLines || endLine > totalLines) {
    throw new HtmlProjectToolRecoverableError({
      ok: false,
      recoverable: true,
      code: 'invalid-modify-lines-range',
      message: `modifyLinesInFile line range ${startLine}-${endLine} is outside the file (total lines: ${totalLines}).`,
      guidance: 'Read the file again and retry with valid 1-based line numbers.',
      details: {
        startLine,
        endLine,
        totalLines,
      },
    });
  }

  return { startLine, endLine };
};

const normalizeModifyLinesContent = (
  operation: ModifyLinesInFileArgs['operation'],
  content: unknown,
): string => {
  if (operation === 'delete') {
    if (typeof content !== 'undefined') {
      throw new HtmlProjectToolRecoverableError({
        ok: false,
        recoverable: true,
        code: 'invalid-modify-lines-content',
        message: 'modifyLinesInFile delete does not accept content.',
        guidance: 'Remove the content field when using operation="delete".',
      });
    }

    return '';
  }

  if (typeof content !== 'string') {
    throw new HtmlProjectToolRecoverableError({
      ok: false,
      recoverable: true,
      code: 'invalid-modify-lines-content',
      message: `modifyLinesInFile ${operation} requires string content.`,
      guidance: 'Provide raw replacement text without numberedContent prefixes such as "12 | ".',
    });
  }

  const contentBytes = getContentSizeInBytes(content);
  if (contentBytes > MODIFY_LINES_CONTENT_MAX_BYTES) {
    throw new HtmlProjectToolRecoverableError({
      ok: false,
      recoverable: true,
      code: 'modify-lines-content-too-large',
      message: `modifyLinesInFile content is too large (${contentBytes} bytes).`,
      guidance:
        'Split the change into smaller line-based edits or use multiple targeted tool calls.',
      details: {
        contentBytes,
        maxBytes: MODIFY_LINES_CONTENT_MAX_BYTES,
      },
    });
  }

  return content;
};

const normalizeTodoStatus = (status: unknown): HtmlProjectTodoStatus | null => {
  switch (status) {
    case 'pending':
    case 'in_progress':
    case 'completed':
      return status;
    case undefined:
      return 'pending';
    default:
      return null;
  }
};

const normalizeProjectTodoItems = (items: unknown): SetProjectTodosArgs['todos'] => {
  if (!Array.isArray(items)) {
    throw new HtmlProjectToolRecoverableError({
      ok: false,
      recoverable: true,
      code: 'invalid-project-todos',
      message: 'setProjectTodos requires a todos array.',
      guidance:
        'Pass todos as an array of items with title, optional description, and optional status.',
    });
  }

  return items.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new HtmlProjectToolRecoverableError({
        ok: false,
        recoverable: true,
        code: 'invalid-project-todo-item',
        message: `setProjectTodos.todos[${index}] must be an object.`,
        guidance:
          'Each todo item must include a title and optional description, status, and order.',
      });
    }

    const title = typeof item.title === 'string' ? item.title.trim() : '';
    if (!title) {
      throw new HtmlProjectToolRecoverableError({
        ok: false,
        recoverable: true,
        code: 'invalid-project-todo-title',
        message: `setProjectTodos.todos[${index}] requires a non-empty title.`,
        guidance: 'Provide concise human-readable todo titles describing each project task.',
      });
    }

    const normalizedStatus = normalizeTodoStatus(item.status);
    if (!normalizedStatus) {
      throw new HtmlProjectToolRecoverableError({
        ok: false,
        recoverable: true,
        code: 'invalid-project-todo-status',
        message: `setProjectTodos.todos[${index}] has an invalid status.`,
        guidance: 'Use one of pending, in_progress, or completed.',
      });
    }

    return {
      id: typeof item.id === 'string' ? item.id.trim() || undefined : undefined,
      title,
      description: typeof item.description === 'string' ? item.description : undefined,
      status: normalizedStatus,
      order: typeof item.order === 'number' ? item.order : index,
    };
  });
};

const normalizeTodoId = (todoId: unknown, toolName: string): string => {
  const normalized = typeof todoId === 'string' ? todoId.trim() : '';
  if (!normalized) {
    throw new HtmlProjectToolRecoverableError({
      ok: false,
      recoverable: true,
      code: 'invalid-project-todo-id',
      message: `${toolName} requires a valid todoId.`,
      guidance: 'Call listProjectTodos first and retry with an existing todoId.',
    });
  }

  return normalized;
};

const normalizeTodoUpdatePatch = (args: UpdateProjectTodoArgs) => {
  const patch: {
    title?: string;
    description?: string;
    status?: HtmlProjectTodoStatus;
    order?: number;
  } = {};

  if (typeof args.title !== 'undefined') {
    const title = typeof args.title === 'string' ? args.title.trim() : '';
    if (!title) {
      throw new HtmlProjectToolRecoverableError({
        ok: false,
        recoverable: true,
        code: 'invalid-project-todo-title',
        message: 'updateProjectTodo title must be a non-empty string when provided.',
        guidance: 'Provide a concise title or omit title when you do not need to rename the todo.',
      });
    }
    patch.title = title;
  }

  if (typeof args.description !== 'undefined') {
    if (typeof args.description !== 'string') {
      throw new HtmlProjectToolRecoverableError({
        ok: false,
        recoverable: true,
        code: 'invalid-project-todo-description',
        message: 'updateProjectTodo description must be a string when provided.',
        guidance: 'Provide plain-text description content or omit description.',
      });
    }
    patch.description = args.description;
  }

  if (typeof args.status !== 'undefined') {
    const status = normalizeTodoStatus(args.status);
    if (!status) {
      throw new HtmlProjectToolRecoverableError({
        ok: false,
        recoverable: true,
        code: 'invalid-project-todo-status',
        message: 'updateProjectTodo status must be one of pending, in_progress, or completed.',
        guidance: 'Retry with a valid status value.',
      });
    }
    patch.status = status;
  }

  if (typeof args.order !== 'undefined') {
    if (!Number.isInteger(args.order)) {
      throw new HtmlProjectToolRecoverableError({
        ok: false,
        recoverable: true,
        code: 'invalid-project-todo-order',
        message: 'updateProjectTodo order must be an integer when provided.',
        guidance: 'Use integer order values such as 0, 1, 2, and so on.',
      });
    }
    patch.order = args.order;
  }

  if (Object.keys(patch).length === 0) {
    throw new HtmlProjectToolRecoverableError({
      ok: false,
      recoverable: true,
      code: 'invalid-project-todo-update',
      message: 'updateProjectTodo requires at least one field to update.',
      guidance: 'Provide one or more of title, description, status, or order.',
    });
  }

  return patch;
};

const validateExpectedOriginal = (
  expectedOriginal: unknown,
  actualContent: string,
  path: string,
  startLine: number,
  endLine: number,
): string | undefined => {
  if (typeof expectedOriginal === 'undefined') {
    return undefined;
  }

  if (typeof expectedOriginal !== 'string') {
    throw new HtmlProjectToolRecoverableError({
      ok: false,
      recoverable: true,
      code: 'invalid-modify-lines-content',
      message: 'modifyLinesInFile expectedOriginal must be a string when provided.',
      guidance:
        'Copy the current raw text from readFile.content for the target lines, without numberedContent prefixes.',
    });
  }

  if (expectedOriginal !== actualContent) {
    throw new HtmlProjectToolRecoverableError({
      ok: false,
      recoverable: true,
      code: 'modify-lines-expected-original-mismatch',
      message: `modifyLinesInFile expectedOriginal no longer matches ${path} lines ${startLine}-${endLine}.`,
      guidance:
        'Call readFile again to get the latest numberedContent and retry with the current raw text for that line range.',
      details: {
        path,
        startLine,
        endLine,
      },
    });
  }

  return expectedOriginal;
};

const applyLineModification = (
  content: string,
  operation: ModifyLinesInFileArgs['operation'],
  startLine: number,
  endLine: number,
  replacementContent: string,
): {
  updatedContent: string;
  previousContent: string;
  totalLinesBefore: number;
  totalLinesAfter: number;
} => {
  const lines = splitLines(content);
  const previousContent = extractLineRangeContent(content, startLine, endLine);
  const replacementLines = operation === 'delete' ? [] : splitInsertedLines(replacementContent);
  const before = lines.slice(0, startLine - 1);
  const target = lines.slice(startLine - 1, endLine);
  const after = lines.slice(endLine);

  let updatedLines: string[];
  switch (operation) {
    case 'replace':
      updatedLines = [...before, ...replacementLines, ...after];
      break;
    case 'insertBefore':
      updatedLines = [...before, ...replacementLines, ...target, ...after];
      break;
    case 'insertAfter':
      updatedLines = [...before, ...target, ...replacementLines, ...after];
      break;
    case 'delete':
      updatedLines = [...before, ...after];
      break;
  }

  return {
    updatedContent: updatedLines.join('\n'),
    previousContent,
    totalLinesBefore: lines.length,
    totalLinesAfter: updatedLines.length,
  };
};

const HTML_PROJECT_FILE_KINDS = new Set<HtmlProjectFileKind>([
  'html',
  'css',
  'js',
  'json',
  'svg',
  'asset',
  'md',
]);

const inferHtmlProjectFileKind = (path: string): HtmlProjectFileKind => {
  const normalizedPath = path.toLowerCase();

  if (normalizedPath.endsWith('.html') || normalizedPath.endsWith('.htm')) {
    return 'html';
  }

  if (normalizedPath.endsWith('.css') || normalizedPath.endsWith('.scss')) {
    return 'css';
  }

  if (
    normalizedPath.endsWith('.js') ||
    normalizedPath.endsWith('.mjs') ||
    normalizedPath.endsWith('.cjs') ||
    normalizedPath.endsWith('.ts') ||
    normalizedPath.endsWith('.tsx') ||
    normalizedPath.endsWith('.jsx')
  ) {
    return 'js';
  }

  if (normalizedPath.endsWith('.json')) {
    return 'json';
  }

  if (normalizedPath.endsWith('.svg')) {
    return 'svg';
  }

  if (normalizedPath.endsWith('.md') || normalizedPath.endsWith('.markdown')) {
    return 'md';
  }

  return 'asset';
};

const normalizeWriteFilesInput = (files: WriteFilesArgs['files']): WriteHtmlProjectFileInput[] => {
  const fileList = Array.isArray(files) ? files : files && typeof files === 'object' ? [files] : [];

  if (fileList.length === 0) {
    throw new HtmlProjectToolRecoverableError({
      ok: false,
      recoverable: true,
      code: 'invalid-write-files-input',
      message: 'writeFiles requires a non-empty files array.',
      guidance:
        'Pass one or more file objects in files[]. Use writeFiles for small complete files only.',
    });
  }

  let totalBytes = 0;

  return fileList.map((file, index) => {
    if (!file || typeof file !== 'object' || Array.isArray(file)) {
      throw new HtmlProjectToolRecoverableError({
        ok: false,
        recoverable: true,
        code: 'invalid-write-file-entry',
        message: `writeFiles.files[${index}] must be an object with path and content.`,
        guidance:
          'Pass files as objects like { path, content, kind? } and avoid null or primitive entries.',
      });
    }

    const path = typeof file.path === 'string' ? file.path.trim() : '';
    if (!path) {
      throw new HtmlProjectToolRecoverableError({
        ok: false,
        recoverable: true,
        code: 'invalid-write-file-path',
        message: `writeFiles.files[${index}] is missing a valid path.`,
        guidance: VIRTUAL_PROJECT_PATH_GUIDANCE,
      });
    }

    if (typeof file.content !== 'string') {
      throw new HtmlProjectToolRecoverableError({
        ok: false,
        recoverable: true,
        code: 'invalid-write-file-content',
        message: `writeFiles.files[${index}] is missing string content.`,
        guidance:
          'Provide UTF-8 text content for text files. Use targeted edit tools for existing files.',
      });
    }

    const contentBytes = getContentSizeInBytes(file.content);
    if (contentBytes > WRITE_FILE_MAX_BYTES) {
      throw new HtmlProjectToolRecoverableError({
        ok: false,
        recoverable: true,
        code: 'write-file-too-large',
        message: `writeFiles payload for ${path} is too large (${contentBytes} bytes).`,
        guidance:
          'Use writeFiles only for small complete files. For existing files, readFile first and then use replaceInFile or modifyLinesInFile for targeted edits.',
        details: {
          path,
          contentBytes,
          maxBytes: WRITE_FILE_MAX_BYTES,
        },
      });
    }

    totalBytes += contentBytes;
    if (totalBytes > WRITE_FILES_MAX_BYTES) {
      throw new HtmlProjectToolRecoverableError({
        ok: false,
        recoverable: true,
        code: 'write-files-payload-too-large',
        message: `writeFiles payload is too large (${totalBytes} bytes across ${fileList.length} files).`,
        guidance:
          'Split the change into smaller writeFiles calls, or use replaceInFile or modifyLinesInFile for focused edits to existing files.',
        details: {
          contentBytes: totalBytes,
          maxBytes: WRITE_FILES_MAX_BYTES,
          fileCount: fileList.length,
        },
      });
    }

    if (typeof file.kind !== 'undefined' && !HTML_PROJECT_FILE_KINDS.has(file.kind)) {
      throw new HtmlProjectToolRecoverableError({
        ok: false,
        recoverable: true,
        code: 'invalid-write-file-kind',
        message: `writeFiles.files[${index}] has unsupported kind "${String(file.kind)}".`,
        guidance:
          'Use one of: html, css, js, json, svg, asset, or md. Omit kind to let the tool infer it from the path.',
      });
    }

    return {
      path,
      content: file.content,
      kind: file.kind ?? inferHtmlProjectFileKind(path),
    };
  });
};

const handleCreateProject = async (
  args: CreateProjectArgs,
  context: HtmlProjectToolContext,
): Promise<HtmlProjectToolExecutionResult> => {
  // 冪等守門:本對話已有 active project 時禁止再次建立。
  // bootstrap 首次建立的 context.activeProjectId 必為 null/undefined,故不影響正常建立;
  // 專案模式升級後 createProject 仍對模型可見(soft gating),此守門直接擋下第二次建立,
  // 並在 guidance 中提供正確的後續操作知識(改用 edit 工具續作),避免專案被建立兩次。
  if (context.activeProjectId) {
    throw new HtmlProjectToolRecoverableError({
      ok: false,
      recoverable: true,
      code: 'project-already-active',
      message: `An HTML project is already active (id: ${context.activeProjectId}). Do not create another project.`,
      guidance:
        'Continue building on the active project instead of creating a new one. Plan with setProjectTodos, then add content with writeFiles (small new files) or modifyLinesInFile/replaceInFile (after readFile) on the active project. Only ask the user about a brand-new project if they explicitly request one separate from the current work.',
      details: { activeProjectId: context.activeProjectId },
    });
  }

  const project = await htmlProjectStore.createProject({
    assistantId: context.assistantId,
    sessionId: context.sessionId,
    name: args.name,
    description: args.description,
  });

  const templateFiles = getTemplateFiles(args.template);
  await htmlProjectStore.writeFiles(project.id, templateFiles);
  const preview = await htmlPreviewService.resolveProjectForPreview(project.id);
  const summary = `已建立 HTML 專案「${project.name}」，入口檔為 ${project.entryFile}。`;

  return {
    toolName: 'createProject',
    summary,
    result: {
      projectId: project.id,
      entryFile: project.entryFile,
      created: true,
      files: templateFiles.map(file => file.path),
      previewVersion: preview.previewVersion,
      nextStepGuidance:
        'Project created successfully. Do NOT call createProject again — the full editing toolset becomes available on the next turn. Next, call setProjectTodos to lay out a short plan (at least 3 concrete todos), then build the content with writeFiles for new files (or modifyLinesInFile/replaceInFile after readFile for edits). Run lintProject / getPreviewRuntimeErrors to verify, then reportTurnOutcome(outcome:"complete") when finished.',
    },
    workspace: createWorkspaceUpdate(project.id, summary, preview),
  };
};

const handleListProjects = async (
  context: HtmlProjectToolContext,
): Promise<HtmlProjectToolExecutionResult> => {
  const projects = await htmlProjectStore.listProjectsByAssistant(context.assistantId);
  const summary =
    projects.length > 0
      ? `目前 assistant 共有 ${projects.length} 個 HTML 專案。`
      : '目前 assistant 尚無 HTML 專案。';

  return {
    toolName: 'listProjects',
    summary,
    result: {
      projects: projects.map(project => ({
        projectId: project.id,
        name: project.name,
        description: project.description,
        entryFile: project.entryFile,
        updatedAt: project.updatedAt,
        previewVersion: project.previewVersion,
      })),
    },
    workspace: createWorkspaceUpdate(context.activeProjectId ?? null, summary),
  };
};

const handleOpenProject = async (
  args: OpenProjectArgs,
  context: HtmlProjectToolContext,
): Promise<HtmlProjectToolExecutionResult> => {
  const project = await htmlProjectStore.assertProjectOwnership(
    args.projectId,
    context.assistantId,
  );
  const preview = await htmlPreviewService.resolveProjectForPreview(project.id);
  const summary = `已開啟既有 HTML 專案「${project.name}」。`;

  return {
    toolName: 'openProject',
    summary,
    result: {
      projectId: project.id,
      name: project.name,
      entryFile: project.entryFile,
      previewVersion: preview.previewVersion,
      previewReady: preview.previewReady,
      diagnostics: preview.diagnostics ?? null,
    },
    workspace: createWorkspaceUpdate(project.id, summary, preview),
  };
};

const handleGetProjectSummary = async (
  args: GetProjectSummaryArgs,
  context: HtmlProjectToolContext,
): Promise<HtmlProjectToolExecutionResult> => {
  const project = await requireOwnedProject(args.projectId, context);
  const projectSummary = await buildProjectSummary(project);
  const summary = `已整理 HTML 專案「${project.name}」摘要，包含 ${projectSummary.fileCount} 個檔案與 ${summarizeTodoSummary(projectSummary.todoSummary)} 建議下一步：${projectSummary.suggestedNextActionCategory}。`;

  return {
    toolName: 'getProjectSummary',
    summary,
    result: {
      projectSummary,
    },
    workspace: createWorkspaceUpdate(project.id, summary),
  };
};

const handleSearchFiles = async (
  args: SearchFilesArgs,
  context: HtmlProjectToolContext,
): Promise<HtmlProjectToolExecutionResult> => {
  const project = await requireOwnedProject(args.projectId, context);
  const searchResult = (await htmlProjectStore.searchFiles(project.id, {
    query: args.query,
    caseSensitive: args.caseSensitive,
  })) as unknown as {
    query: string;
    scannedFiles: number;
    matches: unknown[];
    truncated: boolean;
  } & Record<string, unknown>;
  const summary = summarizeSearchResult(searchResult);
  const result: Record<string, unknown> = {
    ...searchResult,
  };

  return {
    toolName: 'searchFiles',
    summary,
    result,
    workspace: createWorkspaceUpdate(project.id, summary),
  } as HtmlProjectToolExecutionResult;
};

const handleWriteFiles = async (
  args: WriteFilesArgs,
  context: HtmlProjectToolContext,
): Promise<HtmlProjectToolExecutionResult> => {
  const project = await requireOwnedProject(args.projectId, context);
  const files = normalizeWriteFilesInput(args.files);
  const result = await htmlProjectStore.writeFiles(project.id, files);
  const preview = await htmlPreviewService.resolveProjectForPreview(project.id);
  const summary = `已更新檔案：${summarizeFileList(result.updated)}。`;

  // G11 防禦性檢查:對寫入的 JS/HTML 內容偵測動態程式碼模式 (非阻塞)
  const warnings: string[] = [];
  let moduleSyntaxSkipped = false;
  for (const file of files) {
    const warningResult = evaluateDynamicCodeWarning(file.content);
    if (warningResult.warnings) {
      warnings.push(...warningResult.warnings);
    }
    if (warningResult.moduleSyntaxSkipped) {
      moduleSyntaxSkipped = true;
    }
  }

  // Phase 1 靜態驗證 (MVP):非阻塞,落檔後對每檔跑 acorn/css-tree/parse5
  const staticValidation = await runStaticValidation(
    files.map(file => ({
      path: file.path,
      kind: file.kind,
      content: file.content,
      encoding: file.encoding,
    })),
  );
  const finalSummary = summary + staticValidation.summarySuffix;

  return {
    toolName: 'writeFiles',
    summary: finalSummary,
    result: {
      projectId: project.id,
      updated: result.updated,
      previewVersion: result.previewVersion,
      ...(warnings.length > 0 ? { warnings } : {}),
      ...(moduleSyntaxSkipped ? { moduleSyntaxSkipped: true } : {}),
      ...spreadStaticValidationFields(staticValidation),
    },
    workspace: createWorkspaceUpdate(project.id, finalSummary, preview),
  };
};

const handleReplaceInFile = async (
  args: ReplaceInFileArgs,
  context: HtmlProjectToolContext,
): Promise<HtmlProjectToolExecutionResult> => {
  const project = await requireOwnedProject(args.projectId, context);
  const path = typeof args.path === 'string' ? args.path.trim() : '';
  const oldText = typeof args.oldText === 'string' ? args.oldText : '';

  if (!path) {
    throw new HtmlProjectToolRecoverableError({
      ok: false,
      recoverable: true,
      code: 'invalid-replace-path',
      message: 'replaceInFile requires a valid path.',
      guidance: VIRTUAL_PROJECT_PATH_GUIDANCE,
    });
  }

  if (!oldText) {
    throw new HtmlProjectToolRecoverableError({
      ok: false,
      recoverable: true,
      code: 'invalid-replace-old-text',
      message: 'replaceInFile requires a non-empty oldText value.',
      guidance: 'Call readFile first, copy the exact text to replace, then retry replaceInFile.',
    });
  }

  if (typeof args.newText !== 'string') {
    throw new HtmlProjectToolRecoverableError({
      ok: false,
      recoverable: true,
      code: 'invalid-replace-new-text',
      message: 'replaceInFile requires string newText.',
      guidance: 'Provide the replacement content as a string.',
    });
  }

  const file = await htmlProjectStore.readFile(project.id, path);
  if (!file) {
    throw new HtmlProjectToolRecoverableError({
      ok: false,
      recoverable: true,
      code: 'replace-file-not-found',
      message: `Project file ${path} not found.`,
      guidance:
        'Call listFiles or readFile first to confirm the exact project path before retrying.',
    });
  }

  if (file.encoding === 'base64') {
    throw new HtmlProjectToolRecoverableError({
      ok: false,
      recoverable: true,
      code: 'replace-binary-file',
      message: `replaceInFile only supports text files, but ${file.path} uses ${file.encoding} encoding.`,
      guidance: 'Use writeFiles to replace the full asset instead of replaceInFile.',
    });
  }

  let matchCount = 0;
  let firstMatchIndex = -1;
  let searchIndex = 0;
  while (searchIndex <= file.content.length - oldText.length) {
    const matchIndex = file.content.indexOf(oldText, searchIndex);
    if (matchIndex === -1) {
      break;
    }
    if (firstMatchIndex === -1) {
      firstMatchIndex = matchIndex;
    }
    matchCount += 1;
    searchIndex = matchIndex + 1;
  }

  if (matchCount === 0) {
    throw new HtmlProjectToolRecoverableError({
      ok: false,
      recoverable: true,
      code: 'replace-old-text-not-found',
      message: `replaceInFile could not find the requested text in ${file.path}.`,
      guidance:
        'Call readFile again and retry with an exact oldText snippet from the current file contents.',
      details: {
        path: file.path,
      },
    });
  }

  if (matchCount > 1) {
    throw new HtmlProjectToolRecoverableError({
      ok: false,
      recoverable: true,
      code: 'replace-old-text-ambiguous',
      message: `replaceInFile found ${matchCount} matches in ${file.path}.`,
      guidance:
        'Use a longer oldText snippet that uniquely identifies the section to replace, or narrow the edit after reading the file again.',
      details: {
        path: file.path,
        matchCount,
      },
    });
  }

  const updatedContent =
    file.content.slice(0, firstMatchIndex) +
    args.newText +
    file.content.slice(firstMatchIndex + oldText.length);

  const result = await htmlProjectStore.writeFiles(project.id, [
    {
      path: file.path,
      kind: file.kind,
      content: updatedContent,
      encoding: file.encoding,
    },
  ]);
  const preview = await htmlPreviewService.resolveProjectForPreview(project.id);
  const summary = `已更新檔案 ${file.path} 的指定內容。`;

  // G11 防禦性檢查
  const warningResult = evaluateDynamicCodeWarning(updatedContent);

  // Phase 1 靜態驗證 (MVP):對編輯後的「全文」驗證,行號即真實檔案行號,無偏移
  const staticValidation = await runStaticValidation([
    {
      path: file.path,
      kind: file.kind,
      content: updatedContent,
      encoding: file.encoding,
    },
  ]);
  const finalSummary = summary + staticValidation.summarySuffix;

  return {
    toolName: 'replaceInFile',
    summary: finalSummary,
    result: {
      projectId: project.id,
      path: file.path,
      updated: result.updated,
      previewVersion: result.previewVersion,
      replaced: true,
      matchCount,
      ...(warningResult.warnings ? { warnings: warningResult.warnings } : {}),
      ...(warningResult.moduleSyntaxSkipped ? { moduleSyntaxSkipped: true } : {}),
      ...spreadStaticValidationFields(staticValidation),
    },
    workspace: createWorkspaceUpdate(project.id, finalSummary, preview),
  };
};

const handleListFiles = async (
  args: { projectId?: string },
  context: HtmlProjectToolContext,
): Promise<HtmlProjectToolExecutionResult> => {
  const project = await requireOwnedProject(args.projectId, context);
  const files = await htmlProjectStore.listFiles(project.id);
  const summary = `目前專案共有 ${files.length} 個檔案。`;

  return {
    toolName: 'listFiles',
    summary,
    result: {
      projectId: project.id,
      files,
      entryFile: project.entryFile,
      previewVersion: project.previewVersion,
    },
    workspace: createWorkspaceUpdate(project.id, summary),
  };
};

const handleReadFile = async (
  args: ReadFileArgs,
  context: HtmlProjectToolContext,
): Promise<HtmlProjectToolExecutionResult> => {
  const path = typeof args.path === 'string' ? args.path.trim() : '';
  if (!path) {
    throw new HtmlProjectToolRecoverableError({
      ok: false,
      recoverable: true,
      code: 'invalid-read-file-path',
      message: 'readFile requires a valid path.',
      guidance: VIRTUAL_PROJECT_PATH_GUIDANCE,
    });
  }

  const project = await requireOwnedProject(args.projectId, context);
  const file = await htmlProjectStore.readFile(project.id, path);
  if (!file) {
    throw new HtmlProjectToolRecoverableError({
      ok: false,
      recoverable: true,
      code: 'read-file-not-found',
      message: `Project file ${path} not found.`,
      guidance:
        'Call listFiles or searchFiles first to confirm the exact virtual project path before retrying readFile.',
      details: {
        path,
      },
    });
  }

  const totalLines = getTotalLines(file.content);
  const range = normalizeReadFileRange(args.startLine, args.endLine, totalLines);
  const selectedContent =
    range.contentRangeOnly && totalLines > 0
      ? extractLineRangeContent(file.content, range.startLine, range.endLine)
      : file.content;
  const numberedContent = formatNumberedContent(selectedContent, range.startLine || 1);
  const summary = range.contentRangeOnly
    ? `已讀取檔案 ${file.path} 的第 ${range.startLine}-${range.endLine} 行${
        range.endLineClamped ? ` (endLine 已收斂至檔案結尾，全檔共 ${totalLines} 行)` : ''
      }。`
    : `已讀取檔案 ${file.path}。`;

  return {
    toolName: 'readFile',
    summary,
    result: {
      projectId: project.id,
      path: file.path,
      kind: file.kind,
      content: selectedContent,
      numberedContent,
      lineNumberFormat: LINE_NUMBER_PREFIX_GUIDANCE,
      lineStart: range.startLine,
      lineEnd: range.endLine,
      totalLines,
      contentRangeOnly: range.contentRangeOnly,
      endLineClamped: range.endLineClamped,
      dependencies: file.dependencies || [],
      updatedAt: file.updatedAt,
    },
    workspace: createWorkspaceUpdate(project.id, summary),
  };
};

const handleModifyLinesInFile = async (
  args: ModifyLinesInFileArgs,
  context: HtmlProjectToolContext,
): Promise<HtmlProjectToolExecutionResult> => {
  const project = await requireOwnedProject(args.projectId, context);
  const path = typeof args.path === 'string' ? args.path.trim() : '';
  if (!path) {
    throw new HtmlProjectToolRecoverableError({
      ok: false,
      recoverable: true,
      code: 'invalid-modify-lines-path',
      message: 'modifyLinesInFile requires a valid path.',
      guidance: VIRTUAL_PROJECT_PATH_GUIDANCE,
    });
  }

  const operation = normalizeModifyOperation(args.operation);
  if (!operation) {
    throw new HtmlProjectToolRecoverableError({
      ok: false,
      recoverable: true,
      code: 'invalid-modify-lines-operation',
      message:
        'modifyLinesInFile requires operation to be one of replace, insertBefore, insertAfter, or delete.',
      guidance:
        'Choose a valid operation and use 1-based line numbers from readFile.numberedContent before retrying.',
    });
  }

  const file = await htmlProjectStore.readFile(project.id, path);
  if (!file) {
    throw new HtmlProjectToolRecoverableError({
      ok: false,
      recoverable: true,
      code: 'modify-lines-file-not-found',
      message: `Project file ${path} not found.`,
      guidance:
        'Call listFiles or readFile first to confirm the exact project path before retrying modifyLinesInFile.',
    });
  }

  if (file.encoding === 'base64') {
    throw new HtmlProjectToolRecoverableError({
      ok: false,
      recoverable: true,
      code: 'modify-lines-binary-file',
      message: `modifyLinesInFile only supports text files, but ${file.path} uses ${file.encoding} encoding.`,
      guidance: 'Use writeFiles to replace the full asset instead of modifyLinesInFile.',
    });
  }

  const range = normalizeModifyLinesRange(
    operation,
    args.startLine,
    args.endLine,
    getTotalLines(file.content),
  );
  const replacementContent = normalizeModifyLinesContent(operation, args.content);
  const { updatedContent, previousContent, totalLinesBefore, totalLinesAfter } =
    applyLineModification(
      file.content,
      operation,
      range.startLine,
      range.endLine,
      replacementContent,
    );

  validateExpectedOriginal(
    args.expectedOriginal,
    previousContent,
    file.path,
    range.startLine,
    range.endLine,
  );

  const result = await htmlProjectStore.writeFiles(project.id, [
    {
      path: file.path,
      kind: file.kind,
      content: updatedContent,
      encoding: file.encoding,
    },
  ]);
  const preview = await htmlPreviewService.resolveProjectForPreview(project.id);
  const summary = `已修改檔案 ${file.path} 的第 ${range.startLine}${range.endLine !== range.startLine ? `-${range.endLine}` : ''} 行。`;

  // G11 防禦性檢查
  const warningResult = evaluateDynamicCodeWarning(updatedContent);

  // Phase 1 靜態驗證 (MVP):對編輯後的全文驗證
  const staticValidation = await runStaticValidation([
    {
      path: file.path,
      kind: file.kind,
      content: updatedContent,
      encoding: file.encoding,
    },
  ]);
  const finalSummary = summary + staticValidation.summarySuffix;

  return {
    toolName: 'modifyLinesInFile',
    summary: finalSummary,
    result: {
      projectId: project.id,
      path: file.path,
      updated: result.updated,
      previewVersion: result.previewVersion,
      modified: true,
      operation,
      startLine: range.startLine,
      endLine: range.endLine,
      totalLinesBefore,
      totalLinesAfter,
      ...(warningResult.warnings ? { warnings: warningResult.warnings } : {}),
      ...(warningResult.moduleSyntaxSkipped ? { moduleSyntaxSkipped: true } : {}),
      ...spreadStaticValidationFields(staticValidation),
    },
    workspace: createWorkspaceUpdate(project.id, finalSummary, preview),
  };
};

const handleListProjectTodos = async (
  args: ListProjectTodosArgs,
  context: HtmlProjectToolContext,
): Promise<HtmlProjectToolExecutionResult> => {
  const project = await requireOwnedProject(args.projectId, context);
  const todos = await htmlProjectStore.listTodos(project.id);
  const summary =
    todos.length === 0 ? '目前專案尚未建立待辦清單。' : `目前專案共有 ${todos.length} 項待辦。`;

  return {
    toolName: 'listProjectTodos',
    summary,
    result: {
      projectId: project.id,
      todos,
      summary: await htmlProjectStore.getTodoSummary(project.id),
    },
    workspace: createWorkspaceUpdate(project.id, summary),
  };
};

const handleSetProjectTodos = async (
  args: SetProjectTodosArgs,
  context: HtmlProjectToolContext,
): Promise<HtmlProjectToolExecutionResult> => {
  const project = await requireOwnedProject(args.projectId, context);
  const todos = normalizeProjectTodoItems(args.todos);
  const result = await htmlProjectStore.replaceTodos(project.id, todos);
  const summary =
    result.summary.total === 0
      ? '已清空專案待辦清單。'
      : `已更新專案待辦清單。${summarizeTodoSummary(result.summary)}`;

  return {
    toolName: 'setProjectTodos',
    summary,
    result: {
      projectId: project.id,
      todos: result.todos,
      summary: result.summary,
    },
    workspace: createWorkspaceUpdate(project.id, summary),
  };
};

const handleUpdateProjectTodo = async (
  args: UpdateProjectTodoArgs,
  context: HtmlProjectToolContext,
): Promise<HtmlProjectToolExecutionResult> => {
  const project = await requireOwnedProject(args.projectId, context);
  const todoId = normalizeTodoId(args.todoId, 'updateProjectTodo');
  const patch = normalizeTodoUpdatePatch(args);

  try {
    const result = await htmlProjectStore.updateTodo(project.id, todoId, patch);
    const summary = `已更新待辦「${result.todo.title}」。${summarizeTodoSummary(result.summary)}`;

    return {
      toolName: 'updateProjectTodo',
      summary,
      result: {
        projectId: project.id,
        todo: result.todo,
        summary: result.summary,
      },
      workspace: createWorkspaceUpdate(project.id, summary),
    };
  } catch (error) {
    if (error instanceof Error && error.message === `Project todo ${todoId} not found.`) {
      throw new HtmlProjectToolRecoverableError({
        ok: false,
        recoverable: true,
        code: 'project-todo-not-found',
        message: error.message,
        guidance: 'Call listProjectTodos first and retry with an existing todoId.',
        details: {
          todoId,
        },
      });
    }

    throw error;
  }
};

const handleDeleteProjectTodo = async (
  args: DeleteProjectTodoArgs,
  context: HtmlProjectToolContext,
): Promise<HtmlProjectToolExecutionResult> => {
  const project = await requireOwnedProject(args.projectId, context);
  const todoId = normalizeTodoId(args.todoId, 'deleteProjectTodo');

  try {
    const result = await htmlProjectStore.deleteTodo(project.id, todoId);
    const summary = `已刪除待辦 ${todoId}。${summarizeTodoSummary(result.summary)}`;

    return {
      toolName: 'deleteProjectTodo',
      summary,
      result: {
        projectId: project.id,
        deleted: result.deleted,
        summary: result.summary,
      },
      workspace: createWorkspaceUpdate(project.id, summary),
    };
  } catch (error) {
    if (error instanceof Error && error.message === `Project todo ${todoId} not found.`) {
      throw new HtmlProjectToolRecoverableError({
        ok: false,
        recoverable: true,
        code: 'project-todo-not-found',
        message: error.message,
        guidance: 'Call listProjectTodos first and retry with an existing todoId.',
        details: {
          todoId,
        },
      });
    }

    throw error;
  }
};

const handleCheckProjectTodos = async (
  args: CheckProjectTodosArgs,
  context: HtmlProjectToolContext,
): Promise<HtmlProjectToolExecutionResult> => {
  const project = await requireOwnedProject(args.projectId, context);
  const todos = await htmlProjectStore.listTodos(project.id);
  const todoSummary = await htmlProjectStore.getTodoSummary(project.id);
  const incompleteTodos = todos.filter(todo => todo.status !== 'completed');
  const summary = todoSummary.allComplete
    ? '所有專案待辦都已完成。'
    : todoSummary.total === 0
      ? '目前尚未建立任何專案待辦。'
      : `目前仍有 ${incompleteTodos.length} 項待辦未完成。`;

  return {
    toolName: 'checkProjectTodos',
    summary,
    result: {
      projectId: project.id,
      summary: todoSummary,
      incompleteTodos,
      allComplete: todoSummary.allComplete,
    },
    workspace: createWorkspaceUpdate(project.id, summary),
  };
};

const handleDeleteFile = async (
  args: DeleteFileArgs,
  context: HtmlProjectToolContext,
): Promise<HtmlProjectToolExecutionResult> => {
  const path = typeof args.path === 'string' ? args.path.trim() : '';
  if (!path) {
    throw new HtmlProjectToolRecoverableError({
      ok: false,
      recoverable: true,
      code: 'invalid-delete-file-path',
      message: 'deleteFile requires a valid path.',
      guidance: VIRTUAL_PROJECT_PATH_GUIDANCE,
    });
  }

  const project = await requireOwnedProject(args.projectId, context);
  const result = await htmlProjectStore.deleteFile(project.id, path);
  const preview = await htmlPreviewService.resolveProjectForPreview(project.id);
  const summary = result.deleted ? `已刪除檔案 ${path}。` : `找不到檔案 ${path}。`;

  return {
    toolName: 'deleteFile',
    summary,
    result: {
      projectId: project.id,
      deleted: result.deleted,
      path,
      previewVersion: result.previewVersion,
    },
    workspace: createWorkspaceUpdate(project.id, summary, preview),
  };
};

const handleCopyFile = async (
  args: CopyFileArgs,
  context: HtmlProjectToolContext,
): Promise<HtmlProjectToolExecutionResult> => {
  const sourcePath = typeof args.sourcePath === 'string' ? args.sourcePath.trim() : '';
  const destinationPath =
    typeof args.destinationPath === 'string' ? args.destinationPath.trim() : '';

  if (!sourcePath) {
    throw new HtmlProjectToolRecoverableError({
      ok: false,
      recoverable: true,
      code: 'invalid-copy-source-path',
      message: 'copyFile requires a valid sourcePath.',
      guidance: VIRTUAL_PROJECT_PATH_GUIDANCE,
    });
  }

  if (!destinationPath) {
    throw new HtmlProjectToolRecoverableError({
      ok: false,
      recoverable: true,
      code: 'invalid-copy-destination-path',
      message: 'copyFile requires a valid destinationPath.',
      guidance: VIRTUAL_PROJECT_PATH_GUIDANCE,
    });
  }

  const project = await requireOwnedProject(args.projectId, context);

  try {
    const result = await htmlProjectStore.copyFile(project.id, sourcePath, destinationPath);
    const preview = await htmlPreviewService.resolveProjectForPreview(project.id);
    const summary = `已複製檔案 ${result.sourcePath} -> ${result.destinationPath}。`;

    return {
      toolName: 'copyFile',
      summary,
      result: {
        projectId: project.id,
        sourcePath: result.sourcePath,
        destinationPath: result.destinationPath,
        copied: true,
        previewVersion: result.previewVersion,
      },
      workspace: createWorkspaceUpdate(project.id, summary, preview),
    };
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'Source and destination paths must be different.') {
        throw new HtmlProjectToolRecoverableError({
          ok: false,
          recoverable: true,
          code: 'copy-file-same-path',
          message: error.message,
          guidance:
            'Choose a different destinationPath so copyFile creates a new file instead of targeting the same normalized path.',
        });
      }

      if (error.message.startsWith('Project file ') && error.message.endsWith(' not found.')) {
        throw new HtmlProjectToolRecoverableError({
          ok: false,
          recoverable: true,
          code: 'copy-file-source-not-found',
          message: error.message,
          guidance:
            'Call listFiles or readFile first to confirm the exact sourcePath before retrying copyFile.',
          details: {
            sourcePath,
          },
        });
      }

      if (error.message.startsWith('Project file ') && error.message.endsWith(' already exists.')) {
        throw new HtmlProjectToolRecoverableError({
          ok: false,
          recoverable: true,
          code: 'copy-file-destination-exists',
          message: error.message,
          guidance:
            'Choose a destinationPath that does not already exist, or inspect the existing file before deciding whether to overwrite it with another tool.',
          details: {
            destinationPath,
          },
        });
      }
    }

    throw error;
  }
};

const handleRenameFile = async (
  args: RenameFileArgs,
  context: HtmlProjectToolContext,
): Promise<HtmlProjectToolExecutionResult> => {
  const sourcePath = typeof args.sourcePath === 'string' ? args.sourcePath.trim() : '';
  const destinationPath =
    typeof args.destinationPath === 'string' ? args.destinationPath.trim() : '';

  if (!sourcePath) {
    throw new HtmlProjectToolRecoverableError({
      ok: false,
      recoverable: true,
      code: 'invalid-rename-source-path',
      message: 'renameFile requires a valid sourcePath.',
      guidance: VIRTUAL_PROJECT_PATH_GUIDANCE,
    });
  }

  if (!destinationPath) {
    throw new HtmlProjectToolRecoverableError({
      ok: false,
      recoverable: true,
      code: 'invalid-rename-destination-path',
      message: 'renameFile requires a valid destinationPath.',
      guidance: VIRTUAL_PROJECT_PATH_GUIDANCE,
    });
  }

  const project = await requireOwnedProject(args.projectId, context);

  try {
    const result = await htmlProjectStore.renameFile(project.id, sourcePath, destinationPath);
    const preview = await htmlPreviewService.resolveProjectForPreview(project.id);
    const summary = `已重新命名檔案 ${result.sourcePath} -> ${result.destinationPath}。`;

    return {
      toolName: 'renameFile',
      summary,
      result: {
        projectId: project.id,
        sourcePath: result.sourcePath,
        destinationPath: result.destinationPath,
        renamed: true,
        previewVersion: result.previewVersion,
      },
      workspace: createWorkspaceUpdate(project.id, summary, preview),
    };
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'Source and destination paths must be different.') {
        throw new HtmlProjectToolRecoverableError({
          ok: false,
          recoverable: true,
          code: 'rename-file-same-path',
          message: error.message,
          guidance:
            'Choose a different destinationPath so renameFile moves the file to a new normalized path.',
        });
      }

      if (error.message.startsWith('Project file ') && error.message.endsWith(' not found.')) {
        throw new HtmlProjectToolRecoverableError({
          ok: false,
          recoverable: true,
          code: 'rename-file-source-not-found',
          message: error.message,
          guidance:
            'Call listFiles or readFile first to confirm the exact sourcePath before retrying renameFile.',
          details: {
            sourcePath,
          },
        });
      }

      if (error.message.startsWith('Project file ') && error.message.endsWith(' already exists.')) {
        throw new HtmlProjectToolRecoverableError({
          ok: false,
          recoverable: true,
          code: 'rename-file-destination-exists',
          message: error.message,
          guidance:
            'Choose a destinationPath that does not already exist, or inspect the existing file before deciding on a different path.',
          details: {
            destinationPath,
          },
        });
      }
    }

    throw error;
  }
};

const handleSetEntrypoint = async (
  args: SetEntrypointArgs,
  context: HtmlProjectToolContext,
): Promise<HtmlProjectToolExecutionResult> => {
  const path = typeof args.path === 'string' ? args.path.trim() : '';
  if (!path) {
    throw new HtmlProjectToolRecoverableError({
      ok: false,
      recoverable: true,
      code: 'invalid-entrypoint-path',
      message: 'setEntrypoint requires a valid path.',
      guidance: VIRTUAL_PROJECT_PATH_GUIDANCE,
    });
  }

  const project = await requireOwnedProject(args.projectId, context);
  const updatedProject = await htmlProjectStore.setEntrypoint(project.id, path);
  const preview = await htmlPreviewService.resolveProjectForPreview(project.id);
  const summary = `已將入口檔切換為 ${updatedProject.entryFile}。`;

  return {
    toolName: 'setEntrypoint',
    summary,
    result: {
      projectId: project.id,
      entryFile: updatedProject.entryFile,
      previewVersion: updatedProject.previewVersion,
    },
    workspace: createWorkspaceUpdate(project.id, summary, preview),
  };
};

const handleRenderPreview = async (
  args: RenderPreviewArgs,
  context: HtmlProjectToolContext,
): Promise<HtmlProjectToolExecutionResult> => {
  const project = await requireOwnedProject(args.projectId, context);
  const preview = await htmlPreviewService.resolveProjectForPreview(project.id);
  const summary = preview.previewReady
    ? `已重新整理專案預覽（版本 ${preview.previewVersion}）。`
    : `預覽重建失敗：${preview.error}`;

  return {
    toolName: 'renderPreview',
    summary,
    result: {
      projectId: project.id,
      previewVersion: preview.previewVersion,
      entryFile: preview.entryFile,
      previewReady: preview.previewReady,
      previewUrlType: preview.previewUrlType,
      warnings: preview.warnings,
      error: preview.error,
      diagnostics: preview.diagnostics ?? null,
    },
    workspace: createWorkspaceUpdate(project.id, summary, preview),
  };
};

// ============================================================================
// Harness 工具 (G2/G1/G11) — 常駐工具,任何 HTML pack 曝光即自動附加。
// ============================================================================

const handleReportTurnOutcome = async (
  args: ReportTurnOutcomeArgs,
  context: HtmlProjectToolContext,
): Promise<HtmlProjectToolExecutionResult> => {
  const outcome: ReportTurnOutcome =
    args.outcome === 'continue_needed' ? 'continue_needed' : 'complete';

  // 嘗試取得當前 todoSummary (若無 active project 則省略)
  let todoSummary: ReportTurnOutcomeResult['todoSummary'];
  let previewDiagnosticState: HtmlProjectRuntimeDiagnosticStatus | undefined;
  let projectId: string | null = null;

  const explicitProjectId = args.projectId;
  if (explicitProjectId || context.activeProjectId) {
    try {
      const project = await requireOwnedProject(explicitProjectId, context);
      projectId = project.id;
      todoSummary = await htmlProjectStore.getTodoSummary(project.id);
      // 便宜地取得當前 runtime 診斷狀態 (waitMs=0,不阻塞)
      const diagnostics = await previewRuntimeDiagnostics.waitForRuntimeDiagnostics(
        project.id,
        project.previewVersion,
        0,
      );
      previewDiagnosticState = diagnostics.status;
    } catch {
      // 若無法取得專案,僅回報模型宣告的 outcome + notes
    }
  }

  const notes = typeof args.notes === 'string' ? args.notes : undefined;
  const summary =
    outcome === 'complete'
      ? '回合已完成 (model 回報 complete)。'
      : '回合需要繼續 (model 回報 continue_needed)。';

  const result: ReportTurnOutcomeResult = {
    outcome,
    ...(todoSummary ? { todoSummary } : {}),
    ...(previewDiagnosticState ? { previewDiagnosticState } : {}),
    ...(notes ? { notes } : {}),
  };

  return {
    toolName: 'reportTurnOutcome',
    summary,
    result: result as unknown as Record<string, unknown>,
    workspace: createWorkspaceUpdate(projectId, summary),
  };
};

const handleGetPreviewRuntimeErrors = async (
  args: GetPreviewRuntimeErrorsArgs,
  context: HtmlProjectToolContext,
): Promise<HtmlProjectToolExecutionResult> => {
  const project = await requireOwnedProject(args.projectId, context);
  // 預設 1500ms,clamp 至 [0, 5000]
  const rawWait = typeof args.waitMs === 'number' ? args.waitMs : 1500;
  const clampedWait = Math.max(0, Math.min(5000, rawWait));

  const diagnostics: HtmlProjectRuntimeDiagnosticResult =
    await previewRuntimeDiagnostics.waitForRuntimeDiagnostics(
      project.id,
      project.previewVersion,
      clampedWait,
    );

  const summary =
    diagnostics.status === 'has_errors'
      ? `預覽 runtime 捕獲 ${diagnostics.errors.length} 項錯誤。`
      : diagnostics.status === 'clean'
        ? '預覽 runtime 無錯誤。'
        : '預覽 runtime 尚未執行 (未收到 ready ack)。';

  return {
    toolName: 'getPreviewRuntimeErrors',
    summary,
    result: diagnostics as unknown as Record<string, unknown>,
    workspace: createWorkspaceUpdate(project.id, summary),
  };
};

const handleListSnapshots = async (
  args: ListSnapshotsArgs,
  context: HtmlProjectToolContext,
): Promise<HtmlProjectToolExecutionResult> => {
  const project = await requireOwnedProject(args.projectId, context);
  const result: HtmlProjectListSnapshotsResult = await htmlProjectStore.listSnapshots(project.id);
  const summary = `專案共有 ${result.snapshots.length} 份快照 (保留上限 ${result.retainedLimit})。`;

  return {
    toolName: 'listSnapshots',
    summary,
    result: result as unknown as Record<string, unknown>,
    workspace: createWorkspaceUpdate(project.id, summary),
  };
};

const handleRevertToSnapshot = async (
  args: RevertToSnapshotArgs,
  context: HtmlProjectToolContext,
): Promise<HtmlProjectToolExecutionResult> => {
  const project = await requireOwnedProject(args.projectId, context);
  if (typeof args.version !== 'number' || !Number.isFinite(args.version)) {
    throw new HtmlProjectToolRecoverableError({
      ok: false,
      recoverable: true,
      code: 'invalid-revert-version',
      message: 'revertToSnapshot requires a numeric version.',
      guidance: 'Call listSnapshots first and pass the version field of the target snapshot.',
    });
  }

  const result: HtmlProjectRevertToSnapshotResult = await htmlProjectStore.revertToSnapshot(
    project.id,
    args.version,
  );
  // G11:還原後清空 runtime 診斷 (避免舊預覽的錯誤殘留)
  previewRuntimeDiagnostics.clear(project.id);

  const summary = `已還原專案至快照版本 ${result.revertedToVersion} (新預覽版本 ${result.previewVersion},還原 ${result.filesRestored} 個檔案)。`;

  return {
    toolName: 'revertToSnapshot',
    summary,
    result: result as unknown as Record<string, unknown>,
    workspace: createWorkspaceUpdate(project.id, summary),
  };
};

// --- Phase 3 git 工具 handlers (委派 htmlProjectGitService) ---

const handleGitStatus = async (
  args: GitStatusArgs,
  context: HtmlProjectToolContext,
): Promise<HtmlProjectToolExecutionResult> => {
  const project = await requireOwnedProject(args.projectId, context);
  const s = await gitService.status(project.id);
  const result: HtmlProjectGitStatusResult = { projectId: project.id, ...s };
  const summary = s.clean
    ? '工作樹乾淨 (無未提交變更)。'
    : `工作樹有未提交變更:新增 ${s.added.length}、修改 ${s.modified.length}、刪除 ${s.deleted.length}、未追蹤 ${s.untracked.length}。`;
  return {
    toolName: 'gitStatus',
    summary,
    result: result as unknown as Record<string, unknown>,
    workspace: createWorkspaceUpdate(project.id, summary),
  };
};

const handleGitLog = async (
  args: GitLogArgs,
  context: HtmlProjectToolContext,
): Promise<HtmlProjectToolExecutionResult> => {
  const project = await requireOwnedProject(args.projectId, context);
  const depth = typeof args.depth === 'number' && args.depth > 0 ? args.depth : undefined;
  const commits = await gitService.log(project.id, depth ? { depth } : {});
  const result: HtmlProjectGitLogResult = { projectId: project.id, commits };
  const summary =
    commits.length === 0
      ? '專案尚無任何 commit。'
      : `專案共 ${commits.length} 筆 commit (新到舊),最新:${commits[0].note} (${commits[0].shortOid})。`;
  return {
    toolName: 'gitLog',
    summary,
    result: result as unknown as Record<string, unknown>,
    workspace: createWorkspaceUpdate(project.id, summary),
  };
};

const handleGitDiff = async (
  args: GitDiffArgs,
  context: HtmlProjectToolContext,
): Promise<HtmlProjectToolExecutionResult> => {
  const project = await requireOwnedProject(args.projectId, context);
  const diffResult = await gitService.diff(project.id, {
    refA: args.refA,
    refB: args.refB,
  });
  const result: HtmlProjectGitDiffResult = { projectId: project.id, files: diffResult.files };
  const changed = result.files.filter(f => f.status !== undefined).length;
  const summary =
    changed === 0
      ? '無檔案變更 (工作樹與目標一致)。'
      : `${changed} 個檔案變更:${result.files.map(f => `${f.path}(${f.status})`).join(', ')}。`;
  return {
    toolName: 'gitDiff',
    summary,
    result: result as unknown as Record<string, unknown>,
    workspace: createWorkspaceUpdate(project.id, summary),
  };
};

const handleGitCommit = async (
  args: GitCommitArgs,
  context: HtmlProjectToolContext,
): Promise<HtmlProjectToolExecutionResult> => {
  const project = await requireOwnedProject(args.projectId, context);
  const message = typeof args.message === 'string' ? args.message.trim() : '';
  if (!message) {
    throw new HtmlProjectToolRecoverableError({
      ok: false,
      recoverable: true,
      code: 'invalid-commit-message',
      message: 'gitCommit requires a non-empty message.',
      guidance: 'Provide a concise message describing the changes being committed.',
    });
  }
  const oid = await gitService.commitAll(project.id, message, {
    previewVersion: project.previewVersion,
  });
  const result: HtmlProjectGitCommitResult = {
    projectId: project.id,
    committed: oid !== null,
    oid,
    message,
  };
  const summary =
    oid !== null
      ? `已提交變更 (${oid.slice(0, 7)}):${message}`
      : '無變更可提交 (工作樹與 HEAD 一致)。';
  return {
    toolName: 'gitCommit',
    summary,
    result: result as unknown as Record<string, unknown>,
    workspace: createWorkspaceUpdate(project.id, summary),
  };
};

const handleGitListBranches = async (
  args: GitListBranchesArgs,
  context: HtmlProjectToolContext,
): Promise<HtmlProjectToolExecutionResult> => {
  const project = await requireOwnedProject(args.projectId, context);
  const [branches, current] = await Promise.all([
    gitService.listBranches(project.id),
    gitService.currentBranch(project.id),
  ]);
  const result: HtmlProjectGitBranchesResult = { projectId: project.id, branches, current };
  const summary = `分支:${branches.join(', ')} (目前:${current ?? '無'})。`;
  return {
    toolName: 'gitListBranches',
    summary,
    result: result as unknown as Record<string, unknown>,
    workspace: createWorkspaceUpdate(project.id, summary),
  };
};

const handleGitSwitchBranch = async (
  args: GitSwitchBranchArgs,
  context: HtmlProjectToolContext,
): Promise<HtmlProjectToolExecutionResult> => {
  const project = await requireOwnedProject(args.projectId, context);
  const ref = typeof args.ref === 'string' ? args.ref.trim() : '';
  if (!ref) {
    throw new HtmlProjectToolRecoverableError({
      ok: false,
      recoverable: true,
      code: 'invalid-branch-ref',
      message: 'gitSwitchBranch requires a non-empty ref (branch name).',
      guidance: 'Call gitListBranches first and pass the target branch name.',
    });
  }
  try {
    await gitService.switchBranch(project.id, ref);
  } catch (error) {
    // dirty tree / 分支不存在等 → recoverable,引導 agent 先 commit 或確認分支名
    throw new HtmlProjectToolRecoverableError({
      ok: false,
      recoverable: true,
      code: 'switch-branch-failed',
      message: error instanceof Error ? error.message : String(error),
      guidance:
        'gitSwitchBranch requires a clean working tree and an existing branch. Run gitStatus; if dirty, gitCommit (or revert) first. Verify the branch name with gitListBranches.',
    });
  }
  const summary = `已切換至分支 ${ref}。`;
  return {
    toolName: 'gitSwitchBranch',
    summary,
    result: { projectId: project.id, switchedTo: ref } as unknown as Record<string, unknown>,
    workspace: createWorkspaceUpdate(project.id, summary),
  };
};

const handleLintProject = async (
  args: LintProjectArgs,
  context: HtmlProjectToolContext,
): Promise<HtmlProjectToolExecutionResult> => {
  const project = await requireOwnedProject(args.projectId, context);
  const requestedPaths = normalizeLintPaths(args.paths);
  const projectFiles = await htmlProjectStore.listProjectFiles(project.id);
  const projectFileMap = new Map(projectFiles.map(file => [file.path, file]));

  const missingPaths = requestedPaths.filter(path => !projectFileMap.has(path));
  if (missingPaths.length > 0) {
    throw new HtmlProjectToolRecoverableError({
      ok: false,
      recoverable: true,
      code: 'lint-path-not-found',
      message: `lintProject could not find ${missingPaths.length} requested path(s).`,
      guidance: 'Call listFiles first or retry with only existing virtual project paths.',
      details: {
        missingPaths,
        availablePaths: projectFiles.map(file => file.path),
      },
    });
  }

  const targetFiles =
    requestedPaths.length > 0
      ? requestedPaths
          .map(path => projectFileMap.get(path))
          .filter((file): file is NonNullable<typeof file> => Boolean(file))
      : projectFiles;

  if (targetFiles.length > LINT_PROJECT_MAX_FILES) {
    throw new HtmlProjectToolRecoverableError({
      ok: false,
      recoverable: true,
      code: 'lint-too-many-files',
      message: `lintProject can validate at most ${LINT_PROJECT_MAX_FILES} files per call.`,
      guidance: 'Retry with a smaller paths array or split the lint into multiple batches.',
      details: {
        fileCount: targetFiles.length,
        maxFiles: LINT_PROJECT_MAX_FILES,
      },
    });
  }

  const totalBytes = targetFiles.reduce(
    (sum, file) => sum + getContentSizeInBytes(file.content),
    0,
  );
  if (totalBytes > LINT_PROJECT_MAX_BYTES) {
    throw new HtmlProjectToolRecoverableError({
      ok: false,
      recoverable: true,
      code: 'lint-payload-too-large',
      message: `lintProject input is too large (${totalBytes} bytes).`,
      guidance: 'Retry with a smaller set of paths so lintProject can process them in batches.',
      details: {
        fileCount: targetFiles.length,
        totalBytes,
        maxBytes: LINT_PROJECT_MAX_BYTES,
      },
    });
  }

  const staticValidation = await runStaticValidation(
    targetFiles.map(file => ({
      path: file.path,
      kind: file.kind,
      content: file.content,
      encoding: file.encoding,
    })),
    { includeZeroCounts: true },
  );

  const errorCount = staticValidation.staticValidation?.errorCount ?? 0;
  const warningCount = staticValidation.staticValidation?.warningCount ?? 0;
  const durationMs = staticValidation.staticValidation?.durationMs ?? 0;
  const ok = staticValidation.staticValidation?.ok ?? true;
  const summary = summarizeLintProjectResult(
    errorCount,
    warningCount,
    requestedPaths.length > 0 ? targetFiles.length : null,
  );

  return {
    toolName: 'lintProject',
    summary,
    result: {
      projectId: project.id,
      checkedPaths: targetFiles.map(file => file.path),
      ok,
      errorCount,
      warningCount,
      durationMs,
      ...spreadStaticValidationFields(staticValidation),
    },
    workspace: createWorkspaceUpdate(project.id, summary),
  };
};

export const getHtmlProjectToolDefinitions = (): ToolDefinition[] => [
  {
    name: 'createProject',
    description: 'Create a browser-only HTML project that can be previewed next to the chat.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        template: { type: 'string', enum: ['single-page-app', 'blank'] },
      },
      required: ['name'],
    },
  },
  {
    name: 'listProjects',
    description: 'List existing HTML projects owned by the current assistant before reopening one.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'openProject',
    description: 'Open an existing HTML project for incremental edits in this chat session.',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'getProjectSummary',
    description:
      'Return a compact summary for the current HTML project, including file descriptors, todo summary, preview state, and suggested next action before resuming or editing work.',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
      },
      required: [],
    },
  },
  {
    name: 'searchFiles',
    description:
      'Search text-based project files for an existing string before making targeted edits.',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        query: { type: 'string' },
        caseSensitive: { type: 'boolean' },
      },
      required: ['query'],
    },
  },
  {
    name: 'writeFiles',
    description:
      'Write or overwrite one or more small complete project files in a single tool call. Use virtual project-root paths like /index.html, /src/app.js, or /data/ruby.js. Do not use host filesystem paths or URLs. For existing files, prefer readFile plus replaceInFile or modifyLinesInFile over sending a large full-file rewrite.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        projectId: { type: 'string' },
        files: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              path: { type: 'string', description: VIRTUAL_PROJECT_PATH_GUIDANCE },
              content: { type: 'string' },
              kind: { type: 'string', enum: ['html', 'css', 'js', 'json', 'svg', 'asset', 'md'] },
            },
            required: ['path', 'content'],
          },
        },
      },
      required: ['files'],
    },
  },
  {
    name: 'replaceInFile',
    description:
      'Replace one exact text span inside an existing text file after you inspect it with readFile. Use virtual project-root paths like /index.html, /src/app.js, or /data/ruby.js. Use raw content only: do not copy numberedContent prefixes like "12 | " into oldText or newText. If the text is ambiguous, read the file again and retry with a longer oldText snippet.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        projectId: { type: 'string' },
        path: { type: 'string', description: VIRTUAL_PROJECT_PATH_GUIDANCE },
        oldText: { type: 'string' },
        newText: { type: 'string' },
      },
      required: ['path', 'oldText', 'newText'],
    },
  },
  {
    name: 'listFiles',
    description: 'List the current project files before making incremental edits.',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
      },
      required: [],
    },
  },
  {
    name: 'modifyLinesInFile',
    description:
      'Modify specific 1-based lines inside an existing text file after you inspect it with readFile.numberedContent. Use operation replace, insertBefore, insertAfter, or delete. The line prefixes shown in numberedContent like "12 | " are not part of the file and must never be included in content or expectedOriginal.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        projectId: { type: 'string' },
        path: { type: 'string', description: VIRTUAL_PROJECT_PATH_GUIDANCE },
        operation: { type: 'string', enum: ['replace', 'insertBefore', 'insertAfter', 'delete'] },
        startLine: { type: 'number' },
        endLine: { type: 'number' },
        content: { type: 'string' },
        expectedOriginal: { type: 'string' },
      },
      required: ['path', 'operation', 'startLine'],
    },
  },
  {
    name: 'readFile',
    description:
      'Read a single project file and inspect its current content. Use virtual project-root paths like /index.html, /src/app.js, or /data/ruby.js. The result includes raw content plus numberedContent where each displayed line starts with "<line> | "; that prefix is not part of the real file content.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        projectId: { type: 'string' },
        path: { type: 'string', description: VIRTUAL_PROJECT_PATH_GUIDANCE },
        startLine: {
          type: 'number',
          description: '1-based first line to read. Must be within the file.',
        },
        endLine: {
          type: 'number',
          description:
            '1-based inclusive last line to read. Values past the end of the file are clamped to the last line, so endLine can be used as a max-lines cap.',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'listProjectTodos',
    description:
      'List the current project todo checklist and completion summary before resuming work.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        projectId: { type: 'string' },
      },
      required: [],
    },
  },
  {
    name: 'setProjectTodos',
    description:
      'Create or replace the project-scoped checklist for a multi-step task. Use concise titles and statuses such as pending, in_progress, or completed.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        projectId: { type: 'string' },
        todos: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string' },
              title: { type: 'string' },
              description: { type: 'string' },
              status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
              order: { type: 'number' },
            },
            required: ['title'],
          },
        },
      },
      required: ['todos'],
    },
  },
  {
    name: 'updateProjectTodo',
    description:
      'Update one existing project todo item after inspecting the current checklist. Use todoId from listProjectTodos.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        projectId: { type: 'string' },
        todoId: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
        order: { type: 'number' },
      },
      required: ['todoId'],
    },
  },
  {
    name: 'deleteProjectTodo',
    description: 'Delete one project todo item using its todoId from listProjectTodos.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        projectId: { type: 'string' },
        todoId: { type: 'string' },
      },
      required: ['todoId'],
    },
  },
  {
    name: 'checkProjectTodos',
    description:
      'Check whether the current project checklist is fully completed before claiming all work is done.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        projectId: { type: 'string' },
      },
      required: [],
    },
  },
  {
    name: 'deleteFile',
    description:
      'Delete a single project file from the active HTML project. Use virtual project-root paths like /index.html, /src/app.js, or /data/ruby.js.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        projectId: { type: 'string' },
        path: { type: 'string', description: VIRTUAL_PROJECT_PATH_GUIDANCE },
      },
      required: ['path'],
    },
  },
  {
    name: 'copyFile',
    description:
      'Copy one existing project file to a new virtual project-root path. Use this for file duplication instead of manually reading and rewriting the same file content. If later references need changes, inspect the project files and update them explicitly with searchFiles plus replaceInFile or modifyLinesInFile.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        projectId: { type: 'string' },
        sourcePath: { type: 'string', description: VIRTUAL_PROJECT_PATH_GUIDANCE },
        destinationPath: { type: 'string', description: VIRTUAL_PROJECT_PATH_GUIDANCE },
      },
      required: ['sourcePath', 'destinationPath'],
    },
  },
  {
    name: 'renameFile',
    description:
      'Rename or move one existing project file to a new virtual project-root path. Use this for path changes instead of simulating a rename with read plus write plus delete. If other files reference the old path, inspect them and update those references explicitly with searchFiles plus replaceInFile or modifyLinesInFile.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        projectId: { type: 'string' },
        sourcePath: { type: 'string', description: VIRTUAL_PROJECT_PATH_GUIDANCE },
        destinationPath: { type: 'string', description: VIRTUAL_PROJECT_PATH_GUIDANCE },
      },
      required: ['sourcePath', 'destinationPath'],
    },
  },
  {
    name: 'setEntrypoint',
    description:
      'Set which HTML file should be used as the preview entrypoint. Use virtual project-root paths like /index.html, /src/app.js, or /data/ruby.js.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        projectId: { type: 'string' },
        path: { type: 'string', description: VIRTUAL_PROJECT_PATH_GUIDANCE },
      },
      required: ['path'],
    },
  },
  {
    name: 'renderPreview',
    description:
      'Rebuild the latest preview artifact for the active HTML project only when the user explicitly requests a preview refresh/recheck or when repair diagnostics require revalidation.',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
      },
      required: [],
    },
  },
  // ===== Harness 常駐工具 (G2/G1/G11) =====
  {
    name: 'reportTurnOutcome',
    description:
      'Harness-resident tool (G2). Report whether the current turn is complete or needs continuation. Call this at the end of each turn with outcome "complete" or "continue_needed". The harness controller performs authoritative verification; this tool packages the model-reported outcome plus current todo summary and preview diagnostic state.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        projectId: { type: 'string' },
        outcome: {
          type: 'string',
          enum: ['complete', 'continue_needed'],
          description: 'Whether this turn is complete or needs another continuation round.',
        },
        notes: {
          type: 'string',
          description: 'Optional short notes explaining the outcome.',
        },
      },
      required: ['outcome'],
    },
  },
  {
    name: 'getPreviewRuntimeErrors',
    description:
      'Harness-resident tool (G1). Query runtime diagnostics (onerror/unhandledrejection/console) captured from the preview iframe for the current previewVersion. Returns status not_executed/clean/has_errors. Use to verify whether recent edits introduced runtime errors.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        projectId: { type: 'string' },
        waitMs: {
          type: 'number',
          description:
            'Maximum time to wait for a ready ack for the current previewVersion before returning. Default 1500, clamped to [0, 5000].',
        },
      },
      required: [],
    },
  },
  {
    name: 'listSnapshots',
    description:
      'Harness-resident tool (G11). List recent project snapshots (newest-first, capped at 20). Use before revertToSnapshot to find the target version.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        projectId: { type: 'string' },
      },
      required: [],
    },
  },
  {
    name: 'revertToSnapshot',
    description:
      'Harness-resident tool (G11). Revert project files to a previous snapshot version. previewVersion is incremented by +1 (monotonic) after revert, and runtime diagnostics are cleared. Use when a bad edit sequence should be rolled back.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        projectId: { type: 'string' },
        version: {
          type: 'number',
          description: 'The snapshot version to revert to (from listSnapshots).',
        },
      },
      required: ['version'],
    },
  },
  {
    name: 'lintProject',
    description:
      'Harness-resident tool. Proactively run static validation across the active HTML project or a selected set of virtual project files. Use this to inspect existing files or to confirm the project is syntax-clean before reporting completion.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        projectId: { type: 'string' },
        paths: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional virtual project-root paths to lint. Omit to validate the full project. Large projects may need to be linted in batches.',
        },
      },
      required: [],
    },
  },
  {
    name: 'gitStatus',
    description:
      'Local git tool. Show working-tree status (added/modified/deleted/untracked vs HEAD). Use to see uncommitted changes before deciding to commit. Read-only.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { projectId: { type: 'string' } },
      required: [],
    },
  },
  {
    name: 'gitLog',
    description:
      'Local git tool. List commit history (newest-first) with message, short oid, file count, and preview-version. Use to review what has been committed. Read-only.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        projectId: { type: 'string' },
        depth: { type: 'number', description: 'Optional max number of commits to return.' },
      },
      required: [],
    },
  },
  {
    name: 'gitDiff',
    description:
      'Local git tool. Show file-level changes and unified diff. Defaults to working-tree vs HEAD; pass refA/refB (oids or branch names) to compare two commits. Read-only.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        projectId: { type: 'string' },
        refA: { type: 'string', description: 'Optional base ref (default HEAD).' },
        refB: { type: 'string', description: 'Optional target ref (default working tree).' },
      },
      required: [],
    },
  },
  {
    name: 'gitCommit',
    description:
      'Local git tool. Commit current working-tree changes with a message. Use for small, logical checkpoints after a coherent set of edits. No-op (committed=false) if there are no changes. Mutates history.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        projectId: { type: 'string' },
        message: { type: 'string', description: 'Concise commit message describing the changes.' },
      },
      required: ['message'],
    },
  },
  {
    name: 'gitListBranches',
    description: 'Local git tool. List local branches and the current branch. Read-only.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { projectId: { type: 'string' } },
      required: [],
    },
  },
  {
    name: 'gitSwitchBranch',
    description:
      'Local git tool. Switch to an existing branch. Refuses (error) if the working tree has uncommitted changes — commit first. Mutates the working tree.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        projectId: { type: 'string' },
        ref: { type: 'string', description: 'The target branch name (from gitListBranches).' },
      },
      required: ['ref'],
    },
  },
];

export const getHtmlProjectToolNamesForPacks = (
  packSet: HtmlProjectToolPackName[],
): HtmlProjectToolName[] => {
  if (packSet.length === 0) {
    return [];
  }

  const allowedNames = new Set<HtmlProjectToolName>();
  for (const packName of packSet) {
    for (const toolName of HTML_PROJECT_TOOL_PACKS[packName]) {
      allowedNames.add(toolName);
    }
  }

  // G2/G1/G11:任何非空 pack 曝光時,自動附加 harness 常駐工具 (去重)。
  for (const toolName of HARNESS_RESIDENT_TOOL_NAMES) {
    allowedNames.add(toolName);
  }

  return [...allowedNames];
};

export const getHtmlProjectToolDefinitionsForPacks = (
  packSet: HtmlProjectToolPackName[],
): ToolDefinition[] => {
  const allowedNames = new Set(getHtmlProjectToolNamesForPacks(packSet));

  if (allowedNames.size === 0) {
    return [];
  }

  return getHtmlProjectToolDefinitions().filter(tool =>
    allowedNames.has(tool.name as HtmlProjectToolName),
  );
};

export const getAllHtmlProjectToolDefinitions = (): ToolDefinition[] =>
  getHtmlProjectToolDefinitions();

export const getHtmlProjectToolPackNames = (): HtmlProjectToolPackName[] =>
  Object.keys(HTML_PROJECT_TOOL_PACKS) as HtmlProjectToolPackName[];

export const isHtmlProjectToolName = (toolName: string): boolean => {
  return HTML_PROJECT_TOOL_NAMES.includes(toolName as (typeof HTML_PROJECT_TOOL_NAMES)[number]);
};

export const executeHtmlProjectToolCall = async (
  call: ToolCall,
  context: HtmlProjectToolContext,
): Promise<HtmlProjectToolExecutionResult> => {
  const safeArgs =
    call.args && typeof call.args === 'object' && !Array.isArray(call.args)
      ? call.args
      : ({} as Record<string, unknown>);
  const recoverableActiveProjectId = getRecoverableActiveProjectId(
    safeArgs,
    context.activeProjectId,
  );
  const requiredArgsError = validateRequiredToolArgs(call.name, safeArgs);
  if (requiredArgsError) {
    return createRecoverableToolExecutionResult(
      call.name,
      requiredArgsError,
      recoverableActiveProjectId,
    );
  }

  try {
    switch (call.name) {
      case 'createProject':
        return await handleCreateProject(safeArgs as unknown as CreateProjectArgs, context);
      case 'listProjects':
        return await handleListProjects(context);
      case 'openProject':
        return await handleOpenProject(safeArgs as unknown as OpenProjectArgs, context);
      case 'getProjectSummary':
        return await handleGetProjectSummary(safeArgs as unknown as GetProjectSummaryArgs, context);
      case 'searchFiles':
        return await handleSearchFiles(safeArgs as unknown as SearchFilesArgs, context);
      case 'writeFiles':
        return await handleWriteFiles(safeArgs as unknown as WriteFilesArgs, context);
      case 'replaceInFile':
        return await handleReplaceInFile(safeArgs as unknown as ReplaceInFileArgs, context);
      case 'modifyLinesInFile':
        return await handleModifyLinesInFile(safeArgs as unknown as ModifyLinesInFileArgs, context);
      case 'listFiles':
        return await handleListFiles(safeArgs as { projectId?: string }, context);
      case 'readFile':
        return await handleReadFile(safeArgs as unknown as ReadFileArgs, context);
      case 'listProjectTodos':
        return await handleListProjectTodos(safeArgs as unknown as ListProjectTodosArgs, context);
      case 'setProjectTodos':
        return await handleSetProjectTodos(safeArgs as unknown as SetProjectTodosArgs, context);
      case 'updateProjectTodo':
        return await handleUpdateProjectTodo(safeArgs as unknown as UpdateProjectTodoArgs, context);
      case 'deleteProjectTodo':
        return await handleDeleteProjectTodo(safeArgs as unknown as DeleteProjectTodoArgs, context);
      case 'checkProjectTodos':
        return await handleCheckProjectTodos(safeArgs as unknown as CheckProjectTodosArgs, context);
      case 'deleteFile':
        return await handleDeleteFile(safeArgs as unknown as DeleteFileArgs, context);
      case 'copyFile':
        return await handleCopyFile(safeArgs as unknown as CopyFileArgs, context);
      case 'renameFile':
        return await handleRenameFile(safeArgs as unknown as RenameFileArgs, context);
      case 'setEntrypoint':
        return await handleSetEntrypoint(safeArgs as unknown as SetEntrypointArgs, context);
      case 'renderPreview':
        return await handleRenderPreview(safeArgs as unknown as RenderPreviewArgs, context);
      case 'reportTurnOutcome':
        return await handleReportTurnOutcome(safeArgs as unknown as ReportTurnOutcomeArgs, context);
      case 'getPreviewRuntimeErrors':
        return await handleGetPreviewRuntimeErrors(
          safeArgs as unknown as GetPreviewRuntimeErrorsArgs,
          context,
        );
      case 'listSnapshots':
        return await handleListSnapshots(safeArgs as unknown as ListSnapshotsArgs, context);
      case 'revertToSnapshot':
        return await handleRevertToSnapshot(safeArgs as unknown as RevertToSnapshotArgs, context);
      case 'lintProject':
        return await handleLintProject(safeArgs as unknown as LintProjectArgs, context);
      case 'gitStatus':
        return await handleGitStatus(safeArgs as unknown as GitStatusArgs, context);
      case 'gitLog':
        return await handleGitLog(safeArgs as unknown as GitLogArgs, context);
      case 'gitDiff':
        return await handleGitDiff(safeArgs as unknown as GitDiffArgs, context);
      case 'gitCommit':
        return await handleGitCommit(safeArgs as unknown as GitCommitArgs, context);
      case 'gitListBranches':
        return await handleGitListBranches(safeArgs as unknown as GitListBranchesArgs, context);
      case 'gitSwitchBranch':
        return await handleGitSwitchBranch(safeArgs as unknown as GitSwitchBranchArgs, context);
      default:
        throw new Error(`Unsupported HTML project tool: ${call.name}`);
    }
  } catch (error) {
    if (error instanceof HtmlProjectToolRecoverableError) {
      return createRecoverableToolExecutionResult(
        call.name,
        error.result,
        recoverableActiveProjectId,
      );
    }
    if (error instanceof HtmlProjectPathValidationError) {
      return createRecoverableToolExecutionResult(
        call.name,
        {
          ok: false,
          recoverable: true,
          code: error.code,
          message: error.message,
          guidance: error.guidance,
          details: {
            path: error.path,
          },
        },
        recoverableActiveProjectId,
      );
    }
    throw error;
  }
};
