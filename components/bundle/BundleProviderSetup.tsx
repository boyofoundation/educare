import React, { useMemo, useState } from 'react';
import { providerManager } from '../../services/providerRegistry';
import {
  DEFAULT_PROVIDER_SETTINGS,
  type ProviderConfig,
  type ProviderType,
} from '../../services/llmAdapter';
import { recordBundleByokCompletion } from '../../services/bundleMetricsService';

export interface BundleProviderSetupProps {
  onReady: () => void;
  onCancel?: () => void;
}

type StorageScope = 'session' | 'browser';

const PROVIDERS: Array<{
  type: ProviderType;
  name: string;
  helpUrl: string;
  requiresEndpoint?: boolean;
  optionalApiKey?: boolean;
  apiKeyLabel?: string;
  apiKeyPlaceholder?: string;
}> = [
  {
    type: 'gemini',
    name: 'Google Gemini',
    helpUrl: 'https://aistudio.google.com/app/apikey',
    apiKeyLabel: 'API 金鑰',
    apiKeyPlaceholder: '貼上您的 Google AI Studio API Key',
  },
  {
    type: 'openai',
    name: 'OpenAI',
    helpUrl: 'https://platform.openai.com/api-keys',
    apiKeyLabel: 'API 金鑰',
    apiKeyPlaceholder: '貼上您的 OpenAI API Key',
  },
  {
    type: 'anthropic',
    name: 'Anthropic Claude',
    helpUrl: 'https://console.anthropic.com/settings/keys',
    apiKeyLabel: 'API 金鑰',
    apiKeyPlaceholder: '貼上您的 Anthropic API Key',
  },
  {
    type: 'groq',
    name: 'Groq',
    helpUrl: 'https://console.groq.com/keys',
    apiKeyLabel: 'API 金鑰',
    apiKeyPlaceholder: '貼上您的 Groq API Key',
  },
  {
    type: 'openrouter',
    name: 'OpenRouter',
    helpUrl: 'https://openrouter.ai/keys',
    apiKeyLabel: 'API 金鑰',
    apiKeyPlaceholder: '貼上您的 OpenRouter API Key',
  },
  {
    type: 'ollama',
    name: 'Ollama（本機模型）',
    helpUrl: 'https://ollama.com/',
    requiresEndpoint: true,
  },
  {
    type: 'lmstudio',
    name: 'OpenAI 相容端點',
    helpUrl: 'https://lmstudio.ai/',
    requiresEndpoint: true,
    optionalApiKey: true,
  },
];

const isValidValue = (value: string, endpoint: boolean): boolean => {
  if (endpoint) {
    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }
  return value.trim().length >= 8;
};

const getInitialConfig = (providerType: ProviderType): ProviderConfig => {
  const defaultConfig = DEFAULT_PROVIDER_SETTINGS.providers[providerType].config;
  const settings = providerManager.getSettings?.();
  const savedConfig = settings?.providers?.[providerType]?.config;
  const sessionConfig = providerManager.getSessionProviderConfig?.();

  return {
    ...defaultConfig,
    ...(savedConfig ?? {}),
    ...(sessionConfig?.type === providerType ? sessionConfig.config : {}),
  };
};

const sanitizeConfigForSave = (
  config: ProviderConfig,
  requiresEndpoint: boolean,
): ProviderConfig => ({
  ...config,
  model: config.model?.trim(),
  temperature: Math.min(
    2,
    Math.max(0, Number.isFinite(Number(config.temperature)) ? Number(config.temperature) : 0.7),
  ),
  maxTokens: Math.min(
    64000,
    Math.max(
      100,
      Number.isFinite(Number(config.maxTokens)) ? Math.round(Number(config.maxTokens)) : 4096,
    ),
  ),
  maxToolRounds: Math.min(
    200,
    Math.max(
      1,
      Number.isFinite(Number(config.maxToolRounds)) ? Math.round(Number(config.maxToolRounds)) : 50,
    ),
  ),
  ...(requiresEndpoint
    ? {
        baseUrl: config.baseUrl?.trim(),
        apiKey: config.apiKey?.trim() || undefined,
      }
    : { apiKey: config.apiKey?.trim() }),
});

const BundleProviderSetup: React.FC<BundleProviderSetupProps> = ({ onReady, onCancel }) => {
  const [providerType, setProviderType] = useState<ProviderType>('gemini');
  const [config, setConfig] = useState<ProviderConfig>(() => getInitialConfig('gemini'));
  const [scope, setScope] = useState<StorageScope>('session');
  const [busy, setBusy] = useState<'apply' | 'test' | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);

  const providerInfo = useMemo(
    () => PROVIDERS.find(provider => provider.type === providerType) ?? PROVIDERS[0],
    [providerType],
  );
  const credentialValue = providerInfo.requiresEndpoint
    ? config.baseUrl || ''
    : config.apiKey || '';
  const credentialValid = isValidValue(credentialValue, Boolean(providerInfo.requiresEndpoint));
  const modelValid = Boolean(config.model?.trim());
  const valid = credentialValid && modelValid;
  const provider = providerManager.getProvider(providerType);
  const supportedModels = provider?.supportedModels ?? [];
  const modelOptions = Array.from(new Set([...availableModels, ...supportedModels]));
  const inputClass =
    'mt-2 min-h-11 w-full rounded-lg border border-gray-600 bg-gray-900 px-3 text-gray-100 focus:border-cyan-500 focus:outline-none';

  const updateConfig = (key: keyof ProviderConfig, value: string | number | undefined) => {
    setConfig(current => ({ ...current, [key]: value }));
    setFeedback(null);
  };

  const handleProviderChange = (nextProviderType: ProviderType) => {
    setProviderType(nextProviderType);
    setConfig(getInitialConfig(nextProviderType));
    setAvailableModels([]);
    setFeedback(null);
  };

  const fetchModels = async () => {
    if (!provider?.getAvailableModels) {
      setFeedback('此服務商不提供模型清單，請直接輸入 MODEL 名稱。');
      return;
    }

    setFetchingModels(true);
    setFeedback(null);
    try {
      await provider.initialize(
        sanitizeConfigForSave(config, Boolean(providerInfo.requiresEndpoint)),
      );
      const models = await provider.getAvailableModels();
      setAvailableModels(models);
      setFeedback(`已取得 ${models.length} 個可用模型。`);
    } catch {
      setFeedback('無法取得模型清單，仍可直接輸入 MODEL 名稱。');
    } finally {
      setFetchingModels(false);
    }
  };

  const configure = async (testConnection: boolean) => {
    if (!valid) {
      setFeedback(
        !credentialValid
          ? providerInfo.requiresEndpoint
            ? '請輸入有效的 http:// 或 https:// 服務網址。'
            : '請輸入至少 8 個字元的 API 金鑰。'
          : '請輸入 MODEL 名稱。',
      );
      return;
    }

    setBusy(testConnection ? 'test' : 'apply');
    setFeedback(null);
    const configured = sanitizeConfigForSave(config, Boolean(providerInfo.requiresEndpoint));
    try {
      const selectedProvider = providerManager.getProvider(providerType);
      if (!selectedProvider) {
        throw new Error('服務商尚未完成初始化，請稍後重試。');
      }

      if (scope === 'session') {
        await providerManager.setSessionProviderConfig(providerType, configured);
      } else {
        providerManager.enableProvider(providerType, true);
        providerManager.updateProviderConfig(providerType, configured);
        providerManager.setActiveProvider(providerType);
        await selectedProvider.initialize(configured);
      }

      if (testConnection) {
        let received = false;
        for await (const chunk of selectedProvider.streamChat({
          systemPrompt: 'You are a connection test.',
          history: [],
          message: 'Reply with OK.',
          model: configured.model,
          temperature: configured.temperature,
          maxTokens: configured.maxTokens,
          maxToolRounds: configured.maxToolRounds,
        })) {
          if (chunk.text.trim()) {
            received = true;
            break;
          }
        }
        if (!received) {
          throw new Error('未收到測試回應。');
        }
        setFeedback('連線測試成功，可以開始對話。');
      }

      recordBundleByokCompletion();
      onReady();
    } catch (error) {
      setFeedback(`設定失敗：${error instanceof Error ? error.message : '未知錯誤'}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section
      aria-label='協作包 AI 服務商設定'
      className='mx-auto max-w-xl rounded-2xl border border-gray-700/50 bg-gray-800/50 p-6 shadow-xl'
    >
      <div className='flex items-start justify-between gap-4'>
        <div>
          <h2 className='text-xl font-bold text-white'>設定 BUNDLE 的 AI 服務商</h2>
          <p className='mt-1 text-xs text-cyan-200'>可隨時重新選擇服務商與金鑰。</p>
        </div>
        {onCancel && (
          <button
            type='button'
            onClick={onCancel}
            className='min-h-11 rounded-lg border border-gray-600 px-3 py-2 text-sm text-gray-200 transition hover:bg-gray-700'
          >
            取消
          </button>
        )}
      </div>
      <p className='mt-2 text-sm text-gray-400'>
        協作包不含金鑰。請使用自己的 AI
        服務商帳號；這次替換只套用至目前執行環境，不會寫入協作包或網址。
      </p>

      <label className='mt-5 block text-sm font-medium text-gray-300' htmlFor='bundle-provider'>
        AI 服務商
      </label>
      <select
        id='bundle-provider'
        value={providerType}
        onChange={event => handleProviderChange(event.target.value as ProviderType)}
        className='mt-2 min-h-11 w-full rounded-lg border border-gray-600 bg-gray-900 px-3 text-gray-100 focus:border-cyan-500 focus:outline-none'
      >
        {PROVIDERS.map(provider => (
          <option key={provider.type} value={provider.type}>
            {provider.name}
          </option>
        ))}
      </select>

      <label
        className='mt-4 block text-sm font-medium text-gray-300'
        htmlFor='bundle-provider-value'
      >
        {providerInfo.requiresEndpoint ? '服務網址' : providerInfo.apiKeyLabel || 'API 金鑰'}
      </label>
      <input
        id='bundle-provider-value'
        type={providerInfo.requiresEndpoint ? 'url' : 'password'}
        value={credentialValue}
        onChange={event =>
          updateConfig(providerInfo.requiresEndpoint ? 'baseUrl' : 'apiKey', event.target.value)
        }
        placeholder={
          providerInfo.requiresEndpoint
            ? providerType === 'ollama'
              ? 'http://localhost:11434'
              : 'http://localhost:1234/v1'
            : providerInfo.apiKeyPlaceholder || '貼上您的 API 金鑰'
        }
        aria-describedby='bundle-provider-format'
        className={inputClass}
      />
      <p
        id='bundle-provider-format'
        className={`mt-1 text-xs ${credentialValue && !credentialValid ? 'text-yellow-300' : 'text-gray-500'}`}
      >
        {providerInfo.requiresEndpoint
          ? '請使用 http:// 或 https:// 的服務網址。'
          : '金鑰至少需要 8 個字元；將以密碼欄位遮蔽。'}
      </p>
      {providerInfo.requiresEndpoint && providerInfo.optionalApiKey && (
        <>
          <label
            className='mt-4 block text-sm font-medium text-gray-300'
            htmlFor='bundle-provider-api-key'
          >
            API 金鑰（選填）
          </label>
          <input
            id='bundle-provider-api-key'
            type='password'
            value={config.apiKey || ''}
            onChange={event => updateConfig('apiKey', event.target.value)}
            placeholder='若端點需要 Bearer Token 才填寫'
            className={inputClass}
          />
        </>
      )}

      <div className='mt-5 border-t border-gray-700/70 pt-5'>
        <div className='flex flex-wrap items-end justify-between gap-2'>
          <div>
            <label
              className='block text-sm font-medium text-gray-300'
              htmlFor='bundle-provider-model'
            >
              MODEL
            </label>
            <p className='mt-1 text-xs text-gray-500'>
              可從清單選擇，也可以輸入服務商提供的自訂模型名稱。
            </p>
          </div>
          <button
            type='button'
            onClick={() => void fetchModels()}
            disabled={fetchingModels || !credentialValid}
            className='min-h-9 rounded-lg border border-cyan-500/40 px-3 py-1.5 text-xs text-cyan-100 transition hover:bg-cyan-500/10 disabled:cursor-not-allowed disabled:opacity-50'
          >
            {fetchingModels ? '取得中…' : '取得模型列表'}
          </button>
        </div>
        <input
          id='bundle-provider-model'
          type='text'
          list='bundle-provider-model-options'
          value={config.model || ''}
          onChange={event => updateConfig('model', event.target.value)}
          placeholder='例如：gemini-2.5-flash'
          className={inputClass}
        />
        <datalist id='bundle-provider-model-options'>
          {modelOptions.map(model => (
            <option key={model} value={model} />
          ))}
        </datalist>
      </div>

      <fieldset className='mt-5 rounded-xl border border-gray-700 p-4'>
        <legend className='px-1 text-sm font-medium text-gray-300'>模型其他設定</legend>
        <div className='space-y-5'>
          <div>
            <label
              className='flex items-center justify-between text-sm text-gray-300'
              htmlFor='bundle-provider-temperature'
            >
              <span>創造性 (Temperature)</span>
              <span className='font-mono text-cyan-300'>{config.temperature ?? 0.7}</span>
            </label>
            <input
              id='bundle-provider-temperature'
              type='range'
              min='0'
              max='2'
              step='0.1'
              value={config.temperature ?? 0.7}
              onChange={event => updateConfig('temperature', Number(event.target.value))}
              className='mt-3 h-2 w-full cursor-pointer appearance-none rounded-lg bg-gray-600'
            />
            <div className='mt-1 flex justify-between text-xs text-gray-500'>
              <span>保守 (0)</span>
              <span>平衡 (1)</span>
              <span>創新 (2)</span>
            </div>
          </div>
          <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
            <label className='block text-sm text-gray-300' htmlFor='bundle-provider-max-tokens'>
              最大回應長度 (Tokens)
              <input
                id='bundle-provider-max-tokens'
                type='number'
                min='100'
                max='64000'
                step='1'
                value={config.maxTokens ?? 4096}
                onChange={event => updateConfig('maxTokens', Number(event.target.value))}
                className={inputClass}
              />
            </label>
            <label
              className='block text-sm text-gray-300'
              htmlFor='bundle-provider-max-tool-rounds'
            >
              工具呼叫次數上限
              <input
                id='bundle-provider-max-tool-rounds'
                type='number'
                min='1'
                max='200'
                step='1'
                value={config.maxToolRounds ?? 50}
                onChange={event => updateConfig('maxToolRounds', Number(event.target.value))}
                className={inputClass}
              />
            </label>
          </div>
        </div>
      </fieldset>
      <a
        className='mt-2 inline-flex min-h-11 items-center text-sm text-cyan-300 underline hover:text-cyan-100'
        href={providerInfo.helpUrl}
        target='_blank'
        rel='noopener noreferrer'
      >
        如何取得 {providerInfo.name} 的設定？
      </a>

      <fieldset className='mt-5 rounded-xl border border-gray-700 p-3'>
        <legend className='px-1 text-sm font-medium text-gray-300'>儲存範圍</legend>
        <label className='mt-2 flex min-h-11 cursor-pointer items-center gap-2 text-sm text-gray-200'>
          <input
            type='radio'
            name='bundle-key-scope'
            checked={scope === 'session'}
            onChange={() => setScope('session')}
          />
          <span>僅本次（預設，關閉分頁即清除）</span>
        </label>
        <label className='flex min-h-11 cursor-pointer items-center gap-2 text-sm text-gray-200'>
          <input
            type='radio'
            name='bundle-key-scope'
            checked={scope === 'browser'}
            onChange={() => setScope('browser')}
          />
          <span>記住在此瀏覽器</span>
        </label>
      </fieldset>

      {feedback && (
        <p
          role='status'
          className='mt-4 rounded-lg border border-gray-600 bg-gray-900/60 p-3 text-sm text-gray-200'
        >
          {feedback}
        </p>
      )}

      <div className='mt-5 flex flex-col gap-2 sm:flex-row'>
        <button
          type='button'
          onClick={() => void configure(true)}
          disabled={busy !== null || !valid}
          className='min-h-11 flex-1 rounded-lg border border-cyan-500/50 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:bg-cyan-500/10 disabled:cursor-not-allowed disabled:opacity-50'
        >
          {busy === 'test' ? '測試中…' : '測試連線'}
        </button>
        <button
          type='button'
          onClick={() => void configure(false)}
          disabled={busy !== null || !valid}
          className='min-h-11 flex-1 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50'
        >
          {busy === 'apply' ? '儲存中…' : '儲存並開始對話'}
        </button>
      </div>
    </section>
  );
};

export default BundleProviderSetup;
