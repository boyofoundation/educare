import React, { useMemo, useState } from 'react';
import type { ToolCallRecord } from '../../types';

const STATUS_STYLES: Record<
  ToolCallRecord['status'],
  {
    label: string;
    badgeClassName: string;
    dotClassName: string;
    panelClassName: string;
  }
> = {
  running: {
    label: 'Running',
    badgeClassName: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200',
    dotClassName: 'bg-cyan-400 animate-pulse',
    panelClassName: 'border-cyan-500/20 bg-gray-850/60',
  },
  ok: {
    label: 'OK',
    badgeClassName: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
    dotClassName: 'bg-emerald-400',
    panelClassName: 'border-emerald-500/20 bg-gray-850/60',
  },
  recoverable_error: {
    label: 'Recoverable',
    badgeClassName: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
    dotClassName: 'bg-amber-400',
    panelClassName: 'border-amber-500/20 bg-gray-850/60',
  },
  failed: {
    label: 'Failed',
    badgeClassName: 'border-rose-500/40 bg-rose-500/10 text-rose-200',
    dotClassName: 'bg-rose-400',
    panelClassName: 'border-rose-500/20 bg-gray-850/60',
  },
};

const ToolCallPanel: React.FC<{ record: ToolCallRecord }> = ({ record }) => {
  const [expanded, setExpanded] = useState(record.status !== 'running');
  const statusStyle = STATUS_STYLES[record.status];
  const durationLabel = useMemo(() => {
    if (typeof record.durationMs !== 'number') {
      return '—';
    }
    return `${record.durationMs} ms`;
  }, [record.durationMs]);

  return (
    <div className={`rounded-2xl border p-4 shadow-lg ${statusStyle.panelClassName}`}>
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
            <h4 className='truncate text-sm font-semibold text-white'>{record.name}</h4>
          </div>
          <p className='mt-1 text-xs text-gray-400'>Duration: {durationLabel}</p>
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
          {record.code && (
            <div>
              <p className='mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500'>
                Code
              </p>
              <p className='text-xs text-gray-200'>{record.code}</p>
            </div>
          )}

          <div>
            <p className='mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500'>
              Summary
            </p>
            <p className='text-sm text-gray-200'>{record.summary || 'No summary captured.'}</p>
          </div>
        </div>
      )}
    </div>
  );
};

const ToolCallCard: React.FC<{ records: ToolCallRecord[] }> = ({ records }) => {
  if (records.length === 0) {
    return null;
  }

  return (
    <div className='rounded-2xl border border-violet-500/20 bg-gray-850/60 p-4'>
      <div className='mb-3 flex items-center justify-between gap-3'>
        <div>
          <h3 className='text-sm font-semibold text-violet-100'>Tool activity</h3>
          <p className='text-xs text-gray-400'>
            Per-call status, summaries, and recoverable errors.
          </p>
        </div>
        <span className='rounded-full border border-gray-700/70 bg-gray-900/50 px-2.5 py-1 text-[11px] text-gray-300'>
          {records.length} call{records.length > 1 ? 's' : ''}
        </span>
      </div>

      <div className='grid gap-3 md:grid-cols-2'>
        {records.map(record => (
          <ToolCallPanel key={record.id} record={record} />
        ))}
      </div>
    </div>
  );
};

export default ToolCallCard;
