import React, { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { SubagentRunRecord, ToolCallRecord } from '../../types';

type StepStatus = ToolCallRecord['status'] | SubagentRunRecord['status'];

const STATUS_META: Record<
  StepStatus,
  {
    label: string;
    dotClassName: string;
    labelClassName: string;
    /** ok/complete 視為安靜狀態，不顯示文字徽章以降低噪音。 */
    quiet: boolean;
  }
> = {
  running: {
    label: '執行中',
    dotClassName: 'bg-cyan-400 animate-pulse',
    labelClassName: 'text-cyan-300',
    quiet: false,
  },
  ok: {
    label: '成功',
    dotClassName: 'bg-emerald-400',
    labelClassName: 'text-emerald-300',
    quiet: true,
  },
  complete: {
    label: '完成',
    dotClassName: 'bg-emerald-400',
    labelClassName: 'text-emerald-300',
    quiet: true,
  },
  recoverable_error: {
    label: '可恢復',
    dotClassName: 'bg-amber-400',
    labelClassName: 'text-amber-300',
    quiet: false,
  },
  aborted: {
    label: '已中止',
    dotClassName: 'bg-amber-400',
    labelClassName: 'text-amber-300',
    quiet: false,
  },
  failed: {
    label: '失敗',
    dotClassName: 'bg-rose-400',
    labelClassName: 'text-rose-300',
    quiet: false,
  },
};

const formatDuration = (durationMs?: number): string | null => {
  if (typeof durationMs !== 'number' || durationMs < 0) {
    return null;
  }
  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }
  return `${(durationMs / 1000).toFixed(1)} s`;
};

const Chevron: React.FC<{ open: boolean }> = ({ open }) => (
  <svg
    className={`h-3.5 w-3.5 flex-shrink-0 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`}
    fill='none'
    stroke='currentColor'
    viewBox='0 0 24 24'
    aria-hidden='true'
  >
    <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M19 9l-7 7-7-7' />
  </svg>
);

const DetailLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className='mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500'>{children}</p>
);

interface TimelineRowProps {
  status: StepStatus;
  name: string;
  /** 顯示在名稱下的一行摘要（收合時 truncate）。 */
  subtitle?: string;
  durationMs?: number;
  /** 子任務列會標上小徽章，與工具步驟區分。 */
  isSubagent?: boolean;
  children: React.ReactNode;
}

const TimelineRow: React.FC<TimelineRowProps> = ({
  status,
  name,
  subtitle,
  durationMs,
  isSubagent = false,
  children,
}) => {
  const [expanded, setExpanded] = useState(status === 'failed');
  const meta = STATUS_META[status];
  const durationLabel = formatDuration(durationMs);

  return (
    <li className='relative'>
      <span
        className={`absolute -left-[1.31rem] top-[0.7rem] h-2 w-2 rounded-full ring-2 ring-gray-900/80 ${meta.dotClassName}`}
        aria-hidden='true'
      />
      <button
        type='button'
        onClick={() => setExpanded(open => !open)}
        aria-expanded={expanded}
        className='flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-gray-800/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/70'
      >
        <span className='min-w-0 flex-1'>
          <span className='flex items-center gap-2'>
            <span className='truncate text-sm font-medium text-gray-100'>{name}</span>
            {isSubagent && (
              <span className='flex-shrink-0 rounded border border-gray-600/70 px-1 text-[10px] leading-4 text-gray-400'>
                子任務
              </span>
            )}
            {!meta.quiet && (
              <span className={`flex-shrink-0 text-[11px] font-medium ${meta.labelClassName}`}>
                {meta.label}
              </span>
            )}
          </span>
          {subtitle && !expanded && (
            <span className='mt-0.5 block truncate text-xs text-gray-500'>{subtitle}</span>
          )}
        </span>
        {durationLabel && (
          <span className='flex-shrink-0 text-[11px] tabular-nums text-gray-500'>
            {durationLabel}
          </span>
        )}
        <Chevron open={expanded} />
      </button>

      {expanded && <div className='mb-1 ml-2 mt-1 space-y-3 px-2 pb-1'>{children}</div>}
    </li>
  );
};

export interface AgentActivityTimelineProps {
  toolCalls?: ToolCallRecord[];
  subagentRuns?: SubagentRunRecord[];
  /** 執行中的即時模式：預設展開清單並在標題顯示目前步驟。 */
  live?: boolean;
}

const AgentActivityTimeline: React.FC<AgentActivityTimelineProps> = ({
  toolCalls = [],
  subagentRuns = [],
  live = false,
}) => {
  const [expanded, setExpanded] = useState(live);

  const stepCount = toolCalls.length;
  const subagentCount = subagentRuns.length;

  const summaryLabel = useMemo(() => {
    const parts: string[] = [];
    if (stepCount > 0) {
      parts.push(`${stepCount} 個步驟`);
    }
    if (subagentCount > 0) {
      parts.push(`${subagentCount} 個子任務`);
    }
    return parts.join(' · ');
  }, [stepCount, subagentCount]);

  const runningName = useMemo(() => {
    const runningSubagent = subagentRuns.find(run => run.status === 'running');
    if (runningSubagent) {
      return runningSubagent.name;
    }
    for (let index = toolCalls.length - 1; index >= 0; index -= 1) {
      if (toolCalls[index].status === 'running') {
        return toolCalls[index].name;
      }
    }
    return null;
  }, [subagentRuns, toolCalls]);

  const overallStatus: StepStatus = useMemo(() => {
    const statuses: StepStatus[] = [
      ...toolCalls.map(record => record.status),
      ...subagentRuns.map(run => run.status),
    ];
    if (statuses.includes('running')) {
      return 'running';
    }
    if (statuses.includes('failed')) {
      return 'failed';
    }
    if (statuses.includes('recoverable_error') || statuses.includes('aborted')) {
      return 'recoverable_error';
    }
    return 'ok';
  }, [subagentRuns, toolCalls]);

  if (stepCount === 0 && subagentCount === 0) {
    return null;
  }

  // 即時模式下整體仍在進行中,標題燈號維持脈動,避免步驟間空檔誤顯示「完成」。
  const overallMeta = STATUS_META[live ? 'running' : overallStatus];

  return (
    <section
      className='rounded-2xl border border-gray-700/60 bg-gray-850/60 text-sm'
      data-testid='agent-activity-timeline'
      aria-label='代理活動'
    >
      <button
        type='button'
        onClick={() => setExpanded(open => !open)}
        aria-expanded={expanded}
        className='flex w-full items-center gap-2.5 rounded-2xl px-4 py-3 text-left transition hover:bg-gray-800/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/70'
      >
        <span
          className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${overallMeta.dotClassName}`}
          aria-hidden='true'
        />
        <span className='min-w-0 flex-1'>
          <span className='flex flex-wrap items-baseline gap-x-2'>
            <span className='font-semibold text-gray-100'>代理活動</span>
            {summaryLabel && <span className='text-xs text-gray-400'>{summaryLabel}</span>}
          </span>
          {live && (
            <span className='mt-0.5 block truncate text-xs text-cyan-300'>
              {runningName ? `正在執行 ${runningName}…` : '思考下一步…'}
            </span>
          )}
        </span>
        <Chevron open={expanded} />
      </button>

      {expanded && (
        <div className='border-t border-gray-700/50 px-4 pb-3 pt-3'>
          <ol className='ml-2 space-y-0.5 border-l border-gray-700/50 pl-4'>
            {toolCalls.map(record => (
              <TimelineRow
                key={record.id}
                status={record.status}
                name={record.name}
                subtitle={record.summary}
                durationMs={record.durationMs}
              >
                {record.code && (
                  <div>
                    <DetailLabel>代碼</DetailLabel>
                    <p className='text-xs text-gray-300'>{record.code}</p>
                  </div>
                )}
                <div>
                  <DetailLabel>摘要</DetailLabel>
                  <p className='text-xs leading-relaxed text-gray-300'>
                    {record.summary || '未擷取摘要。'}
                  </p>
                </div>
              </TimelineRow>
            ))}

            {subagentRuns.map(run => (
              <TimelineRow
                key={run.id}
                status={run.status}
                name={run.name}
                subtitle={run.task}
                durationMs={run.durationMs}
                isSubagent
              >
                <div>
                  <DetailLabel>任務</DetailLabel>
                  <p className='text-xs leading-relaxed text-gray-300'>{run.task}</p>
                </div>

                {run.toolSequence.length > 0 && (
                  <div>
                    <DetailLabel>工具軌跡</DetailLabel>
                    <p className='text-xs text-gray-300'>{run.toolSequence.join(' → ')}</p>
                  </div>
                )}

                {run.error && (
                  <div className='rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-100'>
                    {run.error}
                  </div>
                )}

                <div>
                  <DetailLabel>輸出</DetailLabel>
                  <div className='rounded-lg bg-gray-900/60 px-3 py-2 text-xs leading-relaxed text-gray-200'>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {run.output || '（未擷取輸出）'}
                    </ReactMarkdown>
                  </div>
                  {run.truncated && (
                    <p className='mt-1.5 text-[11px] text-amber-300'>
                      輸出已截斷，以避免父回合內容過長。
                    </p>
                  )}
                </div>
              </TimelineRow>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
};

export default AgentActivityTimeline;
