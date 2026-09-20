/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentRunState, AgentRunCheckpoint } from '../../../types';
import AgentRunControls from '../AgentRunControls';

const { diagnosticsService } = vi.hoisted(() => ({
  diagnosticsService: {
    exportAgentRunDiagnostics: vi.fn(),
  },
}));

vi.mock('../../../services/agentRunDiagnostics', () => diagnosticsService);

const budget = { maxTurns: 5, maxToolCalls: 10, maxTokens: 4_000 };

const state: AgentRunState = {
  runId: 'run-1',
  projectId: 'project-1',
  sessionId: 'session-1',
  assistantId: 'assistant-1',
  status: 'paused',
  turnIndex: 2,
  maxTurns: 5,
  previewDiagnosticState: 'not_executed',
  autoContinued: true,
  toolTrace: ['readFiles', 'writeFiles'],
  budget,
  budgetUsage: {
    turns: 3,
    toolCalls: 2,
    toolCallsKnown: true,
    tokens: 1_024,
    estimatedTokens: true,
  },
  pauseReason: 'budget',
  failure: {
    stage: 'budget',
    code: 'budget-exceeded',
    retryable: false,
  },
  startedAt: 1_700_000_000_000,
  updatedAt: 1_700_000_100_000,
};

const checkpoint: AgentRunCheckpoint = {
  schemaVersion: 1,
  runId: 'run-1',
  sessionId: 'session-1',
  assistantId: 'assistant-1',
  projectId: 'project-1',
  status: 'paused',
  turnIndex: 2,
  maxTurns: 5,
  originalMessage: 'PRIVATE_MESSAGE PRIVATE_KEY_VALUE https://private.example/material',
  committedHistoryDelta: [
    {
      role: 'user',
      content: 'PRIVATE_CHAT_CONTENT',
      timestamp: 1_700_000_000_000,
    },
  ],
  toolTrace: ['readFiles'],
  tokenTotals: {
    promptTokenCount: 500,
    candidatesTokenCount: 200,
  },
  agentHarnessEnabled: true,
  sharedMode: false,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_100_000,
  heartbeatAt: 1_700_000_100_000,
};

describe('AgentRunControls', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    diagnosticsService.exportAgentRunDiagnostics.mockReturnValue(
      JSON.stringify({
        redacted: true,
        omissions: ['messages', 'credentials', 'urls'],
      }),
    );
  });

  it('rejects nonfinite, fractional, and out-of-range budget edits', () => {
    const onBudgetChange = vi.fn();
    render(<AgentRunControls budget={budget} onBudgetChange={onBudgetChange} />);

    fireEvent.change(screen.getByLabelText('最大回合數'), { target: { value: 'Infinity' } });
    expect(screen.getByText('最大回合數必須是有限的整數。')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('最大回合數'), { target: { value: '2.5' } });
    expect(screen.getByText('最大回合數必須是整數。')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('最大回合數'), { target: { value: '51' } });
    expect(screen.getByText('最大回合數請輸入 1–50。')).toBeInTheDocument();
    expect(onBudgetChange).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('最大回合數'), { target: { value: '6' } });
    expect(onBudgetChange).toHaveBeenCalledWith({ ...budget, maxTurns: 6 });
  });

  it('allows clearing a limit without inventing a default', () => {
    const onBudgetChange = vi.fn();
    render(<AgentRunControls budget={budget} onBudgetChange={onBudgetChange} />);

    fireEvent.change(screen.getByLabelText('Token 上限'), { target: { value: '' } });

    expect(onBudgetChange).toHaveBeenCalledWith({ maxTurns: 5, maxToolCalls: 10 });
  });

  it('shows status, failure stage, and estimated usage without exposing provider costs', () => {
    const onBudgetChange = vi.fn();
    render(
      <AgentRunControls
        budget={budget}
        onBudgetChange={onBudgetChange}
        state={state}
        checkpoint={checkpoint}
      />,
    );

    expect(screen.getByTestId('agent-run-status')).toHaveTextContent('已暫停');
    expect(screen.getByTestId('agent-run-failure-summary')).toHaveTextContent('失敗階段：軟預算');
    expect(screen.getByText('回合 3 / 5')).toBeInTheDocument();
    expect(screen.getByText(/1,024/)).toBeInTheDocument();
    expect(screen.getByText(/沒有供應商實際帳單資料，因此不顯示精確費用/)).toBeInTheDocument();
  });

  it('disables inputs and diagnostics while disabled', () => {
    const onBudgetChange = vi.fn();
    render(
      <AgentRunControls
        budget={budget}
        onBudgetChange={onBudgetChange}
        state={state}
        checkpoint={checkpoint}
        disabled
      />,
    );

    expect(screen.getByLabelText('最大回合數')).toBeDisabled();
    expect(screen.getByLabelText('工具呼叫上限')).toBeDisabled();
    expect(screen.getByLabelText('Token 上限')).toBeDisabled();
    expect(screen.getByRole('button', { name: '下載去敏診斷檔' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('最大回合數'), { target: { value: '6' } });
    expect(onBudgetChange).not.toHaveBeenCalled();
  });

  it('downloads only the redacted diagnostics payload and revokes its object URL', async () => {
    const onBudgetChange = vi.fn();
    const createdBlobs: globalThis.Blob[] = [];
    const createObjectURL = vi.fn((blob: globalThis.Blob) => {
      createdBlobs.push(blob);
      return 'blob:agent-diagnostics';
    });
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const anchorClick = vi
      .spyOn(globalThis.HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    render(
      <AgentRunControls
        budget={budget}
        onBudgetChange={onBudgetChange}
        state={state}
        checkpoint={checkpoint}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '下載去敏診斷檔' }));

    expect(diagnosticsService.exportAgentRunDiagnostics).toHaveBeenCalledWith({
      state,
      checkpoint,
    });
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(anchorClick).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:agent-diagnostics');

    const blob = createdBlobs[0];
    expect(blob).toBeDefined();
    if (!blob) {
      return;
    }
    const downloadedText = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });
    expect(downloadedText).toContain('redacted');
    expect(downloadedText).not.toContain('PRIVATE_MESSAGE');
    expect(downloadedText).not.toContain('PRIVATE_CHAT_CONTENT');
    expect(downloadedText).not.toContain('PRIVATE_KEY_VALUE');
    expect(downloadedText).not.toContain('https://');
  });

  it('offers diagnostics for a checkpoint recovered after reload', () => {
    const onBudgetChange = vi.fn();
    render(
      <AgentRunControls budget={budget} onBudgetChange={onBudgetChange} checkpoint={checkpoint} />,
    );

    expect(screen.getByRole('button', { name: '下載去敏診斷檔' })).toBeEnabled();
  });
});
