import React, { useState } from 'react';
import type { AgentRunBudget } from '../../services/agentRunController';
import { exportAgentRunDiagnostics } from '../../services/agentRunDiagnostics';
import type { AgentRunCheckpoint, AgentRunState } from '../../types';

export interface AgentRunControlsProps {
  /** Controlled, local-only soft limits for the next run. */
  budget: AgentRunBudget;
  onBudgetChange: (budget: AgentRunBudget) => void;
  /** Live state is preferred; a retained checkpoint can still describe the run. */
  state?: AgentRunState | null;
  checkpoint?: AgentRunCheckpoint | null;
  disabled?: boolean;
  className?: string;
}

type BudgetKey = keyof AgentRunBudget;

interface BudgetField {
  key: BudgetKey;
  label: string;
  description: string;
  min: number;
  max: number;
  suffix: string;
}

interface RunUsage {
  turns: number;
  toolCalls: number;
  toolCallsKnown?: boolean;
  tokens: number;
  estimatedTokens: boolean;
}

const BUDGET_FIELDS: BudgetField[] = [
  {
    key: 'maxTurns',
    label: '最大回合數',
    description: '限制代理最多續跑幾個回合。',
    min: 1,
    max: 50,
    suffix: '回合',
  },
  {
    key: 'maxToolCalls',
    label: '工具呼叫上限',
    description: '限制本次執行可啟動的工具呼叫數。',
    min: 1,
    max: 200,
    suffix: '次',
  },
  {
    key: 'maxTokens',
    label: 'Token 上限',
    description: '限制本機追蹤的 token 用量；部分模型只能估算。',
    min: 1,
    max: 1_000_000,
    suffix: 'tokens',
  },
];

const STATUS_LABEL: Record<AgentRunState['status'], string> = {
  running: '執行中',
  complete: '已完成',
  stopped: '已停止',
  failed: '執行失敗',
  aborted: '已中止',
  paused: '已暫停',
};

const STATUS_CLASS: Record<AgentRunState['status'], string> = {
  running: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200',
  complete: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
  stopped: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
  failed: 'border-rose-500/40 bg-rose-500/10 text-rose-200',
  aborted: 'border-gray-600 bg-gray-800/80 text-gray-200',
  paused: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
};

const FAILURE_STAGE_LABEL: Record<NonNullable<AgentRunState['failure']>['stage'], string> = {
  provider: '模型服務',
  rate_limit: '請求頻率限制',
  network: '網路連線',
  tool: '工具執行',
  cancel: '取消操作',
  budget: '軟預算',
  unknown: '未知階段',
};

const PAUSE_REASON_LABEL: Record<NonNullable<AgentRunState['pauseReason']>, string> = {
  budget: '達到軟預算，等待你的選擇。',
  user: '由你暫停。',
  external: '由外部狀態暫停。',
  retryable_failure: '可重試的失敗已保留。',
  resume_ack: '續跑需要額外確認。',
};

const formatCount = (value: number | undefined): string =>
  typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('zh-TW') : '—';

const formatBudgetValue = (value: number | undefined): string =>
  typeof value === 'number' && Number.isFinite(value) ? String(value) : '';

const formatValidationError = (field: BudgetField, rawValue: string): string | null => {
  const value = rawValue.trim();
  if (value === '') {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return `${field.label}必須是有限的整數。`;
  }
  if (!Number.isInteger(parsed)) {
    return `${field.label}必須是整數。`;
  }
  if (parsed < field.min || parsed > field.max) {
    return `${field.label}請輸入 ${field.min.toLocaleString('zh-TW')}–${field.max.toLocaleString('zh-TW')}。`;
  }
  return null;
};

const formatFailureStage = (
  state?: AgentRunState | null,
  checkpoint?: AgentRunCheckpoint | null,
): string | null => {
  const stage =
    state?.failure?.stage ??
    state?.failureStage ??
    checkpoint?.failure?.stage ??
    checkpoint?.failureStage;
  return stage ? FAILURE_STAGE_LABEL[stage] : null;
};

const getRetryableFailure = (
  state?: AgentRunState | null,
  checkpoint?: AgentRunCheckpoint | null,
): boolean | undefined =>
  state?.failure?.retryable ??
  state?.failureRetryable ??
  checkpoint?.failure?.retryable ??
  checkpoint?.failureRetryable;

const getRunUsage = (
  state?: AgentRunState | null,
  checkpoint?: AgentRunCheckpoint | null,
): RunUsage | null => {
  if (state?.budgetUsage) {
    return state.budgetUsage;
  }
  if (checkpoint?.budgetUsage) {
    return checkpoint.budgetUsage;
  }
  if (!state && !checkpoint) {
    return null;
  }

  const promptTokens = checkpoint?.tokenTotals.promptTokenCount ?? 0;
  const candidateTokens = checkpoint?.tokenTotals.candidatesTokenCount ?? 0;
  return {
    turns: state?.turnIndex ?? checkpoint?.turnIndex ?? 0,
    toolCalls: state?.toolTrace.length ?? checkpoint?.toolTrace.length ?? 0,
    toolCallsKnown:
      !checkpoint?.resumeBudgetAcknowledgementRequired &&
      (state?.toolTrace.length ?? checkpoint?.toolTrace.length ?? 0) < 32,
    tokens: promptTokens + candidateTokens,
    estimatedTokens: promptTokens + candidateTokens === 0,
  };
};

const AgentRunControls: React.FC<AgentRunControlsProps> = ({
  budget,
  onBudgetChange,
  state = null,
  checkpoint = null,
  disabled = false,
  className,
}) => {
  const [validationErrors, setValidationErrors] = useState<Partial<Record<BudgetKey, string>>>({});
  const [diagnosticMessage, setDiagnosticMessage] = useState('');
  const [diagnosticError, setDiagnosticError] = useState('');
  const diagnosticState: AgentRunState | null =
    state ??
    (checkpoint
      ? {
          runId: checkpoint.runId,
          sessionId: checkpoint.sessionId,
          assistantId: checkpoint.assistantId,
          projectId: checkpoint.projectId ?? '',
          status: checkpoint.status,
          turnIndex: checkpoint.turnIndex,
          maxTurns: checkpoint.maxTurns,
          previewDiagnosticState: 'not_executed',
          autoContinued: checkpoint.turnIndex > 0,
          toolTrace: checkpoint.toolTrace,
          budget: checkpoint.budget,
          budgetUsage: checkpoint.budgetUsage,
          pauseReason: checkpoint.pauseReason,
          failure: checkpoint.failure,
          startedAt: checkpoint.createdAt,
          updatedAt: checkpoint.updatedAt,
        }
      : null);

  const runStatus = state?.status ?? checkpoint?.status ?? null;
  const runMaxTurns = state?.maxTurns ?? checkpoint?.maxTurns;
  const usage = getRunUsage(state, checkpoint);
  const failureStage = formatFailureStage(state, checkpoint);
  const retryableFailure = getRetryableFailure(state, checkpoint);
  const pauseReason = state?.pauseReason ?? checkpoint?.pauseReason;
  const displayedTurn = usage?.turns ?? state?.turnIndex;
  const displayedTurnLabel =
    displayedTurn === undefined ? undefined : usage ? displayedTurn : displayedTurn + 1;

  const handleBudgetChange = (field: BudgetField, rawValue: string): void => {
    if (disabled) {
      return;
    }
    const validationError = formatValidationError(field, rawValue);
    setValidationErrors(current => ({
      ...current,
      [field.key]: validationError ?? '',
    }));

    if (validationError) {
      return;
    }

    const trimmed = rawValue.trim();
    const nextBudget: AgentRunBudget = { ...budget };
    if (trimmed === '') {
      delete nextBudget[field.key];
    } else {
      nextBudget[field.key] = Number(trimmed);
    }
    onBudgetChange(nextBudget);
  };

  const handleDiagnosticsDownload = (): void => {
    if (!diagnosticState || disabled) {
      return;
    }

    setDiagnosticMessage('');
    setDiagnosticError('');
    try {
      const serialized = exportAgentRunDiagnostics({ state: diagnosticState, checkpoint });
      const blob = new globalThis.Blob([serialized], { type: 'application/json;charset=utf-8' });
      const objectUrl = URL.createObjectURL(blob);
      try {
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = 'educare-agent-run-diagnostics.json';
        link.rel = 'noopener';
        link.style.display = 'none';
        try {
          document.body.append(link);
          link.click();
        } finally {
          link.remove();
        }
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
      setDiagnosticMessage('已下載去除私人內容的診斷檔。');
    } catch {
      setDiagnosticError('診斷檔下載失敗；目前狀態仍保留在本機。');
    }
  };

  return (
    <section
      className={`rounded-2xl border border-gray-800 bg-gray-900/60 p-3 text-sm text-gray-100 md:p-4 ${className ?? ''}`}
      data-testid='agent-run-controls'
      aria-labelledby='agent-run-controls-heading'
    >
      <header className='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <p className='text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-300'>
            代理工作狀態
          </p>
          <h2 id='agent-run-controls-heading' className='mt-1 text-base font-semibold text-white'>
            回合與用量上限
          </h2>
          <p className='mt-1 max-w-2xl text-xs leading-5 text-gray-400'>
            這些是本機軟限制，不是供應商的計費上限或硬性配額。暫停後可調整上限，再選擇續跑。
          </p>
        </div>
        {runStatus ? (
          <span
            className={`inline-flex min-h-8 items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${STATUS_CLASS[runStatus]}`}
            data-testid='agent-run-status'
          >
            {STATUS_LABEL[runStatus]}
          </span>
        ) : (
          <span
            className='inline-flex min-h-8 items-center rounded-full border border-gray-700 bg-gray-800/70 px-2.5 py-1 text-xs text-gray-400'
            data-testid='agent-run-status'
          >
            尚未開始
          </span>
        )}
      </header>

      <fieldset className='mt-4 rounded-xl border border-gray-700/80 p-3' disabled={disabled}>
        <legend className='px-1 text-xs font-semibold text-gray-300'>本次執行的軟預算</legend>
        <div className='mt-2 grid gap-3 md:grid-cols-3'>
          {BUDGET_FIELDS.map(field => {
            const error = validationErrors[field.key];
            const inputId = `agent-run-budget-${field.key}`;
            const errorId = `${inputId}-error`;
            return (
              <label key={field.key} className='block text-xs text-gray-300' htmlFor={inputId}>
                <span className='font-semibold text-gray-200'>{field.label}</span>
                <span className='mt-1 block min-h-10 text-[11px] leading-4 text-gray-500'>
                  {field.description}
                </span>
                <span className='mt-2 flex min-h-11 items-center rounded-lg border border-gray-600 bg-gray-950/60 focus-within:border-cyan-500'>
                  <input
                    id={inputId}
                    aria-label={field.label}
                    type='text'
                    inputMode='numeric'
                    aria-valuemin={field.min}
                    aria-valuemax={field.max}
                    value={formatBudgetValue(budget[field.key])}
                    onChange={event => handleBudgetChange(field, event.target.value)}
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? errorId : undefined}
                    className='min-w-0 flex-1 bg-transparent px-3 py-2 text-sm text-white outline-none'
                  />
                  <span className='pr-3 text-[11px] text-gray-500'>{field.suffix}</span>
                </span>
                {error && (
                  <span id={errorId} className='mt-1 block text-[11px] leading-4 text-rose-300'>
                    {error}
                  </span>
                )}
              </label>
            );
          })}
        </div>
        <p className='mt-3 text-[11px] leading-5 text-gray-500'>
          清空欄位即可交由上層使用預設值；限制只在下一次執行建立時套用。
        </p>
      </fieldset>

      <section className='mt-4' aria-labelledby='agent-run-usage-heading'>
        <div className='flex items-center justify-between gap-3'>
          <h3
            id='agent-run-usage-heading'
            className='text-xs font-semibold uppercase tracking-wide text-gray-400'
          >
            目前狀態與估算用量
          </h3>
          {runMaxTurns !== undefined && (
            <span className='text-[11px] tabular-nums text-gray-500'>
              回合 {formatCount(displayedTurnLabel)} / {formatCount(runMaxTurns)}
            </span>
          )}
        </div>
        <div className='mt-2 grid gap-2 sm:grid-cols-3'>
          <UsageMetric label='已用回合' value={formatCount(usage?.turns ?? state?.turnIndex)} />
          <UsageMetric
            label='工具呼叫'
            value={usage ? formatCount(usage.toolCalls) : '尚無資料'}
            suffix={usage?.toolCallsKnown === false ? '（不完整）' : undefined}
          />
          <UsageMetric
            label='Token 用量'
            value={usage ? formatCount(usage.tokens) : '尚無資料'}
            suffix={usage?.estimatedTokens ? '（估算）' : undefined}
          />
        </div>
        <p className='mt-2 text-[11px] leading-5 text-gray-500'>
          用量只用於本機預算判斷；沒有供應商實際帳單資料，因此不顯示精確費用。
        </p>
      </section>

      {(failureStage || pauseReason) && (
        <div
          className='mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-100'
          role={failureStage ? 'alert' : 'status'}
          data-testid='agent-run-failure-summary'
        >
          {failureStage && (
            <p>
              失敗階段：<span className='font-semibold'>{failureStage}</span>
              {retryableFailure === true && <span> · 可以重試</span>}
              {retryableFailure === false && <span> · 不會自動重試</span>}
            </p>
          )}
          {pauseReason && <p className='mt-1'>{PAUSE_REASON_LABEL[pauseReason]}</p>}
        </div>
      )}

      {diagnosticState && (
        <div className='mt-4 border-t border-gray-800 pt-3'>
          <button
            type='button'
            onClick={handleDiagnosticsDownload}
            disabled={disabled}
            className='inline-flex min-h-11 items-center rounded-lg border border-cyan-500/40 px-3 py-2 text-xs font-semibold text-cyan-100 transition hover:border-cyan-300 hover:bg-cyan-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:cursor-not-allowed disabled:opacity-50'
            data-testid='agent-run-diagnostics-download'
          >
            下載去敏診斷檔
          </button>
          <p className='mt-2 text-[11px] leading-5 text-gray-500'>
            只包含狀態、預算與用量摘要；不包含聊天原文、教材、工具參數、憑證或網址。
          </p>
        </div>
      )}

      <div className='mt-3 min-h-5'>
        {diagnosticMessage && (
          <p className='text-xs text-emerald-200' role='status' aria-live='polite'>
            {diagnosticMessage}
          </p>
        )}
        {diagnosticError && (
          <p className='text-xs text-rose-200' role='alert' aria-live='assertive'>
            {diagnosticError}
          </p>
        )}
      </div>
    </section>
  );
};

interface UsageMetricProps {
  label: string;
  value: string;
  suffix?: string;
}

const UsageMetric: React.FC<UsageMetricProps> = ({ label, value, suffix }) => (
  <div className='rounded-xl border border-gray-800 bg-gray-950/40 px-3 py-2.5'>
    <p className='text-[10px] uppercase tracking-wide text-gray-500'>{label}</p>
    <p className='mt-1 text-sm font-semibold tabular-nums text-gray-100'>
      {value}
      {suffix && <span className='ml-1 text-[10px] font-normal text-amber-200'>{suffix}</span>}
    </p>
  </div>
);

export { AgentRunControls };
export default AgentRunControls;
