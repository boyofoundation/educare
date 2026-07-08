/// <reference types="vitest/globals" />
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentRunPanel } from '../AgentRunPanel';
import { useAppContext } from '../../core/useAppContext';
import { htmlProjectStore } from '../../../services/htmlProjectStore';
import { htmlPreviewService } from '../../../services/htmlPreviewService';
import type { AgentRunState, HtmlProjectGitLogCommit } from '../../../types';

vi.mock('../../core/useAppContext', () => ({
  useAppContext: vi.fn(),
}));

vi.mock('../../../services/htmlProjectStore', () => ({
  htmlProjectStore: {
    getHistory: vi.fn(),
    getWorkingTreeStatus: vi.fn(),
    commitChanges: vi.fn(),
    revertToSnapshot: vi.fn(),
  },
}));

vi.mock('../../../services/htmlPreviewService', () => ({
  htmlPreviewService: {
    resolveProjectForPreview: vi.fn(),
  },
}));

const baseState: AgentRunState = {
  runId: 'run-1',
  projectId: 'project-1',
  sessionId: 'session-1',
  assistantId: 'assistant-1',
  status: 'running',
  turnIndex: 2,
  maxTurns: 5,
  previewDiagnosticState: 'not_executed',
  autoContinued: false,
  toolTrace: ['writeFiles', 'renderPreview', 'reportTurnOutcome'],
  startedAt: 1640995200000,
  updatedAt: 1640995200000,
};

const historyCommit = (
  overrides: Partial<HtmlProjectGitLogCommit> = {},
): HtmlProjectGitLogCommit => ({
  oid: 'abcdef1234567890',
  shortOid: 'abcdef1',
  message: 'run-start',
  note: 'run-start',
  previewVersion: 3,
  timestamp: 1640995200000,
  isSnapshot: true,
  files: ['/index.html'],
  ...overrides,
});

describe('AgentRunPanel', () => {
  const mockSetProjectPreview = vi.fn();
  const mockAppendProjectActivity = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(useAppContext).mockReturnValue({
      actions: {
        setProjectPreview: mockSetProjectPreview,
        appendProjectActivity: mockAppendProjectActivity,
      },
    } as never);

    vi.mocked(htmlProjectStore.getHistory).mockResolvedValue([
      historyCommit({ note: 'run-start', previewVersion: 3 }),
      historyCommit({
        oid: 'bbbbbbb1234567890',
        shortOid: 'bbbbbbb',
        note: 'manual edit',
        previewVersion: 2,
        isSnapshot: false,
      }),
    ]);

    vi.mocked(htmlProjectStore.getWorkingTreeStatus).mockResolvedValue({
      projectId: 'project-1',
      clean: false,
      added: ['/new.js'],
      modified: ['/index.html'],
      deleted: [],
      untracked: [],
      unchanged: 0,
    });

    vi.mocked(htmlProjectStore.commitChanges).mockResolvedValue({
      projectId: 'project-1',
      committed: true,
      oid: 'ccccccc1234567890',
      message: 'my commit',
    });

    vi.mocked(htmlProjectStore.revertToSnapshot).mockResolvedValue({
      projectId: 'project-1',
      revertedToVersion: 3,
      previewVersion: 4,
      runtimeDiagnosticsCleared: true,
      filesRestored: 1,
    });

    vi.mocked(htmlPreviewService.resolveProjectForPreview).mockResolvedValue({
      projectId: 'project-1',
      previewVersion: 4,
      url: 'blob:preview-4',
    } as never);

    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('renders turn counter, tool trace, and the diagnostic light', async () => {
    render(<AgentRunPanel projectId='project-1' runState={baseState} />);

    expect(screen.getByTestId('agent-run-turn-counter')).toHaveTextContent('Turn 3 / 5');
    expect(screen.getByText('writeFiles')).toBeInTheDocument();
    expect(screen.getByTestId('agent-run-diagnostic-light')).toBeInTheDocument();
  });

  it('colors the diagnostic light green when state is clean', async () => {
    render(
      <AgentRunPanel
        projectId='project-1'
        runState={{ ...baseState, previewDiagnosticState: 'clean' }}
      />,
    );

    const light = screen.getByTestId('agent-run-diagnostic-light');
    expect(light.className).toContain('bg-emerald-500');
  });

  it('colors the diagnostic light red when state has_errors', async () => {
    render(
      <AgentRunPanel
        projectId='project-1'
        runState={{ ...baseState, previewDiagnosticState: 'has_errors' }}
      />,
    );

    const light = screen.getByTestId('agent-run-diagnostic-light');
    expect(light.className).toContain('bg-rose-500');
  });

  it('shows auto-continued badge when autoContinued is true', () => {
    render(
      <AgentRunPanel projectId='project-1' runState={{ ...baseState, autoContinued: true }} />,
    );

    expect(screen.getByText('auto-continued')).toBeInTheDocument();
  });

  it('shows dirty badge and version history from getHistory', async () => {
    render(<AgentRunPanel projectId='project-1' runState={baseState} />);

    await waitFor(() => {
      expect(htmlProjectStore.getHistory).toHaveBeenCalledWith('project-1');
    });

    const dirty = await screen.findByTestId('dirty-badge');
    expect(dirty).toHaveTextContent('未提交變更');
    expect(screen.getByText('run-start')).toBeInTheDocument();
    expect(screen.getByText('manual edit')).toBeInTheDocument();
  });

  it('expands a commit to show its file list', async () => {
    render(<AgentRunPanel projectId='project-1' runState={baseState} />);

    await screen.findByText('run-start');
    fireEvent.click(screen.getByTestId('history-expand-abcdef1'));

    await waitFor(() => {
      expect(screen.getByTestId('history-files-abcdef1')).toHaveTextContent('/index.html');
    });
  });

  it('calls revertToSnapshot on snapshot commit restore', async () => {
    render(<AgentRunPanel projectId='project-1' runState={baseState} />);

    await screen.findByText('run-start');
    fireEvent.click(screen.getByRole('button', { name: '還原至版本 v3' }));

    await waitFor(() => {
      expect(htmlProjectStore.revertToSnapshot).toHaveBeenCalledWith('project-1', 3);
    });

    await waitFor(() => {
      expect(mockSetProjectPreview).toHaveBeenCalledWith(
        expect.objectContaining({ previewVersion: 4 }),
      );
      expect(mockAppendProjectActivity).toHaveBeenCalledWith('已還原至版本 v3。');
    });
  });

  it('does not revert when the confirm dialog is dismissed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(<AgentRunPanel projectId='project-1' runState={baseState} />);

    const restoreButton = await screen.findByRole('button', { name: '還原至版本 v3' });
    fireEvent.click(restoreButton);

    await waitFor(() => {
      expect(window.confirm).toHaveBeenCalled();
    });

    expect(htmlProjectStore.revertToSnapshot).not.toHaveBeenCalled();
  });

  it('commits dirty changes via commitChanges when message is provided', async () => {
    render(<AgentRunPanel projectId='project-1' runState={baseState} />);

    await screen.findByTestId('dirty-badge');
    fireEvent.click(screen.getByTestId('commit-changes-button'));

    const input = await screen.findByTestId('commit-message-input');
    fireEvent.change(input, { target: { value: 'my commit' } });
    fireEvent.click(screen.getByTestId('commit-confirm-button'));

    await waitFor(() => {
      expect(htmlProjectStore.commitChanges).toHaveBeenCalledWith('project-1', 'my commit');
    });

    await waitFor(() => {
      expect(mockAppendProjectActivity).toHaveBeenCalledWith(expect.stringContaining('已提交變更'));
    });
  });

  it('disables commit confirm when no message entered', async () => {
    render(<AgentRunPanel projectId='project-1' runState={baseState} />);

    await screen.findByTestId('dirty-badge');
    fireEvent.click(screen.getByTestId('commit-changes-button'));

    const confirm = await screen.findByTestId('commit-confirm-button');
    expect(confirm).toBeDisabled();
  });

  it('shows clean badge when working tree is clean', async () => {
    vi.mocked(htmlProjectStore.getWorkingTreeStatus).mockResolvedValue({
      projectId: 'project-1',
      clean: true,
      added: [],
      modified: [],
      deleted: [],
      untracked: [],
      unchanged: 2,
    });

    render(<AgentRunPanel projectId='project-1' runState={baseState} />);

    const clean = await screen.findByTestId('clean-badge');
    expect(clean).toBeInTheDocument();
    // commit button disabled when clean
    expect(screen.getByTestId('commit-changes-button')).toBeDisabled();
  });
});
