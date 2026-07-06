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
    expect(screen.getByText('Subagent activity')).toBeInTheDocument();
    expect(screen.getByText('4 tasks')).toBeInTheDocument();
    expect(screen.getByText('Runner')).toBeInTheDocument();
    expect(screen.getByText('Completer')).toBeInTheDocument();
    expect(screen.getByText('Failure handler')).toBeInTheDocument();
    expect(screen.getByText('Abort guard')).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByText('Complete')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('Aborted')).toBeInTheDocument();
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
    expect(screen.queryByText('Tool trace')).not.toBeInTheDocument();
    expect(screen.queryByText('Partial findings')).not.toBeInTheDocument();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Tool trace')).toBeInTheDocument();
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
    expect(screen.getByText('_No output captured._')).toBeInTheDocument();
    expect(
      screen.getByText('Output truncated to keep the parent turn concise.'),
    ).toBeInTheDocument();
  });
});
