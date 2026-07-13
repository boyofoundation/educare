/// <reference lib="dom" />
/* global ProgressEvent, HTMLSelectElement, Blob */
import { Assistant, RagChunk } from '../../../types';
import { vi } from 'vitest';
import React from 'react';

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

export const createMockSharedAssistant = (overrides: Partial<Assistant> = {}): Assistant => ({
  ...createMockAssistant(),
  isShared: true,
  ...overrides,
});

// Mock external service dependencies
export const mockDbService = () => {
  return vi.mock('../../services/db', () => ({
    getAssistant: vi.fn().mockResolvedValue(createMockAssistant()),
    saveAssistant: vi.fn().mockResolvedValue(undefined),
    deleteAssistant: vi.fn().mockResolvedValue(undefined),
    getAllAssistants: vi.fn().mockResolvedValue([]),
  }));
};

export const mockTursoService = () => {
  return vi.mock('../../services/tursoService', () => ({
    saveAssistantToTurso: vi.fn().mockResolvedValue(undefined),
    saveRagChunkToTurso: vi.fn().mockResolvedValue(undefined),
    getRagChunkCount: vi.fn().mockResolvedValue(0),
    searchSimilarChunks: vi.fn().mockResolvedValue([]),
  }));
};

export const mockEmbeddingService = () => {
  return vi.mock('../../services/embeddingService', () => ({
    generateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    cosineSimilarity: vi.fn().mockReturnValue(0.8),
  }));
};

export const mockDocumentParserService = () => {
  return vi.mock('../../services/documentParserService', () => ({
    DocumentParserService: {
      isSupportedFile: vi.fn().mockReturnValue(true),
      getFileTypeName: vi.fn().mockReturnValue('PDF'),
      parseDocument: vi.fn().mockResolvedValue({
        content: 'Mocked document content for testing purposes.',
        metadata: { fileName: 'test.pdf', fileType: 'pdf' },
      }),
    },
  }));
};

// Mock File API for file upload testing
export const createMockFile = (
  name = 'test.pdf',
  type = 'application/pdf',
  content = 'test content',
): File => {
  const blob = new Blob([content], { type });
  const file = new File([blob], name, { type });
  return file;
};

// Mock FileReader for testing file operations
export const mockFileReader = () => {
  const mockReader = {
    readAsText: vi.fn(),
    readAsArrayBuffer: vi.fn(),
    result: 'mocked file content',
    onload: null as ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null,
    onerror: null as ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null,
  };

  vi.spyOn(global, 'FileReader').mockImplementation(() => mockReader as unknown as FileReader);
  return mockReader;
};

// Mock window.confirm for delete operations
export const mockWindowConfirm = (returnValue = true) => {
  const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(returnValue);
  return confirmSpy;
};

// Mock window.alert for validation messages
export const mockWindowAlert = () => {
  const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
  return alertSpy;
};

// Mock Date functions for consistent timestamps
export const mockDateNow = (timestamp = 1640995200000) => {
  const spy = vi.spyOn(Date, 'now').mockReturnValue(timestamp);
  return spy;
};

// Mock UI Icons for simplified testing
export const mockIcons = () => {
  vi.mock('../../ui/Icons', () => ({
    PlusIcon: ({ className }: { className?: string }) => {
      const React = require('react');
      return React.createElement('div', { 'data-testid': 'plus-icon', className }, 'Plus');
    },
    EditIcon: ({ className }: { className?: string }) => {
      const React = require('react');
      return React.createElement('div', { 'data-testid': 'edit-icon', className }, 'Edit');
    },
    TrashIcon: ({ className }: { className?: string }) => {
      const React = require('react');
      return React.createElement('div', { 'data-testid': 'trash-icon', className }, 'Trash');
    },
  }));
};

// Mock qrcode library
export const mockQRCode = () => {
  vi.mock('qrcode', () => ({
    default: {
      toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,mocked-qr-code'),
    },
    toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,mocked-qr-code-direct'),
  }));
};

// Mock CustomSelect component
export const mockCustomSelect = () => {
  vi.mock('../ui/CustomSelect', () => ({
    CustomSelect: ({
      assistants,
      selectedAssistant,
      onSelect,
      placeholder,
    }: {
      assistants: Assistant[];
      selectedAssistant: Assistant | null;
      onSelect: (id: string) => void;
      placeholder: string;
    }) => {
      const React = require('react');
      return React.createElement(
        'select',
        {
          'data-testid': 'custom-select',
          value: selectedAssistant?.id || '',
          onChange: (e: React.ChangeEvent<HTMLSelectElement>) => onSelect(e.target.value),
        },
        [
          React.createElement('option', { key: 'placeholder', value: '' }, placeholder),
          ...assistants.map(assistant =>
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

// Mock AssistantEditor component for container tests
export const mockAssistantEditor = () => {
  vi.mock('../AssistantEditor', () => ({
    AssistantEditor: ({
      assistant,
      onSave,
      onCancel,
      onShare,
    }: {
      assistant: Assistant | null;
      onSave: (assistant: Assistant) => void;
      onCancel: () => void;
      onShare?: (assistant: Assistant) => void;
    }) => {
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
  }));
};

// Mock ShareModal component
export const mockShareModal = () => {
  vi.mock('../ShareModal', () => ({
    ShareModal: ({
      isOpen,
      onClose,
      assistant,
    }: {
      isOpen: boolean;
      onClose: () => void;
      assistant: Assistant;
    }) => {
      const React = require('react');
      if (!isOpen) {
        return null;
      }
      return React.createElement('div', { 'data-testid': 'share-modal' }, [
        React.createElement('div', { key: 'title' }, `Sharing ${assistant.name}`),
        React.createElement(
          'button',
          {
            key: 'close',
            onClick: onClose,
            'data-testid': 'close-modal-button',
          },
          'Close',
        ),
      ]);
    },
  }));
};

// Utility to create a complete test environment for assistant components
export const setupAssistantTestEnvironment = () => {
  const dateNow = mockDateNow();
  const confirmSpy = mockWindowConfirm();
  const alertSpy = mockWindowAlert();

  // Mock console methods to avoid noise in tests
  const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  return {
    dateNow,
    confirmSpy,
    alertSpy,
    consoleSpy,
    consoleErrorSpy,
    cleanup: () => {
      vi.restoreAllMocks();
    },
  };
};

// Test data constants for assistant module
export const TEST_ASSISTANTS = {
  basic: createMockAssistant({
    name: 'Basic Assistant',
    description: 'A simple test assistant',
  }),
  withRag: createMockAssistantWithRag({
    name: 'RAG Assistant',
    description: 'An assistant with knowledge documents',
  }),
  shared: createMockSharedAssistant({
    name: 'Shared Assistant',
    description: 'A publicly shared assistant',
  }),
  withLongDescription: createMockAssistant({
    name: 'Detailed Assistant',
    description:
      'An assistant with a very long description that might need to be truncated in the UI to ensure proper layout and readability.',
  }),
  withoutDescription: createMockAssistant({
    name: 'Simple Assistant',
    description: '',
  }),
};

export const TEST_RAG_CHUNKS = {
  pdf: createMockRagChunk({
    fileName: 'document.pdf',
    content: 'This is content from a PDF document.',
  }),
  docx: createMockRagChunk({
    fileName: 'document.docx',
    content: 'This is content from a Word document.',
  }),
  md: createMockRagChunk({
    fileName: 'readme.md',
    content: '# Markdown Content\n\nThis is markdown content.',
  }),
};
