import React, { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { SubagentRunRecord } from '../../types';
import type { SubagentActivityCardProps } from './types';

const STATUS_STYLES: Record<
  SubagentRunRecord['status'],
  {
    label: string;
    badgeClassName: string;
    dotClassName: string;
  }
> = {
  running: {
    label: '執行中',
    badgeClassName: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200',
    dotClassName: 'bg-cyan-400 animate-pulse',
  },
  complete: {
    label: '完成',
    badgeClassName: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
    dotClassName: 'bg-emerald-400',
  },
  failed: {
    label: '失敗',
    badgeClassName: 'border-rose-500/40 bg-rose-500/10 text-rose-200',
    dotClassName: 'bg-rose-400',
  },
  aborted: {
    label: '已中止',
    badgeClassName: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
    dotClassName: 'bg-amber-400',
  },
};

const SubagentRunPanel: React.FC<{ run: SubagentRunRecord }> = ({ run }) => {
  const [expanded, setExpanded] = useState(run.status !== 'running');
  const statusStyle = STATUS_STYLES[run.status];
  const toolSummary = useMemo(() => run.toolSequence.join(' → '), [run.toolSequence]);

  return (
    <div className='rounded-2xl border border-gray-700/70 bg-gray-800/70 p-4 shadow-lg'>
      <button
        type='button'
        onClick={() => setExpanded(open => !open)}
        className='flex w-full items-start justify-between gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/70'
        aria-expanded={expanded}
      >
        <div className='min-w-0'>
          <div className='flex items-center gap-2'>
            <span
              className={`h-2.5 w-2.5 rounded-full ${statusStyle.dotClassName}`}
              aria-hidden='true'
            />
            <h4 className='truncate text-sm font-semibold text-white'>{run.name}</h4>
          </div>
          <p className='mt-1 line-clamp-2 text-xs text-gray-300'>{run.task}</p>
        </div>
        <div className='flex flex-col items-end gap-2'>
          <span
            className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium ${statusStyle.badgeClassName}`}
          >
            {statusStyle.label}
          </span>
          <span className='text-[11px] text-gray-400'>{expanded ? '收合詳情' : '顯示詳情'}</span>
        </div>
      </button>

      {expanded && (
        <div className='mt-4 space-y-3 border-t border-gray-700/70 pt-4'>
          {toolSummary && (
            <div>
              <p className='mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400'>
                工具軌跡
              </p>
              <p className='text-xs text-gray-300'>{toolSummary}</p>
            </div>
          )}

          {run.error && (
            <div className='rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-100'>
              {run.error}
            </div>
          )}

          <div>
            <p className='mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400'>
              輸出
            </p>
            <div className='rounded-xl bg-gray-900/60 px-3 py-3 text-sm text-gray-200'>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {run.output || '（未擷取輸出）'}
              </ReactMarkdown>
            </div>
            {run.truncated && (
              <p className='mt-2 text-[11px] text-amber-300'>輸出已截斷，以避免父回合內容過長。</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const SubagentActivityCard: React.FC<SubagentActivityCardProps> = ({ runs }) => {
  if (runs.length === 0) {
    return null;
  }

  return (
    <div className='rounded-2xl border border-cyan-500/20 bg-gray-850/60 p-4'>
      <div className='mb-3 flex items-center justify-between gap-3'>
        <div>
          <h3 className='text-sm font-semibold text-cyan-100'>子代理活動</h3>
          <p className='text-xs text-gray-300'>平行委派任務與它們的輸出結果。</p>
        </div>
        <span className='rounded-full border border-gray-700/70 bg-gray-900/50 px-2.5 py-1 text-[11px] text-gray-300'>
          {runs.length} 項任務
        </span>
      </div>

      <div className='grid gap-3 md:grid-cols-2'>
        {runs.map(run => (
          <SubagentRunPanel key={run.id} run={run} />
        ))}
      </div>
    </div>
  );
};

export default SubagentActivityCard;
