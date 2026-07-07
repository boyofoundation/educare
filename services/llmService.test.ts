import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockInitializeProviders,
  mockGetActiveProvider,
  mockHasKnowledgeChunks,
  mockBuildKnowledgeSearchResponse,
  mockExecuteHtmlProjectToolCall,
  mockRecordHtmlProjectTelemetryEvent,
  mockRunSubagentBatch,
} = vi.hoisted(() => ({
  mockInitializeProviders: vi.fn(),
  mockGetActiveProvider: vi.fn(),
  mockHasKnowledgeChunks: vi.fn(),
  mockBuildKnowledgeSearchResponse: vi.fn(),
  mockExecuteHtmlProjectToolCall: vi.fn(),
  mockRecordHtmlProjectTelemetryEvent: vi.fn(),
  mockRunSubagentBatch: vi.fn(),
}));

vi.mock('./providerRegistry', () => ({
  initializeProviders: mockInitializeProviders,
  providerManager: {
    getActiveProvider: mockGetActiveProvider,
  },
}));

vi.mock('./knowledgeSearchService', () => ({
  buildKnowledgeSearchResponse: mockBuildKnowledgeSearchResponse,
  hasKnowledgeChunks: mockHasKnowledgeChunks,
  KNOWLEDGE_SEARCH_SYSTEM_PROMPT: 'Knowledge prompt',
  KNOWLEDGE_SEARCH_TOOL_DESCRIPTION: 'Knowledge tool',
  KNOWLEDGE_SEARCH_TOOL_NAME: 'knowledgeSearch',
  KNOWLEDGE_SEARCH_TOOL_SCHEMA: {
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query'],
  },
}));

vi.mock('./htmlProjectToolService', async importOriginal => {
  const actual = await importOriginal<typeof import('./htmlProjectToolService')>();

  return {
    ...actual,
    executeHtmlProjectToolCall: mockExecuteHtmlProjectToolCall,
  };
});

vi.mock('./htmlProjectAgentTelemetry', () => ({
  recordHtmlProjectTelemetryEvent: mockRecordHtmlProjectTelemetryEvent,
}));

vi.mock('./subagentService', () => ({
  SUBAGENT_DELEGATE_TOOL_NAME: 'delegateToSubagents',
  SUBAGENT_DELEGATION_SYSTEM_PROMPT: 'Subagent prompt',
  buildSubagentDelegationToolDefinition: () => ({
    name: 'delegateToSubagents',
    description: 'Delegate subagent tasks',
    parameters: { type: 'object', properties: { tasks: { type: 'array' } }, required: ['tasks'] },
  }),
  runSubagentBatch: mockRunSubagentBatch,
}));

describe('streamChat', () => {
  beforeEach(() => {
    mockHasKnowledgeChunks.mockReturnValue(false);

    vi.resetModules();
    vi.clearAllMocks();
    mockInitializeProviders.mockResolvedValue(undefined);
    mockHasKnowledgeChunks.mockReturnValue(false);
    mockBuildKnowledgeSearchResponse.mockReturnValue({ matches: [] });
    mockRunSubagentBatch.mockResolvedValue({
      ok: true,
      batchId: 'batch-1',
      results: [],
      usageTotals: undefined,
    });
    mockExecuteHtmlProjectToolCall.mockResolvedValue({
      workspace: {
        activeProjectId: 'project-123',
        activityMessage: 'updated project',
        preview: null,
      },
      result: {
        projectId: 'project-123',
        updated: ['/index.html'],
      },
      summary: 'updated project',
    });
  });

  it('allows valid HTML project tools under soft-gated main-turn exposure', async () => {
    const observedChatParams: Array<Record<string, unknown>> = [];
    mockExecuteHtmlProjectToolCall.mockImplementation(async call => {
      if (call.name === 'getProjectSummary') {
        return {
          workspace: {
            activeProjectId: 'project-123',
            activityMessage: 'loaded summary',
            preview: null,
          },
          result: {
            projectSummary: {
              projectId: 'project-123',
              name: 'Canvas MVP',
              entryFile: '/index.html',
              previewVersion: 7,
              previewReady: false,
              files: [],
              fileCount: 0,
              todoSummary: {
                projectId: 'project-123',
                total: 2,
                pending: 1,
                inProgress: 1,
                completed: 0,
                allComplete: false,
              },
              warnings: [],
              previewDiagnostics: {
                category: 'missing_reference',
                outcome: 'repairable_error',
                repairable: true,
                summary: 'Missing preview dependencies: /scripts/app.js.',
              },
              suggestedNextActionCategory: 'repair_preview',
            },
          },
          summary: 'loaded summary',
        };
      }

      return {
        workspace: {
          activeProjectId: 'project-123',
          activityMessage: 'updated project',
          preview: null,
        },
        result: {
          projectId: 'project-123',
          updated: ['/index.html'],
        },
        summary: 'updated project',
      };
    });

    const provider = {
      name: 'gemini',
      displayName: 'Gemini',
      supportedModels: ['gemini-2.5-flash'],
      isAvailable: () => true,
      streamChat: vi.fn(async function* (params) {
        observedChatParams.push(params as Record<string, unknown>);
        const executeTool = params.executeTool as (call: {
          name: string;
          args: Record<string, unknown>;
        }) => Promise<unknown>;
        const writeFilesResult = await executeTool({
          name: 'writeFiles',
          args: {
            projectId: 'project-123',
            files: [{ path: '/index.html', content: '<main>Hi</main>' }],
          },
        });

        expect(writeFilesResult).toMatchObject({
          projectId: 'project-123',
          updated: ['/index.html'],
          summary: 'updated project',
        });

        yield {
          text: '',
          isComplete: true,
          metadata: {
            promptTokenCount: 5,
            candidatesTokenCount: 2,
            provider: 'gemini',
            model: 'gemini-2.5-flash',
            toolRoundCount: 1,
            repeatedRecoverableErrors: [],
          },
        };
      }),
    };

    mockGetActiveProvider.mockReturnValue(provider);

    const { streamChat } = await import('./llmService');

    await streamChat({
      htmlProjectEnabled: true,
      systemPrompt: 'You are helpful.',
      history: [],
      message: 'Please finish this and recheck preview before we wrap up.',
      assistantId: 'assistant-1',
      activeProjectId: 'project-123',
      knowledgeChunks: [],
      onChunk: vi.fn(),
      onComplete: vi.fn(),
      onProjectToolActivity: vi.fn(),
    });

    expect(mockExecuteHtmlProjectToolCall).toHaveBeenCalledTimes(2);
    expect(mockExecuteHtmlProjectToolCall).toHaveBeenNthCalledWith(
      1,
      {
        name: 'getProjectSummary',
        args: { projectId: 'project-123' },
      },
      {
        assistantId: 'assistant-1',
        sessionId: undefined,
        activeProjectId: 'project-123',
      },
    );
    expect(mockExecuteHtmlProjectToolCall).toHaveBeenNthCalledWith(
      2,
      {
        name: 'writeFiles',
        args: {
          projectId: 'project-123',
          files: [{ path: '/index.html', content: '<main>Hi</main>' }],
        },
      },
      {
        assistantId: 'assistant-1',
        sessionId: undefined,
        activeProjectId: 'project-123',
      },
    );
    expect(provider.streamChat).toHaveBeenCalledTimes(1);
    expect(observedChatParams[0]?.toolChoice).toEqual({
      mode: 'requireSpecific',
      name: 'getProjectSummary',
    });
    expect(observedChatParams[0]?.tools).toHaveLength(25);
    expect(observedChatParams[0]?.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'createProject' }),
        expect.objectContaining({ name: 'listProjects' }),
        expect.objectContaining({ name: 'openProject' }),
        expect.objectContaining({ name: 'getProjectSummary' }),
        expect.objectContaining({ name: 'writeFiles' }),
        expect.objectContaining({ name: 'checkProjectTodos' }),
        expect.objectContaining({ name: 'reportTurnOutcome' }),
        expect.objectContaining({ name: 'getPreviewRuntimeErrors' }),
        expect.objectContaining({ name: 'listSnapshots' }),
        expect.objectContaining({ name: 'revertToSnapshot' }),
        expect.objectContaining({ name: 'lintProject' }),
      ]),
    );
  });

  it('exposes no HTML project tools and skips intent classification when htmlProjectEnabled is false', async () => {
    const observedChatParams: Array<Record<string, unknown>> = [];
    const provider = {
      name: 'gemini',
      displayName: 'Gemini',
      supportedModels: ['gemini-2.5-flash'],
      isAvailable: () => true,
      streamChat: vi.fn(async function* (params) {
        observedChatParams.push(params as Record<string, unknown>);
        yield {
          text: 'done',
          isComplete: true,
          metadata: {
            promptTokenCount: 3,
            candidatesTokenCount: 1,
            provider: 'gemini',
            model: 'gemini-2.5-flash',
            toolRoundCount: 0,
            repeatedRecoverableErrors: [],
          },
        };
      }),
    };

    mockGetActiveProvider.mockReturnValue(provider);

    const { streamChat } = await import('./llmService');

    await streamChat({
      // htmlProjectEnabled intentionally omitted → defaults to false (opt-in).
      systemPrompt: 'You are helpful.',
      history: [],
      // Message carries strong HTML-build signals AND an active project id, which
      // would normally trigger project tools — they must stay hidden here.
      message: 'Build me a brand new expense tracker webpage and recheck the preview.',
      assistantId: 'assistant-1',
      activeProjectId: 'project-123',
      knowledgeChunks: [],
      onChunk: vi.fn(),
      onComplete: vi.fn(),
      onProjectToolActivity: vi.fn(),
    });

    // No summary preflight or any project tool execution occurred.
    expect(mockExecuteHtmlProjectToolCall).not.toHaveBeenCalled();
    // Provider received no tools and no forced tool choice for this plain turn.
    expect(provider.streamChat).toHaveBeenCalledTimes(1);
    expect(observedChatParams[0]?.tools).toBeUndefined();
    expect(observedChatParams[0]?.toolChoice).toBeUndefined();
  });

  it('returns a recoverable unsupported-tool error for unknown tool names', async () => {
    const provider = {
      name: 'gemini',
      displayName: 'Gemini',
      supportedModels: ['gemini-2.5-flash'],
      isAvailable: () => true,
      streamChat: vi.fn(async function* (params) {
        const executeTool = params.executeTool as (call: {
          name: string;
          args: Record<string, unknown>;
        }) => Promise<unknown>;
        const result = await executeTool({
          name: 'unknownTool',
          args: { foo: 'bar' },
        });

        expect(result).toMatchObject({
          ok: false,
          recoverable: true,
          code: 'tool-unsupported',
          message: 'Unsupported tool: unknownTool',
          guidance: 'Retry using only tools that are explicitly exposed for this turn.',
          details: {
            requestedTool: 'unknownTool',
            selectedPackSet: ['inspect', 'todo_finalize', 'preview_recheck'],
            intent: 'finalize_or_complete',
          },
        });

        yield {
          text: '',
          isComplete: true,
          metadata: {
            promptTokenCount: 3,
            candidatesTokenCount: 1,
            provider: 'gemini',
            model: 'gemini-2.5-flash',
            toolRoundCount: 1,
            repeatedRecoverableErrors: [],
          },
        };
      }),
    };

    mockGetActiveProvider.mockReturnValue(provider);

    const { streamChat } = await import('./llmService');

    await streamChat({
      htmlProjectEnabled: true,
      systemPrompt: 'You are helpful.',
      history: [],
      message: 'Please finish this and recheck preview before we wrap up.',
      assistantId: 'assistant-1',
      activeProjectId: 'project-123',
      knowledgeChunks: [],
      onChunk: vi.fn(),
      onComplete: vi.fn(),
      onProjectToolActivity: vi.fn(),
    });

    expect(mockExecuteHtmlProjectToolCall).toHaveBeenCalledTimes(1);
  });

  it('forces createProject on first HTML build turns without an active project', async () => {
    const observedChatParams: Array<Record<string, unknown>> = [];
    const provider = {
      name: 'gemini',
      displayName: 'Gemini',
      supportedModels: ['gemini-2.5-flash'],
      isAvailable: () => true,
      streamChat: vi.fn(async function* (params) {
        observedChatParams.push(params as Record<string, unknown>);
        yield {
          text: 'created',
          isComplete: true,
          metadata: {
            promptTokenCount: 4,
            candidatesTokenCount: 2,
            provider: 'gemini',
            model: 'gemini-2.5-flash',
            toolRoundCount: 0,
            repeatedRecoverableErrors: [],
          },
        };
      }),
    };

    mockGetActiveProvider.mockReturnValue(provider);

    const { streamChat } = await import('./llmService');

    await streamChat({
      htmlProjectEnabled: true,
      systemPrompt: 'You are helpful.',
      history: [],
      message: 'Build me a brand new expense tracker webpage.',
      assistantId: 'assistant-1',
      knowledgeChunks: [],
      onChunk: vi.fn(),
      onComplete: vi.fn(),
      onProjectToolActivity: vi.fn(),
    });

    expect(observedChatParams[0]?.toolChoice).toEqual({
      mode: 'requireSpecific',
      name: 'createProject',
    });
  });

  it('uses packSetOverride directly and bypasses intent classification', async () => {
    const observedChatParams: Array<Record<string, unknown>> = [];
    const provider = {
      name: 'gemini',
      displayName: 'Gemini',
      supportedModels: ['gemini-2.5-flash'],
      isAvailable: () => true,
      streamChat: vi.fn(async function* (params) {
        observedChatParams.push(params as Record<string, unknown>);
        yield {
          text: 'done',
          isComplete: true,
          metadata: {
            promptTokenCount: 4,
            candidatesTokenCount: 2,
            provider: 'gemini',
            model: 'gemini-2.5-flash',
            toolRoundCount: 0,
            repeatedRecoverableErrors: [],
          },
        };
      }),
    };

    mockGetActiveProvider.mockReturnValue(provider);

    const htmlProjectPrompting = await import('./htmlProjectPrompting');
    const classifySpy = vi
      .spyOn(htmlProjectPrompting, 'classifyHtmlProjectIntent')
      .mockReturnValue({
        intent: 'inspect_only',
        confidence: 'high',
        selectedPackSet: ['inspect'],
        reason: 'spy-default',
        requiresSummaryPreflight: false,
      });

    try {
      const { streamChat } = await import('./llmService');

      await streamChat({
        htmlProjectEnabled: true,
        systemPrompt: 'You are helpful.',
        history: [],
        message: 'continuation',
        assistantId: 'assistant-1',
        activeProjectId: 'project-123',
        knowledgeChunks: [],
        packSetOverride: ['inspect', 'edit'],
        onChunk: vi.fn(),
        onComplete: vi.fn(),
        onProjectToolActivity: vi.fn(),
      });

      // G2: classifier is NOT called when packSetOverride is supplied.
      expect(classifySpy).not.toHaveBeenCalled();
      // The override pack set drives tool exposure — both inspect + edit tools
      // are visible to the provider.
      const toolNames = (observedChatParams[0]?.tools as Array<{ name: string }> | undefined)?.map(
        t => t.name,
      );
      expect(observedChatParams[0]?.toolChoice).toEqual({
        mode: 'requireSpecific',
        name: 'getProjectSummary',
      });
      expect(toolNames).toEqual(expect.arrayContaining(['writeFiles', 'readFile']));
    } finally {
      classifySpy.mockRestore();
    }
  });

  it('forces an HTML project tool even when knowledge search is also enabled', async () => {
    const observedChatParams: Array<Record<string, unknown>> = [];
    const provider = {
      name: 'gemini',
      displayName: 'Gemini',
      supportedModels: ['gemini-2.5-flash'],
      isAvailable: () => true,
      streamChat: vi.fn(async function* (params) {
        observedChatParams.push(params as Record<string, unknown>);
        yield {
          text: 'inspected',
          isComplete: true,
          metadata: {
            promptTokenCount: 4,
            candidatesTokenCount: 2,
            provider: 'gemini',
            model: 'gemini-2.5-flash',
            toolRoundCount: 0,
            repeatedRecoverableErrors: [],
          },
        };
      }),
    };

    mockGetActiveProvider.mockReturnValue(provider);
    mockHasKnowledgeChunks.mockReturnValue(true);

    const { streamChat } = await import('./llmService');

    await streamChat({
      htmlProjectEnabled: true,
      systemPrompt: 'You are helpful.',
      history: [],
      message: 'Please finish this and recheck preview before we wrap up.',
      assistantId: 'assistant-1',
      activeProjectId: 'project-123',
      knowledgeChunks: [{ fileName: 'guide.md', content: 'guide', relevanceScore: 0.9 }],
      onChunk: vi.fn(),
      onComplete: vi.fn(),
      onProjectToolActivity: vi.fn(),
    });

    expect(observedChatParams[0]?.toolChoice).toEqual({
      mode: 'requireSpecific',
      name: 'getProjectSummary',
    });
    const toolNames = (observedChatParams[0]?.tools as Array<{ name: string }> | undefined)?.map(
      t => t.name,
    );
    expect(toolNames).toEqual(
      expect.arrayContaining(['knowledgeSearch', 'getProjectSummary', 'checkProjectTodos']),
    );
  });

  it('forces listProjects when reopening canvas work without an active project', async () => {
    const observedChatParams: Array<Record<string, unknown>> = [];
    const provider = {
      name: 'gemini',
      displayName: 'Gemini',
      supportedModels: ['gemini-2.5-flash'],
      isAvailable: () => true,
      streamChat: vi.fn(async function* (params) {
        observedChatParams.push(params as Record<string, unknown>);
        yield {
          text: 'listed',
          isComplete: true,
          metadata: {
            promptTokenCount: 4,
            candidatesTokenCount: 2,
            provider: 'gemini',
            model: 'gemini-2.5-flash',
            toolRoundCount: 0,
            repeatedRecoverableErrors: [],
          },
        };
      }),
    };

    mockGetActiveProvider.mockReturnValue(provider);

    const { streamChat } = await import('./llmService');

    await streamChat({
      htmlProjectEnabled: true,
      systemPrompt: 'You are helpful.',
      history: [],
      message: 'Can you reopen the earlier canvas prototype?',
      assistantId: 'assistant-1',
      knowledgeChunks: [],
      onChunk: vi.fn(),
      onComplete: vi.fn(),
      onProjectToolActivity: vi.fn(),
    });

    expect(observedChatParams[0]?.toolChoice).toEqual({
      mode: 'requireSpecific',
      name: 'listProjects',
    });
  });

  it('threads params.signal into the provider chatParams', async () => {
    const observedChatParams: Array<Record<string, unknown>> = [];
    const provider = {
      name: 'gemini',
      displayName: 'Gemini',
      supportedModels: ['gemini-2.5-flash'],
      isAvailable: () => true,
      streamChat: vi.fn(async function* (params) {
        observedChatParams.push(params as Record<string, unknown>);
        yield {
          text: 'ok',
          isComplete: true,
          metadata: {
            promptTokenCount: 1,
            candidatesTokenCount: 1,
            provider: 'gemini',
            model: 'gemini-2.5-flash',
            toolRoundCount: 0,
            repeatedRecoverableErrors: [],
          },
        };
      }),
    };

    mockGetActiveProvider.mockReturnValue(provider);

    const { streamChat } = await import('./llmService');

    const controller = new AbortController();
    await streamChat({
      htmlProjectEnabled: true,
      systemPrompt: 'You are helpful.',
      history: [],
      message: 'hello',
      assistantId: 'assistant-1',
      knowledgeChunks: [],
      signal: controller.signal,
      onChunk: vi.fn(),
      onComplete: vi.fn(),
    });

    expect(observedChatParams[0]?.signal).toBe(controller.signal);
    expect(observedChatParams[0]?.toolChoice).toBeUndefined();
  });

  it('passes finishReason and projectSummary through onComplete metadata', async () => {
    const provider = {
      name: 'gemini',
      displayName: 'Gemini',
      supportedModels: ['gemini-2.5-flash'],
      isAvailable: () => true,
      streamChat: vi.fn(async function* () {
        // Streaming chunk (text captured into fullResponseText).
        yield {
          text: 'all ',
          isComplete: false,
        };
        yield {
          text: 'done',
          isComplete: true,
          metadata: {
            promptTokenCount: 5,
            candidatesTokenCount: 3,
            provider: 'gemini',
            model: 'gemini-2.5-flash',
            toolRoundCount: 1,
            repeatedRecoverableErrors: [],
            finishReason: 'tool-budget-exhausted',
          },
        };
      }),
    };

    mockGetActiveProvider.mockReturnValue(provider);
    // Surface a projectSummary via the preflight path so we can assert it
    // flows into onComplete metadata. The message below triggers the
    // finalize_or_complete route which performs summary preflight.
    mockExecuteHtmlProjectToolCall.mockResolvedValue({
      workspace: {
        activeProjectId: 'project-123',
        activityMessage: 'summary',
        preview: null,
      },
      result: {
        projectSummary: {
          projectId: 'project-123',
          name: 'Demo',
          entryFile: '/index.html',
          previewVersion: 4,
          previewReady: true,
          files: [],
          fileCount: 0,
          todoSummary: {
            projectId: 'project-123',
            total: 2,
            pending: 0,
            inProgress: 0,
            completed: 2,
            allComplete: true,
          },
          warnings: [],
          previewDiagnostics: {
            category: 'none',
            outcome: 'ready',
            repairable: false,
            summary: 'ok',
          },
          suggestedNextActionCategory: 'finalize',
        },
      },
      summary: 'summary',
    });

    const { streamChat } = await import('./llmService');

    const onComplete = vi.fn();
    await streamChat({
      htmlProjectEnabled: true,
      systemPrompt: 'You are helpful.',
      history: [],
      message: 'Please finish this and recheck preview before we wrap up.',
      assistantId: 'assistant-1',
      activeProjectId: 'project-123',
      knowledgeChunks: [],
      onChunk: vi.fn(),
      onComplete,
      onProjectToolActivity: vi.fn(),
    });

    expect(onComplete).toHaveBeenCalledTimes(1);
    const [metadata, fullText] = onComplete.mock.calls[0];
    expect(fullText).toBe('all ');
    expect(metadata.finishReason).toBe('tool-budget-exhausted');
    expect(metadata.projectSummary).toMatchObject({
      projectId: 'project-123',
      todoSummary: { allComplete: true, completed: 2 },
    });
  });

  it('exposes delegateToSubagents only when subagent delegation is enabled', async () => {
    const observedChatParams: Array<Record<string, unknown>> = [];
    const provider = {
      name: 'gemini',
      displayName: 'Gemini',
      supportedModels: ['gemini-2.5-flash'],
      isAvailable: () => true,
      streamChat: vi.fn(async function* (params) {
        observedChatParams.push(params as Record<string, unknown>);
        yield {
          text: 'delegated',
          isComplete: true,
          metadata: {
            promptTokenCount: 1,
            candidatesTokenCount: 1,
            provider: 'gemini',
            model: 'gemini-2.5-flash',
            toolRoundCount: 0,
            repeatedRecoverableErrors: [],
          },
        };
      }),
    };

    mockGetActiveProvider.mockReturnValue(provider);
    const { streamChat } = await import('./llmService');

    await streamChat({
      htmlProjectEnabled: true,
      systemPrompt: 'You are helpful.',
      history: [],
      message: 'parallel research please',
      assistantId: 'assistant-1',
      knowledgeChunks: [],
      subagentDelegationEnabled: true,
      onChunk: vi.fn(),
      onComplete: vi.fn(),
    });

    const toolNames = (observedChatParams[0]?.tools as Array<{ name: string }>).map(
      tool => tool.name,
    );
    expect(toolNames).toContain('delegateToSubagents');

    observedChatParams.length = 0;
    await streamChat({
      htmlProjectEnabled: true,
      systemPrompt: 'You are helpful.',
      history: [],
      message: 'parallel research please',
      assistantId: 'assistant-1',
      knowledgeChunks: [],
      subagentDelegationEnabled: false,
      onChunk: vi.fn(),
      onComplete: vi.fn(),
    });
    const toolNamesWithoutDelegation = (
      (observedChatParams[0]?.tools as Array<{ name: string }> | undefined) ?? []
    ).map(tool => tool.name);
    expect(toolNamesWithoutDelegation).not.toContain('delegateToSubagents');
  });

  it('forwards subagent batch results through onSubagentActivity and onComplete metadata', async () => {
    const provider = {
      name: 'gemini',
      displayName: 'Gemini',
      supportedModels: ['gemini-2.5-flash'],
      isAvailable: () => true,
      streamChat: vi.fn(async function* (params) {
        const executeTool = params.executeTool as (call: {
          name: string;
          args: Record<string, unknown>;
        }) => Promise<unknown>;
        const result = await executeTool({
          name: 'delegateToSubagents',
          args: {
            tasks: [{ name: 'Spec', systemPrompt: 'Do work', task: 'Investigate' }],
          },
        });
        expect(result).toMatchObject({ ok: true, batchId: 'batch-1' });
        yield {
          text: 'done',
          isComplete: true,
          metadata: {
            promptTokenCount: 4,
            candidatesTokenCount: 2,
            provider: 'gemini',
            model: 'gemini-2.5-flash',
            toolRoundCount: 1,
            repeatedRecoverableErrors: [],
            finishReason: 'complete',
          },
        };
      }),
    };

    mockRunSubagentBatch.mockImplementation(async (_tasks, _env, callbacks) => {
      callbacks?.onActivity?.({
        batchId: 'batch-1',
        runs: [
          {
            id: 'run-1',
            batchId: 'batch-1',
            name: 'Spec',
            task: 'Investigate',
            status: 'complete',
            output: 'Subagent output',
            toolSequence: ['searchKnowledgeBase'],
            durationMs: 12,
          },
        ],
      });
      return {
        ok: true,
        batchId: 'batch-1',
        results: [
          {
            name: 'Spec',
            status: 'complete',
            output: 'Subagent output',
            toolSequence: ['searchKnowledgeBase'],
          },
        ],
        usageTotals: {
          inputTokens: 3,
          outputTokens: 2,
          totalTokens: 5,
        },
      };
    });

    mockGetActiveProvider.mockReturnValue(provider);
    const { streamChat } = await import('./llmService');
    const onSubagentActivity = vi.fn();
    const onComplete = vi.fn();

    await streamChat({
      htmlProjectEnabled: true,
      systemPrompt: 'You are helpful.',
      history: [],
      message: 'parallel research please',
      assistantId: 'assistant-1',
      knowledgeChunks: [],
      subagentDelegationEnabled: true,
      onChunk: vi.fn(),
      onSubagentActivity,
      onComplete,
    });

    expect(onSubagentActivity).toHaveBeenCalledWith({
      batchId: 'batch-1',
      runs: [
        expect.objectContaining({
          id: 'run-1',
          batchId: 'batch-1',
          name: 'Spec',
          status: 'complete',
        }),
      ],
    });
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        subagentRuns: [expect.objectContaining({ id: 'run-1', batchId: 'batch-1' })],
        subagentUsageTotals: {
          inputTokens: 3,
          outputTokens: 2,
          totalTokens: 5,
        },
      }),
      '',
    );
  });

  it('aggregates subagent usage totals across multiple delegate batches in one turn', async () => {
    const provider = {
      name: 'gemini',
      displayName: 'Gemini',
      supportedModels: ['gemini-2.5-flash'],
      isAvailable: () => true,
      streamChat: vi.fn(async function* (params) {
        const executeTool = params.executeTool as (call: {
          name: string;
          args: Record<string, unknown>;
        }) => Promise<unknown>;

        await executeTool({
          name: 'delegateToSubagents',
          args: {
            tasks: [{ name: 'Batch one', systemPrompt: 'Do work', task: 'Investigate one' }],
          },
        });
        await executeTool({
          name: 'delegateToSubagents',
          args: {
            tasks: [{ name: 'Batch two', systemPrompt: 'Do work', task: 'Investigate two' }],
          },
        });

        yield {
          text: '',
          isComplete: true,
          metadata: {
            promptTokenCount: 2,
            candidatesTokenCount: 1,
            provider: 'gemini',
            model: 'gemini-2.5-flash',
            toolRoundCount: 2,
            repeatedRecoverableErrors: [],
            finishReason: 'complete',
          },
        };
      }),
    };

    mockRunSubagentBatch
      .mockImplementationOnce(async (_tasks, _env, callbacks) => {
        callbacks?.onActivity?.({
          batchId: 'batch-1',
          runs: [
            {
              id: 'run-1',
              batchId: 'batch-1',
              name: 'Batch one',
              task: 'Investigate one',
              status: 'complete',
              output: 'Result one',
              toolSequence: ['searchKnowledgeBase'],
              durationMs: 10,
            },
          ],
        });
        return {
          ok: true,
          batchId: 'batch-1',
          results: [
            {
              name: 'Batch one',
              status: 'complete',
              output: 'Result one',
              toolSequence: ['searchKnowledgeBase'],
            },
          ],
          usageTotals: {
            inputTokens: 3,
            outputTokens: 2,
            totalTokens: 5,
          },
        };
      })
      .mockImplementationOnce(async (_tasks, _env, callbacks) => {
        callbacks?.onActivity?.({
          batchId: 'batch-2',
          runs: [
            {
              id: 'run-2',
              batchId: 'batch-2',
              name: 'Batch two',
              task: 'Investigate two',
              status: 'complete',
              output: 'Result two',
              toolSequence: ['readFile'],
              durationMs: 11,
            },
          ],
        });
        return {
          ok: true,
          batchId: 'batch-2',
          results: [
            {
              name: 'Batch two',
              status: 'complete',
              output: 'Result two',
              toolSequence: ['readFile'],
            },
          ],
          usageTotals: {
            inputTokens: 7,
            outputTokens: 5,
            totalTokens: 12,
          },
        };
      });

    mockGetActiveProvider.mockReturnValue(provider);
    const { streamChat } = await import('./llmService');
    const onComplete = vi.fn();

    await streamChat({
      htmlProjectEnabled: true,
      systemPrompt: 'You are helpful.',
      history: [],
      message: 'parallel research twice please',
      assistantId: 'assistant-1',
      knowledgeChunks: [],
      subagentDelegationEnabled: true,
      onChunk: vi.fn(),
      onComplete,
    });

    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        subagentRuns: [
          expect.objectContaining({ id: 'run-1', batchId: 'batch-1' }),
          expect.objectContaining({ id: 'run-2', batchId: 'batch-2' }),
        ],
        subagentUsageTotals: {
          inputTokens: 10,
          outputTokens: 7,
          totalTokens: 17,
        },
      }),
      '',
    );
  });
});
