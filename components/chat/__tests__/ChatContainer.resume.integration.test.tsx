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
  mockPerformCachedRagQuery,
  mockResultsToContextString,
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
  mockPerformCachedRagQuery: vi.fn(),
  mockResultsToContextString: vi.fn(),
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
}));

vi.mock('../../../services/htmlProjectStore', () => ({
  htmlProjectStore: {
    getProject: mockGetProject,
  },
}));

vi.mock('../../../services/ragCacheManagerV2', () => ({
  ragCacheManagerV2: {
    performCachedRagQuery: mockPerformCachedRagQuery,
    resultsToContextString: mockResultsToContextString,
  },
}));

vi.mock('../../../services/ragQueryService', () => ({
  ragQueryService: {
    performRagQuery: vi.fn(),
    resultsToContextString: vi.fn(),
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

vi.mock('../../settings', () => ({
  RagSettingsModal: () => null,
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
  tokenTotals: overrides.tokenTotals ?? {
    promptTokenCount: 10,
    candidatesTokenCount: 15,
  },
  agentHarnessEnabled: overrides.agentHarnessEnabled ?? true,
  sharedMode: overrides.sharedMode ?? false,
  createdAt: overrides.createdAt ?? 1640995200000,
  updatedAt: overrides.updatedAt ?? 1640995200000,
  heartbeatAt: overrides.heartbeatAt ?? 1640995200000,
});

const buildRunResult = (fullText: string, runId: string): AgentRunResult => ({
  state: {
    ...completeState,
    runId,
  },
  fullText,
  finalHistory: [],
  historyDelta: [],
  tokenInfo: {
    promptTokenCount: 10,
    candidatesTokenCount: 15,
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
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
    await deleteForSession(SESSION_ID);
    mockGetProject.mockResolvedValue({ id: 'project-1' });
    mockPerformCachedRagQuery.mockResolvedValue({
      results: [],
      fromCache: false,
      queryTime: 12,
      ragMetadata: {
        source: 'indexeddb',
        totalCandidates: 0,
        filteredCandidates: 0,
        finalResults: 0,
      },
    });
    mockResultsToContextString.mockReturnValue('');
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

  it('allows only one active continuation when two tabs race without Web Locks', async () => {
    const checkpoint = buildCheckpoint({ runId: 'run-race', projectId: null });
    await saveCheckpoint(checkpoint);
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      writable: true,
      value: undefined,
    });

    let resolveFirstRun: ((value: AgentRunResult) => void) | undefined;
    mockControllerRun.mockImplementationOnce(
      async () =>
        new Promise<AgentRunResult>(resolve => {
          resolveFirstRun = resolve;
        }),
    );

    const firstTab = await renderChat({ onNewMessage: vi.fn() });
    const secondTab = await renderChat({ onNewMessage: vi.fn() });

    const firstResume = await within(firstTab.container).findByRole('button', { name: '繼續' });
    await userEvent.setup().click(firstResume);
    await waitFor(() => {
      expect(mockControllerRun).toHaveBeenCalledTimes(1);
    });

    const secondResume = await within(secondTab.container).findByRole('button', { name: '繼續' });
    await userEvent.setup().click(secondResume);

    await waitFor(() => {
      expect(mockControllerRun).toHaveBeenCalledTimes(1);
      expect(
        within(secondTab.container).getByText('無法取得續跑權限，可能已有其他分頁接手此工作。'),
      ).toBeInTheDocument();
    });

    resolveFirstRun?.(buildRunResult('First tab output', checkpoint.runId));
    await waitFor(async () => {
      await expect(getCheckpoint(checkpoint.runId)).resolves.toBeNull();
    });
  });
});
