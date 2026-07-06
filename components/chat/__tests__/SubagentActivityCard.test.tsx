import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import SubagentActivityCard from '../SubagentActivityCard';
import type { SubagentRunRecord } from '../../../types';

vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => (
    <div data-testid='markdown-content'>{children}</div>
  ),
}));
vi.mock('remark-gfm', () => ({ default: vi.fn() }));

const createMockSubagentRun = (overrides: Partial<SubagentRunRecord> = {}): SubagentRunRecord => ({
  id: 'run-1',
  batchId: 'batch-1',
  name: 'Research worker',
  task: 'Investigate delegated task',
  status: 'complete',
  output: 'Delegated result',
  toolSequence: ['Read', 'Search'],
  durationMs: 1200,
  ...overrides,
});

describe('SubagentActivityCard', () => {
  it('renders nothing when no runs are provided', () => {
    // Arrange
    const { container } = render(<SubagentActivityCard runs={[]} />);

    // Assert
    expect(container).toBeEmptyDOMElement();
  });

  it('renders task count and status badges for each delegated run', () => {
    // Arrange
    const runs = [
      createMockSubagentRun({ id: 'run-running', name: 'Runner', status: 'running' }),
      createMockSubagentRun({ id: 'run-complete', name: 'Completer', status: 'complete' }),
      createMockSubagentRun({ id: 'run-failed', name: 'Failure handler', status: 'failed' }),
      createMockSubagentRun({ id: 'run-aborted', name: 'Abort guard', status: 'aborted' }),
    ];

    // Act
    render(<SubagentActivityCard runs={runs} />);

    // Assert
    expect(screen.getByText('子代理活動')).toBeInTheDocument();
    expect(screen.getByText('4 項任務')).toBeInTheDocument();
    expect(screen.getByText('Runner')).toBeInTheDocument();
    expect(screen.getByText('Completer')).toBeInTheDocument();
    expect(screen.getByText('Failure handler')).toBeInTheDocument();
    expect(screen.getByText('Abort guard')).toBeInTheDocument();
    expect(screen.getByText('執行中')).toBeInTheDocument();
    expect(screen.getByText('完成')).toBeInTheDocument();
    expect(screen.getByText('失敗')).toBeInTheDocument();
    expect(screen.getByText('已中止')).toBeInTheDocument();
  });

  it('starts running runs collapsed and toggles details on click', () => {
    // Arrange
    const run = createMockSubagentRun({
      status: 'running',
      name: 'Live researcher',
      toolSequence: ['Search', 'Read'],
      output: 'Partial findings',
    });

    // Act
    render(<SubagentActivityCard runs={[run]} />);
    const toggle = screen.getByRole('button', { name: /Live researcher/i });

    // Assert
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('工具軌跡')).not.toBeInTheDocument();
    expect(screen.queryByText('Partial findings')).not.toBeInTheDocument();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('工具軌跡')).toBeInTheDocument();
    expect(screen.getByText('Search → Read')).toBeInTheDocument();
    expect(screen.getByText('Partial findings')).toBeInTheDocument();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Partial findings')).not.toBeInTheDocument();
  });

  it('keeps finished runs expanded by default and shows fallback details', () => {
    // Arrange
    const run = createMockSubagentRun({
      status: 'failed',
      output: '',
      toolSequence: [],
      truncated: true,
      error: 'Delegation failed',
    });

    // Act
    render(<SubagentActivityCard runs={[run]} />);
    const toggle = screen.getByRole('button', { name: /Research worker/i });

    // Assert
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Delegation failed')).toBeInTheDocument();
    expect(screen.getByText('（未擷取輸出）')).toBeInTheDocument();
    expect(screen.getByText('輸出已截斷，以避免父回合內容過長。')).toBeInTheDocument();
  });
});
