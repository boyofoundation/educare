import React, { useEffect, useId, useState } from 'react';
import {
  loadOpenJevExperimentPreferences,
  saveOpenJevExperimentPreferences,
  saveOpenJevExperimentPreferencesAsync,
  OPEN_JEV_EXPERIMENT_PREFERENCES_CHANGED_EVENT,
  type OpenJevExperimentPreferences,
} from '../../services/openJevExperimentPreferences';
import {
  disposeOpenJevModel,
  getOpenJevModelInfo,
  getOpenJevModelSnapshot,
  loadOpenJevModel,
  subscribeOpenJevModelStatus,
  type OpenJevModelSnapshot,
} from '../../services/openJevDecisionService';

export interface OpenJevExperimentSettingsProps {
  className?: string;
}

const formatBytes = (bytes: number | null | undefined): string => {
  if (!bytes || bytes <= 0) {
    return '大小待確認';
  }
  if (bytes >= 1024 ** 3) {
    return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  }
  return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
};

const STATUS_LABELS: Record<OpenJevModelSnapshot['status'], string> = {
  idle: '尚未載入',
  checking: '檢查 WebGPU…',
  loading: '正在載入模型…',
  ready: '模型已就緒',
  deciding: '模型判斷中…',
  unsupported: '此瀏覽器不支援',
  error: '載入失敗，可重試',
};

const OpenJevExperimentSettings: React.FC<OpenJevExperimentSettingsProps> = ({ className }) => {
  const [preferences, setPreferences] = useState<OpenJevExperimentPreferences>(() =>
    loadOpenJevExperimentPreferences(),
  );
  const [snapshot, setSnapshot] = useState<OpenJevModelSnapshot>(() => getOpenJevModelSnapshot());
  const [statusMessage, setStatusMessage] = useState('');
  const headingId = useId();
  const descriptionId = useId();

  useEffect(() => subscribeOpenJevModelStatus(setSnapshot), []);

  useEffect(() => {
    const refreshPreferences = () => setPreferences(loadOpenJevExperimentPreferences());
    window.addEventListener(OPEN_JEV_EXPERIMENT_PREFERENCES_CHANGED_EVENT, refreshPreferences);
    return () =>
      window.removeEventListener(OPEN_JEV_EXPERIMENT_PREFERENCES_CHANGED_EVENT, refreshPreferences);
  }, []);

  useEffect(() => {
    if (!preferences.enabled || snapshot.info || snapshot.status !== 'idle') {
      return;
    }

    void getOpenJevModelInfo().catch(() => undefined);
  }, [preferences.enabled, snapshot.info, snapshot.status]);

  const updateEnabled = async (enabled: boolean) => {
    const nextPreferences = { ...preferences, enabled };
    setPreferences(nextPreferences);
    setStatusMessage('');

    // Update localStorage synchronously so a chat submitted immediately after
    // the toggle observes the new run setting; the async write still participates
    // in the workspace write barrier.
    let persisted = saveOpenJevExperimentPreferences(nextPreferences);
    try {
      persisted = (await saveOpenJevExperimentPreferencesAsync(nextPreferences)) && persisted;
    } catch {
      persisted = false;
    }
    window.dispatchEvent(new Event(OPEN_JEV_EXPERIMENT_PREFERENCES_CHANGED_EVENT));

    if (!enabled) {
      await disposeOpenJevModel();
    }

    setStatusMessage(
      persisted
        ? enabled
          ? '實驗功能已啟用；符合條件的 agent 回合會使用本地 router。'
          : '實驗功能已關閉，並已釋放本地模型。'
        : '設定已套用，但瀏覽器未允許保存偏好。',
    );
  };

  const handleLoad = async () => {
    if (!preferences.enabled || snapshot.status === 'loading' || snapshot.status === 'ready') {
      return;
    }

    setStatusMessage('模型只會在本機瀏覽器執行；首次載入可能需要下載數百 MB。');
    try {
      await loadOpenJevModel();
      setStatusMessage('模型已載入，之後符合條件的 agent 回合可使用實驗 router。');
    } catch {
      setStatusMessage('模型載入失敗；現有 agent 路由仍會安全回退。');
    }
  };

  const progress = snapshot.progress === null ? null : Math.round(snapshot.progress * 100);
  const runtimeLabel = snapshot.runtime
    ? `${snapshot.runtime.device} / ${snapshot.runtime.dtype}`
    : '尚未決定';

  return (
    <section
      className={`ui-panel rounded-2xl p-5${className ? ` ${className}` : ''}`}
      data-testid='open-jev-experiment-settings'
      aria-labelledby={headingId}
      aria-describedby={descriptionId}
    >
      <div className='flex items-start justify-between gap-4'>
        <div>
          <p className='text-xs font-semibold uppercase tracking-wide text-cyan-300'>實驗功能</p>
          <h2 id={headingId} className='mt-1 text-lg font-semibold text-white'>
            本地 HTML 意圖 router
          </h2>
          <p id={descriptionId} className='mt-2 text-sm leading-6 text-gray-400'>
            啟用後，瀏覽器會用 open-jev 的 kev-0.6b 協助判斷 HTML 專案路徑，再交給現有的 agent
            工具流程。預設關閉；模型不會取代你選用的 AI 服務商。
          </p>
        </div>
        <span className='rounded-full bg-cyan-500/10 px-2.5 py-1 text-xs text-cyan-200'>
          opt-in
        </span>
      </div>

      <label className='mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4'>
        <input
          type='checkbox'
          checked={preferences.enabled}
          onChange={event => void updateEnabled(event.target.checked)}
          className='mt-1 h-4 w-4 accent-cyan-400'
          data-testid='open-jev-experiment-enabled'
        />
        <span>
          <span className='block font-medium text-white'>啟用本地實驗判斷</span>
          <span className='mt-1 block text-sm leading-5 text-gray-400'>
            只有開啟此項且模型能在 WebGPU 執行時，才會影響 HTML 工具 pack；低信心或失敗會保留原本的
            deterministic 路由。
          </span>
        </span>
      </label>

      {preferences.enabled && (
        <div className='mt-4 rounded-xl border border-cyan-400/15 bg-cyan-400/[0.04] p-4'>
          <div className='flex flex-wrap items-center justify-between gap-3'>
            <div>
              <p className='text-sm font-medium text-white'>{STATUS_LABELS[snapshot.status]}</p>
              <p className='mt-1 text-xs text-gray-400'>執行環境：{runtimeLabel}</p>
            </div>
            <button
              type='button'
              onClick={() => void handleLoad()}
              disabled={snapshot.status === 'loading' || snapshot.status === 'ready'}
              className='ui-control min-h-10 rounded-lg px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50'
              data-testid='open-jev-load-model'
            >
              {snapshot.status === 'ready' ? '已載入' : '載入實驗模型'}
            </button>
          </div>

          {snapshot.status === 'loading' && progress !== null && (
            <div className='mt-3' aria-label={`模型下載進度 ${progress}%`}>
              <div className='h-2 overflow-hidden rounded-full bg-black/30'>
                <div
                  className='h-full rounded-full bg-cyan-400 transition-[width]'
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className='mt-1 text-right text-xs text-gray-400'>{progress}%</p>
            </div>
          )}

          {snapshot.info && (
            <p className='mt-3 text-xs leading-5 text-gray-400'>
              模型：kev-0.6b · 預估下載：{formatBytes(snapshot.info.downloadSize)} ·{' '}
              {snapshot.info.isCached ? '已在瀏覽器快取' : '尚未完整快取'} · 需要 WebGPU
            </p>
          )}

          {snapshot.error && (
            <p className='mt-3 text-sm text-amber-200' role='alert'>
              {snapshot.error}
            </p>
          )}
        </div>
      )}

      <p className='mt-4 min-h-5 text-sm text-gray-300' role='status' aria-live='polite'>
        {statusMessage}
      </p>
    </section>
  );
};

export { OpenJevExperimentSettings };
export default OpenJevExperimentSettings;
