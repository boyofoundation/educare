import { describe, expect, it } from 'vitest';
import type { HtmlProjectSummary } from '../types';

import {
  buildHtmlProjectSystemPrompt,
  classifyHtmlProjectIntent,
  shouldEnableHtmlProjectTools,
} from './htmlProjectPrompting';

const projectSummary: HtmlProjectSummary = {
  projectId: 'project-123',
  name: 'Canvas MVP',
  entryFile: '/index.html',
  previewVersion: 7,
  previewReady: false,
  files: [
    {
      path: '/index.html',
      kind: 'html',
      size: 256,
      updatedAt: 1700000000000,
      dependencies: ['/scripts/app.js'],
    },
  ],
  fileCount: 1,
  todoSummary: {
    projectId: 'project-123',
    total: 2,
    pending: 1,
    inProgress: 1,
    completed: 0,
    allComplete: false,
  },
  lastBuildError: null,
  warnings: ['保留外部腳本資源：https://cdn.example.com/app.js'],
  previewDiagnostics: {
    category: 'missing_reference',
    outcome: 'repairable_error',
    repairable: true,
    summary: 'Missing preview dependencies: /scripts/app.js.',
    missingPaths: ['/scripts/app.js'],
    warnings: ['保留外部腳本資源：https://cdn.example.com/app.js'],
    details: ['Restore the missing file(s) or update the HTML references before retrying preview.'],
  },
  suggestedNextActionCategory: 'repair_preview',
};

describe('shouldEnableHtmlProjectTools', () => {
  it('returns true for continuation or reopen requests without an active project', () => {
    expect(
      shouldEnableHtmlProjectTools('Continue the HTML project we were editing yesterday.', null),
    ).toBe(true);
    expect(shouldEnableHtmlProjectTools('Can you reopen the earlier canvas prototype?', null)).toBe(
      true,
    );
  });

  it('returns true when an active project already exists', () => {
    expect(shouldEnableHtmlProjectTools('Help me tweak the copy.', 'project-123')).toBe(true);
  });

  it('returns true for project todo and checklist requests without an active project', () => {
    expect(shouldEnableHtmlProjectTools('Please create a project todo checklist.', null)).toBe(
      true,
    );
    expect(shouldEnableHtmlProjectTools('幫我建立專案工作清單', null)).toBe(true);
  });
});

describe('classifyHtmlProjectIntent', () => {
  it('routes reopen requests without an active project to the resume pack set', () => {
    expect(classifyHtmlProjectIntent('Can you reopen the earlier canvas prototype?', null)).toEqual(
      expect.objectContaining({
        intent: 'resume_project',
        confidence: 'high',
        selectedPackSet: expect.arrayContaining(['inspect', 'edit', 'todo_finalize']),
        requiresSummaryPreflight: false,
      }),
    );
  });

  it('adds preview recheck routing when continuing an active project and refreshing preview', () => {
    expect(
      classifyHtmlProjectIntent(
        'Continue the same project, fix the header, and refresh preview after that.',
        'project-123',
      ),
    ).toEqual(
      expect.objectContaining({
        intent: 'resume_project',
        confidence: 'medium',
        selectedPackSet: ['inspect', 'edit', 'todo_finalize', 'preview_recheck'],
        requiresSummaryPreflight: true,
      }),
    );
  });

  it('routes completion-plus-preview turns to finalize tooling', () => {
    expect(
      classifyHtmlProjectIntent(
        'Please finish this and recheck preview before we wrap up.',
        'project-123',
      ),
    ).toEqual(
      expect.objectContaining({
        intent: 'finalize_or_complete',
        confidence: 'high',
        selectedPackSet: ['inspect', 'todo_finalize', 'preview_recheck'],
        requiresSummaryPreflight: true,
      }),
    );
  });

  it('returns non-empty uncertain fallback when an active project has no HTML signal (AC#6)', () => {
    const decision = classifyHtmlProjectIntent('What is the capital of France?', 'project-123');
    expect(decision.intent).toBe('uncertain');
    expect(decision.confidence).toBe('low');
    expect(decision.selectedPackSet).toEqual(['inspect', 'edit', 'todo_finalize']);
    expect(decision.selectedPackSet.length).toBeGreaterThan(0);
    expect(decision.requiresSummaryPreflight).toBe(true);
    expect(decision.reason).toContain('falling back');
  });

  it('returns an empty pack set when there is no active project and no HTML signal (truly off-topic)', () => {
    const decision = classifyHtmlProjectIntent('What is the capital of France?', null);
    expect(decision.intent).toBe('uncertain');
    expect(decision.confidence).toBe('low');
    expect(decision.selectedPackSet).toEqual([]);
    expect(decision.requiresSummaryPreflight).toBe(false);
  });
});

describe('buildHtmlProjectSystemPrompt', () => {
  it('tells the model to list and open an existing project before editing when resuming without an active project', () => {
    const prompt = buildHtmlProjectSystemPrompt({
      activeProjectId: null,
      intentDecision: classifyHtmlProjectIntent(
        'Can you reopen the earlier canvas prototype?',
        null,
      ),
      projectSummary: null,
    });

    expect(prompt).toContain('No active HTML project exists yet.');
    expect(prompt).toContain('Current routing intent: resume_project (high confidence).');
    expect(prompt).toContain(
      'HTML tool packs exposed for this turn: bootstrap, inspect, edit, todo_finalize.',
    );
    expect(prompt).toContain(
      'Visible HTML project tools: createProject, listProjects, openProject',
    );
    expect(prompt).toContain(
      'When no active project exists and the user wants to continue earlier canvas work, use listProjects first, then openProject. Use createProject only when the user clearly wants a brand new webpage or prototype.',
    );
  });

  it('includes all HTML tools with soft-gated routing guidance for active project resume flows', () => {
    const prompt = buildHtmlProjectSystemPrompt({
      activeProjectId: 'project-123',
      intentDecision: classifyHtmlProjectIntent(
        'Continue the same project, fix the header, and refresh preview after that.',
        'project-123',
      ),
      projectSummary,
      gatingMode: 'soft',
    });

    expect(prompt).toContain('Current active HTML project id: project-123.');
    expect(prompt).toContain('Current routing intent: resume_project (medium confidence).');
    expect(prompt).toContain(
      'HTML tool packs recommended for this turn: inspect, edit, todo_finalize, preview_recheck.',
    );
    expect(prompt).toContain(
      'All HTML project tools are available for this turn. Recommended HTML tool packs for this turn: inspect, edit, todo_finalize, preview_recheck.',
    );
    expect(prompt).toContain(
      'Available HTML project tools: createProject, listProjects, openProject, getProjectSummary, searchFiles, writeFiles, replaceInFile, listFiles, modifyLinesInFile, readFile, listProjectTodos, setProjectTodos, updateProjectTodo, deleteProjectTodo, checkProjectTodos, deleteFile, copyFile, renameFile, setEntrypoint, renderPreview, reportTurnOutcome, getPreviewRuntimeErrors, listSnapshots, revertToSnapshot, lintProject, gitStatus, gitLog, gitDiff, gitCommit, gitListBranches, gitSwitchBranch.',
    );
    expect(prompt).toContain(
      'The system already injected a current project summary for this turn:',
    );
    expect(prompt).toContain('Do not start with redundant listFiles or listProjectTodos');
    expect(prompt).toContain(
      'For targeted edits, inspect existing work first: use getProjectSummary when available, use searchFiles to locate relevant code, use listFiles to inspect structure, then use readFile before writeFiles, replaceInFile, or modifyLinesInFile.',
    );
    expect(prompt).toContain(
      'Successful mutating tools already refresh preview/workspace state automatically. Use renderPreview only when the user explicitly asks to rebuild, reopen, refresh, or recheck preview state, or when preview diagnostics indicate that a repair flow needs revalidation.',
    );
  });

  it('keeps hard-gated finalize guidance scoped to finalize packs and includes lintProject as harness-resident', () => {
    const prompt = buildHtmlProjectSystemPrompt({
      activeProjectId: 'project-123',
      intentDecision: classifyHtmlProjectIntent(
        'Please finish this and recheck preview before we wrap up.',
        'project-123',
      ),
      projectSummary,
    });

    expect(prompt).toContain('Current routing intent: finalize_or_complete (high confidence).');
    expect(prompt).toContain(
      'HTML tool packs exposed for this turn: inspect, todo_finalize, preview_recheck.',
    );
    expect(prompt).toContain(
      'Visible HTML project tools: getProjectSummary, listFiles, searchFiles, readFile, listProjectTodos, gitStatus, gitLog, gitDiff, gitListBranches, checkProjectTodos, renderPreview, reportTurnOutcome, getPreviewRuntimeErrors, listSnapshots, revertToSnapshot, lintProject.',
    );
    expect(prompt).not.toContain(
      'Visible HTML project tools: getProjectSummary, listFiles, searchFiles, readFile, listProjectTodos, writeFiles',
    );
    expect(prompt).not.toContain(
      'use getProjectSummary when available, use searchFiles to locate relevant code, use listFiles to inspect structure, then use readFile before writeFiles, replaceInFile, or modifyLinesInFile.',
    );
  });

  it('adds plan-first guidance when the bootstrap pack is visible for a fresh build', () => {
    const prompt = buildHtmlProjectSystemPrompt({
      activeProjectId: null,
      intentDecision: classifyHtmlProjectIntent(
        'I want a brand new landing page from scratch.',
        null,
      ),
      projectSummary: null,
    });

    expect(prompt).toContain('Current routing intent: new_build');
    expect(prompt).toContain(
      'Before writing files, plan the work with setProjectTodos (at least 3 concrete todos). Execute todos one at a time, marking them in_progress/completed.',
    );
  });

  it('adds plan-first guidance when the edit pack is visible for a resume_project turn', () => {
    const prompt = buildHtmlProjectSystemPrompt({
      activeProjectId: 'project-123',
      intentDecision: classifyHtmlProjectIntent(
        'Continue the same project, fix the header, and refresh preview after that.',
        'project-123',
      ),
      projectSummary,
    });

    expect(prompt).toContain(
      'Before writing files, plan the work with setProjectTodos (at least 3 concrete todos). Execute todos one at a time, marking them in_progress/completed.',
    );
  });

  it('strengthens the todo_finalize gate with lintProject in addition to reportTurnOutcome and runtime checks', () => {
    const prompt = buildHtmlProjectSystemPrompt({
      activeProjectId: 'project-123',
      intentDecision: classifyHtmlProjectIntent(
        'Please finish this and recheck preview before we wrap up.',
        'project-123',
      ),
      projectSummary,
    });

    expect(prompt).toContain(
      "Before calling reportTurnOutcome(outcome:'complete'), you MUST first call checkProjectTodos and confirm todoSummary.allComplete === true, AND call getPreviewRuntimeErrors and confirm status is 'clean' or 'not_executed' (no runtime errors), AND call lintProject and confirm staticValidation.errorCount === 0. If todos remain, runtime errors exist, or lintProject finds errors, continue working instead of reporting complete.",
    );
  });

  it('adds the uncertain fallback pack set for an active project with no HTML signal (AC#6)', () => {
    const prompt = buildHtmlProjectSystemPrompt({
      activeProjectId: 'project-123',
      intentDecision: classifyHtmlProjectIntent('What is the capital of France?', 'project-123'),
      projectSummary: null,
    });

    expect(prompt).toContain('Current routing intent: uncertain (low confidence).');
    expect(prompt).toContain(
      'HTML tool packs exposed for this turn: inspect, edit, todo_finalize.',
    );
    // Plan-first + finalize gate should also appear since edit and todo_finalize are exposed
    expect(prompt).toContain(
      'Before writing files, plan the work with setProjectTodos (at least 3 concrete todos).',
    );
    expect(prompt).toContain("Before calling reportTurnOutcome(outcome:'complete')");
  });

  it('describes hard-vs-soft tool visibility wording explicitly', () => {
    const decision = classifyHtmlProjectIntent(
      'Continue the same project, fix the header, and refresh preview after that.',
      'project-123',
    );

    const hardPrompt = buildHtmlProjectSystemPrompt({
      activeProjectId: 'project-123',
      intentDecision: decision,
      projectSummary,
      gatingMode: 'hard',
    });
    const softPrompt = buildHtmlProjectSystemPrompt({
      activeProjectId: 'project-123',
      intentDecision: decision,
      projectSummary,
      gatingMode: 'soft',
    });

    expect(hardPrompt).toContain(
      'Only use tools that are visible for this turn. Visible HTML project tools:',
    );
    expect(softPrompt).toContain(
      'All HTML project tools are available for this turn. Recommended HTML tool packs for this turn: inspect, edit, todo_finalize, preview_recheck.',
    );
  });

  it('includes VFS sandbox capabilities and boundaries (V10)', () => {
    const prompt = buildHtmlProjectSystemPrompt({ activeProjectId: null });
    // Capabilities: modules, images, fetch, CSS url()/@import.
    expect(prompt).toContain('multi-file ES modules');
    expect(prompt).toContain('relative specifiers');
    expect(prompt).toContain('fetch("./data.json")');
    expect(prompt).toContain('CSS url()/@import');
    // Boundaries: Worker, XHR, dynamic import concat, style="" url(), CDN.
    expect(prompt).toContain('Web Workers');
    expect(prompt).toContain('XMLHttpRequest');
    expect(prompt).toContain('dynamic import()');
    expect(prompt).toContain('style="..." attributes');
    expect(prompt).toContain('external CDN resources require live network');
  });
});
