import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { AgentRunState, HtmlProjectGitLogCommit } from '../../types';
import { htmlProjectStore } from '../../services/htmlProjectStore';
import { htmlPreviewService } from '../../services/htmlPreviewService';
import { useAppContext } from '../core/useAppContext';

interface AgentRunPanelProps {
  projectId: string;
  runState: AgentRunState | null;
}

const STATUS_LABEL: Record<AgentRunState['status'], string> = {
  running: '執行中',
  complete: '完成',
  stopped: '已停止',
  failed: '失敗',
  aborted: '已中斷',
};

const STATUS_COLOR: Record<AgentRunState['status'], string> = {
  running: 'bg-cyan-500/20 text-cyan-200 border-cyan-500/40',
  complete: 'bg-emerald-500/20 text-emerald-200 border-emerald-500/40',
  stopped: 'bg-amber-500/20 text-amber-200 border-amber-500/40',
  failed: 'bg-rose-500/20 text-rose-200 border-rose-500/40',
  aborted: 'bg-gray-500/20 text-gray-200 border-gray-500/40',
};

const DIAG_LIGHT_COLOR: Record<AgentRunState['previewDiagnosticState'], string> = {
  not_executed: 'bg-gray-500',
  clean: 'bg-emerald-500',
  has_errors: 'bg-rose-500',
};

const DIAG_LIGHT_LABEL: Record<AgentRunState['previewDiagnosticState'], string> = {
  not_executed: '尚未執行',
  clean: '無錯誤',
  has_errors: '有錯誤',
};

const formatTime = (ms: number): string => {
  const date = new Date(ms);
  return date.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
};

const formatRelativeTime = (ms: number): string => {
  const now = Date.now();
  const diff = Math.max(0, now - ms);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) {
    return '剛剛';
  }
  if (minutes < 60) {
    return `${minutes} 分鐘前`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} 小時前`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days} 天前`;
  }
  return new Date(ms).toLocaleDateString('zh-TW');
};

export function AgentRunPanel({ projectId, runState }: AgentRunPanelProps): React.JSX.Element {
  const { actions } = useAppContext();
  const [history, setHistory] = useState<HtmlProjectGitLogCommit[]>([]);
  const [dirtyCount, setDirtyCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [revertingVersion, setRevertingVersion] = useState<number | null>(null);
  const [expandedOid, setExpandedOid] = useState<string | null>(null);
  const [commitDraftOpen, setCommitDraftOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [isCommitting, setIsCommitting] = useState(false);

  const refreshHistory = useCallback(async () => {
    setIsLoading(true);
    setHistoryError(null);
    try {
      const [commits, status] = await Promise.all([
        htmlProjectStore.getHistory(projectId),
        htmlProjectStore.getWorkingTreeStatus(projectId),
      ]);
      setHistory(commits);
      setDirtyCount(status.added.length + status.modified.length + status.deleted.length);
    } catch (error) {
      setHistoryError((error as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  // Load history on mount, on run end, and when runState.snapshotVersion changes.
  useEffect(() => {
    refreshHistory().catch(() => {
      // best-effort — handled in callback.
    });
  }, [refreshHistory, runState?.status, runState?.snapshotVersion]);

  const handleRevert = async (version: number) => {
    const confirmed = window.confirm(`還原至版本 v${version}?目前未提交的變更會遺失。`);
    if (!confirmed) {
      return;
    }
    setRevertingVersion(version);
    setHistoryError(null);
    try {
      await htmlProjectStore.revertToSnapshot(projectId, version);
      const nextPreview = await htmlPreviewService.resolveProjectForPreview(projectId);
      actions.setProjectPreview(nextPreview);
      actions.appendProjectActivity(`已還原至版本 v${version}。`);
      await refreshHistory();
    } catch (error) {
      setHistoryError((error as Error).message);
      actions.appendProjectActivity(`還原失敗:${(error as Error).message}`);
    } finally {
      setRevertingVersion(null);
    }
  };

  const handleCommit = async () => {
    const trimmed = commitMessage.trim();
    if (!trimmed) {
      return;
    }
    setIsCommitting(true);
    setHistoryError(null);
    try {
      const result = await htmlProjectStore.commitChanges(projectId, trimmed);
      if (result.committed) {
        actions.appendProjectActivity(`已提交變更 (${result.oid?.slice(0, 7)}):${trimmed}`);
      } else {
        actions.appendProjectActivity('無變更可提交。');
      }
      setCommitMessage('');
      setCommitDraftOpen(false);
      await refreshHistory();
    } catch (error) {
      setHistoryError((error as Error).message);
    } finally {
      setIsCommitting(false);
    }
  };

  const todo = runState?.todoSummary;
  const todoCompleted = todo?.completed ?? 0;
  const todoTotal = todo?.total ?? 0;
  const todoPct = todoTotal > 0 ? Math.round((todoCompleted / todoTotal) * 100) : 0;
  const toolTrace = runState?.toolTrace ?? [];
  const recentTools = toolTrace.slice(-8);

  const hasDirtyChanges = dirtyCount > 0;
  const canCommit = hasDirtyChanges && commitMessage.trim().length > 0 && !isCommitting;

  const revertableCommits = useMemo(
    () => history.filter(commit => commit.isSnapshot && typeof commit.previewVersion === 'number'),
    [history],
  );

  return (
    <div
      className='flex flex-col gap-4 rounded-2xl border border-gray-800 bg-gray-900/60 p-3 md:p-4 text-xs md:text-sm'
      data-testid='agent-run-panel'
    >
      {/* Header: status + turn counter */}
      <div className='flex flex-wrap items-center gap-2'>
        <span className='text-xs font-semibold uppercase tracking-wider text-gray-400'>
          Agent Run
        </span>
        {runState ? (
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${STATUS_COLOR[runState.status]}`}
            data-testid='agent-run-status-badge'
          >
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                runState.status === 'running' ? 'animate-pulse bg-current' : 'bg-current'
              }`}
              aria-hidden='true'
            />
            {STATUS_LABEL[runState.status]}
          </span>
        ) : (
          <span className='text-[10px] text-gray-500'>尚未執行</span>
        )}
        {runState && (
          <span
            className='ml-auto rounded-full border border-gray-700 bg-gray-800/80 px-2 py-0.5 text-[10px] text-gray-300'
            data-testid='agent-run-turn-counter'
          >
            Turn {runState.turnIndex + 1} / {runState.maxTurns}
          </span>
        )}
        {runState?.autoContinued && (
          <span
            className='rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-200'
            title='本回合由 controller 自動續跑'
          >
            auto-continued
          </span>
        )}
        {runState?.loopDetected && (
          <span
            className='rounded-full border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 text-[10px] text-rose-200'
            title='偵測到工具迴圈,已停止'
          >
            loop detected
          </span>
        )}
      </div>

      {/* Progress grid: stacked on mobile (G16), 3-up on md+ */}
      <div className='grid grid-cols-1 gap-3 md:grid-cols-3'>
        {/* Tool rounds + recent sequence */}
        <div className='rounded-xl border border-gray-800 bg-gray-950/40 p-3'>
          <div className='mb-1 flex items-center justify-between'>
            <span className='text-[10px] uppercase tracking-wider text-gray-500'>工具軌跡</span>
            <span className='text-[10px] text-gray-400'>{toolTrace.length} 次</span>
          </div>
          {recentTools.length === 0 ? (
            <p className='text-[11px] text-gray-500'>尚無工具呼叫</p>
          ) : (
            <ol className='space-y-1 text-[11px] text-gray-300'>
              {recentTools.map((tool, idx) => (
                <li key={`${tool}-${idx}`} className='truncate'>
                  <span className='text-gray-500'>{idx + 1}.</span> {tool}
                </li>
              ))}
            </ol>
          )}
        </div>

        {/* Todo progress */}
        <div className='rounded-xl border border-gray-800 bg-gray-950/40 p-3'>
          <div className='mb-1 flex items-center justify-between'>
            <span className='text-[10px] uppercase tracking-wider text-gray-500'>Todo 進度</span>
            <span className='text-[10px] text-gray-400'>
              {todoCompleted} / {todoTotal}
            </span>
          </div>
          {todoTotal === 0 ? (
            <p className='text-[11px] text-gray-500'>尚無 todo 資料</p>
          ) : (
            <div className='space-y-2'>
              <div className='h-1.5 w-full overflow-hidden rounded-full bg-gray-800'>
                <div
                  className='h-full bg-gradient-to-r from-cyan-500 to-emerald-500 transition-all'
                  style={{ width: `${todoPct}%` }}
                />
              </div>
              <p className='text-[11px] text-gray-400'>{todoPct}% 完成</p>
            </div>
          )}
        </div>

        {/* Runtime diagnostic light */}
        <div className='rounded-xl border border-gray-800 bg-gray-950/40 p-3'>
          <span className='mb-1 block text-[10px] uppercase tracking-wider text-gray-500'>
            預覽診斷
          </span>
          <div className='flex items-center gap-2'>
            <span
              className={`inline-block h-3 w-3 rounded-full ${
                runState ? DIAG_LIGHT_COLOR[runState.previewDiagnosticState] : 'bg-gray-700'
              }`}
              aria-hidden='true'
              data-testid='agent-run-diagnostic-light'
            />
            <span className='text-[11px] text-gray-300'>
              {runState ? DIAG_LIGHT_LABEL[runState.previewDiagnosticState] : '尚未執行'}
            </span>
          </div>
          {runState?.finishReason && (
            <p className='mt-2 text-[10px] text-gray-500'>
              finishReason: <code className='text-gray-400'>{runState.finishReason}</code>
            </p>
          )}
        </div>
      </div>

      {/* Version history section (git log + commit + revert) */}
      <div className='rounded-xl border border-gray-800 bg-gray-950/40 p-3'>
        <div className='mb-2 flex flex-wrap items-center gap-2'>
          <span className='text-[10px] uppercase tracking-wider text-gray-500'>版本歷史</span>
          {hasDirtyChanges ? (
            <span
              className='rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-200'
              data-testid='dirty-badge'
            >
              {dirtyCount} 個未提交變更
            </span>
          ) : (
            <span className='text-[10px] text-emerald-300/80' data-testid='clean-badge'>
              工作樹乾淨
            </span>
          )}
          <button
            type='button'
            onClick={() => setCommitDraftOpen(open => !open)}
            disabled={!hasDirtyChanges || isCommitting}
            className='ml-auto rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2 py-0.5 text-[10px] text-cyan-100 transition hover:border-cyan-400 hover:bg-cyan-500/20 disabled:opacity-40'
            aria-label='提交變更'
            data-testid='commit-changes-button'
          >
            提交變更
          </button>
          <button
            type='button'
            onClick={refreshHistory}
            disabled={isLoading}
            className='rounded-full border border-gray-700 bg-gray-800/80 px-2 py-0.5 text-[10px] text-gray-300 transition hover:border-gray-600 hover:text-white disabled:opacity-50'
            aria-label='重新載入歷史'
          >
            {isLoading ? '載入中…' : '重新載入'}
          </button>
        </div>

        {commitDraftOpen && (
          <div className='mb-2 flex flex-wrap items-center gap-2' data-testid='commit-draft'>
            <input
              type='text'
              value={commitMessage}
              onChange={event => setCommitMessage(event.target.value)}
              placeholder='提交訊息 (例如:加入首頁導覽列)'
              className='min-w-0 flex-1 rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-[11px] text-gray-100 placeholder:text-gray-600 focus:border-cyan-500 focus:outline-none'
              data-testid='commit-message-input'
              disabled={isCommitting}
            />
            <button
              type='button'
              onClick={handleCommit}
              disabled={!canCommit}
              className='rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-100 transition hover:bg-emerald-500/20 disabled:opacity-40'
              data-testid='commit-confirm-button'
            >
              {isCommitting ? '提交中…' : '確認提交'}
            </button>
            <button
              type='button'
              onClick={() => {
                setCommitDraftOpen(false);
                setCommitMessage('');
              }}
              disabled={isCommitting}
              className='rounded-md border border-gray-700 px-2 py-1 text-[10px] text-gray-400 hover:text-gray-200 disabled:opacity-40'
            >
              取消
            </button>
          </div>
        )}

        {historyError && (
          <p className='mb-2 text-[11px] text-rose-300' role='alert'>
            歷史錯誤:{historyError}
          </p>
        )}
        {history.length === 0 ? (
          <p className='text-[11px] text-gray-500'>尚無版本歷史。</p>
        ) : (
          <ul className='divide-y divide-gray-800'>
            {history.map(commit => {
              const isExpanded = expandedOid === commit.oid;
              const canRevert = revertableCommits.some(c => c.oid === commit.oid);
              const isRevertingThis = canRevert && revertingVersion === commit.previewVersion;
              return (
                <li
                  key={commit.oid}
                  className='py-2 text-[11px]'
                  data-testid={`history-row-${commit.shortOid}`}
                >
                  <div className='flex flex-wrap items-center gap-2'>
                    <button
                      type='button'
                      onClick={() => setExpandedOid(isExpanded ? null : commit.oid)}
                      className='font-mono text-gray-400 transition hover:text-gray-200'
                      aria-label={isExpanded ? '收合檔案清單' : '展開檔案清單'}
                      aria-expanded={isExpanded}
                      data-testid={`history-expand-${commit.shortOid}`}
                    >
                      {isExpanded ? '▾' : '▸'}
                    </button>
                    <span className='font-mono text-gray-300' title={commit.oid}>
                      {commit.shortOid}
                    </span>
                    <span className='text-gray-500'>·</span>
                    <span className='max-w-[12rem] truncate text-gray-200' title={commit.note}>
                      {commit.note || '(無訊息)'}
                    </span>
                    {commit.isSnapshot && (
                      <span className='rounded-full border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-[9px] text-cyan-200'>
                        snapshot
                      </span>
                    )}
                    <span className='text-gray-500' title={formatTime(commit.timestamp)}>
                      · {formatRelativeTime(commit.timestamp)}
                    </span>
                    <span className='text-gray-600'>· {commit.files.length} 檔</span>
                    {canRevert && (
                      <button
                        type='button'
                        onClick={() => handleRevert(commit.previewVersion as number)}
                        disabled={revertingVersion !== null}
                        className='ml-auto rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2 py-0.5 text-[10px] text-cyan-100 transition hover:border-cyan-400 hover:bg-cyan-500/20 disabled:opacity-50'
                        aria-label={`還原至版本 v${commit.previewVersion}`}
                        data-testid={`history-revert-${commit.shortOid}`}
                      >
                        {isRevertingThis ? '還原中…' : '還原'}
                      </button>
                    )}
                  </div>
                  {isExpanded && (
                    <ul
                      className='mt-1 ml-6 list-disc space-y-0.5 text-[10px] text-gray-500'
                      data-testid={`history-files-${commit.shortOid}`}
                    >
                      {commit.files.length === 0 ? (
                        <li className='list-none text-gray-600'>無檔案</li>
                      ) : (
                        commit.files.map(path => (
                          <li key={path} className='font-mono'>
                            {path}
                          </li>
                        ))
                      )}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
