import React, { useCallback, useMemo, useState } from 'react';
import {
  AGENT_BUNDLE_LARGE_FILE_BYTES,
  buildAgentBundle,
  downloadBundleJson,
  estimateBundleSize,
  validateBundle,
} from '../../services/agentBundleService';
import type { AgentBundle, AgentBundleRoute, Assistant } from '../../types';

export interface BundleBuilderProps {
  assistants: Assistant[];
  onClose: () => void;
  onPreviewBundle: (bundle: AgentBundle) => void;
}

interface BundleMetadata {
  name: string;
  description: string;
  version: string;
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

const knowledgeChars = (assistant: Assistant): number =>
  (assistant.ragChunks ?? []).reduce((sum, chunk) => sum + chunk.content.length, 0);

const routeKey = (from: string, to: string): string => `${from}>${to}`;

const BundleBuilder: React.FC<BundleBuilderProps> = ({ assistants, onClose, onPreviewBundle }) => {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [entryAgentId, setEntryAgentId] = useState<string | null>(null);
  const [routes, setRoutes] = useState<AgentBundleRoute[]>([]);
  const [metadata, setMetadata] = useState<BundleMetadata>({
    name: '',
    description: '',
    version: '1.0.0',
  });
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [routesSeeded, setRoutesSeeded] = useState(false);

  const sortedAssistants = useMemo(
    () => [...assistants].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant')),
    [assistants],
  );

  const selectedAssistants = useMemo(
    () => sortedAssistants.filter(assistant => selectedIds.has(assistant.id)),
    [selectedIds, sortedAssistants],
  );

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const seedRoutesFromWhitelists = useCallback(() => {
    if (routesSeeded) {
      return;
    }
    setRoutesSeeded(true);
    const seeded: AgentBundleRoute[] = [];
    for (const source of selectedAssistants) {
      for (const targetId of source.routableAssistantIds ?? []) {
        if (targetId === source.id) {
          continue;
        }
        if (
          selectedIds.has(targetId) &&
          !seeded.some(r => routeKey(r.fromAgentId, r.toAgentId) === routeKey(source.id, targetId))
        ) {
          seeded.push({ fromAgentId: source.id, toAgentId: targetId });
        }
      }
    }
    if (seeded.length > 0) {
      setRoutes(seeded);
    }
  }, [routesSeeded, selectedAssistants, selectedIds]);

  const goToStep = useCallback(
    (target: 1 | 2 | 3) => {
      if (target >= 2) {
        seedRoutesFromWhitelists();
      }
      setStep(target);
    },
    [seedRoutesFromWhitelists],
  );

  const toggleRoute = useCallback((from: string, to: string) => {
    setRoutes(prev => {
      const key = routeKey(from, to);
      if (prev.some(r => routeKey(r.fromAgentId, r.toAgentId) === key)) {
        return prev.filter(r => routeKey(r.fromAgentId, r.toAgentId) !== key);
      }
      return [...prev, { fromAgentId: from, toAgentId: to }];
    });
  }, []);

  const setRouteCondition = useCallback((from: string, to: string, condition: string) => {
    setRoutes(prev =>
      prev.map(r =>
        routeKey(r.fromAgentId, r.toAgentId) === routeKey(from, to)
          ? { ...r, condition: condition.trim() === '' ? undefined : condition.trim() }
          : r,
      ),
    );
  }, []);

  const bundle = useMemo<AgentBundle | null>(() => {
    if (selectedAssistants.length < 2 || !entryAgentId) {
      return null;
    }
    return buildAgentBundle(selectedAssistants, entryAgentId, routes, metadata);
  }, [selectedAssistants, entryAgentId, routes, metadata]);

  const validation = useMemo(() => (bundle ? validateBundle(bundle) : null), [bundle]);
  const sizeBytes = useMemo(() => (bundle ? estimateBundleSize(bundle) : 0), [bundle]);
  const largeBundle = sizeBytes >= AGENT_BUNDLE_LARGE_FILE_BYTES;
  const stepOneValid = selectedAssistants.length >= 2;
  const stepTwoValid = Boolean(entryAgentId) && selectedAssistants.length >= 2;
  const hasErrors = (validation?.errors.length ?? 0) > 0;
  const metadataValid = metadata.name.trim().length > 0;
  const canExport = Boolean(bundle) && !hasErrors && metadataValid;

  const handleExport = useCallback(() => {
    if (!bundle || hasErrors || !metadataValid) {
      return;
    }
    downloadBundleJson(bundle);
  }, [bundle, hasErrors, metadataValid]);

  const handlePreview = useCallback(() => {
    if (!bundle || hasErrors) {
      return;
    }
    onPreviewBundle(bundle);
  }, [bundle, hasErrors, onPreviewBundle]);

  return (
    <div className='h-full overflow-y-auto bg-gray-900'>
      <div className='mx-auto max-w-3xl p-6 md:p-8'>
        <div className='mb-6 flex items-start justify-between gap-4'>
          <div>
            <h2 className='mb-1.5 text-2xl font-bold text-white md:text-3xl'>打包協作包</h2>
            <p className='text-sm text-gray-400'>
              選取多個助理、設定接待入口與路由，匯出為單一 JSON 協作包。
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

        <ol className='mb-6 flex gap-2 text-xs text-gray-400' aria-label='打包步驟'>
          <li className={step === 1 ? 'text-cyan-300' : ''}>1. 選擇助理</li>
          <li>→</li>
          <li className={step === 2 ? 'text-cyan-300' : ''}>2. 入口與路由</li>
          <li>→</li>
          <li className={step === 3 ? 'text-cyan-300' : ''}>3. 元數據與匯出</li>
        </ol>

        {step === 1 && (
          <section aria-label='助理選擇' className='space-y-3'>
            <div className='flex items-center justify-between text-sm text-gray-400'>
              <span>已選 {selectedAssistants.length} 個助理（至少 2 個）</span>
              <span>預估體積：{formatBytes(sizeBytes)}</span>
            </div>
            {sortedAssistants.length === 0 ? (
              <p className='text-sm text-gray-500'>尚無助理，請先建立助理後再打包。</p>
            ) : (
              <ul className='space-y-2'>
                {sortedAssistants.map(assistant => {
                  const checked = selectedIds.has(assistant.id);
                  return (
                    <li key={assistant.id}>
                      <label className='flex cursor-pointer items-center gap-3 rounded-xl border border-gray-700/50 bg-gray-800/40 p-3 transition hover:border-gray-600'>
                        <input
                          type='checkbox'
                          checked={checked}
                          onChange={() => toggleSelected(assistant.id)}
                          className='h-4 w-4 rounded border-gray-600 bg-gray-700 text-cyan-500 focus:ring-cyan-500'
                        />
                        <div className='min-w-0 flex-1'>
                          <p className='truncate text-sm font-medium text-gray-100'>
                            {assistant.name}
                          </p>
                          <p className='truncate text-xs text-gray-500'>
                            {(assistant.systemPrompt ?? '').slice(0, 60) || '（無 system prompt）'}
                          </p>
                        </div>
                        <span className='text-xs text-gray-500'>
                          {(assistant.ragChunks ?? []).length} 片段 ·{' '}
                          {formatBytes(knowledgeChars(assistant))}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className='flex justify-end'>
              <button
                type='button'
                onClick={() => goToStep(2)}
                disabled={!stepOneValid}
                className='rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50'
              >
                下一步
              </button>
            </div>
          </section>
        )}

        {step === 2 && (
          <section aria-label='接待入口與路由' className='space-y-4'>
            <div>
              <h3 className='mb-2 text-sm font-semibold uppercase tracking-wide text-gray-400'>
                接待入口（單選）
              </h3>
              <div className='space-y-2'>
                {selectedAssistants.map(assistant => (
                  <label
                    key={assistant.id}
                    className='flex cursor-pointer items-center gap-3 rounded-lg border border-gray-700/50 bg-gray-800/40 p-3'
                  >
                    <input
                      type='radio'
                      name='entry-agent'
                      checked={entryAgentId === assistant.id}
                      onChange={() => setEntryAgentId(assistant.id)}
                      aria-label={`設為接待入口：${assistant.name}`}
                      className='h-4 w-4 border-gray-600 bg-gray-700 text-cyan-500 focus:ring-cyan-500'
                    />
                    <span className='text-sm text-gray-100'>{assistant.name}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <h3 className='mb-2 text-sm font-semibold uppercase tracking-wide text-gray-400'>
                路由矩陣
              </h3>
              <p className='mb-3 text-xs text-gray-500'>
                勾選目的地以建立路由；可為每條路由填寫觸發條件。已依各助理的白名單預填。
              </p>
              <div className='space-y-3'>
                {selectedAssistants.map(source => {
                  const targets = selectedAssistants.filter(a => a.id !== source.id);
                  if (targets.length === 0) {
                    return null;
                  }
                  return (
                    <div
                      key={source.id}
                      className='rounded-lg border border-gray-700/40 bg-gray-800/30 p-3'
                    >
                      <p className='mb-2 text-sm font-medium text-gray-200'>{source.name}</p>
                      <ul className='space-y-2'>
                        {targets.map(target => {
                          const route = routes.find(
                            r => r.fromAgentId === source.id && r.toAgentId === target.id,
                          );
                          const active = Boolean(route);
                          return (
                            <li key={target.id} className='rounded-md bg-gray-900/40 p-2'>
                              <label className='flex items-center gap-2'>
                                <input
                                  type='checkbox'
                                  checked={active}
                                  onChange={() => toggleRoute(source.id, target.id)}
                                  className='h-4 w-4 rounded border-gray-600 bg-gray-700 text-cyan-500 focus:ring-cyan-500'
                                />
                                <span className='text-sm text-gray-300'>→ {target.name}</span>
                              </label>
                              {active && (
                                <input
                                  type='text'
                                  value={route?.condition ?? ''}
                                  onChange={event =>
                                    setRouteCondition(source.id, target.id, event.target.value)
                                  }
                                  placeholder='觸發條件（選填）'
                                  className='mt-2 w-full rounded border border-gray-700 bg-gray-800/70 px-2 py-1 text-xs text-gray-100 focus:border-cyan-500 focus:outline-none'
                                />
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className='flex justify-between'>
              <button
                type='button'
                onClick={() => setStep(1)}
                className='rounded-lg border border-gray-600 px-4 py-2 text-sm text-gray-200 transition hover:bg-gray-800'
              >
                上一步
              </button>
              <button
                type='button'
                onClick={() => goToStep(3)}
                disabled={!stepTwoValid}
                className='rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50'
              >
                下一步
              </button>
            </div>
          </section>
        )}

        {step === 3 && bundle && validation && (
          <section aria-label='元數據與匯出' className='space-y-4'>
            <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
              <label className='sm:col-span-1'>
                <span className='mb-1 block text-xs font-medium text-gray-400'>協作包名稱</span>
                <input
                  type='text'
                  value={metadata.name}
                  onChange={event => setMetadata(prev => ({ ...prev, name: event.target.value }))}
                  className='w-full rounded-lg border border-gray-700 bg-gray-800/60 px-3 py-2 text-sm text-gray-100 focus:border-cyan-500 focus:outline-none'
                />
              </label>
              <label className='sm:col-span-1'>
                <span className='mb-1 block text-xs font-medium text-gray-400'>版本</span>
                <input
                  type='text'
                  value={metadata.version}
                  onChange={event =>
                    setMetadata(prev => ({ ...prev, version: event.target.value }))
                  }
                  className='w-full rounded-lg border border-gray-700 bg-gray-800/60 px-3 py-2 text-sm text-gray-100 focus:border-cyan-500 focus:outline-none'
                />
              </label>
              <label className='sm:col-span-2'>
                <span className='mb-1 block text-xs font-medium text-gray-400'>描述</span>
                <textarea
                  value={metadata.description}
                  onChange={event =>
                    setMetadata(prev => ({ ...prev, description: event.target.value }))
                  }
                  rows={2}
                  className='w-full rounded-lg border border-gray-700 bg-gray-800/60 px-3 py-2 text-sm text-gray-100 focus:border-cyan-500 focus:outline-none'
                />
              </label>
            </div>

            <div className='rounded-xl border border-gray-700/40 bg-gray-800/30 p-4 text-sm'>
              <p className='mb-1 text-gray-300'>預估體積：{formatBytes(sizeBytes)}</p>
              {largeBundle && (
                <p className='text-yellow-300'>體積較大，手機貼上匯入可能不便，建議以檔案傳輸。</p>
              )}
            </div>

            {(validation.errors.length > 0 || validation.warnings.length > 0) && (
              <div className='space-y-2' aria-label='自檢結果'>
                {validation.errors.map(issue => (
                  <div
                    key={issue.code}
                    className='rounded-lg border border-red-700/50 bg-red-900/20 p-3 text-sm text-red-200'
                  >
                    <p className='font-medium'>{issue.message}</p>
                    <p className='mt-1 text-xs opacity-80'>{issue.nextStep}</p>
                  </div>
                ))}
                {validation.warnings.map(issue => (
                  <div
                    key={issue.code}
                    className='rounded-lg border border-yellow-700/50 bg-yellow-900/20 p-3 text-sm text-yellow-200'
                  >
                    <p className='font-medium'>{issue.message}</p>
                    <p className='mt-1 text-xs opacity-80'>{issue.nextStep}</p>
                  </div>
                ))}
              </div>
            )}

            <div className='flex flex-wrap justify-between gap-2'>
              <button
                type='button'
                onClick={() => setStep(2)}
                className='rounded-lg border border-gray-600 px-4 py-2 text-sm text-gray-200 transition hover:bg-gray-800'
              >
                上一步
              </button>
              <div className='flex gap-2'>
                <button
                  type='button'
                  onClick={handlePreview}
                  disabled={hasErrors}
                  className='rounded-lg border border-fuchsia-500/50 px-4 py-2 text-sm text-fuchsia-100 transition hover:bg-fuchsia-500/10 disabled:cursor-not-allowed disabled:opacity-50'
                >
                  預覽
                </button>
                <button
                  type='button'
                  onClick={handleExport}
                  disabled={!canExport}
                  className='rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50'
                >
                  匯出 JSON
                </button>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
};

export default BundleBuilder;
