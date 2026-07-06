import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockInitializeProviders,
  mockGetActiveProvider,
  mockBuildKnowledgeSearchResponse,
  mockHasKnowledgeChunks,
  mockExecuteHtmlProjectToolCall,
  mockAssertProjectOwnership,
  mockReadFile,
  mockBuildHtmlProjectSystemPrompt,
} = vi.hoisted(() => ({
  mockInitializeProviders: vi.fn(),
  mockGetActiveProvider: vi.fn(),
  mockBuildKnowledgeSearchResponse: vi.fn(),
  mockHasKnowledgeChunks: vi.fn(),
  mockExecuteHtmlProjectToolCall: vi.fn(),
  mockAssertProjectOwnership: vi.fn(),
  mockReadFile: vi.fn(),
  mockBuildHtmlProjectSystemPrompt: vi.fn(),
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

vi.mock('./htmlProjectStore', () => ({
  htmlProjectStore: {
    assertProjectOwnership: mockAssertProjectOwnership,
    readFile: mockReadFile,
  },
}));

vi.mock('./htmlProjectPrompting', () => ({
  buildHtmlProjectSystemPrompt: mockBuildHtmlProjectSystemPrompt,
}));

describe('subagentService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInitializeProviders.mockResolvedValue(undefined);
    mockGetActiveProvider.mockReturnValue(null);
    mockBuildKnowledgeSearchResponse.mockReturnValue({ matches: [] });
    mockHasKnowledgeChunks.mockReturnValue(false);
    mockExecuteHtmlProjectToolCall.mockResolvedValue({
      workspace: {
        activeProjectId: 'project-1',
        activityMessage: 'updated project',
        preview: null,
      },
      result: { ok: true },
      summary: 'updated project',
    });
    mockAssertProjectOwnership.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue(null);
    mockBuildHtmlProjectSystemPrompt.mockReturnValue('HTML project prompt');
  });

  describe('validateSubagentBatch', () => {
    it('rejects bootstrap packs for subagents', async () => {
      const { validateSubagentBatch } = await import('./subagentService');

      const result = validateSubagentBatch(
        [
          {
            name: 'Bootstrap task',
            systemPrompt: 'Do work',
            task: 'Inspect the project',
            htmlPacks: ['bootstrap'],
          },
        ],
        { activeProjectId: 'project-1' },
      );

      expect(result).toMatchObject({
        code: 'subagent-bootstrap-forbidden',
        message: 'Subagents cannot use the bootstrap HTML pack.',
        details: {
          taskName: 'Bootstrap task',
          htmlPacks: ['bootstrap'],
        },
      });
    });

    it('rejects batches with multiple HTML writer tasks', async () => {
      const { validateSubagentBatch } = await import('./subagentService');

      const result = validateSubagentBatch(
        [
          {
            name: 'Writer one',
            systemPrompt: 'Do work',
            task: 'Edit the markup',
            htmlPacks: ['edit'],
          },
          {
            name: 'Writer two',
            systemPrompt: 'Do work',
            task: 'Recheck preview and finalize todos',
            htmlPacks: ['preview_recheck'],
          },
        ],
        { activeProjectId: 'project-1' },
      );

      expect(result).toMatchObject({
        code: 'subagent-multiple-writers',
        details: {
          writerTaskCount: 2,
          writePackNames: ['edit', 'todo_finalize', 'preview_recheck'],
        },
      });
    });

    it('requires an active project before injecting project files', async () => {
      const { validateSubagentBatch } = await import('./subagentService');

      const result = validateSubagentBatch(
        [
          {
            name: 'Context task',
            systemPrompt: 'Do work',
            task: 'Inspect app shell',
            includeProjectFiles: ['/src/App.tsx'],
          },
        ],
        { activeProjectId: null },
      );

      expect(result).toMatchObject({
        code: 'subagent-project-files-requires-active-project',
        details: {
          taskName: 'Context task',
          requestedFiles: ['/src/App.tsx'],
        },
      });
    });

    it('rejects empty batches and batches larger than 4 tasks', async () => {
      const { validateSubagentBatch } = await import('./subagentService');

      expect(validateSubagentBatch([], { activeProjectId: 'project-1' })).toMatchObject({
        code: 'subagent-batch-empty',
      });

      expect(
        validateSubagentBatch(
          Array.from({ length: 5 }, (_, index) => ({
            name: `Task ${index + 1}`,
            systemPrompt: 'Do work',
            task: 'Inspect',
          })),
          { activeProjectId: 'project-1' },
        ),
      ).toMatchObject({
        code: 'subagent-batch-too-large',
        details: { requestedTaskCount: 5 },
      });
    });

    it('normalizes subagent maxToolRounds to the 1-20 range with default 8', async () => {
      const { runSubagentBatch } = await import('./subagentService');
      const observedChatParams: Array<Record<string, unknown>> = [];

      mockGetActiveProvider.mockReturnValue({
        isAvailable: () => true,
        streamChat: vi.fn(async function* (params) {
          observedChatParams.push(params as Record<string, unknown>);
          yield {
            text: '',
            isComplete: true,
            metadata: {
              usage: {
                source: 'api',
                inputTokens: 1,
                outputTokens: 1,
                totalTokens: 2,
              },
            },
          };
        }),
      });

      await runSubagentBatch(
        [
          {
            name: 'Default rounds',
            systemPrompt: 'Do work',
            task: 'Inspect',
          },
          {
            name: 'High rounds',
            systemPrompt: 'Do work',
            task: 'Inspect',
            maxToolRounds: 999,
          },
        ],
        {
          assistantId: 'assistant-1',
          sessionId: 'session-1',
          activeProjectId: null,
          history: [],
        },
      );

      expect(observedChatParams[0]?.maxToolRounds).toBe(8);
      expect(observedChatParams[1]?.maxToolRounds).toBe(20);
    });
  });

  describe('buildSubagentMessage', () => {
    it('omits synthetic messages from injected history', async () => {
      const { buildSubagentMessage } = await import('./subagentService');

      const message = await buildSubagentMessage(
        {
          name: 'History task',
          systemPrompt: 'Do work',
          task: 'Summarize the conversation',
          includeHistoryLastN: 3,
        },
        {
          assistantId: 'assistant-1',
          activeProjectId: null,
          history: [
            { role: 'user', content: 'First real question' },
            { role: 'model', content: 'Synthetic bridge reply', synthetic: true },
            { role: 'user', content: 'Latest real question' },
            { role: 'model', content: 'Latest real answer' },
          ],
        },
      );

      expect(message).toContain('# Recent conversation history');
      expect(message).toContain('1. [user] First real question');
      expect(message).toContain('2. [user] Latest real question');
      expect(message).toContain('3. [model] Latest real answer');
      expect(message).not.toContain('Synthetic bridge reply');
    });

    it('injects requested project files and marks truncated file context', async () => {
      const { buildSubagentMessage } = await import('./subagentService');
      mockReadFile.mockResolvedValue({
        path: '/src/app.ts',
        kind: 'js',
        content: 'a'.repeat(30_000),
      });

      const message = await buildSubagentMessage(
        {
          name: 'File task',
          systemPrompt: 'Do work',
          task: 'Inspect project file',
          includeProjectFiles: ['/src/app.ts'],
        },
        {
          assistantId: 'assistant-1',
          activeProjectId: 'project-1',
          history: [],
        },
      );

      expect(mockAssertProjectOwnership).toHaveBeenCalledWith('project-1', 'assistant-1');
      expect(message).toContain('# Project files');
      expect(message).toContain('## /src/app.ts');
      expect(message).toContain('[truncated to fit context window]');
    });
  });

  describe('buildSubagentTools', () => {
    it('excludes delegate and harness-only tools from subagent visibility', async () => {
      const { buildSubagentTools, SUBAGENT_DELEGATE_TOOL_NAME } = await import('./subagentService');

      const result = buildSubagentTools(
        {
          name: 'Inspect and edit',
          systemPrompt: 'Do work',
          task: 'Read and update files',
          htmlPacks: ['inspect', 'edit', 'todo_finalize', 'preview_recheck'],
        },
        {
          assistantId: 'assistant-1',
          sessionId: 'session-1',
          activeProjectId: 'project-1',
          knowledgeChunks: [],
        },
      );

      const names = result.tools.map(tool => tool.name);

      expect(names).toContain('readFile');
      expect(names).toContain('writeFiles');
      expect(names).not.toContain(SUBAGENT_DELEGATE_TOOL_NAME);
      expect(names).not.toContain('reportTurnOutcome');
      expect(names).not.toContain('getPreviewRuntimeErrors');
      expect(names).not.toContain('listSnapshots');
      expect(names).not.toContain('revertToSnapshot');
    });
  });

  describe('runSubagentBatch', () => {
    it('flags and annotates truncated subagent output', async () => {
      const { runSubagentBatch } = await import('./subagentService');
      const longOutput = 'x'.repeat(8100);

      mockGetActiveProvider.mockReturnValue({
        isAvailable: () => true,
        streamChat: vi.fn(async function* () {
          yield { text: longOutput };
          yield {
            isComplete: true,
            metadata: {
              usage: {
                source: 'api',
                inputTokens: 5,
                outputTokens: 9,
                totalTokens: 14,
              },
            },
          };
        }),
      });

      const result = await runSubagentBatch(
        [
          {
            name: 'Long task',
            systemPrompt: 'Do work',
            task: 'Return a very long answer',
          },
        ],
        {
          assistantId: 'assistant-1',
          sessionId: 'session-1',
          activeProjectId: null,
          history: [],
        },
      );

      expect(result).toMatchObject({
        ok: true,
        results: [
          {
            name: 'Long task',
            status: 'complete',
            truncated: true,
            toolSequence: [],
          },
        ],
        usageTotals: {
          inputTokens: 5,
          outputTokens: 9,
          totalTokens: 14,
        },
      });
      expect(result.ok && result.results[0]?.output).toContain('[truncated after 8000 characters]');
    });

    it('marks unfinished tasks as aborted when the parent signal is aborted', async () => {
      const { runSubagentBatch } = await import('./subagentService');
      const controller = new AbortController();
      controller.abort();

      mockGetActiveProvider.mockReturnValue({
        isAvailable: () => true,
        streamChat: vi.fn(async function* () {
          yield {
            text: '',
            isComplete: true,
            metadata: {
              usage: {
                source: 'api',
                inputTokens: 1,
                outputTokens: 1,
                totalTokens: 2,
              },
            },
          };
        }),
      });

      const result = await runSubagentBatch(
        [
          {
            name: 'Aborted task',
            systemPrompt: 'Do work',
            task: 'Inspect',
          },
        ],
        {
          assistantId: 'assistant-1',
          sessionId: 'session-1',
          activeProjectId: null,
          history: [],
          signal: controller.signal,
        },
      );

      expect(result).toMatchObject({
        ok: true,
        results: [
          {
            name: 'Aborted task',
            status: 'aborted',
          },
        ],
      });
    });

    it('aggregates usage totals across multiple successful subagent runs', async () => {
      const { runSubagentBatch } = await import('./subagentService');

      mockGetActiveProvider.mockReturnValue({
        isAvailable: () => true,
        streamChat: vi.fn(async function* (params) {
          const usage = params.message.includes('One')
            ? {
                source: 'api' as const,
                inputTokens: 1,
                outputTokens: 2,
                totalTokens: 3,
              }
            : {
                source: 'api' as const,
                inputTokens: 2,
                outputTokens: 3,
                totalTokens: 5,
              };
          yield {
            text: params.message.includes('One') ? 'run-1' : 'run-2',
          };
          yield {
            isComplete: true,
            metadata: {
              usage,
            },
          };
        }),
      });

      const result = await runSubagentBatch(
        [
          {
            name: 'One',
            systemPrompt: 'Do work',
            task: 'Inspect One',
          },
          {
            name: 'Two',
            systemPrompt: 'Do work',
            task: 'Inspect Two',
          },
        ],
        {
          assistantId: 'assistant-1',
          sessionId: 'session-1',
          activeProjectId: null,
          history: [],
        },
      );

      expect(result).toMatchObject({
        ok: true,
        usageTotals: {
          inputTokens: 3,
          outputTokens: 5,
          totalTokens: 8,
        },
      });
    });

    it('starts sibling subagent tasks in parallel instead of waiting sequentially', async () => {
      const { runSubagentBatch } = await import('./subagentService');
      const order: string[] = [];
      let releaseSlowTask: (() => void) | null = null;

      mockGetActiveProvider.mockReturnValue({
        isAvailable: () => true,
        streamChat: vi.fn(async function* (params) {
          if (params.message.includes('Slow task')) {
            order.push('slow-start');
            await new Promise<void>(resolve => {
              releaseSlowTask = resolve;
            });
            order.push('slow-finish');
          } else {
            order.push('fast-start');
            releaseSlowTask?.();
            order.push('fast-finish');
          }

          yield { text: 'done' };
          yield {
            isComplete: true,
            metadata: {
              usage: {
                source: 'api',
                inputTokens: 1,
                outputTokens: 1,
                totalTokens: 2,
              },
            },
          };
        }),
      });

      const result = await runSubagentBatch(
        [
          {
            name: 'Slow',
            systemPrompt: 'Do work',
            task: 'Slow task',
          },
          {
            name: 'Fast',
            systemPrompt: 'Do work',
            task: 'Fast task',
          },
        ],
        {
          assistantId: 'assistant-1',
          sessionId: 'session-1',
          activeProjectId: null,
          history: [],
        },
      );

      expect(result).toMatchObject({ ok: true });
      expect(order.indexOf('slow-start')).toBeGreaterThanOrEqual(0);
      expect(order.indexOf('fast-start')).toBeGreaterThan(order.indexOf('slow-start'));
      expect(order.indexOf('fast-start')).toBeLessThan(order.indexOf('slow-finish'));
    });
  });
});
