import { render, screen, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import React from 'react';
import { AppProvider } from '../AppContext';
import { useAppContext } from '../useAppContext';
import type { Assistant, ChatSession, RouteProposal } from '../../../types';

const mockDb = vi.hoisted(() => ({
  getAssistant: vi.fn().mockResolvedValue(null),
  saveAssistant: vi.fn().mockResolvedValue(undefined),
  deleteAssistant: vi.fn().mockResolvedValue(undefined),
  getAllAssistants: vi.fn().mockResolvedValue([]),
  getSessionsForAssistant: vi.fn().mockResolvedValue([]),
  saveSession: vi.fn().mockResolvedValue(undefined),
  deleteSession: vi.fn().mockResolvedValue(undefined),
}));
const mockProviderRegistry = vi.hoisted(() => ({
  initializeProviders: vi.fn().mockResolvedValue(undefined),
  providerManager: {
    getAvailableProviders: vi.fn().mockReturnValue(['gemini']),
  },
}));

vi.mock('../../../services/db', () => mockDb);
vi.mock('../../../services/providerRegistry', () => mockProviderRegistry);
vi.mock('../../../services/embeddingService', () => ({
  preloadEmbeddingModel: vi.fn().mockResolvedValue(undefined),
  isEmbeddingModelLoaded: vi.fn().mockReturnValue(true),
  generateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
}));
vi.mock('../../../services/shortUrlService', () => ({
  resolveShortUrl: vi.fn().mockResolvedValue(null),
  recordShortUrlClick: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../services/tursoService', () => ({
  canWriteToTurso: vi.fn().mockReturnValue(false),
  initializeDatabase: vi.fn().mockResolvedValue(undefined),
  getAssistantFromTurso: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../../services/agentRunCheckpointService', () => ({
  deleteForSession: vi.fn().mockResolvedValue(undefined),
  sweepStale: vi.fn().mockResolvedValue(0),
}));
vi.mock('../../../services/htmlProjectStore', () => ({
  htmlProjectStore: {
    listProjectsByAssistant: vi.fn().mockResolvedValue([]),
    createProject: vi.fn(),
    renameProject: vi.fn(),
    writeFiles: vi.fn().mockResolvedValue({ updated: [], previewVersion: 1 }),
    assertProjectOwnership: vi.fn(),
    deleteProject: vi.fn(),
    deleteProjectsByAssistant: vi.fn().mockResolvedValue(0),
  },
}));
vi.mock('../../../services/htmlPreviewService', () => ({
  htmlPreviewService: {
    resolveProjectForPreview: vi.fn().mockResolvedValue(null),
    revokePreviewUrl: vi.fn(),
  },
}));
vi.mock('../../../services/htmlProjectImportService', () => ({
  htmlProjectImportService: {
    prepareFilesForProjectUpload: vi.fn().mockResolvedValue([]),
    importZipProject: vi.fn(),
  },
}));

// --- Fixtures -------------------------------------------------------------

const SOURCE_ASSISTANT: Assistant = {
  id: 'assistant-source',
  name: '來源助理',
  description: 'Source assistant',
  systemPrompt: 'You are the source assistant.',
  ragChunks: [],
  createdAt: 2000,
};

const TARGET_ASSISTANT: Assistant = {
  id: 'assistant-target',
  name: '目標助理',
  description: 'Target assistant',
  systemPrompt: 'You are the target assistant.',
  ragChunks: [],
  createdAt: 1000,
};

const PROPOSAL: RouteProposal = {
  targetAssistantId: 'assistant-target',
  targetAssistantName: '目標助理',
  reason: '使用者需要微積分協助',
  handoffSummary: '使用者詢問微積分極限問題',
  sourceAssistantId: 'assistant-source',
  sourceSessionId: 'session-source',
  status: 'pending',
  createdAt: 1700000000000,
};

const createSourceSession = (): ChatSession => ({
  id: 'session-source',
  assistantId: 'assistant-source',
  title: 'Source chat',
  messages: [
    { role: 'user', content: '我想問微積分' },
    {
      role: 'model',
      content: '建議轉接到目標助理',
      routeProposal: { ...PROPOSAL },
    },
  ],
  createdAt: 1500,
  tokenCount: 0,
});

// --- Test consumer ---------------------------------------------------------

function RouteProposalConsumer() {
  const { state, dispatch, actions } = useAppContext();
  const proposalMessage = state.currentSession?.messages.find(m => m.routeProposal);

  return (
    <div data-testid='route-consumer'>
      <div data-testid='is-loading'>{String(state.isLoading)}</div>
      <div data-testid='is-shared'>{String(state.isShared)}</div>
      <div data-testid='error'>{state.error || 'none'}</div>
      <div data-testid='current-assistant-id'>{state.currentAssistant?.id || 'none'}</div>
      <div data-testid='current-session-id'>{state.currentSession?.id || 'none'}</div>
      <div data-testid='current-session-assistant'>
        {state.currentSession?.assistantId || 'none'}
      </div>
      <div data-testid='sessions-count'>{state.sessions.length}</div>
      <div data-testid='route-status'>{proposalMessage?.routeProposal?.status || 'none'}</div>
      <div data-testid='handoff-from'>
        {state.currentSession?.handoffContext?.fromAssistantId || 'none'}
      </div>
      <div data-testid='handoff-reason'>
        {state.currentSession?.handoffContext?.reason || 'none'}
      </div>
      <div data-testid='handoff-summary'>
        {state.currentSession?.handoffContext?.summary || 'none'}
      </div>
      <div data-testid='handoff-source-session'>
        {state.currentSession?.handoffContext?.sourceSessionId || 'none'}
      </div>
      <div data-testid='pending-handoff-assistant'>
        {state.pendingHandoffSession?.assistantId || 'none'}
      </div>
      <div data-testid='pending-handoff-from'>
        {state.pendingHandoffSession?.handoffContext?.fromAssistantId || 'none'}
      </div>
      <div data-testid='shared-assistant-id'>{state.sharedAssistantId || 'none'}</div>

      <button
        data-testid='accept-proposal'
        onClick={() => actions.acceptRouteProposal({ ...PROPOSAL })}
      >
        Accept
      </button>
      <button
        data-testid='decline-proposal'
        onClick={() => actions.declineRouteProposal({ ...PROPOSAL })}
      >
        Decline
      </button>
      <button
        data-testid='setup-shared-session'
        onClick={() => {
          dispatch({ type: 'SET_CURRENT_ASSISTANT', payload: { ...SOURCE_ASSISTANT } });
          dispatch({ type: 'SET_CURRENT_SESSION', payload: createSourceSession() });
        }}
      >
        Setup Shared Session
      </button>
    </div>
  );
}

// --- Window mocks (mirrors AppContext.test.tsx conventions) ----------------

const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
let mockURLSearchParams: ReturnType<typeof vi.fn>;

beforeAll(() => {
  addEventListenerSpy.mockImplementation(() => undefined);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});

  mockURLSearchParams = vi.fn().mockImplementation(_search => ({
    has: vi.fn().mockReturnValue(false),
    get: vi.fn().mockReturnValue(null),
  }));
  Object.defineProperty(window, 'URLSearchParams', {
    value: mockURLSearchParams,
    writable: true,
  });
  Object.defineProperty(window, 'innerWidth', { value: 1024, writable: true });
  Object.defineProperty(window, 'innerHeight', { value: 768, writable: true });
});

const renderProvider = () =>
  render(
    <AppProvider>
      <RouteProposalConsumer />
    </AppProvider>,
  );

describe('AppContext route proposal handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    // Default: not in shared mode
    mockURLSearchParams.mockImplementation(_search => ({
      has: vi.fn().mockReturnValue(false),
      get: vi.fn().mockReturnValue(null),
    }));

    // Local mode data: source + target assistants, source session carries the proposal
    mockDb.getAllAssistants.mockResolvedValue([SOURCE_ASSISTANT, TARGET_ASSISTANT]);
    mockDb.getAssistant.mockImplementation(async (id: string) => {
      if (id === SOURCE_ASSISTANT.id) {
        return SOURCE_ASSISTANT;
      }
      if (id === TARGET_ASSISTANT.id) {
        return TARGET_ASSISTANT;
      }
      return null;
    });
    mockDb.getSessionsForAssistant.mockImplementation(async (id: string) =>
      id === SOURCE_ASSISTANT.id ? [createSourceSession()] : [],
    );
    mockDb.saveAssistant.mockResolvedValue(undefined);
    mockDb.saveSession.mockResolvedValue(undefined);
    mockDb.deleteAssistant.mockResolvedValue(undefined);
    mockDb.deleteSession.mockResolvedValue(undefined);
    mockProviderRegistry.initializeProviders.mockResolvedValue(undefined);
  });

  const waitForSourceSelected = async () => {
    await waitFor(
      () => {
        expect(screen.getByTestId('is-loading')).toHaveTextContent('false');
        expect(screen.getByTestId('current-assistant-id')).toHaveTextContent('assistant-source');
        expect(screen.getByTestId('current-session-id')).toHaveTextContent('session-source');
      },
      { timeout: 3000 },
    );
  };

  describe('acceptRouteProposal (local mode)', () => {
    it('switches to the target assistant with a handoff session and marks the proposal accepted', async () => {
      renderProvider();
      await waitForSourceSelected();

      await act(async () => {
        screen.getByTestId('accept-proposal').click();
      });

      await waitFor(() => {
        // Switched to the target assistant
        expect(screen.getByTestId('current-assistant-id')).toHaveTextContent('assistant-target');
        // New current session belongs to the target and carries the handoff context
        expect(screen.getByTestId('current-session-assistant')).toHaveTextContent(
          'assistant-target',
        );
        expect(screen.getByTestId('handoff-from')).toHaveTextContent('assistant-source');
        expect(screen.getByTestId('handoff-reason')).toHaveTextContent('使用者需要微積分協助');
        expect(screen.getByTestId('handoff-summary')).toHaveTextContent('使用者詢問微積分極限問題');
        expect(screen.getByTestId('handoff-source-session')).toHaveTextContent('session-source');
        expect(screen.getByTestId('error')).toHaveTextContent('none');
      });

      // The source session was persisted with the proposal marked accepted
      expect(mockDb.saveSession).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'session-source',
          messages: expect.arrayContaining([
            expect.objectContaining({
              routeProposal: expect.objectContaining({ status: 'accepted' }),
            }),
          ]),
        }),
      );

      // The new handoff session was persisted for the target assistant
      expect(mockDb.saveSession).toHaveBeenCalledWith(
        expect.objectContaining({
          assistantId: 'assistant-target',
          handoffContext: expect.objectContaining({
            fromAssistantId: 'assistant-source',
            reason: '使用者需要微積分協助',
            summary: '使用者詢問微積分極限問題',
            sourceSessionId: 'session-source',
          }),
        }),
      );
    });

    it('marks the proposal failed and sets an error when the target assistant no longer exists', async () => {
      // Only the source assistant remains locally
      mockDb.getAllAssistants.mockResolvedValue([SOURCE_ASSISTANT]);
      mockDb.getAssistant.mockImplementation(async (id: string) =>
        id === SOURCE_ASSISTANT.id ? SOURCE_ASSISTANT : null,
      );

      renderProvider();
      await waitForSourceSelected();

      await act(async () => {
        screen.getByTestId('accept-proposal').click();
      });

      await waitFor(() => {
        expect(screen.getByTestId('route-status')).toHaveTextContent('failed');
        expect(screen.getByTestId('error')).toHaveTextContent('轉接目標已不存在，無法完成轉接。');
      });

      // Assistant and session are unchanged; no new session was created
      expect(screen.getByTestId('current-assistant-id')).toHaveTextContent('assistant-source');
      expect(screen.getByTestId('current-session-id')).toHaveTextContent('session-source');
      expect(screen.getByTestId('sessions-count')).toHaveTextContent('1');

      expect(mockDb.saveSession).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'session-source',
          messages: expect.arrayContaining([
            expect.objectContaining({
              routeProposal: expect.objectContaining({ status: 'failed' }),
            }),
          ]),
        }),
      );
      // No handoff session was persisted
      expect(mockDb.saveSession).not.toHaveBeenCalledWith(
        expect.objectContaining({ handoffContext: expect.anything() }),
      );
    });
  });

  describe('declineRouteProposal', () => {
    it('marks the proposal declined without switching assistant or creating a session', async () => {
      renderProvider();
      await waitForSourceSelected();

      await act(async () => {
        screen.getByTestId('decline-proposal').click();
      });

      await waitFor(() => {
        expect(screen.getByTestId('route-status')).toHaveTextContent('declined');
      });

      expect(screen.getByTestId('current-assistant-id')).toHaveTextContent('assistant-source');
      expect(screen.getByTestId('current-session-id')).toHaveTextContent('session-source');
      expect(screen.getByTestId('sessions-count')).toHaveTextContent('1');
      expect(screen.getByTestId('error')).toHaveTextContent('none');

      // Only the source session update was persisted
      expect(mockDb.saveSession).toHaveBeenCalledTimes(1);
      expect(mockDb.saveSession).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'session-source',
          messages: expect.arrayContaining([
            expect.objectContaining({
              routeProposal: expect.objectContaining({ status: 'declined' }),
            }),
          ]),
        }),
      );
    });
  });

  describe('acceptRouteProposal (shared mode)', () => {
    it('stores a pending handoff session, updates the share URL and switches shared assistant id', async () => {
      // Enter shared mode for the source assistant
      mockURLSearchParams.mockImplementation(_search => ({
        has: vi.fn().mockImplementation((key: string) => key === 'share'),
        get: vi
          .fn()
          .mockImplementation((key: string) => (key === 'share' ? 'assistant-source' : null)),
      }));
      window.history.replaceState({}, '', '/?share=assistant-source&keys=xxx');

      renderProvider();

      await waitFor(() => {
        expect(screen.getByTestId('is-shared')).toHaveTextContent('true');
        expect(screen.getByTestId('shared-assistant-id')).toHaveTextContent('assistant-source');
      });

      // Simulate SharedAssistant having loaded the source assistant and session
      await act(async () => {
        screen.getByTestId('setup-shared-session').click();
      });
      await waitFor(() => {
        expect(screen.getByTestId('current-session-id')).toHaveTextContent('session-source');
      });

      await act(async () => {
        screen.getByTestId('accept-proposal').click();
      });

      await waitFor(() => {
        // Pending handoff session targets the new assistant and carries the handoff context
        expect(screen.getByTestId('pending-handoff-assistant')).toHaveTextContent(
          'assistant-target',
        );
        expect(screen.getByTestId('pending-handoff-from')).toHaveTextContent('assistant-source');
        // Shared mode now points at the target assistant
        expect(screen.getByTestId('shared-assistant-id')).toHaveTextContent('assistant-target');
        // The proposal message in the source session was marked accepted
        expect(screen.getByTestId('route-status')).toHaveTextContent('accepted');
      });

      // URL was rewritten via history.replaceState: share updated, keys preserved
      const url = new URL(window.location.href);
      expect(url.searchParams.get('share')).toBe('assistant-target');
      expect(url.searchParams.get('keys')).toBe('xxx');

      // No local assistant switch happened in shared mode
      expect(mockDb.getAssistant).not.toHaveBeenCalledWith('assistant-target');
    });
  });
});
