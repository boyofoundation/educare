import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentRunCheckpoint } from '../types';

const {
  mockStreamChat,
  mockExecuteHtmlProjectToolCall,
  mockCreateSnapshot,
  mockWaitForRuntimeDiagnostics,
  mockBuildSyntheticMessage,
  mockSaveCheckpoint,
  mockUpdateCheckpoint,
  mockGatherKnowledge,
} = vi.hoisted(() => ({
  mockStreamChat: vi.fn(),
  mockExecuteHtmlProjectToolCall: vi.fn(),
  mockCreateSnapshot: vi.fn(),
  mockWaitForRuntimeDiagnostics: vi.fn(),
  mockBuildSyntheticMessage: vi.fn(),
  mockSaveCheckpoint: vi.fn().mockResolvedValue(undefined),
  mockUpdateCheckpoint: vi.fn().mockResolvedValue(null),
  mockGatherKnowledge: vi.fn().mockResolvedValue(null),
}));

vi.mock('./llmService', () => ({
  streamChat: mockStreamChat,
  getProjectSummaryFromToolResult: (value: unknown) => {
    if (!value || typeof value !== 'object') {
      return null;
    }
    const record = value as { projectSummary?: unknown };
    if (!record.projectSummary || typeof record.projectSummary !== 'object') {
      return null;
    }
    return record.projectSummary;
  },
}));

vi.mock('./htmlProjectToolService', () => ({
  executeHtmlProjectToolCall: mockExecuteHtmlProjectToolCall,
}));

vi.mock('./htmlProjectStore', () => ({
  htmlProjectStore: {
    createSnapshot: mockCreateSnapshot,
    createRunStartSnapshot: mockCreateSnapshot,
    listSnapshots: vi.fn(),
    revertToSnapshot: vi.fn(),
  },
}));

vi.mock('./previewRuntimeDiagnostics', () => ({
  previewRuntimeDiagnostics: {
    waitForRuntimeDiagnostics: mockWaitForRuntimeDiagnostics,
    clear: vi.fn(),
    markNotExecuted: vi.fn(),
    recordReadyAck: vi.fn(),
    recordRuntimeErrors: vi.fn(),
  },
}));

vi.mock('./conversationUtils', async importOriginal => {
  const actual = await importOriginal<typeof import('./conversationUtils')>();
  return {
    ...actual,
    buildSyntheticMessage: mockBuildSyntheticMessage,
  };
});

vi.mock('./agentRunCheckpointService', () => ({
  saveCheckpoint: mockSaveCheckpoint,
  updateCheckpoint: mockUpdateCheckpoint,
}));

vi.mock('./knowledgeGatherService', () => ({
  gatherKnowledge: mockGatherKnowledge,
}));

import { AgentRunController, CONTINUATION_PROMPT } from './agentRunController';

const baseProjectSummary = {
  projectId: 'project-1',
  name: 'Demo',
  entryFile: '/index.html',
  previewVersion: 1,
  previewReady: true,
  files: [],
  fileCount: 0,
  todoSummary: {
    projectId: 'project-1',
    total: 2,
    pending: 1,
    inProgress: 0,
    completed: 1,
    allComplete: false,
  },
  warnings: [],
  previewDiagnostics: {
    category: 'none' as const,
    outcome: 'ready' as const,
    repairable: false,
    summary: 'ok',
  },
  suggestedNextActionCategory: 'resume_todos' as const,
};

const completeProjectSummary = {
  ...baseProjectSummary,
  todoSummary: {
    projectId: 'project-1',
    total: 2,
    pending: 0,
    inProgress: 0,
    completed: 2,
    allComplete: true,
  },
};

const buildStreamChatInvocation = (
  overrides: Partial<{
    finishReason: string;
    text: string;
    toolSequence: string[];
    projectSummary: typeof baseProjectSummary | null;
    selectedPackSet: string[];
    promptTokenCount: number;
    candidatesTokenCount: number;
    subagentRuns: Array<Record<string, unknown>>;
    subagentUsageTotals: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    };
  }> = {},
) => ({
  finishReason: overrides.finishReason ?? 'complete',
  text: overrides.text ?? 'turn-text',
  toolSequence: overrides.toolSequence ?? [],
  projectSummary: overrides.projectSummary ?? null,
  selectedPackSet: overrides.selectedPackSet ?? ['inspect'],
  promptTokenCount: overrides.promptTokenCount ?? 10,
  candidatesTokenCount: overrides.candidatesTokenCount ?? 5,
  subagentRuns: overrides.subagentRuns,
  subagentUsageTotals: overrides.subagentUsageTotals,
});

const installStreamChatTurns = (
  turns: Array<ReturnType<typeof buildStreamChatInvocation>>,
): Array<{ params: Record<string, unknown>; completeCb: (text: string) => void }> => {
  const invocations: Array<{
    params: Record<string, unknown>;
    completeCb: (text: string) => void;
  }> = [];

  mockStreamChat.mockImplementation(async (params: Record<string, unknown>) => {
    const turnIndex = invocations.length;
    const turn = turns[turnIndex] ?? buildStreamChatInvocation();

    const captured: {
      params: Record<string, unknown>;
      completeCb: (text: string) => void;
    } = { params, completeCb: () => {} };
    invocations.push(captured);

    captured.completeCb = (text: string) => {
      (params.onComplete as (meta: unknown, fullText: string) => void)(
        {
          promptTokenCount: turn.promptTokenCount,
          candidatesTokenCount: turn.candidatesTokenCount,
          provider: 'gemini',
          model: 'gemini-2.5-flash',
          finishReason: turn.finishReason,
          projectSummary: turn.projectSummary,
          toolSequence: turn.toolSequence,
          selectedPackSet: turn.selectedPackSet,
          subagentRuns: turn.subagentRuns,
          subagentUsageTotals: turn.subagentUsageTotals,
        },
        text,
      );
    };

    if (typeof params.onChunk === 'function') {
      (params.onChunk as (chunk: string) => void)(turn.text);
    }
    captured.completeCb(turn.text);
  });

  return invocations;
};

const buildCheckpoint = (overrides: Partial<AgentRunCheckpoint> = {}): AgentRunCheckpoint => ({
  schemaVersion: 1,
  runId: overrides.runId ?? 'run-resume-1',
  sessionId: overrides.sessionId ?? 'session-1',
  assistantId: overrides.assistantId ?? 'assistant-1',
  projectId: overrides.projectId ?? 'project-1',
  status: overrides.status ?? 'running',
  turnIndex: overrides.turnIndex ?? 1,
  maxTurns: overrides.maxTurns ?? 3,
  originalMessage: overrides.originalMessage ?? 'kick off',
  committedHistoryDelta: overrides.committedHistoryDelta ?? [
    {
      role: 'model',
      content: 'existing model turn',
      agentTurnLog: 'tools: inspect',
    },
  ],
  subagentDelegationEnabled: overrides.subagentDelegationEnabled ?? true,
  partialText: overrides.partialText ?? 'partial from interrupted turn',
  toolTrace: overrides.toolTrace ?? ['inspect'],
  todoSummary: overrides.todoSummary ?? baseProjectSummary.todoSummary,
  snapshotVersion: overrides.snapshotVersion ?? 7,
  firstTurnPackSet: overrides.firstTurnPackSet ?? ['inspect', 'todo_finalize'],
  gatheredContext: overrides.gatheredContext,
  tokenTotals: overrides.tokenTotals ?? {
    promptTokenCount: 20,
    candidatesTokenCount: 8,
  },
  agentHarnessEnabled: overrides.agentHarnessEnabled ?? true,
  sharedMode: overrides.sharedMode ?? false,
  createdAt: overrides.createdAt ?? 1_720_000_000_000,
  updatedAt: overrides.updatedAt ?? 1_720_000_000_000,
  heartbeatAt: overrides.heartbeatAt ?? 1_720_000_000_000,
});

const buildOptions = (
  overrides: Partial<ConstructorParameters<typeof AgentRunController>[0]> = {},
) => ({
  assistantId: 'assistant-1',
  sessionId: 'session-1',
  activeProjectId: 'project-1',
  systemPrompt: 'system',
  history: [],
  message: 'kick off',
  agentHarnessEnabled: true,
  callbacks: {
    onChunk: vi.fn(),
    onProjectToolActivity: vi.fn(),
    onSubagentActivity: vi.fn(),
    onTurnStart: vi.fn(),
    onTurnComplete: vi.fn(),
    onStateChange: vi.fn(),
    onError: vi.fn(),
  },
  ...overrides,
});

describe('AgentRunController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateSnapshot.mockResolvedValue({ projectId: 'project-1', version: 7 });
    mockWaitForRuntimeDiagnostics.mockResolvedValue({
      projectId: 'project-1',
      previewVersion: 1,
      status: 'clean',
      errors: [],
      readyAckReceived: true,
      waitedForReadyAck: false,
      waitMs: 0,
    });
    mockExecuteHtmlProjectToolCall.mockResolvedValue({
      workspace: { activeProjectId: 'project-1', activityMessage: 'ok', preview: null },
      result: { projectSummary: completeProjectSummary },
      summary: 'summary',
    });
    mockGatherKnowledge.mockResolvedValue(null);
    mockBuildSyntheticMessage.mockImplementation(
      (role: 'user' | 'model', content: string, agentTurnLog?: string) => ({
        role,
        content,
        synthetic: true,
        agentTurnLog: agentTurnLog ?? 'continuation prompt',
      }),
    );
  });

  it('AC#1 checkpoint: saves the initial running payload before the first LLM call', async () => {
    mockStreamChat.mockImplementationOnce(async (params: Record<string, unknown>) => {
      expect(mockSaveCheckpoint).toHaveBeenCalledTimes(1);
      (params.onComplete as (meta: unknown, fullText: string) => void)(
        {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          provider: 'gemini',
          model: 'gemini-2.5-flash',
          finishReason: 'complete',
          projectSummary: completeProjectSummary,
          toolSequence: ['reportTurnOutcome'],
          selectedPackSet: ['inspect'],
        },
        'turn-text',
      );
    });

    const opts = buildOptions();
    const controller = new AgentRunController(opts);
    const runId = controller.getState().runId;

    await controller.run();

    expect(mockSaveCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        schemaVersion: 1,
        runId,
        sessionId: 'session-1',
        assistantId: 'assistant-1',
        projectId: 'project-1',
        status: 'running',
        turnIndex: 0,
        maxTurns: 5,
        originalMessage: 'kick off',
        committedHistoryDelta: [],
        partialText: undefined,
        toolTrace: [],
        tokenTotals: {
          promptTokenCount: 0,
          candidatesTokenCount: 0,
        },
        agentHarnessEnabled: true,
        sharedMode: false,
      }),
    );
  });

  it('AC#2/AC#3 checkpoint: flushes streaming progress and committed turn state updates', async () => {
    installStreamChatTurns([
      buildStreamChatInvocation({
        finishReason: 'tool-budget-exhausted',
        text: 'first-turn-output',
        toolSequence: ['readFile'],
        projectSummary: baseProjectSummary,
        promptTokenCount: 10,
        candidatesTokenCount: 5,
      }),
      buildStreamChatInvocation({
        finishReason: 'complete',
        text: 'second-turn-output',
        toolSequence: ['reportTurnOutcome'],
        projectSummary: completeProjectSummary,
        promptTokenCount: 4,
        candidatesTokenCount: 2,
      }),
    ]);

    const opts = buildOptions({ maxTurns: 2 });
    const controller = new AgentRunController(opts);
    const runId = controller.getState().runId;

    await controller.run();

    expect(mockUpdateCheckpoint).toHaveBeenNthCalledWith(
      1,
      runId,
      expect.objectContaining({
        status: 'running',
        turnIndex: 0,
        partialText: 'first-turn-output',
        committedHistoryDelta: [],
        toolTrace: [],
        tokenTotals: {
          promptTokenCount: 0,
          candidatesTokenCount: 0,
        },
      }),
    );

    expect(mockUpdateCheckpoint).toHaveBeenNthCalledWith(
      2,
      runId,
      expect.objectContaining({
        status: 'running',
        turnIndex: 1,
        partialText: undefined,
        committedHistoryDelta: [
          expect.objectContaining({
            role: 'model',
            content: 'first-turn-output',
          }),
        ],
        toolTrace: ['readFile'],
        firstTurnPackSet: ['inspect'],
        tokenTotals: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
        },
      }),
    );
  });

  it('AC#3 checkpoint: emits fallback heartbeat updates when no chunks arrive', async () => {
    vi.useFakeTimers();

    let completeTurn: (() => void) | undefined;
    mockStreamChat.mockImplementationOnce(
      async (params: Record<string, unknown>) =>
        new Promise<void>(resolve => {
          completeTurn = () => {
            (params.onComplete as (meta: unknown, fullText: string) => void)(
              {
                promptTokenCount: 10,
                candidatesTokenCount: 5,
                provider: 'gemini',
                model: 'gemini-2.5-flash',
                finishReason: 'complete',
                projectSummary: completeProjectSummary,
                toolSequence: ['reportTurnOutcome'],
                selectedPackSet: ['inspect'],
              },
              'turn-without-chunks',
            );
            resolve();
          };
        }),
    );

    const opts = buildOptions();
    const controller = new AgentRunController(opts);
    const runId = controller.getState().runId;
    const runPromise = controller.run();

    await vi.advanceTimersByTimeAsync(5_000);

    expect(mockUpdateCheckpoint).toHaveBeenCalledWith(
      runId,
      expect.objectContaining({
        status: 'running',
        turnIndex: 0,
        partialText: undefined,
        committedHistoryDelta: [],
        toolTrace: [],
        tokenTotals: {
          promptTokenCount: 0,
          candidatesTokenCount: 0,
        },
      }),
    );

    completeTurn?.();
    await runPromise;
    vi.useRealTimers();
  });

  it('AC#8 true-complete: terminates "complete" when G4 verify passes', async () => {
    installStreamChatTurns([
      buildStreamChatInvocation({
        finishReason: 'complete',
        toolSequence: ['reportTurnOutcome'],
        projectSummary: completeProjectSummary,
      }),
    ]);

    const opts = buildOptions();
    const controller = new AgentRunController(opts);
    const result = await controller.run();

    expect(result.state.status).toBe('complete');
    expect(result.state.finishReason).toBe('complete');
    expect(mockStreamChat).toHaveBeenCalledTimes(1);
    expect(mockExecuteHtmlProjectToolCall).toHaveBeenCalledWith(
      { name: 'getProjectSummary', args: { projectId: 'project-1' } },
      expect.objectContaining({ activeProjectId: 'project-1' }),
    );
    expect(mockUpdateCheckpoint).toHaveBeenLastCalledWith(
      controller.getState().runId,
      expect.objectContaining({
        status: 'complete',
        turnIndex: 0,
        tokenTotals: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
        },
      }),
    );
    expect(opts.callbacks.onTurnComplete).toHaveBeenCalledTimes(1);
  });

  it('AC#8 false-complete: continues when reportTurnOutcome says complete but todos remain', async () => {
    installStreamChatTurns([
      buildStreamChatInvocation({
        finishReason: 'complete',
        toolSequence: ['reportTurnOutcome'],
        projectSummary: baseProjectSummary,
      }),
      buildStreamChatInvocation({
        finishReason: 'complete',
        toolSequence: ['reportTurnOutcome'],
        projectSummary: completeProjectSummary,
      }),
    ]);

    mockExecuteHtmlProjectToolCall
      .mockResolvedValueOnce({
        workspace: { activeProjectId: 'project-1', activityMessage: 'ok', preview: null },
        result: { projectSummary: baseProjectSummary },
        summary: 'summary',
      })
      .mockResolvedValue({
        workspace: { activeProjectId: 'project-1', activityMessage: 'ok', preview: null },
        result: { projectSummary: completeProjectSummary },
        summary: 'summary',
      });

    const opts = buildOptions();
    const controller = new AgentRunController(opts);
    const result = await controller.run();

    expect(mockStreamChat).toHaveBeenCalledTimes(2);
    expect(result.state.status).toBe('complete');
    expect(result.state.turnIndex).toBe(1);
    expect(result.state.autoContinued).toBe(true);
  });

  it('AC#8 premise: no-project harness runs until budget because there is no early terminal branch', async () => {
    installStreamChatTurns([
      buildStreamChatInvocation({
        finishReason: 'complete',
        toolSequence: ['reportTurnOutcome'],
        projectSummary: null,
      }),
      buildStreamChatInvocation({
        finishReason: 'complete',
        toolSequence: ['reportTurnOutcome'],
        projectSummary: null,
      }),
    ]);

    const opts = buildOptions({ activeProjectId: null, maxTurns: 2 });
    const controller = new AgentRunController(opts);
    const result = await controller.run();

    expect(mockStreamChat).toHaveBeenCalledTimes(2);
    expect(mockExecuteHtmlProjectToolCall).not.toHaveBeenCalled();
    expect(mockSaveCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: null,
        originalMessage: 'kick off',
      }),
    );
    expect(result.state.status).toBe('complete');
    expect(result.state.turnIndex).toBe(2);
  });

  it('AC#7 loop detection: 2 consecutive turns with identical last-4 tools + 0 todo delta → failed', async () => {
    installStreamChatTurns([
      buildStreamChatInvocation({
        finishReason: 'tool-budget-exhausted',
        toolSequence: ['readFile', 'writeFiles', 'renderPreview', 'getProjectSummary'],
        projectSummary: baseProjectSummary,
      }),
      buildStreamChatInvocation({
        finishReason: 'tool-budget-exhausted',
        toolSequence: ['readFile', 'writeFiles', 'renderPreview', 'getProjectSummary'],
        projectSummary: baseProjectSummary,
      }),
    ]);

    const opts = buildOptions();
    const controller = new AgentRunController(opts);
    const result = await controller.run();

    expect(result.state.status).toBe('failed');
    expect(result.state.finishReason).toBe('stop-route');
    expect(result.state.loopDetected).toBe(true);
    expect(mockStreamChat).toHaveBeenCalledTimes(2);
  });

  it('does not treat delegate-only repeated last-4 traces as a loop failure', async () => {
    installStreamChatTurns([
      buildStreamChatInvocation({
        finishReason: 'tool-budget-exhausted',
        toolSequence: [
          'delegateToSubagents',
          'delegateToSubagents',
          'delegateToSubagents',
          'delegateToSubagents',
        ],
        projectSummary: null,
      }),
      buildStreamChatInvocation({
        finishReason: 'tool-budget-exhausted',
        toolSequence: [
          'delegateToSubagents',
          'delegateToSubagents',
          'delegateToSubagents',
          'delegateToSubagents',
        ],
        projectSummary: null,
      }),
    ]);

    const controller = new AgentRunController(
      buildOptions({
        activeProjectId: null,
        maxTurns: 2,
      }),
    );
    const result = await controller.run();

    expect(result.state.status).toBe('complete');
    expect(result.state.loopDetected).toBeUndefined();
    expect(mockStreamChat).toHaveBeenCalledTimes(2);
  });

  it('Budget: reaches maxTurns and terminates as complete at run level', async () => {
    installStreamChatTurns([
      buildStreamChatInvocation({
        finishReason: 'tool-budget-exhausted',
        toolSequence: ['readFile'],
        projectSummary: baseProjectSummary,
      }),
      buildStreamChatInvocation({
        finishReason: 'tool-budget-exhausted',
        toolSequence: ['readFile', 'writeFiles'],
        projectSummary: baseProjectSummary,
      }),
    ]);

    const opts = buildOptions({ maxTurns: 2 });
    const controller = new AgentRunController(opts);
    const result = await controller.run();

    expect(mockStreamChat).toHaveBeenCalledTimes(2);
    expect(result.state.status).toBe('complete');
    expect(result.state.turnIndex).toBe(2);
  });

  it('AC#4 abort: stop() mid-run → status "stopped", finishReason "aborted", no half-turn write', async () => {
    installStreamChatTurns([
      buildStreamChatInvocation({
        finishReason: 'tool-budget-exhausted',
        toolSequence: ['readFile'],
        projectSummary: baseProjectSummary,
      }),
    ]);

    const opts = buildOptions();
    const onStateChange = vi.fn();
    opts.callbacks.onStateChange = onStateChange;

    const controller = new AgentRunController(opts);

    opts.callbacks.onTurnComplete = vi.fn(() => {
      controller.stop('user-stop');
    });

    await controller.run();

    expect(controller.getState().status).toBe('stopped');
    expect(controller.getState().finishReason).toBe('aborted');
    expect(controller.getState().abortReason).toBe('user-stop');
    expect(mockStreamChat).toHaveBeenCalledTimes(1);
    expect(opts.callbacks.onTurnComplete).toHaveBeenCalledTimes(1);
    expect(opts.callbacks.onTurnComplete).toHaveBeenCalledWith(
      0,
      expect.objectContaining({ finishReason: 'tool-budget-exhausted' }),
    );
    expect(mockUpdateCheckpoint).toHaveBeenLastCalledWith(
      controller.getState().runId,
      expect.objectContaining({ status: 'stopped' }),
    );
    expect(mockBuildSyntheticMessage).not.toHaveBeenCalled();
  });

  it('live tool-trace: emits state.toolTrace mid-turn when a tool starts running (before onComplete)', async () => {
    const opts = buildOptions({ maxTurns: 1 });
    const onStateChange = vi.fn();
    opts.callbacks.onStateChange = onStateChange;

    mockStreamChat.mockImplementationOnce(async (params: Record<string, unknown>) => {
      const onToolCallActivity = params.onToolCallActivity as
        | ((record: { id: string; name: string; status: string }) => void)
        | undefined;
      const onComplete = params.onComplete as (meta: unknown, fullText: string) => void;

      // 模擬 function-call loop:工具首次 'running' 時 controller 應即時 emit
      // 含該工具的 toolTrace,而不必等到 onComplete (loop 期間 UI 即時連動)。
      onToolCallActivity?.({ id: 'writeFiles-1-1', name: 'writeFiles', status: 'running' });
      onToolCallActivity?.({ id: 'writeFiles-1-1', name: 'writeFiles', status: 'ok' });

      expect(onStateChange).toHaveBeenCalledWith(
        expect.objectContaining({ toolTrace: expect.arrayContaining(['writeFiles']) }),
      );

      onComplete(
        {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          provider: 'gemini',
          model: 'gemini-2.5-flash',
          finishReason: 'tool-budget-exhausted',
          projectSummary: baseProjectSummary,
          toolSequence: ['writeFiles'],
          selectedPackSet: ['edit'],
        },
        'done',
      );
    });

    const controller = new AgentRunController(opts);
    await controller.run();

    // 回合結束後 toolTrace 仍應保留 writeFiles (回合邊界權威校正不會丟失即時累積)
    expect(controller.getState().toolTrace).toEqual(expect.arrayContaining(['writeFiles']));
    expect(mockStreamChat).toHaveBeenCalledTimes(1);
  });

  it('checkpoint: marks failed status when streamChat throws', async () => {
    mockStreamChat.mockRejectedValueOnce(new Error('stream failed'));

    const opts = buildOptions();
    const controller = new AgentRunController(opts);

    await controller.run();

    expect(controller.getState().status).toBe('failed');
    expect(mockUpdateCheckpoint).toHaveBeenLastCalledWith(
      controller.getState().runId,
      expect.objectContaining({ status: 'failed' }),
    );
    expect(opts.callbacks.onError).toHaveBeenCalledWith(expect.any(Error));
  });

  it('AC#6 packSetOverride: turnIndex>0 calls streamChat with packSetOverride (bypass)', async () => {
    installStreamChatTurns([
      buildStreamChatInvocation({
        finishReason: 'tool-budget-exhausted',
        toolSequence: ['readFile'],
        projectSummary: baseProjectSummary,
        selectedPackSet: ['inspect', 'todo_finalize', 'preview_recheck'],
      }),
      buildStreamChatInvocation({
        finishReason: 'complete',
        toolSequence: ['reportTurnOutcome'],
        projectSummary: completeProjectSummary,
      }),
    ]);

    const opts = buildOptions();
    const controller = new AgentRunController(opts);
    await controller.run();

    const turn0Params = mockStreamChat.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(turn0Params?.packSetOverride).toBeUndefined();
    const turn1Params = mockStreamChat.mock.calls[1]?.[0] as Record<string, unknown>;
    expect(turn1Params?.packSetOverride).toEqual(['inspect', 'todo_finalize', 'preview_recheck']);
  });

  it('resumeFrom: preserves checkpoint state, carries token totals, and reuses the first-turn pack set', async () => {
    installStreamChatTurns([
      buildStreamChatInvocation({
        finishReason: 'complete',
        text: 'resumed-turn-output',
        toolSequence: ['reportTurnOutcome'],
        projectSummary: completeProjectSummary,
        selectedPackSet: ['should-not-be-used'],
        promptTokenCount: 7,
        candidatesTokenCount: 3,
      }),
    ]);

    const resumeFrom = buildCheckpoint();
    const opts = buildOptions({
      resumeFrom,
      maxTurns: 99,
      history: [{ role: 'user', content: 'existing session message' }],
    });
    const controller = new AgentRunController(opts);

    expect(controller.getState()).toEqual(
      expect.objectContaining({
        runId: resumeFrom.runId,
        projectId: 'project-1',
        sessionId: 'session-1',
        assistantId: 'assistant-1',
        turnIndex: 1,
        maxTurns: 3,
        snapshotVersion: 7,
        todoSummary: baseProjectSummary.todoSummary,
        autoContinued: true,
        toolTrace: ['inspect'],
        startedAt: resumeFrom.createdAt,
      }),
    );

    const result = await controller.run();

    expect(mockCreateSnapshot).not.toHaveBeenCalled();
    expect(mockSaveCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: resumeFrom.runId,
        committedHistoryDelta: resumeFrom.committedHistoryDelta,
        partialText: resumeFrom.partialText,
        firstTurnPackSet: resumeFrom.firstTurnPackSet,
        tokenTotals: resumeFrom.tokenTotals,
        createdAt: resumeFrom.createdAt,
      }),
    );
    const resumedTurnParams = mockStreamChat.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(resumedTurnParams?.packSetOverride).toEqual(['inspect', 'todo_finalize']);
    expect(mockBuildSyntheticMessage).toHaveBeenCalledWith(
      'user',
      CONTINUATION_PROMPT,
      'continuation prompt',
    );
    expect(mockUpdateCheckpoint).toHaveBeenLastCalledWith(
      resumeFrom.runId,
      expect.objectContaining({
        status: 'complete',
        committedHistoryDelta: expect.arrayContaining([
          expect.objectContaining({ content: 'existing model turn' }),
          expect.objectContaining({ content: CONTINUATION_PROMPT }),
          expect.objectContaining({ content: 'resumed-turn-output' }),
        ]),
        tokenTotals: {
          promptTokenCount: 27,
          candidatesTokenCount: 11,
        },
      }),
    );
    expect(result.tokenInfo).toEqual(
      expect.objectContaining({
        promptTokenCount: 27,
        candidatesTokenCount: 11,
      }),
    );
  });

  it('G9 feature flag: agentHarnessEnabled=false → exactly ONE streamChat call', async () => {
    installStreamChatTurns([
      buildStreamChatInvocation({
        finishReason: 'tool-budget-exhausted',
        toolSequence: ['readFile'],
        projectSummary: baseProjectSummary,
      }),
    ]);

    const opts = buildOptions({ agentHarnessEnabled: false });
    const controller = new AgentRunController(opts);
    const result = await controller.run();

    expect(mockStreamChat).toHaveBeenCalledTimes(1);
    expect(result.state.autoContinued).toBe(false);
    expect(result.state.status).toBe('complete');
  });

  it('G6 history threading: continuation turn injects a synthetic user message', async () => {
    installStreamChatTurns([
      buildStreamChatInvocation({
        finishReason: 'tool-budget-exhausted',
        toolSequence: ['readFile'],
        projectSummary: baseProjectSummary,
        selectedPackSet: ['inspect'],
      }),
      buildStreamChatInvocation({
        finishReason: 'complete',
        toolSequence: ['reportTurnOutcome'],
        projectSummary: completeProjectSummary,
      }),
    ]);

    const opts = buildOptions();
    const controller = new AgentRunController(opts);
    const result = await controller.run();

    expect(mockBuildSyntheticMessage).toHaveBeenCalledWith(
      'user',
      CONTINUATION_PROMPT,
      'continuation prompt',
    );
    const syntheticMessages = result.finalHistory.filter(m => m.synthetic === true);
    expect(syntheticMessages.length).toBeGreaterThanOrEqual(1);
    const syntheticIdx = result.finalHistory.findIndex(m => m.synthetic === true);
    const lastModelIdx = result.finalHistory
      .map((m, i) => (m.role === 'model' ? i : -1))
      .filter(i => i >= 0)
      .pop();
    expect(syntheticIdx).toBeLessThan(lastModelIdx ?? Number.POSITIVE_INFINITY);
  });

  it('runs gatherKnowledge before the first stream when knowledge chunks exist and returns citations', async () => {
    mockGatherKnowledge.mockResolvedValueOnce({
      ragContext: '[1] (員工手冊.pdf · 段落 1)\n特休假規定',
      citations: [
        {
          marker: 1,
          chunkId: '員工手冊.pdf#0',
          fileName: '員工手冊.pdf',
          chunkIndex: 0,
          excerpt: '特休假規定',
        },
      ],
    });
    const invocations = installStreamChatTurns([buildStreamChatInvocation({ text: 'done' })]);
    const controller = new AgentRunController(
      buildOptions({
        knowledgeChunks: [{ fileName: '員工手冊.pdf', content: '特休假規定' }],
        activeProjectId: null,
      }),
    );

    const result = await controller.run();

    expect(mockGatherKnowledge).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'kick off',
        knowledgeChunks: [{ fileName: '員工手冊.pdf', content: '特休假規定' }],
      }),
    );
    expect(invocations[0]?.params.ragContext).toBe('[1] (員工手冊.pdf · 段落 1)\n特休假規定');
    expect(result.citations).toEqual([
      {
        marker: 1,
        chunkId: '員工手冊.pdf#0',
        fileName: '員工手冊.pdf',
        chunkIndex: 0,
        excerpt: '特休假規定',
      },
    ]);
  });

  it('continues the run when gatherKnowledge rejects and leaves ragContext undefined', async () => {
    mockGatherKnowledge.mockRejectedValueOnce(new Error('gather failed'));
    const invocations = installStreamChatTurns([buildStreamChatInvocation({ text: 'done' })]);
    const controller = new AgentRunController(
      buildOptions({
        knowledgeChunks: [{ fileName: '員工手冊.pdf', content: '特休假規定' }],
        activeProjectId: null,
      }),
    );

    const result = await controller.run();

    expect(mockGatherKnowledge).toHaveBeenCalledTimes(1);
    expect(invocations[0]?.params.ragContext).toBeUndefined();
    expect(result.state.status).toBe('complete');
    expect(invocations).not.toHaveLength(0);
    expect(result.citations).toBeUndefined();
  });

  it('resumeFrom with gatheredContext reuses checkpoint ragContext without rerunning gatherKnowledge', async () => {
    const resumeFrom = buildCheckpoint({
      gatheredContext: {
        ragContext: '[1] (員工手冊.pdf · 段落 1)\n既有背景知識',
        citations: [
          {
            marker: 1,
            chunkId: '員工手冊.pdf#0',
            fileName: '員工手冊.pdf',
            chunkIndex: 0,
            excerpt: '既有背景知識',
          },
        ],
      },
      turnIndex: 0,
    });
    const invocations = installStreamChatTurns([buildStreamChatInvocation({ text: 'done' })]);
    const controller = new AgentRunController(
      buildOptions({
        resumeFrom,
        activeProjectId: null,
        knowledgeChunks: [{ fileName: '員工手冊.pdf', content: '特休假規定' }],
      }),
    );

    const result = await controller.run();

    expect(mockGatherKnowledge).not.toHaveBeenCalled();
    expect(invocations[0]?.params.ragContext).toBe('[1] (員工手冊.pdf · 段落 1)\n既有背景知識');
    expect(result.citations).toEqual([
      {
        marker: 1,
        chunkId: '員工手冊.pdf#0',
        fileName: '員工手冊.pdf',
        chunkIndex: 0,
        excerpt: '既有背景知識',
      },
    ]);
  });

  it('resumeFrom without gatheredContext reruns gatherKnowledge when resuming the first turn', async () => {
    mockGatherKnowledge.mockResolvedValueOnce({
      ragContext: '[1] (員工手冊.pdf · 段落 1)\n補跑背景知識',
      citations: [
        {
          marker: 1,
          chunkId: '員工手冊.pdf#0:5:特休假規定',
          fileName: '員工手冊.pdf',
          chunkIndex: 0,
          excerpt: '補跑背景知識',
        },
      ],
    });
    const resumeFrom = buildCheckpoint({
      turnIndex: 0,
    });
    const invocations = installStreamChatTurns([buildStreamChatInvocation({ text: 'done' })]);
    const controller = new AgentRunController(
      buildOptions({
        resumeFrom,
        activeProjectId: null,
        knowledgeChunks: [{ fileName: '員工手冊.pdf', content: '特休假規定' }],
      }),
    );

    const result = await controller.run();

    expect(mockGatherKnowledge).toHaveBeenCalledTimes(1);
    expect(invocations[0]?.params.ragContext).toBe('[1] (員工手冊.pdf · 段落 1)\n補跑背景知識');
    expect(result.citations).toEqual([
      {
        marker: 1,
        chunkId: '員工手冊.pdf#0:5:特休假規定',
        fileName: '員工手冊.pdf',
        chunkIndex: 0,
        excerpt: '補跑背景知識',
      },
    ]);
  });

  it('sharedMode: persists the shared flag in checkpoints and uses a default budget of 1', async () => {
    installStreamChatTurns([
      buildStreamChatInvocation({
        finishReason: 'tool-budget-exhausted',
        toolSequence: ['readFile'],
        projectSummary: baseProjectSummary,
      }),
    ]);

    const opts = buildOptions({ sharedMode: true });
    const controller = new AgentRunController(opts);
    const result = await controller.run();

    expect(mockSaveCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        sharedMode: true,
        maxTurns: 1,
      }),
    );
    expect(mockStreamChat).toHaveBeenCalledTimes(1);
    expect(result.state.maxTurns).toBe(1);
    expect(result.state.status).toBe('complete');
  });

  it('forces delegation off in shared mode and persists the effective checkpoint flag', async () => {
    const invocations = installStreamChatTurns([buildStreamChatInvocation()]);
    const controller = new AgentRunController(
      buildOptions({
        sharedMode: true,
        subagentDelegationEnabled: true,
      }),
    );

    await controller.run();

    expect(invocations[0]?.params.subagentDelegationEnabled).toBe(false);
    expect(mockSaveCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        subagentDelegationEnabled: false,
      }),
    );
    expect(mockUpdateCheckpoint).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        subagentDelegationEnabled: false,
      }),
    );
  });

  it('restores checkpoint delegation flag and persists subagent runs on committed messages', async () => {
    const subagentRuns = [
      {
        id: 'run-1',
        batchId: 'batch-1',
        name: 'Spec',
        task: 'Investigate',
        status: 'complete',
        output: 'delegated',
        toolSequence: ['searchKnowledgeBase'],
        durationMs: 12,
      },
    ];
    const resumeFrom = buildCheckpoint({
      subagentDelegationEnabled: true,
    });
    const invocations = installStreamChatTurns([
      buildStreamChatInvocation({
        finishReason: 'complete',
        projectSummary: completeProjectSummary,
        toolSequence: ['delegateToSubagents'],
        subagentRuns,
        subagentUsageTotals: {
          inputTokens: 3,
          outputTokens: 2,
          totalTokens: 5,
        },
      }),
    ]);

    const controller = new AgentRunController(
      buildOptions({
        resumeFrom,
        sharedMode: false,
        subagentDelegationEnabled: false,
      }),
    );

    const result = await controller.run();

    expect(invocations[0]?.params.subagentDelegationEnabled).toBe(true);
    expect(result.historyDelta.at(-1)).toEqual(
      expect.objectContaining({
        role: 'model',
        subagentRuns,
      }),
    );
    expect(result.tokenInfo.subagentUsageTotals).toEqual({
      inputTokens: 3,
      outputTokens: 2,
      totalTokens: 5,
    });
  });

  it('project bootstrap: createProject on turn 0 upgrades to full project mode on the next turn', async () => {
    const seenParams: Array<Record<string, unknown>> = [];
    let call = 0;
    mockStreamChat.mockImplementation(async (params: Record<string, unknown>) => {
      seenParams.push(params);
      call += 1;
      const onComplete = params.onComplete as (meta: unknown, fullText: string) => void;
      if (call === 1) {
        // Bootstrap turn: the model created a project (no project id existed before).
        onComplete(
          {
            promptTokenCount: 5,
            candidatesTokenCount: 2,
            finishReason: 'complete',
            toolSequence: ['createProject'],
            projectSummary: null,
            selectedPackSet: [],
            activeProjectId: 'proj-new',
          },
          'created project',
        );
      } else {
        // Upgraded turn: full project mode with an active project, reported complete.
        onComplete(
          {
            promptTokenCount: 3,
            candidatesTokenCount: 1,
            finishReason: 'complete',
            toolSequence: ['reportTurnOutcome'],
            projectSummary: completeProjectSummary,
            selectedPackSet: ['inspect'],
          },
          'done',
        );
      }
    });

    const controller = new AgentRunController(
      buildOptions({
        activeProjectId: null,
        agentHarnessEnabled: false,
        projectBootstrapEnabled: true,
      }),
    );
    const result = await controller.run();

    // Upgraded → ran a second turn under full project mode.
    expect(mockStreamChat).toHaveBeenCalledTimes(2);
    expect(seenParams[0]?.activeProjectId).toBeNull();
    expect(seenParams[0]?.projectBootstrapEnabled).toBe(true);
    expect(seenParams[0]?.htmlProjectEnabled).toBe(false);
    expect(seenParams[1]?.activeProjectId).toBe('proj-new');
    expect(seenParams[1]?.htmlProjectEnabled).toBe(true);
    expect(seenParams[1]?.projectBootstrapEnabled).toBe(false);
    expect(result.state.maxTurns).toBe(5);
    expect(result.state.projectId).toBe('proj-new');
    expect(result.state.status).toBe('complete');
  });

  it('project bootstrap: disabled in shared mode even when the flag is on', async () => {
    const seenParams: Array<Record<string, unknown>> = [];
    mockStreamChat.mockImplementation(async (params: Record<string, unknown>) => {
      seenParams.push(params);
      (params.onComplete as (meta: unknown, fullText: string) => void)(
        {
          promptTokenCount: 3,
          candidatesTokenCount: 1,
          finishReason: 'complete',
          toolSequence: [],
          projectSummary: null,
          selectedPackSet: [],
        },
        'done',
      );
    });

    const controller = new AgentRunController(
      buildOptions({
        sharedMode: true,
        activeProjectId: null,
        agentHarnessEnabled: false,
        projectBootstrapEnabled: true,
      }),
    );
    const result = await controller.run();

    expect(seenParams[0]?.projectBootstrapEnabled).toBe(false);
    expect(mockStreamChat).toHaveBeenCalledTimes(1);
    expect(result.state.maxTurns).toBe(1);
  });

  describe('assistant routing passthrough', () => {
    const routableTargets = [
      { id: 'assistant-math', name: 'Math Tutor', description: 'Solves advanced math problems' },
      { id: 'assistant-eng', name: 'English Coach', description: 'Improves English writing' },
    ];

    it('passes options.routableTargets and callbacks.onRouteProposal through to streamChat', async () => {
      const invocations = installStreamChatTurns([
        buildStreamChatInvocation({
          finishReason: 'complete',
          toolSequence: ['reportTurnOutcome'],
          projectSummary: completeProjectSummary,
        }),
      ]);
      const onRouteProposal = vi.fn();
      const baseOpts = buildOptions({ routableTargets });
      const opts = {
        ...baseOpts,
        callbacks: { ...baseOpts.callbacks, onRouteProposal },
      };

      const controller = new AgentRunController(opts);
      await controller.run();

      expect(mockStreamChat).toHaveBeenCalledTimes(1);
      expect(invocations[0]?.params.routableTargets).toBe(routableTargets);
      expect(invocations[0]?.params.onRouteProposal).toBe(onRouteProposal);
    });

    it('persists routableTargets in saveCheckpoint and updateCheckpoint payloads during the run', async () => {
      installStreamChatTurns([
        buildStreamChatInvocation({
          finishReason: 'tool-budget-exhausted',
          toolSequence: ['readFile'],
          projectSummary: baseProjectSummary,
        }),
        buildStreamChatInvocation({
          finishReason: 'complete',
          toolSequence: ['reportTurnOutcome'],
          projectSummary: completeProjectSummary,
        }),
      ]);

      const opts = buildOptions({ routableTargets, maxTurns: 2 });
      const controller = new AgentRunController(opts);
      const runId = controller.getState().runId;

      await controller.run();

      // Initial running checkpoint carries the routable targets.
      expect(mockSaveCheckpoint).toHaveBeenCalledWith(expect.objectContaining({ routableTargets }));
      // Every progress/terminal update also carries them.
      expect(mockUpdateCheckpoint).toHaveBeenCalled();
      for (const [calledRunId, payload] of mockUpdateCheckpoint.mock.calls) {
        expect(calledRunId).toBe(runId);
        expect(payload).toEqual(expect.objectContaining({ routableTargets }));
      }
    });

    it('resumeFrom.routableTargets takes precedence over options.routableTargets for streamChat', async () => {
      const checkpointTargets = [
        { id: 'assistant-from-checkpoint', name: 'Resume Bot', description: 'From checkpoint' },
      ];
      const optionTargets = [
        { id: 'assistant-from-options', name: 'Options Bot', description: 'From options' },
      ];
      const resumeFrom: AgentRunCheckpoint = {
        ...buildCheckpoint(),
        routableTargets: checkpointTargets,
      };
      const invocations = installStreamChatTurns([
        buildStreamChatInvocation({
          finishReason: 'complete',
          toolSequence: ['reportTurnOutcome'],
          projectSummary: completeProjectSummary,
        }),
      ]);

      const controller = new AgentRunController(
        buildOptions({ resumeFrom, routableTargets: optionTargets }),
      );
      await controller.run();

      expect(mockStreamChat).toHaveBeenCalledTimes(1);
      expect(invocations[0]?.params.routableTargets).toBe(checkpointTargets);
      expect(invocations[0]?.params.routableTargets).not.toBe(optionTargets);
    });

    it('sharedMode forces delegation off but leaves routableTargets enabled', async () => {
      const invocations = installStreamChatTurns([buildStreamChatInvocation()]);
      const controller = new AgentRunController(
        buildOptions({
          sharedMode: true,
          subagentDelegationEnabled: true,
          routableTargets,
        }),
      );

      await controller.run();

      expect(invocations[0]?.params.subagentDelegationEnabled).toBe(false);
      expect(invocations[0]?.params.routableTargets).toBe(routableTargets);
      expect(mockSaveCheckpoint).toHaveBeenCalledWith(
        expect.objectContaining({
          sharedMode: true,
          subagentDelegationEnabled: false,
          routableTargets,
        }),
      );
    });
  });
});
