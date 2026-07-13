import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AGENT_BUNDLE_LARGE_FILE_BYTES,
  buildImportedBundle,
  estimateBundleSize,
  parseBundleFile,
  parseBundleText,
} from '../../services/agentBundleService';
import * as db from '../../services/db';
import { recordBundleImportSuccess } from '../../services/bundleMetricsService';
import type { AgentBundle, BundleIssue, BundleRecord, BundleValidationResult } from '../../types';

export interface BundleImportPageProps {
  /** Return to the previous view when the user dismisses the import page. */
  onClose: () => void;
  /** Navigate into an activated or opened bundle by its local id. */
  onOpenBundle: (bundleId: string) => void;
}

interface PreviewState {
  bundle: AgentBundle;
  warnings: BundleIssue[];
}

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

const knowledgeStats = (bundle: AgentBundle): { chunks: number; characters: number } =>
  bundle.agents.reduce(
    (acc, agent) => {
      for (const chunk of agent.ragChunks) {
        acc.chunks += 1;
        acc.characters += chunk.content.length;
      }
      return acc;
    },
    { chunks: 0, characters: 0 },
  );

const navigateToBundle = (bundleId: string): void => {
  const url = new URL(window.location.href);
  url.searchParams.set('bundle', bundleId);
  url.searchParams.delete('import');
  window.location.href = url.toString();
};

const BundleImportPage: React.FC<BundleImportPageProps> = ({ onClose, onOpenBundle }) => {
  const [pasteText, setPasteText] = useState('');
  const [result, setResult] = useState<BundleValidationResult | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [bundles, setBundles] = useState<BundleRecord[]>([]);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [activating, setActivating] = useState(false);
  const [dragError, setDragError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const refreshBundles = useCallback(async () => {
    const records = await db.listBundles();
    records.sort(
      (left, right) =>
        (right.lastOpenedAt ?? right.importedAt) - (left.lastOpenedAt ?? left.importedAt),
    );
    setBundles(records);
  }, []);

  useEffect(() => {
    void refreshBundles();
  }, [refreshBundles]);

  const applyResult = useCallback((validation: BundleValidationResult) => {
    setResult(validation);
    if (validation.bundle && validation.errors.length === 0) {
      setPreview({ bundle: validation.bundle, warnings: validation.warnings });
    } else {
      setPreview(null);
    }
  }, []);

  const handleFile = useCallback(
    async (file: File) => {
      setDragError(null);
      const validation = await parseBundleFile(file);
      applyResult(validation);
    },
    [applyResult],
  );

  const handlePaste = useCallback(() => {
    setDragError(null);
    applyResult(parseBundleText(pasteText));
  }, [applyResult, pasteText]);

  const handleOpen = useCallback(
    (bundleId: string) => {
      onOpenBundle(bundleId);
      navigateToBundle(bundleId);
    },
    [onOpenBundle],
  );

  const handleActivate = useCallback(async () => {
    if (!preview) {
      return;
    }
    setActivating(true);
    try {
      const record = buildImportedBundle(preview.bundle);
      await db.saveBundle(record);
      recordBundleImportSuccess();
      await refreshBundles();
      handleOpen(record.id);
    } catch (error) {
      if ((error as Error).name === 'QuotaExceededError') {
        setDragError(
          '瀏覽器儲存空間不足。請刪除不需要的協作包或對話紀錄後重試，或請創作者縮小知識庫。',
        );
      } else {
        setDragError(`匯入失敗：${(error as Error).message}`);
      }
    } finally {
      setActivating(false);
    }
  }, [handleOpen, preview, refreshBundles]);

  const handleDelete = useCallback(
    async (bundleId: string) => {
      await db.deleteBundle(bundleId);
      setConfirmingDelete(null);
      await refreshBundles();
    },
    [refreshBundles],
  );

  const bundleSize = useMemo(() => (preview ? estimateBundleSize(preview.bundle) : 0), [preview]);
  const knowledge = useMemo(() => (preview ? knowledgeStats(preview.bundle) : null), [preview]);
  const largeBundle = bundleSize >= AGENT_BUNDLE_LARGE_FILE_BYTES;

  return (
    <div className='h-full overflow-y-auto bg-gray-900'>
      <div className='mx-auto max-w-3xl p-6 md:p-8'>
        <div className='mb-6 flex items-start justify-between gap-4'>
          <div>
            <h2 className='mb-1.5 text-2xl font-bold text-white md:text-3xl'>匯入協作包</h2>
            <p className='text-sm text-gray-400'>
              載入他人分享的 Agent 協作包 JSON，於本地瀏覽器獨立沙盒中對話。資料不會上傳伺服器。
            </p>
          </div>
          <button
            type='button'
            onClick={onClose}
            className='rounded-lg border border-gray-600 px-3 py-2 text-sm text-gray-200 transition hover:bg-gray-800'
          >
            返回
          </button>
        </div>

        {/* Drop zone */}
        <section
          aria-label='協作包檔案拖放區'
          onDragOver={event => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={event => {
            event.preventDefault();
            setDragging(false);
            const file = event.dataTransfer.files?.[0];
            if (file) {
              void handleFile(file);
            }
          }}
          className={`mb-4 rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${
            dragging ? 'border-cyan-400 bg-cyan-500/5' : 'border-gray-600 bg-gray-800/40'
          }`}
        >
          <p className='mb-3 text-gray-200'>將協作包 JSON 檔案拖放至此</p>
          <button
            type='button'
            onClick={() => fileInputRef.current?.click()}
            className='rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-cyan-500'
          >
            選擇檔案
          </button>
          <input
            ref={fileInputRef}
            type='file'
            accept='application/json,.json'
            className='hidden'
            onChange={event => {
              const file = event.target.files?.[0];
              if (file) {
                void handleFile(file);
              }
              event.target.value = '';
            }}
          />
        </section>

        {/* Paste area */}
        <section aria-label='貼上協作包 JSON 文字' className='mb-4'>
          <label htmlFor='bundle-paste' className='mb-2 block text-sm font-medium text-gray-300'>
            或貼上 JSON 文字
          </label>
          <textarea
            id='bundle-paste'
            value={pasteText}
            onChange={event => setPasteText(event.target.value)}
            placeholder='{"manifest": {"format": "educare-agent-bundle", ...}}'
            rows={5}
            className='w-full resize-y rounded-xl border border-gray-700 bg-gray-800/60 p-3 font-mono text-xs text-gray-100 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500'
          />
          <button
            type='button'
            onClick={handlePaste}
            disabled={!pasteText.trim()}
            className='mt-2 rounded-lg border border-gray-600 px-3 py-2 text-sm text-gray-200 transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50'
          >
            解析貼上內容
          </button>
        </section>

        {dragError && (
          <p
            role='alert'
            className='mb-4 rounded-lg border border-red-700/50 bg-red-900/20 p-3 text-sm text-red-200'
          >
            {dragError}
          </p>
        )}

        {/* Validation issues */}
        {result && result.errors.length > 0 && (
          <section aria-label='驗證錯誤' className='mb-4 space-y-2'>
            {result.errors.map(issue => (
              <IssueRow key={issue.code} issue={issue} tone='error' />
            ))}
          </section>
        )}
        {result && result.warnings.length > 0 && preview && (
          <section aria-label='驗證警告' className='mb-4 space-y-2'>
            {result.warnings.map(issue => (
              <IssueRow key={issue.code} issue={issue} tone='warning' />
            ))}
          </section>
        )}

        {/* Preview */}
        {preview && (
          <section
            aria-label='協作包預覽'
            className='mb-6 rounded-2xl border border-cyan-700/40 bg-gray-800/50 p-5'
          >
            <div className='mb-3 flex items-center gap-2'>
              <h3 className='text-lg font-semibold text-white'>{preview.bundle.manifest.name}</h3>
              <span className='rounded-full bg-gray-700/60 px-2 py-0.5 text-xs text-gray-300'>
                v{preview.bundle.manifest.version}
              </span>
            </div>
            {preview.bundle.manifest.description && (
              <p className='mb-3 text-sm text-gray-400'>{preview.bundle.manifest.description}</p>
            )}
            <dl className='mb-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4'>
              <div>
                <dt className='text-xs uppercase tracking-wide text-gray-500'>Agent 數</dt>
                <dd className='text-gray-200'>{preview.bundle.agents.length}</dd>
              </div>
              <div>
                <dt className='text-xs uppercase tracking-wide text-gray-500'>知識片段</dt>
                <dd className='text-gray-200'>{knowledge?.chunks ?? 0}</dd>
              </div>
              <div>
                <dt className='text-xs uppercase tracking-wide text-gray-500'>知識文字量</dt>
                <dd className='text-gray-200'>{formatBytes(knowledge?.characters ?? 0)}</dd>
              </div>
              <div>
                <dt className='text-xs uppercase tracking-wide text-gray-500'>檔案預估</dt>
                <dd className={largeBundle ? 'text-yellow-300' : 'text-gray-200'}>
                  {formatBytes(bundleSize)}
                </dd>
              </div>
            </dl>
            {largeBundle && (
              <p className='mb-4 rounded-lg border border-yellow-700/50 bg-yellow-900/20 p-2 text-xs text-yellow-200'>
                協作包體積較大，手機貼上匯入可能不便，建議以檔案傳輸。
              </p>
            )}
            {preview.bundle.manifest.schemaVersion === 2 && (
              <p className='mb-4 rounded-lg border border-fuchsia-700/50 bg-fuchsia-900/20 p-3 text-xs text-fuchsia-100'>
                此協作包包含受密碼保護的 AI
                服務商設定。匯入後必須解鎖並確認使用，或明確選擇自己的服務商；此處不會顯示任何金鑰。
              </p>
            )}
            <div className='mb-4 space-y-2'>
              <h4 className='text-xs font-semibold uppercase tracking-wide text-gray-400'>
                包內助理
              </h4>
              {preview.bundle.agents.map(agent => (
                <div
                  key={agent.id}
                  className='rounded-lg border border-gray-700/50 bg-gray-900/40 p-3 text-sm'
                >
                  <div className='flex items-center gap-2'>
                    {agent.icon && <span aria-hidden='true'>{agent.icon}</span>}
                    <span className='font-medium text-gray-100'>{agent.name}</span>
                    {agent.id === preview.bundle.manifest.entryAgentId && (
                      <span className='rounded-full bg-cyan-500/15 px-2 py-0.5 text-xs text-cyan-200'>
                        接待入口
                      </span>
                    )}
                  </div>
                  <p className='mt-1 text-xs text-gray-400'>{agent.description}</p>
                </div>
              ))}
            </div>
            <button
              type='button'
              onClick={handleActivate}
              disabled={activating}
              className='w-full rounded-xl bg-gradient-to-r from-cyan-600 to-cyan-500 px-4 py-3 font-semibold text-white shadow-lg transition hover:from-cyan-500 hover:to-cyan-400 disabled:cursor-not-allowed disabled:opacity-60'
            >
              {activating ? '匯入中...' : '啟用協作包'}
            </button>
          </section>
        )}

        {/* Imported bundles */}
        <section
          aria-label='已匯入的協作包'
          className='rounded-2xl border border-gray-700/40 bg-gray-800/30 p-5'
        >
          <h3 className='mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400'>
            已匯入的協作包
          </h3>
          {bundles.length === 0 ? (
            <p className='text-sm text-gray-500'>尚未匯入任何協作包。</p>
          ) : (
            <ul className='space-y-2'>
              {bundles.map(record => (
                <li
                  key={record.id}
                  className='flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-700/50 bg-gray-900/40 p-3'
                >
                  <div className='min-w-0'>
                    <p className='truncate text-sm font-medium text-gray-100'>
                      {record.bundle.manifest.name}
                    </p>
                    <p className='text-xs text-gray-500'>
                      {record.bundle.agents.length} 個助理 · {formatBytes(record.sizeBytes)}
                    </p>
                  </div>
                  <div className='flex items-center gap-2'>
                    <button
                      type='button'
                      onClick={() => handleOpen(record.id)}
                      className='rounded-lg border border-cyan-600/50 px-3 py-1.5 text-xs text-cyan-100 transition hover:bg-cyan-500/10'
                    >
                      開啟
                    </button>
                    {confirmingDelete === record.id ? (
                      <>
                        <span className='text-xs text-gray-400'>將一併刪除對話紀錄，確定？</span>
                        <button
                          type='button'
                          onClick={() => void handleDelete(record.id)}
                          className='rounded-lg bg-red-600 px-2 py-1.5 text-xs text-white transition hover:bg-red-500'
                        >
                          確定刪除
                        </button>
                        <button
                          type='button'
                          onClick={() => setConfirmingDelete(null)}
                          className='rounded-lg border border-gray-600 px-2 py-1.5 text-xs text-gray-200 transition hover:bg-gray-800'
                        >
                          取消
                        </button>
                      </>
                    ) : (
                      <button
                        type='button'
                        onClick={() => setConfirmingDelete(record.id)}
                        aria-label={`刪除協作包 ${record.bundle.manifest.name}`}
                        className='rounded-lg border border-red-700/50 px-3 py-1.5 text-xs text-red-200 transition hover:bg-red-900/30'
                      >
                        刪除
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
};

const IssueRow: React.FC<{ issue: BundleIssue; tone: 'error' | 'warning' }> = ({ issue, tone }) => {
  const palette =
    tone === 'error'
      ? 'border-red-700/50 bg-red-900/20 text-red-200'
      : 'border-yellow-700/50 bg-yellow-900/20 text-yellow-200';
  return (
    <div className={`rounded-lg border p-3 text-sm ${palette}`}>
      <p className='font-medium'>{issue.message}</p>
      <p className='mt-1 text-xs opacity-80'>{issue.nextStep}</p>
    </div>
  );
};

export default BundleImportPage;
