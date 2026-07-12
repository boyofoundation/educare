import { act, render, screen, waitFor } from '@testing-library/react';
import React, { useReducer } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BundleRunner from './BundleRunner';
import { AppContext } from '../core/useAppContext';
import type { AppAction, AppContextValue, AppState } from '../core/AppContext.types';
import type { AgentBundle, ChatSession } from '../../types';

const { actions, db, providers, chat } = vi.hoisted(() => ({
  actions: { updateSession: vi.fn() },
  db: {
    getBundle: vi.fn(),
    getSessionsForAssistant: vi.fn(),
    saveBundle: vi.fn(),
    saveSession: vi.fn(),
  },
  providers: { initializeProviders: vi.fn(), isLLMAvailable: vi.fn() },
  chat: vi.fn(),
}));
vi.mock('../../services/db', () => db);
vi.mock('../../services/providerRegistry', () => providers);
vi.mock('../chat', () => ({
  ChatContainer: (props: {
    assistantId: string;
    assistantName: string;
    onAcceptRouteProposal: (proposal: import('../../types').RouteProposal) => void;
    onNewMessage: (session: ChatSession) => Promise<void>;
    ragChunks: import('../../types').RagChunk[];
    session: ChatSession;
    sandboxMode?: boolean;
  }) => {
    chat(props);
    return <div data-testid='bundle-chat'>{`${props.assistantName}:${props.session.id}`}</div>;
  },
}));

const bundle = (): AgentBundle => ({
  manifest: {
    format: 'educare-agent-bundle',
    schemaVersion: 1,
    name: 'STEM',
    description: 'Team',
    version: '1.0.0',
    exportedAt: 1,
    entryAgentId: 'bundle-1:entry',
  },
  agents: [
    {
      id: 'bundle-1:entry',
      name: 'Entry tutor',
      description: 'Routes questions.',
      systemPrompt: 'Help.',
      starterPrompts: [],
      ragChunks: [],
    },
  ],
  routes: [],
});

const routedBundle = (): AgentBundle => ({
  ...bundle(),
  agents: [
    ...bundle().agents,
    {
      id: 'bundle-1:math',
      name: 'Math tutor',
      description: 'Explains mathematics.',
      systemPrompt: 'Teach maths.',
      starterPrompts: [],
      ragChunks: [{ fileName: 'math.md', content: 'Pythagorean theorem.' }],
    },
  ],
  routes: [{ fromAgentId: 'bundle-1:entry', toAgentId: 'bundle-1:math' }],
});

const sourceSessionWithProposal = (
  proposal: Partial<import('../../types').RouteProposal> = {},
  session: Partial<ChatSession> = {},
): ChatSession => {
  const id = session.id ?? 'source-session';
  return {
    id,
    assistantId: 'bundle-1:entry',
    title: 'Source',
    messages: [
      {
        role: 'model',
        content: 'I recommend the math tutor.',
        routeProposal: {
          targetAssistantId: 'bundle-1:math',
          targetAssistantName: 'Math tutor',
          reason: 'Needs math help.',
          handoffSummary: 'The learner needs help with right triangles.',
          sourceAssistantId: 'bundle-1:entry',
          sourceSessionId: id,
          status: 'pending',
          createdAt: 123,
          ...proposal,
        },
      },
    ],
    createdAt: 100,
    tokenCount: 0,
    ...session,
  };
};

const state: AppState = {
  assistants: [],
  currentAssistant: null,
  sessions: [],
  currentSession: null,
  viewMode: 'new_assistant',
  isLoading: false,
  error: null,
  isShared: false,
  sharedAssistantId: null,
  bundleMode: { bundleId: 'bundle-1' },
  isSidebarOpen: true,
  isSidebarCollapsed: false,
  isMobile: false,
  isTablet: false,
  isModelLoading: false,
  modelLoadingProgress: null,
  isShareModalOpen: false,
  assistantToShare: null,
  embeddingConfig: { timeoutSeconds: 30, fallbackToSimple: true, showMethodUsed: false },
  activeProjectId: null,
  isProjectWorkspaceOpen: false,
  projectPreview: null,
  projectToolActivity: [],
  agentRunState: null,
};

const reducer = (current: AppState, action: AppAction): AppState => {
  switch (action.type) {
    case 'SET_LOADING':
      return { ...current, isLoading: action.payload };
    case 'SET_ERROR':
      return { ...current, error: action.payload };
    case 'SET_CURRENT_ASSISTANT':
      return { ...current, currentAssistant: action.payload };
    case 'SET_SESSIONS':
      return { ...current, sessions: action.payload };
    case 'SET_CURRENT_SESSION':
      return { ...current, currentSession: action.payload };
    case 'ADD_SESSION':
      return {
        ...current,
        sessions: [action.payload, ...current.sessions],
        currentSession: action.payload,
      };
    case 'UPDATE_SESSION':
      return {
        ...current,
        sessions: current.sessions.map(session =>
          session.id === action.payload.id ? action.payload : session,
        ),
        currentSession:
          current.currentSession?.id === action.payload.id
            ? action.payload
            : current.currentSession,
      };
    case 'SET_VIEW_MODE':
      return { ...current, viewMode: action.payload };
    case 'RESET_PROJECT_WORKSPACE':
      return { ...current, activeProjectId: null, isProjectWorkspaceOpen: false };
    default:
      return current;
  }
};

function Harness({ preview }: { preview?: AgentBundle }) {
  const [current, dispatch] = useReducer(reducer, state);
  return (
    <AppContext.Provider
      value={
        {
          state: current,
          dispatch,
          actions,
        } as unknown as AppContextValue
      }
    >
      <div data-testid='view-mode'>{current.viewMode}</div>
      <BundleRunner bundleId='bundle-1' bundle={preview} />
    </AppContext.Provider>
  );
}

describe('BundleRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    providers.initializeProviders.mockResolvedValue(undefined);
    providers.isLLMAvailable.mockReturnValue(true);
    db.getSessionsForAssistant.mockResolvedValue([]);
    db.saveSession.mockResolvedValue(undefined);
    db.saveBundle.mockResolvedValue(undefined);
    actions.updateSession.mockImplementation(async (session: ChatSession) => {
      await db.saveSession(session);
    });
  });

  it('loads the persisted entry agent, persists its first session, and renders only the sandbox chat', async () => {
    db.getBundle.mockResolvedValue({
      id: 'bundle-1',
      bundle: bundle(),
      importedAt: 10,
      sizeBytes: 100,
    });

    render(<Harness />);

    await waitFor(() => expect(screen.getByTestId('bundle-chat')).toHaveTextContent('Entry tutor'));
    expect(db.getSessionsForAssistant).toHaveBeenCalledWith('bundle-1:entry');
    expect(db.saveSession).toHaveBeenCalledWith(
      expect.objectContaining({ assistantId: 'bundle-1:entry' }),
    );
    expect(db.saveBundle).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'bundle-1', lastOpenedAt: expect.any(Number) }),
    );
    expect(chat).toHaveBeenLastCalledWith(
      expect.objectContaining({ sandboxMode: true, subagentDelegationEnabled: false }),
    );
    expect(screen.queryByText(/HTML Canvas/)).not.toBeInTheDocument();
  });

  it('restores the newest persisted session without creating another', async () => {
    const newest: ChatSession = {
      id: 'newest',
      assistantId: 'bundle-1:entry',
      title: 'Saved',
      messages: [],
      createdAt: 20,
      tokenCount: 0,
    };
    db.getBundle.mockResolvedValue({
      id: 'bundle-1',
      bundle: bundle(),
      importedAt: 10,
      sizeBytes: 100,
    });
    db.getSessionsForAssistant.mockResolvedValue([
      { ...newest, id: 'older', createdAt: 10 },
      newest,
    ]);

    render(<Harness />);

    await waitFor(() => expect(screen.getByTestId('bundle-chat')).toHaveTextContent('newest'));
    expect(db.saveSession).not.toHaveBeenCalled();
  });

  it('keeps builder previews out of IndexedDB', async () => {
    render(<Harness preview={bundle()} />);

    await waitFor(() => expect(screen.getByTestId('bundle-chat')).toHaveTextContent('Entry tutor'));
    expect(db.getBundle).not.toHaveBeenCalled();
    expect(db.getSessionsForAssistant).not.toHaveBeenCalled();
    expect(db.saveSession).not.toHaveBeenCalled();
    expect(db.saveBundle).not.toHaveBeenCalled();
  });

  it('opens provider settings when no configured provider is available', async () => {
    db.getBundle.mockResolvedValue({
      id: 'bundle-1',
      bundle: bundle(),
      importedAt: 10,
      sizeBytes: 100,
    });
    providers.isLLMAvailable.mockReturnValue(false);

    render(<Harness />);

    await waitFor(() =>
      expect(screen.getByTestId('view-mode')).toHaveTextContent('provider_settings'),
    );
    expect(screen.queryByTestId('bundle-chat')).not.toBeInTheDocument();
  });

  it('automatically persists an accepted source proposal and switches to its routed target', async () => {
    db.getBundle.mockResolvedValue({
      id: 'bundle-1',
      bundle: routedBundle(),
      importedAt: 10,
      sizeBytes: 100,
    });
    render(<Harness />);

    await waitFor(() => expect(screen.getByTestId('bundle-chat')).toHaveTextContent('Entry tutor'));
    db.saveSession.mockClear();
    const onNewMessage = chat.mock.calls.at(-1)?.[0].onNewMessage;
    const sourceSession = sourceSessionWithProposal();

    await act(async () => {
      await onNewMessage(sourceSession);
    });
    await act(async () => {
      await onNewMessage(sourceSession);
    });

    expect(actions.updateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'source-session',
        messages: [
          expect.objectContaining({
            routeProposal: expect.objectContaining({ status: 'accepted', automatic: true }),
          }),
        ],
      }),
    );
    expect(db.saveSession).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'source-session',
        messages: [
          expect.objectContaining({
            routeProposal: expect.objectContaining({ status: 'accepted', automatic: true }),
          }),
        ],
      }),
    );
    // The same pending proposal must not trigger a second handoff on re-invocation.
    const mathTargetSaves = db.saveSession.mock.calls.filter(
      call => (call[0] as ChatSession).assistantId === 'bundle-1:math',
    );
    expect(mathTargetSaves).toHaveLength(1);
    expect(db.saveSession).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantId: 'bundle-1:math',
        handoffContext: expect.objectContaining({
          sourceSessionId: 'source-session',
          automaticHandoffCount: 1,
        }),
      }),
    );
    await waitFor(() => expect(screen.getByTestId('bundle-chat')).toHaveTextContent('Math tutor'));
    expect(chat).toHaveBeenLastCalledWith(
      expect.objectContaining({
        assistantId: 'bundle-1:math',
        ragChunks: [{ fileName: 'math.md', content: 'Pythagorean theorem.' }],
      }),
    );
  });

  it('does not auto-accept a proposal for an invalid or non-outbound route', async () => {
    db.getBundle.mockResolvedValue({
      id: 'bundle-1',
      bundle: routedBundle(),
      importedAt: 10,
      sizeBytes: 100,
    });
    render(<Harness />);

    await waitFor(() => expect(screen.getByTestId('bundle-chat')).toHaveTextContent('Entry tutor'));
    db.saveSession.mockClear();
    const onNewMessage = chat.mock.calls.at(-1)?.[0].onNewMessage;

    await act(async () => {
      await onNewMessage(sourceSessionWithProposal({ targetAssistantId: 'missing-agent' }));
    });
    await act(async () => {
      await onNewMessage(sourceSessionWithProposal({ sourceAssistantId: 'bundle-1:math' }));
    });

    expect(actions.updateSession).toHaveBeenCalledTimes(2);
    expect(db.saveSession).toHaveBeenCalledTimes(2);
    expect(db.saveSession).not.toHaveBeenCalledWith(
      expect.objectContaining({ assistantId: 'bundle-1:math', handoffContext: expect.anything() }),
    );
    expect(screen.getByTestId('bundle-chat')).toHaveTextContent('Entry tutor');
  });

  it('leaves a fourth consecutive no-user automatic proposal pending for manual confirmation', async () => {
    db.getBundle.mockResolvedValue({
      id: 'bundle-1',
      bundle: routedBundle(),
      importedAt: 10,
      sizeBytes: 100,
    });
    render(<Harness />);

    await waitFor(() => expect(screen.getByTestId('bundle-chat')).toHaveTextContent('Entry tutor'));
    db.saveSession.mockClear();
    const onNewMessage = chat.mock.calls.at(-1)?.[0].onNewMessage;
    const fourthProposal = sourceSessionWithProposal(
      {},
      {
        handoffContext: {
          fromAssistantId: 'bundle-1:previous',
          fromAssistantName: 'Previous tutor',
          reason: 'Prior routing',
          summary: 'Continue helping.',
          sourceSessionId: 'previous-session',
          automaticHandoffCount: 3,
          createdAt: 90,
        },
        messages: [
          { role: 'user', content: 'Continue helping.' },
          {
            role: 'model',
            content: 'I recommend the math tutor.',
            routeProposal: {
              targetAssistantId: 'bundle-1:math',
              targetAssistantName: 'Math tutor',
              reason: 'Needs math help.',
              handoffSummary: 'The learner needs help with right triangles.',
              sourceAssistantId: 'bundle-1:entry',
              sourceSessionId: 'source-session',
              status: 'pending',
              createdAt: 123,
            },
          },
        ],
      },
    );

    await act(async () => {
      await onNewMessage(fourthProposal);
    });

    expect(actions.updateSession).toHaveBeenCalledWith(fourthProposal);
    expect(db.saveSession).toHaveBeenCalledWith(fourthProposal);
    expect(db.saveSession).not.toHaveBeenCalledWith(
      expect.objectContaining({ assistantId: 'bundle-1:math', handoffContext: expect.anything() }),
    );
    expect(fourthProposal.messages.at(-1)?.routeProposal).toMatchObject({ status: 'pending' });
    expect(chat.mock.calls.at(-1)?.[0].onAcceptRouteProposal).toEqual(expect.any(Function));
  });
});
