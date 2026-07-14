import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import MessageBubble from '../MessageBubble';
import { createMockChatMessage } from './test-utils';

vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => (
    <div data-testid='markdown-content'>{children}</div>
  ),
  defaultUrlTransform: (url: string) => url,
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

vi.mock('../GeometryBoard', () => ({
  default: ({ board }: { board: { title: string } }) => (
    <section data-testid='geometry-board'>{board.title}</section>
  ),
}));
vi.mock('../SpeechUtteranceCard', () => ({
  default: ({ utterance }: { utterance: { title: string } }) => (
    <section data-testid='speech-utterance-card'>{utterance.title}</section>
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

    it('renders geometry boards after the assistant content', () => {
      // Arrange
      const assistantMessage = createMockChatMessage({
        role: 'model',
        content: 'Here is the constructed triangle.',
        geometryBoards: [
          {
            id: 'geometry-1',
            title: 'Triangle ABC',
            doc: {
              title: 'Triangle ABC',
              boundingbox: [-5, 5, 5, -5],
              objects: [],
            },
            computedPoints: [],
          },
        ],
      });

      // Act
      render(<MessageBubble message={assistantMessage} index={0} />);

      // Assert
      const content = screen.getByTestId('markdown-content');
      const geometryBoard = screen.getByTestId('geometry-board');
      expect(geometryBoard).toHaveTextContent('Triangle ABC');
      expect(
        content.compareDocumentPosition(geometryBoard) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it('renders legacy assistant messages without geometry boards safely', () => {
      // Arrange
      const legacyAssistantMessage = createMockChatMessage({
        role: 'model',
        content: 'A response from before geometry boards existed.',
      });

      // Act & Assert
      expect(() =>
        render(<MessageBubble message={legacyAssistantMessage} index={0} />),
      ).not.toThrow();
      expect(screen.queryByTestId('geometry-board')).not.toBeInTheDocument();
    });

    it('renders speech utterance cards after the assistant content', () => {
      const assistantMessage = createMockChatMessage({
        role: 'model',
        content: 'Listen and repeat.',
        speechUtterances: [
          {
            id: 'speech-1',
            title: 'Greeting pronunciation',
            doc: {
              text: 'Good morning',
              language: 'en-US',
              title: 'Greeting pronunciation',
              rate: 0.9,
              pitch: 1,
            },
          },
        ],
      });

      render(<MessageBubble message={assistantMessage} index={0} />);

      expect(screen.getByTestId('speech-utterance-card')).toHaveTextContent(
        'Greeting pronunciation',
      );
    });

    it('should render persisted subagent runs in a collapsed agent activity timeline', () => {
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

      // Assert - collapsed header with summary count only
      const header = screen.getByRole('button', { name: /代理活動/ });
      expect(header).toHaveAttribute('aria-expanded', 'false');
      expect(screen.getByText('2 個子任務')).toBeInTheDocument();
      expect(screen.queryByText('Persisted researcher')).not.toBeInTheDocument();

      // Act - expand the timeline
      fireEvent.click(header);

      // Assert - rows visible; complete is quiet (dot only), running shows a label
      expect(screen.getByText('Persisted researcher')).toBeInTheDocument();
      expect(screen.getByText('Live planner')).toBeInTheDocument();
      expect(screen.queryByText('完成')).not.toBeInTheDocument();
      expect(screen.getByText('執行中')).toBeInTheDocument();
      expect(screen.queryByText('Delegated summary')).not.toBeInTheDocument();

      // Act - expand the completed run row
      fireEvent.click(screen.getByRole('button', { name: /Persisted researcher/ }));

      // Assert
      expect(screen.getByText('Delegated summary')).toBeInTheDocument();
      expect(screen.getByText('Read → Search')).toBeInTheDocument();
      expect(screen.queryByText('Partial plan')).not.toBeInTheDocument();
    });

    it('should render persisted tool call activity in the agent activity timeline', () => {
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

      const header = screen.getByRole('button', { name: /代理活動/ });
      expect(screen.getByText('2 個步驟')).toBeInTheDocument();

      fireEvent.click(header);

      expect(screen.getByText('writeFiles')).toBeInTheDocument();
      expect(screen.getByText('lintProject')).toBeInTheDocument();
      // ok is a quiet status (dot only); recoverable_error keeps its label
      expect(screen.queryByText('成功')).not.toBeInTheDocument();
      expect(screen.getByText('可恢復')).toBeInTheDocument();
      // Collapsed rows surface their summary as a subtitle
      expect(screen.getByText('Updated /index.html')).toBeInTheDocument();
      expect(
        screen.getByText('lintProject could not find 1 requested path(s).'),
      ).toBeInTheDocument();
      expect(screen.queryByText('lint-path-not-found')).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /lintProject/ }));

      expect(screen.getByText('lint-path-not-found')).toBeInTheDocument();
    });

    it('keeps citations closed until the reference list and source are expanded', () => {
      // Arrange
      const assistantMessage = createMockChatMessage({
        role: 'model',
        content: '請參考下列資料。',
        citations: [
          {
            marker: 1,
            chunkId: 'handbook#0',
            fileName: '員工手冊.pdf',
            chunkIndex: 0,
            excerpt: '摘錄內容',
          },
        ],
      });

      // Act
      render(
        <MessageBubble
          message={assistantMessage}
          index={0}
          citationContentsById={{ 'handbook#0': '完整段落內容' }}
        />,
      );

      // Assert - the reference list starts collapsed
      const citationList = screen.getByTestId('citation-list');
      const citationSummary = screen.getByText('📚 參考資料').closest('summary');
      const sourceSummary = screen.getByText('員工手冊.pdf · 段落 1').closest('summary');
      const sourceDetails = sourceSummary?.closest('details');

      expect(citationList).not.toHaveAttribute('open');
      expect(citationSummary).toBeInTheDocument();
      expect(sourceDetails).not.toHaveAttribute('open');
      expect(screen.getByText('[1]')).toBeInTheDocument();

      // Act - expand the reference list
      fireEvent.click(citationSummary!);

      // Assert - source items remain collapsed
      expect(citationList).toHaveAttribute('open');
      expect(sourceDetails).not.toHaveAttribute('open');

      // Act - expand the individual source
      fireEvent.click(sourceSummary!);

      // Assert - the complete stored content is displayed
      expect(sourceDetails).toHaveAttribute('open');
      expect(screen.getByText('完整段落內容')).toBeInTheDocument();
      expect(
        screen.queryByText('來源檔案已更新或移除，以下顯示儲存時的摘錄。'),
      ).not.toBeInTheDocument();
    });

    it('falls back to excerpt and shows stale-source notice when citation content is missing', () => {
      const assistantMessage = createMockChatMessage({
        role: 'model',
        content: '請參考舊資料。',
        citations: [
          {
            marker: 1,
            chunkId: 'missing#0',
            fileName: '舊版資料.md',
            chunkIndex: 2,
            excerpt: '保留摘錄內容',
          },
        ],
      });

      render(<MessageBubble message={assistantMessage} index={0} citationContentsById={{}} />);

      fireEvent.click(screen.getByText('📚 參考資料').closest('summary')!);
      fireEvent.click(screen.getByText('舊版資料.md · 段落 3').closest('summary')!);

      expect(screen.getByText('來源檔案已更新或移除，以下顯示儲存時的摘錄。')).toBeInTheDocument();
      expect(screen.getByText('保留摘錄內容')).toBeInTheDocument();
    });

    it('does not render the citations section when a message has no citations', () => {
      const assistantMessage = createMockChatMessage({
        role: 'model',
        content: '沒有引註的回覆。',
      });

      render(<MessageBubble message={assistantMessage} index={0} />);

      expect(screen.queryByText('📚 參考資料')).not.toBeInTheDocument();
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
    it('should display timestamp when a message timestamp is present', () => {
      const userMessage = createMockChatMessage({
        role: 'user',
        content: 'Test message',
        timestamp: new Date('2026-07-06T08:00:00Z').getTime(),
      });

      render(<MessageBubble message={userMessage} index={0} />);

      expect(screen.getByText(/08:00|下午04:00|上午08:00/)).toBeInTheDocument();
    });

    it('should hide timestamp metadata when a message has no timestamp', () => {
      const assistantMessage = createMockChatMessage({
        role: 'model',
        content: 'Timestamp-less reply',
      });

      render(<MessageBubble message={assistantMessage} index={0} />);

      expect(screen.queryByText(/上午|下午|\d{1,2}:\d{2}/)).not.toBeInTheDocument();
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

      expect(screen.getByText('（本次回覆沒有內容）')).toBeInTheDocument();
    });

    it('should render error messages with the error heading', () => {
      const errorMessage = createMockChatMessage({
        role: 'model',
        content: 'Gemini terminal response had no visible text',
        isError: true,
      });

      render(<MessageBubble message={errorMessage} index={0} />);

      expect(screen.getByText('系統錯誤')).toBeInTheDocument();
      expect(screen.getByText('Gemini terminal response had no visible text')).toBeInTheDocument();
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

describe('RouteProposalCard', () => {
  const routeProposal = {
    targetAssistantId: 'target',
    targetAssistantName: '數學助理',
    reason: '這是數學問題',
    handoffSummary: '使用者需要解方程式。',
    sourceAssistantId: 'source',
    sourceSessionId: 'session-1',
    createdAt: 1,
  } as const;

  it.each([
    ['pending', '建議轉接', true],
    ['accepted', '已轉接', false],
    ['declined', '已婉拒', false],
    ['failed', '轉接失敗', false],
  ] as const)('renders %s proposal status', (status, label, hasActions) => {
    render(
      <MessageBubble
        message={createMockChatMessage({
          role: 'model',
          content: '請參考建議',
          routeProposal: { ...routeProposal, status },
        })}
        index={0}
      />,
    );
    expect(screen.getByLabelText('助理轉接建議')).toHaveTextContent(label);
    expect(screen.getByLabelText('助理轉接建議')).toHaveTextContent('數學助理');
    const routeButton = screen.queryByRole('button', { name: /轉接至/ });
    if (hasActions) {
      expect(routeButton).toBeInTheDocument();
    } else {
      expect(routeButton).not.toBeInTheDocument();
    }
  });
});
