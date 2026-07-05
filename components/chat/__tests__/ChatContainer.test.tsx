import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ChatContainer from '../ChatContainer';
import { createMockChatSession, TEST_ASSISTANTS } from './test-utils';
import { useAppContext } from '../../core/useAppContext';
import type { AgentRunCheckpoint, AgentRunState } from '../../../types';
import type { AgentRunController, AgentRunResult } from '../../../services/agentRunController';

const {
  mockCreateNewSession,
  mockAgentRunControllerCtor,
  mockControllerRun,
  mockControllerStop,
  mockControllerGetInstance,
  mockPerformCachedRagQuery,
  mockResultsToContextString,
  mockSetActiveProject,
  mockSetProjectWorkspaceOpen,
  mockSetProjectPreview,
  mockAppendProjectActivity,
  mockClearProjectWorkspace,
  mockSetAgentRunState,
  mockGetInterruptedForSession,
  mockClaimCheckpoint,
  mockDeleteCheckpoint,
  mockGetProject,
} = vi.hoisted(() => ({
  mockCreateNewSession: vi.fn().mockResolvedValue(undefined),
  mockAgentRunControllerCtor: vi.fn(),
  mockControllerRun: vi.fn(),
  mockControllerStop: vi.fn(),
  mockControllerGetInstance: vi.fn(),
  mockPerformCachedRagQuery: vi.fn(),
  mockResultsToContextString: vi.fn(),
  mockSetActiveProject: vi.fn(),
  mockSetProjectWorkspaceOpen: vi.fn(),
  mockSetProjectPreview: vi.fn(),
  mockAppendProjectActivity: vi.fn(),
  mockClearProjectWorkspace: vi.fn(),
  mockSetAgentRunState: vi.fn(),
  mockGetInterruptedForSession: vi.fn().mockResolvedValue(null),
  mockClaimCheckpoint: vi.fn().mockResolvedValue(null),
  mockDeleteCheckpoint: vi.fn().mockResolvedValue(undefined),
  mockGetProject: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../core/useAppContext', async () => {
  const React = await import('react');
  return {
    AppContext: React.createContext({
      actions: {
        createNewSession: mockCreateNewSession,
        setActiveProject: mockSetActiveProject,
        setProjectWorkspaceOpen: mockSetProjectWorkspaceOpen,
        setProjectPreview: mockSetProjectPreview,
        appendProjectActivity: mockAppendProjectActivity,
        clearProjectWorkspace: mockClearProjectWorkspace,
        setAgentRunState: mockSetAgentRunState,
      },
    }),
    useAppContext: vi.fn(),
  };
});

vi.mock('../../../services/agentRunController', () => ({
  AgentRunController: vi.fn().mockImplementation((...args: unknown[]) => {
    mockAgentRunControllerCtor(...args);
    const instance: Partial<AgentRunController> = {
      run: mockControllerRun,
      stop: mockControllerStop,
      flushCheckpoint: vi.fn().mockResolvedValue(undefined),
      getState: mockControllerGetInstance,
    };
    return instance;
  }),
}));

vi.mock('../../../services/agentRunCheckpointService', () => ({
  getInterruptedForSession: mockGetInterruptedForSession,
  claimCheckpoint: mockClaimCheckpoint,
  deleteCheckpoint: mockDeleteCheckpoint,
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
  sessionId: 'test-session-1',
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

const interruptedCheckpoint: AgentRunCheckpoint = {
  schemaVersion: 1,
  runId: 'run-interrupted',
  sessionId: 'test-session-1',
  assistantId: 'test-assistant-1',
  projectId: null,
  status: 'running',
  turnIndex: 1,
  maxTurns: 5,
  originalMessage: 'Resume this task',
  committedHistoryDelta: [{ role: 'model', content: 'First completed turn' }],
  partialText: 'Partial output',
  toolTrace: ['inspect'],
  tokenTotals: {
    promptTokenCount: 10,
    candidatesTokenCount: 15,
  },
  agentHarnessEnabled: true,
  sharedMode: false,
  createdAt: 1640995200000,
  updatedAt: 1640995200000,
  heartbeatAt: 1640995200000,
};

const buildRunResult = (fullText: string): AgentRunResult => ({
  state: completeState,
  fullText,
  finalHistory: [],
  historyDelta: [],
  tokenInfo: {
    promptTokenCount: 10,
    candidatesTokenCount: 15,
  },
  telemetry: {
    sessionId: 'test-session-1',
    assistantId: 'test-assistant-1',
    projectId: null,
    provider: 'unknown',
    intent: 'uncertain',
    selectedPackSet: [],
    toolSequence: [],
    repeatedRecoverableErrors: [],
    toolRounds: 0,
    runId: 'run-1',
    turnIndex: 0,
    finishReason: 'complete',
    autoContinued: false,
    runtimeDiagnosticState: 'clean',
  },
});

describe('ChatContainer', () => {
  const defaultProps = {
    session: createMockChatSession(),
    assistantName: TEST_ASSISTANTS.basicAssistant.name,
    systemPrompt: TEST_ASSISTANTS.basicAssistant.systemPrompt,
    assistantId: TEST_ASSISTANTS.basicAssistant.id,
    ragChunks: [],
    onNewMessage: vi.fn(),
    hideHeader: false,
    sharedMode: false,
    assistantDescription: TEST_ASSISTANTS.basicAssistant.description,
  };

  const sendMessage = async (message: string) => {
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: '輸入訊息' }), message);
    await user.click(screen.getByRole('button', { name: '傳送訊息' }));
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetInterruptedForSession.mockResolvedValue(null);
    mockClaimCheckpoint.mockResolvedValue(null);
    mockDeleteCheckpoint.mockResolvedValue(undefined);
    mockGetProject.mockResolvedValue(undefined);
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

    vi.mocked(useAppContext).mockReturnValue({
      actions: {
        createNewSession: mockCreateNewSession,
        setActiveProject: mockSetActiveProject,
        setProjectWorkspaceOpen: mockSetProjectWorkspaceOpen,
        setProjectPreview: mockSetProjectPreview,
        appendProjectActivity: mockAppendProjectActivity,
        clearProjectWorkspace: mockClearProjectWorkspace,
        setAgentRunState: mockSetAgentRunState,
      },
    } as unknown as ReturnType<typeof useAppContext>);

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

    // Default: emit chunks + complete, then resolve with a result.
    mockControllerRun.mockImplementation(async () => {
      const options = mockAgentRunControllerCtor.mock.calls.at(-1)?.[0] as {
        callbacks?: { onChunk?: (text: string, turn: number) => void };
      };
      options?.callbacks?.onChunk?.('Hello', 0);
      return buildRunResult('Test reply');
    });
  });

  it('renders the header and welcome state for an empty session', () => {
    render(<ChatContainer {...defaultProps} />);

    expect(
      screen.getByRole('heading', { level: 2, name: defaultProps.assistantName }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('welcome-message')).toBeInTheDocument();
    expect(screen.getByRole('main', { name: '聊天對話' })).toBeInTheDocument();
  });

  it('hides the header when hideHeader is true', () => {
    render(<ChatContainer {...defaultProps} hideHeader={true} />);

    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
  });

  it('renders existing messages and suppresses the welcome message', () => {
    const session = createMockChatSession({
      messages: [
        { role: 'user', content: 'First question' },
        { role: 'model', content: 'First answer' },
      ],
    });

    render(<ChatContainer {...defaultProps} session={session} />);

    expect(screen.getByText('First question')).toBeInTheDocument();
    expect(screen.getByText('First answer')).toBeInTheDocument();
    expect(screen.queryByTestId('welcome-message')).not.toBeInTheDocument();
  });

  it('adds the user message immediately when sending', async () => {
    render(<ChatContainer {...defaultProps} />);

    await sendMessage('Need help');

    await waitFor(() => {
      expect(screen.getByText('Need help')).toBeInTheDocument();
    });
  });

  it('constructs AgentRunController with assistantId, sessionId, activeProjectId, and message', async () => {
    const session = createMockChatSession({ activeProjectId: 'project-42' });

    render(<ChatContainer {...defaultProps} session={session} />);

    await sendMessage('Continue building');

    await waitFor(() => {
      expect(mockAgentRunControllerCtor).toHaveBeenCalledWith(
        expect.objectContaining({
          assistantId: defaultProps.assistantId,
          sessionId: session.id,
          activeProjectId: 'project-42',
          message: 'Continue building',
          agentHarnessEnabled: true,
        }),
      );
    });
  });

  it('threads agentHarnessEnabled=false when the prop is false', async () => {
    render(<ChatContainer {...defaultProps} agentHarnessEnabled={false} />);

    await sendMessage('Single turn only');

    await waitFor(() => {
      expect(mockAgentRunControllerCtor).toHaveBeenCalledWith(
        expect.objectContaining({ agentHarnessEnabled: false }),
      );
    });
  });

  it('finalizes the session with fullText + tokenInfo after run resolves', async () => {
    mockControllerRun.mockResolvedValueOnce(buildRunResult('Final response text'));

    render(<ChatContainer {...defaultProps} />);

    await sendMessage('Finish without chunk');

    await waitFor(() => {
      expect(defaultProps.onNewMessage).toHaveBeenCalledWith(
        expect.objectContaining({ id: defaultProps.session.id }),
        'Finish without chunk',
        'Final response text',
        expect.objectContaining({ promptTokenCount: 10, candidatesTokenCount: 15 }),
      );
    });
  });

  it('forwards onProjectToolActivity into AppContext workspace actions', async () => {
    mockControllerRun.mockImplementationOnce(async () => {
      const options = mockAgentRunControllerCtor.mock.calls.at(-1)?.[0] as {
        callbacks?: {
          onProjectToolActivity?: (update: {
            activeProjectId: string;
            preview: { url: string };
            activityMessage: string;
          }) => void;
        };
      };
      options?.callbacks?.onProjectToolActivity?.({
        activeProjectId: 'project-99',
        preview: { url: 'blob:preview-99' },
        activityMessage: 'Updated preview',
      });
      return buildRunResult('Done');
    });

    render(<ChatContainer {...defaultProps} />);

    await sendMessage('Make a landing page');

    await waitFor(() => {
      expect(mockSetActiveProject).toHaveBeenCalledWith('project-99');
      expect(mockSetProjectWorkspaceOpen).toHaveBeenCalledWith(true);
      expect(mockSetProjectPreview).toHaveBeenCalledWith({ url: 'blob:preview-99' });
      expect(mockAppendProjectActivity).toHaveBeenCalledWith('Updated preview');
    });
  });

  it('forwards onStateChange to AppContext.setAgentRunState', async () => {
    mockControllerRun.mockImplementationOnce(async () => {
      const options = mockAgentRunControllerCtor.mock.calls.at(-1)?.[0] as {
        callbacks?: { onStateChange?: (state: AgentRunState) => void };
      };
      options?.callbacks?.onStateChange?.(runningState);
      options?.callbacks?.onStateChange?.(completeState);
      return buildRunResult('Done');
    });

    render(<ChatContainer {...defaultProps} />);

    await sendMessage('Track state');

    await waitFor(() => {
      expect(mockSetAgentRunState).toHaveBeenCalledWith(runningState);
      expect(mockSetAgentRunState).toHaveBeenCalledWith(completeState);
    });
  });

  it('calls controller.stop when the Stop button is clicked during a run', async () => {
    // Run that stays pending (we control resolution) so the Stop button stays visible.
    let resolveRun: (value: AgentRunResult) => void = () => undefined;
    mockControllerRun.mockImplementationOnce(
      async () =>
        new Promise<AgentRunResult>(resolve => {
          resolveRun = resolve;
        }),
    );

    let stateChange: ((state: AgentRunState) => void) | null = null as unknown as
      | ((state: AgentRunState) => void)
      | null;
    mockAgentRunControllerCtor.mockImplementationOnce((options: unknown) => {
      const opts = options as { callbacks?: { onStateChange?: (s: AgentRunState) => void } };
      stateChange = opts.callbacks?.onStateChange ?? null;
      mockAgentRunControllerCtor.mock.calls.at(-1);
      return {
        run: mockControllerRun,
        stop: mockControllerStop,
        getState: mockControllerGetInstance,
      } as Partial<AgentRunController>;
    });

    render(<ChatContainer {...defaultProps} />);

    await sendMessage('Stop me');

    // Emit running state so the Stop button renders.
    await act(async () => {
      stateChange?.(runningState);
    });

    const stopButton = await screen.findByRole('button', { name: '停止 Agent 執行' });
    expect(stopButton).toBeInTheDocument();

    await userEvent.setup().click(stopButton);

    await waitFor(() => {
      expect(mockControllerStop).toHaveBeenCalledWith('user-stop');
    });

    // Resolve the run so the component cleans up.
    await act(async () => {
      resolveRun(buildRunResult('Stopped run'));
    });
  });

  it('locks the input while a run is in progress', async () => {
    let resolveRun: (value: AgentRunResult) => void = () => undefined;
    mockControllerRun.mockImplementationOnce(
      async () =>
        new Promise<AgentRunResult>(resolve => {
          resolveRun = resolve;
        }),
    );

    let stateChange: ((state: AgentRunState) => void) | null = null as unknown as
      | ((state: AgentRunState) => void)
      | null;
    mockAgentRunControllerCtor.mockImplementationOnce((options: unknown) => {
      const opts = options as { callbacks?: { onStateChange?: (s: AgentRunState) => void } };
      stateChange = opts.callbacks?.onStateChange ?? null;
      return {
        run: mockControllerRun,
        stop: mockControllerStop,
        getState: mockControllerGetInstance,
      } as Partial<AgentRunController>;
    });

    render(<ChatContainer {...defaultProps} />);

    await sendMessage('Lock me');

    await act(async () => {
      stateChange?.(runningState);
    });

    const textarea = await screen.findByRole('textbox', { name: '輸入訊息' });
    await waitFor(() => {
      expect(textarea).toBeDisabled();
    });

    await act(async () => {
      resolveRun(buildRunResult('Unlocked'));
    });

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: '輸入訊息' })).toBeEnabled();
    });
  });

  it('shows the error text when controller.run rejects', async () => {
    mockControllerRun.mockRejectedValueOnce(
      new Error('Gemini terminal response had no visible text'),
    );

    render(<ChatContainer {...defaultProps} />);

    await sendMessage('Fail before chunk');

    await waitFor(() => {
      expect(screen.getByText(/Gemini terminal response had no visible text/)).toBeInTheDocument();
    });

    expect(screen.queryByRole('button', { name: '正在傳送訊息' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '輸入訊息' })).toBeEnabled();
    expect(screen.queryByText('🤖 生成回答...')).not.toBeInTheDocument();
  });

  it('starts a new shared conversation from the header button', async () => {
    const user = userEvent.setup();
    const session = createMockChatSession({
      messages: [{ role: 'user', content: 'Existing message' }],
      tokenCount: 99,
      activeProjectId: 'project-7',
    });

    render(<ChatContainer {...defaultProps} session={session} sharedMode={true} />);

    await user.click(screen.getByTitle('開啟新對話'));

    await waitFor(() => {
      expect(mockCreateNewSession).toHaveBeenCalledWith(defaultProps.assistantId);
    });

    expect(mockClearProjectWorkspace).toHaveBeenCalled();
    expect(mockSetAgentRunState).toHaveBeenCalledWith(null);
    expect(screen.getByTestId('welcome-message')).toBeInTheDocument();
    expect(screen.queryByText('Existing message')).not.toBeInTheDocument();
  });

  it('renders a resume banner for an interrupted run', async () => {
    mockGetInterruptedForSession.mockResolvedValueOnce(interruptedCheckpoint);

    render(<ChatContainer {...defaultProps} />);

    expect(await screen.findByTestId('resume-run-banner')).toBeInTheDocument();
    expect(screen.getByText(/上次工作在第 2\/5 回合中斷/)).toBeInTheDocument();
    expect(screen.getByText('Partial output')).toBeInTheDocument();
  });

  it('discards interrupted work before sending a new message', async () => {
    mockGetInterruptedForSession.mockResolvedValue(interruptedCheckpoint);

    render(<ChatContainer {...defaultProps} />);
    await screen.findByTestId('resume-run-banner');

    await sendMessage('New message after crash');

    await waitFor(() => {
      expect(mockDeleteCheckpoint).toHaveBeenCalledWith('run-interrupted');
      expect(mockSetAgentRunState).toHaveBeenCalledWith(null);
      expect(defaultProps.onNewMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'model', content: 'First completed turn' }),
            expect.objectContaining({ role: 'user', content: 'New message after crash' }),
          ]),
        }),
        'New message after crash',
        'Test reply',
        expect.anything(),
      );
    });
  });
});
