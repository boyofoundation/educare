import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import MessageBubble from '../MessageBubble';
import { createMockChatMessage } from './test-utils';

vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => (
    <div data-testid='markdown-content'>{children}</div>
  ),
}));
vi.mock('remark-gfm', () => ({ default: vi.fn() }));
vi.mock('rehype-highlight', () => ({ default: vi.fn() }));
vi.mock('highlight.js/styles/github-dark.css', () => ({}));
vi.mock('../../ui/Icons', () => ({
  UserIcon: ({ className }: { className?: string }) => (
    <span data-testid='user-icon' className={className}>
      User
    </span>
  ),
  GeminiIcon: ({ className }: { className?: string }) => (
    <span data-testid='gemini-icon' className={className}>
      Gemini
    </span>
  ),
}));

describe('MessageBubble', () => {
  describe('User Message Rendering', () => {
    it('should render user message with proper layout', () => {
      // Arrange
      const userMessage = createMockChatMessage({
        role: 'user',
        content: 'Hello world',
      });

      // Act
      render(<MessageBubble message={userMessage} index={0} />);

      // Assert
      expect(screen.getByTestId('markdown-content')).toHaveTextContent('Hello world');
      expect(screen.getByTestId('user-icon')).toBeInTheDocument();

      // Check for right-aligned layout - should have justify-end class somewhere
      const justifyEndElement = document.querySelector('.justify-end');
      expect(justifyEndElement).toBeInTheDocument();
    });

    it('should show copy button for user messages', () => {
      // Arrange
      const userMessage = createMockChatMessage({
        role: 'user',
        content: 'Test message',
      });

      // Act
      render(<MessageBubble message={userMessage} index={0} />);

      // Assert
      const copyButton = screen.getByTitle('複製訊息');
      expect(copyButton).toBeInTheDocument();
    });

    it('should handle copy functionality', async () => {
      // Arrange
      const userMessage = createMockChatMessage({
        role: 'user',
        content: 'Copy this message',
      });
      render(<MessageBubble message={userMessage} index={0} />);

      // Act
      const copyButton = screen.getByTitle('複製訊息');
      fireEvent.click(copyButton);

      // Assert
      await waitFor(() => {
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Copy this message');
      });
    });
  });

  describe('Assistant Message Rendering', () => {
    it('should render assistant message with proper layout', () => {
      // Arrange
      const assistantMessage = createMockChatMessage({
        role: 'model',
        content: 'Assistant response',
      });

      // Act
      render(<MessageBubble message={assistantMessage} index={0} />);

      // Assert
      expect(screen.getByTestId('markdown-content')).toHaveTextContent('Assistant response');
      expect(screen.getByTestId('gemini-icon')).toBeInTheDocument();

      // Check for left-aligned layout - should have justify-start class somewhere
      const justifyStartElement = document.querySelector('.justify-start');
      expect(justifyStartElement).toBeInTheDocument();
    });

    it('should show copy button for assistant messages', () => {
      // Arrange
      const assistantMessage = createMockChatMessage({
        role: 'model',
        content: 'Assistant message',
      });

      // Act
      render(<MessageBubble message={assistantMessage} index={0} />);

      // Assert
      const copyButton = screen.getByTitle('複製回應');
      expect(copyButton).toBeInTheDocument();
    });

    it('should handle copy functionality for assistant messages', async () => {
      // Arrange
      const assistantMessage = createMockChatMessage({
        role: 'model',
        content: 'Copy this response',
      });
      render(<MessageBubble message={assistantMessage} index={0} />);

      // Act
      const copyButton = screen.getByTitle('複製回應');
      fireEvent.click(copyButton);

      // Assert
      await waitFor(() => {
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Copy this response');
      });
    });

    it('should render persisted subagent runs above the assistant message', () => {
      // Arrange
      const assistantMessage = createMockChatMessage({
        role: 'model',
        content: 'Assistant response with delegated work',
        subagentRuns: [
          {
            id: 'run-1',
            batchId: 'batch-1',
            name: 'Persisted researcher',
            task: 'Investigate prior context',
            status: 'complete',
            output: 'Delegated summary',
            toolSequence: ['Read', 'Search'],
            durationMs: 1800,
          },
          {
            id: 'run-2',
            batchId: 'batch-1',
            name: 'Live planner',
            task: 'Outline next steps',
            status: 'running',
            output: 'Partial plan',
            toolSequence: ['Plan'],
            durationMs: 300,
          },
        ],
      });

      // Act
      render(<MessageBubble message={assistantMessage} index={0} />);

      // Assert
      expect(screen.getByText('Subagent activity')).toBeInTheDocument();
      expect(screen.getByText('2 tasks')).toBeInTheDocument();
      expect(screen.getByText('Persisted researcher')).toBeInTheDocument();
      expect(screen.getByText('Live planner')).toBeInTheDocument();
      expect(screen.getByText('Complete')).toBeInTheDocument();
      expect(screen.getByText('Running')).toBeInTheDocument();
      expect(screen.getByText('Delegated summary')).toBeInTheDocument();
      expect(screen.queryByText('Partial plan')).not.toBeInTheDocument();
    });

    it('should render persisted tool call activity above the assistant message', () => {
      const assistantMessage = createMockChatMessage({
        role: 'model',
        content: 'Assistant response with tool activity',
        toolCallLog: [
          {
            id: 'tool-1',
            name: 'writeFiles',
            startedAt: 1700000000000,
            status: 'ok',
            summary: 'Updated /index.html',
            durationMs: 15,
          },
          {
            id: 'tool-2',
            name: 'lintProject',
            startedAt: 1700000000100,
            status: 'recoverable_error',
            code: 'lint-path-not-found',
            summary: 'lintProject could not find 1 requested path(s).',
            durationMs: 21,
          },
        ],
      });

      render(<MessageBubble message={assistantMessage} index={0} />);

      expect(screen.getByText('Tool activity')).toBeInTheDocument();
      expect(screen.getByText('2 calls')).toBeInTheDocument();
      expect(screen.getByText('writeFiles')).toBeInTheDocument();
      expect(screen.getByText('lintProject')).toBeInTheDocument();
      expect(screen.getByText('OK')).toBeInTheDocument();
      expect(screen.getByText('Recoverable')).toBeInTheDocument();
      expect(screen.getByText('Updated /index.html')).toBeInTheDocument();
      expect(
        screen.getByText('lintProject could not find 1 requested path(s).'),
      ).toBeInTheDocument();
      expect(screen.getByText('lint-path-not-found')).toBeInTheDocument();
    });

    it('should render persisted subagent runs above the assistant message', () => {
      // Arrange
      const assistantMessage = createMockChatMessage({
        role: 'model',
        content: 'Assistant response with delegated work',
        subagentRuns: [
          {
            id: 'run-1',
            batchId: 'batch-1',
            name: 'Persisted researcher',
            task: 'Investigate prior context',
            status: 'complete',
            output: 'Delegated summary',
            toolSequence: ['Read', 'Search'],
            durationMs: 1800,
          },
          {
            id: 'run-2',
            batchId: 'batch-1',
            name: 'Live planner',
            task: 'Outline next steps',
            status: 'running',
            output: 'Partial plan',
            toolSequence: ['Plan'],
            durationMs: 300,
          },
        ],
      });

      // Act
      render(<MessageBubble message={assistantMessage} index={0} />);

      // Assert
      expect(screen.getByText('Subagent activity')).toBeInTheDocument();
      expect(screen.getByText('2 tasks')).toBeInTheDocument();
      expect(screen.getByText('Persisted researcher')).toBeInTheDocument();
      expect(screen.getByText('Live planner')).toBeInTheDocument();
      expect(screen.getByText('Complete')).toBeInTheDocument();
      expect(screen.getByText('Running')).toBeInTheDocument();
      expect(screen.getByText('Delegated summary')).toBeInTheDocument();
      expect(screen.queryByText('Partial plan')).not.toBeInTheDocument();
    });
  });

  describe('Markdown Content Processing', () => {
    it('should render content through ReactMarkdown', () => {
      // Arrange
      const markdownMessage = createMockChatMessage({
        role: 'model',
        content: '# Heading\n\nSome **bold** text',
      });

      // Act
      render(<MessageBubble message={markdownMessage} index={0} />);

      // Assert
      expect(screen.getByTestId('markdown-content')).toBeInTheDocument();
      // The mock renders content without preserving whitespace exactly
      expect(screen.getByTestId('markdown-content')).toHaveTextContent(
        '# Heading Some **bold** text',
      );
    });
  });

  describe('Timestamp Display', () => {
    it('should display timestamp for both message types', () => {
      // Arrange
      const userMessage = createMockChatMessage({
        role: 'user',
        content: 'Test message',
      });

      // Act
      render(<MessageBubble message={userMessage} index={0} />);

      // Assert
      // Look for any element that matches time format
      const timestampElement = document.querySelector('.text-xs.text-gray-400');
      expect(timestampElement).toBeInTheDocument();
    });
  });

  describe('Error Handling', () => {
    it('should handle empty content gracefully', () => {
      // Arrange
      const emptyMessage = createMockChatMessage({
        role: 'user',
        content: '',
      });

      // Act & Assert
      expect(() => {
        render(<MessageBubble message={emptyMessage} index={0} />);
      }).not.toThrow();

      expect(screen.getByTestId('markdown-content')).toBeInTheDocument();
    });

    it('should handle very long content', () => {
      // Arrange
      const longMessage = createMockChatMessage({
        role: 'model',
        content: 'Very long content. '.repeat(100),
      });

      // Act & Assert
      expect(() => {
        render(<MessageBubble message={longMessage} index={0} />);
      }).not.toThrow();
    });
  });

  describe('Synthetic Message Collapse (G6)', () => {
    it('renders collapsed marker for synthetic messages and hides raw content by default', () => {
      const synthetic = createMockChatMessage({
        role: 'user',
        content: 'CONTINUATION_PROMPT hidden from user',
        synthetic: true,
      });

      render(<MessageBubble message={synthetic} index={0} />);

      expect(screen.getByTestId('synthetic-message')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '展開續跑訊息' })).toBeInTheDocument();
      // Raw content must not appear until expanded.
      expect(screen.queryByText('CONTINUATION_PROMPT hidden from user')).not.toBeInTheDocument();
    });

    it('reveals the synthetic content when the marker is clicked', () => {
      const synthetic = createMockChatMessage({
        role: 'user',
        content: 'Hidden continuation text',
        synthetic: true,
        agentTurnLog: 'turn-log-summary',
      });

      render(<MessageBubble message={synthetic} index={0} />);

      fireEvent.click(screen.getByRole('button', { name: '展開續跑訊息' }));

      expect(screen.getByText('Hidden continuation text')).toBeInTheDocument();
      expect(screen.getByText('turn-log-summary')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '摺疊續跑訊息' })).toBeInTheDocument();
    });
  });
});
