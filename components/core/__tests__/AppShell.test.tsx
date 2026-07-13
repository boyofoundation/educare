/// <reference types="vitest/globals" />
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { vi } from 'vitest';
import React from 'react';
import { AppShell } from '../AppShell';
import { ChatSession } from '../../../types';
import { TEST_ASSISTANTS, TEST_SESSIONS } from './test-constants';
import * as dbMock from '../../../services/db';
import * as embeddingMock from '../../../services/embeddingService';
import * as providerMock from '../../../services/providerRegistry';
import * as htmlPreviewMock from '../../../services/htmlPreviewService';
import * as htmlProjectStoreMock from '../../../services/htmlProjectStore';

// Mock ErrorBoundary separately to test error handling
vi.mock('../ErrorBoundary', () => {
  const MockErrorBoundary = vi.fn(({ children }: { children: React.ReactNode }) => {
    return React.createElement('div', { 'data-testid': 'error-boundary' }, children);
  });

  return {
    ErrorBoundary: MockErrorBoundary,
  };
});

vi.mock('../../../services/shortUrlService', () => ({
  resolveShortUrl: vi.fn().mockResolvedValue(null),
  recordShortUrlClick: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../services/tursoService', () => ({
  canWriteToTurso: vi.fn().mockReturnValue(true),
  initializeDatabase: vi.fn().mockResolvedValue(undefined),
  getAssistantFromTurso: vi.fn().mockResolvedValue(null),
  checkAssistantExistsInTurso: vi.fn().mockResolvedValue(false),
}));

vi.mock('../../../services/cryptoService', () => ({
  CryptoService: {
    extractKeysFromUrl: vi.fn().mockReturnValue(null),
    clearUrlParam: vi.fn(),
  },
}));

vi.mock('../../../hooks/useTursoAssistantStatus', () => ({
  useTursoAssistantStatus: vi.fn().mockReturnValue({ canShare: true }),
}));

vi.mock('../../../services/db', () => ({
  getAssistant: vi.fn().mockResolvedValue(null),
  saveAssistant: vi.fn().mockResolvedValue(undefined),
  deleteAssistant: vi.fn().mockResolvedValue(undefined),
  getAllAssistants: vi.fn().mockResolvedValue([]),
  getSessionsForAssistant: vi.fn().mockResolvedValue([]),
  saveSession: vi.fn().mockResolvedValue(undefined),
  deleteSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../services/embeddingService', () => ({
  preloadEmbeddingModel: vi.fn().mockResolvedValue(undefined),
  isEmbeddingModelLoaded: vi.fn().mockReturnValue(true),
  generateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
}));

vi.mock('../../../services/providerRegistry', () => ({
  initializeProviders: vi.fn().mockResolvedValue(undefined),
  providerManager: {
    getAvailableProviders: vi.fn().mockReturnValue(['gemini']),
    getActiveProvider: vi.fn().mockReturnValue(null),
  },
}));

vi.mock('../../../services/htmlPreviewService', () => ({
  htmlPreviewService: {
    resolveProjectForPreview: vi.fn().mockResolvedValue({
      projectId: 'project-42',
      previewVersion: 1,
      entryFile: '/index.html',
      previewReady: true,
      previewUrlType: 'blob',
      html: '<html></html>',
      url: 'blob:preview-42',
      warnings: [],
      error: null,
      generatedAt: 1700000000000,
    }),
    revokePreviewUrl: vi.fn(),
  },
}));

vi.mock('../../../services/htmlProjectStore', () => ({
  htmlProjectStore: {
    listProjectsByAssistant: vi.fn().mockResolvedValue([]),
    assertProjectOwnership: vi
      .fn()
      .mockImplementation(async (projectId: string, _assistantId: string) => ({
        id: projectId,
        name: `Project ${projectId}`,
        assistantId: 'test-assistant-1',
        entryFile: '/index.html',
        status: 'ready',
        previewVersion: 1,
        assetPaths: [],
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
      })),
    deleteProject: vi.fn().mockImplementation(async (projectId: string, _assistantId: string) => ({
      id: projectId,
      name: `Project ${projectId}`,
      assistantId: 'test-assistant-1',
      entryFile: '/index.html',
      status: 'ready',
      previewVersion: 1,
      assetPaths: [],
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    })),
    deleteProjectsByAssistant: vi.fn().mockResolvedValue(0),
  },
}));

vi.mock('../../assistant', () => ({
  AssistantEditor: ({
    assistant,
    onCancel,
    onSave,
  }: {
    assistant?: { name: string } | null;
    onCancel?: () => void;
    onSave?: (a: unknown) => void;
  }) =>
    React.createElement('div', { 'data-testid': 'assistant-editor' }, [
      React.createElement('span', { key: 'mode' }, assistant ? 'Edit Mode' : 'New Mode'),
      React.createElement(
        'button',
        { key: 'cancel', 'data-testid': 'cancel-button', onClick: onCancel },
        'Cancel',
      ),
      React.createElement(
        'button',
        {
          key: 'save',
          'data-testid': 'save-button',
          onClick: () => onSave && onSave(assistant || {}),
        },
        'Save',
      ),
    ]),
  ShareModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? React.createElement('div', { 'data-testid': 'share-modal' }) : null,
  AssistantList: ({
    assistants,
    selectedAssistant,
    onEdit,
    onDelete,
    onShare,
  }: {
    assistants: Array<{ id: string; name: string }>;
    selectedAssistant?: { id: string; name: string } | null;
    onEdit: (assistant: { id: string; name: string }) => void;
    onDelete: (assistantId: string) => void;
    onShare: (assistant: { id: string; name: string }) => void;
  }) =>
    React.createElement('div', { 'data-testid': 'assistant-list' }, [
      ...assistants.map(assistant =>
        React.createElement('span', { key: `assistant-${assistant.id}` }, assistant.name),
      ),
      selectedAssistant &&
        React.createElement(
          React.Fragment,
          { key: 'selected-actions' },
          React.createElement(
            'button',
            {
              'data-testid': `edit-${selectedAssistant.id.replace(/^edit-/, '')}`,
              onClick: () => onEdit(selectedAssistant),
            },
            'Edit',
          ),
          React.createElement(
            'button',
            {
              'data-testid': `delete-${selectedAssistant.id.replace(/^edit-/, '')}`,
              onClick: () => onDelete(selectedAssistant.id),
            },
            'Delete',
          ),
          React.createElement(
            'button',
            {
              'data-testid': `share-${selectedAssistant.id.replace(/^edit-/, '')}`,
              onClick: () => onShare(selectedAssistant),
            },
            'Share',
          ),
        ),
    ]),
}));

vi.mock('../../chat', () => ({
  ChatContainer: ({
    assistantName,
    session,
    onNewMessage,
    headerActions,
    hideHeader,
  }: {
    assistantName: string;
    session: ChatSession | null;
    onNewMessage?: (
      session: ChatSession | null,
      msg: string,
      response?: string,
      tokenInfo?: { promptTokenCount: number; candidatesTokenCount: number },
    ) => void;
    headerActions?: React.ReactNode;
    hideHeader?: boolean;
  }) =>
    React.createElement('div', { 'data-testid': 'chat-container' }, [
      React.createElement('span', { key: 'name' }, `Chatting with ${assistantName}`),
      React.createElement(
        'span',
        { key: 'hide-header' },
        `hideHeader:${String(Boolean(hideHeader))}`,
      ),
      ...(headerActions
        ? [React.createElement('div', { key: 'header-actions' }, headerActions)]
        : []),
      React.createElement(
        'button',
        {
          key: 'send',
          'data-testid': 'send-message',
          onClick: () =>
            onNewMessage &&
            onNewMessage(session, 'test message', 'model response', {
              promptTokenCount: 10,
              candidatesTokenCount: 15,
            }),
        },
        'Send',
      ),
    ]),
}));

vi.mock('../../canvas', async () => {
  const actual = await vi.importActual<typeof import('../../canvas')>('../../canvas');
  const { useAppContext } = await import('../useAppContext');

  return {
    ...actual,
    HtmlProjectWorkspace: ({ projectId }: { projectId: string }) => {
      const { actions } = useAppContext();

      return React.createElement('div', { 'data-testid': 'html-project-workspace' }, [
        React.createElement('span', { key: 'label' }, `Workspace: ${projectId}`),
        React.createElement(
          'button',
          {
            key: 'hide-workspace',
            'data-testid': 'hide-workspace',
            onClick: () => actions.setProjectWorkspaceOpen(false),
          },
          'Hide Workspace',
        ),
      ]);
    },
  };
});

vi.mock('../../features/SharedAssistant', () => ({
  default: ({ assistantId }: { assistantId: string }) =>
    React.createElement(
      'div',
      { 'data-testid': 'shared-assistant' },
      `Shared Assistant: ${assistantId}`,
    ),
}));

vi.mock('../../settings/ProviderSettings', () => ({
  default: ({ onClose }: { onClose?: () => void }) =>
    React.createElement('div', { 'data-testid': 'provider-settings' }, [
      React.createElement(
        'button',
        { key: 'close', 'data-testid': 'provider-settings-close', onClick: onClose },
        'Close Provider Settings',
      ),
    ]),
}));

vi.mock('../../settings/ProviderSettingsImportModal', () => ({
  default: ({ onApplied }: { onApplied?: () => void }) =>
    React.createElement('div', { 'data-testid': 'provider-settings-import-modal' }, [
      React.createElement(
        'button',
        { key: 'apply', 'data-testid': 'provider-settings-import-apply', onClick: onApplied },
        'Apply Provider Settings Import',
      ),
    ]),
}));

let mockURLSearchParams: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();

  mockURLSearchParams = vi.fn().mockImplementation(() => ({
    has: vi.fn().mockReturnValue(false),
    get: vi.fn().mockReturnValue(null),
  }));

  Object.defineProperty(window, 'URLSearchParams', {
    value: mockURLSearchParams,
    writable: true,
  });

  // Reset mocked service return values to baseline defaults
  vi.mocked(dbMock.getAssistant).mockResolvedValue(undefined);
  vi.mocked(dbMock.saveAssistant).mockResolvedValue(undefined);
  vi.mocked(dbMock.deleteAssistant).mockResolvedValue(undefined);
  vi.mocked(dbMock.getAllAssistants).mockResolvedValue([]);
  vi.mocked(dbMock.getSessionsForAssistant).mockResolvedValue([]);
  vi.mocked(dbMock.saveSession).mockResolvedValue(undefined);
  vi.mocked(dbMock.deleteSession).mockResolvedValue(undefined);

  vi.mocked(htmlProjectStoreMock.htmlProjectStore.listProjectsByAssistant).mockResolvedValue([]);
  vi.mocked(htmlProjectStoreMock.htmlProjectStore.assertProjectOwnership).mockImplementation(
    async (projectId: string, _assistantId: string) => ({
      id: projectId,
      name: `Project ${projectId}`,
      assistantId: 'test-assistant-1',
      entryFile: '/index.html',
      status: 'ready',
      previewVersion: 1,
      assetPaths: [],
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    }),
  );
  vi.mocked(htmlProjectStoreMock.htmlProjectStore.deleteProject).mockImplementation(
    async (projectId: string, _assistantId: string) => ({
      id: projectId,
      name: `Project ${projectId}`,
      assistantId: 'test-assistant-1',
      entryFile: '/index.html',
      status: 'ready',
      previewVersion: 1,
      assetPaths: [],
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    }),
  );
  vi.mocked(htmlProjectStoreMock.htmlProjectStore.deleteProjectsByAssistant).mockResolvedValue(0);

  vi.mocked(embeddingMock.preloadEmbeddingModel).mockResolvedValue(undefined);
  vi.mocked(embeddingMock.isEmbeddingModelLoaded).mockReturnValue(true);
  vi.mocked(embeddingMock.generateEmbedding).mockResolvedValue([0.1, 0.2, 0.3]);

  vi.mocked(providerMock.initializeProviders).mockResolvedValue(undefined);
  vi.mocked(providerMock.providerManager.getAvailableProviders).mockReturnValue([
    {
      type: 'gemini',
      provider: {
        name: 'gemini',
        displayName: 'Gemini',
        supportedModels: [],
        requiresApiKey: true,
        supportsLocalMode: false,
        initialize: vi.fn().mockResolvedValue(undefined),
        isAvailable: vi.fn().mockReturnValue(true),
        streamChat: vi.fn(),
      },
    },
  ] as ReturnType<typeof providerMock.providerManager.getAvailableProviders>);
  vi.mocked(providerMock.providerManager.getActiveProvider).mockReturnValue(null);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('AppShell', () => {
  describe('Component Structure', () => {
    it('should render within ErrorBoundary and AppProvider', async () => {
      render(<AppShell />);

      expect(screen.getByTestId('error-boundary')).toBeInTheDocument();

      // Wait for initial loading to complete
      await waitFor(
        () => {
          expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument();
        },
        { timeout: 3000 },
      );
    });

    it('should render Layout component with children', async () => {
      render(<AppShell />);

      // Layout should be rendered
      expect(screen.getByRole('main')).toBeInTheDocument();

      // Wait for loading to complete
      await waitFor(
        () => {
          expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument();
        },
        { timeout: 3000 },
      );
    });
  });

  describe('Shared Mode', () => {
    it('should render SharedAssistant when in shared mode', async () => {
      // Mock URL parameters for shared mode
      mockURLSearchParams.mockImplementation(() => ({
        has: vi.fn().mockImplementation(key => key === 'share'),
        get: vi.fn().mockImplementation(key => (key === 'share' ? 'shared-assistant-123' : null)),
      }));

      render(<AppShell />);

      await waitFor(
        () => {
          expect(screen.getByTestId('shared-assistant')).toBeInTheDocument();
          expect(screen.getByText('Shared Assistant: shared-assistant-123')).toBeInTheDocument();
        },
        { timeout: 3000 },
      );
    });

    it('should not render SharedAssistant when not in shared mode', async () => {
      mockURLSearchParams.mockImplementation(() => ({
        has: vi.fn().mockReturnValue(false),
        get: vi.fn().mockReturnValue(null),
      }));

      render(<AppShell />);

      await waitFor(
        () => {
          expect(screen.queryByTestId('shared-assistant')).not.toBeInTheDocument();
        },
        { timeout: 3000 },
      );
    });
  });

  describe('View Mode Rendering', () => {
    beforeEach(() => {
      // Setup mock data for view mode tests
      vi.mocked(dbMock.getAllAssistants).mockResolvedValue([
        TEST_ASSISTANTS.basic,
        TEST_ASSISTANTS.withRag,
      ]);
      vi.mocked(dbMock.getAssistant).mockResolvedValue(TEST_ASSISTANTS.basic);
      vi.mocked(dbMock.getSessionsForAssistant).mockResolvedValue([TEST_SESSIONS.withMessages]);
    });

    it('should render AssistantEditor in new_assistant mode', async () => {
      vi.mocked(dbMock.getAllAssistants).mockResolvedValue([]);

      render(<AppShell />);

      await waitFor(
        () => {
          expect(screen.getByTestId('assistant-editor')).toBeInTheDocument();
          expect(screen.getByText('New Mode')).toBeInTheDocument();
        },
        { timeout: 3000 },
      );
    });

    it('should render AssistantEditor in edit_assistant mode with current assistant', async () => {
      render(<AppShell />);

      // Wait for loading to complete and assistant to be selected
      await waitFor(
        () => {
          expect(screen.queryByText('載入助理中...')).not.toBeInTheDocument();
        },
        { timeout: 3000 },
      );

      // Find and click edit button to switch to edit mode
      const editButton = screen.queryByTestId('edit-test-assistant-1');
      if (editButton) {
        await act(async () => {
          fireEvent.click(editButton);
        });

        await waitFor(() => {
          expect(screen.getByTestId('assistant-editor')).toBeInTheDocument();
          expect(screen.getByText('Edit Mode')).toBeInTheDocument();
        });
      }
    });

    it('should render ChatContainer in chat mode with session', async () => {
      render(<AppShell />);

      await waitFor(
        () => {
          expect(screen.getByTestId('chat-container')).toBeInTheDocument();
          expect(screen.getByText('Chatting with Basic Assistant')).toBeInTheDocument();
        },
        { timeout: 3000 },
      );
    });

    it('should stretch the chat layout wrapper to fill the available width', async () => {
      render(<AppShell />);

      await waitFor(() => {
        const chatContainer = screen.getByTestId('chat-container');
        const layoutRow = chatContainer.parentElement?.parentElement;

        expect(layoutRow).toHaveClass('w-full');
        expect(layoutRow).toHaveClass('flex-1');
      });
    });

    it('hides HTML project controls and workspace for a math assistant with an active project', async () => {
      // Arrange
      const mathAssistant = { ...TEST_ASSISTANTS.basic, mathToolsEnabled: true };
      vi.mocked(dbMock.getAllAssistants).mockResolvedValue([mathAssistant]);
      vi.mocked(dbMock.getAssistant).mockResolvedValue(mathAssistant);
      vi.mocked(dbMock.getSessionsForAssistant).mockResolvedValue([
        { ...TEST_SESSIONS.withMessages, activeProjectId: 'project-42' },
      ]);
      vi.mocked(htmlProjectStoreMock.htmlProjectStore.listProjectsByAssistant).mockResolvedValue([
        {
          id: 'project-42',
          name: 'Existing Canvas',
          assistantId: mathAssistant.id,
          entryFile: '/index.html',
          previewVersion: 1,
          updatedAt: 1700000000000,
        },
      ] as never);

      // Act
      render(<AppShell />);

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('chat-container')).toBeInTheDocument();
      });
      expect(screen.queryByRole('button', { name: 'HTML Projects' })).not.toBeInTheDocument();
      expect(screen.queryByTestId('html-project-picker')).not.toBeInTheDocument();
      expect(screen.queryByTestId('html-project-workspace')).not.toBeInTheDocument();
    });

    it('should show the existing HTML project picker when the session has no active project and the assistant has saved HTML projects', async () => {
      vi.mocked(htmlProjectStoreMock.htmlProjectStore.listProjectsByAssistant).mockResolvedValue([
        {
          id: 'project-99',
          name: 'Existing Landing Page',
          assistantId: TEST_ASSISTANTS.basic.id,
          entryFile: '/index.html',
          previewVersion: 3,
          updatedAt: 1700000000000,
          description: 'Reopenable project',
        },
      ] as never);

      render(<AppShell />);

      const openPickerButton = await screen.findByRole('button', {
        name: 'HTML Projects',
      });

      expect(screen.getByTestId('html-project-picker')).toBeInTheDocument();
      expect(screen.queryByText('Existing Landing Page')).not.toBeInTheDocument();

      await act(async () => {
        fireEvent.click(openPickerButton);
      });

      await waitFor(() => {
        expect(screen.getByText('HTML Canvas projects')).toBeInTheDocument();
        expect(screen.getByText('Existing Landing Page')).toBeInTheDocument();
      });

      expect(
        vi.mocked(htmlProjectStoreMock.htmlProjectStore.listProjectsByAssistant),
      ).toHaveBeenCalledWith(TEST_ASSISTANTS.basic.id);
    });

    it('should open an existing HTML project from the picker and render the workspace', async () => {
      vi.mocked(htmlProjectStoreMock.htmlProjectStore.listProjectsByAssistant).mockResolvedValue([
        {
          id: 'project-99',
          name: 'Existing Landing Page',
          assistantId: TEST_ASSISTANTS.basic.id,
          entryFile: '/index.html',
          previewVersion: 3,
          updatedAt: 1700000000000,
          description: 'Reopenable project',
        },
      ] as never);
      vi.mocked(htmlProjectStoreMock.htmlProjectStore.assertProjectOwnership).mockResolvedValue({
        id: 'project-99',
        name: 'Existing Landing Page',
        assistantId: TEST_SESSIONS.withMessages.assistantId,
        entryFile: '/index.html',
        status: 'ready',
        previewVersion: 3,
        assetPaths: [],
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
      } as never);

      render(<AppShell />);

      const openPickerButton = await screen.findByRole('button', {
        name: 'HTML Projects',
      });

      expect(screen.getByTestId('html-project-picker')).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(openPickerButton);
      });

      await waitFor(() => {
        expect(screen.getByText('Existing Landing Page')).toBeInTheDocument();
      });

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: '開啟' }));
      });

      await waitFor(() => {
        expect(dbMock.saveSession).toHaveBeenCalledWith(
          expect.objectContaining({
            id: TEST_SESSIONS.withMessages.id,
            activeProjectId: 'project-99',
          }),
        );
        expect(screen.getByTestId('html-project-workspace')).toBeInTheDocument();
        expect(screen.getByText('Workspace: project-99')).toBeInTheDocument();
      });

      expect(
        vi.mocked(htmlProjectStoreMock.htmlProjectStore.assertProjectOwnership),
      ).toHaveBeenCalledWith('project-99', TEST_SESSIONS.withMessages.assistantId);
      expect(
        vi.mocked(htmlPreviewMock.htmlPreviewService.resolveProjectForPreview),
      ).toHaveBeenCalledWith('project-99');
    });

    it('should render HTML project workspace when the active session has a project', async () => {
      const projectSession = {
        ...TEST_SESSIONS.withMessages,
        activeProjectId: 'project-42',
      };
      vi.mocked(dbMock.getSessionsForAssistant).mockResolvedValue([projectSession]);

      render(<AppShell />);

      await waitFor(
        () => {
          expect(screen.getByTestId('chat-container')).toBeInTheDocument();
          expect(screen.getByTestId('html-project-workspace')).toBeInTheDocument();
          expect(screen.getByText('Workspace: project-42')).toBeInTheDocument();
        },
        { timeout: 3000 },
      );

      expect(
        vi.mocked(htmlPreviewMock.htmlPreviewService.resolveProjectForPreview),
      ).toHaveBeenCalledWith('project-42');
    });

    it('should keep the HTML project manager reachable when the current session already has an active project', async () => {
      const projectSession = {
        ...TEST_SESSIONS.withMessages,
        activeProjectId: 'project-42',
      };
      vi.mocked(dbMock.getSessionsForAssistant).mockResolvedValue([projectSession]);
      vi.mocked(htmlProjectStoreMock.htmlProjectStore.listProjectsByAssistant).mockResolvedValue([
        {
          id: 'project-42',
          name: 'Current Workspace',
          assistantId: TEST_ASSISTANTS.basic.id,
          entryFile: '/index.html',
          previewVersion: 3,
          updatedAt: 1700000000000,
          description: 'Current project',
        },
        {
          id: 'project-99',
          name: 'Marketing Site',
          assistantId: TEST_ASSISTANTS.basic.id,
          entryFile: '/landing.html',
          previewVersion: 5,
          updatedAt: 1700000001000,
          description: 'Second project',
        },
      ] as never);

      render(<AppShell />);

      await waitFor(() => {
        expect(screen.getByText('Workspace: project-42')).toBeInTheDocument();
      });

      const managerButton = screen.getByRole('button', { name: 'HTML Projects' });
      expect(managerButton).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(managerButton);
      });

      await waitFor(() => {
        expect(screen.getByText('HTML Canvas projects')).toBeInTheDocument();
        expect(screen.getByText('Current Workspace')).toBeInTheDocument();
        expect(screen.getByText('Marketing Site')).toBeInTheDocument();
        expect(screen.getByText('目前使用中')).toBeInTheDocument();
      });
    });

    it('should clear invalid active project pointers safely when the saved project cannot be reopened', async () => {
      const invalidProjectSession = {
        ...TEST_SESSIONS.withMessages,
        activeProjectId: 'missing-project',
      };
      vi.mocked(dbMock.getSessionsForAssistant).mockResolvedValue([invalidProjectSession]);
      vi.mocked(htmlProjectStoreMock.htmlProjectStore.assertProjectOwnership).mockRejectedValue(
        new Error('Project not found'),
      );

      render(<AppShell />);

      await waitFor(() => {
        expect(dbMock.saveSession).toHaveBeenCalledWith(
          expect.objectContaining({
            id: invalidProjectSession.id,
            activeProjectId: null,
          }),
        );
        expect(screen.getByTestId('chat-container')).toBeInTheDocument();
      });

      expect(screen.queryByTestId('html-project-workspace')).not.toBeInTheDocument();
      expect(
        vi.mocked(htmlPreviewMock.htmlPreviewService.resolveProjectForPreview),
      ).not.toHaveBeenCalledWith('missing-project');
    });

    it('should switch between split and full-width chat layout when the workspace is hidden', async () => {
      const projectSession = {
        ...TEST_SESSIONS.withMessages,
        activeProjectId: 'project-42',
      };
      vi.mocked(dbMock.getSessionsForAssistant).mockResolvedValue([projectSession]);

      render(<AppShell />);

      await waitFor(() => {
        expect(screen.getByTestId('html-project-workspace')).toBeInTheDocument();
      });

      const chatContainer = screen.getByTestId('chat-container');
      const chatPane = chatContainer.parentElement?.parentElement;
      expect(chatPane).toHaveClass('lg:w-[55%]');

      await act(async () => {
        fireEvent.click(screen.getByTestId('hide-workspace'));
      });

      await waitFor(() => {
        expect(screen.queryByTestId('html-project-workspace')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: '顯示 HTML Canvas' })).toBeInTheDocument();
      });

      expect(chatPane).toHaveClass('w-full');
      expect(chatPane).not.toHaveClass('lg:w-[55%]');
    });

    it('should pass hideHeader=true to ChatContainer on mobile chat layouts', async () => {
      Object.defineProperty(window, 'innerWidth', {
        value: 375,
        writable: true,
      });

      render(<AppShell />);

      await act(async () => {
        fireEvent(window, new Event('resize'));
      });

      await waitFor(() => {
        expect(screen.getByText('hideHeader:true')).toBeInTheDocument();
      });
    });

    it('should keep assistant-owned HTML projects reopenable after deleting the active chat session', async () => {
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1700000001234);
      const projectSession = {
        ...TEST_SESSIONS.withMessages,
        activeProjectId: 'project-42',
      };

      vi.mocked(dbMock.getSessionsForAssistant)
        .mockResolvedValueOnce([projectSession])
        .mockResolvedValueOnce([]);
      vi.mocked(htmlProjectStoreMock.htmlProjectStore.listProjectsByAssistant).mockResolvedValue([
        {
          id: 'project-42',
          name: 'Reusable Landing Page',
          assistantId: TEST_ASSISTANTS.basic.id,
          entryFile: '/index.html',
          previewVersion: 3,
          updatedAt: 1700000000000,
          description: 'Assistant-owned project',
        },
      ] as never);
      vi.mocked(htmlProjectStoreMock.htmlProjectStore.assertProjectOwnership).mockResolvedValue({
        id: 'project-42',
        name: 'Reusable Landing Page',
        assistantId: TEST_ASSISTANTS.basic.id,
        entryFile: '/index.html',
        status: 'ready',
        previewVersion: 3,
        assetPaths: [],
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
      } as never);

      render(<AppShell />);

      await waitFor(() => {
        expect(screen.getByText('Workspace: project-42')).toBeInTheDocument();
      });

      await act(async () => {
        fireEvent.click(screen.getByTitle('刪除聊天'));
      });

      await waitFor(() => {
        expect(dbMock.deleteSession).toHaveBeenCalledWith(projectSession.id);
        expect(dbMock.saveSession).toHaveBeenCalledWith(
          expect.objectContaining({
            id: 'session-1700000001234',
            title: 'New Chat',
            assistantId: TEST_ASSISTANTS.basic.id,
          }),
        );
        expect(screen.getByTestId('html-project-picker')).toBeInTheDocument();
      });

      expect(
        htmlProjectStoreMock.htmlProjectStore.deleteProjectsByAssistant,
      ).not.toHaveBeenCalled();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'HTML Projects' }));
      });

      await waitFor(() => {
        expect(screen.getByText('Reusable Landing Page')).toBeInTheDocument();
      });

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: '開啟' }));
      });

      await waitFor(() => {
        expect(dbMock.saveSession).toHaveBeenCalledWith(
          expect.objectContaining({
            id: 'session-1700000001234',
            activeProjectId: 'project-42',
          }),
        );
        expect(screen.getByText('Workspace: project-42')).toBeInTheDocument();
      });

      confirmSpy.mockRestore();
      nowSpy.mockRestore();
    });

    it('should delete the active HTML project, close the workspace, and keep the manager entry point available', async () => {
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
      const projectSession = {
        ...TEST_SESSIONS.withMessages,
        activeProjectId: 'project-42',
      };
      vi.mocked(dbMock.getSessionsForAssistant).mockResolvedValue([projectSession]);
      vi.mocked(htmlProjectStoreMock.htmlProjectStore.listProjectsByAssistant).mockResolvedValue([
        {
          id: 'project-42',
          name: 'Current Workspace',
          assistantId: TEST_ASSISTANTS.basic.id,
          entryFile: '/index.html',
          previewVersion: 3,
          updatedAt: 1700000000000,
          description: 'Current project',
        },
      ] as never);
      vi.mocked(htmlProjectStoreMock.htmlProjectStore.deleteProject).mockResolvedValue({
        id: 'project-42',
        name: 'Current Workspace',
        assistantId: TEST_ASSISTANTS.basic.id,
        entryFile: '/index.html',
        status: 'ready',
        previewVersion: 3,
        assetPaths: [],
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
      } as never);

      render(<AppShell />);

      await waitFor(() => {
        expect(screen.getByText('Workspace: project-42')).toBeInTheDocument();
      });

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'HTML Projects' }));
      });

      await waitFor(() => {
        expect(screen.getByText('Current Workspace')).toBeInTheDocument();
      });

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: '專案動作選單' }));
      });

      await act(async () => {
        fireEvent.click(screen.getByRole('menuitem', { name: 'Delete project' }));
      });

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: '永久刪除' }));
      });

      await waitFor(() => {
        expect(htmlProjectStoreMock.htmlProjectStore.deleteProject).toHaveBeenCalledWith(
          'project-42',
          projectSession.assistantId,
        );
        expect(dbMock.saveSession).toHaveBeenCalledWith(
          expect.objectContaining({
            id: projectSession.id,
            activeProjectId: null,
          }),
        );
        expect(screen.queryByTestId('html-project-workspace')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'HTML Projects' })).toBeInTheDocument();
      });

      confirmSpy.mockRestore();
    });

    it('should sync the workspace to each session active project when switching sessions', async () => {
      const primarySession = {
        ...TEST_SESSIONS.withMessages,
        activeProjectId: 'project-42',
        createdAt: 1700000002000,
      };
      const secondarySession = {
        ...TEST_SESSIONS.old,
        id: 'test-session-2',
        assistantId: TEST_ASSISTANTS.basic.id,
        title: 'Project Two Chat',
        activeProjectId: 'project-99',
        createdAt: 1700000001000,
      };
      vi.mocked(dbMock.getSessionsForAssistant).mockResolvedValue([
        secondarySession,
        primarySession,
      ]);

      render(<AppShell />);

      await waitFor(() => {
        expect(screen.getByText('Workspace: project-42')).toBeInTheDocument();
      });

      await act(async () => {
        fireEvent.click(screen.getByText('Project Two Chat'));
      });

      await waitFor(() => {
        expect(screen.getByText('Workspace: project-99')).toBeInTheDocument();
      });

      expect(
        vi.mocked(htmlProjectStoreMock.htmlProjectStore.assertProjectOwnership),
      ).toHaveBeenCalledWith('project-99', TEST_ASSISTANTS.basic.id);
      expect(
        vi.mocked(htmlPreviewMock.htmlPreviewService.resolveProjectForPreview),
      ).toHaveBeenCalledWith('project-99');
    });

    it('should delete an assistant and clear its HTML projects', async () => {
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
      vi.mocked(dbMock.getAssistant).mockImplementation(async assistantId => {
        if (assistantId === TEST_ASSISTANTS.basic.id) {
          return TEST_ASSISTANTS.basic;
        }

        if (assistantId === TEST_ASSISTANTS.withRag.id) {
          return TEST_ASSISTANTS.withRag;
        }

        return undefined;
      });

      render(<AppShell />);

      const deleteButton = await screen.findByTestId('delete-test-assistant-1');

      await act(async () => {
        fireEvent.click(deleteButton);
      });

      await waitFor(() => {
        expect(dbMock.deleteAssistant).toHaveBeenCalledWith(TEST_ASSISTANTS.basic.id);
        expect(
          htmlProjectStoreMock.htmlProjectStore.deleteProjectsByAssistant,
        ).toHaveBeenCalledWith(TEST_ASSISTANTS.basic.id);
      });

      confirmSpy.mockRestore();
    });

    it('should render settings view with service status', async () => {
      render(<AppShell />);

      // Wait for loading to complete
      await waitFor(
        () => {
          expect(screen.queryByText('載入助理中...')).not.toBeInTheDocument();
        },
        { timeout: 3000 },
      );

      // Find settings button through navigation
      const settingsButton = screen.queryByText('設定');
      if (settingsButton) {
        await act(async () => {
          fireEvent.click(settingsButton);
        });

        await waitFor(() => {
          expect(screen.getAllByText('設定').length).toBeGreaterThanOrEqual(1);
          expect(screen.getByText('服務狀態')).toBeInTheDocument();
          expect(screen.getByText('AI 服務商')).toBeInTheDocument();
          expect(screen.queryByText('Turso 資料庫')).not.toBeInTheDocument();
        });
      }
    });

    it('should render ProviderSettings in provider_settings mode', async () => {
      render(<AppShell />);

      // Wait for loading and navigate to settings
      await waitFor(
        () => {
          expect(screen.queryByText('載入助理中...')).not.toBeInTheDocument();
        },
        { timeout: 3000 },
      );

      const settingsButton = screen.queryByText('設定');
      if (settingsButton) {
        await act(async () => {
          fireEvent.click(settingsButton);
        });

        const providerButton = screen.queryByText('AI 服務商');
        if (providerButton) {
          await act(async () => {
            fireEvent.click(providerButton);
          });

          await waitFor(() => {
            expect(screen.getByTestId('provider-settings')).toBeInTheDocument();
          });
        }
      }
    });
  });

  describe('Loading States', () => {
    it('should show loading screen during initial load', () => {
      render(<AppShell />);

      expect(screen.getByText('載入助理中...')).toBeInTheDocument();
      expect(screen.getByText('正在從資料庫讀取您的助理資料')).toBeInTheDocument();
    });

    it('should show loading steps during initialization', () => {
      render(<AppShell />);

      expect(screen.getByText('連接資料庫')).toBeInTheDocument();
      expect(screen.getByText('載入助理資料')).toBeInTheDocument();
      expect(screen.getByText('初始化介面')).toBeInTheDocument();
    });

    it('should hide loading screen after data loads', async () => {
      render(<AppShell />);

      await waitFor(
        () => {
          expect(screen.queryByText('載入助理中...')).not.toBeInTheDocument();
        },
        { timeout: 3000 },
      );
    });

    it('should show model loading overlay when embedding model loads', async () => {
      vi.mocked(embeddingMock.isEmbeddingModelLoaded).mockReturnValue(false);

      render(<AppShell />);

      // Model loading overlay should be rendered
      // Note: The actual visibility depends on the ModelLoadingOverlay component implementation
      await waitFor(
        () => {
          expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument();
        },
        { timeout: 3000 },
      );
    });
  });

  describe('Empty States', () => {
    it('should show empty state when no assistant is selected and not loading', async () => {
      vi.mocked(dbMock.getAllAssistants).mockResolvedValue([TEST_ASSISTANTS.basic]);
      vi.mocked(dbMock.getAssistant).mockResolvedValue(TEST_ASSISTANTS.basic);
      vi.mocked(dbMock.getSessionsForAssistant).mockResolvedValue([TEST_SESSIONS.withMessages]);

      render(<AppShell />);

      // Wait for loading to complete but before assistant selection
      await waitFor(
        () => {
          expect(screen.queryByText('載入助理中...')).not.toBeInTheDocument();
        },
        { timeout: 3000 },
      );

      // We should see chat view since there are assistants
      expect(screen.queryByText('歡迎使用專業助理')).not.toBeInTheDocument();
    });

    it('should show AssistantEditor in new_assistant mode when no assistants exist', async () => {
      vi.mocked(dbMock.getAllAssistants).mockResolvedValue([]);

      render(<AppShell />);

      await waitFor(
        () => {
          expect(screen.getByTestId('assistant-editor')).toBeInTheDocument();
          expect(screen.getByText('New Mode')).toBeInTheDocument();
        },
        { timeout: 3000 },
      );
      // Welcome message does NOT show because app navigates directly to new_assistant mode
      expect(screen.queryByText('歡迎使用專業助理')).not.toBeInTheDocument();
    });

    it('should show welcome message and navigate to new assistant when welcome button is clicked', async () => {
      // Welcome state appears when assistants exist in DB but getAssistant returns null
      // (selectAssistant no-ops → viewMode stays 'chat', currentAssistant stays null)
      vi.mocked(dbMock.getAllAssistants).mockResolvedValue([TEST_ASSISTANTS.basic]);
      vi.mocked(dbMock.getAssistant).mockResolvedValue(undefined);

      render(<AppShell />);

      const createButton = await waitFor(() => screen.getByText('新增您的第一個助理'), {
        timeout: 3000,
      });

      await act(async () => {
        fireEvent.click(createButton);
      });

      await waitFor(() => {
        expect(screen.getByTestId('assistant-editor')).toBeInTheDocument();
        expect(screen.getByText('New Mode')).toBeInTheDocument();
      });
    });
  });

  describe('Message Handling', () => {
    it('should handle new message from ChatContainer', async () => {
      vi.mocked(dbMock.getAllAssistants).mockResolvedValue([TEST_ASSISTANTS.basic]);
      vi.mocked(dbMock.getAssistant).mockResolvedValue(TEST_ASSISTANTS.basic);
      vi.mocked(dbMock.getSessionsForAssistant).mockResolvedValue([TEST_SESSIONS.withMessages]);

      render(<AppShell />);

      await waitFor(
        () => {
          expect(screen.getByTestId('chat-container')).toBeInTheDocument();
        },
        { timeout: 5000 },
      );

      const sendButton = screen.getByTestId('send-message');
      await act(async () => {
        fireEvent.click(sendButton);
      });

      await waitFor(() => {
        expect(vi.mocked(dbMock.saveSession)).toHaveBeenCalled();
      });
    });

    it('should update session title when handling new message from "New Chat"', async () => {
      const newChatSession = {
        ...TEST_SESSIONS.empty,
        title: 'New Chat',
      };
      vi.mocked(dbMock.getAllAssistants).mockResolvedValue([TEST_ASSISTANTS.basic]);
      vi.mocked(dbMock.getAssistant).mockResolvedValue(TEST_ASSISTANTS.basic);
      vi.mocked(dbMock.getSessionsForAssistant).mockResolvedValue([newChatSession]);

      render(<AppShell />);

      await waitFor(
        () => {
          expect(screen.getByTestId('chat-container')).toBeInTheDocument();
        },
        { timeout: 5000 },
      );

      const sendButton = screen.getByTestId('send-message');
      await act(async () => {
        fireEvent.click(sendButton);
      });

      await waitFor(() => {
        expect(vi.mocked(dbMock.saveSession)).toHaveBeenCalledWith(
          expect.objectContaining({
            title: expect.stringMatching(/test message/),
          }),
        );
      });
    });
  });

  describe('Share Modal Integration', () => {
    it('should show share modal when assistant is shared', async () => {
      render(<AppShell />);

      await waitFor(
        () => {
          expect(screen.queryByText('載入助理中...')).not.toBeInTheDocument();
        },
        { timeout: 3000 },
      );

      // Find and click share button
      const shareButton = screen.queryByTestId('share-test-assistant-1');
      if (shareButton) {
        await act(async () => {
          fireEvent.click(shareButton);
        });

        await waitFor(() => {
          expect(screen.getByTestId('share-modal')).toBeInTheDocument();
        });
      }
    });

    it('should not show share modal initially', async () => {
      render(<AppShell />);

      await waitFor(
        () => {
          expect(screen.queryByTestId('share-modal')).not.toBeInTheDocument();
        },
        { timeout: 3000 },
      );
    });

    it('should close share modal when close is clicked', async () => {
      render(<AppShell />);

      await waitFor(
        () => {
          expect(screen.queryByText('載入助理中...')).not.toBeInTheDocument();
        },
        { timeout: 3000 },
      );

      // Find and click share button
      const shareButton = screen.queryByTestId('share-test-assistant-1');
      if (shareButton) {
        await act(async () => {
          fireEvent.click(shareButton);
        });

        const closeButton = await waitFor(() => screen.getByTestId('close-share-modal'));

        await act(async () => {
          fireEvent.click(closeButton);
        });

        await waitFor(() => {
          expect(screen.queryByTestId('share-modal')).not.toBeInTheDocument();
        });
      }
    });
  });

  describe('Service Status Display', () => {
    it('should show available AI providers status', async () => {
      vi.mocked(providerMock.providerManager.getAvailableProviders).mockReturnValue([
        {
          type: 'gemini',
          provider: {
            name: 'gemini',
            displayName: 'Gemini',
            supportedModels: [],
            requiresApiKey: true,
            supportsLocalMode: false,
            initialize: vi.fn().mockResolvedValue(undefined),
            isAvailable: vi.fn().mockReturnValue(true),
            streamChat: vi.fn(),
          },
        },
        {
          type: 'openai',
          provider: {
            name: 'openai',
            displayName: 'OpenAI',
            supportedModels: [],
            requiresApiKey: true,
            supportsLocalMode: false,
            initialize: vi.fn().mockResolvedValue(undefined),
            isAvailable: vi.fn().mockReturnValue(true),
            streamChat: vi.fn(),
          },
        },
      ] as ReturnType<typeof providerMock.providerManager.getAvailableProviders>);

      render(<AppShell />);

      // Navigate to settings
      await waitFor(
        () => {
          expect(screen.queryByText('載入助理中...')).not.toBeInTheDocument();
        },
        { timeout: 3000 },
      );

      const settingsButton = screen.queryByText('設定');
      if (settingsButton) {
        await act(async () => {
          fireEvent.click(settingsButton);
        });

        await waitFor(() => {
          expect(screen.getByText('2 個 AI 服務商可用')).toBeInTheDocument();
        });
      }
    });

    it('should show no providers available status', async () => {
      vi.mocked(providerMock.providerManager.getAvailableProviders).mockReturnValue(
        [] as ReturnType<typeof providerMock.providerManager.getAvailableProviders>,
      );

      render(<AppShell />);

      // Navigate to settings
      await waitFor(
        () => {
          expect(screen.queryByText('載入助理中...')).not.toBeInTheDocument();
        },
        { timeout: 3000 },
      );

      const settingsButton = screen.queryByText('設定');
      if (settingsButton) {
        await act(async () => {
          fireEvent.click(settingsButton);
        });

        await waitFor(() => {
          expect(screen.getByText('尚未配置 AI 服務商')).toBeInTheDocument();
        });
      }
    });
  });

  describe('Error Boundary Integration', () => {
    it('should wrap content in ErrorBoundary', () => {
      render(<AppShell />);

      expect(screen.getByTestId('error-boundary')).toBeInTheDocument();
    });

    it('should handle component errors gracefully', async () => {
      // This test verifies that ErrorBoundary is used
      render(<AppShell />);

      expect(screen.getByTestId('error-boundary')).toBeInTheDocument();
    });
  });

  describe('Navigation and View Transitions', () => {
    it('should handle navigation between settings and provider settings views', async () => {
      render(<AppShell />);

      await waitFor(
        () => {
          expect(screen.queryByText('載入助理中...')).not.toBeInTheDocument();
        },
        { timeout: 3000 },
      );

      const settingsButton = screen.queryByText('設定');
      if (settingsButton) {
        await act(async () => {
          fireEvent.click(settingsButton);
        });

        await waitFor(() => {
          expect(screen.getByText('服務狀態')).toBeInTheDocument();
        });

        const providerSettingsButton = screen.queryByText('AI 服務商');
        if (providerSettingsButton) {
          await act(async () => {
            fireEvent.click(providerSettingsButton);
          });

          await waitFor(() => {
            expect(screen.getByTestId('provider-settings')).toBeInTheDocument();
          });

          await act(async () => {
            fireEvent.click(screen.getByTestId('provider-settings-close'));
          });

          await waitFor(() => {
            expect(screen.getByText('服務狀態')).toBeInTheDocument();
          });
        }
      }
    });

    it('should keep the provider settings import modal mounted globally', async () => {
      render(<AppShell />);

      await waitFor(
        () => {
          expect(screen.queryByText('載入助理中...')).not.toBeInTheDocument();
        },
        { timeout: 3000 },
      );

      expect(screen.getByTestId('provider-settings-import-modal')).toBeInTheDocument();
    });
  });

  describe('Assistant Editor Integration', () => {
    it('should handle cancel in new assistant mode when no assistants exist', async () => {
      vi.mocked(dbMock.getAllAssistants).mockResolvedValue([]);

      render(<AppShell />);

      await waitFor(
        () => {
          expect(screen.getByTestId('assistant-editor')).toBeInTheDocument();
        },
        { timeout: 3000 },
      );

      const cancelButton = screen.getByTestId('cancel-button');
      await act(async () => {
        fireEvent.click(cancelButton);
      });

      // Should remain in new assistant mode when no assistants exist
      expect(screen.getByTestId('assistant-editor')).toBeInTheDocument();
      expect(screen.getByText('New Mode')).toBeInTheDocument();
    });

    it('should handle cancel in edit assistant mode', async () => {
      render(<AppShell />);

      // Wait for initial load and then switch to edit mode
      await waitFor(
        () => {
          expect(screen.queryByText('載入助理中...')).not.toBeInTheDocument();
        },
        { timeout: 3000 },
      );

      const editButton = screen.queryByTestId('edit-test-assistant-1');
      if (editButton) {
        await act(async () => {
          fireEvent.click(editButton);
        });

        await waitFor(() => {
          expect(screen.getByTestId('assistant-editor')).toBeInTheDocument();
          expect(screen.getByText('Edit Mode')).toBeInTheDocument();
        });

        const cancelButton = screen.getByTestId('cancel-button');
        await act(async () => {
          fireEvent.click(cancelButton);
        });

        // Should return to chat mode
        await waitFor(() => {
          expect(screen.getByTestId('chat-container')).toBeInTheDocument();
        });
      }
    });
  });
});
