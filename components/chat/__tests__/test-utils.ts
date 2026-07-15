import { ChatMessage, ChatSession, Assistant } from '../../../types';
import { vi } from 'vitest';

// Mock data factories for consistent test data
export const createMockChatMessage = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  role: 'user',
  content: 'Test message',
  ...overrides,
});

export const createMockChatSession = (overrides: Partial<ChatSession> = {}): ChatSession => ({
  id: 'test-session-1',
  assistantId: 'test-assistant-1',
  title: 'Test Session',
  messages: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
  tokenCount: 0,
  ...overrides,
});

export const createMockAssistant = (overrides: Partial<Assistant> = {}): Assistant => ({
  id: 'test-assistant-1',
  name: 'Test Assistant',
  description: 'A test assistant',
  systemPrompt: 'You are a helpful test assistant.',
  ragChunks: [],
  createdAt: Date.now(),
  ...overrides,
});

// Mock clipboard API - uses defineProperty to survive userEvent redefining it as getter-only
export const mockClipboard = () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText, readText: vi.fn().mockResolvedValue('') },
    configurable: true,
    writable: true,
  });
  return { writeText };
};

// Mock Date functions for consistent timestamps
export const mockDateNow = (timestamp = 1640995200000) => {
  const spy = vi.spyOn(Date, 'now').mockReturnValue(timestamp);
  return { spy };
};

// Mock toLocaleTimeString for consistent time formatting
export const mockLocaleTimeString = (timeString = '12:00') => {
  const mockDate = new Date();
  const spy = vi.spyOn(mockDate, 'toLocaleTimeString').mockReturnValue(timeString);
  return spy;
};

// Mock external service dependencies
export const mockTursoService = () => {
  return vi.mock('../../../services/tursoService', () => ({}));
};

export const mockLLMService = () => {
  return vi.mock('../../../services/llmService', () => ({
    streamChat: vi.fn().mockResolvedValue(undefined),
  }));
};

// Mock ReactMarkdown for simpler testing - use in beforeAll
export const mockReactMarkdown = () => {
  vi.mock('react-markdown', () => ({
    default: ({ children }: { children: string }) => {
      const React = require('react');
      return React.createElement('div', { 'data-testid': 'markdown-content' }, children);
    },
    defaultUrlTransform: (url: string) => url,
  }));
};

// Mock highlight.js and other markdown dependencies
export const mockMarkdownDependencies = () => {
  vi.mock('remark-gfm', () => ({ default: vi.fn() }));
  vi.mock('rehype-highlight', () => ({ default: vi.fn() }));
  vi.mock('highlight.js/styles/github-dark.css', () => ({}));
};

// Mock UI Icons - use in beforeAll
export const mockIcons = () => {
  vi.mock('../../ui/Icons', () => ({
    UserIcon: ({ className }: { className?: string }) => {
      const React = require('react');
      return React.createElement('div', { 'data-testid': 'user-icon', className }, 'User');
    },
    GeminiIcon: ({ className }: { className?: string }) => {
      const React = require('react');
      return React.createElement('div', { 'data-testid': 'gemini-icon', className }, 'Gemini');
    },
  }));
};

// Utility to create a complete test environment
export const setupTestEnvironment = () => {
  const clipboard = mockClipboard();
  const dateNow = mockDateNow();

  // Mock console methods to avoid noise in tests
  const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  return {
    clipboard,
    dateNow,
    consoleSpy,
    consoleErrorSpy,
    cleanup: () => {
      vi.restoreAllMocks();
    },
  };
};

// Test data constants
export const TEST_MESSAGES = {
  userMessage: createMockChatMessage({
    role: 'user',
    content: 'Hello, how are you?',
  }),
  assistantMessage: createMockChatMessage({
    role: 'model',
    content: 'I am doing well, thank you for asking!',
  }),
  markdownMessage: createMockChatMessage({
    role: 'model',
    content: `# Heading 1
    
This is **bold text** and this is *italic text*.

\`\`\`javascript
console.log('Hello world');
\`\`\`

- List item 1
- List item 2

[Link example](https://example.com)`,
  }),
  codeMessage: createMockChatMessage({
    role: 'model',
    content: 'Here is some inline `code` and a code block:\n\n```python\nprint("Hello")\n```',
  }),
};

export const TEST_SESSIONS = {
  emptySession: createMockChatSession({
    messages: [],
  }),
  sessionWithMessages: createMockChatSession({
    messages: [TEST_MESSAGES.userMessage, TEST_MESSAGES.assistantMessage],
    tokenCount: 150,
  }),
};

export const TEST_ASSISTANTS = {
  basicAssistant: createMockAssistant({
    name: 'Basic Assistant',
    description: 'A simple test assistant',
  }),
  assistantWithDescription: createMockAssistant({
    name: 'Detailed Assistant',
    description: 'An assistant with a detailed description for testing purposes',
  }),
};
