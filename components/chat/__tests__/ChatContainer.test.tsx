import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ChatContainer from '../ChatContainer';
import { createMockChatSession, TEST_ASSISTANTS } from './test-utils';
import { AppContext, useAppContext } from '../../core/useAppContext';
import type { AgentRunCheckpoint, AgentRunState, ChatMessage } from '../../../types';
import type { AgentRunController, AgentRunResult } from '../../../services/agentRunController';
import { withWorkspaceOperation } from '../../../services/workspaceOperationService';
import {
  buildChatDraftOwnerId,
  readWorkspaceDraft,
  resetWorkspaceDraftMemory,
  writeWorkspaceDraft,
} from '../../../services/workspaceDraftService';

const {
  mockCreateNewSession,
  mockUpdateSession,
  mockAgentRunControllerCtor,
  mockControllerRun,
  mockControllerStop,
  mockControllerGetInstance,
  mockControllerFlushCheckpoint,
  mockSetActiveProject,
  mockSetProjectWorkspaceOpen,
  mockSetProjectPreview,
  mockAppendProjectActivity,
  mockClearProjectWorkspace,
  mockSetAgentRunState,
  mockGetInterruptedForSession,
  mockGetCheckpoint,
  mockClaimCheckpoint,
  mockDeleteCheckpoint,
  mockAcquireWorkspaceRunLock,
  mockGetAgentRunReplayPolicy,
  mockGetProject,
  mockVirtuosoMount,
  mockVirtuosoUnmount,
  mockVirtuosoProps,
} = vi.hoisted(() => ({
  mockCreateNewSession: vi.fn().mockResolvedValue(undefined),
  mockUpdateSession: vi.fn().mockResolvedValue(undefined),
  mockAgentRunControllerCtor: vi.fn(),
  mockControllerRun: vi.fn(),
  mockControllerStop: vi.fn(),
  mockControllerGetInstance: vi.fn(),
  mockControllerFlushCheckpoint: vi.fn().mockResolvedValue(undefined),
  mockSetActiveProject: vi.fn(),
  mockSetProjectWorkspaceOpen: vi.fn(),
  mockSetProjectPreview: vi.fn(),
  mockAppendProjectActivity: vi.fn(),
  mockClearProjectWorkspace: vi.fn(),
  mockSetAgentRunState: vi.fn(),
  mockGetInterruptedForSession: vi.fn().mockResolvedValue(null),
  mockGetCheckpoint: vi.fn().mockResolvedValue(null),
  mockClaimCheckpoint: vi.fn().mockResolvedValue(null),
  mockDeleteCheckpoint: vi.fn().mockResolvedValue(undefined),
  mockAcquireWorkspaceRunLock: vi.fn(),
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
  mockGetProject: vi.fn().mockResolvedValue(undefined),
  mockVirtuosoMount: vi.fn(),
  mockVirtuosoUnmount: vi.fn(),
  mockVirtuosoProps: vi.fn(),
}));

vi.mock('../../core/useAppContext', async () => {
  const React = await import('react');
  return {
    AppContext: React.createContext({
      actions: {
        createNewSession: mockCreateNewSession,
        updateSession: mockUpdateSession,
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
      flushCheckpoint: mockControllerFlushCheckpoint,
      getState: mockControllerGetInstance,
    };
    return instance;
  }),
  getAgentRunReplayPolicy: mockGetAgentRunReplayPolicy,
}));

vi.mock('../../../services/agentRunCheckpointService', () => ({
  getInterruptedForSession: mockGetInterruptedForSession,
  getCheckpoint: mockGetCheckpoint,
  claimCheckpoint: mockClaimCheckpoint,
  deleteCheckpoint: mockDeleteCheckpoint,
}));

vi.mock('../../../services/workspaceOfflineGuard', () => ({
  LOCAL_WORKSPACE_RUN_ID: 'educare-local-workspace',
}));

vi.mock('../../../services/workspaceRunLock', () => ({
  acquireWorkspaceRunLock: mockAcquireWorkspaceRunLock,
}));

vi.mock('../../../services/htmlProjectStore', () => ({
  htmlProjectStore: {
    getProject: mockGetProject,
  },
}));

vi.mock('../../../services/geometryRenderer', () => ({
  renderGeometryDoc: vi.fn().mockResolvedValue({
    destroy: vi.fn(),
    errors: [],
    warnings: [],
  }),
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
    ...props
  }: {
    data?: unknown[];
    itemContent: (index: number, item: unknown) => unknown;
    [key: string]: unknown;
  }) => {
    const React = require('react');
    mockVirtuosoProps(props);
    React.useEffect(() => {
      mockVirtuosoMount();
      return () => mockVirtuosoUnmount();
    }, []);
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

const buildInterruptedCheckpoint = (
  overrides: Partial<AgentRunCheckpoint> = {},
): AgentRunCheckpoint => ({
  ...interruptedCheckpoint,
  ...overrides,
  committedHistoryDelta:
    overrides.committedHistoryDelta ?? interruptedCheckpoint.committedHistoryDelta,
  toolTrace: overrides.toolTrace ?? interruptedCheckpoint.toolTrace,
  tokenTotals: overrides.tokenTotals ?? interruptedCheckpoint.tokenTotals,
});

const buildRunResult = (
  fullText: string,
  overrides: Partial<AgentRunResult> = {},
): AgentRunResult => ({
  state: completeState,
  fullText,
  finalHistory: [],
  historyDelta: [],
  citations: overrides.citations,
  geometryBoards: overrides.geometryBoards,
  tokenInfo: {
    promptTokenCount: 10,
    candidatesTokenCount: 15,
    ...overrides.tokenInfo,
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

  const clickResume = async () => {
    await userEvent.setup().click(screen.getByRole('button', { name: '繼續' }));
  };

  const clickDiscard = async () => {
    await userEvent.setup().click(screen.getByRole('button', { name: '捨棄並封存' }));
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockControllerRun.mockReset();
    mockAgentRunControllerCtor.mockReset();
    resetWorkspaceDraftMemory();
    const storageValues = new Map<string, string>();
    vi.mocked(window.localStorage.getItem).mockImplementation(
      key => storageValues.get(key) ?? null,
    );
    vi.mocked(window.localStorage.setItem).mockImplementation((key, value) => {
      storageValues.set(key, value);
    });
    vi.mocked(window.localStorage.removeItem).mockImplementation(key => {
      storageValues.delete(key);
    });
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
    mockGetInterruptedForSession.mockResolvedValue(null);
    mockGetCheckpoint.mockResolvedValue(null);
    mockClaimCheckpoint.mockResolvedValue(null);
    mockDeleteCheckpoint.mockResolvedValue(undefined);
    mockGetProject.mockResolvedValue(undefined);
    mockAcquireWorkspaceRunLock.mockResolvedValue({
      acquired: true,
      workspaceId: 'educare-local-workspace',
      lockName: 'agent-run-educare-local-workspace',
      mechanism: 'web-locks',
      release: vi.fn(),
    });
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
        updateSession: mockUpdateSession,
        setActiveProject: mockSetActiveProject,
        setProjectWorkspaceOpen: mockSetProjectWorkspaceOpen,
        setProjectPreview: mockSetProjectPreview,
        appendProjectActivity: mockAppendProjectActivity,
        clearProjectWorkspace: mockClearProjectWorkspace,
        setAgentRunState: mockSetAgentRunState,
      },
    } as unknown as ReturnType<typeof useAppContext>);

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

  it('restores a tab-local draft after unmount when browser storage is unavailable', async () => {
    const storage = window.localStorage;
    vi.mocked(storage.getItem).mockImplementation(() => {
      throw new Error('storage blocked');
    });
    vi.mocked(storage.setItem).mockImplementation(() => {
      throw new Error('storage blocked');
    });

    const draftProps = {
      ...defaultProps,
      session: createMockChatSession({ id: 'draft-storage-failure-session' }),
    };
    const first = render(<ChatContainer {...draftProps} />);
    await userEvent
      .setup()
      .type(screen.getByRole('textbox', { name: '輸入訊息' }), 'Keep this draft');
    first.unmount();

    await waitFor(() => {
      expect(
        readWorkspaceDraft(
          'chat',
          buildChatDraftOwnerId(draftProps.assistantId, draftProps.session.id),
        ).value,
      ).toBe('Keep this draft');
    });

    render(<ChatContainer {...draftProps} />);

    expect(screen.getByRole('textbox', { name: '輸入訊息' })).toHaveValue('Keep this draft');
    expect(screen.getByTestId('chat-draft-persistence-warning')).toHaveTextContent('本分頁');

    vi.mocked(storage.getItem).mockImplementation(() => null);
    vi.mocked(storage.setItem).mockImplementation(() => undefined);
    vi.mocked(storage.removeItem).mockImplementation(() => undefined);
  });

  it('flushes the mounted draft before the 500ms debounce during a workspace export', async () => {
    const draftProps = {
      ...defaultProps,
      session: createMockChatSession({ id: 'predebounce-export-session' }),
    };
    render(<ChatContainer {...draftProps} />);
    const textbox = screen.getByRole('textbox', { name: '輸入訊息' });
    fireEvent.change(textbox, { target: { value: 'captured before debounce' } });

    await withWorkspaceOperation('export', async () => {
      expect(
        readWorkspaceDraft(
          'chat',
          buildChatDraftOwnerId(draftProps.assistantId, draftProps.session.id),
        ).value,
      ).toBe('captured before debounce');
    });
  });

  it('prefers a newer failed-write draft over an older durable draft after remount', async () => {
    const storage = window.localStorage;
    const draftKey = 'test-assistant-1:newer-failed-write-session';
    const durableDraft = JSON.stringify({ [draftKey]: 'Older durable draft' });
    vi.mocked(storage.getItem).mockImplementation(() => durableDraft);
    vi.mocked(storage.setItem).mockImplementation(() => {
      throw new Error('quota exceeded');
    });

    const draftProps = {
      ...defaultProps,
      session: createMockChatSession({ id: 'newer-failed-write-session' }),
    };
    const first = render(<ChatContainer {...draftProps} />);
    const textbox = screen.getByRole('textbox', { name: '輸入訊息' });
    expect(textbox).toHaveValue('Older durable draft');
    await userEvent.setup().clear(textbox);
    await userEvent.setup().type(textbox, 'Newer session draft');
    first.unmount();

    await waitFor(() => {
      expect(
        readWorkspaceDraft(
          'chat',
          buildChatDraftOwnerId(draftProps.assistantId, draftProps.session.id),
        ).value,
      ).toBe('Newer session draft');
    });

    const second = render(<ChatContainer {...draftProps} />);
    expect(screen.getByRole('textbox', { name: '輸入訊息' })).toHaveValue('Newer session draft');

    vi.mocked(storage.setItem).mockImplementation(() => undefined);
    vi.mocked(storage.removeItem).mockImplementation(() => undefined);
    fireEvent.change(screen.getByRole('textbox', { name: '輸入訊息' }), {
      target: { value: '' },
    });
    second.unmount();
  });

  it('does not resurrect a durable draft when clearing fails', async () => {
    const storage = window.localStorage;
    const draftKey = 'test-assistant-1:failed-clear-session';
    const durableDraft = JSON.stringify({ [draftKey]: 'Draft to clear' });
    vi.mocked(storage.getItem).mockImplementation(() => durableDraft);
    vi.mocked(storage.removeItem).mockImplementation(() => {
      throw new Error('storage blocked');
    });

    const draftProps = {
      ...defaultProps,
      session: createMockChatSession({ id: 'failed-clear-session' }),
    };
    const first = render(<ChatContainer {...draftProps} />);
    const textbox = screen.getByRole('textbox', { name: '輸入訊息' });
    expect(textbox).toHaveValue('Draft to clear');
    fireEvent.change(textbox, { target: { value: '' } });
    first.unmount();

    await waitFor(() => {
      expect(
        readWorkspaceDraft(
          'chat',
          buildChatDraftOwnerId(draftProps.assistantId, draftProps.session.id),
        ).value,
      ).toBeUndefined();
    });

    const second = render(<ChatContainer {...draftProps} />);
    expect(screen.getByRole('textbox', { name: '輸入訊息' })).toHaveValue('');

    vi.mocked(storage.removeItem).mockImplementation(() => undefined);
    second.unmount();
  });

  it('resets to the top when switching from history to a fresh session welcome', async () => {
    const { rerender } = render(
      <ChatContainer
        {...defaultProps}
        session={createMockChatSession({
          id: 'history-session',
          messages: [{ role: 'user', content: 'Existing history' }],
        })}
      />,
    );
    const scrollTo = vi.mocked(HTMLElement.prototype.scrollTo);
    scrollTo.mockClear();

    rerender(
      <ChatContainer
        {...defaultProps}
        session={createMockChatSession({ id: 'fresh-session', messages: [] })}
      />,
    );

    await waitFor(() => {
      expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });
    });
    expect(screen.getByTestId('welcome-message')).toBeInTheDocument();

    scrollTo.mockClear();
    rerender(
      <ChatContainer
        {...defaultProps}
        session={createMockChatSession({
          id: 'fresh-session',
          messages: [{ role: 'user', content: 'Fresh first message' }],
        })}
      />,
    );

    await waitFor(() => {
      expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }));
    });
    expect(screen.getByText('Fresh first message')).toBeInTheDocument();
  });

  it('keeps the virtualizer mounted as messages are appended within the same session', async () => {
    const session = createMockChatSession({
      id: 'stable-session',
      messages: [],
    });
    const { rerender } = render(<ChatContainer {...defaultProps} session={session} />);

    await waitFor(() => expect(mockVirtuosoProps).toHaveBeenCalled());
    const initialVirtuosoProps = mockVirtuosoProps.mock.calls.at(-1)?.[0] as {
      customScrollParent?: HTMLElement;
      initialItemCount?: number;
    };
    expect(initialVirtuosoProps.customScrollParent).toBe(
      screen.getByRole('main', { name: '聊天對話' }),
    );
    expect(initialVirtuosoProps.initialItemCount).toBeUndefined();
    expect(mockVirtuosoMount).toHaveBeenCalledTimes(1);
    expect(mockVirtuosoUnmount).not.toHaveBeenCalled();

    const firstMessage = { role: 'user' as const, content: 'First message' };
    rerender(
      <ChatContainer
        {...defaultProps}
        session={{
          ...session,
          messages: [firstMessage],
        }}
      />,
    );

    await waitFor(() => expect(screen.getByText('First message')).toBeInTheDocument());
    expect(mockVirtuosoMount).toHaveBeenCalledTimes(1);
    expect(mockVirtuosoUnmount).not.toHaveBeenCalled();

    rerender(
      <ChatContainer
        {...defaultProps}
        session={{
          ...session,
          messages: [firstMessage, { role: 'model', content: 'Second message' }],
        }}
      />,
    );

    await waitFor(() => expect(screen.getByText('Second message')).toBeInTheDocument());
    expect(mockVirtuosoMount).toHaveBeenCalledTimes(1);
    expect(mockVirtuosoUnmount).not.toHaveBeenCalled();
  });

  it('keeps a long sandbox welcome render scrollable within the chat container', () => {
    render(
      <ChatContainer
        {...defaultProps}
        sandboxMode
        assistantDescription={'Long welcome content. '.repeat(200)}
      />,
    );

    const main = screen.getByRole('main', { name: '聊天對話' });
    expect(screen.getByTestId('welcome-message')).toBeInTheDocument();
    expect(main.parentElement).toHaveClass('flex-1', 'min-h-0');
    expect(main).toHaveClass('overflow-y-auto');
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

  it('keeps both bubbles when sandbox context updates during an Agent run', async () => {
    const sourceSession = createMockChatSession({ id: 'bundle-session', messages: [] });
    let resolveRun: (value: AgentRunResult) => void = () => undefined;
    mockControllerRun.mockImplementationOnce(
      () =>
        new Promise<AgentRunResult>(resolve => {
          resolveRun = resolve;
        }),
    );

    function BundleLikeHarness() {
      const [agentRunState, setAgentRunState] = useState<AgentRunState | null>(null);
      const [persistedSession, setPersistedSession] = useState(sourceSession);
      const actions = {
        createNewSession: mockCreateNewSession,
        updateSession: mockUpdateSession,
        setActiveProject: mockSetActiveProject,
        setProjectWorkspaceOpen: mockSetProjectWorkspaceOpen,
        setProjectPreview: mockSetProjectPreview,
        appendProjectActivity: mockAppendProjectActivity,
        clearProjectWorkspace: mockClearProjectWorkspace,
        setAgentRunState,
      };

      return (
        <AppContext.Provider value={{ state: { agentRunState }, actions } as never}>
          <ChatContainer
            {...defaultProps}
            session={persistedSession}
            sandboxMode
            onNewMessage={async session => {
              setPersistedSession(session);
            }}
          />
        </AppContext.Provider>
      );
    }

    render(<BundleLikeHarness />);
    await sendMessage('Bundle learner question');

    const controllerOptions = mockAgentRunControllerCtor.mock.calls.at(-1)?.[0] as {
      callbacks: { onStateChange: (state: AgentRunState) => void };
    };
    await act(async () => {
      controllerOptions.callbacks.onStateChange({
        ...runningState,
        sessionId: sourceSession.id,
      });
    });
    expect(screen.getByText('Bundle learner question')).toBeInTheDocument();

    await act(async () => {
      resolveRun(buildRunResult('Bundle tutor answer'));
    });

    await waitFor(() => {
      expect(screen.getByText('Bundle tutor answer')).toBeInTheDocument();
    });
    expect(screen.getByText('Bundle learner question')).toBeInTheDocument();
  });

  it('keeps the optimistic user message through normal-mode AppContext action churn and persists it before a provider error', async () => {
    const sourceSession = createMockChatSession({ id: 'normal-session', messages: [] });
    const onNewMessage = vi.fn().mockResolvedValue(undefined);
    const renderedActions: Array<{ setAgentRunState: (state: AgentRunState | null) => void }> = [];
    let rejectRun: (reason?: unknown) => void = () => undefined;

    mockControllerRun.mockImplementationOnce(
      () =>
        new Promise<AgentRunResult>((_resolve, reject) => {
          rejectRun = reject;
        }),
    );

    function NormalModeHarness() {
      const [agentRunState, setAgentRunState] = useState<AgentRunState | null>(null);
      const actions = {
        createNewSession: mockCreateNewSession,
        updateSession: mockUpdateSession,
        setActiveProject: mockSetActiveProject,
        setProjectWorkspaceOpen: mockSetProjectWorkspaceOpen,
        setProjectPreview: mockSetProjectPreview,
        appendProjectActivity: mockAppendProjectActivity,
        clearProjectWorkspace: mockClearProjectWorkspace,
        setAgentRunState,
      };
      renderedActions.push(actions);

      return (
        <AppContext.Provider value={{ state: { agentRunState }, actions } as never}>
          <ChatContainer {...defaultProps} session={sourceSession} onNewMessage={onNewMessage} />
        </AppContext.Provider>
      );
    }

    render(<NormalModeHarness />);
    await sendMessage('Keep this normal-mode question');

    await waitFor(() => {
      expect(mockAgentRunControllerCtor).toHaveBeenCalledTimes(1);
    });
    const controllerOptions = mockAgentRunControllerCtor.mock.calls.at(-1)?.[0] as {
      callbacks: { onStateChange: (state: AgentRunState) => void };
    };

    await act(async () => {
      controllerOptions.callbacks.onStateChange({
        ...runningState,
        sessionId: sourceSession.id,
      });
    });

    const latestActions = renderedActions.at(-1);
    expect(latestActions).not.toBe(renderedActions[0]);
    expect(latestActions?.setAgentRunState).toBe(renderedActions[0].setAgentRunState);
    expect(screen.getByText('Keep this normal-mode question')).toBeInTheDocument();

    await act(async () => {
      rejectRun(new Error('Normal provider failure'));
    });

    await waitFor(() => {
      expect(onNewMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            expect.objectContaining({
              role: 'user',
              content: 'Keep this normal-mode question',
            }),
            expect.objectContaining({
              role: 'model',
              isError: true,
              content: expect.stringContaining('Normal provider failure'),
            }),
          ],
        }),
        'Keep this normal-mode question',
        expect.stringContaining('Normal provider failure'),
        expect.anything(),
      );
    });
  });

  it('shows a jump-to-latest button instead of auto-following when the user scrolls away from the bottom', async () => {
    mockControllerRun.mockImplementationOnce(async () => {
      const options = mockAgentRunControllerCtor.mock.calls.at(-1)?.[0] as {
        callbacks?: { onChunk?: (text: string, turn: number) => void };
      };
      options?.callbacks?.onChunk?.('Chunk while scrolled away', 0);
      return buildRunResult('Final chunked answer');
    });

    const scrollToSpy = vi.spyOn(HTMLElement.prototype, 'scrollTo');
    render(<ChatContainer {...defaultProps} />);

    const main = screen.getByRole('main', { name: '聊天對話' });
    Object.defineProperty(main, 'scrollHeight', { configurable: true, value: 1000 });
    Object.defineProperty(main, 'clientHeight', { configurable: true, value: 200 });
    Object.defineProperty(main, 'scrollTop', { configurable: true, value: 100 });

    fireEvent.scroll(main);
    scrollToSpy.mockClear();

    await sendMessage('Need latest');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '捲動至最新訊息' })).toBeInTheDocument();
    });
    expect(scrollToSpy).not.toHaveBeenCalled();

    await userEvent.setup().click(screen.getByRole('button', { name: '捲動至最新訊息' }));
    expect(scrollToSpy).toHaveBeenCalled();
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

  it('derives agentHarnessEnabled=false and htmlProjectEnabled=false when the session has no active project', async () => {
    render(<ChatContainer {...defaultProps} session={createMockChatSession()} />);

    await sendMessage('Single turn only');

    await waitFor(() => {
      expect(mockAgentRunControllerCtor).toHaveBeenCalledWith(
        expect.objectContaining({ agentHarnessEnabled: false, htmlProjectEnabled: false }),
      );
    });
  });

  it('derives agentHarnessEnabled and htmlProjectEnabled from an active HTML project in the session', async () => {
    render(
      <ChatContainer
        {...defaultProps}
        session={createMockChatSession({ activeProjectId: 'project-42' })}
      />,
    );

    await sendMessage('Continue building');

    await waitFor(() => {
      expect(mockAgentRunControllerCtor).toHaveBeenCalledWith(
        expect.objectContaining({ agentHarnessEnabled: true, htmlProjectEnabled: true }),
      );
    });
  });

  it('prefers an explicit bundle routing override and treats sandbox mode as shared', async () => {
    const routableTargets = [{ id: 'science', name: 'Science', description: 'Tutor' }];
    render(
      <ChatContainer {...defaultProps} sandboxMode routableTargetsOverride={routableTargets} />,
    );

    await sendMessage('Explain gravity');

    await waitFor(() => {
      expect(mockAgentRunControllerCtor).toHaveBeenCalledWith(
        expect.objectContaining({
          routableTargets,
          sharedMode: true,
          projectBootstrapEnabled: false,
        }),
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

  it('renders a live geometry preview, removes failed previews, and keeps only the persisted board after completion', async () => {
    // Arrange
    const previewDocument = {
      title: 'Live triangle preview',
      boundingbox: [-2, 2, 2, -2] as [number, number, number, number],
      objects: [],
    };
    let resolveRun: (result: AgentRunResult) => void;
    mockControllerRun.mockImplementationOnce(
      () =>
        new Promise<AgentRunResult>(resolve => {
          resolveRun = resolve;
        }),
    );

    render(<ChatContainer {...defaultProps} mathToolsEnabled />);
    await sendMessage('Draw a triangle');
    await waitFor(() => expect(mockAgentRunControllerCtor).toHaveBeenCalled());
    const callbacks = (
      mockAgentRunControllerCtor.mock.calls.at(-1)?.[0] as {
        callbacks: {
          onGeometryBoardPreview: (preview: {
            toolCallId: string;
            document: typeof previewDocument;
          }) => void;
          onToolCallActivity: (record: {
            id: string;
            name: string;
            startedAt: number;
            status: 'recoverable_error' | 'failed';
          }) => void;
        };
      }
    ).callbacks;

    // Act & Assert: a normalized preview is visible before the run resolves.
    act(() => {
      callbacks.onGeometryBoardPreview({ toolCallId: 'draw-1', document: previewDocument });
    });
    expect(screen.getByRole('heading', { name: 'Live triangle preview' })).toBeInTheDocument();

    // A recoverable or terminal draw failure discards the corresponding preview.
    act(() => {
      callbacks.onToolCallActivity({
        id: 'draw-1',
        name: 'draw_geometry',
        startedAt: 1,
        status: 'recoverable_error',
      });
    });
    await waitFor(() => {
      expect(
        screen.queryByRole('heading', { name: 'Live triangle preview' }),
      ).not.toBeInTheDocument();
    });
    act(() => {
      callbacks.onGeometryBoardPreview({ toolCallId: 'draw-2', document: previewDocument });
      callbacks.onToolCallActivity({
        id: 'draw-2',
        name: 'draw_geometry',
        startedAt: 2,
        status: 'failed',
      });
    });
    await waitFor(() => {
      expect(
        screen.queryByRole('heading', { name: 'Live triangle preview' }),
      ).not.toBeInTheDocument();
    });

    // A successful persisted board replaces, rather than duplicates, the transient preview.
    act(() => {
      callbacks.onGeometryBoardPreview({ toolCallId: 'draw-3', document: previewDocument });
      resolveRun!(
        buildRunResult('Triangle created.', {
          geometryBoards: [
            {
              id: 'geometry-0-0',
              title: previewDocument.title,
              doc: previewDocument,
              computedPoints: [],
            },
          ],
        }),
      );
    });
    await waitFor(() => {
      expect(screen.getAllByRole('heading', { name: 'Live triangle preview' })).toHaveLength(1);
    });
  });

  it('persists returned citations onto the final assistant message', async () => {
    mockControllerRun.mockResolvedValueOnce(
      buildRunResult('Final response text', {
        citations: [
          {
            marker: 1,
            chunkId: '員工手冊.pdf#0',
            fileName: '員工手冊.pdf',
            chunkIndex: 0,
            excerpt: '特休假規定',
          },
        ],
      }),
    );

    render(<ChatContainer {...defaultProps} />);

    await sendMessage('Finish with citations');

    await waitFor(() => {
      expect(defaultProps.onNewMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'model',
              content: 'Final response text',
              citations: [
                expect.objectContaining({
                  chunkId: '員工手冊.pdf#0',
                  marker: 1,
                }),
              ],
            }),
          ]),
        }),
        'Finish with citations',
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

  it('does not reopen a user-collapsed Canvas when the active project renders again', async () => {
    mockControllerRun.mockImplementationOnce(async () => {
      const options = mockAgentRunControllerCtor.mock.calls.at(-1)?.[0] as {
        callbacks?: {
          onProjectToolActivity?: (update: {
            activeProjectId: string;
            preview: { url: string };
          }) => void;
        };
      };
      options?.callbacks?.onProjectToolActivity?.({
        activeProjectId: 'project-99',
        preview: { url: 'blob:preview-100' },
      });
      return buildRunResult('Rendered without reopening Canvas');
    });

    render(
      <ChatContainer
        {...defaultProps}
        session={{ ...defaultProps.session, activeProjectId: 'project-99' }}
      />,
    );

    await sendMessage('Render the current project again');

    await waitFor(() => {
      expect(mockSetActiveProject).toHaveBeenCalledWith('project-99');
      expect(mockSetProjectPreview).toHaveBeenCalledWith({ url: 'blob:preview-100' });
    });
    expect(mockSetProjectWorkspaceOpen).not.toHaveBeenCalled();
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

  it('renders live subagent activity and persists subagentRuns into the committed assistant message', async () => {
    mockControllerRun.mockImplementationOnce(async () => {
      const options = mockAgentRunControllerCtor.mock.calls.at(-1)?.[0] as {
        callbacks?: {
          onSubagentActivity?: (update: {
            batchId: string;
            runs: Array<{
              id: string;
              batchId: string;
              name: string;
              task: string;
              status: 'running' | 'complete';
              output: string;
              toolSequence: string[];
              durationMs: number;
            }>;
          }) => void;
        };
      };
      options?.callbacks?.onSubagentActivity?.({
        batchId: 'batch-1',
        runs: [
          {
            id: 'run-1',
            batchId: 'batch-1',
            name: 'Researcher',
            task: 'Inspect docs',
            status: 'running',
            output: 'Partial delegated work',
            toolSequence: ['searchKnowledgeBase'],
            durationMs: 5,
          },
        ],
      });
      return buildRunResult('Delegated answer');
    });

    render(<ChatContainer {...defaultProps} />);

    await sendMessage('Delegate this');

    // Wait for the run to finish committing so only the persisted timeline remains.
    await waitFor(() => {
      expect(defaultProps.onNewMessage).toHaveBeenCalled();
    });
    expect(screen.getByText('代理活動')).toBeInTheDocument();
    expect(screen.getByText('1 個子任務')).toBeInTheDocument();

    // The committed timeline is collapsed by default; expand it to see the run row.
    fireEvent.click(screen.getByRole('button', { name: /代理活動/ }));
    expect(screen.getByText('Researcher')).toBeInTheDocument();

    await waitFor(() => {
      expect(defaultProps.onNewMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'model',
              content: 'Delegated answer',
              subagentRuns: [
                expect.objectContaining({
                  id: 'run-1',
                  batchId: 'batch-1',
                  name: 'Researcher',
                }),
              ],
            }),
          ]),
        }),
        'Delegate this',
        'Delegated answer',
        expect.objectContaining({ promptTokenCount: 10, candidatesTokenCount: 15 }),
      );
    });
  });

  it('renders live tool activity and persists toolCallLog into the committed assistant message', async () => {
    mockControllerRun.mockImplementationOnce(async () => {
      const options = mockAgentRunControllerCtor.mock.calls.at(-1)?.[0] as {
        callbacks?: {
          onToolCallActivity?: (record: {
            id: string;
            name: string;
            startedAt: number;
            status: 'running' | 'ok' | 'recoverable_error' | 'failed';
            code?: string;
            summary?: string;
            durationMs?: number;
          }) => void;
        };
      };
      options?.callbacks?.onToolCallActivity?.({
        id: 'tool-1',
        name: 'getProjectSummary',
        startedAt: 1700000000000,
        status: 'running',
        summary: 'Inspecting current project',
        durationMs: 8,
      });
      options?.callbacks?.onToolCallActivity?.({
        id: 'tool-2',
        name: 'lintProject',
        startedAt: 1700000000100,
        status: 'recoverable_error',
        code: 'lint-path-not-found',
        summary: 'lintProject could not find 1 requested path(s).',
        durationMs: 20,
      });
      return buildRunResult('Tool-assisted answer');
    });

    render(<ChatContainer {...defaultProps} />);

    await sendMessage('Use tools');

    // Wait for the run to finish committing so only the persisted timeline remains.
    await waitFor(() => {
      expect(defaultProps.onNewMessage).toHaveBeenCalled();
    });
    expect(screen.getByText('代理活動')).toBeInTheDocument();
    expect(await screen.findByText('2 個步驟')).toBeInTheDocument();

    // The committed timeline is collapsed by default; expand it to see the step rows.
    fireEvent.click(screen.getByRole('button', { name: /代理活動/ }));
    expect(screen.getByText('getProjectSummary')).toBeInTheDocument();
    expect(screen.getByText('lintProject')).toBeInTheDocument();

    await waitFor(() => {
      expect(defaultProps.onNewMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'model',
              content: 'Tool-assisted answer',
              toolCallLog: [
                expect.objectContaining({
                  id: 'tool-1',
                  name: 'getProjectSummary',
                  status: 'running',
                }),
                expect.objectContaining({
                  id: 'tool-2',
                  name: 'lintProject',
                  status: 'recoverable_error',
                  code: 'lint-path-not-found',
                }),
              ],
            }),
          ]),
        }),
        'Use tools',
        'Tool-assisted answer',
        expect.objectContaining({ promptTokenCount: 10, candidatesTokenCount: 15 }),
      );
    });
  });

  it('renders the pending askUser card, resolves the user answer, and persists clarifyRecords', async () => {
    let resolveRun: (value: AgentRunResult) => void = () => undefined;
    let answerPromise: Promise<{ kind: string; label?: string } | null> | null = null;
    mockControllerRun.mockImplementationOnce(async () => {
      const options = mockAgentRunControllerCtor.mock.calls.at(-1)?.[0] as {
        callbacks?: {
          onClarifyRequest?: (
            request: {
              question: string;
              options: Array<{ label: string; description?: string }>;
              allowCustomAnswer: boolean;
            },
            context: { toolCallId: string },
          ) => Promise<{ kind: 'option'; label: string } | null>;
        };
      };
      const onClarifyRequest = options?.callbacks?.onClarifyRequest;
      if (onClarifyRequest) {
        answerPromise = onClarifyRequest(
          {
            question: '要使用哪種主題？',
            options: [{ label: '亮色' }, { label: '暗色' }],
            allowCustomAnswer: true,
          },
          { toolCallId: 'askUser-1-1' },
        );
      }
      return new Promise<AgentRunResult>(resolve => {
        resolveRun = resolve;
      });
    });

    render(<ChatContainer {...defaultProps} />);

    await sendMessage('Build a page');

    // The interactive question card appears while the run is pending.
    const card = await screen.findByTestId('clarify-question-card');
    expect(card).toHaveAttribute('data-pending', 'true');
    expect(screen.getByText('要使用哪種主題？')).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', { name: /暗色/ }));

    await waitFor(() => {
      expect(answerPromise).resolves.toEqual({ kind: 'option', label: '暗色' });
    });

    // Answering dismisses the interactive card; finishing the run persists the record.
    resolveRun({
      ...buildRunResult('Answered response'),
      clarifyRecords: [
        {
          id: 'clarify-0-0',
          request: {
            question: '要使用哪種主題？',
            options: [{ label: '亮色' }, { label: '暗色' }],
            allowCustomAnswer: true,
          },
          answer: { kind: 'option', label: '暗色' },
        },
      ],
    });

    await waitFor(() => {
      expect(defaultProps.onNewMessage).toHaveBeenCalled();
    });
    const staticCard = await screen.findByTestId('clarify-question-card');
    expect(staticCard).not.toHaveAttribute('data-pending');
    expect(defaultProps.onNewMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'model',
            content: 'Answered response',
            clarifyRecords: [
              expect.objectContaining({ answer: { kind: 'option', label: '暗色' } }),
            ],
          }),
        ]),
      }),
      'Build a page',
      'Answered response',
      expect.objectContaining({ promptTokenCount: 10, candidatesTokenCount: 15 }),
    );
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

  it('persists visible error messages with isError instead of empty assistant bubbles', async () => {
    const onNewMessage = vi.fn().mockResolvedValue(undefined);
    mockControllerRun.mockRejectedValueOnce(
      new Error('Gemini terminal response had no visible text'),
    );

    render(<ChatContainer {...defaultProps} onNewMessage={onNewMessage} />);

    await sendMessage('Persist the failure');

    await waitFor(() => {
      expect(onNewMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'model',
              isError: true,
              content: expect.stringContaining('Gemini terminal response had no visible text'),
            }),
          ]),
        }),
        'Persist the failure',
        expect.stringContaining('Gemini terminal response had no visible text'),
        expect.anything(),
      );
    });

    const persistedSession = onNewMessage.mock.calls.at(-1)?.[0];
    render(<ChatContainer {...defaultProps} session={persistedSession} />);
    expect(screen.getAllByText('系統錯誤').length).toBeGreaterThan(0);
  });

  it('shows a render-only empty-response notice without persisting a placeholder message', async () => {
    const onNewMessage = vi.fn().mockResolvedValue(undefined);
    mockControllerRun.mockResolvedValueOnce(buildRunResult(''));

    render(<ChatContainer {...defaultProps} onNewMessage={onNewMessage} />);

    await sendMessage('Trigger empty response');

    await waitFor(() => {
      expect(screen.getByText('（本次回覆沒有內容）')).toBeInTheDocument();
    });

    expect(onNewMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.not.arrayContaining([
          expect.objectContaining({ content: '（本次回覆沒有內容）' }),
        ]),
      }),
      'Trigger empty response',
      '',
      expect.anything(),
    );
  });

  it('persists a model message when an empty response includes geometry boards', async () => {
    // Arrange
    const onNewMessage = vi.fn().mockResolvedValue(undefined);
    const geometryBoards = [
      {
        id: 'geometry-1',
        title: 'Unit circle',
        doc: {
          title: 'Unit circle',
          boundingbox: [-2, 2, 2, -2] as [number, number, number, number],
          objects: [],
        },
        computedPoints: [],
      },
    ];
    mockControllerRun.mockResolvedValueOnce(buildRunResult('', { geometryBoards }));

    render(<ChatContainer {...defaultProps} onNewMessage={onNewMessage} />);

    // Act
    await sendMessage('Draw a unit circle');

    // Assert
    await waitFor(() => {
      expect(onNewMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'model',
              content: '',
              geometryBoards,
            }),
          ]),
        }),
        'Draw a unit circle',
        '',
        expect.anything(),
      );
    });
  });

  it('keeps the checkpoint when final session persistence fails after a completed run', async () => {
    mockGetInterruptedForSession.mockResolvedValueOnce(
      buildInterruptedCheckpoint({ runId: 'run-persist-failure' }),
    );
    const persistenceError = new Error('session persistence failed');
    const onNewMessage = vi.fn().mockRejectedValueOnce(persistenceError);
    mockControllerRun.mockResolvedValueOnce(buildRunResult('Recovered response'));

    render(<ChatContainer {...defaultProps} onNewMessage={onNewMessage} />);
    await screen.findByTestId('resume-run-banner');

    await clickResume();

    await waitFor(() => {
      expect(screen.getByText(/session persistence failed/)).toBeInTheDocument();
    });
    expect(onNewMessage).toHaveBeenCalled();
    expect(mockDeleteCheckpoint).not.toHaveBeenCalledWith('run-persist-failure');
    expect(screen.getByTestId('resume-run-banner')).toBeInTheDocument();
  });

  it('flushes checkpoints on pagehide and hidden visibility changes while a run is active', async () => {
    let resolveRun: (value: AgentRunResult) => void = () => undefined;
    let stateChange: ((state: AgentRunState) => void) | null = null;
    mockControllerRun.mockImplementationOnce(
      async () =>
        new Promise<AgentRunResult>(resolve => {
          resolveRun = resolve;
        }),
    );
    mockAgentRunControllerCtor.mockImplementationOnce((options: unknown) => {
      const opts = options as { callbacks?: { onStateChange?: (s: AgentRunState) => void } };
      stateChange = opts.callbacks?.onStateChange ?? null;
      return {
        run: mockControllerRun,
        stop: mockControllerStop,
        flushCheckpoint: mockControllerFlushCheckpoint,
        getState: mockControllerGetInstance,
      } as Partial<AgentRunController>;
    });

    render(<ChatContainer {...defaultProps} />);
    await sendMessage('Trigger lifecycle flush');

    await act(async () => {
      stateChange?.(runningState);
    });

    window.dispatchEvent(new Event('pagehide'));
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));

    await waitFor(() => {
      expect(mockControllerFlushCheckpoint).toHaveBeenCalledWith(true);
    });
    expect(mockControllerFlushCheckpoint.mock.calls.length).toBeGreaterThanOrEqual(2);

    await act(async () => {
      resolveRun(buildRunResult('Flushed run'));
    });
  });

  it('warns on beforeunload only while the controller reports a running state', async () => {
    let resolveRun: (value: AgentRunResult) => void = () => undefined;
    let stateChange: ((state: AgentRunState) => void) | null = null;
    mockControllerGetInstance.mockReturnValue({ status: 'running' });
    mockControllerRun.mockImplementationOnce(
      async () =>
        new Promise<AgentRunResult>(resolve => {
          resolveRun = resolve;
        }),
    );
    mockAgentRunControllerCtor.mockImplementationOnce((options: unknown) => {
      const opts = options as { callbacks?: { onStateChange?: (s: AgentRunState) => void } };
      stateChange = opts.callbacks?.onStateChange ?? null;
      return {
        run: mockControllerRun,
        stop: mockControllerStop,
        flushCheckpoint: mockControllerFlushCheckpoint,
        getState: mockControllerGetInstance,
      } as Partial<AgentRunController>;
    });

    render(<ChatContainer {...defaultProps} />);
    await sendMessage('Before unload');

    await act(async () => {
      stateChange?.(runningState);
    });

    const beforeUnloadEvent = new Event('beforeunload') as Event & {
      returnValue: boolean;
    };
    const preventDefaultSpy = vi.fn();
    Object.defineProperty(beforeUnloadEvent, 'preventDefault', {
      value: preventDefaultSpy,
      configurable: true,
    });

    window.dispatchEvent(beforeUnloadEvent);

    await waitFor(() => {
      expect(preventDefaultSpy).toHaveBeenCalled();
      expect(mockControllerFlushCheckpoint).toHaveBeenCalledWith(true);
    });
    expect(beforeUnloadEvent.returnValue).toBe(true);

    await act(async () => {
      resolveRun(buildRunResult('Warn me'));
    });
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

  it('renders a resume banner for a stale interrupted run', async () => {
    mockGetInterruptedForSession.mockResolvedValueOnce(interruptedCheckpoint);

    render(<ChatContainer {...defaultProps} />);

    expect(await screen.findByTestId('resume-run-banner')).toBeInTheDocument();
    expect(screen.getByText(/上次工作在第 2\/5 回合中斷/)).toBeInTheDocument();
    expect(screen.getByText('Partial output')).toBeInTheDocument();
  });

  it('hides the resume banner when there is no stale interrupted checkpoint', async () => {
    mockGetInterruptedForSession.mockResolvedValueOnce(null);

    render(<ChatContainer {...defaultProps} />);

    await waitFor(() => {
      expect(mockGetInterruptedForSession).toHaveBeenCalledWith(defaultProps.session.id);
    });
    expect(screen.queryByTestId('resume-run-banner')).not.toBeInTheDocument();
  });

  it('auto-deletes completed checkpoints whose last committed message already matches the session tail', async () => {
    mockGetInterruptedForSession.mockResolvedValueOnce(
      buildInterruptedCheckpoint({
        status: 'complete',
        committedHistoryDelta: [{ role: 'model', content: 'Already persisted turn' }],
      }),
    );

    const session = createMockChatSession({
      messages: [{ role: 'model', content: 'Already persisted turn' }],
    });

    render(<ChatContainer {...defaultProps} session={session} />);

    await waitFor(() => {
      expect(mockDeleteCheckpoint).toHaveBeenCalledWith('run-interrupted');
    });
    expect(screen.queryByTestId('resume-run-banner')).not.toBeInTheDocument();
  });

  it('resumes by merging the original user message before committed history and using checkpoint flags', async () => {
    const checkpoint = buildInterruptedCheckpoint({
      projectId: 'project-77',
      agentHarnessEnabled: false,
      sharedMode: true,
      committedHistoryDelta: [
        { role: 'user', content: 'Resume this task', synthetic: true },
        { role: 'model', content: 'First completed turn', agentTurnLog: 'tools: inspect' },
      ],
    });
    mockGetInterruptedForSession.mockResolvedValueOnce(checkpoint);
    mockGetProject.mockResolvedValueOnce({ id: 'project-77' });
    mockControllerRun.mockResolvedValueOnce({
      ...buildRunResult('Resumed final response'),
      state: {
        ...completeState,
        runId: checkpoint.runId,
      },
    });

    render(
      <ChatContainer
        {...defaultProps}
        session={createMockChatSession({ activeProjectId: 'project-42' })}
      />,
    );
    await screen.findByTestId('resume-run-banner');
    expect(mockAgentRunControllerCtor).not.toHaveBeenCalled();

    await clickResume();

    await waitFor(() => {
      expect(mockAgentRunControllerCtor).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Resume this task',
          activeProjectId: 'project-77',
          agentHarnessEnabled: false,
          sharedMode: true,
          resumeFrom: checkpoint,
          history: [
            expect.objectContaining({ role: 'user', content: 'Resume this task' }),
            expect.objectContaining({ role: 'model', content: 'First completed turn' }),
          ],
        }),
      );
      expect(defaultProps.onNewMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'user', content: 'Resume this task' }),
            expect.objectContaining({ role: 'model', content: 'First completed turn' }),
            expect.objectContaining({ role: 'model', content: 'Resumed final response' }),
          ]),
        }),
        'Resume this task',
        'Resumed final response',
        expect.anything(),
      );
    });
    const ctorArgs = mockAgentRunControllerCtor.mock.calls.at(-1)?.[0] as {
      history: Array<{ role: string; content: string }>;
    };
    expect(
      ctorArgs.history.filter(
        message => message.role === 'user' && message.content === 'Resume this task',
      ),
    ).toHaveLength(1);
    expect(ctorArgs.history.some(message => message.content.includes('⚠️ 上次工作已中斷'))).toBe(
      false,
    );
    expect(mockDeleteCheckpoint).toHaveBeenCalledWith('run-interrupted');
  });

  it('resumes turn-zero checkpoints without replaying the original message into controller history', async () => {
    const checkpoint = buildInterruptedCheckpoint({
      turnIndex: 0,
      committedHistoryDelta: [],
    });
    mockGetInterruptedForSession.mockResolvedValueOnce(checkpoint);
    const session = createMockChatSession({
      messages: [{ role: 'model', content: 'Existing session context' }],
    });

    render(<ChatContainer {...defaultProps} session={session} />);
    await screen.findByTestId('resume-run-banner');

    await clickResume();

    await waitFor(() => {
      expect(mockAgentRunControllerCtor).toHaveBeenCalledWith(
        expect.objectContaining({
          history: [{ role: 'model', content: 'Existing session context' }],
        }),
      );
    });
  });

  it('clears only the captured session draft after a successful checkpoint resume', async () => {
    const resumeOwner = buildChatDraftOwnerId('test-assistant-1', 'test-session-1');
    const otherOwner = buildChatDraftOwnerId('test-assistant-1', 'other-session');
    writeWorkspaceDraft('chat', resumeOwner, 'resume draft');
    writeWorkspaceDraft('chat', otherOwner, 'other session draft');
    mockGetInterruptedForSession.mockResolvedValueOnce(interruptedCheckpoint);

    render(<ChatContainer {...defaultProps} />);
    await screen.findByTestId('resume-run-banner');
    await clickResume();

    await waitFor(() => {
      expect(mockDeleteCheckpoint).toHaveBeenCalledWith('run-interrupted');
      expect(readWorkspaceDraft('chat', resumeOwner).value).toBeUndefined();
      expect(readWorkspaceDraft('chat', otherOwner).value).toBe('other session draft');
    });
  });

  it('shows an active-run error when a resume Web Lock is unavailable in another tab', async () => {
    mockGetInterruptedForSession.mockResolvedValueOnce(interruptedCheckpoint);
    mockAcquireWorkspaceRunLock.mockResolvedValueOnce({
      acquired: false,
      workspaceId: 'educare-local-workspace',
      lockName: 'agent-run-educare-local-workspace',
      mechanism: 'web-locks',
      release: vi.fn(),
    });

    render(<ChatContainer {...defaultProps} />);
    await screen.findByTestId('resume-run-banner');

    await clickResume();

    await waitFor(() => {
      expect(mockAcquireWorkspaceRunLock).toHaveBeenCalledWith('educare-local-workspace', {
        ifAvailable: true,
      });
      expect(mockControllerRun).not.toHaveBeenCalled();
    });
    expect(screen.getByText(/工作仍在其他分頁進行中/)).toBeInTheDocument();
    expect(mockSetAgentRunState).toHaveBeenCalledWith(null);
    expect(mockClaimCheckpoint).not.toHaveBeenCalled();
  });

  it('fails closed when Web Locks are unavailable instead of claiming a checkpoint fallback', async () => {
    mockGetInterruptedForSession.mockResolvedValueOnce(interruptedCheckpoint);
    mockAcquireWorkspaceRunLock.mockResolvedValueOnce({
      acquired: false,
      workspaceId: 'educare-local-workspace',
      lockName: 'agent-run-educare-local-workspace',
      mechanism: 'unavailable',
      release: vi.fn(),
    });
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      writable: true,
      value: undefined,
    });

    render(<ChatContainer {...defaultProps} />);
    await screen.findByTestId('resume-run-banner');

    await clickResume();

    await waitFor(() => {
      expect(mockAcquireWorkspaceRunLock).toHaveBeenCalledWith('educare-local-workspace', {
        ifAvailable: true,
      });
      expect(mockControllerRun).not.toHaveBeenCalled();
    });
    expect(screen.getByText(/瀏覽器不支援安全的工作鎖/)).toBeInTheDocument();
    expect(mockClaimCheckpoint).not.toHaveBeenCalled();
  });

  it('disables resume and clears workspace when the checkpoint project is missing', async () => {
    const checkpoint = buildInterruptedCheckpoint({ projectId: 'project-missing' });
    mockGetInterruptedForSession.mockResolvedValueOnce(checkpoint);
    mockGetProject.mockResolvedValueOnce(undefined);

    render(
      <ChatContainer
        {...defaultProps}
        session={createMockChatSession({ activeProjectId: 'project-missing', title: 'New Chat' })}
      />,
    );
    await screen.findByTestId('resume-run-banner');

    expect(
      screen.getByText('原本的 HTML 專案已不存在，只能捨棄並封存這次中斷紀錄。'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '繼續' })).toBeDisabled();

    await clickDiscard();

    await waitFor(() => {
      expect(mockUpdateSession).toHaveBeenCalledWith(
        expect.objectContaining({
          activeProjectId: null,
          title: 'Resume this task',
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'user', content: 'Resume this task' }),
            expect.objectContaining({ role: 'model', content: 'First completed turn' }),
            expect.objectContaining({
              role: 'model',
              content: '⚠️ 上次工作已中斷（第 2/5 回合）。',
              synthetic: true,
            }),
          ]),
        }),
      );
      expect(mockSetActiveProject).toHaveBeenCalledWith(null);
      expect(mockSetProjectWorkspaceOpen).toHaveBeenCalledWith(false);
      expect(mockClearProjectWorkspace).toHaveBeenCalled();
      expect(mockDeleteCheckpoint).toHaveBeenCalledWith('run-interrupted');
    });
    expect(screen.queryByTestId('resume-run-banner')).not.toBeInTheDocument();
  });

  it('disables resume once the checkpoint already reached max turns', async () => {
    mockGetInterruptedForSession.mockResolvedValueOnce(
      buildInterruptedCheckpoint({ turnIndex: 5, maxTurns: 5 }),
    );

    render(<ChatContainer {...defaultProps} />);
    await screen.findByTestId('resume-run-banner');

    expect(
      screen.getByText('這次工作已達目前的軟預算；請提高相應上限後再續跑。'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '繼續' })).toBeDisabled();
  });

  it('discards interrupted work before sending a new message and archives the interruption', async () => {
    mockGetInterruptedForSession.mockResolvedValue(interruptedCheckpoint);

    render(
      <ChatContainer {...defaultProps} session={createMockChatSession({ title: 'New Chat' })} />,
    );
    await screen.findByTestId('resume-run-banner');

    await sendMessage('New message after crash');

    await waitFor(() => {
      expect(mockUpdateSession).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Resume this task',
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'user', content: 'Resume this task' }),
            expect.objectContaining({ role: 'model', content: 'First completed turn' }),
            expect.objectContaining({
              role: 'model',
              content: '⚠️ 上次工作已中斷（第 2/5 回合）。',
              synthetic: true,
            }),
          ]),
        }),
      );
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

  describe('handoff auto-kickoff', () => {
    const createHandoffSession = (overrides: Parameters<typeof createMockChatSession>[0] = {}) =>
      createMockChatSession({
        id: 'handoff-session-1',
        handoffContext: {
          fromAssistantId: 'source-assistant-1',
          fromAssistantName: 'Source Assistant',
          reason: 'Needs a specialist',
          summary: 'User needs help filing quarterly taxes',
          sourceSessionId: 'source-session-1',
          createdAt: 1640995200000,
        },
        ...overrides,
      });

    it('auto-sends the handoff summary as the first message exactly once for an empty handoff session', async () => {
      const session = createHandoffSession();

      const { rerender } = render(<ChatContainer {...defaultProps} session={session} />);

      await waitFor(() => {
        expect(mockAgentRunControllerCtor).toHaveBeenCalled();
      });

      const options = mockAgentRunControllerCtor.mock.calls.at(-1)?.[0] as {
        message: string;
        history: ChatMessage[];
        systemPrompt: string;
        sessionId: string;
      };
      expect(options.message).toBe('User needs help filing quarterly taxes');
      expect(options.history).toEqual([]);
      expect(options.systemPrompt).toContain('[HANDOFF FROM Source Assistant]');
      expect(options.sessionId).toBe('handoff-session-1');

      // Wait for the auto-run to commit so state settles before re-rendering.
      await waitFor(() => {
        expect(defaultProps.onNewMessage).toHaveBeenCalled();
      });

      // Re-render with identical props: the session-id ref guard must prevent a second run.
      rerender(<ChatContainer {...defaultProps} session={session} />);
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
      });

      expect(mockAgentRunControllerCtor).toHaveBeenCalledTimes(1);
    });

    it('does not auto-send for an empty session without handoffContext', async () => {
      render(<ChatContainer {...defaultProps} session={createMockChatSession()} />);

      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
      });

      expect(mockAgentRunControllerCtor).not.toHaveBeenCalled();
    });

    it('does not auto-send when the handoff session already has messages', async () => {
      const session = createHandoffSession({
        messages: [
          { role: 'user', content: 'User needs help filing quarterly taxes' },
          { role: 'model', content: 'Sure, let me walk you through it.' },
        ],
      });

      render(<ChatContainer {...defaultProps} session={session} />);

      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
      });

      expect(mockAgentRunControllerCtor).not.toHaveBeenCalled();
    });
  });

  describe('run-session isolation', () => {
    const createDeferredRun = () => {
      let resolveRun: (value: AgentRunResult) => void = () => undefined;
      mockControllerRun.mockImplementationOnce(
        async () =>
          new Promise<AgentRunResult>(resolve => {
            resolveRun = resolve;
          }),
      );
      return { resolve: (value: AgentRunResult) => resolveRun(value) };
    };

    const startRunInSessionA = async () => {
      const sessionA = createMockChatSession({ id: 'session-a' });
      const deferred = createDeferredRun();

      const view = render(<ChatContainer {...defaultProps} session={sessionA} />);
      await sendMessage('Question in session A');

      await waitFor(() => {
        expect(mockAgentRunControllerCtor).toHaveBeenCalledTimes(1);
      });

      return { ...view, deferred };
    };

    it('stops the in-flight run with session-switch when the session prop changes mid-run', async () => {
      const { rerender, deferred } = await startRunInSessionA();

      rerender(
        <ChatContainer {...defaultProps} session={createMockChatSession({ id: 'session-b' })} />,
      );

      await waitFor(() => {
        expect(mockControllerStop).toHaveBeenCalledWith('session-switch');
      });

      // Settle the pending run so the component finishes committing.
      await act(async () => {
        deferred.resolve(buildRunResult('Stopped late'));
      });
    });

    it('persists a late run result into its own session without polluting the new session', async () => {
      const { rerender, deferred } = await startRunInSessionA();

      rerender(
        <ChatContainer {...defaultProps} session={createMockChatSession({ id: 'session-b' })} />,
      );

      await act(async () => {
        deferred.resolve(buildRunResult('Late reply'));
      });

      await waitFor(() => {
        expect(defaultProps.onNewMessage).toHaveBeenCalled();
      });

      const finalSession = defaultProps.onNewMessage.mock.calls.at(-1)?.[0] as {
        id: string;
        messages: ChatMessage[];
      };
      expect(finalSession.id).toBe('session-a');
      expect(finalSession.messages.at(-1)).toEqual(
        expect.objectContaining({ role: 'model', content: 'Late reply' }),
      );

      // The displayed session B view must not render the old run's result.
      expect(screen.queryByText(/Late reply/)).toBeNull();
    });

    it('does not restore source input or clear the destination draft after a late success', async () => {
      const sourceOwner = buildChatDraftOwnerId('test-assistant-1', 'session-a');
      const destinationOwner = buildChatDraftOwnerId('test-assistant-1', 'session-b');
      writeWorkspaceDraft('chat', sourceOwner, 'source draft');
      writeWorkspaceDraft('chat', destinationOwner, 'destination draft');

      const { rerender, deferred } = await startRunInSessionA();
      rerender(
        <ChatContainer {...defaultProps} session={createMockChatSession({ id: 'session-b' })} />,
      );

      await waitFor(() => {
        expect(screen.getByRole('textbox', { name: '輸入訊息' })).toHaveValue('destination draft');
      });

      await act(async () => {
        deferred.resolve(buildRunResult('Late success from A'));
      });

      await waitFor(() => {
        expect(readWorkspaceDraft('chat', destinationOwner).value).toBe('destination draft');
        expect(screen.getByRole('textbox', { name: '輸入訊息' })).toHaveValue('destination draft');
      });
      expect(readWorkspaceDraft('chat', sourceOwner).value).toBeUndefined();
    });

    it('does not restore source input or clear the destination draft after a late failure', async () => {
      let rejectRun: (error: Error) => void = () => undefined;
      mockControllerRun.mockImplementationOnce(
        async () =>
          new Promise<AgentRunResult>((_resolve, reject) => {
            rejectRun = reject;
          }),
      );
      const destinationOwner = buildChatDraftOwnerId('test-assistant-1', 'session-b');
      writeWorkspaceDraft('chat', destinationOwner, 'destination draft after failure');

      const { rerender } = await startRunInSessionA();
      rerender(
        <ChatContainer {...defaultProps} session={createMockChatSession({ id: 'session-b' })} />,
      );

      await waitFor(() => {
        expect(screen.getByRole('textbox', { name: '輸入訊息' })).toHaveValue(
          'destination draft after failure',
        );
      });

      await act(async () => {
        rejectRun(new Error('late failure from A'));
      });

      await waitFor(() => {
        expect(screen.getByRole('textbox', { name: '輸入訊息' })).toHaveValue(
          'destination draft after failure',
        );
        expect(readWorkspaceDraft('chat', destinationOwner).value).toBe(
          'destination draft after failure',
        );
      });
    });

    it('ignores onChunk from the old run after switching sessions', async () => {
      const { rerender, deferred } = await startRunInSessionA();

      rerender(
        <ChatContainer {...defaultProps} session={createMockChatSession({ id: 'session-b' })} />,
      );

      const oldRunOptions = mockAgentRunControllerCtor.mock.calls.at(0)?.[0] as {
        callbacks: { onChunk: (text: string, turn: number) => void };
      };

      await act(async () => {
        oldRunOptions.callbacks.onChunk('LEAKED', 0);
      });

      expect(screen.queryByText(/LEAKED/)).toBeNull();

      // Settle the pending run so the component finishes committing.
      await act(async () => {
        deferred.resolve(buildRunResult('Late reply after leak attempt'));
      });
      await waitFor(() => {
        expect(defaultProps.onNewMessage).toHaveBeenCalled();
      });
    });

    it('auto-kicks off an empty handoff session after the old run finishes committing', async () => {
      const { rerender, deferred } = await startRunInSessionA();

      const handoffSession = createMockChatSession({
        id: 'handoff-b',
        messages: [],
        handoffContext: {
          fromAssistantId: 'source-assistant-1',
          fromAssistantName: 'Source Assistant',
          reason: 'Needs a specialist',
          summary: 'Handoff kickoff question',
          sourceSessionId: 'source-session-1',
          createdAt: 1640995200000,
        },
      });
      rerender(<ChatContainer {...defaultProps} session={handoffSession} />);

      // While the old run is still pending (isLoading), the kickoff must wait.
      expect(mockAgentRunControllerCtor).toHaveBeenCalledTimes(1);

      await act(async () => {
        deferred.resolve(buildRunResult('Old answer'));
      });

      await waitFor(() => {
        expect(mockAgentRunControllerCtor).toHaveBeenCalledTimes(2);
      });

      const kickoffOptions = mockAgentRunControllerCtor.mock.calls.at(-1)?.[0] as {
        message: string;
        sessionId: string;
      };
      expect(kickoffOptions.message).toBe('Handoff kickoff question');
      expect(kickoffOptions.sessionId).toBe('handoff-b');
    });
  });
});
