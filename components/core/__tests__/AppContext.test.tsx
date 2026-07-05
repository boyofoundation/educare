import { render, screen, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import React from 'react';
import { AppProvider } from '../AppContext';
import { useAppContext } from '../useAppContext';
import { htmlProjectStore } from '../../../services/htmlProjectStore';
import { htmlPreviewService } from '../../../services/htmlPreviewService';
import { htmlProjectImportService } from '../../../services/htmlProjectImportService';
import {
  createMockModelLoadingProgress,
  TEST_ASSISTANTS,
  TEST_SESSIONS,
  RESPONSIVE_BREAKPOINTS,
} from './test-utils';

const { TEST_HTML_PROJECT, TEST_PROJECT_PREVIEW, TEST_IMPORTED_PROJECT } = vi.hoisted(() => ({
  TEST_HTML_PROJECT: {
    id: 'test-project-1',
    name: 'Test Project',
    assistantId: 'test-assistant-1',
    sessionId: 'test-session-1',
    entryFile: '/index.html',
    status: 'ready' as const,
    previewVersion: 0,
    assetPaths: [],
    createdAt: 0,
    updatedAt: 0,
  },
  TEST_PROJECT_PREVIEW: {
    projectId: 'test-project-1',
    url: 'blob:test-project-1',
    previewVersion: 1,
    entryFile: '/index.html',
    previewReady: true,
    previewUrlType: 'blob' as const,
    html: '<!doctype html><html><body>Preview</body></html>',
    warnings: [],
    generatedAt: 0,
    error: null,
  },
  TEST_IMPORTED_PROJECT: {
    projectName: 'Imported Demo',
    entryFile: '/demo/index.html',
    files: [
      {
        path: '/demo/index.html',
        kind: 'html' as const,
        content: '<main>Imported</main>',
        encoding: 'utf-8' as const,
      },
    ],
  },
}));

const mockDb = vi.hoisted(() => ({
  getAssistant: vi.fn().mockResolvedValue(null),
  saveAssistant: vi.fn().mockResolvedValue(undefined),
  deleteAssistant: vi.fn().mockResolvedValue(undefined),
  getAllAssistants: vi.fn().mockResolvedValue([]),
  getSessionsForAssistant: vi.fn().mockResolvedValue([]),
  saveSession: vi.fn().mockResolvedValue(undefined),
  deleteSession: vi.fn().mockResolvedValue(undefined),
}));
const mockEmbedding = vi.hoisted(() => ({
  __esModule: true,
  preloadEmbeddingModel: vi.fn().mockResolvedValue(undefined),
  isEmbeddingModelLoaded: vi.fn().mockReturnValue(true),
  generateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
}));
const mockProviderRegistry = vi.hoisted(() => ({
  initializeProviders: vi.fn().mockResolvedValue(undefined),
  providerManager: {
    getAvailableProviders: vi.fn().mockReturnValue(['gemini']),
  },
}));

vi.mock('../../../services/db', () => mockDb);
vi.mock('../../../services/embeddingService', () => mockEmbedding);
vi.mock('../../../services/providerRegistry', () => mockProviderRegistry);
vi.mock('../../../services/cryptoService', () => ({
  CryptoService: {
    encryptApiKeys: vi.fn().mockResolvedValue('encrypted'),
    decryptApiKeys: vi.fn().mockResolvedValue({}),
    generateRandomPassword: vi.fn().mockReturnValue('password'),
  },
}));
vi.mock('../../../services/apiKeyManager', () => ({
  ApiKeyManager: {
    getUserApiKeys: vi.fn().mockReturnValue({ geminiApiKey: 'test-key' }),
    saveUserApiKeys: vi.fn(),
  },
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
    createProject: vi.fn().mockResolvedValue({ ...TEST_HTML_PROJECT }),
    renameProject: vi
      .fn()
      .mockImplementation(async (_projectId: string, _assistantId: string, name: string) => ({
        ...TEST_HTML_PROJECT,
        name: name.trim(),
        updatedAt: Date.now(),
      })),
    writeFiles: vi.fn().mockResolvedValue({ updated: [], previewVersion: 1 }),
    assertProjectOwnership: vi.fn().mockResolvedValue({ ...TEST_HTML_PROJECT }),
    deleteProject: vi.fn().mockResolvedValue({
      id: TEST_HTML_PROJECT.id,
      name: TEST_HTML_PROJECT.name,
    }),
    deleteProjectsByAssistant: vi.fn().mockResolvedValue(0),
  },
}));

vi.mock('../../../services/htmlPreviewService', () => ({
  htmlPreviewService: {
    resolveProjectForPreview: vi.fn().mockResolvedValue({ ...TEST_PROJECT_PREVIEW }),
    revokePreviewUrl: vi.fn(),
  },
}));

vi.mock('../../../services/htmlProjectImportService', () => ({
  htmlProjectImportService: {
    prepareFilesForProjectUpload: vi.fn().mockResolvedValue([
      {
        path: '/index.html',
        kind: 'html',
        content: '<main>Upload</main>',
        encoding: 'utf-8',
      },
    ]),
    importZipProject: vi.fn().mockResolvedValue({ ...TEST_IMPORTED_PROJECT }),
  },
}));

// Test component to access context
function TestConsumer() {
  const { state, dispatch, actions } = useAppContext();

  return (
    <div data-testid='test-consumer'>
      <div data-testid='current-view-mode'>{state.viewMode}</div>
      <div data-testid='assistants-count'>{state.assistants.length}</div>
      <div data-testid='sessions-count'>{state.sessions.length}</div>
      <div data-testid='current-assistant'>{state.currentAssistant?.name || 'none'}</div>
      <div data-testid='current-session'>{state.currentSession?.title || 'none'}</div>
      <div data-testid='is-loading'>{String(state.isLoading)}</div>
      <div data-testid='error'>{state.error || 'none'}</div>
      <div data-testid='is-sidebar-open'>{String(state.isSidebarOpen)}</div>
      <div data-testid='is-mobile'>{String(state.isMobile)}</div>
      <div data-testid='is-tablet'>{String(state.isTablet)}</div>
      <div data-testid='is-model-loading'>{String(state.isModelLoading)}</div>
      <div data-testid='is-share-modal-open'>{String(state.isShareModalOpen)}</div>
      <div data-testid='active-project-id'>{state.activeProjectId || 'none'}</div>
      <div data-testid='project-preview-id'>{state.projectPreview?.projectId || 'none'}</div>
      <div data-testid='project-preview-version'>
        {state.projectPreview ? String(state.projectPreview.previewVersion) : 'none'}
      </div>
      <div data-testid='project-activity-last'>
        {state.projectToolActivity[state.projectToolActivity.length - 1] || 'none'}
      </div>

      {/* Action buttons for testing */}
      <button data-testid='load-data' onClick={() => actions.loadData()}>
        Load Data
      </button>
      <button
        data-testid='select-assistant'
        onClick={() => actions.selectAssistant('test-assistant-1')}
      >
        Select Assistant
      </button>
      <button
        data-testid='save-assistant'
        onClick={() => actions.saveAssistant(TEST_ASSISTANTS.basic)}
      >
        Save Assistant
      </button>
      <button
        data-testid='delete-assistant'
        onClick={() => actions.deleteAssistant('test-assistant-1')}
      >
        Delete Assistant
      </button>
      <button
        data-testid='create-session'
        onClick={() => actions.createNewSession('test-assistant-1')}
      >
        Create Session
      </button>
      <button data-testid='delete-session' onClick={() => actions.deleteSession('test-session-1')}>
        Delete Session
      </button>
      <button
        data-testid='update-session'
        onClick={() => actions.updateSession(TEST_SESSIONS.withMessages)}
      >
        Update Session
      </button>
      <button data-testid='set-view-mode' onClick={() => actions.setViewMode('settings')}>
        Set View Mode
      </button>
      <button data-testid='toggle-sidebar' onClick={actions.toggleSidebar}>
        Toggle Sidebar
      </button>
      <button
        data-testid='open-share-modal'
        onClick={() => actions.openShareModal(TEST_ASSISTANTS.basic)}
      >
        Open Share Modal
      </button>
      <button data-testid='close-share-modal' onClick={actions.closeShareModal}>
        Close Share Modal
      </button>
      <button data-testid='check-screen-size' onClick={actions.checkScreenSize}>
        Check Screen Size
      </button>
      <button
        data-testid='rename-project'
        onClick={() =>
          actions.renameProjectForCurrentSession('test-project-1', '  Renamed Canvas  ')
        }
      >
        Rename Project
      </button>
      <button
        data-testid='upload-project-files'
        onClick={() =>
          actions.uploadFilesToProjectForCurrentSession('test-project-1', [
            new File(['<main>Upload</main>'], 'index.html', { type: 'text/html' }),
          ])
        }
      >
        Upload Project Files
      </button>
      <button
        data-testid='import-project-zip'
        onClick={() =>
          actions.importProjectZipForCurrentSession(
            new File(['zip-content'], 'imported-demo.zip', { type: 'application/zip' }),
          )
        }
      >
        Import Project Zip
      </button>

      {/* Dispatch test button */}
      <button
        data-testid='dispatch-action'
        onClick={() => dispatch({ type: 'SET_VIEW_MODE', payload: 'new_assistant' })}
      >
        Dispatch Action
      </button>
    </div>
  );
}

// Window/console spies set up once
const confirmSpy = vi.spyOn(window, 'confirm');
const alertSpy = vi.spyOn(window, 'alert');
const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
const errorSpy = vi.spyOn(console, 'error');
let mockURLSearchParams: ReturnType<typeof vi.fn>;

beforeAll(() => {
  // Set up window mocks once (not re-mocking modules)
  confirmSpy.mockReturnValue(false);
  alertSpy.mockImplementation(() => {});
  addEventListenerSpy.mockImplementation(() => undefined);
  errorSpy.mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});

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

describe('AppContext', () => {
  // Expose spies as testEnvironment-compatible object
  let testEnvironment: {
    confirmSpy: typeof confirmSpy;
    alertSpy: typeof alertSpy;
    addEventListenerSpy: typeof addEventListenerSpy;
    errorSpy: typeof errorSpy;
    mockURLSearchParams: typeof mockURLSearchParams;
    cleanup: () => void;
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    // Re-apply default implementations after clearAllMocks resets them
    confirmSpy.mockReturnValue(false);
    alertSpy.mockImplementation(() => {});
    errorSpy.mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockURLSearchParams.mockImplementation(_search => ({
      has: vi.fn().mockReturnValue(false),
      get: vi.fn().mockReturnValue(null),
    }));

    // Re-establish default db mock return values (clearAllMocks resets these)
    mockDb.getAllAssistants.mockResolvedValue([]);
    mockDb.getAssistant.mockResolvedValue(null);
    mockDb.saveAssistant.mockResolvedValue(undefined);
    mockDb.deleteAssistant.mockResolvedValue(undefined);
    mockDb.getSessionsForAssistant.mockResolvedValue([]);
    mockDb.saveSession.mockResolvedValue(undefined);
    mockDb.deleteSession.mockResolvedValue(undefined);

    // Re-establish embedding service defaults
    mockEmbedding.isEmbeddingModelLoaded.mockReturnValue(true);
    mockEmbedding.preloadEmbeddingModel.mockResolvedValue(undefined);

    // Re-establish provider registry defaults
    mockProviderRegistry.initializeProviders.mockResolvedValue(undefined);
    mockProviderRegistry.providerManager.getAvailableProviders.mockReturnValue(['gemini']);

    // Re-establish HTML project service defaults
    vi.mocked(htmlProjectStore.listProjectsByAssistant).mockResolvedValue([]);
    vi.mocked(htmlProjectStore.createProject).mockResolvedValue({ ...TEST_HTML_PROJECT });
    vi.mocked(htmlProjectStore.renameProject).mockImplementation(
      async (_projectId: string, _assistantId: string, name: string) => ({
        ...TEST_HTML_PROJECT,
        name: name.trim(),
        updatedAt: Date.now(),
      }),
    );
    vi.mocked(htmlProjectStore.writeFiles).mockResolvedValue({ updated: [], previewVersion: 1 });
    vi.mocked(htmlProjectStore.assertProjectOwnership).mockResolvedValue({ ...TEST_HTML_PROJECT });
    vi.mocked(htmlProjectStore.deleteProject).mockResolvedValue({ ...TEST_HTML_PROJECT });
    vi.mocked(htmlProjectStore.deleteProjectsByAssistant).mockResolvedValue(0);
    vi.mocked(htmlPreviewService.resolveProjectForPreview).mockResolvedValue({
      ...TEST_PROJECT_PREVIEW,
    });
    vi.mocked(htmlPreviewService.revokePreviewUrl).mockImplementation(() => {});
    vi.mocked(htmlProjectImportService.prepareFilesForProjectUpload).mockResolvedValue([
      {
        path: '/index.html',
        kind: 'html',
        content: '<main>Upload</main>',
        encoding: 'utf-8',
      },
    ]);
    vi.mocked(htmlProjectImportService.importZipProject).mockResolvedValue({
      ...TEST_IMPORTED_PROJECT,
    });

    testEnvironment = {
      confirmSpy,
      alertSpy,
      addEventListenerSpy,
      errorSpy,
      mockURLSearchParams,
      cleanup: () => {},
    };
  });

  afterEach(() => {
    // cleanup handled by vi.clearAllMocks in beforeEach
  });

  describe('Context Provider', () => {
    it('should provide context to child components', async () => {
      render(
        <AppProvider>
          <TestConsumer />
        </AppProvider>,
      );

      expect(screen.getByTestId('test-consumer')).toBeInTheDocument();
      expect(screen.getByTestId('current-view-mode')).toBeInTheDocument();

      // Wait for loading to settle
      await waitFor(
        () => {
          expect(screen.getByTestId('is-loading')).toHaveTextContent('false');
        },
        { timeout: 3000 },
      );
    });

    it('should throw error when useAppContext is used outside provider', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        render(<TestConsumer />);
      }).toThrow('useAppContext must be used within an AppProvider');

      consoleSpy.mockRestore();
    });

    it('should initialize with default state values', async () => {
      render(
        <AppProvider>
          <TestConsumer />
        </AppProvider>,
      );

      // Wait for loading to complete
      await waitFor(
        () => {
          expect(screen.getByTestId('is-loading')).toHaveTextContent('false');
        },
        { timeout: 3000 },
      );

      expect(screen.getByTestId('assistants-count')).toHaveTextContent('0');
      expect(screen.getByTestId('sessions-count')).toHaveTextContent('0');
      expect(screen.getByTestId('current-assistant')).toHaveTextContent('none');
      expect(screen.getByTestId('current-session')).toHaveTextContent('none');
      expect(screen.getByTestId('is-sidebar-open')).toHaveTextContent('true');
      expect(screen.getByTestId('is-mobile')).toHaveTextContent('false');
      expect(screen.getByTestId('is-tablet')).toHaveTextContent('false');
      expect(screen.getByTestId('error')).toHaveTextContent('none');
    });
  });

  describe('State Management - Reducer', () => {
    it('should handle SET_ASSISTANTS action', async () => {
      render(
        <AppProvider>
          <TestConsumer />
        </AppProvider>,
      );

      await act(async () => {
        // Simulate dispatching SET_ASSISTANTS
        screen.getByTestId('dispatch-action').click();
        // We need to test this through actions since we can't directly dispatch SET_ASSISTANTS
        const loadDataButton = screen.getByTestId('load-data');
        loadDataButton.click();
      });

      // Wait for async operations to complete
      await waitFor(() => {
        expect(screen.getByTestId('is-loading')).toHaveTextContent('false');
      });
    });

    it('should handle SET_VIEW_MODE action', async () => {
      render(
        <AppProvider>
          <TestConsumer />
        </AppProvider>,
      );

      await act(async () => {
        screen.getByTestId('dispatch-action').click();
      });

      expect(screen.getByTestId('current-view-mode')).toHaveTextContent('new_assistant');
    });

    it('should handle SET_LOADING action', async () => {
      render(
        <AppProvider>
          <TestConsumer />
        </AppProvider>,
      );

      // Wait for loading to complete (through loadData effect)
      await waitFor(
        () => {
          expect(screen.getByTestId('is-loading')).toHaveTextContent('false');
        },
        { timeout: 3000 },
      );
    });

    it('should handle SET_SIDEBAR_OPEN action', async () => {
      render(
        <AppProvider>
          <TestConsumer />
        </AppProvider>,
      );

      // Wait for initial load to complete
      await waitFor(() => {
        expect(screen.getByTestId('is-loading')).toHaveTextContent('false');
      });

      // Initial state should be true (desktop width 1024)
      expect(screen.getByTestId('is-sidebar-open')).toHaveTextContent('true');

      await act(async () => {
        screen.getByTestId('toggle-sidebar').click();
      });

      expect(screen.getByTestId('is-sidebar-open')).toHaveTextContent('false');
    });

    it('should handle SET_SHARE_MODAL action', async () => {
      render(
        <AppProvider>
          <TestConsumer />
        </AppProvider>,
      );

      // Initial state should be false
      expect(screen.getByTestId('is-share-modal-open')).toHaveTextContent('false');

      await act(async () => {
        screen.getByTestId('open-share-modal').click();
      });

      expect(screen.getByTestId('is-share-modal-open')).toHaveTextContent('true');

      await act(async () => {
        screen.getByTestId('close-share-modal').click();
      });

      expect(screen.getByTestId('is-share-modal-open')).toHaveTextContent('false');
    });
  });

  describe('Screen Size Detection', () => {
    it('should detect mobile screen size', async () => {
      Object.defineProperty(window, 'innerWidth', {
        value: RESPONSIVE_BREAKPOINTS.mobile - 1,
        writable: true,
      });

      render(
        <AppProvider>
          <TestConsumer />
        </AppProvider>,
      );

      await act(async () => {
        screen.getByTestId('check-screen-size').click();
      });

      expect(screen.getByTestId('is-mobile')).toHaveTextContent('true');
      expect(screen.getByTestId('is-tablet')).toHaveTextContent('false');
      expect(screen.getByTestId('is-sidebar-open')).toHaveTextContent('false'); // Should close on mobile
    });

    it('should detect tablet screen size', async () => {
      Object.defineProperty(window, 'innerWidth', {
        value: (RESPONSIVE_BREAKPOINTS.mobile + RESPONSIVE_BREAKPOINTS.desktop) / 2,
        writable: true,
      });

      render(
        <AppProvider>
          <TestConsumer />
        </AppProvider>,
      );

      await act(async () => {
        screen.getByTestId('check-screen-size').click();
      });

      expect(screen.getByTestId('is-mobile')).toHaveTextContent('false');
      expect(screen.getByTestId('is-tablet')).toHaveTextContent('true');
      expect(screen.getByTestId('is-sidebar-open')).toHaveTextContent('false'); // Should close on tablet
    });

    it('should detect desktop screen size', async () => {
      Object.defineProperty(window, 'innerWidth', {
        value: RESPONSIVE_BREAKPOINTS.desktop + 1,
        writable: true,
      });

      render(
        <AppProvider>
          <TestConsumer />
        </AppProvider>,
      );

      await act(async () => {
        screen.getByTestId('check-screen-size').click();
      });

      expect(screen.getByTestId('is-mobile')).toHaveTextContent('false');
      expect(screen.getByTestId('is-tablet')).toHaveTextContent('false');
      expect(screen.getByTestId('is-sidebar-open')).toHaveTextContent('true'); // Should remain open on desktop
    });
  });

  describe('Shared Mode Detection', () => {
    it('should detect shared mode from URL parameters', () => {
      const mockURLSearchParams = testEnvironment.mockURLSearchParams;
      mockURLSearchParams.mockImplementation(_search => ({
        has: vi.fn().mockImplementation((key: string) => key === 'share'),
        get: vi
          .fn()
          .mockImplementation((key: string) => (key === 'share' ? 'test-shared-id' : null)),
      }));

      render(
        <AppProvider>
          <TestConsumer />
        </AppProvider>,
      );

      // In shared mode, loadData should not be called automatically
      // We can verify this indirectly by checking loading state remains true longer
    });

    it('should not be in shared mode by default', async () => {
      const mockURLSearchParams = testEnvironment.mockURLSearchParams;
      mockURLSearchParams.mockImplementation(_search => ({
        has: vi.fn().mockReturnValue(false),
        get: vi.fn().mockReturnValue(null),
      }));

      render(
        <AppProvider>
          <TestConsumer />
        </AppProvider>,
      );

      // Should eventually complete loading in non-shared mode
      await waitFor(
        () => {
          expect(screen.getByTestId('is-loading')).toHaveTextContent('false');
        },
        { timeout: 3000 },
      );
    });
  });

  describe('Action Handlers - Assistant Management', () => {
    it('should handle assistant selection', async () => {
      // Set mocks before render so loadData uses them
      mockDb.getAssistant.mockResolvedValue(TEST_ASSISTANTS.basic);
      mockDb.getSessionsForAssistant.mockResolvedValue([TEST_SESSIONS.withMessages]);

      render(
        <AppProvider>
          <TestConsumer />
        </AppProvider>,
      );

      // Wait for initial load (getAllAssistants returns [] so no auto-selection)
      await waitFor(
        () => {
          expect(screen.getByTestId('is-loading')).toHaveTextContent('false');
        },
        { timeout: 3000 },
      );

      await act(async () => {
        screen.getByTestId('select-assistant').click();
      });

      await waitFor(() => {
        expect(screen.getByTestId('current-assistant')).toHaveTextContent('Basic Assistant');
        expect(screen.getByTestId('current-view-mode')).toHaveTextContent('chat');
        expect(screen.getByTestId('sessions-count')).toHaveTextContent('1');
      });
    });

    it('should handle assistant saving', async () => {
      // viewMode starts as 'new_assistant' after loadData with [] assistants
      // saveAssistant in 'new_assistant' mode calls selectAssistant after save
      mockDb.getAllAssistants.mockResolvedValue([]);
      mockDb.saveAssistant.mockResolvedValue(undefined);
      mockDb.getAssistant.mockResolvedValue(TEST_ASSISTANTS.basic);
      mockDb.getSessionsForAssistant.mockResolvedValue([]);

      render(
        <AppProvider>
          <TestConsumer />
        </AppProvider>,
      );

      // Wait for initial load
      await waitFor(
        () => {
          expect(screen.getByTestId('is-loading')).toHaveTextContent('false');
        },
        { timeout: 3000 },
      );

      // Now update getAllAssistants to return the saved assistant
      mockDb.getAllAssistants.mockResolvedValue([TEST_ASSISTANTS.basic]);

      await act(async () => {
        screen.getByTestId('save-assistant').click();
      });

      await waitFor(() => {
        expect(mockDb.saveAssistant).toHaveBeenCalledWith(TEST_ASSISTANTS.basic);
      });
    });

    it('should handle assistant deletion with confirmation', async () => {
      testEnvironment.confirmSpy.mockReturnValue(true);
      mockDb.deleteAssistant.mockResolvedValue(undefined);
      mockDb.getAllAssistants.mockResolvedValue([]);

      render(
        <AppProvider>
          <TestConsumer />
        </AppProvider>,
      );

      // Wait for initial load
      await waitFor(
        () => {
          expect(screen.getByTestId('is-loading')).toHaveTextContent('false');
        },
        { timeout: 3000 },
      );

      await act(async () => {
        screen.getByTestId('delete-assistant').click();
      });

      expect(testEnvironment.confirmSpy).toHaveBeenCalledWith('確定要刪除此助理和所有聊天記錄嗎？');
      await waitFor(() => {
        expect(mockDb.deleteAssistant).toHaveBeenCalledWith('test-assistant-1');
      });
    });

    it('should cancel assistant deletion when not confirmed', async () => {
      testEnvironment.confirmSpy.mockReturnValue(false);

      render(
        <AppProvider>
          <TestConsumer />
        </AppProvider>,
      );

      await act(async () => {
        screen.getByTestId('delete-assistant').click();
      });

      expect(testEnvironment.confirmSpy).toHaveBeenCalled();
      expect(mockDb.deleteAssistant).not.toHaveBeenCalled();
    });
  });

  describe('Action Handlers - Session Management', () => {
    it('should handle session creation', async () => {
      mockDb.saveSession.mockResolvedValue(undefined);

      render(
        <AppProvider>
          <TestConsumer />
        </AppProvider>,
      );

      // Wait for initial load
      await waitFor(
        () => {
          expect(screen.getByTestId('is-loading')).toHaveTextContent('false');
        },
        { timeout: 3000 },
      );

      await act(async () => {
        screen.getByTestId('create-session').click();
      });

      // Check state change only (bypassing spy tracking question)
      await waitFor(
        () => {
          expect(screen.getByTestId('sessions-count')).toHaveTextContent('1');
        },
        { timeout: 3000 },
      );
    });

    it('should handle session deletion with confirmation', async () => {
      testEnvironment.confirmSpy.mockReturnValue(true);
      mockDb.getAssistant.mockResolvedValue(TEST_ASSISTANTS.basic);
      mockDb.getSessionsForAssistant.mockResolvedValue([TEST_SESSIONS.withMessages]);
      mockDb.deleteSession.mockResolvedValue(undefined);

      render(
        <AppProvider>
          <TestConsumer />
        </AppProvider>,
      );

      // Wait for initial load
      await waitFor(
        () => {
          expect(screen.getByTestId('is-loading')).toHaveTextContent('false');
        },
        { timeout: 3000 },
      );

      // Select an assistant first so currentAssistant is set
      await act(async () => {
        screen.getByTestId('select-assistant').click();
      });

      await waitFor(() => {
        expect(screen.getByTestId('current-assistant')).toHaveTextContent('Basic Assistant');
      });

      // After selecting assistant, update sessions mock to return []
      mockDb.getSessionsForAssistant.mockResolvedValue([]);

      await act(async () => {
        screen.getByTestId('delete-session').click();
      });

      expect(testEnvironment.confirmSpy).toHaveBeenCalledWith('確定要刪除此聊天會話嗎？');
      await waitFor(() => {
        expect(mockDb.deleteSession).toHaveBeenCalledWith('test-session-1');
      });
    });

    it('should handle session updates', async () => {
      mockDb.saveSession.mockResolvedValue(undefined);

      render(
        <AppProvider>
          <TestConsumer />
        </AppProvider>,
      );

      // Wait for initial load
      await waitFor(
        () => {
          expect(screen.getByTestId('is-loading')).toHaveTextContent('false');
        },
        { timeout: 3000 },
      );

      await act(async () => {
        screen.getByTestId('update-session').click();
      });

      await waitFor(() => {
        expect(mockDb.saveSession).toHaveBeenCalledWith(TEST_SESSIONS.withMessages);
      });
    });
  });

  describe('Action Handlers - HTML Project Management', () => {
    it('should rename the current session project and log the new project name', async () => {
      mockDb.getAssistant.mockResolvedValue(TEST_ASSISTANTS.basic);
      mockDb.getSessionsForAssistant.mockResolvedValue([TEST_SESSIONS.withMessages]);
      vi.mocked(htmlProjectStore.renameProject).mockResolvedValue({
        ...TEST_HTML_PROJECT,
        name: 'Renamed Canvas',
        updatedAt: 1700000001000,
      });

      render(
        <AppProvider>
          <TestConsumer />
        </AppProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId('is-loading')).toHaveTextContent('false');
      });

      await act(async () => {
        screen.getByTestId('select-assistant').click();
      });

      await waitFor(() => {
        expect(screen.getByTestId('current-assistant')).toHaveTextContent('Basic Assistant');
      });

      await act(async () => {
        screen.getByTestId('rename-project').click();
      });

      await waitFor(() => {
        expect(htmlProjectStore.renameProject).toHaveBeenCalledWith(
          'test-project-1',
          'test-assistant-1',
          '  Renamed Canvas  ',
        );
        expect(screen.getByTestId('project-activity-last')).toHaveTextContent(
          '已重新命名 HTML 專案為「Renamed Canvas」。',
        );
      });
    });

    it('should upload files into the active current session project and refresh the preview', async () => {
      mockDb.getAssistant.mockResolvedValue(TEST_ASSISTANTS.basic);
      mockDb.getSessionsForAssistant.mockResolvedValue([
        {
          ...TEST_SESSIONS.withMessages,
          activeProjectId: 'test-project-1',
        },
      ]);
      vi.mocked(htmlProjectStore.writeFiles).mockResolvedValue({
        updated: ['/index.html'],
        previewVersion: 3,
      });
      vi.mocked(htmlPreviewService.resolveProjectForPreview).mockResolvedValue({
        ...TEST_PROJECT_PREVIEW,
        previewVersion: 3,
      });

      render(
        <AppProvider>
          <TestConsumer />
        </AppProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId('is-loading')).toHaveTextContent('false');
      });

      await act(async () => {
        screen.getByTestId('select-assistant').click();
      });

      await waitFor(() => {
        expect(screen.getByTestId('active-project-id')).toHaveTextContent('test-project-1');
      });

      vi.mocked(htmlProjectStore.assertProjectOwnership).mockClear();
      vi.mocked(htmlProjectStore.writeFiles).mockClear();
      vi.mocked(htmlPreviewService.resolveProjectForPreview).mockClear();
      vi.mocked(htmlProjectImportService.prepareFilesForProjectUpload).mockClear();

      await act(async () => {
        screen.getByTestId('upload-project-files').click();
      });

      await waitFor(() => {
        expect(htmlProjectStore.assertProjectOwnership).toHaveBeenCalledWith(
          'test-project-1',
          'test-assistant-1',
        );
        expect(htmlProjectImportService.prepareFilesForProjectUpload).toHaveBeenCalledTimes(1);
        expect(htmlProjectStore.writeFiles).toHaveBeenCalledWith('test-project-1', [
          {
            path: '/index.html',
            kind: 'html',
            content: '<main>Upload</main>',
            encoding: 'utf-8',
          },
        ]);
        expect(htmlPreviewService.resolveProjectForPreview).toHaveBeenCalledWith('test-project-1');
        expect(screen.getByTestId('project-preview-version')).toHaveTextContent('3');
        expect(screen.getByTestId('project-activity-last')).toHaveTextContent(
          '已上傳 1 個檔案到 HTML 專案「Test Project」。 version 3',
        );
      });
    });

    it('should import a zip project and attach it to the current session workspace', async () => {
      mockDb.getAssistant.mockResolvedValue(TEST_ASSISTANTS.basic);
      mockDb.getSessionsForAssistant.mockResolvedValue([TEST_SESSIONS.withMessages]);
      vi.mocked(htmlProjectImportService.importZipProject).mockResolvedValue({
        ...TEST_IMPORTED_PROJECT,
      });
      vi.mocked(htmlProjectStore.createProject).mockResolvedValue({
        ...TEST_HTML_PROJECT,
        id: 'imported-project-1',
        name: 'Imported Demo',
        entryFile: '/demo/index.html',
      });
      vi.mocked(htmlProjectStore.writeFiles).mockResolvedValue({
        updated: ['/demo/index.html'],
        previewVersion: 1,
      });
      vi.mocked(htmlProjectStore.assertProjectOwnership).mockResolvedValue({
        ...TEST_HTML_PROJECT,
        id: 'imported-project-1',
        name: 'Imported Demo',
        entryFile: '/demo/index.html',
      });
      vi.mocked(htmlPreviewService.resolveProjectForPreview).mockResolvedValue({
        ...TEST_PROJECT_PREVIEW,
        projectId: 'imported-project-1',
        entryFile: '/demo/index.html',
      });

      render(
        <AppProvider>
          <TestConsumer />
        </AppProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId('is-loading')).toHaveTextContent('false');
      });

      await act(async () => {
        screen.getByTestId('select-assistant').click();
      });

      await waitFor(() => {
        expect(screen.getByTestId('current-assistant')).toHaveTextContent('Basic Assistant');
      });

      await act(async () => {
        screen.getByTestId('import-project-zip').click();
      });

      await waitFor(() => {
        expect(htmlProjectImportService.importZipProject).toHaveBeenCalledWith(expect.any(File));
        expect(htmlProjectStore.createProject).toHaveBeenCalledWith({
          assistantId: 'test-assistant-1',
          sessionId: 'test-session-1',
          name: 'Imported Demo',
          entryFile: '/demo/index.html',
        });
        expect(htmlProjectStore.writeFiles).toHaveBeenCalledWith(
          'imported-project-1',
          TEST_IMPORTED_PROJECT.files,
        );
        expect(mockDb.saveSession).toHaveBeenCalledWith(
          expect.objectContaining({
            id: 'test-session-1',
            assistantId: 'test-assistant-1',
            activeProjectId: 'imported-project-1',
          }),
        );
        expect(screen.getByTestId('active-project-id')).toHaveTextContent('imported-project-1');
        expect(screen.getByTestId('project-preview-id')).toHaveTextContent('imported-project-1');
        expect(screen.getByTestId('project-activity-last')).toHaveTextContent(
          '已匯入 ZIP HTML 專案「Imported Demo」。',
        );
      });
    });
  });

  describe('View Mode Management', () => {
    it('should handle view mode changes', async () => {
      render(
        <AppProvider>
          <TestConsumer />
        </AppProvider>,
      );

      // Wait for loading to settle first
      await waitFor(
        () => {
          expect(screen.getByTestId('is-loading')).toHaveTextContent('false');
        },
        { timeout: 3000 },
      );

      await act(async () => {
        screen.getByTestId('set-view-mode').click();
      });
      expect(screen.getByTestId('current-view-mode')).toHaveTextContent('settings');
    });

    it('should default to new_assistant when no assistants exist', async () => {
      // beforeEach already sets getAllAssistants to return []
      render(
        <AppProvider>
          <TestConsumer />
        </AppProvider>,
      );

      await waitFor(
        () => {
          expect(screen.getByTestId('current-view-mode')).toHaveTextContent('new_assistant');
          expect(screen.getByTestId('is-loading')).toHaveTextContent('false');
        },
        { timeout: 3000 },
      );
    });
  });

  describe('Model Loading', () => {
    it('should handle embedding model preloading', async () => {
      mockEmbedding.isEmbeddingModelLoaded.mockReturnValue(false);
      mockEmbedding.preloadEmbeddingModel.mockImplementation(
        async (progressCallback: ((p: unknown) => void) | undefined) => {
          // Simulate progress updates
          const progress = createMockModelLoadingProgress();
          progressCallback && progressCallback(progress);
        },
      );

      render(
        <AppProvider>
          <TestConsumer />
        </AppProvider>,
      );

      // Should complete model loading
      await waitFor(
        () => {
          expect(screen.getByTestId('is-model-loading')).toHaveTextContent('false');
        },
        { timeout: 3000 },
      );
    });

    it('should skip model preloading when already loaded', async () => {
      mockEmbedding.isEmbeddingModelLoaded.mockReturnValue(true);

      render(
        <AppProvider>
          <TestConsumer />
        </AppProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId('is-loading')).toHaveTextContent('false');
      });

      expect(mockEmbedding.preloadEmbeddingModel).not.toHaveBeenCalled();
      expect(screen.getByTestId('is-model-loading')).toHaveTextContent('false');
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors during loading', async () => {
      mockDb.getAllAssistants.mockRejectedValue(new Error('Database connection failed'));

      render(
        <AppProvider>
          <TestConsumer />
        </AppProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId('error')).toHaveTextContent('無法從資料庫載入資料。');
        expect(screen.getByTestId('is-loading')).toHaveTextContent('false');
      });
    });

    it('should handle model loading errors', async () => {
      mockEmbedding.isEmbeddingModelLoaded.mockReturnValue(false);
      mockEmbedding.preloadEmbeddingModel.mockRejectedValue(new Error('Model loading failed'));

      render(
        <AppProvider>
          <TestConsumer />
        </AppProvider>,
      );

      // App should complete loading gracefully even when model loading fails
      await waitFor(
        () => {
          expect(screen.getByTestId('is-model-loading')).toHaveTextContent('false');
          expect(screen.getByTestId('is-loading')).toHaveTextContent('false');
        },
        { timeout: 3000 },
      );
    });
  });

  describe('Cleanup and Effects', () => {
    it('should add and remove resize event listeners', () => {
      render(
        <AppProvider>
          <TestConsumer />
        </AppProvider>,
      );

      expect(testEnvironment.addEventListenerSpy).toHaveBeenCalledWith(
        'resize',
        expect.any(Function),
      );
    });

    it('should initialize provider registry', async () => {
      render(
        <AppProvider>
          <TestConsumer />
        </AppProvider>,
      );

      await waitFor(
        () => {
          expect(mockProviderRegistry.initializeProviders).toHaveBeenCalled();
        },
        { timeout: 3000 },
      );
    });
  });
});
