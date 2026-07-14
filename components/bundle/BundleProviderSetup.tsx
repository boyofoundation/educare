import React, { useMemo, useState } from 'react';
import { providerManager } from '../../services/providerRegistry';
import type { ProviderConfig, ProviderType } from '../../services/llmAdapter';
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
}> = [
  { type: 'gemini', name: 'Google Gemini', helpUrl: 'https://aistudio.google.com/app/apikey' },
  { type: 'openai', name: 'OpenAI', helpUrl: 'https://platform.openai.com/api-keys' },
  {
    type: 'anthropic',
    name: 'Anthropic Claude',
    helpUrl: 'https://console.anthropic.com/settings/keys',
  },
  { type: 'groq', name: 'Groq', helpUrl: 'https://console.groq.com/keys' },
  { type: 'openrouter', name: 'OpenRouter', helpUrl: 'https://openrouter.ai/keys' },
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

const BundleProviderSetup: React.FC<BundleProviderSetupProps> = ({ onReady, onCancel }) => {
  const [providerType, setProviderType] = useState<ProviderType>('gemini');
  const [value, setValue] = useState('');
  const [scope, setScope] = useState<StorageScope>('session');
  const [busy, setBusy] = useState<'apply' | 'test' | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const providerInfo = useMemo(
    () => PROVIDERS.find(provider => provider.type === providerType) ?? PROVIDERS[0],
    [providerType],
  );
  const valid = isValidValue(value, Boolean(providerInfo.requiresEndpoint));
  const config: Partial<ProviderConfig> = providerInfo.requiresEndpoint
    ? { baseUrl: value.trim() }
    : { apiKey: value.trim() };

  const configure = async (testConnection: boolean) => {
    if (!valid) {
      setFeedback(
        providerInfo.requiresEndpoint
          ? '請輸入有效的 http:// 或 https:// 服務網址。'
          : '請輸入至少 8 個字元的 API 金鑰。',
      );
      return;
    }

    setBusy(testConnection ? 'test' : 'apply');
    setFeedback(null);
    try {
      const provider = providerManager.getProvider(providerType);
      if (!provider) {
        throw new Error('服務商尚未完成初始化，請稍後重試。');
      }

      if (scope === 'session') {
        await providerManager.setSessionProviderConfig(providerType, config);
      } else {
        providerManager.enableProvider(providerType, true);
        providerManager.updateProviderConfig(providerType, config);
        providerManager.setActiveProvider(providerType);
        await provider.initialize(config);
      }

      if (testConnection) {
        let received = false;
        for await (const chunk of provider.streamChat({
          systemPrompt: 'You are a connection test.',
          history: [],
          message: 'Reply with OK.',
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
      aria-label='協作包 AI 金鑰設定'
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
        onChange={event => {
          setProviderType(event.target.value as ProviderType);
          setValue('');
          setFeedback(null);
        }}
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
        {providerInfo.requiresEndpoint ? '服務網址' : 'API 金鑰'}
      </label>
      <input
        id='bundle-provider-value'
        type={providerInfo.requiresEndpoint ? 'url' : 'password'}
        value={value}
        onChange={event => setValue(event.target.value)}
        placeholder={providerInfo.requiresEndpoint ? 'http://localhost:11434' : '貼上您的 API 金鑰'}
        aria-describedby='bundle-provider-format'
        className='mt-2 min-h-11 w-full rounded-lg border border-gray-600 bg-gray-900 px-3 text-gray-100 focus:border-cyan-500 focus:outline-none'
      />
      <p
        id='bundle-provider-format'
        className={`mt-1 text-xs ${value && !valid ? 'text-yellow-300' : 'text-gray-500'}`}
      >
        {providerInfo.requiresEndpoint
          ? '請使用 http:// 或 https:// 的服務網址。'
          : '金鑰至少需要 8 個字元；將以密碼欄位遮蔽。'}
      </p>
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
