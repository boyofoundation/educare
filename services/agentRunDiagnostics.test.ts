import { describe, expect, it } from 'vitest';
import type { AgentRunCheckpoint, AgentRunState } from '../types';
import {
  buildAgentRunDiagnostics,
  classifyAgentRunFailure,
  serializeAgentRunDiagnostics,
} from './agentRunDiagnostics';

const buildState = (overrides: Partial<AgentRunState> = {}): AgentRunState => ({
  runId: 'run-1',
  projectId: 'project-1',
  sessionId: 'session-1',
  assistantId: 'assistant-1',
  status: 'paused',
  turnIndex: 2,
  maxTurns: 4,
  previewDiagnosticState: 'not_executed',
  autoContinued: true,
  toolTrace: ['writeFiles'],
  budget: { maxTurns: 4, maxToolCalls: 8, maxTokens: 4000 },
  budgetUsage: {
    turns: 2,
    toolCalls: 1,
    tokens: 123,
    estimatedTokens: true,
  },
  startedAt: 1,
  updatedAt: 2,
  ...overrides,
});

const buildCheckpoint = (): AgentRunCheckpoint => ({
  schemaVersion: 1,
  runId: 'run-1',
  sessionId: 'session-1',
  assistantId: 'assistant-1',
  projectId: 'project-1',
  status: 'paused',
  turnIndex: 2,
  maxTurns: 4,
  originalMessage: 'raw user message secret-marker',
  committedHistoryDelta: [{ role: 'user', content: 'raw chat material secret-marker' }],
  toolTrace: ['writeFiles'],
  tokenTotals: { promptTokenCount: 100, candidatesTokenCount: 23 },
  agentHarnessEnabled: true,
  sharedMode: false,
  createdAt: 1,
  updatedAt: 2,
  heartbeatAt: 2,
});

describe('agentRunDiagnostics', () => {
  it.each([
    ['429 Too Many Requests', 'rate_limit', 'rate-limit', true],
    ['network request failed', 'network', 'network', true],
    ['tool execution failed', 'tool', 'tool-error', false],
    ['AbortError: The operation was aborted', 'cancel', 'cancelled', false],
    ['操作已取消', 'cancel', 'cancelled', false],
    ['工具執行失敗', 'tool', 'tool-error', false],
    ['網路連線中斷', 'network', 'network', true],
    ['Agent run tokens budget reached.', 'budget', 'budget-exceeded', false],
    ['發生未知錯誤', 'unknown', 'unknown-failure', false],
  ] as const)(
    'classifies %s without retaining the original error',
    (message, stage, code, retryable) => {
      expect(classifyAgentRunFailure(new Error(message))).toEqual({ stage, code, retryable });
    },
  );

  it('exports allowlisted metadata only and excludes secret markers, raw materials, and URLs', () => {
    const state = buildState({
      runId: 'run-secret-marker',
      projectId: 'https://private.example/materials',
      sessionId: 'session-secret-marker',
      failure: {
        stage: 'provider',
        code: 'secret-marker',
        retryable: true,
      },
    });
    const serialized = serializeAgentRunDiagnostics({
      state,
      checkpoint: buildCheckpoint(),
      events: [
        {
          kind: 'failure',
          code: 'secret-marker',
          status: 'failed',
        },
      ],
    });

    expect(serialized).not.toContain('secret-marker');
    expect(serialized).not.toContain('raw user message');
    expect(serialized).not.toContain('raw chat material');
    expect(serialized).not.toContain('https://private.example');

    const diagnostics = buildAgentRunDiagnostics({ state });
    expect(diagnostics.redacted).toBe(true);
    expect(diagnostics.cost).toEqual({
      available: false,
      reason: 'provider-billing-unavailable',
    });
    expect(diagnostics.usage.estimatedTokens).toBe(true);
    expect(diagnostics.run.failure).toEqual({
      stage: 'provider',
      code: undefined,
      retryable: true,
    });
  });

  it('keeps recoverable tool failures explicitly retryable', () => {
    expect(
      classifyAgentRunFailure(new Error('provider wrapper failed'), {
        toolFailure: true,
        toolFailureRetryable: true,
      }),
    ).toEqual({ stage: 'tool', code: 'tool-error', retryable: true });
  });

  it('honors structured status and localized authentication failures', () => {
    expect(classifyAgentRunFailure({ status: 429, message: 'localized' })).toEqual({
      stage: 'rate_limit',
      code: 'rate-limit',
      retryable: true,
    });
    expect(classifyAgentRunFailure(new Error('未授權：API 金鑰無效'))).toEqual({
      stage: 'provider',
      code: 'credentials',
      retryable: false,
    });
  });
});
