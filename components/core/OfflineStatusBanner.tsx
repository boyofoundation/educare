import React, { useState, useSyncExternalStore } from 'react';
import {
  activateOfflineUpdate,
  checkOfflineUpdate,
  getOfflineState,
  subscribeOfflineState,
} from '../../services/offlineService';

export function OfflineStatusBanner() {
  const state = useSyncExternalStore(subscribeOfflineState, getOfflineState, getOfflineState);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  if (state.phase === 'idle') {
    return null;
  }

  const run = async (action: () => Promise<void>, success: string) => {
    setBusy(true);
    setNotice('');
    try {
      await action();
      setNotice(success);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '離線操作失敗，請稍後重試。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className='max-h-[40dvh] shrink-0 overflow-y-auto border-b border-[var(--border-default)] bg-[var(--surface-raised)] px-4 py-2 text-sm text-[var(--text-primary)]'>
      <summary className='cursor-pointer' aria-label='離線與版本狀態'>
        <span role='status' aria-live='polite'>
          {!state.online ? '目前離線 · ' : ''}
          {state.updateAvailable
            ? '新版已下載，等待您保存後更新'
            : state.ready
              ? '離線已準備'
              : state.phase === 'preparing'
                ? `離線準備中 ${state.completed}/${state.total || '…'}`
                : '離線尚未準備完成'}
        </span>
      </summary>
      <div className='mt-2 space-y-2'>
        <p>
          已準備後可重開本機資料、查找、草稿、檔案交換及自足作品。雲端 AI、外部圖片／CDN
          與部分語音仍需網路；恢復連線不會自動重送訊息。
        </p>
        <p>
          離線快取不是資料備份，清除網站資料可能刪除教學內容。舊版快取會保留，避免其他分頁的延遲載入失敗。
        </p>
        {state.error && <p role='alert'>{state.error}</p>}
        <div className='flex flex-wrap gap-2'>
          <button
            type='button'
            className='min-h-11 rounded border px-3'
            disabled={busy || !state.online}
            onClick={() => void run(checkOfflineUpdate, '已檢查離線準備與更新。')}
          >
            檢查離線準備
          </button>
          {state.updateAvailable && (
            <button
              type='button'
              className='min-h-11 rounded border px-3'
              disabled={busy}
              onClick={() =>
                void run(
                  activateOfflineUpdate,
                  '更新已啟用；確認內容已保存後，可自行重新整理頁面。',
                )
              }
            >
              已保存，套用更新
            </button>
          )}
        </div>
        {notice && <p role='status'>{notice}</p>}
      </div>
    </details>
  );
}
