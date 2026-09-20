import React, { useState } from 'react';
import { providerManager } from '../../services/providerRegistry';
import { ProviderType, ProviderSettings as IProviderSettings } from '../../services/llmAdapter';
import ProviderSettingsShareModal from './ProviderSettingsShareModal';

interface ProviderSettingsProps {
  onClose?: () => void;
}

interface ProviderInfo {
  name: string;
  description: string;
  icon: string;
  color: string;
  apiKeyLabel: string;
  apiKeyPlaceholder: string;
  helpUrl: string;
  /** 為 true 時，設定欄以「端點網址 (Base URL)」為主，API 金鑰為選填 */
  isEndpoint?: boolean;
}

type ProviderNotice = {
  type: 'success' | 'error' | 'info';
  message: string;
};

type ProviderField = 'apiKey' | 'baseUrl' | 'model';
type ProviderFieldErrors = Partial<Record<ProviderField, string>>;

/**
 * 目前要在設定介面上顯示的服務商。
 * 其他服務商（openai / anthropic / ollama / groq）的資料與底層邏輯皆保留，
 * 只是不在 UI 上顯示，未來需要時再加入此陣列即可。
 */
const VISIBLE_PROVIDERS: ProviderType[] = ['gemini', 'openrouter', 'lmstudio'];

const ProviderSettings: React.FC<ProviderSettingsProps> = ({ onClose }) => {
  const [settings, setSettings] = useState<IProviderSettings>(providerManager.getSettings());
  const [expandedProvider, setExpandedProvider] = useState<ProviderType | null>(null);
  const [testingProvider, setTestingProvider] = useState<ProviderType | null>(null);
  const [availableModels, setAvailableModels] = useState<Record<ProviderType, string[]>>(
    {} as Record<ProviderType, string[]>,
  );
  const [fetchingModels, setFetchingModels] = useState<Record<ProviderType, boolean>>(
    {} as Record<ProviderType, boolean>,
  );
  const [useCustomModel, setUseCustomModel] = useState<Record<ProviderType, boolean>>(
    {} as Record<ProviderType, boolean>,
  );
  const [providerNotices, setProviderNotices] = useState<
    Partial<Record<ProviderType, ProviderNotice>>
  >({});
  const [providerFieldErrors, setProviderFieldErrors] = useState<
    Partial<Record<ProviderType, ProviderFieldErrors>>
  >({});
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);

  const providerInfo: Record<ProviderType, ProviderInfo> = {
    gemini: {
      name: 'Google Gemini',
      description: 'Google 官方模型，適合日常對話、寫作與多模態任務',
      icon: '✨',
      color: 'from-blue-500 to-cyan-500',
      apiKeyLabel: 'Gemini API Key',
      apiKeyPlaceholder: '請輸入您的 Google AI Studio API Key',
      helpUrl: 'https://aistudio.google.com/app/apikey',
    },
    openai: {
      name: 'OpenAI',
      description: '強大的 GPT 模型，擅長複雜推理和代碼生成',
      icon: '🤖',
      color: 'from-green-500 to-teal-500',
      apiKeyLabel: 'OpenAI API Key',
      apiKeyPlaceholder: '請輸入您的 OpenAI API Key (sk-...)',
      helpUrl: 'https://platform.openai.com/api-keys',
    },
    anthropic: {
      name: 'Anthropic Claude',
      description: 'Claude 模型，支援原生工具呼叫與長上下文推理',
      icon: '🟣',
      color: 'from-violet-500 to-fuchsia-500',
      apiKeyLabel: 'Anthropic API Key',
      apiKeyPlaceholder: '請輸入您的 Anthropic API Key',
      helpUrl: 'https://console.anthropic.com/settings/keys',
    },
    ollama: {
      name: 'Ollama (本地模型)',
      description: '在您的電腦上運行的開源模型，完全私密',
      icon: '🏠',
      color: 'from-orange-500 to-red-500',
      apiKeyLabel: '服務地址',
      apiKeyPlaceholder: 'http://localhost:11434',
      helpUrl: 'https://ollama.ai/',
    },
    groq: {
      name: 'Groq',
      description: '超快速推理的 AI 模型，響應迅速',
      icon: '⚡',
      color: 'from-yellow-500 to-orange-500',
      apiKeyLabel: 'Groq API Key',
      apiKeyPlaceholder: '請輸入您的 Groq API Key',
      helpUrl: 'https://console.groq.com/keys',
    },
    openrouter: {
      name: 'OpenRouter',
      description: '統一路由服務，一組金鑰即可使用多種前沿模型',
      icon: '🚀',
      color: 'from-pink-500 to-rose-500',
      apiKeyLabel: 'OpenRouter API Key',
      apiKeyPlaceholder: '請輸入您的 OpenRouter API Key',
      helpUrl: 'https://openrouter.ai/keys',
    },
    lmstudio: {
      name: 'OpenAI 相容端點',
      description: '連接任何相容於 OpenAI API 的本地端點（LM Studio、Ollama、vLLM 等）',
      icon: '🔌',
      color: 'from-emerald-500 to-green-500',
      apiKeyLabel: 'API 金鑰（選填）',
      apiKeyPlaceholder: '若端點需要 Bearer Token 才填寫',
      helpUrl: 'https://lmstudio.ai/',
      isEndpoint: true,
    },
  };

  const handleProviderToggle = (providerType: ProviderType) => {
    const wasEnabled = settings.providers[providerType].enabled;
    providerManager.enableProvider(providerType, !wasEnabled);
    setSettings(providerManager.getSettings());

    // If we're disabling a provider that was expanded, collapse it
    if (wasEnabled && expandedProvider === providerType) {
      setExpandedProvider(null);
    }
  };

  const handleActiveProviderChange = (providerType: ProviderType) => {
    providerManager.setActiveProvider(providerType);
    setSettings(providerManager.getSettings());
  };

  const handleConfigUpdate = (providerType: ProviderType, key: string, value: string | number) => {
    if (key === 'maxToolRounds') {
      const numericValue = Number(value);
      const sanitizedValue = Number.isFinite(numericValue)
        ? Math.min(200, Math.max(1, Math.round(numericValue)))
        : 50;
      providerManager.updateProviderConfig(providerType, { [key]: sanitizedValue });
      setSettings(providerManager.getSettings());
      clearFieldError(providerType, key);
      return;
    }

    providerManager.updateProviderConfig(providerType, { [key]: value });
    setSettings(providerManager.getSettings());
    clearFieldError(providerType, key);
  };

  const setProviderNotice = (providerType: ProviderType, notice?: ProviderNotice) => {
    setProviderNotices(previous => ({ ...previous, [providerType]: notice }));
  };

  const clearFieldError = (providerType: ProviderType, key: string) => {
    if (key !== 'apiKey' && key !== 'baseUrl' && key !== 'model') {
      return;
    }

    setProviderFieldErrors(previous => {
      const nextErrors = { ...(previous[providerType] ?? {}) };
      delete nextErrors[key];
      return {
        ...previous,
        [providerType]: nextErrors,
      };
    });
    setProviderNotice(providerType);
  };

  const validateProviderConfiguration = (providerType: ProviderType): boolean => {
    const provider = providerManager.getProvider(providerType);
    const config = settings.providers[providerType].config;
    const errors: ProviderFieldErrors = {};

    if (!String(config.model || '').trim()) {
      errors.model = '請先選擇或輸入模型名稱。';
    }
    if (provider?.requiresApiKey && !String(config.apiKey || '').trim()) {
      errors.apiKey = '請先輸入 API 金鑰，再測試此服務商。';
    }
    if (providerType === 'lmstudio' && !String(config.baseUrl || '').trim()) {
      errors.baseUrl = '請先輸入端點網址，再測試此服務商。';
    }

    setProviderFieldErrors(previous => ({ ...previous, [providerType]: errors }));
    if (Object.keys(errors).length > 0) {
      setProviderNotice(providerType, {
        type: 'error',
        message: '請先修正標示的設定，再執行連線測試。',
      });
      return false;
    }

    return true;
  };

  const testProvider = async (providerType: ProviderType) => {
    setTestingProvider(providerType);
    setProviderNotice(providerType);
    try {
      const provider = providerManager.getProvider(providerType);
      if (!provider) {
        setProviderNotice(providerType, {
          type: 'error',
          message: '找不到此服務商，請重新載入設定頁後再試。',
        });
        return;
      }

      if (!validateProviderConfiguration(providerType)) {
        return;
      }

      // Test with a simple message
      const testParams = {
        systemPrompt: 'You are a helpful assistant.',
        history: [],
        message: 'Hello! Can you respond with "Test successful" if you receive this message?',
      };

      let responseReceived = false;
      for await (const chunk of provider.streamChat(testParams)) {
        if (chunk.text && chunk.text.trim()) {
          responseReceived = true;
          break;
        }
      }

      if (responseReceived) {
        setProviderNotice(providerType, {
          type: 'success',
          message: `${providerInfo[providerType].name} 連線測試成功。本次測試不代表之後每次請求都可用。`,
        });
      } else {
        setProviderNotice(providerType, {
          type: 'error',
          message: `${providerInfo[providerType].name} 測試失敗：未收到回應。請檢查端點、模型與網路設定。`,
        });
      }
    } catch (error) {
      setProviderNotice(providerType, {
        type: 'error',
        message: `${providerInfo[providerType].name} 測試失敗：${error instanceof Error ? error.message : '未知錯誤'}`,
      });
    } finally {
      setTestingProvider(null);
    }
  };

  const fetchAvailableModels = async (providerType: ProviderType) => {
    setFetchingModels(prev => ({ ...prev, [providerType]: true }));
    setProviderNotice(providerType);
    try {
      const provider = providerManager.getProvider(providerType);
      if (provider && provider.getAvailableModels) {
        const models = await provider.getAvailableModels();
        setAvailableModels(prev => ({ ...prev, [providerType]: models }));
        setProviderNotice(providerType, {
          type: 'success',
          message: `已取得 ${models.length} 個模型。仍請按「測試連線」確認服務可用。`,
        });
      } else {
        setProviderNotice(providerType, {
          type: 'info',
          message: '此服務商沒有提供動態模型列表，請使用內建列表或自訂輸入。',
        });
      }
    } catch (error) {
      console.warn(`Failed to fetch models for ${providerType}:`, error);
      setProviderNotice(providerType, {
        type: 'error',
        message: `無法取得 ${providerInfo[providerType].name} 的模型列表，請確認配置後重試。`,
      });
    } finally {
      setFetchingModels(prev => ({ ...prev, [providerType]: false }));
    }
  };

  const getProviderStatus = (providerType: ProviderType) => {
    const provider = providerManager.getProvider(providerType);
    if (!provider) {
      return { status: 'error', text: '未找到' };
    }

    const enabled = settings.providers[providerType].enabled;
    const available = provider.isAvailable();

    if (!enabled) {
      return { status: 'disabled', text: '已停用' };
    }
    if (!available) {
      return {
        status: 'warning',
        text: provider.requiresApiKey ? '需要 API 金鑰' : '需要端點設定',
      };
    }
    return { status: 'ready', text: '已設定，尚未測試' };
  };

  const statusBadgeClass = (status: string) =>
    status === 'ready'
      ? 'bg-green-500/15 text-green-300 border border-green-500/30'
      : status === 'warning'
        ? 'bg-yellow-500/15 text-yellow-300 border border-yellow-500/30'
        : status === 'disabled'
          ? 'bg-gray-500/15 text-gray-400 border border-gray-500/30'
          : 'bg-red-500/15 text-red-300 border border-red-500/30';

  const inputClass =
    'w-full px-4 py-2.5 bg-gray-900/60 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-colors';
  const labelClass = 'block text-sm font-medium text-gray-300 mb-2';
  const fieldInputClass = (providerType: ProviderType, field: ProviderField) =>
    `${inputClass}${providerFieldErrors[providerType]?.[field] ? ' border-red-400 focus:border-red-400 focus:ring-red-400' : ''}`;

  const activeInfo = providerInfo[settings.activeProvider];

  return (
    <div className='max-w-3xl mx-auto p-6 md:p-8'>
      {/* Header */}
      <div className='flex items-start justify-between mb-6'>
        <div>
          <h2 className='text-2xl md:text-3xl font-bold text-white mb-1.5'>AI 服務商設定</h2>
          <p className='text-gray-400 text-sm'>選擇並配置您要使用的 AI 服務商</p>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className='p-2 text-gray-400 hover:text-white rounded-lg hover:bg-gray-700/50 transition-colors'
            aria-label='關閉'
          >
            <svg className='w-6 h-6' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
              <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth={2}
                d='M6 18L18 6M6 6l12 12'
              />
            </svg>
          </button>
        )}
      </div>

      {/* 目前使用中的服務商 */}
      <div className='mb-6 rounded-2xl border border-cyan-500/30 bg-gradient-to-r from-cyan-500/10 to-blue-500/10 p-5'>
        <div className='flex flex-col gap-4 sm:flex-row sm:items-center'>
          <div className='flex items-center gap-4 flex-1 min-w-0'>
            <div className='flex items-center justify-center w-12 h-12 rounded-xl bg-gray-900/60 text-2xl'>
              {activeInfo?.icon || '🎯'}
            </div>
            <div className='flex-1 min-w-0'>
              <p className='text-xs uppercase tracking-wide text-cyan-300/80 mb-0.5'>目前使用中</p>
              <p className='text-lg font-semibold text-white truncate'>{activeInfo?.name}</p>
            </div>
            <span className='hidden sm:inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-cyan-500/20 text-cyan-300 text-xs font-medium border border-cyan-500/30'>
              <span className='w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse'></span>
              啟用
            </span>
          </div>
          <button
            type='button'
            onClick={() => setIsShareModalOpen(true)}
            className='inline-flex items-center justify-center gap-2 rounded-xl border border-cyan-400/40 bg-cyan-500/15 px-4 py-2.5 text-sm font-medium text-cyan-100 transition hover:border-cyan-300 hover:bg-cyan-500/25 hover:text-white'
          >
            <span>🔐</span>
            分享此服務商設定
          </button>
        </div>
      </div>

      {/* 服務商列表 */}
      <div className='space-y-3'>
        <h3 className='text-sm font-semibold text-gray-400 uppercase tracking-wide px-1 mb-1'>
          所有服務商
        </h3>

        {VISIBLE_PROVIDERS.map(providerType => {
          const info = providerInfo[providerType];
          const provider = providerManager.getProvider(providerType);
          const isExpanded = expandedProvider === providerType;
          const isEnabled = settings.providers[providerType].enabled;
          const isActive = settings.activeProvider === providerType;
          const config = settings.providers[providerType].config;
          const status = getProviderStatus(providerType);

          return (
            <div
              key={providerType}
              className={`rounded-2xl border transition-colors ${
                isActive ? 'border-cyan-500/40 bg-gray-800/60' : 'border-gray-700/40 bg-gray-800/40'
              }`}
              role='button'
              tabIndex={0}
              aria-expanded={isExpanded}
              onKeyDown={event => {
                if (event.target !== event.currentTarget) {
                  return;
                }
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  setExpandedProvider(isExpanded ? null : providerType);
                }
              }}
            >
              <div
                className='p-5 cursor-pointer'
                onClick={() => setExpandedProvider(isExpanded ? null : providerType)}
              >
                <div className='flex items-center justify-between gap-3'>
                  <div className='flex items-center gap-3 min-w-0'>
                    <div
                      className={`flex items-center justify-center w-11 h-11 rounded-xl bg-gradient-to-br ${info.color} bg-opacity-20 text-xl shrink-0`}
                    >
                      {info.icon}
                    </div>
                    <div className='min-w-0'>
                      <div className='flex items-center gap-2'>
                        <h4 className='text-base font-semibold text-white'>{info.name}</h4>
                        {isActive && (
                          <span className='text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-medium'>
                            使用中
                          </span>
                        )}
                      </div>
                      <p className='text-gray-400 text-xs truncate'>{info.description}</p>
                    </div>
                  </div>

                  <div className='flex items-center gap-3 shrink-0'>
                    <span
                      className={`hidden sm:inline-block text-xs px-2.5 py-1 rounded-full font-medium ${statusBadgeClass(
                        status.status,
                      )}`}
                    >
                      {status.text}
                    </span>

                    {/* Enable toggle */}
                    <label
                      className='flex items-center cursor-pointer'
                      onClick={e => e.stopPropagation()}
                    >
                      <input
                        type='checkbox'
                        checked={isEnabled}
                        aria-label={`啟用 ${info.name}`}
                        onChange={e => {
                          e.stopPropagation();
                          handleProviderToggle(providerType);
                        }}
                        className='sr-only'
                      />
                      <div
                        className={`relative w-11 h-6 rounded-full transition-colors ${
                          isEnabled ? 'bg-cyan-500' : 'bg-gray-600'
                        }`}
                      >
                        <div
                          className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${
                            isEnabled ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </div>
                    </label>

                    <svg
                      className={`w-5 h-5 text-gray-400 transition-transform shrink-0 ${isExpanded ? 'rotate-180' : ''}`}
                      fill='none'
                      stroke='currentColor'
                      viewBox='0 0 24 24'
                    >
                      <path
                        strokeLinecap='round'
                        strokeLinejoin='round'
                        strokeWidth={2}
                        d='M19 9l-7 7-7-7'
                      />
                    </svg>
                  </div>
                </div>
              </div>

              {isExpanded && isEnabled && (
                <div className='px-5 pb-5 border-t border-gray-700/40'>
                  <div className='pt-5 space-y-5'>
                    {/* 端點網址 (Base URL) — for endpoint-style providers (lmstudio) */}
                    {info.isEndpoint ? (
                      <div className='space-y-4'>
                        <div>
                          <label htmlFor={`${providerType}-base-url`} className={labelClass}>
                            端點網址 (Base URL)
                          </label>
                          <div className='flex space-x-2'>
                            <input
                              id={`${providerType}-base-url`}
                              type='url'
                              value={config.baseUrl || ''}
                              onChange={e =>
                                handleConfigUpdate(providerType, 'baseUrl', e.target.value)
                              }
                              placeholder='http://localhost:1234/v1'
                              className={fieldInputClass(providerType, 'baseUrl')}
                              aria-invalid={Boolean(providerFieldErrors[providerType]?.baseUrl)}
                              aria-describedby={
                                providerFieldErrors[providerType]?.baseUrl
                                  ? `${providerType}-base-url-error`
                                  : undefined
                              }
                            />
                            <a
                              href={info.helpUrl}
                              target='_blank'
                              rel='noopener noreferrer'
                              className='flex items-center justify-center px-3 bg-gray-700 hover:bg-gray-600 rounded-lg text-gray-300 hover:text-white transition-colors'
                              title='查看說明文件'
                            >
                              <svg
                                className='w-5 h-5'
                                fill='none'
                                stroke='currentColor'
                                viewBox='0 0 24 24'
                              >
                                <path
                                  strokeLinecap='round'
                                  strokeLinejoin='round'
                                  strokeWidth={2}
                                  d='M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14'
                                />
                              </svg>
                            </a>
                          </div>
                          {providerFieldErrors[providerType]?.baseUrl && (
                            <p
                              id={`${providerType}-base-url-error`}
                              className='mt-1.5 text-xs text-red-300'
                              role='alert'
                            >
                              {providerFieldErrors[providerType].baseUrl}
                            </p>
                          )}
                          <p className='text-xs text-gray-500 mt-1.5'>
                            支援任何相容於 OpenAI API 的本機服務（<code>/v1/chat/completions</code>
                            ）。
                          </p>
                        </div>
                        <div>
                          <label htmlFor={`${providerType}-api-key`} className={labelClass}>
                            {info.apiKeyLabel}
                          </label>
                          <input
                            id={`${providerType}-api-key`}
                            type='password'
                            value={config.apiKey || ''}
                            onChange={e =>
                              handleConfigUpdate(providerType, 'apiKey', e.target.value)
                            }
                            placeholder='若端點需要 Bearer Token 才填寫'
                            className={fieldInputClass(providerType, 'apiKey')}
                            aria-invalid={Boolean(providerFieldErrors[providerType]?.apiKey)}
                            aria-describedby={
                              providerFieldErrors[providerType]?.apiKey
                                ? `${providerType}-api-key-error`
                                : undefined
                            }
                          />
                          {providerFieldErrors[providerType]?.apiKey && (
                            <p
                              id={`${providerType}-api-key-error`}
                              className='mt-1.5 text-xs text-red-300'
                              role='alert'
                            >
                              {providerFieldErrors[providerType].apiKey}
                            </p>
                          )}
                          <p className='text-xs text-gray-500 mt-1.5'>
                            留空則不傳送 Authorization 標頭。
                          </p>
                        </div>
                      </div>
                    ) : provider?.requiresApiKey ? (
                      <div>
                        <label htmlFor={`${providerType}-api-key`} className={labelClass}>
                          {info.apiKeyLabel}
                        </label>
                        <div className='flex space-x-2'>
                          <input
                            id={`${providerType}-api-key`}
                            type='password'
                            value={config.apiKey || ''}
                            onChange={e =>
                              handleConfigUpdate(providerType, 'apiKey', e.target.value)
                            }
                            placeholder={info.apiKeyPlaceholder}
                            className={fieldInputClass(providerType, 'apiKey')}
                            aria-invalid={Boolean(providerFieldErrors[providerType]?.apiKey)}
                            aria-describedby={
                              providerFieldErrors[providerType]?.apiKey
                                ? `${providerType}-api-key-error`
                                : undefined
                            }
                          />
                          <a
                            href={info.helpUrl}
                            target='_blank'
                            rel='noopener noreferrer'
                            className='flex items-center justify-center px-3 bg-gray-700 hover:bg-gray-600 rounded-lg text-gray-300 hover:text-white transition-colors'
                            title='取得 API Key'
                          >
                            <svg
                              className='w-5 h-5'
                              fill='none'
                              stroke='currentColor'
                              viewBox='0 0 24 24'
                            >
                              <path
                                strokeLinecap='round'
                                strokeLinejoin='round'
                                strokeWidth={2}
                                d='M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14'
                              />
                            </svg>
                          </a>
                        </div>
                        {providerFieldErrors[providerType]?.apiKey && (
                          <p
                            id={`${providerType}-api-key-error`}
                            className='mt-1.5 text-xs text-red-300'
                            role='alert'
                          >
                            {providerFieldErrors[providerType].apiKey}
                          </p>
                        )}
                      </div>
                    ) : null}

                    {/* Model Selection */}
                    {provider?.supportedModels && provider.supportedModels.length > 0 && (
                      <div>
                        <div className='flex items-center justify-between mb-2 gap-2 flex-wrap'>
                          <label
                            htmlFor={`${providerType}-model`}
                            className='block text-sm font-medium text-gray-300'
                          >
                            模型選擇
                          </label>
                          <div className='flex items-center space-x-2'>
                            <button
                              onClick={() => fetchAvailableModels(providerType)}
                              disabled={fetchingModels[providerType]}
                              className='px-3 py-1 text-xs bg-blue-600/80 hover:bg-blue-600 disabled:bg-gray-600 text-white rounded-md transition-colors flex items-center space-x-1'
                            >
                              {fetchingModels[providerType] ? (
                                <>
                                  <svg
                                    className='animate-spin -ml-0.5 mr-1 h-3 w-3 text-white'
                                    xmlns='http://www.w3.org/2000/svg'
                                    fill='none'
                                    viewBox='0 0 24 24'
                                  >
                                    <circle
                                      className='opacity-25'
                                      cx='12'
                                      cy='12'
                                      r='10'
                                      stroke='currentColor'
                                      strokeWidth='4'
                                    ></circle>
                                    <path
                                      className='opacity-75'
                                      fill='currentColor'
                                      d='M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z'
                                    ></path>
                                  </svg>
                                  <span>獲取中</span>
                                </>
                              ) : (
                                <span>🔄 取得模型列表</span>
                              )}
                            </button>
                            <button
                              onClick={() =>
                                setUseCustomModel(prev => ({
                                  ...prev,
                                  [providerType]: !prev[providerType],
                                }))
                              }
                              className='px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-white rounded-md transition-colors'
                            >
                              {useCustomModel[providerType] ? '📋 使用列表' : '✏️ 自訂輸入'}
                            </button>
                          </div>
                        </div>

                        {useCustomModel[providerType] ? (
                          <input
                            id={`${providerType}-model`}
                            type='text'
                            value={config.model || ''}
                            onChange={e =>
                              handleConfigUpdate(providerType, 'model', e.target.value)
                            }
                            placeholder='請輸入模型名稱 (例如: gpt-4o, gemini-2.5-flash)'
                            className={fieldInputClass(providerType, 'model')}
                            aria-invalid={Boolean(providerFieldErrors[providerType]?.model)}
                            aria-describedby={
                              providerFieldErrors[providerType]?.model
                                ? `${providerType}-model-error`
                                : undefined
                            }
                          />
                        ) : (
                          <select
                            id={`${providerType}-model`}
                            value={
                              config.model ||
                              availableModels[providerType]?.[0] ||
                              provider.supportedModels[0]
                            }
                            onChange={e =>
                              handleConfigUpdate(providerType, 'model', e.target.value)
                            }
                            className={`${fieldInputClass(providerType, 'model')} appearance-none cursor-pointer`}
                            aria-invalid={Boolean(providerFieldErrors[providerType]?.model)}
                            aria-describedby={
                              providerFieldErrors[providerType]?.model
                                ? `${providerType}-model-error`
                                : undefined
                            }
                          >
                            {(availableModels[providerType] || provider.supportedModels).map(
                              model => (
                                <option key={model} value={model}>
                                  {model}
                                </option>
                              ),
                            )}
                          </select>
                        )}

                        {providerFieldErrors[providerType]?.model && (
                          <p
                            id={`${providerType}-model-error`}
                            className='mt-1.5 text-xs text-red-300'
                            role='alert'
                          >
                            {providerFieldErrors[providerType].model}
                          </p>
                        )}

                        {availableModels[providerType] &&
                          availableModels[providerType].length > 0 && (
                            <p className='text-xs text-gray-500 mt-1.5'>
                              已動態取得 {availableModels[providerType].length} 個可用模型
                            </p>
                          )}
                      </div>
                    )}

                    {/* Temperature */}
                    <div>
                      <label className='flex items-center justify-between text-sm font-medium text-gray-300 mb-2'>
                        <span>創造性 (Temperature)</span>
                        <span className='text-cyan-300 font-mono'>{config.temperature || 0.7}</span>
                      </label>
                      <input
                        type='range'
                        min='0'
                        max='2'
                        step='0.1'
                        value={config.temperature || 0.7}
                        onChange={e =>
                          handleConfigUpdate(
                            providerType,
                            'temperature',
                            parseFloat(e.target.value),
                          )
                        }
                        className='w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer slider'
                      />
                      <div className='flex justify-between text-xs text-gray-500 mt-1.5'>
                        <span>保守 (0)</span>
                        <span>平衡 (1)</span>
                        <span>創新 (2)</span>
                      </div>
                    </div>

                    <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
                      {/* Max Tokens */}
                      <div>
                        <label className={labelClass}>最大回應長度 (Tokens)</label>
                        <input
                          type='number'
                          min='100'
                          max='64000'
                          step='1'
                          value={config.maxTokens || 4096}
                          onChange={e =>
                            handleConfigUpdate(providerType, 'maxTokens', parseInt(e.target.value))
                          }
                          className={inputClass}
                        />
                      </div>

                      {/* Tool Rounds */}
                      <div>
                        <label className={labelClass}>工具呼叫次數上限</label>
                        <input
                          type='number'
                          min='1'
                          max='200'
                          step='1'
                          value={
                            typeof config.maxToolRounds === 'number' ? config.maxToolRounds : 50
                          }
                          onChange={e =>
                            handleConfigUpdate(
                              providerType,
                              'maxToolRounds',
                              parseInt(e.target.value || '50', 10),
                            )
                          }
                          className={inputClass}
                        />
                      </div>
                    </div>
                    <p className='-mt-2 text-xs text-gray-500'>
                      控制模型在同一輪對話中最多可進行幾次工具呼叫往返，預設 50。
                    </p>

                    {/* Actions */}
                    {providerNotices[providerType] && (
                      <div
                        role={providerNotices[providerType]?.type === 'error' ? 'alert' : 'status'}
                        aria-live='polite'
                        className={`rounded-xl border px-4 py-3 text-sm ${
                          providerNotices[providerType]?.type === 'success'
                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100'
                            : providerNotices[providerType]?.type === 'error'
                              ? 'border-red-500/30 bg-red-500/10 text-red-100'
                              : 'border-cyan-500/30 bg-cyan-500/10 text-cyan-100'
                        }`}
                      >
                        {providerNotices[providerType]?.message}
                      </div>
                    )}
                    <div className='flex flex-col sm:flex-row gap-3 pt-1'>
                      <button
                        onClick={() => testProvider(providerType)}
                        disabled={testingProvider === providerType || status.status !== 'ready'}
                        className='flex-1 px-4 py-2.5 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-700/50 disabled:text-gray-500 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors flex items-center justify-center'
                      >
                        {testingProvider === providerType ? (
                          <>
                            <span className='w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2'></span>
                            測試中...
                          </>
                        ) : (
                          '🔌 測試連接'
                        )}
                      </button>
                      <button
                        onClick={() => handleActiveProviderChange(providerType)}
                        disabled={isActive || status.status !== 'ready'}
                        className='flex-1 px-4 py-2.5 bg-gradient-to-r from-cyan-600 to-cyan-500 hover:from-cyan-500 hover:to-cyan-400 disabled:from-gray-700 disabled:to-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-all'
                      >
                        {isActive ? '✓ 目前使用中' : '設為目前使用'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer hint */}
      <p className='mt-6 text-center text-xs text-gray-500'>
        想使用其他服務商？未來版本將陸續支援更多選項。
      </p>

      <ProviderSettingsShareModal
        isOpen={isShareModalOpen}
        onClose={() => setIsShareModalOpen(false)}
        settings={settings}
        availableProviders={Array.from(
          new Set([
            settings.activeProvider,
            ...VISIBLE_PROVIDERS.filter(providerType => settings.providers[providerType].enabled),
          ]),
        )}
        initialProvider={settings.activeProvider}
      />
    </div>
  );
};

export default ProviderSettings;
