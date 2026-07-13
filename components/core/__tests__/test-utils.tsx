/// <reference lib="dom" />
import { render, RenderOptions } from '@testing-library/react';
import { vi } from 'vitest';
import React from 'react';
import { Assistant, ChatSession, RagChunk } from '../../../types';
import { AppProvider } from '../AppContext';
import type { ViewMode, AppState, ModelLoadingProgress } from '../AppContext.types';

// Mock component prop types
interface AssistantListProps {
  assistants: Assistant[];
  selectedAssistant: Assistant | null;
  onSelect: (id: string) => void;
  onEdit: (assistant: Assistant) => void;
  onDelete: (id: string) => void;
  onShare: (assistant: Assistant) => void;
  onCreateNew: () => void;
}

interface AssistantEditorProps {
  assistant?: Assistant | null;
  onSave: (assistant: Assistant) => void;
  onCancel: () => void;
  onShare?: (assistant: Assistant) => void;
}

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  assistant: Assistant | null;
}

interface ChatContainerProps {
  session: ChatSession | null;
  assistantName: string;
  onNewMessage: (message: string) => void;
}

interface ApiSetupProps {
  onComplete: () => void;
  onCancel: () => void;
}

interface SettingsModalProps {
  onClose: () => void;
}

interface CustomSelectProps {
  assistants: Assistant[];
  selectedAssistant: Assistant | null;
  onSelect: (id: string) => void;
  placeholder: string;
}

// Mock data factories for consistent test data
export const createMockRagChunk = (overrides: Partial<RagChunk> = {}): RagChunk => ({
  fileName: 'test-document.pdf',
  content: 'This is test content for RAG chunk.',
  vector: [0.1, 0.2, 0.3, 0.4, 0.5],
  ...overrides,
});

export const createMockAssistant = (overrides: Partial<Assistant> = {}): Assistant => ({
  id: 'test-assistant-1',
  name: 'Test Assistant',
  description: 'A helpful test assistant for unit testing',
  systemPrompt: 'You are a helpful test assistant.',
  ragChunks: [],
  createdAt: Date.now(),
  ...overrides,
});

export const createMockAssistantWithRag = (overrides: Partial<Assistant> = {}): Assistant => {
  const ragChunks = [
    createMockRagChunk({ fileName: 'document1.pdf' }),
    createMockRagChunk({
      fileName: 'document2.docx',
      content: 'Different content for second chunk',
    }),
  ];

  return createMockAssistant({
    ragChunks,
    ...overrides,
  });
};

export const createMockChatSession = (overrides: Partial<ChatSession> = {}): ChatSession => ({
  id: 'test-session-1',
  assistantId: 'test-assistant-1',
  title: 'Test Chat Session',
  messages: [],
  createdAt: Date.now(),
  tokenCount: 0,
  ...overrides,
});

export const createMockChatSessionWithMessages = (
  overrides: Partial<ChatSession> = {},
): ChatSession => ({
  ...createMockChatSession(),
  messages: [
    {
      role: 'user',
      content: 'Hello, test assistant!',
    },
    {
      role: 'model',
      content: 'Hello! How can I help you today?',
    },
  ],
  title: 'Test Chat with Messages',
  tokenCount: 25,
  ...overrides,
});

export const createMockModelLoadingProgress = (
  overrides: Partial<ModelLoadingProgress> = {},
): ModelLoadingProgress => ({
  status: 'Loading embedding model...',
  progress: 0.5,
  name: 'sentence-transformers/all-MiniLM-L6-v2',
  ...overrides,
});

export const createMockAppState = (overrides: Partial<AppState> = {}): AppState => ({
  assistants: [],
  currentAssistant: null,
  sessions: [],
  currentSession: null,
  viewMode: 'chat',
  isLoading: false,
  error: null,
  isShared: false,
  sharedAssistantId: null,
  isSidebarOpen: true,
  isSidebarCollapsed: false,
  isMobile: false,
  isTablet: false,
  isModelLoading: false,
  modelLoadingProgress: null,
  isShareModalOpen: false,
  assistantToShare: null,
  embeddingConfig: {
    timeoutSeconds: 5,
    fallbackToSimple: true,
    showMethodUsed: false,
  },
  activeProjectId: null,
  isProjectWorkspaceOpen: false,
  projectPreview: null,
  projectToolActivity: [],
  agentRunState: null,
  isBundleImportRoute: false,
  ...overrides,
});

// Mock external service dependencies
export const mockDbService = () => {
  return vi.mock('../../../services/db', () => ({
    getAssistant: vi.fn().mockResolvedValue(createMockAssistant()),
    saveAssistant: vi.fn().mockResolvedValue(undefined),
    deleteAssistant: vi.fn().mockResolvedValue(undefined),
    getAllAssistants: vi.fn().mockResolvedValue([]),
    getSessionsForAssistant: vi.fn().mockResolvedValue([]),
    saveSession: vi.fn().mockResolvedValue(undefined),
    deleteSession: vi.fn().mockResolvedValue(undefined),
  }));
};

export const mockTursoService = () => {
  return vi.mock('../../../services/tursoService', () => ({
    canWriteToTurso: vi.fn().mockReturnValue(true),
  }));
};

export const mockEmbeddingService = () => {
  return vi.mock('../../../services/embeddingService', () => ({
    preloadEmbeddingModel: vi.fn().mockResolvedValue(undefined),
    isEmbeddingModelLoaded: vi.fn().mockReturnValue(true),
    generateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
  }));
};

export const mockProviderRegistry = () => {
  return vi.mock('../../../services/providerRegistry', () => ({
    initializeProviders: vi.fn().mockResolvedValue(undefined),
    providerManager: {
      getAvailableProviders: vi.fn().mockReturnValue(['gemini']),
      getActiveProvider: vi.fn().mockReturnValue(null),
    },
  }));
};

// Mock components for isolation testing
export const mockAssistantComponents = () => {
  vi.mock('../../assistant', () => ({
    AssistantEditor: ({ onSave, onCancel, onShare, assistant }: AssistantEditorProps) => {
      const React = require('react');
      return React.createElement('div', { 'data-testid': 'assistant-editor' }, [
        React.createElement('div', { key: 'mode' }, assistant ? 'Edit Mode' : 'New Mode'),
        React.createElement(
          'button',
          {
            key: 'save',
            onClick: () => onSave(assistant || createMockAssistant()),
            'data-testid': 'save-button',
          },
          'Save',
        ),
        React.createElement(
          'button',
          {
            key: 'cancel',
            onClick: onCancel,
            'data-testid': 'cancel-button',
          },
          'Cancel',
        ),
        onShare &&
          React.createElement(
            'button',
            {
              key: 'share',
              onClick: () => onShare(assistant || createMockAssistant()),
              'data-testid': 'share-button',
            },
            'Share',
          ),
      ]);
    },
    AssistantList: ({
      assistants,
      selectedAssistant,
      onSelect,
      onEdit,
      onDelete,
      onShare,
      onCreateNew,
    }: AssistantListProps) => {
      const React = require('react');
      return React.createElement(
        'div',
        {
          'data-testid': 'assistant-list',
          role: 'navigation',
          'aria-label': '助理選擇',
          className: 'mb-6 px-2',
        },
        [
          React.createElement(
            'label',
            {
              key: 'label',
              className: 'block text-sm font-bold text-gray-300 uppercase tracking-wider mb-2',
            },
            '選擇助理',
          ),
          React.createElement(
            'select',
            {
              key: 'select',
              'data-testid': 'assistant-select',
              value: selectedAssistant?.id || '',
              onChange: (e: { target: { value: string } }) => onSelect(e.target.value),
              className:
                'w-full p-2.5 bg-gray-700/50 border border-gray-600/30 rounded-lg text-white text-sm',
            },
            [
              React.createElement('option', { key: 'placeholder', value: '' }, '請選擇一個助理'),
              ...assistants.map((assistant: Assistant) =>
                React.createElement(
                  'option',
                  { key: assistant.id, value: assistant.id },
                  assistant.name,
                ),
              ),
            ],
          ),
          React.createElement(
            'div',
            {
              key: 'actions',
              className: 'flex justify-end gap-1 mt-2',
            },
            [
              React.createElement(
                'button',
                {
                  key: 'create-new',
                  onClick: onCreateNew,
                  'data-testid': 'create-new-button',
                  className: 'p-1.5 text-gray-400 hover:text-cyan-400 rounded-md',
                  title: '新增助理',
                },
                '+',
              ),
              selectedAssistant &&
                React.createElement(
                  'button',
                  {
                    key: 'share',
                    onClick: () => onShare(selectedAssistant),
                    'data-testid': `share-${selectedAssistant.id}`,
                    className: 'p-1.5 text-gray-400 hover:text-blue-400 rounded-md',
                    title: '分享助理',
                  },
                  'Share',
                ),
              selectedAssistant &&
                React.createElement(
                  'button',
                  {
                    key: 'edit',
                    onClick: () => onEdit(selectedAssistant),
                    'data-testid': `edit-${selectedAssistant.id}`,
                    className: 'p-1.5 text-gray-400 hover:text-cyan-400 rounded-md',
                    title: '編輯助理',
                  },
                  'Edit',
                ),
              selectedAssistant &&
                React.createElement(
                  'button',
                  {
                    key: 'delete',
                    onClick: () => onDelete(selectedAssistant.id),
                    'data-testid': `delete-${selectedAssistant.id}`,
                    className: 'p-1.5 text-gray-400 hover:text-red-400 rounded-md',
                    title: '刪除助理',
                  },
                  'Delete',
                ),
            ],
          ),
        ],
      );
    },
    ShareModal: ({ isOpen, onClose, assistant }: ShareModalProps) => {
      const React = require('react');
      if (!isOpen) {
        return null;
      }
      return React.createElement('div', { 'data-testid': 'share-modal' }, [
        React.createElement('div', { key: 'title' }, `Sharing ${assistant?.name || 'Assistant'}`),
        React.createElement(
          'button',
          {
            key: 'close',
            onClick: onClose,
            'data-testid': 'close-share-modal',
          },
          'Close',
        ),
      ]);
    },
  }));
};

export const mockChatComponents = () => {
  vi.mock('../../chat', () => ({
    ChatContainer: ({ session, assistantName, onNewMessage }: ChatContainerProps) => {
      const React = require('react');
      return React.createElement('div', { 'data-testid': 'chat-container' }, [
        React.createElement('div', { key: 'assistant-name' }, `Chatting with ${assistantName}`),
        React.createElement('div', { key: 'session-id' }, `Session: ${session?.id || 'none'}`),
        React.createElement(
          'button',
          {
            key: 'send-message',
            onClick: () => onNewMessage && onNewMessage('test message'),
            'data-testid': 'send-message',
          },
          'Send Message',
        ),
      ]);
    },
  }));
};

export const mockSharedAssistant = () => {
  vi.mock('../../features/SharedAssistant', () => ({
    default: ({ assistantId }: { assistantId: string }) => {
      const React = require('react');
      return React.createElement(
        'div',
        { 'data-testid': 'shared-assistant' },
        `Shared Assistant: ${assistantId}`,
      );
    },
  }));
};

export const mockOtherComponents = () => {
  vi.mock('../../settings/MigrationPanel', () => ({
    default: () => {
      const React = require('react');
      return React.createElement('div', { 'data-testid': 'migration-panel' }, 'Migration Panel');
    },
  }));

  vi.mock('../../settings/ApiKeySetup', () => ({
    default: ({ onComplete, onCancel }: ApiSetupProps) => {
      const React = require('react');
      return React.createElement('div', { 'data-testid': 'api-key-setup' }, [
        React.createElement(
          'button',
          {
            key: 'complete',
            onClick: onComplete,
            'data-testid': 'api-complete',
          },
          'Complete',
        ),
        React.createElement(
          'button',
          {
            key: 'cancel',
            onClick: onCancel,
            'data-testid': 'api-cancel',
          },
          'Cancel',
        ),
      ]);
    },
  }));

  vi.mock('../../settings/ProviderSettings', () => ({
    default: ({ onClose }: SettingsModalProps) => {
      const React = require('react');
      return React.createElement('div', { 'data-testid': 'provider-settings' }, [
        React.createElement(
          'button',
          {
            key: 'close',
            onClick: onClose,
            'data-testid': 'provider-close',
          },
          'Close Provider Settings',
        ),
      ]);
    },
  }));
};

export const mockUIComponents = () => {
  vi.mock('../../ui/Icons', () => ({
    ChatIcon: ({ className }: { className?: string }) => {
      const React = require('react');
      return React.createElement('div', { 'data-testid': 'chat-icon', className }, 'Chat');
    },
    TrashIcon: ({ className }: { className?: string }) => {
      const React = require('react');
      return React.createElement('div', { 'data-testid': 'trash-icon', className }, 'Trash');
    },
    SettingsIcon: ({ className }: { className?: string }) => {
      const React = require('react');
      return React.createElement('div', { 'data-testid': 'settings-icon', className }, 'Settings');
    },
    PlusIcon: ({ className }: { className?: string }) => {
      const React = require('react');
      return React.createElement('div', { 'data-testid': 'plus-icon', className }, 'Plus');
    },
    EditIcon: ({ className }: { className?: string }) => {
      const React = require('react');
      return React.createElement('div', { 'data-testid': 'edit-icon', className }, 'Edit');
    },
  }));

  vi.mock('../../ui/CustomSelect', () => ({
    CustomSelect: ({ assistants, selectedAssistant, onSelect, placeholder }: CustomSelectProps) => {
      const React = require('react');
      return React.createElement(
        'select',
        {
          'data-testid': 'custom-select',
          value: selectedAssistant?.id || '',
          onChange: (e: { target: { value: string } }) => onSelect(e.target.value),
          className:
            'w-full p-2.5 bg-gray-700/50 border border-gray-600/30 rounded-lg text-white text-sm',
        },
        [
          React.createElement('option', { key: 'placeholder', value: '' }, placeholder),
          ...assistants.map((assistant: Assistant) =>
            React.createElement(
              'option',
              { key: assistant.id, value: assistant.id },
              assistant.name,
            ),
          ),
        ],
      );
    },
  }));
};

// Mock window methods
export const mockWindowMethods = () => {
  const confirmSpy = vi.spyOn(window, 'confirm');
  const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

  // Mock window.addEventListener for resize events
  const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
  const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');

  // Mock URL search params
  const mockURLSearchParams = vi.fn().mockImplementation(_search => ({
    has: vi.fn().mockReturnValue(false),
    get: vi.fn().mockReturnValue(null),
  }));

  Object.defineProperty(window, 'URLSearchParams', {
    value: mockURLSearchParams,
    writable: true,
  });

  // Mock window dimensions
  Object.defineProperty(window, 'innerWidth', {
    value: 1024,
    writable: true,
  });

  Object.defineProperty(window, 'innerHeight', {
    value: 768,
    writable: true,
  });

  return {
    confirmSpy,
    alertSpy,
    addEventListenerSpy,
    removeEventListenerSpy,
    mockURLSearchParams,
  };
};

// Mock Date.now for consistent testing
export const mockDateNow = (timestamp = 1640995200000) => {
  const spy = vi.spyOn(Date, 'now').mockReturnValue(timestamp);
  return spy;
};

// Mock console methods to avoid noise in tests
export const mockConsole = () => {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

  return { logSpy, errorSpy, warnSpy };
};

// Utility to create a complete test environment for core components
export const setupCoreTestEnvironment = () => {
  const dateNow = mockDateNow();
  const windowMocks = mockWindowMethods();
  const consoleMocks = mockConsole();

  // Mock idb to prevent unhandled rejections in Node.js environment
  vi.mock('idb', () => ({
    openDB: vi.fn().mockImplementation(async (_name: string, _version: number) => {
      const db = {
        getAll: vi.fn().mockResolvedValue([]),
        get: vi.fn().mockResolvedValue(undefined),
        put: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
        getAllFromIndex: vi.fn().mockResolvedValue([]),
        transaction: vi.fn().mockImplementation((_storeName: string) => ({
          objectStore: vi.fn().mockReturnValue({
            getAll: vi.fn().mockResolvedValue([]),
            get: vi.fn().mockResolvedValue(undefined),
            put: vi.fn().mockResolvedValue(undefined),
            delete: vi.fn().mockResolvedValue(undefined),
            getAllFromIndex: vi.fn().mockResolvedValue([]),
          }),
          done: Promise.resolve(),
        })),
      };
      return db;
    }),
  }));

  // Mock all external dependencies
  mockDbService();
  mockTursoService();
  mockEmbeddingService();
  mockProviderRegistry();

  // Mock all UI components
  mockAssistantComponents();
  mockChatComponents();
  mockSharedAssistant();
  mockOtherComponents();
  mockUIComponents();

  return {
    dateNow,
    ...windowMocks,
    ...consoleMocks,
    cleanup: () => {
      vi.restoreAllMocks();
    },
  };
};

// Custom render function with AppProvider wrapper
export const renderWithAppProvider = (ui: React.ReactElement, options?: RenderOptions) => {
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <AppProvider>{children}</AppProvider>
  );

  return render(ui, { wrapper: Wrapper, ...options });
};

// Test data constants for core components
export const TEST_ASSISTANTS = {
  basic: createMockAssistant({
    name: 'Basic Assistant',
    description: 'A simple test assistant',
  }),
  withRag: createMockAssistantWithRag({
    name: 'RAG Assistant',
    description: 'An assistant with knowledge documents',
  }),
  shared: createMockAssistant({
    name: 'Shared Assistant',
    description: 'A publicly shared assistant',
    isShared: true,
  }),
};

export const TEST_SESSIONS = {
  empty: createMockChatSession({
    title: 'New Chat',
  }),
  withMessages: createMockChatSessionWithMessages({
    title: 'Active Chat',
  }),
  old: createMockChatSession({
    title: 'Old Chat',
    createdAt: Date.now() - 86400000, // 1 day ago
  }),
};

export const TEST_VIEW_MODES: ViewMode[] = [
  'chat',
  'new_assistant',
  'edit_assistant',
  'settings',
  'api_setup',
  'provider_settings',
];

export const RESPONSIVE_BREAKPOINTS = {
  mobile: 767,
  tablet: 1023,
  desktop: 1024,
};
