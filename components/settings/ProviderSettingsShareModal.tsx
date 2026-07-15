import React, { useEffect, useMemo, useState } from 'react';
import Modal from '../ui/Modal';
import type { ProviderSettings, ProviderType } from '../../services/llmAdapter';
import { CryptoService } from '../../services/cryptoService';
import {
  buildProviderSettingsPayload,
  buildProviderSettingsShareUrl,
  encryptProviderSettingsPayload,
  getProviderDisplayName,
} from '../../services/providerSettingsShareService';

interface ProviderSettingsShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: ProviderSettings;
  availableProviders: ProviderType[];
  initialProvider: ProviderType;
}

const ProviderSettingsShareModal: React.FC<ProviderSettingsShareModalProps> = ({
  isOpen,
  onClose,
  settings,
  availableProviders,
  initialProvider,
}) => {
  const [selectedProvider, setSelectedProvider] = useState<ProviderType>(initialProvider);
  const [password, setPassword] = useState('');
  const [shareUrl, setShareUrl] = useState('');
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const hasGeneratedShare = Boolean(shareUrl && qrCodeDataUrl);

  const resetGeneratedShare = () => {
    setShareUrl('');
    setQrCodeDataUrl('');
    setError(null);
    setSuccess(null);
  };

  useEffect(() => {
    if (isOpen) {
      setSelectedProvider(initialProvider);
      setPassword(CryptoService.generateRandomPassword());
      setShareUrl('');
      setQrCodeDataUrl('');
      setError(null);
      setSuccess(null);
    }
  }, [initialProvider, isOpen]);

  const summary = useMemo(() => {
    try {
      const payload = buildProviderSettingsPayload(settings, selectedProvider);
      return {
        providerName: getProviderDisplayName(selectedProvider),
        model: payload.config.model,
        baseUrl: payload.config.baseUrl,
        hasApiKey: Boolean(payload.config.apiKey),
      };
    } catch (buildError) {
      return {
        providerName: getProviderDisplayName(selectedProvider),
        model: '',
        baseUrl: undefined,
        hasApiKey: false,
        error: buildError instanceof Error ? buildError.message : '無法建立分享摘要',
      };
    }
  }, [selectedProvider, settings]);

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setSuccess(`${label}已複製到剪貼簿`);
    } catch (copyError) {
      console.error(`Copy ${label} failed:`, copyError);
      const textArea = document.createElement('textarea');
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setSuccess(`${label}已複製到剪貼簿`);
    }
  };

  const handleProviderSelect = (provider: ProviderType) => {
    setSelectedProvider(provider);
    resetGeneratedShare();
  };

  const handlePasswordChange = (nextPassword: string) => {
    setPassword(nextPassword);
    if (shareUrl || qrCodeDataUrl || error || success) {
      resetGeneratedShare();
    }
  };

  const handleRegeneratePassword = () => {
    setPassword(CryptoService.generateRandomPassword());
    resetGeneratedShare();
  };

  const handleGenerate = async () => {
    if (!password.trim()) {
      setError('請先設定解密密碼');
      return;
    }

    setIsGenerating(true);
    setError(null);
    setSuccess(null);

    try {
      const payload = buildProviderSettingsPayload(settings, selectedProvider);
      const encryptedPayload = await encryptProviderSettingsPayload(payload, password);
      const url = buildProviderSettingsShareUrl(encryptedPayload);
      const { default: QRCode } = await import('qrcode');
      const qr = await QRCode.toDataURL(url, {
        width: 512,
        margin: 2,
        color: {
          dark: '#111827',
          light: '#ffffff',
        },
      });

      setShareUrl(url);
      setQrCodeDataUrl(qr);
      setSuccess('分享連結與 QR Code 已生成');
    } catch (generateError) {
      console.error('Generate provider settings share failed:', generateError);
      setError(generateError instanceof Error ? generateError.message : '分享連結生成失敗');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownloadQr = () => {
    if (!qrCodeDataUrl) {
      return;
    }

    const link = document.createElement('a');
    link.download = `${selectedProvider}-provider-share-qr.png`;
    link.href = qrCodeDataUrl;
    link.click();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title='分享服務商設定'
      size='wide'
      className='border border-gray-700/50 bg-gradient-to-br from-gray-900 to-gray-800'
    >
      <div className='space-y-6 text-white'>
        <div className='rounded-3xl border border-cyan-500/30 bg-gradient-to-r from-cyan-500/15 via-blue-500/10 to-transparent p-5'>
          <div className='flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between'>
            <div className='space-y-3'>
              <div>
                <p className='text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200/80'>
                  安全分享流程
                </p>
                <p className='mt-2 text-sm leading-6 text-cyan-50/95'>
                  將目前的服務商設定加密成分享連結與 QR Code。接收者輸入密碼後即可預覽並套用。
                </p>
              </div>
              <div className='flex flex-wrap gap-2 text-xs text-cyan-50/85'>
                <span className='rounded-full border border-cyan-400/25 bg-cyan-400/10 px-3 py-1'>
                  1. 選擇要分享的服務商
                </span>
                <span className='rounded-full border border-cyan-400/25 bg-cyan-400/10 px-3 py-1'>
                  2. 分開傳送解密密碼
                </span>
                <span className='rounded-full border border-cyan-400/25 bg-cyan-400/10 px-3 py-1'>
                  3. 對方預覽後再套用
                </span>
              </div>
            </div>
            <div className='flex flex-wrap gap-2 lg:justify-end'>
              <span className='rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-100'>
                端對端加密
              </span>
              <span
                className={`rounded-full border px-3 py-1 text-xs font-medium ${
                  summary.hasApiKey
                    ? 'border-yellow-400/25 bg-yellow-400/10 text-yellow-100'
                    : 'border-gray-500/25 bg-gray-500/10 text-gray-200'
                }`}
              >
                {summary.hasApiKey ? '包含 API 金鑰' : '不含 API 金鑰'}
              </span>
            </div>
          </div>
        </div>

        <div className='grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]'>
          <div className='space-y-5'>
            <section className='rounded-3xl border border-gray-700/60 bg-gray-900/45 p-5'>
              <div className='mb-4 flex items-center justify-between gap-3'>
                <div>
                  <p className='text-xs font-semibold uppercase tracking-[0.24em] text-gray-500'>
                    步驟 1
                  </p>
                  <h3 className='mt-1 text-lg font-semibold text-white'>選擇分享內容</h3>
                </div>
                <span className='rounded-full bg-gray-800 px-3 py-1 text-xs text-gray-300'>
                  {summary.providerName}
                </span>
              </div>

              <div className='grid gap-2 sm:grid-cols-2'>
                {availableProviders.map(provider => {
                  const active = provider === selectedProvider;
                  return (
                    <button
                      key={provider}
                      type='button'
                      onClick={() => handleProviderSelect(provider)}
                      className={`rounded-2xl border px-4 py-3 text-left transition-colors ${
                        active
                          ? 'border-cyan-500 bg-cyan-500/15 text-cyan-100 shadow-lg shadow-cyan-950/20'
                          : 'border-gray-700 bg-gray-950/60 text-gray-200 hover:border-gray-500 hover:bg-gray-900'
                      }`}
                    >
                      <div className='font-medium'>{getProviderDisplayName(provider)}</div>
                      <div className='mt-1 text-xs text-gray-400'>
                        套用後會自動設為目前使用中的服務商
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className='mt-4 grid gap-3 sm:grid-cols-2'>
                <div className='rounded-2xl border border-gray-800 bg-gray-950/70 p-4'>
                  <p className='text-xs uppercase tracking-wide text-gray-500'>模型</p>
                  <p className='mt-2 break-all font-mono text-sm text-cyan-100'>
                    {summary.model || '尚未設定'}
                  </p>
                </div>
                <div className='rounded-2xl border border-gray-800 bg-gray-950/70 p-4'>
                  <p className='text-xs uppercase tracking-wide text-gray-500'>API 金鑰</p>
                  <p className='mt-2 text-sm font-medium text-white'>
                    {summary.hasApiKey ? '已包含在分享內容中' : '不會一併分享'}
                  </p>
                </div>
                <div className='rounded-2xl border border-gray-800 bg-gray-950/70 p-4 sm:col-span-2'>
                  <p className='text-xs uppercase tracking-wide text-gray-500'>端點網址</p>
                  <p className='mt-2 break-all font-mono text-xs text-gray-200'>
                    {summary.baseUrl || '無'}
                  </p>
                </div>
              </div>

              {'error' in summary && summary.error && (
                <p className='mt-4 rounded-2xl border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-xs text-yellow-200'>
                  {summary.error}
                </p>
              )}
            </section>

            <section className='rounded-3xl border border-gray-700/60 bg-gray-900/45 p-5'>
              <div className='mb-4'>
                <p className='text-xs font-semibold uppercase tracking-[0.24em] text-gray-500'>
                  步驟 2
                </p>
                <h3 className='mt-1 text-lg font-semibold text-white'>設定解密密碼</h3>
                <p className='mt-2 text-sm text-gray-400'>
                  建議使用其他通道傳送密碼，避免與分享連結出現在同一則訊息中。
                </p>
              </div>

              <label
                htmlFor='provider-share-password'
                className='mb-2 block text-sm font-medium text-gray-300'
              >
                解密密碼
              </label>
              <div className='flex flex-col gap-3 sm:flex-row'>
                <input
                  id='provider-share-password'
                  type='text'
                  value={password}
                  onChange={event => handlePasswordChange(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter') {
                      void handleGenerate();
                    }
                  }}
                  className='min-w-0 flex-1 rounded-2xl border border-gray-700 bg-gray-950/80 px-4 py-3 text-white outline-none transition focus:border-cyan-500'
                  placeholder='設定或產生分享密碼'
                />
                <div className='flex gap-2 sm:flex-col sm:justify-stretch'>
                  <button
                    type='button'
                    onClick={handleRegeneratePassword}
                    className='flex-1 rounded-2xl bg-gray-700 px-4 py-3 text-sm font-medium text-white transition hover:bg-gray-600'
                  >
                    重新產生
                  </button>
                  <button
                    type='button'
                    onClick={() => copyToClipboard(password, '解密密碼')}
                    className='flex-1 rounded-2xl border border-gray-600 bg-gray-800/80 px-4 py-3 text-sm font-medium text-white transition hover:border-gray-500 hover:bg-gray-700'
                  >
                    複製密碼
                  </button>
                </div>
              </div>

              <div className='mt-4 flex flex-wrap gap-3'>
                <button
                  type='button'
                  onClick={() => void handleGenerate()}
                  disabled={isGenerating}
                  className='rounded-2xl bg-gradient-to-r from-cyan-600 to-blue-500 px-5 py-3 font-semibold text-white transition hover:from-cyan-500 hover:to-blue-400 disabled:cursor-not-allowed disabled:opacity-60'
                >
                  {isGenerating
                    ? '生成中...'
                    : hasGeneratedShare
                      ? '重新生成分享內容'
                      : '生成分享連結'}
                </button>
                <span className='inline-flex items-center rounded-full border border-gray-700 bg-gray-900/70 px-3 py-1 text-xs text-gray-400'>
                  變更服務商或密碼後，會自動清除舊的分享結果
                </span>
              </div>
            </section>

            {error && (
              <div className='rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200'>
                {error}
              </div>
            )}
            {success && (
              <div className='rounded-2xl border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-200'>
                {success}
              </div>
            )}
          </div>

          <section
            className={`rounded-3xl border p-5 sm:p-6 transition-colors ${
              hasGeneratedShare
                ? 'border-cyan-500/35 bg-gradient-to-b from-cyan-500/10 via-gray-900/85 to-gray-900/95'
                : 'border-gray-700/60 bg-gray-900/35'
            }`}
          >
            <div className='mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
              <div>
                <p className='text-xs font-semibold uppercase tracking-[0.24em] text-gray-500'>
                  步驟 3
                </p>
                <h3 className='mt-1 text-xl font-semibold text-white'>
                  {hasGeneratedShare ? '分享已準備完成' : '等待生成分享結果'}
                </h3>
                <p className='mt-2 text-sm text-gray-400'>
                  {hasGeneratedShare
                    ? '掃描 QR Code 或直接複製分享連結，將設定安全傳送給對方。'
                    : '生成分享連結後，這裡會顯示 QR Code、連結與下載操作。'}
                </p>
              </div>
              {hasGeneratedShare && (
                <span className='inline-flex w-fit items-center rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-xs font-medium text-cyan-100'>
                  可掃描 · 可複製 · 可下載
                </span>
              )}
            </div>

            {hasGeneratedShare ? (
              <div className='space-y-5'>
                <div className='mx-auto aspect-square w-full max-w-[280px] rounded-[28px] bg-white p-4 shadow-lg shadow-black/20'>
                  <img
                    src={qrCodeDataUrl}
                    alt='服務商設定分享 QR Code'
                    className='h-full w-full object-contain'
                  />
                </div>

                <div className='rounded-2xl border border-gray-700/60 bg-gray-950/70 p-4'>
                  <label
                    htmlFor='provider-share-link'
                    className='block text-xs font-medium uppercase tracking-wide text-gray-400'
                  >
                    分享連結
                  </label>
                  <div className='mt-3 flex flex-col gap-2 sm:flex-row'>
                    <input
                      id='provider-share-link'
                      type='text'
                      value={shareUrl}
                      readOnly
                      className='min-w-0 flex-1 rounded-2xl border border-gray-700 bg-gray-900/80 px-4 py-3 font-mono text-xs text-cyan-100 outline-none'
                    />
                    <button
                      type='button'
                      onClick={() => copyToClipboard(shareUrl, '分享連結')}
                      className='rounded-2xl bg-cyan-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-cyan-500'
                    >
                      複製連結
                    </button>
                  </div>
                </div>

                <div className='grid gap-3 sm:grid-cols-2'>
                  <button
                    type='button'
                    onClick={handleDownloadQr}
                    className='rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500'
                  >
                    下載 QR Code
                  </button>
                  <button
                    type='button'
                    onClick={() => copyToClipboard(password, '解密密碼')}
                    className='rounded-2xl border border-gray-600 bg-gray-800/80 px-4 py-3 text-sm font-semibold text-white transition hover:border-gray-500 hover:bg-gray-700'
                  >
                    複製密碼
                  </button>
                </div>

                <div className='rounded-2xl border border-cyan-500/20 bg-cyan-500/8 px-4 py-3 text-xs leading-6 text-cyan-50/85'>
                  建議先傳送分享連結，再用其他通道傳送解密密碼；接收者解密後可先預覽，再決定是否套用設定。
                </div>
              </div>
            ) : (
              <div className='flex min-h-[340px] flex-col items-center justify-center rounded-3xl border border-dashed border-gray-700 px-6 text-center'>
                <div className='mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-gray-700 bg-gray-900/80 text-3xl'>
                  🔐
                </div>
                <p className='text-base font-medium text-white'>尚未生成分享內容</p>
                <p className='mt-2 max-w-sm text-sm leading-6 text-gray-500'>
                  選好要分享的服務商並設定密碼後，按下「生成分享連結」，右側就會立即顯示 QR Code
                  與可複製的分享連結。
                </p>
              </div>
            )}
          </section>
        </div>
      </div>
    </Modal>
  );
};

export default ProviderSettingsShareModal;
