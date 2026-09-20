import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  exportWorkspaceArchive,
  getWorkspaceArchiveMetadata,
  importWorkspaceArchive,
  listWorkspaceImportRecovery,
  parseWorkspaceArchive,
  previewWorkspaceArchive,
  rollbackWorkspaceImport,
  resumeWorkspaceImport,
  WORKSPACE_ARCHIVE_MAX_BYTES,
  WORKSPACE_ARCHIVE_MAX_ENTRIES,
  type WorkspaceArchiveImportResult,
  type WorkspaceArchiveMetadata,
  type WorkspaceArchivePreview,
  type WorkspaceArchiveRecoveryStatus,
} from '../../services/workspaceArchiveService';
import {
  prepareWorkspaceArchive,
  workspaceArchiveImportOptions,
} from '../../services/workspaceArchiveSetup';

export interface WorkspaceDataManagementProps {
  /** Refresh the host's workspace lists after an import or recovery action. */
  onImported?: () => Promise<void> | void;
  className?: string;
}

interface PendingImport {
  fileName: string;
  bytes: Uint8Array;
  preview: WorkspaceArchivePreview;
}

interface StorageSnapshot {
  usage: number | null;
  quota: number | null;
  persisted: boolean | null;
}

interface BrowserStorageManager {
  estimate: () => Promise<{ usage?: number; quota?: number }>;
  persisted?: () => Promise<boolean>;
  persist?: () => Promise<boolean>;
}

const CATEGORY_LABELS: Record<string, string> = {
  assistants: '助理',
  sessions: '聊天工作階段',
  bundles: '協作包',
  projects: 'HTML 專案',
  snapshots: '專案快照',
  git: '版本紀錄',
  checkpoints: '執行檢查點',
  drafts: '草稿',
  preferences: '允許匯出的偏好',
  practice: '練習工作區',
};

const EXCLUDED_STORE_LABELS: Record<string, string> = {
  providerSettings: '服務商設定與 API 金鑰',
  htmlProjectAgentTelemetry: 'HTML 專案遙測',
  bundleMetricsService: '協作包使用指標',
  sourcePdfOrDocxWhenOnlyParsedChunksExist: '只有解析文字時的原始 PDF/DOCX',
};

const formatBytes = (bytes: number | null | undefined): string => {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) {
    return '無法估算';
  }
  if (bytes < 1024) {
    return `${Math.round(bytes)} B`;
  }
  const units = ['KiB', 'MiB', 'GiB'];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 0; index < units.length - 1 && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index + 1];
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`;
};

const formatDate = (timestamp: number | null | undefined): string => {
  if (timestamp === null || timestamp === undefined || !Number.isFinite(timestamp)) {
    return '尚未匯出備份';
  }
  return new Intl.DateTimeFormat('zh-TW', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));
};

const formatError = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
};

const getRecoveryStatusFromError = (error: unknown): WorkspaceArchiveRecoveryStatus | undefined => {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const candidate = error as { recoveryStatus?: WorkspaceArchiveRecoveryStatus };
  return candidate.recoveryStatus;
};

const getImportIdFromError = (error: unknown): string | undefined => {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const candidate = error as { importId?: unknown };
  return typeof candidate.importId === 'string' ? candidate.importId : undefined;
};

const getStorageManager = (): BrowserStorageManager | null => {
  if (typeof navigator === 'undefined') {
    return null;
  }
  const storage = (navigator as { storage?: BrowserStorageManager }).storage;
  return storage ?? null;
};

const WorkspaceDataManagement: React.FC<WorkspaceDataManagementProps> = ({
  onImported,
  className,
}) => {
  const headingId = useId();
  const importHeadingId = useId();
  const exportHeadingId = useId();
  const recoveryHeadingId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>('準備工作區備份…');
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [metadata, setMetadata] = useState<WorkspaceArchiveMetadata | null>(null);
  const [recoveryItems, setRecoveryItems] = useState<WorkspaceArchiveRecoveryStatus[]>([]);
  const [exportPreview, setExportPreview] = useState<WorkspaceArchivePreview | null>(null);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [storageSnapshot, setStorageSnapshot] = useState<StorageSnapshot>({
    usage: null,
    quota: null,
    persisted: null,
  });

  const refreshArchiveState = useCallback(async (): Promise<void> => {
    const [nextMetadata, nextRecoveryItems] = await Promise.all([
      getWorkspaceArchiveMetadata(),
      listWorkspaceImportRecovery(),
    ]);
    setMetadata(nextMetadata);
    setRecoveryItems(
      nextRecoveryItems.length > 0 ? nextRecoveryItems : nextMetadata.recoveryStatus,
    );
  }, []);

  useEffect(() => {
    let active = true;
    const initialize = async (): Promise<void> => {
      try {
        await prepareWorkspaceArchive();
        const [nextMetadata, nextRecoveryItems] = await Promise.all([
          getWorkspaceArchiveMetadata(),
          listWorkspaceImportRecovery(),
        ]);
        if (!active) {
          return;
        }
        setMetadata(nextMetadata);
        setRecoveryItems(
          nextRecoveryItems.length > 0 ? nextRecoveryItems : nextMetadata.recoveryStatus,
        );
      } catch (error) {
        if (active) {
          setErrorMessage(`工作區備份準備失敗：${formatError(error, '請稍後重試。')}`);
        }
      } finally {
        if (active) {
          setBusyAction(null);
        }
      }
    };
    void initialize();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const loadStorageStatus = async (): Promise<void> => {
      const storage = getStorageManager();
      if (!storage) {
        return;
      }

      let usage: number | null = null;
      let quota: number | null = null;
      let persisted: boolean | null = null;
      try {
        const estimate = await storage.estimate();
        usage = typeof estimate.usage === 'number' ? estimate.usage : null;
        quota = typeof estimate.quota === 'number' ? estimate.quota : null;
      } catch {
        // Storage estimates are optional browser information.
      }
      try {
        if (typeof storage.persisted === 'function') {
          persisted = await storage.persisted();
        }
      } catch {
        // A browser may expose storage but decline to report its persistence state.
      }
      if (active) {
        setStorageSnapshot({ usage, quota, persisted });
      }
    };
    void loadStorageStatus();

    return () => {
      active = false;
    };
  }, []);

  const runWithBusy = async <T,>(label: string, operation: () => Promise<T>): Promise<T | null> => {
    if (busyAction) {
      return null;
    }
    setBusyAction(label);
    setErrorMessage('');
    try {
      return await operation();
    } finally {
      setBusyAction(null);
    }
  };

  const handleRequestPersistence = async (): Promise<void> => {
    const storage = getStorageManager();
    const persist = storage?.persist;
    if (!persist) {
      setStatusMessage('此瀏覽器不提供持久儲存請求；現有資料不會因此被刪除。');
      return;
    }

    await runWithBusy('請求持久儲存…', async () => {
      try {
        const accepted = await persist.call(storage);
        let persisted = accepted;
        if (typeof storage.persisted === 'function') {
          try {
            persisted = await storage.persisted();
          } catch {
            // Keep the explicit request result when the follow-up probe is unavailable.
          }
        }
        setStorageSnapshot(current => ({ ...current, persisted }));
        setStatusMessage(
          accepted ? '瀏覽器已允許持久儲存。' : '瀏覽器拒絕持久儲存請求；現有資料不會被刪除。',
        );
      } catch (error) {
        setErrorMessage(`無法請求持久儲存：${formatError(error, '瀏覽器未提供結果。')}`);
      }
    });
  };

  const handleExport = async (): Promise<void> => {
    await runWithBusy('匯出工作區備份…', async () => {
      try {
        await prepareWorkspaceArchive();
        const result = await exportWorkspaceArchive();
        const objectUrl = URL.createObjectURL(result.blob);
        try {
          const link = document.createElement('a');
          link.href = objectUrl;
          link.download = result.fileName;
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
        setExportPreview(result.preview);
        setMetadata((current: WorkspaceArchiveMetadata | null) =>
          current
            ? { ...current, lastBackupAt: result.manifest.exportedAt }
            : { lastBackupAt: result.manifest.exportedAt, recoveryStatus: [] },
        );
        setStatusMessage(`備份已匯出：${result.fileName}。`);
      } catch (error) {
        setErrorMessage(`匯出失敗：${formatError(error, '工作區資料未變更。')}`);
      }
    });
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file || busyAction) {
      return;
    }

    setPendingImport(null);
    setStatusMessage('');
    setErrorMessage('');
    if (file.size > WORKSPACE_ARCHIVE_MAX_BYTES) {
      setErrorMessage(
        `匯入檔案超過 ${formatBytes(WORKSPACE_ARCHIVE_MAX_BYTES)} 上限；尚未讀取檔案，原有資料未變更。`,
      );
      return;
    }

    await runWithBusy('讀取並檢查備份…', async () => {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        // Parsing and conflict preview are read-only. Nothing is written until
        // the person confirms the copy import below.
        await parseWorkspaceArchive(bytes);
        const preview = await previewWorkspaceArchive(bytes);
        setPendingImport({ fileName: file.name, bytes, preview });
        setStatusMessage('備份檔已完成檢查，請先閱讀預覽再確認匯入。');
      } catch (error) {
        setErrorMessage(`無法預覽備份：${formatError(error, '檔案格式不受支援。')}`);
      }
    });
  };

  const handleConfirmImport = async (): Promise<void> => {
    if (!pendingImport) {
      return;
    }
    const importToApply = pendingImport;
    await runWithBusy('以副本匯入工作區…', async () => {
      try {
        await prepareWorkspaceArchive();
        const result = await importWorkspaceArchive(importToApply.bytes, {
          ...workspaceArchiveImportOptions,
          copy: true,
        });
        setPendingImport(null);
        await onImported?.();
        await refreshArchiveState();
        setStatusMessage(buildImportSuccessMessage(result));
      } catch (error) {
        const importId = getImportIdFromError(error);
        const recoveryStatus = getRecoveryStatusFromError(error);
        try {
          await refreshArchiveState();
        } catch {
          // Preserve the original import failure when the recovery list is unavailable.
        }
        if (recoveryStatus) {
          setRecoveryItems(current => [
            ...current.filter(item => item.importId !== recoveryStatus.importId),
            recoveryStatus,
          ]);
        }
        const recoverySuffix =
          recoveryStatus?.resumable || recoveryStatus?.rollbackAvailable
            ? '；請在下方復原。'
            : '。';
        setErrorMessage(
          `匯入失敗：${formatError(error, '原有資料未變更。')}${
            importId ? ` 匯入編號：${importId}${recoverySuffix}` : ''
          }`,
        );
      }
    });
  };

  const handleCancelImport = (): void => {
    if (busyAction) {
      return;
    }
    setPendingImport(null);
    setErrorMessage('');
    setStatusMessage('已取消匯入；原有資料未變更。');
  };

  const handleRecovery = async (action: 'resume' | 'rollback', importId: string): Promise<void> => {
    await runWithBusy(action === 'resume' ? '繼續匯入…' : '回復匯入…', async () => {
      try {
        await prepareWorkspaceArchive();
        if (action === 'resume') {
          await resumeWorkspaceImport(importId, workspaceArchiveImportOptions);
        } else {
          await rollbackWorkspaceImport(importId, workspaceArchiveImportOptions);
        }
        await refreshArchiveState();
        await onImported?.();
        setStatusMessage(
          action === 'resume'
            ? `匯入 ${importId} 已繼續完成。`
            : `匯入 ${importId} 已回復；原有資料保留。`,
        );
      } catch (error) {
        setErrorMessage(
          `${action === 'resume' ? '繼續匯入' : '回復匯入'}失敗：${formatError(
            error,
            '請保留備份並稍後重試。',
          )}（匯入編號：${importId}）`,
        );
        try {
          await refreshArchiveState();
        } catch {
          // Keep the exact recovery action failure visible.
        }
      }
    });
  };

  const isBusy = busyAction !== null;
  const storagePersistedLabel =
    storageSnapshot.persisted === true
      ? '已允許持久儲存'
      : storageSnapshot.persisted === false
        ? '尚未允許持久儲存'
        : '尚無法確認持久儲存狀態';

  return (
    <section
      className={`mx-auto w-full max-w-5xl rounded-2xl border border-gray-800 bg-gray-900/70 p-4 text-gray-100 shadow-xl shadow-black/20 sm:p-6 ${className ?? ''}`}
      data-testid='workspace-data-management'
      aria-labelledby={headingId}
    >
      <header className='flex flex-wrap items-start justify-between gap-4 border-b border-gray-800 pb-5'>
        <div>
          <p className='text-xs font-bold uppercase tracking-[0.16em] text-cyan-300'>
            F1 · 資料管理
          </p>
          <h2 id={headingId} className='mt-1 text-2xl font-semibold text-white'>
            工作區備份與還原
          </h2>
          <p className='mt-2 max-w-3xl text-sm leading-6 text-gray-400'>
            將工作區資料匯出成可攜式備份，或先預覽後以副本匯入。所有操作都由你明確確認，取消不會改動現有資料。
          </p>
        </div>
        <span className='rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-200'>
          本機工作區
        </span>
      </header>

      <div className='mt-5 grid gap-4 md:grid-cols-2'>
        <section
          className='rounded-xl border border-gray-800 bg-gray-950/40 p-4'
          aria-labelledby='storage-heading'
        >
          <div className='flex items-start justify-between gap-3'>
            <div>
              <h3 id='storage-heading' className='text-base font-semibold text-white'>
                儲存空間
              </h3>
              <p className='mt-1 text-sm text-gray-400'>
                {formatBytes(storageSnapshot.usage)} / {formatBytes(storageSnapshot.quota)}{' '}
                已使用（瀏覽器估算）
              </p>
            </div>
            <span
              className='rounded-full border border-gray-700 px-2 py-1 text-xs text-gray-300'
              data-testid='storage-persisted-status'
            >
              {storagePersistedLabel}
            </span>
          </div>
          <p className='mt-3 text-xs leading-5 text-gray-500'>
            持久儲存可降低瀏覽器清理本機資料的機會，但是否允許由瀏覽器決定。EduCare
            不會因請求被拒絕而刪除資料。
          </p>
          <button
            type='button'
            className='mt-4 rounded-lg border border-gray-600 px-3 py-2 text-sm font-semibold text-gray-200 transition hover:border-cyan-400 hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:cursor-not-allowed disabled:opacity-50'
            onClick={() => void handleRequestPersistence()}
            disabled={isBusy}
          >
            請求持久儲存
          </button>
        </section>

        <section
          className='rounded-xl border border-gray-800 bg-gray-950/40 p-4'
          aria-labelledby='backup-date-heading'
        >
          <h3 id='backup-date-heading' className='text-base font-semibold text-white'>
            備份狀態
          </h3>
          <p className='mt-1 text-sm text-gray-400'>最近一次備份</p>
          <p className='mt-1 text-lg font-semibold text-cyan-200' data-testid='last-backup-date'>
            {formatDate(metadata?.lastBackupAt)}
          </p>
          <p className='mt-2 text-xs leading-5 text-gray-500'>
            日期只代表本機曾完成匯出；請把下載的檔案放在你信任的位置。
          </p>
        </section>
      </div>

      <section
        className='mt-4 rounded-xl border border-amber-700/50 bg-amber-950/20 p-4'
        aria-labelledby='privacy-heading'
      >
        <h3 id='privacy-heading' className='text-base font-semibold text-amber-100'>
          備份範圍與隱私提醒
        </h3>
        <ul className='mt-2 space-y-2 text-sm leading-6 text-amber-100/80'>
          <li>備份只在本機產生，不會透過此面板上傳到服務商。</li>
          <li>服務商設定、API 金鑰、密碼、權杖與其他敏感欄位會被排除，不會隨備份移轉。</li>
          <li>遙測與使用指標不在工作區備份範圍內。</li>
          <li>若工作區只有解析後的文字，原始 PDF/DOCX 檔案不會出現在備份中。</li>
        </ul>
      </section>

      <div className='mt-5 grid gap-4 lg:grid-cols-2'>
        <section
          className='rounded-xl border border-gray-800 bg-gray-950/40 p-4'
          aria-labelledby={exportHeadingId}
        >
          <h3 id={exportHeadingId} className='text-base font-semibold text-white'>
            匯出工作區
          </h3>
          <p className='mt-1 text-sm leading-6 text-gray-400'>
            匯出前會準備已註冊的工作區資料來源，完成後瀏覽器會下載 ZIP 備份檔。
          </p>
          <button
            type='button'
            className='mt-4 rounded-lg bg-cyan-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-cyan-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:cursor-not-allowed disabled:opacity-50'
            onClick={() => void handleExport()}
            disabled={isBusy}
          >
            {busyAction === '匯出工作區備份…' ? '匯出中…' : '匯出工作區備份'}
          </button>
        </section>

        <section
          className='rounded-xl border border-gray-800 bg-gray-950/40 p-4'
          aria-labelledby={importHeadingId}
        >
          <h3 id={importHeadingId} className='text-base font-semibold text-white'>
            匯入工作區副本
          </h3>
          <p className='mt-1 text-sm leading-6 text-gray-400'>
            先讀取檔案並顯示資料預覽，確認後才會寫入。匯入一律建立副本，不覆蓋原資料。
          </p>
          <input
            ref={fileInputRef}
            type='file'
            accept='application/zip,.zip,application/json,.json'
            className='sr-only'
            aria-label='選擇 EduCare 工作區備份檔'
            onChange={event => void handleFileChange(event)}
            disabled={isBusy}
          />
          <button
            type='button'
            className='mt-4 rounded-lg border border-gray-600 px-4 py-2.5 text-sm font-semibold text-gray-200 transition hover:border-cyan-400 hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:cursor-not-allowed disabled:opacity-50'
            onClick={() => fileInputRef.current?.click()}
            disabled={isBusy}
          >
            選擇工作區備份檔
          </button>
          <p className='mt-3 text-xs text-gray-500'>
            檔案上限：{formatBytes(WORKSPACE_ARCHIVE_MAX_BYTES)}；最多{' '}
            {WORKSPACE_ARCHIVE_MAX_ENTRIES.toLocaleString('zh-TW')} 個 ZIP 項目。
          </p>
        </section>
      </div>

      {exportPreview && (
        <PreviewSummary
          heading='最近一次匯出摘要'
          preview={exportPreview}
          testId='workspace-export-preview'
          mode='export'
        />
      )}

      {pendingImport && (
        <section
          className='mt-5 rounded-xl border border-cyan-500/40 bg-cyan-950/20 p-4'
          data-testid='workspace-import-preview'
          aria-labelledby='workspace-import-preview-heading'
        >
          <div className='flex flex-wrap items-start justify-between gap-3'>
            <div>
              <p className='text-xs font-semibold uppercase tracking-[0.12em] text-cyan-300'>
                匯入前預覽
              </p>
              <h3
                id='workspace-import-preview-heading'
                className='mt-1 text-lg font-semibold text-white'
              >
                {pendingImport.fileName}
              </h3>
            </div>
            <span className='rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-200'>
              來源不受信任
            </span>
          </div>
          <p className='mt-3 rounded-lg border border-amber-700/60 bg-amber-950/30 p-3 text-sm leading-6 text-amber-100'>
            備份可能包含私人聊天、教材與助理內容。只在你信任的來源與裝置上匯入；檔案不會送往外部服務，確認後仍只會建立副本。
          </p>
          <PreviewSummary heading='備份內容' preview={pendingImport.preview} mode='import' />
          <div className='mt-4 flex flex-wrap gap-2'>
            <button
              type='button'
              className='rounded-lg bg-cyan-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-cyan-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:cursor-not-allowed disabled:opacity-50'
              onClick={() => void handleConfirmImport()}
              disabled={isBusy}
            >
              確認以副本匯入
            </button>
            <button
              type='button'
              className='rounded-lg border border-gray-600 px-4 py-2.5 text-sm font-semibold text-gray-200 transition hover:border-gray-400 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300 disabled:cursor-not-allowed disabled:opacity-50'
              onClick={handleCancelImport}
              disabled={isBusy}
            >
              取消匯入
            </button>
          </div>
        </section>
      )}

      <section
        className='mt-5 rounded-xl border border-gray-800 bg-gray-950/40 p-4'
        aria-labelledby={recoveryHeadingId}
      >
        <h3 id={recoveryHeadingId} className='text-base font-semibold text-white'>
          可復原的匯入
        </h3>
        {recoveryItems.length === 0 ? (
          <p className='mt-2 text-sm text-gray-500'>目前沒有需要復原的匯入紀錄。</p>
        ) : (
          <ul className='mt-3 space-y-3'>
            {recoveryItems.map(item => (
              <li
                key={item.importId}
                className='rounded-lg border border-amber-700/50 bg-amber-950/20 p-3'
                data-testid={`workspace-recovery-${item.importId}`}
              >
                <div className='flex flex-wrap items-start justify-between gap-3'>
                  <div>
                    <p className='text-sm font-semibold text-amber-100'>匯入 {item.importId}</p>
                    <p className='mt-1 text-xs text-amber-100/70'>
                      狀態：{item.state} · {item.hidden ? '尚未公開' : '已公開'}
                    </p>
                    {item.error && <p className='mt-1 text-xs text-rose-200'>{item.error}</p>}
                  </div>
                  <div className='flex flex-wrap gap-2'>
                    {item.resumable && (
                      <button
                        type='button'
                        className='rounded-md border border-cyan-500/50 px-3 py-1.5 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:cursor-not-allowed disabled:opacity-50'
                        onClick={() => void handleRecovery('resume', item.importId)}
                        disabled={isBusy}
                        aria-label={`繼續匯入 ${item.importId}`}
                      >
                        繼續匯入
                      </button>
                    )}
                    {item.rollbackAvailable && (
                      <button
                        type='button'
                        className='rounded-md border border-rose-500/50 px-3 py-1.5 text-xs font-semibold text-rose-200 transition hover:bg-rose-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 disabled:cursor-not-allowed disabled:opacity-50'
                        onClick={() => void handleRecovery('rollback', item.importId)}
                        disabled={isBusy}
                        aria-label={`回復並清理匯入 ${item.importId}`}
                      >
                        回復並清理
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className='mt-4 min-h-6'>
        <p className='text-sm text-cyan-200' role='status' aria-live='polite'>
          {busyAction ?? statusMessage}
        </p>
        {errorMessage && (
          <p
            className='mt-2 rounded-lg border border-rose-700/60 bg-rose-950/30 p-3 text-sm leading-6 text-rose-100'
            role='alert'
            aria-live='assertive'
          >
            {errorMessage}
          </p>
        )}
      </div>
    </section>
  );
};

const buildImportSuccessMessage = (result: WorkspaceArchiveImportResult): string => {
  const createdCount = Object.values(result.created).reduce<number>(
    (total, count) => total + (typeof count === 'number' ? count : 0),
    0,
  );
  return `匯入完成：新增 ${createdCount.toLocaleString('zh-TW')} 筆資料（以副本建立，不覆蓋原資料）。`;
};

interface PreviewSummaryProps {
  heading: string;
  preview: WorkspaceArchivePreview;
  mode: 'export' | 'import';
  testId?: string;
}

const PreviewSummary: React.FC<PreviewSummaryProps> = ({ heading, preview, mode, testId }) => (
  <section
    className='mt-5 rounded-xl border border-gray-800 bg-gray-950/40 p-4'
    data-testid={testId}
    aria-label={heading}
  >
    <h3 className='text-base font-semibold text-white'>{heading}</h3>
    <div className='mt-3 grid gap-2 text-sm text-gray-300 sm:grid-cols-3'>
      <p>
        未壓縮大小：
        <span className='font-semibold text-cyan-200'>
          {formatBytes(preview.totalUncompressedBytes)}
        </span>
      </p>
      <p>
        ZIP 項目：
        <span className='font-semibold text-cyan-200'>
          {preview.totalEntries.toLocaleString('zh-TW')}
        </span>
      </p>
      <p>
        匯出時間：
        <span className='font-semibold text-cyan-200'>{formatDate(preview.exportedAt)}</span>
      </p>
    </div>
    {mode === 'import' && (
      <p className='mt-3 text-sm text-amber-200'>
        同 ID 衝突：
        <span className='font-semibold'>
          {Object.values(preview.conflictCounts)
            .reduce<number>((total, count) => total + (count ?? 0), 0)
            .toLocaleString('zh-TW')}{' '}
          筆
        </span>
        。確認後會建立新 ID 副本。
      </p>
    )}

    <ul className='mt-3 grid gap-2 sm:grid-cols-2'>
      {preview.categories.map((category: WorkspaceArchivePreview['categories'][number]) => {
        const conflictCount = preview.conflictCounts[category.category] ?? 0;
        return (
          <li
            key={category.category}
            className='rounded-lg border border-gray-800 px-3 py-2 text-xs text-gray-300'
          >
            <div className='flex items-center justify-between gap-3'>
              <span className='font-semibold text-gray-100'>
                {CATEGORY_LABELS[category.category] ?? category.category}
              </span>
              <span className={category.included ? 'text-emerald-300' : 'text-gray-500'}>
                {category.included ? '已包含' : '未包含'}
              </span>
            </div>
            <p className='mt-1 text-gray-400'>
              {category.recordCount.toLocaleString('zh-TW')} 筆 · {formatBytes(category.byteCount)}
              {conflictCount > 0 ? ` · 同 ID ${conflictCount.toLocaleString('zh-TW')} 筆` : ''}
            </p>
            {!category.included && category.reason && (
              <p className='mt-1 text-gray-500'>原因：{category.reason}</p>
            )}
          </li>
        );
      })}
    </ul>

    {preview.warnings.length > 0 && (
      <div className='mt-4 rounded-lg border border-amber-700/50 bg-amber-950/20 p-3'>
        <h4 className='text-sm font-semibold text-amber-100'>提醒</h4>
        <ul className='mt-1 list-disc space-y-1 pl-5 text-xs leading-5 text-amber-100/80'>
          {preview.warnings.map((warning: string) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      </div>
    )}

    {mode === 'import' && Object.keys(preview.conflictCounts).length > 0 && (
      <p className='mt-3 text-xs leading-5 text-amber-200'>
        預覽發現同 ID 資料；確認後仍會使用新 ID 建立副本，不會覆蓋原資料。
      </p>
    )}

    <div className='mt-4 grid gap-4 border-t border-gray-800 pt-3 text-xs text-gray-400 sm:grid-cols-2'>
      <div>
        <h4 className='font-semibold text-gray-200'>永不匯出的欄位</h4>
        <ul className='mt-1 space-y-1'>
          {preview.excludedFields.map((field: string) => (
            <li key={field}>{field}</li>
          ))}
        </ul>
      </div>
      <div>
        <h4 className='font-semibold text-gray-200'>排除的儲存區</h4>
        <ul className='mt-1 space-y-1'>
          {preview.excludedStores.map((store: string) => (
            <li key={store}>{EXCLUDED_STORE_LABELS[store] ?? store}</li>
          ))}
        </ul>
      </div>
    </div>
  </section>
);

export { WorkspaceDataManagement };
export default WorkspaceDataManagement;
