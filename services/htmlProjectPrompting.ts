import type {
  HtmlProjectIntentDecision,
  HtmlProjectSummary,
  HtmlProjectToolPackName,
} from '../types';
import {
  getAllHtmlProjectToolDefinitions,
  getHtmlProjectToolNamesForPacks,
} from './htmlProjectToolService';

const HTML_PROJECT_KEYWORDS = [
  'landing page',
  'prototype',
  'widget',
  'dashboard',
  'mini app',
  'single page',
  'web page',
  'webpage',
  'site',
  'ui mock',
  '網頁',
  '頁面',
  '網站',
  '原型',
  'landing',
  'hero section',
  'cta',
  'canvas',
  'html',
  'css',
  'javascript',
];

const HTML_PROJECT_CONTINUATION_KEYWORDS = [
  'continue',
  'continuing',
  'existing project',
  'previous project',
  'reopen',
  'open project',
  'resume',
  'same project',
  'earlier page',
  'existing canvas',
  '之前的頁面',
  '之前做的',
  '延續',
  '延續剛剛',
  '既有專案',
  '舊專案',
  '繼續修改',
  '重開專案',
  '開啟專案',
  '同一個 project',
  'todo',
  'todos',
  'checklist',
  'work plan',
  '待辦',
  '工作清單',
  '檢查清單',
  '任務清單',
];

const HTML_PROJECT_INSPECTION_KEYWORDS = [
  'inspect',
  'review',
  'summarize',
  'summary',
  'look at',
  'read through',
  'analyze',
  'audit',
  '檢查',
  '看看',
  '摘要',
  '總結',
  '分析',
];

const HTML_PROJECT_EDIT_KEYWORDS = [
  'edit',
  'update',
  'change',
  'modify',
  'tweak',
  'fix',
  'add',
  'remove',
  'delete',
  'rename',
  'copy',
  'write',
  'replace',
  'insert',
  'build',
  'create',
  'implement',
  'revise',
  '修改',
  '調整',
  '更新',
  '新增',
  '刪除',
  '修正',
  '建立',
  '改寫',
  '複製',
  '重新命名',
];

const HTML_PROJECT_COMPLETION_KEYWORDS = [
  'finish',
  'complete',
  'finalize',
  'wrap up',
  'done',
  'ship it',
  '驗收',
  '完成',
  '收尾',
  '定稿',
  '確認完成',
];

const HTML_PROJECT_PREVIEW_RECHECK_KEYWORDS = [
  'render preview',
  'refresh preview',
  'recheck preview',
  'rebuild preview',
  'open preview',
  'preview again',
  '重新整理預覽',
  '重建預覽',
  '重新檢查預覽',
  '打開預覽',
];

const DEFAULT_UNCERTAIN_PACK_SET: HtmlProjectToolPackName[] = ['inspect', 'edit', 'todo_finalize'];

const INTENT_PACKS: Record<HtmlProjectIntentDecision['intent'], HtmlProjectToolPackName[]> = {
  new_build: ['bootstrap', 'edit', 'todo_finalize'],
  resume_project: ['inspect', 'edit', 'todo_finalize'],
  inspect_only: ['inspect'],
  targeted_edit: ['inspect', 'edit', 'todo_finalize'],
  finalize_or_complete: ['inspect', 'todo_finalize'],
  uncertain: DEFAULT_UNCERTAIN_PACK_SET,
};

const includesKeyword = (normalizedMessage: string, keywords: string[]): boolean =>
  keywords.some(keyword => normalizedMessage.includes(keyword.toLowerCase()));

const hasAnyHtmlProjectSignal = (normalizedMessage: string): boolean => {
  return [
    HTML_PROJECT_KEYWORDS,
    HTML_PROJECT_CONTINUATION_KEYWORDS,
    HTML_PROJECT_INSPECTION_KEYWORDS,
    HTML_PROJECT_EDIT_KEYWORDS,
    HTML_PROJECT_COMPLETION_KEYWORDS,
    HTML_PROJECT_PREVIEW_RECHECK_KEYWORDS,
  ].some(keywordGroup => includesKeyword(normalizedMessage, keywordGroup));
};

export const classifyHtmlProjectIntent = (
  message: string,
  activeProjectId?: string | null,
): HtmlProjectIntentDecision => {
  const normalizedMessage = message.toLowerCase();
  const hasSignals = hasAnyHtmlProjectSignal(normalizedMessage);

  if (!hasSignals) {
    if (activeProjectId) {
      return {
        intent: 'uncertain',
        confidence: 'low',
        selectedPackSet: DEFAULT_UNCERTAIN_PACK_SET,
        reason:
          'Active project present but no specific HTML signal; falling back to inspect/edit/finalize so tools are not silently dropped.',
        requiresSummaryPreflight: true,
      };
    }
    return {
      intent: 'uncertain',
      confidence: 'low',
      selectedPackSet: [],
      reason: 'No HTML project signals detected for this turn.',
      requiresSummaryPreflight: false,
    };
  }

  const hasContinuationCue = includesKeyword(normalizedMessage, HTML_PROJECT_CONTINUATION_KEYWORDS);
  const hasInspectionCue = includesKeyword(normalizedMessage, HTML_PROJECT_INSPECTION_KEYWORDS);
  const hasEditCue = includesKeyword(normalizedMessage, HTML_PROJECT_EDIT_KEYWORDS);
  const hasCompletionCue = includesKeyword(normalizedMessage, HTML_PROJECT_COMPLETION_KEYWORDS);
  const hasPreviewCue = includesKeyword(normalizedMessage, HTML_PROJECT_PREVIEW_RECHECK_KEYWORDS);
  const hasBuildCue = includesKeyword(normalizedMessage, HTML_PROJECT_KEYWORDS);
  const mentionsNewProject =
    normalizedMessage.includes('new project') ||
    normalizedMessage.includes('brand new') ||
    normalizedMessage.includes('from scratch') ||
    normalizedMessage.includes('全新') ||
    normalizedMessage.includes('重新建立');

  if (
    !activeProjectId &&
    (mentionsNewProject || (hasBuildCue && !hasContinuationCue && !hasCompletionCue))
  ) {
    return {
      intent: 'new_build',
      confidence: mentionsNewProject ? 'high' : 'medium',
      selectedPackSet: INTENT_PACKS.new_build,
      reason:
        'The user is asking for a fresh HTML/UI build rather than resuming an existing project.',
      requiresSummaryPreflight: false,
    };
  }

  if (hasCompletionCue && !hasEditCue) {
    return {
      intent: 'finalize_or_complete',
      confidence: 'high',
      selectedPackSet: hasPreviewCue
        ? [...INTENT_PACKS.finalize_or_complete, 'preview_recheck']
        : INTENT_PACKS.finalize_or_complete,
      reason: 'The user is asking to verify or complete the current project state.',
      requiresSummaryPreflight: Boolean(activeProjectId),
    };
  }

  if (!activeProjectId && hasContinuationCue) {
    const selectedPackSet = [
      'bootstrap',
      ...INTENT_PACKS.resume_project,
    ] as HtmlProjectToolPackName[];

    return {
      intent: 'resume_project',
      confidence: 'high',
      selectedPackSet: hasPreviewCue ? [...selectedPackSet, 'preview_recheck'] : selectedPackSet,
      reason: 'The user explicitly wants to reopen or continue existing canvas work.',
      requiresSummaryPreflight: false,
    };
  }

  if (activeProjectId && hasInspectionCue && !hasEditCue && !hasCompletionCue) {
    return {
      intent: 'inspect_only',
      confidence: 'high',
      selectedPackSet: hasPreviewCue
        ? [...INTENT_PACKS.inspect_only, 'preview_recheck']
        : INTENT_PACKS.inspect_only,
      reason:
        'The user is asking to inspect or summarize the current project without making changes.',
      requiresSummaryPreflight: true,
    };
  }

  if (activeProjectId && hasContinuationCue && !hasCompletionCue) {
    return {
      intent: 'resume_project',
      confidence: hasEditCue ? 'medium' : 'high',
      selectedPackSet: hasPreviewCue
        ? [...INTENT_PACKS.resume_project, 'preview_recheck']
        : INTENT_PACKS.resume_project,
      reason:
        'The turn continues an existing active project and may need current summary context first.',
      requiresSummaryPreflight: true,
    };
  }

  if (hasEditCue || (activeProjectId && !hasInspectionCue && !hasCompletionCue)) {
    return {
      intent: 'targeted_edit',
      confidence: hasEditCue ? 'high' : 'medium',
      selectedPackSet: hasPreviewCue
        ? [...INTENT_PACKS.targeted_edit, 'preview_recheck']
        : INTENT_PACKS.targeted_edit,
      reason:
        'The user is asking for a project change or the active project likely needs an incremental edit path.',
      requiresSummaryPreflight: Boolean(activeProjectId),
    };
  }

  if (hasInspectionCue) {
    return {
      intent: 'inspect_only',
      confidence: 'medium',
      selectedPackSet: hasPreviewCue
        ? [...INTENT_PACKS.inspect_only, 'preview_recheck']
        : INTENT_PACKS.inspect_only,
      reason: 'The user asked to inspect current project state without a clear mutation request.',
      requiresSummaryPreflight: Boolean(activeProjectId),
    };
  }

  return {
    intent: 'uncertain',
    confidence: 'low',
    selectedPackSet: DEFAULT_UNCERTAIN_PACK_SET,
    reason: 'HTML project intent is ambiguous, so use the safe inspect/edit/finalize fallback.',
    requiresSummaryPreflight: Boolean(activeProjectId),
  };
};

export const shouldEnableHtmlProjectTools = (
  message: string,
  activeProjectId?: string | null,
): boolean => {
  return classifyHtmlProjectIntent(message, activeProjectId).selectedPackSet.length > 0;
};

interface BuildHtmlProjectSystemPromptOptions {
  activeProjectId?: string | null;
  intentDecision?: HtmlProjectIntentDecision | null;
  projectSummary?: HtmlProjectSummary | null;
  gatingMode?: 'soft' | 'hard';
}

const buildProjectSummaryPrompt = (projectSummary?: HtmlProjectSummary | null): string => {
  if (!projectSummary) {
    return '';
  }

  const compactSummary = {
    projectId: projectSummary.projectId,
    name: projectSummary.name,
    entryFile: projectSummary.entryFile,
    previewVersion: projectSummary.previewVersion,
    previewReady: projectSummary.previewReady,
    fileCount: projectSummary.fileCount,
    files: projectSummary.files.map(file => file.path),
    todoSummary: projectSummary.todoSummary,
    lastBuildError: projectSummary.lastBuildError ?? null,
    warnings: projectSummary.warnings,
    previewDiagnostics: projectSummary.previewDiagnostics,
    suggestedNextActionCategory: projectSummary.suggestedNextActionCategory,
  };

  return `The system already injected a current project summary for this turn: ${JSON.stringify(compactSummary)}. Do not start with redundant listFiles or listProjectTodos unless you need deeper detail than this summary provides.`;
};

const buildVisibleToolPrompt = (
  packSet: HtmlProjectToolPackName[],
  gatingMode: 'soft' | 'hard' = 'hard',
): string => {
  const recommendedToolNames = getHtmlProjectToolNamesForPacks(packSet);
  const availableToolNames =
    gatingMode === 'soft'
      ? getAllHtmlProjectToolDefinitions().map(tool => tool.name)
      : recommendedToolNames;

  if (availableToolNames.length === 0) {
    return '';
  }

  if (gatingMode === 'soft') {
    return `All HTML project tools are available for this turn. Recommended HTML tool packs for this turn: ${packSet.join(', ')}. Available HTML project tools: ${availableToolNames.join(', ')}.`;
  }

  return `Only use tools that are visible for this turn. Visible HTML project tools: ${availableToolNames.join(', ')}.`;
};

const buildPackSpecificGuidance = (packSet: HtmlProjectToolPackName[]): string[] => {
  const guidance: string[] = [];
  const packSetLookup = new Set(packSet);

  if (packSetLookup.has('bootstrap')) {
    guidance.push(
      'When no active project exists and the user wants to continue earlier canvas work, use listProjects first, then openProject. Use createProject only when the user clearly wants a brand new webpage or prototype.',
    );
  }

  if (packSetLookup.has('bootstrap') || packSetLookup.has('edit')) {
    guidance.push(
      'Before writing files, plan the work with setProjectTodos (at least 3 concrete todos). Execute todos one at a time, marking them in_progress/completed.',
    );
  }

  if (packSetLookup.has('inspect')) {
    guidance.push(
      'For inspection routes, use getProjectSummary, searchFiles, listFiles, readFile, and listProjectTodos to understand the current project before deciding on edits.',
    );
  }

  if (packSetLookup.has('edit')) {
    guidance.push(
      'When edit tools are available and the user asks to create, edit, copy, rename, or delete project contents, you must use the visible project tools to perform those changes instead of only describing edits in chat.',
    );
    guidance.push(
      'For targeted edits, inspect existing work first: use getProjectSummary when available, use searchFiles to locate relevant code, use listFiles to inspect structure, then use readFile before writeFiles, replaceInFile, or modifyLinesInFile.',
    );
    guidance.push(
      'Use writeFiles only for small complete-file writes. For edits inside an existing text file, prefer modifyLinesInFile after readFile.numberedContent when line-based edits are clearer, or use replaceInFile with raw content when you have one exact unique snippet.',
    );
    guidance.push(
      'For path-level duplication or moves, prefer copyFile and renameFile instead of manually simulating those operations with readFile plus writeFiles plus deleteFile.',
    );
  }

  if (packSetLookup.has('todo_finalize')) {
    guidance.push(
      'Before resuming project execution, inspect the current checklist or injected summary. Before saying all work is complete, call checkProjectTodos and confirm allComplete is true.',
    );
    guidance.push(
      "Before calling reportTurnOutcome(outcome:'complete'), you MUST first call checkProjectTodos and confirm todoSummary.allComplete === true, AND call getPreviewRuntimeErrors and confirm status is 'clean' or 'not_executed' (no runtime errors), AND call lintProject and confirm staticValidation.errorCount === 0. If todos remain, runtime errors exist, or lintProject finds errors, continue working instead of reporting complete.",
    );

    if (packSetLookup.has('edit')) {
      guidance.push(
        'When checklist edit tools are visible, maintain the project-scoped checklist using listProjectTodos, setProjectTodos, updateProjectTodo, and deleteProjectTodo.',
      );
    }
  }

  if (packSetLookup.has('preview_recheck')) {
    guidance.push(
      'Successful mutating tools already refresh preview/workspace state automatically. Use renderPreview only when the user explicitly asks to rebuild, reopen, refresh, or recheck preview state, or when preview diagnostics indicate that a repair flow needs revalidation.',
    );
  }

  return guidance;
};

export const SANDBOX_CAPABILITIES_PROMPT =
  'Preview sandbox capabilities: the rendered preview runs in a sandboxed iframe with a virtual file system (VFS) that fully supports multi-file ES modules (use relative specifiers like "./utils.js" or "/lib/helper.js" — circular imports work), image assets referenced by <img>/<picture>/<source> src or srcset, fetch() of project files (e.g. fetch("./data.json")), and CSS url()/@import references in both .css files and inline <style> blocks. Use project-relative paths for every local reference. Missing files and unresolved module specifiers surface as structured diagnostics (missing_reference / runtime errors) that you can read via getPreviewRuntimeErrors and self-repair from. writeFiles / replaceInFile / modifyLinesInFile also return `staticDiagnostics` whenever a written file has a syntax error (acorn for JS, css-tree/csstree-validator for CSS, parse5 for HTML, with inline <script>/<style> checked too); if you see that field populated, fix the listed syntax errors in the same turn before continuing — do not wait for a preview runtime probe.';

export const SANDBOX_BOUNDARIES_PROMPT =
  'Preview sandbox boundaries — these are NOT supported inside the sandbox: Web Workers (new Worker("./w.js") cannot resolve against the sandbox), XMLHttpRequest for local files (use fetch() instead), dynamic import() whose specifier is built by string concatenation at runtime (only literal specifiers can be resolved), url() references inside inline style="..." attributes (move them into a <style> block or .css file), and external CDN resources require live network access. Bare module specifiers (e.g. import "react") will not resolve unless you bundle them. Prefer self-contained projects that rely only on browser-native features and the project files themselves.';

export const buildHtmlProjectSystemPrompt = (
  options?: string | null | BuildHtmlProjectSystemPromptOptions,
): string => {
  const normalizedOptions =
    typeof options === 'object'
      ? options
      : {
          activeProjectId: options,
          intentDecision: null,
          projectSummary: null,
        };

  const activeProjectId = normalizedOptions?.activeProjectId ?? null;
  const selectedPackSet = normalizedOptions?.intentDecision?.selectedPackSet ?? [];
  const gatingMode = normalizedOptions?.gatingMode ?? 'hard';
  const continuationPrompt = activeProjectId
    ? `Current active HTML project id: ${activeProjectId}. Reuse it for incremental edits unless the user explicitly asks for a fresh project.`
    : 'No active HTML project exists yet.';
  const routingPrompt = selectedPackSet.length
    ? gatingMode === 'soft'
      ? `Current routing intent: ${normalizedOptions?.intentDecision?.intent} (${normalizedOptions?.intentDecision?.confidence} confidence). HTML tool packs recommended for this turn: ${selectedPackSet.join(', ')}.`
      : `Current routing intent: ${normalizedOptions?.intentDecision?.intent} (${normalizedOptions?.intentDecision?.confidence} confidence). HTML tool packs exposed for this turn: ${selectedPackSet.join(', ')}.`
    : '';
  const summaryPrompt = buildProjectSummaryPrompt(normalizedOptions?.projectSummary);
  const visibleToolPrompt = buildVisibleToolPrompt(selectedPackSet, gatingMode);
  const packSpecificGuidance = buildPackSpecificGuidance(selectedPackSet);

  return [
    'You can maintain browser-only HTML projects for the user using dedicated project tools.',
    continuationPrompt,
    routingPrompt,
    visibleToolPrompt,
    summaryPrompt,
    'Always use virtual project-root paths like /index.html, /src/app.js, or /data/ruby.js. Never use host filesystem paths or URLs.',
    SANDBOX_CAPABILITIES_PROMPT,
    'Use lintProject when you need a proactive static validation pass over existing project files or a final syntax check before completion',
    SANDBOX_BOUNDARIES_PROMPT,
    ...packSpecificGuidance,
    'Each displayed line in readFile.numberedContent starts with "<line> | ". That line-number prefix is only for display and must never be copied into replaceInFile.oldText, replaceInFile.newText, modifyLinesInFile.content, or modifyLinesInFile.expectedOriginal.',
    'If a tool returns a recoverable validation error, retry once with corrected arguments or a smaller payload. If the same recoverable error repeats with stronger fallback guidance, follow that fallback instead of repeating the exact same failing call.',
    'After opening an existing project, continue editing that same project unless the user explicitly asks to fork or replace it.',
    'Keep final chat responses concise and summarize the project changes rather than pasting the full source code.',
  ]
    .filter(Boolean)
    .join(' ');
};
