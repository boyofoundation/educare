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
    label: 'Running',
    badgeClassName: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200',
    dotClassName: 'bg-cyan-400 animate-pulse',
  },
  complete: {
    label: 'Complete',
    badgeClassName: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
    dotClassName: 'bg-emerald-400',
  },
  failed: {
    label: 'Failed',
    badgeClassName: 'border-rose-500/40 bg-rose-500/10 text-rose-200',
    dotClassName: 'bg-rose-400',
  },
  aborted: {
    label: 'Aborted',
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
        className='flex w-full items-start justify-between gap-3 text-left'
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
          <p className='mt-1 line-clamp-2 text-xs text-gray-400'>{run.task}</p>
        </div>
        <div className='flex flex-col items-end gap-2'>
          <span
            className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium ${statusStyle.badgeClassName}`}
          >
            {statusStyle.label}
          </span>
          <span className='text-[11px] text-gray-500'>{expanded ? 'Hide' : 'Show'} details</span>
        </div>
      </button>

      {expanded && (
        <div className='mt-4 space-y-3 border-t border-gray-700/70 pt-4'>
          {toolSummary && (
            <div>
              <p className='mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500'>
                Tool trace
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
            <p className='mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500'>
              Output
            </p>
            <div className='rounded-xl bg-gray-900/60 px-3 py-3 text-sm text-gray-200'>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {run.output || '_No output captured._'}
              </ReactMarkdown>
            </div>
            {run.truncated && (
              <p className='mt-2 text-[11px] text-amber-300'>
                Output truncated to keep the parent turn concise.
              </p>
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
          <h3 className='text-sm font-semibold text-cyan-100'>Subagent activity</h3>
          <p className='text-xs text-gray-400'>Parallel delegated tasks and their outputs.</p>
        </div>
        <span className='rounded-full border border-gray-700/70 bg-gray-900/50 px-2.5 py-1 text-[11px] text-gray-300'>
          {runs.length} task{runs.length > 1 ? 's' : ''}
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
