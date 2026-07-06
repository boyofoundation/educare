import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import StreamingResponse from '../StreamingResponse';
import { setupTestEnvironment } from './test-utils';

vi.mock('react-markdown', () => {
  const React = require('react');
  return {
    default: function MockReactMarkdown(props: { children?: unknown }) {
      return React.createElement('div', { 'data-testid': 'markdown-content' }, props.children);
    },
  };
});
vi.mock('remark-gfm', () => ({ default: vi.fn() }));
vi.mock('rehype-highlight', () => ({ default: vi.fn() }));
vi.mock('highlight.js/styles/github-dark.css', () => ({}));
vi.mock('../../ui/Icons', () => ({
  GeminiIcon: ({ className }: { className?: string }) => (
    <span data-testid='gemini-icon' className={className}>
      Gemini
    </span>
  ),
  UserIcon: ({ className }: { className?: string }) => (
    <span data-testid='user-icon' className={className}>
      User
    </span>
  ),
}));

describe('StreamingResponse', () => {
  let testEnv: ReturnType<typeof setupTestEnvironment>;

  beforeEach(() => {
    testEnv = setupTestEnvironment();
  });

  afterEach(() => {
    testEnv.cleanup();
  });

  describe('Basic Rendering', () => {
    it('should render streaming content', () => {
      // Arrange
      const content = 'This is streaming content...';

      // Act
      render(<StreamingResponse content={content} />);

      // Assert
      expect(screen.getByTestId('markdown-content')).toHaveTextContent(content);
    });

    it('should render with assistant-style layout', () => {
      // Arrange & Act
      render(<StreamingResponse content='Test content' />);

      // Assert
      const container = screen.getByTestId('markdown-content').closest('.flex.justify-start');
      expect(container).toBeInTheDocument();
    });

    it('should have proper structure similar to assistant messages', () => {
      // Arrange & Act
      render(<StreamingResponse content='Test content' />);

      // Assert
      const mainContainer = screen.getByTestId('markdown-content').closest('.max-w-3xl');
      expect(mainContainer).toBeInTheDocument();
    });
  });

  describe('Icon Rendering', () => {
    it('should render Gemini icon', () => {
      // Arrange & Act
      render(<StreamingResponse content='Test content' />);

      // Assert
      expect(screen.getByTestId('gemini-icon')).toBeInTheDocument();
    });

    it('should apply correct styling to icon', () => {
      // Arrange & Act
      render(<StreamingResponse content='Test content' />);

      // Assert
      const icon = screen.getByTestId('gemini-icon');
      expect(icon).toHaveClass('w-5', 'h-5', 'text-cyan-400');
    });

    it('should render icon container with enhanced styling for streaming', () => {
      // Arrange & Act
      render(<StreamingResponse content='Test content' />);

      // Assert
      const iconContainer = screen.getByTestId('gemini-icon').closest('div');
      expect(iconContainer).toHaveClass(
        'w-10',
        'h-10',
        'bg-gradient-to-br',
        'from-gray-700',
        'to-gray-600',
        'rounded-full',
        'flex',
        'items-center',
        'justify-center',
        'shadow-lg',
        'ring-1',
        'ring-gray-600/30',
      );
    });
  });

  describe('Streaming Indicators', () => {
    it('should display typing cursor animation', () => {
      // Arrange & Act
      render(<StreamingResponse content='Partial content' />);

      // Assert
      const cursor = document.querySelector('.w-0\\.5.h-4.bg-cyan-400.animate-pulse');
      expect(cursor).toBeInTheDocument();
    });

    it('should not show the removed floating streaming indicator dot', () => {
      render(<StreamingResponse content='Test content' />);

      const streamingDot = document.querySelector(
        '.-top-2.-right-2.w-4.h-4.bg-cyan-500.rounded-full.animate-pulse',
      );
      expect(streamingDot).not.toBeInTheDocument();
    });

    it('should display real-time typing message', () => {
      // Arrange & Act
      render(<StreamingResponse content='Test content' />);

      // Assert
      expect(screen.getByText('正在輸入...')).toBeInTheDocument();
    });

    it('should apply proper styling to typing indicator', () => {
      // Arrange & Act
      render(<StreamingResponse content='Test content' />);

      // Assert
      const typingIndicator = screen.getByText('正在輸入...');
      expect(typingIndicator).toHaveClass('text-xs', 'text-gray-300', 'mt-1', 'px-2', 'opacity-70');
    });
  });

  describe('Markdown Content Processing', () => {
    it('should render content through ReactMarkdown', () => {
      // Arrange
      const markdownContent = '# Heading\n\nSome **bold** text with `code`';

      // Act
      render(<StreamingResponse content={markdownContent} />);

      // Assert
      expect(screen.getByTestId('markdown-content')).toBeInTheDocument();
      expect(screen.getByTestId('markdown-content')).toHaveTextContent(markdownContent, {
        normalizeWhitespace: false,
      });
    });

    it('should handle empty content', () => {
      // Arrange & Act
      render(<StreamingResponse content='' />);

      // Assert
      expect(screen.getByTestId('markdown-content')).toBeInTheDocument();
      expect(screen.getByTestId('markdown-content')).toHaveTextContent('');
    });

    it('should handle partial markdown content during streaming', () => {
      // Arrange
      const partialMarkdown = '# Heading\n\nThis is partial conte';

      // Act
      render(<StreamingResponse content={partialMarkdown} />);

      // Assert
      expect(screen.getByTestId('markdown-content')).toHaveTextContent(partialMarkdown, {
        normalizeWhitespace: false,
      });
    });

    it('should process markdown with special characters', () => {
      // Arrange
      const specialContent = 'Content with émojis 🚀 and spéciał chars & <tags>';

      // Act
      render(<StreamingResponse content={specialContent} />);

      // Assert
      expect(screen.getByTestId('markdown-content')).toHaveTextContent(specialContent);
    });
  });

  describe('Container Styling', () => {
    it('should apply proper bubble styling', () => {
      // Arrange & Act
      render(<StreamingResponse content='Test content' />);

      // Assert
      const bubble = screen.getByTestId('markdown-content').closest('.bg-gray-800\\/80');
      expect(bubble).toHaveClass(
        'bg-gray-800/80',
        'backdrop-blur-sm',
        'text-gray-100',
        'px-5',
        'py-3',
        'rounded-2xl',
        'rounded-bl-md',
        'shadow-lg',
        'border',
        'border-gray-700/50',
        'relative',
      );
    });

    it('should render within the streaming metadata column', () => {
      render(<StreamingResponse content='Test content' />);

      const groupContainer = screen.getByTestId('markdown-content').closest('.flex.flex-col');
      expect(groupContainer).toBeInTheDocument();
    });

    it('should have proper text styling within bubble', () => {
      // Arrange & Act
      render(<StreamingResponse content='Test content' />);

      // Assert
      const textContainer = screen
        .getByTestId('markdown-content')
        .closest('.text-sm.leading-relaxed');
      expect(textContainer).toBeInTheDocument();
    });
  });

  describe('Real-time Display Features', () => {
    it('should update content dynamically', () => {
      // Arrange
      const { rerender } = render(<StreamingResponse content='Initial' />);

      // Act
      rerender(<StreamingResponse content='Initial content' />);
      rerender(<StreamingResponse content='Initial content updated' />);

      // Assert
      expect(screen.getByTestId('markdown-content')).toHaveTextContent('Initial content updated');
    });

    it('should maintain streaming indicators during content updates', () => {
      // Arrange
      const { rerender } = render(<StreamingResponse content='Initial' />);

      // Act
      rerender(<StreamingResponse content='Updated content' />);

      // Assert
      expect(screen.getByText('正在輸入...')).toBeInTheDocument();
      const cursor = document.querySelector('.animate-pulse');
      expect(cursor).toBeInTheDocument();
    });

    it('should show progressive content building', () => {
      // Arrange
      const progressiveContent = [
        'Hello',
        'Hello world',
        'Hello world! This',
        'Hello world! This is a',
        'Hello world! This is a streaming response.',
      ];

      const { rerender } = render(<StreamingResponse content={progressiveContent[0]} />);

      // Act & Assert
      progressiveContent.forEach((content, index) => {
        if (index > 0) {
          rerender(<StreamingResponse content={content} />);
        }
        expect(screen.getByTestId('markdown-content')).toHaveTextContent(content);
      });
    });

    it('should handle rapid content updates', () => {
      // Arrange
      const { rerender } = render(<StreamingResponse content='' />);

      // Act - Simulate rapid streaming updates
      for (let i = 0; i < 10; i++) {
        const content = 'a'.repeat(i + 1);
        rerender(<StreamingResponse content={content} />);
      }

      // Assert
      expect(screen.getByTestId('markdown-content')).toHaveTextContent('aaaaaaaaaa');
      expect(screen.getByText('正在輸入...')).toBeInTheDocument();
    });
  });

  describe('Animation Consistency', () => {
    it('should have cursor animation with proper styling', () => {
      // Arrange & Act
      render(<StreamingResponse content='Test' />);

      // Assert
      const cursor = document.querySelector('.w-0\\.5.h-4.bg-cyan-400.ml-1.animate-pulse');
      expect(cursor).toBeInTheDocument();
    });

    it('should not render the removed streaming dot animation', () => {
      render(<StreamingResponse content='Test' />);

      const streamingDot = document.querySelector(
        '.bg-cyan-500.animate-pulse.shadow-lg.ring-2.ring-cyan-400\\/30',
      );
      expect(streamingDot).not.toBeInTheDocument();
    });

    it('should use consistent cyan color theme', () => {
      // Arrange & Act
      render(<StreamingResponse content='Test content' />);

      // Assert
      const icon = screen.getByTestId('gemini-icon');
      expect(icon).toHaveClass('text-cyan-400');

      const cursor = document.querySelector('.bg-cyan-400');
      expect(cursor).toBeInTheDocument();

      const streamingDot = document.querySelector('.bg-cyan-500');
      expect(streamingDot).not.toBeInTheDocument();
    });
  });

  describe('Props Handling', () => {
    it('should handle assistantName prop gracefully', () => {
      // Arrange & Act - Component accepts assistantName but doesn't use it based on the code
      render(<StreamingResponse content='Test' assistantName='Test Assistant' />);

      // Assert
      expect(screen.getByTestId('markdown-content')).toHaveTextContent('Test');
      // assistantName is not displayed in this component
    });

    it('should render consistently regardless of assistantName', () => {
      // Arrange
      const { container: container1 } = render(<StreamingResponse content='Same content' />);
      const { container: container2 } = render(
        <StreamingResponse content='Same content' assistantName='Different Name' />,
      );

      // Act & Assert
      expect(container1.innerHTML).toBe(container2.innerHTML);
    });
  });

  describe('Subagent Activity Rendering', () => {
    it('renders delegated batches above the streaming bubble', () => {
      // Arrange
      const subagentBatches = {
        'batch-1': [
          {
            id: 'run-complete',
            batchId: 'batch-1',
            name: 'Completed researcher',
            task: 'Review retrieved sources',
            status: 'complete' as const,
            output: '已完成摘要',
            toolSequence: ['Read', 'Search'],
            durationMs: 1200,
          },
        ],
        'batch-2': [
          {
            id: 'run-running',
            batchId: 'batch-2',
            name: 'Active planner',
            task: 'Draft next action items',
            status: 'running' as const,
            output: 'Partial plan',
            toolSequence: ['Plan'],
            durationMs: 250,
          },
        ],
      };

      // Act
      render(
        <StreamingResponse content='Streaming with delegation' subagentBatches={subagentBatches} />,
      );

      // Assert
      expect(screen.getAllByText('子代理活動')).toHaveLength(2);
      expect(screen.getByText('Completed researcher')).toBeInTheDocument();
      expect(screen.getByText('Active planner')).toBeInTheDocument();
      expect(screen.getByText('已完成摘要')).toBeInTheDocument();
      expect(screen.queryByText('Partial plan')).not.toBeInTheDocument();
    });

    it('renders live tool call activity above the streaming bubble', () => {
      render(
        <StreamingResponse
          content='Streaming with tools'
          toolCallLog={[
            {
              id: 'tool-1',
              name: 'getProjectSummary',
              startedAt: 1700000000000,
              status: 'running',
              summary: 'Inspecting project context',
              durationMs: 12,
            },
            {
              id: 'tool-2',
              name: 'lintProject',
              startedAt: 1700000000100,
              status: 'recoverable_error',
              code: 'lint-path-not-found',
              summary: 'lintProject could not find 1 requested path(s).',
              durationMs: 25,
            },
          ]}
        />,
      );

      expect(screen.getByText('工具活動')).toBeInTheDocument();
      expect(screen.getByText('2 次呼叫')).toBeInTheDocument();
      expect(screen.getByText('getProjectSummary')).toBeInTheDocument();
      expect(screen.getByText('lintProject')).toBeInTheDocument();
      expect(screen.getByText('執行中')).toBeInTheDocument();
      expect(screen.getByText('可恢復')).toBeInTheDocument();
      expect(screen.queryByText('Inspecting project context')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /getProjectSummary/i }));
      expect(screen.getByText('Inspecting project context')).toBeInTheDocument();
      expect(screen.getByText('lint-path-not-found')).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('should handle very long streaming content', () => {
      // Arrange
      const longContent = 'Very long content. '.repeat(1000);

      // Act & Assert - Should not crash
      expect(() => {
        render(<StreamingResponse content={longContent} />);
      }).not.toThrow();

      expect(screen.getByTestId('markdown-content')).toBeInTheDocument();
    });

    it('should handle special markdown characters during streaming', () => {
      // Arrange
      const markdownChars = '# ** ``` [] () _italic_ **bold**';

      // Act
      render(<StreamingResponse content={markdownChars} />);

      // Assert
      expect(screen.getByTestId('markdown-content')).toHaveTextContent(markdownChars);
    });

    it('should handle unicode and emoji content', () => {
      // Arrange
      const unicodeContent = '测试 🚀 café naïve résumé';

      // Act
      render(<StreamingResponse content={unicodeContent} />);

      // Assert
      expect(screen.getByTestId('markdown-content')).toHaveTextContent(unicodeContent);
    });

    it('should handle content with line breaks', () => {
      // Arrange
      const multilineContent = 'Line 1\nLine 2\n\nLine 4 after empty line';

      // Act
      render(<StreamingResponse content={multilineContent} />);

      // Assert
      expect(screen.getByTestId('markdown-content')).toHaveTextContent(multilineContent, {
        normalizeWhitespace: false,
      });
    });
  });

  describe('Accessibility', () => {
    it('should convey streaming state to screen readers', () => {
      // Arrange & Act
      render(<StreamingResponse content='Streaming content' />);

      // Assert
      const typingIndicator = screen.getByText('正在輸入...');
      expect(typingIndicator).toBeInTheDocument();
      // This text serves as an accessible indication of the streaming state
    });

    it('should maintain proper text hierarchy', () => {
      // Arrange & Act
      render(<StreamingResponse content='# Heading\n\nContent' />);

      // Assert
      const markdownContent = screen.getByTestId('markdown-content');
      expect(markdownContent).toBeInTheDocument();
      // ReactMarkdown should handle proper heading structure
    });

    it('should expose the streaming region semantics for screen readers', () => {
      render(<StreamingResponse content='Accessible content' />);

      const streamingRegion = screen.getByText('正在輸入...').closest('[aria-live="polite"]');
      expect(streamingRegion).toHaveAttribute('aria-busy', 'true');
      expect(screen.queryAllByRole('button')).toHaveLength(0);
    });
  });

  describe('Visual Feedback', () => {
    it('should provide clear visual indication of active streaming', () => {
      // Arrange & Act
      render(<StreamingResponse content='Active stream' />);

      // Assert
      expect(screen.getByText('正在輸入...')).toBeInTheDocument();
      expect(document.querySelector('.ml-1.animate-pulse')).toBeInTheDocument();
    });

    it('should differentiate from completed messages', () => {
      // Arrange & Act
      render(<StreamingResponse content='Streaming content' />);

      // Assert
      const typingCursor = document.querySelector('.ml-1.animate-pulse');
      expect(typingCursor).toBeInTheDocument();

      const streamingDot = document.querySelector('.-top-2.-right-2.animate-pulse');
      expect(streamingDot).not.toBeInTheDocument();
      expect(typingCursor).toBeInTheDocument();
    });

    it('should maintain visual consistency with chat theme', () => {
      // Arrange & Act
      render(<StreamingResponse content='Themed content' />);

      // Assert - traverse up past the mock div to the actual bubble container
      const bubble = screen.getByTestId('markdown-content').closest('.bg-gray-800\\/80');
      expect(bubble).toHaveClass('bg-gray-800/80', 'text-gray-100');

      const icon = screen.getByTestId('gemini-icon');
      expect(icon).toHaveClass('text-cyan-400');
    });
  });
});
