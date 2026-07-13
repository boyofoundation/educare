import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React, { useReducer } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BundleRunner from './BundleRunner';
import { AppContext } from '../core/useAppContext';
import type { AppAction, AppContextValue, AppState } from '../core/AppContext.types';
import type { AgentBundle, ChatSession, GeometryBoardRecord } from '../../types';

const {
  actions,
  db,
  providers,
  streamChat,
  checkpoint,
  renderGeometryDoc,
  getInterruptedForSession,
} = vi.hoisted(() => ({
  actions: { updateSession: vi.fn(), deleteSession: vi.fn() },
  db: {
    getBundle: vi.fn(),
    getSessionsForAssistant: vi.fn(),
    saveBundle: vi.fn(),
    saveSession: vi.fn(),
  },
  providers: {
    initializeProviders: vi.fn(),
    isLLMAvailable: vi.fn(),
    providerManager: {
      setBundleProviderConfig: vi.fn(),
      clearBundleProviderConfig: vi.fn(),
    },
  },
  streamChat: vi.fn(),
  checkpoint: {
    saveCheckpoint: vi.fn(),
    updateCheckpoint: vi.fn(),
    claimCheckpoint: vi.fn(),
    deleteCheckpoint: vi.fn(),
    getCheckpoint: vi.fn(),
  },
  renderGeometryDoc: vi.fn(),
  getInterruptedForSession: vi.fn(),
}));

vi.mock('../../services/db', () => db);
vi.mock('../../services/providerRegistry', () => providers);
vi.mock('../../services/llmService', () => ({
  streamChat,
  getProjectSummaryFromToolResult: () => null,
}));
vi.mock('../../services/agentRunCheckpointService', () => ({
  ...checkpoint,
  getInterruptedForSession,
}));
vi.mock('../../services/modelCapabilities', () => ({
  activeModelSupportsImageInput: () => false,
  resolveActiveModelImageSupport: () => Promise.resolve(false),
}));
vi.mock('../../services/geometryRenderer', () => ({ renderGeometryDoc }));
vi.mock('react-virtuoso', () => ({
  Virtuoso: ({
    data = [],
    itemContent,
  }: {
    data?: unknown[];
    itemContent: (index: number, item: unknown) => React.ReactNode;
  }) => {
    const ReactModule = require('react');
    return ReactModule.createElement(
      'div',
      { 'data-testid': 'virtuoso-scroller' },
      data.map((item, index) =>
        ReactModule.createElement('div', { key: index }, itemContent(index, item)),
      ),
    );
  },
}));

const bundleId = 'bundle-math';
const assistantId = `${bundleId}:entry`;

const geometryDocument = {
  title: 'Triangle ABC',
  boundingbox: [-5, 5, 5, -5] as [number, number, number, number],
  objects: [],
};

const completedGeometryBoard: GeometryBoardRecord = {
  id: 'geometry-0-0',
  title: geometryDocument.title,
  doc: geometryDocument,
  computedPoints: [
    { id: 'A', x: 0, y: 0 },
    { id: 'B', x: 3, y: 0 },
    { id: 'C', x: 0, y: 4 },
  ],
};

const mathBundle = (): AgentBundle => ({
  manifest: {
    format: 'educare-agent-bundle',
    schemaVersion: 1,
    name: 'Math bundle',
    description: 'A math-enabled bundle.',
    version: '1.0.0',
    exportedAt: 1,
    entryAgentId: assistantId,
  },
  agents: [
    {
      id: assistantId,
      name: 'Geometry tutor',
      description: 'Draws geometry diagrams.',
      systemPrompt: 'Help with geometry.',
      starterPrompts: [],
      ragChunks: [],
      mathToolsEnabled: true,
    },
  ],
  routes: [],
});

const baseState: AppState = {
  assistants: [],
  currentAssistant: null,
  sessions: [],
  currentSession: null,
  viewMode: 'new_assistant',
  isLoading: false,
  error: null,
  isShared: false,
  sharedAssistantId: null,
  bundleMode: { bundleId },
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
  isBundleImportRoute: false,
};

const reducer = (state: AppState, action: AppAction): AppState => {
  switch (action.type) {
    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };
    case 'SET_ERROR':
      return { ...state, error: action.payload };
    case 'SET_CURRENT_ASSISTANT':
      return { ...state, currentAssistant: action.payload };
    case 'SET_SESSIONS':
      return { ...state, sessions: action.payload };
    case 'SET_CURRENT_SESSION':
      return { ...state, currentSession: action.payload };
    case 'UPDATE_SESSION':
      return {
        ...state,
        sessions: state.sessions.map(session =>
          session.id === action.payload.id ? action.payload : session,
        ),
        currentSession:
          state.currentSession?.id === action.payload.id ? action.payload : state.currentSession,
      };
    case 'SET_VIEW_MODE':
      return { ...state, viewMode: action.payload };
    case 'RESET_PROJECT_WORKSPACE':
      return { ...state, activeProjectId: null, isProjectWorkspaceOpen: false };
    default:
      return state;
  }
};

function BundleHarness() {
  const [state, dispatch] = useReducer(reducer, baseState);
  return (
    <AppContext.Provider value={{ state, dispatch, actions } as unknown as AppContextValue}>
      <BundleRunner bundleId={bundleId} />
    </AppContext.Provider>
  );
}

describe('BundleRunner math-enabled persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    providers.initializeProviders.mockResolvedValue(undefined);
    providers.isLLMAvailable.mockReturnValue(true);
    db.getBundle.mockResolvedValue({
      id: bundleId,
      bundle: mathBundle(),
      importedAt: 1,
      sizeBytes: 0,
    });
    db.saveBundle.mockResolvedValue(undefined);
    db.saveSession.mockResolvedValue(undefined);
    checkpoint.saveCheckpoint.mockResolvedValue(undefined);
    checkpoint.updateCheckpoint.mockResolvedValue(null);
    checkpoint.deleteCheckpoint.mockResolvedValue(undefined);
    getInterruptedForSession.mockResolvedValue(null);
    renderGeometryDoc.mockResolvedValue({ destroy: vi.fn(), errors: [], warnings: [] });
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
  });

  it('persists an AgentRunController geometry board and replays it after BundleRunner reloads', async () => {
    // Arrange
    const persistedSessions: ChatSession[] = [];
    db.getSessionsForAssistant.mockImplementation(async () => persistedSessions);
    db.saveSession.mockImplementation(async (session: ChatSession) => {
      const index = persistedSessions.findIndex(item => item.id === session.id);
      if (index === -1) {
        persistedSessions.push(session);
      } else {
        persistedSessions[index] = session;
      }
    });
    actions.updateSession.mockImplementation(async (session: ChatSession) => {
      await db.saveSession(session);
    });
    streamChat.mockImplementation(async (params: Record<string, unknown>) => {
      (params.onChunk as (chunk: string) => void)('I created triangle ABC.');
      (params.onComplete as (metadata: unknown, text: string) => void)(
        {
          promptTokenCount: 8,
          candidatesTokenCount: 4,
          provider: 'gemini',
          model: 'gemini-2.5-flash',
          finishReason: 'complete',
          toolSequence: ['draw_geometry'],
          geometryBoards: [
            {
              document: geometryDocument,
              result: {
                ok: true,
                errors: [],
                warnings: [],
                computed_points: completedGeometryBoard.computedPoints,
                summary: 'Geometry drawn successfully.',
              },
            },
          ],
        },
        'I created triangle ABC.',
      );
    });

    const firstMount = render(<BundleHarness />);
    await screen.findByRole('heading', { level: 2, name: 'Geometry tutor' });

    // Act
    fireEvent.change(screen.getByRole('textbox', { name: '輸入訊息' }), {
      target: { value: 'Draw triangle ABC.' },
    });
    fireEvent.click(screen.getByRole('button', { name: '傳送訊息' }));

    // Assert: the real ChatContainer receives the controller result and BundleRunner persists it.
    await waitFor(() => {
      expect(persistedSessions).toHaveLength(1);
      expect(persistedSessions[0]?.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ role: 'user', content: 'Draw triangle ABC.' }),
          expect.objectContaining({
            role: 'model',
            content: 'I created triangle ABC.',
            geometryBoards: [completedGeometryBoard],
          }),
        ]),
      );
    });
    expect(streamChat).toHaveBeenCalledWith(expect.objectContaining({ mathToolsEnabled: true }));

    firstMount.unmount();
    renderGeometryDoc.mockClear();

    // Remounting reads the saved bundle session; the actual MessageBubble/GeometryBoard path replays it.
    render(<BundleHarness />);

    await screen.findByRole('heading', { level: 2, name: 'Geometry tutor' });
    expect(screen.getByRole('heading', { name: 'Triangle ABC' })).toBeInTheDocument();
    await waitFor(() => {
      expect(renderGeometryDoc).toHaveBeenCalledWith(expect.any(HTMLDivElement), geometryDocument);
    });
  });
});
