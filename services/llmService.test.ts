import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockInitializeProviders,
  mockGetActiveProvider,
  mockHasKnowledgeChunks,
  mockBuildKnowledgeSearchResponse,
  mockExecuteHtmlProjectToolCall,
  mockRecordHtmlProjectTelemetryEvent,
  mockRunSubagentBatch,
  mockExecuteCompute,
  mockExecuteDrawGeometry,
  mockNormalizeGeometryDoc,
} = vi.hoisted(() => ({
  mockInitializeProviders: vi.fn(),
  mockGetActiveProvider: vi.fn(),
  mockHasKnowledgeChunks: vi.fn(),
  mockBuildKnowledgeSearchResponse: vi.fn(),
  mockExecuteHtmlProjectToolCall: vi.fn(),
  mockRecordHtmlProjectTelemetryEvent: vi.fn(),
  mockRunSubagentBatch: vi.fn(),
  mockExecuteCompute: vi.fn(),
  mockExecuteDrawGeometry: vi.fn(),
  mockNormalizeGeometryDoc: vi.fn(),
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

vi.mock('./mathComputeService', () => ({
  executeCompute: mockExecuteCompute,
  MATH_COMPUTE_TOOL_NAME: 'compute',
  MATH_COMPUTE_TOOL_DESCRIPTION: 'Evaluate a mathematical expression.',
  MATH_COMPUTE_TOOL_SCHEMA: {
    type: 'object',
    properties: { expr: { type: 'string' } },
    required: ['expr'],
  },
  MATH_TOOLS_SYSTEM_PROMPT: 'Math tools prompt',
}));

vi.mock('./markdownPrompting', () => ({
  MARKDOWN_MATH_SYSTEM_PROMPT: 'Markdown math prompt',
}));

vi.mock('./geometryToolService', () => ({
  executeDrawGeometry: mockExecuteDrawGeometry,
  normalizeGeometryDoc: mockNormalizeGeometryDoc,
  DRAW_GEOMETRY_TOOL_NAME: 'draw_geometry',
  DRAW_GEOMETRY_TOOL_DESCRIPTION: 'Draw a geometry diagram.',
  DRAW_GEOMETRY_TOOL_SCHEMA: {
    type: 'object',
    properties: { title: { type: 'string' } },
    required: ['title'],
  },
}));

describe('streamChat', () => {
  beforeEach(() => {
    mockHasKnowledgeChunks.mockReturnValue(false);

    vi.resetModules();
    vi.clearAllMocks();
    mockExecuteCompute.mockReset();
    mockExecuteDrawGeometry.mockReset();
    mockNormalizeGeometryDoc.mockReset();
    mockNormalizeGeometryDoc.mockImplementation(document => document);
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

  it('adds the KaTeX prompt before optional feature prompts when mathToolsEnabled is disabled', async () => {
    const observedChatParams: Array<Record<string, unknown>> = [];
    const provider = {
      name: 'gemini',
      displayName: 'Gemini',
      supportedModels: ['gemini-2.5-flash'],
      isAvailable: () => true,
      streamChat: vi.fn(async function* (params) {
        observedChatParams.push(params as Record<string, unknown>);
        yield {
          text: '',
          isComplete: true,
          metadata: {
            promptTokenCount: 0,
            candidatesTokenCount: 0,
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
      systemPrompt: 'You are helpful.',
      history: [],
      message: 'Calculate 1 + 1.',
      assistantId: 'assistant-1',
      mathToolsEnabled: false,
      onChunk: vi.fn(),
      onComplete: vi.fn(),
    });

    const systemPrompt = String(observedChatParams[0]?.systemPrompt);
    expect(observedChatParams[0]?.tools).toBeUndefined();
    expect(systemPrompt).toContain('You are helpful.');
    expect(systemPrompt).toContain('Markdown math prompt');
    expect(systemPrompt).not.toContain('Math tools prompt');
    expect(systemPrompt.indexOf('You are helpful.')).toBeLessThan(
      systemPrompt.indexOf('Markdown math prompt'),
    );
    expect(mockExecuteCompute).not.toHaveBeenCalled();
    expect(mockExecuteDrawGeometry).not.toHaveBeenCalled();
  });

  it('forwards provider-generated images to live callbacks and completion metadata', async () => {
    const image = { url: 'data:image/png;base64,ZmFrZQ==', mimeType: 'image/png', index: 0 };
    const provider = {
      name: 'openai',
      displayName: 'OpenAI',
      supportedModels: ['image-model'],
      isAvailable: () => true,
      streamChat: vi.fn(async function* () {
        yield { text: '', isComplete: false, images: [image] };
        yield {
          text: '',
          isComplete: true,
          metadata: {
            promptTokenCount: 1,
            candidatesTokenCount: 2,
            provider: 'openai',
            model: 'image-model',
            images: [image],
          },
        };
      }),
    };
    mockGetActiveProvider.mockReturnValue(provider);
    const onImages = vi.fn();
    const onComplete = vi.fn();

    const { streamChat } = await import('./llmService');
    await streamChat({
      systemPrompt: 'You are helpful.',
      history: [],
      message: 'create an image',
      assistantId: 'assistant-1',
      onChunk: vi.fn(),
      onImages,
      onComplete,
    });

    expect(onImages).toHaveBeenCalledWith([image]);
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ images: [image] }), '');
  });

  it('keeps the KaTeX prompt before math-tool guidance when mathToolsEnabled is enabled', async () => {
    const observedChatParams: Array<Record<string, unknown>> = [];
    mockExecuteCompute.mockResolvedValue({
      ok: true,
      result: '4',
      summary: 'Computed 4',
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
        const result = await executeTool({ name: 'compute', args: { expr: '2 + 2' } });
        expect(result).toEqual({ ok: true, result: '4', summary: 'Computed 4' });
        yield {
          text: '',
          isComplete: true,
          metadata: {
            promptTokenCount: 0,
            candidatesTokenCount: 0,
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
      systemPrompt: 'You are helpful.',
      history: [],
      message: 'Calculate 2 + 2.',
      assistantId: 'assistant-1',
      mathToolsEnabled: true,
      onChunk: vi.fn(),
      onComplete: vi.fn(),
    });

    const systemPrompt = String(observedChatParams[0]?.systemPrompt);
    const katexIndex = systemPrompt.indexOf('Markdown math prompt');
    const mathToolsIndex = systemPrompt.indexOf('Math tools prompt');
    const toolNames = (observedChatParams[0]?.tools as Array<{ name: string }>).map(
      tool => tool.name,
    );
    expect(toolNames).toEqual(expect.arrayContaining(['compute', 'draw_geometry']));
    expect(systemPrompt).toContain('You are helpful.');
    expect(systemPrompt).toContain('Markdown math prompt');
    expect(systemPrompt).toContain('Math tools prompt');
    expect(systemPrompt.indexOf('You are helpful.')).toBeLessThan(katexIndex);
    expect(katexIndex).toBeLessThan(mathToolsIndex);
    expect(mockExecuteCompute).toHaveBeenCalledWith({ expr: '2 + 2' });
  });

  it('hides HTML project tools and bootstrap when math tools are enabled', async () => {
    // Arrange
    const observedChatParams: Array<Record<string, unknown>> = [];
    const provider = {
      name: 'gemini',
      displayName: 'Gemini',
      supportedModels: ['gemini-2.5-flash'],
      isAvailable: () => true,
      streamChat: vi.fn(async function* (params) {
        observedChatParams.push(params as Record<string, unknown>);
        yield {
          text: '',
          isComplete: true,
          metadata: {
            promptTokenCount: 0,
            candidatesTokenCount: 0,
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

    // Act
    await streamChat({
      systemPrompt: 'You are helpful.',
      history: [],
      message: 'Update the active project and draw a triangle.',
      assistantId: 'assistant-1',
      activeProjectId: 'project-123',
      mathToolsEnabled: true,
      htmlProjectEnabled: true,
      projectBootstrapEnabled: true,
      onChunk: vi.fn(),
      onComplete: vi.fn(),
    });

    // Assert
    expect(
      (observedChatParams[0]?.tools as Array<{ name: string }>).map(tool => tool.name),
    ).toEqual(['compute', 'draw_geometry']);
    expect(observedChatParams[0]?.toolChoice).toBeUndefined();
    expect(mockExecuteHtmlProjectToolCall).not.toHaveBeenCalled();
  });

  it('injects speech tools and hides HTML project tools when web speech tools are enabled', async () => {
    const observedChatParams: Array<Record<string, unknown>> = [];
    const onSpeechUtterancePreview = vi.fn();
    const onComplete = vi.fn();
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
        await executeTool({
          name: 'speak_text',
          args: {
            text: 'Good morning',
            language: 'en-US',
            title: 'Greeting practice',
            rate: 0.85,
          },
        });
        yield {
          text: '',
          isComplete: true,
          metadata: {
            promptTokenCount: 0,
            candidatesTokenCount: 0,
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
      systemPrompt: 'You are helpful.',
      history: [],
      message: 'Help me pronounce Good morning.',
      assistantId: 'assistant-1',
      activeProjectId: 'project-123',
      webSpeechToolsEnabled: true,
      htmlProjectEnabled: true,
      projectBootstrapEnabled: true,
      onChunk: vi.fn(),
      onSpeechUtterancePreview,
      onComplete,
    });

    expect(
      (observedChatParams[0]?.tools as Array<{ name: string }>).map(tool => tool.name),
    ).toEqual(['speak_text']);
    expect(mockExecuteHtmlProjectToolCall).not.toHaveBeenCalled();
    expect(onSpeechUtterancePreview).toHaveBeenCalledWith({
      toolCallId: expect.stringMatching(/^speak_text-1-\d+$/),
      document: expect.objectContaining({
        text: 'Good morning',
        language: 'en-US',
        title: 'Greeting practice',
        rate: 0.85,
        pitch: 1,
      }),
    });
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        speechUtterances: [
          expect.objectContaining({
            text: 'Good morning',
            language: 'en-US',
          }),
        ],
      }),
      '',
    );
  });

  it('previews a normalized geometry document before draw completion and persists it', async () => {
    // Arrange
    const geometryDocument = {
      title: 'Triangle ABC',
      boundingbox: [-5, 5, 5, -5],
      objects: [],
    };
    const normalizedGeometryDocument = {
      ...geometryDocument,
      title: 'Normalized triangle ABC',
    };
    const callOrder: string[] = [];
    const onGeometryBoardPreview = vi.fn(() => {
      callOrder.push('preview');
    });
    mockNormalizeGeometryDoc.mockReturnValue(normalizedGeometryDocument);
    mockExecuteDrawGeometry.mockImplementation(async document => {
      callOrder.push('execute');
      expect(onGeometryBoardPreview).toHaveBeenCalledWith({
        toolCallId: expect.stringMatching(/^draw_geometry-1-\d+$/),
        document: normalizedGeometryDocument,
      });
      expect(document).toBe(normalizedGeometryDocument);
      return {
        ok: true,
        errors: [],
        warnings: [],
        computed_points: [{ id: 'A', x: 0, y: 0 }],
        summary: 'Geometry drawn successfully.',
      };
    });
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
        await executeTool({ name: 'draw_geometry', args: geometryDocument });
        yield {
          text: '',
          isComplete: true,
          metadata: {
            promptTokenCount: 0,
            candidatesTokenCount: 0,
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
    const onComplete = vi.fn();

    // Act
    await streamChat({
      systemPrompt: 'You are helpful.',
      history: [],
      message: 'Draw triangle ABC.',
      assistantId: 'assistant-1',
      mathToolsEnabled: true,
      onChunk: vi.fn(),
      onGeometryBoardPreview,
      onComplete,
    });

    // Assert
    expect(callOrder).toEqual(['preview', 'execute']);
    expect(mockExecuteDrawGeometry).toHaveBeenCalledWith(normalizedGeometryDocument);
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        geometryBoards: [
          expect.objectContaining({
            document: normalizedGeometryDocument,
            result: expect.objectContaining({
              ok: true,
              computed_points: [{ id: 'A', x: 0, y: 0 }],
            }),
          }),
        ],
      }),
      '',
    );
  });

  it('keeps math tools available to shared-session calls when enabled', async () => {
    mockExecuteCompute.mockResolvedValue({
      ok: true,
      result: '9',
      summary: 'Computed 9',
    });
    const provider = {
      name: 'gemini',
      displayName: 'Gemini',
      supportedModels: ['gemini-2.5-flash'],
      isAvailable: () => true,
      streamChat: vi.fn(async function* (params) {
        const toolNames = (params.tools as Array<{ name: string }>).map(tool => tool.name);
        expect(toolNames).toEqual(expect.arrayContaining(['compute', 'draw_geometry']));
        const executeTool = params.executeTool as (call: {
          name: string;
          args: Record<string, unknown>;
        }) => Promise<unknown>;
        await executeTool({ name: 'compute', args: { expr: '3 * 3' } });
        yield {
          text: '',
          isComplete: true,
          metadata: {
            promptTokenCount: 0,
            candidatesTokenCount: 0,
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
      systemPrompt: 'You are helpful.',
      history: [],
      message: 'Calculate 3 * 3.',
      assistantId: 'shared-assistant-1',
      sessionId: 'shared-session-1',
      mathToolsEnabled: true,
      onChunk: vi.fn(),
      onComplete: vi.fn(),
    });

    expect(mockExecuteCompute).toHaveBeenCalledWith({ expr: '3 * 3' });
  });

  it('stops compute after 20 recoverable failures', async () => {
    mockExecuteCompute.mockResolvedValue({
      ok: false,
      recoverable: true,
      code: 'compute-evaluation-failed',
      error: 'invalid expression',
      summary: 'invalid expression',
    });
    const provider = {
      name: 'gemini',
      displayName: 'Gemini',
      supportedModels: ['gemini-2.5-flash'],
      isAvailable: () => true,
      streamChat: vi.fn(async function* (params) {
        const executeTool = params.executeTool as (call: {
          name: string;
          args: Record<string, unknown>;
        }) => Promise<Record<string, unknown>>;
        const results = await Promise.all(
          Array.from({ length: 21 }, () => executeTool({ name: 'compute', args: { expr: 'bad' } })),
        );
        expect(results.slice(0, 20)).toEqual(
          expect.arrayContaining([expect.objectContaining({ recoverable: true })]),
        );
        expect(results[20]).toMatchObject({
          recoverable: false,
          code: 'compute-failure-limit-reached',
        });
        yield {
          text: '',
          isComplete: true,
          metadata: {
            promptTokenCount: 0,
            candidatesTokenCount: 0,
            provider: 'gemini',
            model: 'gemini-2.5-flash',
            toolRoundCount: 21,
            repeatedRecoverableErrors: [],
          },
        };
      }),
    };
    mockGetActiveProvider.mockReturnValue(provider);

    const { streamChat } = await import('./llmService');
    await streamChat({
      systemPrompt: 'You are helpful.',
      history: [],
      message: 'Compute.',
      assistantId: 'assistant-1',
      mathToolsEnabled: true,
      onChunk: vi.fn(),
      onComplete: vi.fn(),
    });

    expect(mockExecuteCompute).toHaveBeenCalledTimes(21);
  });

  it('stops draw_geometry after 6 recoverable failures', async () => {
    const geometryDocument = {
      title: 'Broken geometry',
      boundingbox: [-5, 5, 5, -5],
      objects: [],
    };
    mockExecuteDrawGeometry.mockResolvedValue({
      ok: false,
      recoverable: true,
      code: 'geometry-validation-failed',
      errors: [],
      warnings: [],
      computed_points: [],
      summary: 'Invalid geometry.',
    });
    const provider = {
      name: 'gemini',
      displayName: 'Gemini',
      supportedModels: ['gemini-2.5-flash'],
      isAvailable: () => true,
      streamChat: vi.fn(async function* (params) {
        const executeTool = params.executeTool as (call: {
          name: string;
          args: Record<string, unknown>;
        }) => Promise<Record<string, unknown>>;
        const results = await Promise.all(
          Array.from({ length: 7 }, () =>
            executeTool({ name: 'draw_geometry', args: geometryDocument }),
          ),
        );
        expect(results.slice(0, 6)).toEqual(
          expect.arrayContaining([expect.objectContaining({ recoverable: true })]),
        );
        expect(results[6]).toMatchObject({
          recoverable: false,
          code: 'draw-geometry-failure-limit-reached',
        });
        yield {
          text: '',
          isComplete: true,
          metadata: {
            promptTokenCount: 0,
            candidatesTokenCount: 0,
            provider: 'gemini',
            model: 'gemini-2.5-flash',
            toolRoundCount: 7,
            repeatedRecoverableErrors: [],
          },
        };
      }),
    };
    mockGetActiveProvider.mockReturnValue(provider);

    const { streamChat } = await import('./llmService');
    await streamChat({
      systemPrompt: 'You are helpful.',
      history: [],
      message: 'Draw geometry.',
      assistantId: 'assistant-1',
      mathToolsEnabled: true,
      onChunk: vi.fn(),
      onComplete: vi.fn(),
    });

    expect(mockExecuteDrawGeometry).toHaveBeenCalledTimes(7);
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
    expect(observedChatParams[0]?.tools).toHaveLength(31);
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
        expect.objectContaining({ name: 'gitStatus' }),
        expect.objectContaining({ name: 'gitLog' }),
        expect.objectContaining({ name: 'gitDiff' }),
        expect.objectContaining({ name: 'gitCommit' }),
        expect.objectContaining({ name: 'gitListBranches' }),
        expect.objectContaining({ name: 'gitSwitchBranch' }),
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

  describe('assistant routing (routeToAssistant)', () => {
    const routableTargets = [
      { id: 'assistant-math', name: 'Math Tutor', description: 'Solves advanced math problems' },
      { id: 'assistant-eng', name: 'English Coach', description: 'Improves English writing' },
    ];

    const buildRoutingProvider = (
      observedChatParams: Array<Record<string, unknown>>,
      onExecuteTool?: (
        executeTool: (call: { name: string; args: Record<string, unknown> }) => Promise<unknown>,
      ) => Promise<void>,
    ) => ({
      name: 'gemini',
      displayName: 'Gemini',
      supportedModels: ['gemini-2.5-flash'],
      isAvailable: () => true,
      streamChat: vi.fn(async function* (params: Record<string, unknown>) {
        observedChatParams.push(params);
        if (onExecuteTool) {
          const executeTool = params.executeTool as (call: {
            name: string;
            args: Record<string, unknown>;
          }) => Promise<unknown>;
          await onExecuteTool(executeTool);
        }
        yield {
          text: 'routing turn done',
          isComplete: false,
        };
        yield {
          text: '',
          isComplete: true,
          metadata: {
            promptTokenCount: 3,
            candidatesTokenCount: 1,
            provider: 'gemini',
            model: 'gemini-2.5-flash',
            toolRoundCount: onExecuteTool ? 1 : 0,
            repeatedRecoverableErrors: [],
          },
        };
      }),
    });

    it('hides the routeToAssistant tool and routing prompt when routableTargets is empty or omitted', async () => {
      const observedChatParams: Array<Record<string, unknown>> = [];
      const provider = buildRoutingProvider(observedChatParams);
      mockGetActiveProvider.mockReturnValue(provider);

      const { streamChat } = await import('./llmService');

      // Arrange/Act 1 — routableTargets omitted entirely.
      await streamChat({
        systemPrompt: 'You are helpful.',
        history: [],
        message: 'hello',
        assistantId: 'assistant-1',
        knowledgeChunks: [],
        onChunk: vi.fn(),
        onComplete: vi.fn(),
      });

      // Act 2 — routableTargets explicitly empty.
      await streamChat({
        systemPrompt: 'You are helpful.',
        history: [],
        message: 'hello again',
        assistantId: 'assistant-1',
        routableTargets: [],
        knowledgeChunks: [],
        onChunk: vi.fn(),
        onComplete: vi.fn(),
      });

      // Assert — no tools at all (routing was the only candidate tool) and
      // the system prompt carries no routing guidance.
      expect(observedChatParams).toHaveLength(2);
      for (const params of observedChatParams) {
        expect(params.tools).toBeUndefined();
        expect(params.systemPrompt).toContain('You are helpful.');
        expect(params.systemPrompt).toContain('Markdown math prompt');
        expect(params.systemPrompt as string).not.toContain('routeToAssistant');
      }
    });

    it('exposes routeToAssistant with a whitelist-only enum and emits a pending proposal on a valid call', async () => {
      const observedChatParams: Array<Record<string, unknown>> = [];
      const provider = buildRoutingProvider(observedChatParams, async executeTool => {
        const result = await executeTool({
          name: 'routeToAssistant',
          args: {
            targetAssistantId: 'assistant-math',
            reason: 'Question needs calculus expertise',
            handoffSummary: 'User asked to integrate x^2 sin(x); no attempts yet.',
          },
        });

        // Tool result is ok and instructs the model to wrap up without switching.
        expect(result).toMatchObject({
          ok: true,
          summary:
            'Routing proposal shown to the user. Finish your response without switching assistants.',
        });
      });
      mockGetActiveProvider.mockReturnValue(provider);

      const { streamChat } = await import('./llmService');
      const onRouteProposal = vi.fn();
      const onComplete = vi.fn();

      await streamChat({
        systemPrompt: 'You are helpful.',
        history: [],
        message: 'Can you integrate x^2 sin(x)?',
        assistantId: 'assistant-1',
        sessionId: 'session-1',
        routableTargets,
        knowledgeChunks: [],
        onRouteProposal,
        onChunk: vi.fn(),
        onComplete,
      });

      // Tool list contains routeToAssistant whose enum is exactly the whitelist ids.
      const tools = observedChatParams[0]?.tools as Array<{
        name: string;
        parameters: { properties: { targetAssistantId: { enum: string[] } } };
      }>;
      const routeTool = tools.find(tool => tool.name === 'routeToAssistant');
      expect(routeTool).toBeDefined();
      expect(routeTool?.parameters.properties.targetAssistantId.enum).toEqual([
        'assistant-math',
        'assistant-eng',
      ]);

      // Routing guidance is appended to the system prompt (targets non-empty).
      const systemPrompt = observedChatParams[0]?.systemPrompt as string;
      expect(systemPrompt).toContain('You are helpful.');
      expect(systemPrompt).toContain('routeToAssistant');
      expect(systemPrompt).toContain('Math Tutor (Solves advanced math problems)');
      expect(systemPrompt).toContain('English Coach (Improves English writing)');

      // onRouteProposal received a single pending proposal with full metadata.
      expect(onRouteProposal).toHaveBeenCalledTimes(1);
      expect(onRouteProposal).toHaveBeenCalledWith(
        expect.objectContaining({
          targetAssistantId: 'assistant-math',
          targetAssistantName: 'Math Tutor',
          reason: 'Question needs calculus expertise',
          handoffSummary: 'User asked to integrate x^2 sin(x); no attempts yet.',
          sourceAssistantId: 'assistant-1',
          sourceSessionId: 'session-1',
          status: 'pending',
          createdAt: expect.any(Number),
        }),
      );

      // The stream still completes normally after the proposal.
      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it('returns a recoverable route-already-proposed error on a second routing call in the same run', async () => {
      const observedChatParams: Array<Record<string, unknown>> = [];
      const provider = buildRoutingProvider(observedChatParams, async executeTool => {
        const firstResult = await executeTool({
          name: 'routeToAssistant',
          args: {
            targetAssistantId: 'assistant-math',
            reason: 'Math expertise required',
            handoffSummary: 'User wants a calculus walkthrough.',
          },
        });
        expect(firstResult).toMatchObject({ ok: true });

        const secondResult = await executeTool({
          name: 'routeToAssistant',
          args: {
            targetAssistantId: 'assistant-eng',
            reason: 'Also needs writing help',
            handoffSummary: 'User wants essay feedback too.',
          },
        });
        expect(secondResult).toMatchObject({
          ok: false,
          recoverable: true,
          code: 'route-already-proposed',
          guidance: 'Finish the response without proposing another route.',
        });
      });
      mockGetActiveProvider.mockReturnValue(provider);

      const { streamChat } = await import('./llmService');
      const onRouteProposal = vi.fn();
      const onComplete = vi.fn();
      const onToolCallActivity = vi.fn();

      await streamChat({
        systemPrompt: 'You are helpful.',
        history: [],
        message: 'Route me twice please',
        assistantId: 'assistant-1',
        sessionId: 'session-1',
        routableTargets,
        knowledgeChunks: [],
        onRouteProposal,
        onToolCallActivity,
        onChunk: vi.fn(),
        onComplete,
      });

      // Only the FIRST call produced a proposal.
      expect(onRouteProposal).toHaveBeenCalledTimes(1);
      expect(onRouteProposal).toHaveBeenCalledWith(
        expect.objectContaining({ targetAssistantId: 'assistant-math', status: 'pending' }),
      );

      // The second call surfaced as a recoverable tool error, not a crash.
      expect(onToolCallActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'routeToAssistant',
          status: 'recoverable_error',
          code: 'route-already-proposed',
        }),
      );

      // Stream completes normally.
      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(onComplete).toHaveBeenCalledWith(expect.anything(), 'routing turn done');
    });

    it('rejects a non-whitelisted target with a recoverable error and never emits a proposal', async () => {
      const observedChatParams: Array<Record<string, unknown>> = [];
      const provider = buildRoutingProvider(observedChatParams, async executeTool => {
        const result = await executeTool({
          name: 'routeToAssistant',
          args: {
            targetAssistantId: 'assistant-not-in-whitelist',
            reason: 'Trying to escape the whitelist',
            handoffSummary: 'Should be rejected.',
          },
        });

        expect(result).toMatchObject({
          ok: false,
          recoverable: true,
          code: 'route-target-not-allowed',
        });
      });
      mockGetActiveProvider.mockReturnValue(provider);

      const { streamChat } = await import('./llmService');
      const onRouteProposal = vi.fn();
      const onComplete = vi.fn();

      await streamChat({
        systemPrompt: 'You are helpful.',
        history: [],
        message: 'Route me somewhere weird',
        assistantId: 'assistant-1',
        sessionId: 'session-1',
        routableTargets,
        knowledgeChunks: [],
        onRouteProposal,
        onChunk: vi.fn(),
        onComplete,
      });

      // No proposal callback and the stream still finished cleanly.
      expect(onRouteProposal).not.toHaveBeenCalled();
      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(onComplete).toHaveBeenCalledWith(expect.anything(), 'routing turn done');
    });
  });

  describe('project bootstrap (createProject without an active project)', () => {
    const buildProvider = (body: (params: Record<string, unknown>) => Promise<void> | void) => ({
      name: 'gemini',
      displayName: 'Gemini',
      supportedModels: ['gemini-2.5-flash'],
      isAvailable: () => true,
      streamChat: vi.fn(async function* (params) {
        await body(params as Record<string, unknown>);
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
    });

    it('exposes only createProject with no forced choice in bootstrap mode without an active project', async () => {
      const observedChatParams: Array<Record<string, unknown>> = [];
      mockGetActiveProvider.mockReturnValue({
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
              promptTokenCount: 3,
              candidatesTokenCount: 1,
              provider: 'gemini',
              model: 'gemini-2.5-flash',
              toolRoundCount: 0,
              repeatedRecoverableErrors: [],
            },
          };
        }),
      });

      const { streamChat } = await import('./llmService');

      await streamChat({
        // htmlProjectEnabled intentionally omitted → false; projectBootstrapEnabled opt-in.
        projectBootstrapEnabled: true,
        systemPrompt: 'You are helpful.',
        history: [],
        message: 'explain quantum mechanics',
        assistantId: 'assistant-1',
        knowledgeChunks: [],
        onChunk: vi.fn(),
        onComplete: vi.fn(),
        onProjectToolActivity: vi.fn(),
      });

      expect(mockExecuteHtmlProjectToolCall).not.toHaveBeenCalled();
      const tools = observedChatParams[0]?.tools as Array<{ name: string }>;
      expect(tools).toHaveLength(1);
      expect(tools[0]).toMatchObject({ name: 'createProject' });
      expect(observedChatParams[0]?.toolChoice).toBeUndefined();
      expect(String(observedChatParams[0]?.systemPrompt)).toContain('[PROJECT BOOTSTRAP]');
    });

    it('executes createProject in bootstrap mode and reports the new activeProjectId via onComplete', async () => {
      mockGetActiveProvider.mockReturnValue(
        buildProvider(async params => {
          const executeTool = params.executeTool as (call: {
            name: string;
            args: Record<string, unknown>;
          }) => Promise<unknown>;
          const result = await executeTool({
            name: 'createProject',
            args: { name: 'Demo' },
          });
          expect(result).toMatchObject({
            projectId: 'project-123',
            summary: 'updated project',
          });
        }),
      );

      const { streamChat } = await import('./llmService');
      const onProjectToolActivity = vi.fn();
      const onComplete = vi.fn();

      await streamChat({
        projectBootstrapEnabled: true,
        systemPrompt: 'You are helpful.',
        history: [],
        message: 'build me a landing page',
        assistantId: 'assistant-1',
        knowledgeChunks: [],
        onChunk: vi.fn(),
        onComplete,
        onProjectToolActivity,
      });

      expect(mockExecuteHtmlProjectToolCall).toHaveBeenCalledWith(
        { name: 'createProject', args: { name: 'Demo' } },
        {
          assistantId: 'assistant-1',
          sessionId: undefined,
          activeProjectId: null,
        },
      );
      expect(onProjectToolActivity).toHaveBeenCalledTimes(1);
      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({ activeProjectId: 'project-123' }),
        expect.anything(),
      );
      expect(mockRecordHtmlProjectTelemetryEvent).toHaveBeenCalledTimes(1);
    });

    it('returns a recoverable error when createProject is called again after a project already exists', async () => {
      mockGetActiveProvider.mockReturnValue(
        buildProvider(async params => {
          const executeTool = params.executeTool as (call: {
            name: string;
            args: Record<string, unknown>;
          }) => Promise<unknown>;
          await executeTool({ name: 'createProject', args: { name: 'Demo' } });
          const second = await executeTool({
            name: 'createProject',
            args: { name: 'Other' },
          });
          expect(second).toMatchObject({
            ok: false,
            recoverable: true,
            code: 'project-already-active',
          });
        }),
      );

      const { streamChat } = await import('./llmService');

      await streamChat({
        projectBootstrapEnabled: true,
        systemPrompt: 'You are helpful.',
        history: [],
        message: 'build me a landing page',
        assistantId: 'assistant-1',
        knowledgeChunks: [],
        onChunk: vi.fn(),
        onComplete: vi.fn(),
        onProjectToolActivity: vi.fn(),
      });

      // Second createProject is blocked by the guard — store is only hit once.
      expect(mockExecuteHtmlProjectToolCall).toHaveBeenCalledTimes(1);
    });
  });
});
