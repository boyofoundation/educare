import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockChatSession, TEST_ASSISTANTS } from './test-utils';
import type { AgentRunCheckpoint, AgentRunState } from '../../../types';
import type { AgentRunController, AgentRunResult } from '../../../services/agentRunController';
import {
  deleteForSession,
  getCheckpoint,
  saveCheckpoint,
} from '../../../services/agentRunCheckpointService';

const SESSION_ID = 'integration-session';

const {
  mockUpdateSession,
  mockCreateNewSession,
  mockAgentRunControllerCtor,
  mockControllerRun,
  mockControllerStop,
  mockControllerGetInstance,
  mockSetActiveProject,
  mockSetProjectWorkspaceOpen,
  mockSetProjectPreview,
  mockAppendProjectActivity,
  mockClearProjectWorkspace,
  mockSetAgentRunState,
  mockGetProject,
  mockGetAgentRunReplayPolicy,
} = vi.hoisted(() => ({
  mockUpdateSession: vi.fn().mockResolvedValue(undefined),
  mockCreateNewSession: vi.fn().mockResolvedValue(undefined),
  mockAgentRunControllerCtor: vi.fn(),
  mockControllerRun: vi.fn(),
  mockControllerStop: vi.fn(),
  mockControllerGetInstance: vi.fn().mockReturnValue({ status: 'complete' }),
  mockSetActiveProject: vi.fn(),
  mockSetProjectWorkspaceOpen: vi.fn(),
  mockSetProjectPreview: vi.fn(),
  mockAppendProjectActivity: vi.fn(),
  mockClearProjectWorkspace: vi.fn(),
  mockSetAgentRunState: vi.fn(),
  mockGetProject: vi.fn().mockResolvedValue({ id: 'project-1' }),
  mockGetAgentRunReplayPolicy: vi.fn((checkpoint: AgentRunCheckpoint) => ({
    replaySafe:
      checkpoint.resumeBudgetAcknowledgementRequired !== true &&
      checkpoint.budgetUsage?.toolCallsKnown !== false &&
      !(checkpoint.inFlightToolCallIds?.length ?? 0),
    requiresBudgetAcknowledgement:
      checkpoint.resumeBudgetAcknowledgementRequired === true ||
      checkpoint.budgetUsage?.toolCallsKnown === false ||
      checkpoint.toolTrace.length >= 32,
    requiresInFlightToolAcknowledgement: (checkpoint.inFlightToolCallIds?.length ?? 0) > 0,
    inFlightToolCallIds: checkpoint.inFlightToolCallIds ?? [],
  })),
}));

vi.mock('../../core/useAppContext', async () => {
  const React = await import('react');
  const actions = {
    updateSession: mockUpdateSession,
    createNewSession: mockCreateNewSession,
    setActiveProject: mockSetActiveProject,
    setProjectWorkspaceOpen: mockSetProjectWorkspaceOpen,
    setProjectPreview: mockSetProjectPreview,
    appendProjectActivity: mockAppendProjectActivity,
    clearProjectWorkspace: mockClearProjectWorkspace,
    setAgentRunState: mockSetAgentRunState,
  };
  return {
    AppContext: React.createContext({ actions }),
    useAppContext: vi.fn(() => ({ actions })),
  };
});

vi.mock('../../../services/agentRunController', () => ({
  AgentRunController: class MockAgentRunController implements Partial<AgentRunController> {
    constructor(...args: unknown[]) {
      mockAgentRunControllerCtor(...args);
    }

    run = mockControllerRun;
    stop = mockControllerStop;
    flushCheckpoint = vi.fn().mockResolvedValue(undefined);
    getState = mockControllerGetInstance;
  },
  getAgentRunReplayPolicy: mockGetAgentRunReplayPolicy,
}));

vi.mock('../../../services/htmlProjectStore', () => ({
  htmlProjectStore: {
    getProject: mockGetProject,
  },
}));

vi.mock('../../../services/ragSettingsService', () => ({
  getRagSettingsService: () => ({
    getVectorSearchLimit: () => 20,
    isRerankingEnabled: () => false,
    getRerankLimit: () => 5,
    getMinSimilarity: () => 0.3,
  }),
}));

vi.mock('react-virtuoso', () => ({
  Virtuoso: ({
    data = [],
    itemContent,
  }: {
    data?: unknown[];
    itemContent: (index: number, item: unknown) => unknown;
  }) => {
    const React = require('react');
    return React.createElement(
      'div',
      { 'data-testid': 'virtuoso-scroller' },
      data.map((item, index) =>
        React.createElement('div', { key: index }, itemContent(index, item)),
      ),
    );
  },
}));

const runningState: AgentRunState = {
  runId: 'run-1',
  projectId: '',
  sessionId: SESSION_ID,
  assistantId: 'test-assistant-1',
  status: 'running',
  turnIndex: 0,
  maxTurns: 5,
  previewDiagnosticState: 'not_executed',
  autoContinued: false,
  toolTrace: [],
  startedAt: 1640995200000,
  updatedAt: 1640995200000,
};

const completeState: AgentRunState = {
  ...runningState,
  status: 'complete',
  turnIndex: 1,
  previewDiagnosticState: 'clean',
  finishReason: 'complete',
};

const buildCheckpoint = (overrides: Partial<AgentRunCheckpoint> = {}): AgentRunCheckpoint => ({
  schemaVersion: 1,
  runId: overrides.runId ?? 'run-integration',
  sessionId: overrides.sessionId ?? SESSION_ID,
  assistantId: overrides.assistantId ?? TEST_ASSISTANTS.basicAssistant.id,
  projectId: overrides.projectId === undefined ? 'project-1' : overrides.projectId,
  status: overrides.status ?? 'running',
  turnIndex: overrides.turnIndex ?? 1,
  maxTurns: overrides.maxTurns ?? (overrides.sharedMode ? 1 : 5),
  originalMessage: overrides.originalMessage ?? 'Resume this task',
  committedHistoryDelta: overrides.committedHistoryDelta ?? [
    { role: 'model', content: 'First completed turn' },
  ],
  partialText: overrides.partialText ?? 'Partial output',
  toolTrace: overrides.toolTrace ?? ['inspect'],
  inFlightToolCallIds: overrides.inFlightToolCallIds,
  tokenTotals: overrides.tokenTotals ?? {
    promptTokenCount: 10,
    candidatesTokenCount: 15,
  },
  agentHarnessEnabled: overrides.agentHarnessEnabled ?? true,
  sharedMode: overrides.sharedMode ?? false,
  budget: overrides.budget,
  budgetUsage: overrides.budgetUsage,
  resumeBudgetAcknowledgementRequired: overrides.resumeBudgetAcknowledgementRequired,
  failure: overrides.failure,
  failureStage: overrides.failureStage,
  failureCode: overrides.failureCode,
  failureRetryable: overrides.failureRetryable,
  createdAt: overrides.createdAt ?? 1640995200000,
  updatedAt: overrides.updatedAt ?? 1640995200000,
  heartbeatAt: overrides.heartbeatAt ?? 1640995200000,
});

const buildRunResult = (
  fullText: string,
  runId: string,
  overrides: Partial<AgentRunResult> = {},
): AgentRunResult => ({
  state: {
    ...completeState,
    runId,
    ...overrides.state,
  },
  fullText,
  finalHistory: [],
  historyDelta: [],
  tokenInfo: {
    promptTokenCount: 10,
    candidatesTokenCount: 15,
    ...overrides.tokenInfo,
  },
  telemetry: {
    sessionId: SESSION_ID,
    assistantId: TEST_ASSISTANTS.basicAssistant.id,
    projectId: null,
    provider: 'unknown',
    intent: 'uncertain',
    selectedPackSet: [],
    toolSequence: [],
    repeatedRecoverableErrors: [],
    toolRounds: 0,
    runId,
    turnIndex: 0,
    finishReason: 'complete',
    autoContinued: false,
    runtimeDiagnosticState: 'clean',
  },
});

const loadChatContainer = async () => (await import('../ChatContainer')).default;

describe('ChatContainer interrupted-run integration', () => {
  const renderChat = async (overrides: Record<string, unknown> = {}) => {
    const ChatContainer = await loadChatContainer();
    const props = {
      session: createMockChatSession({ id: SESSION_ID }),
      assistantName: TEST_ASSISTANTS.basicAssistant.name,
      systemPrompt: TEST_ASSISTANTS.basicAssistant.systemPrompt,
      assistantId: TEST_ASSISTANTS.basicAssistant.id,
      ragChunks: [],
      onNewMessage: vi.fn(),
      hideHeader: false,
      sharedMode: false,
      assistantDescription: TEST_ASSISTANTS.basicAssistant.description,
      ...overrides,
    };
    return { ...render(<ChatContainer {...props} />), props };
  };

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      writable: true,
      value: class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
    await deleteForSession(SESSION_ID);
    mockGetProject.mockResolvedValue({ id: 'project-1' });
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      writable: true,
      value: {
        request: vi.fn(
          async (_name: string, _options: unknown, callback: (lock: object) => Promise<unknown>) =>
            callback({}),
        ),
      },
    });
  });

  afterEach(async () => {
    await deleteForSession(SESSION_ID);
    vi.restoreAllMocks();
  });

  it('simulates crash/remount and clears the checkpoint after a successful explicit resume', async () => {
    const checkpoint = buildCheckpoint({ runId: 'run-remount', projectId: 'project-1' });
    await saveCheckpoint(checkpoint);
    mockControllerRun.mockResolvedValueOnce(buildRunResult('Recovered output', checkpoint.runId));

    const first = await renderChat({
      session: createMockChatSession({ id: SESSION_ID, title: 'New Chat' }),
      onNewMessage: vi.fn(),
    });
    expect(await screen.findByTestId('resume-run-banner')).toBeInTheDocument();
    first.unmount();

    const onNewMessage = vi.fn();
    await renderChat({
      session: createMockChatSession({ id: SESSION_ID, title: 'New Chat' }),
      onNewMessage,
    });
    expect(await screen.findByTestId('resume-run-banner')).toBeInTheDocument();
    expect(mockAgentRunControllerCtor).not.toHaveBeenCalled();

    await userEvent.setup().click(screen.getByRole('button', { name: '繼續' }));

    await waitFor(() => {
      expect(mockAgentRunControllerCtor).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Resume this task',
          resumeFrom: checkpoint,
          history: [
            expect.objectContaining({ role: 'user', content: 'Resume this task' }),
            expect.objectContaining({ role: 'model', content: 'First completed turn' }),
          ],
        }),
      );
      expect(onNewMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'user', content: 'Resume this task' }),
            expect.objectContaining({ role: 'model', content: 'First completed turn' }),
            expect.objectContaining({ role: 'model', content: 'Recovered output' }),
          ]),
        }),
        'Resume this task',
        'Recovered output',
        expect.anything(),
      );
    });
    await waitFor(async () => {
      await expect(getCheckpoint(checkpoint.runId)).resolves.toBeNull();
    });
  });

  it('requires explicit confirmation for sharedMode interrupted runs before resuming', async () => {
    const checkpoint = buildCheckpoint({
      runId: 'run-shared',
      sharedMode: true,
      maxTurns: 1,
      turnIndex: 0,
      projectId: null,
      committedHistoryDelta: [],
    });
    await saveCheckpoint(checkpoint);
    mockControllerRun.mockResolvedValueOnce(
      buildRunResult('Shared resume output', checkpoint.runId),
    );

    await renderChat({ sharedMode: true, onNewMessage: vi.fn() });
    expect(await screen.findByTestId('resume-run-banner')).toBeInTheDocument();
    expect(mockAgentRunControllerCtor).not.toHaveBeenCalled();

    await userEvent.setup().click(screen.getByRole('button', { name: '繼續' }));

    await waitFor(() => {
      expect(mockAgentRunControllerCtor).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Resume this task',
          sharedMode: true,
          resumeFrom: checkpoint,
        }),
      );
    });
  });

  it('replays the original message for a no-project turn-zero interruption', async () => {
    const checkpoint = buildCheckpoint({
      runId: 'run-no-project',
      projectId: null,
      turnIndex: 0,
      committedHistoryDelta: [],
    });
    await saveCheckpoint(checkpoint);
    const onNewMessage = vi.fn();
    mockControllerRun.mockResolvedValueOnce(buildRunResult('Resent output', checkpoint.runId));

    await renderChat({
      session: createMockChatSession({ id: SESSION_ID }),
      onNewMessage,
    });
    expect(await screen.findByTestId('resume-run-banner')).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', { name: '繼續' }));

    await waitFor(() => {
      expect(mockAgentRunControllerCtor).toHaveBeenCalledWith(
        expect.objectContaining({
          activeProjectId: null,
          message: 'Resume this task',
          history: [],
        }),
      );
      expect(onNewMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'user', content: 'Resume this task' }),
            expect.objectContaining({ role: 'model', content: 'Resent output' }),
          ]),
        }),
        'Resume this task',
        'Resent output',
        expect.anything(),
      );
    });
  });

  it('retains a paused empty response and persists the completed usage delta', async () => {
    const checkpoint = buildCheckpoint({
      runId: 'run-paused-empty',
      projectId: null,
      status: 'paused',
      tokenTotals: { promptTokenCount: 100, candidatesTokenCount: 0 },
      budgetUsage: {
        turns: 1,
        toolCalls: 0,
        toolCallsKnown: true,
        tokens: 100,
        estimatedTokens: false,
      },
    });
    await saveCheckpoint(checkpoint);
    const onNewMessage = vi.fn();
    mockControllerRun.mockResolvedValueOnce(
      buildRunResult('', checkpoint.runId, {
        state: {
          ...completeState,
          runId: checkpoint.runId,
          status: 'paused',
          pauseReason: 'budget',
          turnIndex: 2,
        },
        tokenInfo: {
          promptTokenCount: 111,
          candidatesTokenCount: 0,
          usage: { source: 'api', inputTokens: 11, outputTokens: 0, totalTokens: 11 },
        },
      }),
    );

    const session = createMockChatSession({
      id: SESSION_ID,
      tokenUsage: {
        source: 'api',
        totals: {
          inputTokens: 100,
          outputTokens: 0,
          totalTokens: 100,
        },
      },
      tokenCount: 100,
    });
    const { props } = await renderChat({ session, onNewMessage });
    await screen.findByTestId('resume-run-banner');

    await userEvent.setup().click(screen.getByRole('button', { name: '繼續' }));

    await waitFor(async () => {
      expect(onNewMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          tokenUsage: expect.objectContaining({
            totals: expect.objectContaining({ totalTokens: 111 }),
          }),
        }),
        'Resume this task',
        '',
        expect.objectContaining({ promptTokenCount: 11 }),
      );
      await expect(getCheckpoint(checkpoint.runId)).resolves.toEqual(checkpoint);
    });
    expect(props.onNewMessage).toBe(onNewMessage);
    expect(screen.getByText('（本次回覆沒有內容）')).toBeInTheDocument();
  });

  it('retains a reloaded paused checkpoint even when its committed tail matches the session', async () => {
    const checkpoint = buildCheckpoint({
      runId: 'run-paused-matching-tail',
      projectId: null,
      status: 'paused',
      committedHistoryDelta: [{ role: 'model', content: 'Already persisted turn' }],
    });
    await saveCheckpoint(checkpoint);

    const { container } = await renderChat({
      session: createMockChatSession({
        id: SESSION_ID,
        messages: [{ role: 'model', content: 'Already persisted turn' }],
      }),
    });

    expect(await within(container).findByTestId('resume-run-banner')).toBeInTheDocument();
    await expect(getCheckpoint(checkpoint.runId)).resolves.toEqual(checkpoint);
  });

  it('allows a paused checkpoint at the old turn limit to resume after increasing the budget', async () => {
    const checkpoint = buildCheckpoint({
      runId: 'run-adjustable-budget',
      projectId: null,
      status: 'paused',
      turnIndex: 5,
      maxTurns: 5,
      budget: { maxTurns: 5, maxToolCalls: 30, maxTokens: 50_000 },
    });
    await saveCheckpoint(checkpoint);
    mockControllerRun.mockResolvedValueOnce(buildRunResult('Extended output', checkpoint.runId));

    await renderChat();
    await screen.findByTestId('resume-run-banner');
    expect(screen.getByRole('button', { name: '繼續' })).toBeDisabled();

    const user = userEvent.setup();
    const maxTurns = screen.getByRole('textbox', { name: '最大回合數' });
    await user.clear(maxTurns);
    await user.type(maxTurns, '6');

    await waitFor(() => expect(screen.getByRole('button', { name: '繼續' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: '繼續' }));

    await waitFor(() => {
      expect(mockAgentRunControllerCtor).toHaveBeenCalledWith(
        expect.objectContaining({
          budget: expect.objectContaining({ maxTurns: 6 }),
          resumeFrom: checkpoint,
        }),
      );
    });
  });

  it('fails closed when a checkpoint contains an unconfirmed in-flight tool call', async () => {
    const checkpoint = buildCheckpoint({
      runId: 'run-unsafe-replay',
      projectId: null,
      status: 'paused',
      inFlightToolCallIds: ['tool-uncertain'],
    });
    await saveCheckpoint(checkpoint);

    await renderChat();
    await screen.findByTestId('resume-run-banner');

    expect(screen.getByText(/尚未確認的工具操作/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '繼續' })).toBeDisabled();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(mockControllerRun).not.toHaveBeenCalled();
  });

  it('requires an explicit acknowledgement for legacy unknown tool usage', async () => {
    const checkpoint = buildCheckpoint({
      runId: 'run-unknown-usage',
      projectId: null,
      status: 'paused',
      resumeBudgetAcknowledgementRequired: true,
      budgetUsage: {
        turns: 1,
        toolCalls: 32,
        toolCallsKnown: false,
        tokens: 100,
        estimatedTokens: true,
      },
    });
    await saveCheckpoint(checkpoint);
    mockControllerRun.mockResolvedValueOnce(
      buildRunResult('Acknowledged output', checkpoint.runId),
    );

    await renderChat();
    await screen.findByTestId('resume-run-banner');
    const resume = screen.getByRole('button', { name: '繼續' });
    expect(resume).toBeDisabled();
    const acknowledgement = screen.getByRole('checkbox');
    await userEvent.setup().click(acknowledgement);
    await waitFor(() => expect(resume).toBeEnabled());
    await userEvent.setup().click(resume);

    await waitFor(() => {
      expect(mockAgentRunControllerCtor).toHaveBeenCalledWith(
        expect.objectContaining({
          acknowledgeResumeBudget: true,
          resumeFrom: checkpoint,
        }),
      );
    });
  });

  it('shows a readable busy error and does not request a provider when the workspace lock is busy', async () => {
    const checkpoint = buildCheckpoint({ runId: 'run-workspace-busy', projectId: null });
    await saveCheckpoint(checkpoint);
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      writable: true,
      value: {
        request: vi.fn(
          async (
            _name: string,
            _options: unknown,
            callback: (lock: object | null) => Promise<unknown>,
          ) => callback(null),
        ),
      },
    });

    const { container } = await renderChat();
    await within(container).findByTestId('resume-run-banner');
    await userEvent.setup().click(within(container).getByRole('button', { name: '繼續' }));

    await waitFor(() => {
      expect(mockControllerRun).not.toHaveBeenCalled();
      expect(within(container).getByRole('alert')).toHaveTextContent(/工作仍在其他分頁進行中/);
    });
  });

  it('fails closed for checkpoint resumes when Web Locks are unavailable', async () => {
    const checkpoint = buildCheckpoint({ runId: 'run-race', projectId: null });
    await saveCheckpoint(checkpoint);
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      writable: true,
      value: undefined,
    });

    const firstTab = await renderChat({ onNewMessage: vi.fn() });
    const resume = await within(firstTab.container).findByRole('button', { name: '繼續' });
    await userEvent.setup().click(resume);

    await waitFor(() => {
      expect(mockControllerRun).not.toHaveBeenCalled();
      expect(within(firstTab.container).getByText(/瀏覽器不支援安全的工作鎖/)).toBeInTheDocument();
    });
    await expect(getCheckpoint(checkpoint.runId)).resolves.toEqual(checkpoint);
  });
});
