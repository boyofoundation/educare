import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockStreamChat,
  mockExecuteHtmlProjectToolCall,
  mockCreateSnapshot,
  mockWaitForRuntimeDiagnostics,
  mockBuildSyntheticMessage,
  mockSaveCheckpoint,
  mockUpdateCheckpoint,
} = vi.hoisted(() => ({
  mockStreamChat: vi.fn(),
  mockExecuteHtmlProjectToolCall: vi.fn(),
  mockCreateSnapshot: vi.fn(),
  mockWaitForRuntimeDiagnostics: vi.fn(),
  mockBuildSyntheticMessage: vi.fn(),
  mockSaveCheckpoint: vi.fn().mockResolvedValue(undefined),
  mockUpdateCheckpoint: vi.fn().mockResolvedValue(null),
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
  }> = {},
) => ({
  finishReason: overrides.finishReason ?? 'complete',
  text: overrides.text ?? 'turn-text',
  toolSequence: overrides.toolSequence ?? [],
  projectSummary: overrides.projectSummary ?? null,
  selectedPackSet: overrides.selectedPackSet ?? ['inspect'],
  promptTokenCount: overrides.promptTokenCount ?? 10,
  candidatesTokenCount: overrides.candidatesTokenCount ?? 5,
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

    // Capture onComplete so the test can trigger it with the right text.
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
        },
        text,
      );
    };

    // Drive onChunk + onComplete synchronously to mimic the streaming contract.
    if (typeof params.onChunk === 'function') {
      (params.onChunk as (chunk: string) => void)(turn.text);
    }
    captured.completeCb(turn.text);
  });

  return invocations;
};

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
    mockBuildSyntheticMessage.mockImplementation(
      (role: 'user' | 'model', content: string, agentTurnLog?: string) => ({
        role,
        content,
        synthetic: true,
        agentTurnLog: agentTurnLog ?? 'continuation prompt',
      }),
    );
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
    // Exactly one turn — no continuation needed.
    expect(mockStreamChat).toHaveBeenCalledTimes(1);
    // G4 verify called getProjectSummary directly.
    expect(mockExecuteHtmlProjectToolCall).toHaveBeenCalledWith(
      { name: 'getProjectSummary', args: { projectId: 'project-1' } },
      expect.objectContaining({ activeProjectId: 'project-1' }),
    );
    expect(opts.callbacks.onTurnComplete).toHaveBeenCalledTimes(1);
  });

  it('AC#8 false-complete: continues when reportTurnOutcome says complete but todos remain', async () => {
    // Turn 0: model reports complete (reportTurnOutcome) but the live summary
    // from getProjectSummary still shows open todos → verify FAILS → continue.
    // Turn 1: now genuinely complete.
    installStreamChatTurns([
      buildStreamChatInvocation({
        finishReason: 'complete',
        toolSequence: ['reportTurnOutcome'],
        projectSummary: baseProjectSummary, // still has pending todo
      }),
      buildStreamChatInvocation({
        finishReason: 'complete',
        toolSequence: ['reportTurnOutcome'],
        projectSummary: completeProjectSummary,
      }),
    ]);

    // Make verify authoritative: turn 0 verify → still pending, turn 1 → complete.
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

  it('Budget: reaches maxTurns and terminates as complete at run level', async () => {
    // Always non-terminal finishReason so we exercise the budget path.
    installStreamChatTurns([
      buildStreamChatInvocation({
        finishReason: 'tool-budget-exhausted',
        toolSequence: ['readFile'],
        projectSummary: baseProjectSummary,
      }),
      buildStreamChatInvocation({
        finishReason: 'tool-budget-exhausted',
        toolSequence: ['readFile', 'writeFiles'], // different last-4 → no loop
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
    // Turn 0 returns a normal completion (no completion signals), then we stop
    // before turn 1's streamChat runs.
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

    // Stop immediately after turn 0 completes (before turn 1 starts). We hook
    // into onTurnComplete to fire stop().
    opts.callbacks.onTurnComplete = vi.fn(() => {
      controller.stop('user-stop');
    });

    await controller.run();

    expect(controller.getState().status).toBe('stopped');
    expect(controller.getState().finishReason).toBe('aborted');
    expect(controller.getState().abortReason).toBe('user-stop');
    // Only the first turn ran — stop() prevented the second turn's streamChat.
    expect(mockStreamChat).toHaveBeenCalledTimes(1);
    // Turn 0 completed normally (non-aborted) and emitted its own summary;
    // no second turn summary fires because stop() terminated before turn 1.
    expect(opts.callbacks.onTurnComplete).toHaveBeenCalledTimes(1);
    expect(opts.callbacks.onTurnComplete).toHaveBeenCalledWith(
      0,
      expect.objectContaining({ finishReason: 'tool-budget-exhausted' }),
    );
    // No continuation synthetic message was injected (only happens at the
    // top of turn N+1, which never started).
    expect(mockBuildSyntheticMessage).not.toHaveBeenCalled();
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

    // Turn 0: no packSetOverride (normal classification).
    const turn0Params = mockStreamChat.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(turn0Params?.packSetOverride).toBeUndefined();
    // Turn 1: packSetOverride derived from turn 0's effective pack set.
    const turn1Params = mockStreamChat.mock.calls[1]?.[0] as Record<string, unknown>;
    expect(turn1Params?.packSetOverride).toEqual(['inspect', 'todo_finalize', 'preview_recheck']);
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
    // Legacy single-turn: never produces autoContinued.
    expect(result.state.autoContinued).toBe(false);
    // Budget reached counts as run-level complete.
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

    // buildSyntheticMessage should have been invoked with the continuation prompt
    // exactly once (for turn 1's user-side injection).
    expect(mockBuildSyntheticMessage).toHaveBeenCalledWith(
      'user',
      CONTINUATION_PROMPT,
      'continuation prompt',
    );
    // Final history contains the synthetic user message.
    const syntheticMessages = result.finalHistory.filter(m => m.synthetic === true);
    expect(syntheticMessages.length).toBeGreaterThanOrEqual(1);
    // The synthetic message should appear before the second model turn.
    const syntheticIdx = result.finalHistory.findIndex(m => m.synthetic === true);
    const lastModelIdx = result.finalHistory
      .map((m, i) => (m.role === 'model' ? i : -1))
      .filter(i => i >= 0)
      .pop();
    expect(syntheticIdx).toBeLessThan(lastModelIdx ?? Number.POSITIVE_INFINITY);
  });

  it('sharedMode: default budget 1 → one turn only (no auto-continue)', async () => {
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

    expect(mockStreamChat).toHaveBeenCalledTimes(1);
    expect(result.state.maxTurns).toBe(1);
    expect(result.state.status).toBe('complete');
  });
});
