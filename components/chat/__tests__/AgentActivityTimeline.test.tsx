import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AgentActivityTimeline from '../AgentActivityTimeline';
import type { SubagentRunRecord, ToolCallRecord } from '../../../types';

vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => (
    <div data-testid='markdown-content'>{children}</div>
  ),
}));
vi.mock('remark-gfm', () => ({ default: vi.fn() }));

// Test data factories for consistent records
const createToolCall = (overrides: Partial<ToolCallRecord> = {}): ToolCallRecord => ({
  id: 'tool-1',
  name: 'writeFiles',
  status: 'ok',
  startedAt: 1700000000000,
  summary: 'Updated /index.html',
  durationMs: 15,
  ...overrides,
});

const createSubagentRun = (overrides: Partial<SubagentRunRecord> = {}): SubagentRunRecord => ({
  id: 'run-1',
  batchId: 'batch-1',
  name: 'Researcher',
  task: 'Inspect docs',
  status: 'complete',
  output: 'Delegated summary',
  toolSequence: ['Read', 'Search'],
  durationMs: 1800,
  ...overrides,
});

const getHeaderButton = () => screen.getByRole('button', { name: /代理活動/ });

describe('AgentActivityTimeline', () => {
  describe('Empty Rendering', () => {
    it('renders nothing when no props are provided', () => {
      // Arrange & Act
      const { container } = render(<AgentActivityTimeline />);

      // Assert
      expect(container).toBeEmptyDOMElement();
      expect(screen.queryByTestId('agent-activity-timeline')).not.toBeInTheDocument();
    });

    it('renders nothing when both arrays are empty', () => {
      // Arrange & Act
      const { container } = render(<AgentActivityTimeline toolCalls={[]} subagentRuns={[]} />);

      // Assert
      expect(container).toBeEmptyDOMElement();
    });
  });

  describe('Container Semantics', () => {
    it('renders an accessible section with the timeline test id', () => {
      // Arrange & Act
      render(<AgentActivityTimeline toolCalls={[createToolCall()]} />);

      // Assert
      const section = screen.getByTestId('agent-activity-timeline');
      expect(section).toHaveAttribute('aria-label', '代理活動');
    });
  });

  describe('Header Collapse Behavior', () => {
    it('is collapsed by default when not live', () => {
      // Arrange & Act
      render(<AgentActivityTimeline toolCalls={[createToolCall()]} />);

      // Assert
      expect(getHeaderButton()).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByText('writeFiles')).not.toBeInTheDocument();
    });

    it('is expanded by default when live', () => {
      // Arrange & Act
      render(<AgentActivityTimeline toolCalls={[createToolCall()]} live />);

      // Assert
      expect(getHeaderButton()).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByText('writeFiles')).toBeInTheDocument();
    });

    it('toggles the step list when the header button is clicked', () => {
      // Arrange
      render(<AgentActivityTimeline toolCalls={[createToolCall()]} />);

      // Act
      fireEvent.click(getHeaderButton());

      // Assert
      expect(getHeaderButton()).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByText('writeFiles')).toBeInTheDocument();

      // Act - collapse again
      fireEvent.click(getHeaderButton());

      // Assert
      expect(getHeaderButton()).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByText('writeFiles')).not.toBeInTheDocument();
    });
  });

  describe('Summary Counts', () => {
    it('shows step and subagent counts together', () => {
      // Arrange & Act
      render(
        <AgentActivityTimeline
          toolCalls={[createToolCall(), createToolCall({ id: 'tool-2', name: 'lintProject' })]}
          subagentRuns={[createSubagentRun()]}
        />,
      );

      // Assert
      expect(screen.getByText('2 個步驟 · 1 個子任務')).toBeInTheDocument();
    });

    it('shows only the step count when there are no subagent runs', () => {
      // Arrange & Act
      render(<AgentActivityTimeline toolCalls={[createToolCall()]} />);

      // Assert
      expect(screen.getByText('1 個步驟')).toBeInTheDocument();
      expect(screen.queryByText(/個子任務/)).not.toBeInTheDocument();
    });

    it('shows only the subagent count when there are no tool calls', () => {
      // Arrange & Act
      render(<AgentActivityTimeline subagentRuns={[createSubagentRun()]} />);

      // Assert
      expect(screen.getByText('1 個子任務')).toBeInTheDocument();
      expect(screen.queryByText(/個步驟/)).not.toBeInTheDocument();
    });
  });

  describe('Live Header Status', () => {
    it('shows the running step name while live', () => {
      // Arrange & Act
      render(
        <AgentActivityTimeline
          toolCalls={[createToolCall({ name: 'getProjectSummary', status: 'running' })]}
          live
        />,
      );

      // Assert
      expect(screen.getByText('正在執行 getProjectSummary…')).toBeInTheDocument();
    });

    it('prefers a running subagent over a running tool call', () => {
      // Arrange & Act
      render(
        <AgentActivityTimeline
          toolCalls={[createToolCall({ name: 'writeFiles', status: 'running' })]}
          subagentRuns={[createSubagentRun({ name: 'Active planner', status: 'running' })]}
          live
        />,
      );

      // Assert
      expect(screen.getByText('正在執行 Active planner…')).toBeInTheDocument();
    });

    it('shows the thinking placeholder when nothing is running', () => {
      // Arrange & Act
      render(<AgentActivityTimeline toolCalls={[createToolCall({ status: 'ok' })]} live />);

      // Assert
      expect(screen.getByText('思考下一步…')).toBeInTheDocument();
    });

    it('does not show live status text when not live', () => {
      // Arrange & Act
      render(<AgentActivityTimeline toolCalls={[createToolCall({ status: 'running' })]} />);

      // Assert
      expect(screen.queryByText(/正在執行/)).not.toBeInTheDocument();
      expect(screen.queryByText('思考下一步…')).not.toBeInTheDocument();
    });
  });

  describe('Row Expand and Collapse', () => {
    it('expands a tool call row to reveal detail sections and collapses it again', () => {
      // Arrange
      render(
        <AgentActivityTimeline
          toolCalls={[createToolCall({ code: 'lint-path-not-found', summary: undefined })]}
        />,
      );
      fireEvent.click(getHeaderButton());
      const row = screen.getByRole('button', { name: /writeFiles/ });
      expect(row).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByText('lint-path-not-found')).not.toBeInTheDocument();

      // Act
      fireEvent.click(row);

      // Assert - 代碼 and 摘要 fallback are visible
      expect(row).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByText('代碼')).toBeInTheDocument();
      expect(screen.getByText('lint-path-not-found')).toBeInTheDocument();
      expect(screen.getByText('摘要')).toBeInTheDocument();
      expect(screen.getByText('未擷取摘要。')).toBeInTheDocument();

      // Act - collapse the row
      fireEvent.click(row);

      // Assert
      expect(row).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByText('lint-path-not-found')).not.toBeInTheDocument();
    });

    it('shows the tool call summary as a collapsed subtitle and as the detail when expanded', () => {
      // Arrange
      render(<AgentActivityTimeline toolCalls={[createToolCall()]} />);
      fireEvent.click(getHeaderButton());

      // Assert - subtitle visible while collapsed
      expect(screen.getByText('Updated /index.html')).toBeInTheDocument();

      // Act
      fireEvent.click(screen.getByRole('button', { name: /writeFiles/ }));

      // Assert - single summary occurrence remains (detail replaces subtitle)
      expect(screen.getByText('Updated /index.html')).toBeInTheDocument();
      expect(screen.getByText('摘要')).toBeInTheDocument();
    });
  });

  describe('Failed Rows', () => {
    it('expands failed tool call rows by default with the failure label', () => {
      // Arrange & Act
      render(
        <AgentActivityTimeline
          toolCalls={[createToolCall({ status: 'failed', summary: 'Write blew up' })]}
        />,
      );
      fireEvent.click(getHeaderButton());

      // Assert
      const row = screen.getByRole('button', { name: /writeFiles/ });
      expect(row).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByText('失敗')).toBeInTheDocument();
      expect(screen.getByText('摘要')).toBeInTheDocument();
      expect(screen.getByText('Write blew up')).toBeInTheDocument();
    });

    it('expands failed subagent rows by default and shows the error box', () => {
      // Arrange & Act
      render(
        <AgentActivityTimeline
          subagentRuns={[createSubagentRun({ status: 'failed', error: 'Subagent crashed hard' })]}
        />,
      );
      fireEvent.click(getHeaderButton());

      // Assert
      expect(screen.getByRole('button', { name: /Researcher/ })).toHaveAttribute(
        'aria-expanded',
        'true',
      );
      expect(screen.getByText('失敗')).toBeInTheDocument();
      expect(screen.getByText('Subagent crashed hard')).toBeInTheDocument();
    });
  });

  describe('Subagent Detail Sections', () => {
    const expandRun = (name: RegExp) => {
      fireEvent.click(getHeaderButton());
      fireEvent.click(screen.getByRole('button', { name }));
    };

    it('renders task, tool trace, and markdown output', () => {
      // Arrange
      render(<AgentActivityTimeline subagentRuns={[createSubagentRun()]} />);

      // Act
      expandRun(/Researcher/);

      // Assert
      expect(screen.getByText('任務')).toBeInTheDocument();
      expect(screen.getByText('Inspect docs')).toBeInTheDocument();
      expect(screen.getByText('工具軌跡')).toBeInTheDocument();
      expect(screen.getByText('Read → Search')).toBeInTheDocument();
      expect(screen.getByText('輸出')).toBeInTheDocument();
      expect(screen.getByTestId('markdown-content')).toHaveTextContent('Delegated summary');
    });

    it('omits the tool trace section when the tool sequence is empty', () => {
      // Arrange
      render(<AgentActivityTimeline subagentRuns={[createSubagentRun({ toolSequence: [] })]} />);

      // Act
      expandRun(/Researcher/);

      // Assert
      expect(screen.queryByText('工具軌跡')).not.toBeInTheDocument();
    });

    it('falls back to the empty-output placeholder', () => {
      // Arrange
      render(<AgentActivityTimeline subagentRuns={[createSubagentRun({ output: '' })]} />);

      // Act
      expandRun(/Researcher/);

      // Assert
      expect(screen.getByTestId('markdown-content')).toHaveTextContent('（未擷取輸出）');
    });

    it('shows the truncation notice when the output was truncated', () => {
      // Arrange
      render(<AgentActivityTimeline subagentRuns={[createSubagentRun({ truncated: true })]} />);

      // Act
      expandRun(/Researcher/);

      // Assert
      expect(screen.getByText('輸出已截斷，以避免父回合內容過長。')).toBeInTheDocument();
    });

    it('marks subagent rows with the subtask badge', () => {
      // Arrange
      render(<AgentActivityTimeline subagentRuns={[createSubagentRun()]} />);

      // Act
      fireEvent.click(getHeaderButton());

      // Assert
      expect(screen.getByText('子任務')).toBeInTheDocument();
    });
  });

  describe('Status Labels', () => {
    it('hides text labels for quiet ok/complete statuses', () => {
      // Arrange & Act
      render(
        <AgentActivityTimeline
          toolCalls={[createToolCall({ status: 'ok' })]}
          subagentRuns={[createSubagentRun({ status: 'complete' })]}
          live
        />,
      );

      // Assert
      expect(screen.queryByText('成功')).not.toBeInTheDocument();
      expect(screen.queryByText('完成')).not.toBeInTheDocument();
    });

    it('shows inline labels for noisy statuses', () => {
      // Arrange & Act
      render(
        <AgentActivityTimeline
          toolCalls={[
            createToolCall({ id: 'tool-1', name: 'a', status: 'running' }),
            createToolCall({ id: 'tool-2', name: 'b', status: 'recoverable_error' }),
          ]}
          subagentRuns={[
            createSubagentRun({ id: 'run-1', name: 'c', status: 'failed' }),
            createSubagentRun({ id: 'run-2', name: 'd', status: 'aborted' }),
          ]}
          live
        />,
      );

      // Assert
      expect(screen.getByText('執行中')).toBeInTheDocument();
      expect(screen.getByText('可恢復')).toBeInTheDocument();
      expect(screen.getByText('失敗')).toBeInTheDocument();
      expect(screen.getByText('已中止')).toBeInTheDocument();
    });
  });

  describe('Duration Formatting', () => {
    it('formats sub-second durations in milliseconds', () => {
      // Arrange & Act
      render(<AgentActivityTimeline toolCalls={[createToolCall({ durationMs: 123 })]} live />);

      // Assert
      expect(screen.getByText('123 ms')).toBeInTheDocument();
    });

    it('formats second-scale durations with one decimal', () => {
      // Arrange & Act
      render(
        <AgentActivityTimeline subagentRuns={[createSubagentRun({ durationMs: 1234 })]} live />,
      );

      // Assert
      expect(screen.getByText('1.2 s')).toBeInTheDocument();
    });

    it('hides the duration when it is undefined', () => {
      // Arrange & Act
      render(
        <AgentActivityTimeline toolCalls={[createToolCall({ durationMs: undefined })]} live />,
      );

      // Assert
      expect(screen.queryByText(/\d+ ms/)).not.toBeInTheDocument();
      expect(screen.queryByText(/\d+\.\d s/)).not.toBeInTheDocument();
    });
  });
});
