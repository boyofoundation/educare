import React, { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Assistant } from '../../types';
import { saveAssistantToTurso } from '../../services/tursoService';
import { generateShortUrl, buildShortUrl } from '../../services/shortUrlService';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  assistant: Assistant;
}

export const ShareModal: React.FC<ShareModalProps> = ({ isOpen, onClose, assistant }) => {
  const [shareUrl, setShareUrl] = useState('');
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('');
  const [useShortUrl, setUseShortUrl] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [shareStatus, setShareStatus] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);
  const isGeneratingRef = useRef(false);

  const generateShareLink = useCallback(async () => {
    if (isGeneratingRef.current) {
      return;
    }

    isGeneratingRef.current = true;
    setIsGenerating(true);
    setShareStatus(null);

    try {
      await saveAssistantToTurso({
        id: assistant.id,
        name: assistant.name,
        description: assistant.description || '',
        systemPrompt: assistant.systemPrompt,
        createdAt: assistant.createdAt || Date.now(),
        routableAssistantIds: assistant.routableAssistantIds,
        starterPrompts: assistant.starterPrompts,
        subagentDelegationEnabled: assistant.subagentDelegationEnabled,
      });

      const baseUrl = window.location.pathname.replace(/\/[^/]*$/, '') || '/';
      let url = `${window.location.origin}${baseUrl}?share=${assistant.id}`;

      if (useShortUrl) {
        try {
          const shortCode = await generateShortUrl(assistant.id);
          url = buildShortUrl(shortCode);
          setShareStatus({
            type: 'success',
            message: '短網址生成成功！',
          });
        } catch (error) {
          console.error('Failed to generate short URL:', error);
          setShareStatus({
            type: 'error',
            message: `短網址生成失敗：${error instanceof Error ? error.message : String(error)}`,
          });
        }
      }

      setShareUrl(url);

      const qrDataUrl = await QRCode.toDataURL(url, {
        width: 256,
        margin: 2,
        color: {
          dark: '#1f2937',
          light: '#ffffff',
        },
      });
      setQrCodeDataUrl(qrDataUrl);

      setShareStatus({
        type: 'success',
        message: '分享連結生成成功！',
      });
    } catch (error) {
      console.error('生成分享連結失敗:', error);
      setShareStatus({
        type: 'error',
        message: `生成分享連結失敗，請檢查 Turso 配置並稍後再試。錯誤: ${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      isGeneratingRef.current = false;
      setIsGenerating(false);
    }
  }, [
    assistant.createdAt,
    assistant.description,
    assistant.id,
    assistant.name,
    assistant.routableAssistantIds,
    assistant.starterPrompts,
    assistant.subagentDelegationEnabled,
    assistant.systemPrompt,
    useShortUrl,
  ]);

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareStatus({
        type: 'success',
        message: '連結已複製到剪貼簿！',
      });
      setTimeout(() => setShareStatus(null), 3000);
    } catch {
      setShareStatus({
        type: 'error',
        message: '複製失敗，請手動複製連結。',
      });
    }
  };

  const handleDownloadQR = () => {
    const link = document.createElement('a');
    link.download = `${assistant.name}-share-qr.png`;
    link.href = qrCodeDataUrl;
    link.click();
  };

  useEffect(() => {
    if (isOpen && assistant) {
      generateShareLink();
    }

    return () => {
      isGeneratingRef.current = false;
    };
  }, [assistant, generateShareLink, isOpen]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      data-testid='share-modal'
      className='fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm'
    >
      <div className='max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-gray-700/50 bg-gradient-to-br from-gray-800 to-gray-900 p-8 shadow-2xl'>
        <div className='mb-6 flex items-center justify-between'>
          <div>
            <h2 className='mb-1 text-2xl font-bold text-white'>分享助理</h2>
            <p className='text-gray-300'>
              分享 <span className='font-medium text-cyan-400'>{assistant.name}</span> 給其他人使用
            </p>
          </div>
          <button
            data-testid='close-share-modal'
            onClick={onClose}
            className='rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-700/50 hover:text-white'
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
        </div>

        {qrCodeDataUrl && (
          <div className='mb-8 text-center'>
            <div className='inline-block rounded-2xl bg-white p-4 shadow-lg'>
              <img src={qrCodeDataUrl} alt='分享 QR Code' className='mx-auto h-64 w-64' />
            </div>
            <p className='mt-3 text-sm text-gray-400'>掃描 QR Code 或複製下方連結</p>
          </div>
        )}

        {assistant.routableAssistantIds?.length ? (
          <p className='mb-4 rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100'>
            此助理設定了轉接目標。訪客端僅會看到同樣已分享的目標助理。
          </p>
        ) : null}

        <div className='mb-6'>
          <label className='mb-2 block text-sm font-medium text-gray-300'>分享連結</label>
          <div className='flex gap-2'>
            <input
              type='text'
              value={shareUrl}
              readOnly
              className='flex-1 rounded-xl border border-gray-600/50 bg-gray-700/50 px-4 py-3 font-mono text-sm text-white'
            />
            <button
              onClick={handleCopyLink}
              className='flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 px-4 py-3 font-medium text-white transition-all duration-200 hover:from-cyan-500 hover:to-blue-500'
            >
              <svg className='w-4 h-4' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth={2}
                  d='M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z'
                />
              </svg>
              複製
            </button>
          </div>
        </div>

        <div className='mb-6 rounded-xl bg-gray-700/30 p-6'>
          <div className='mb-4 flex items-center space-x-3'>
            <input
              type='checkbox'
              id='useShortUrl'
              checked={useShortUrl}
              onChange={event => setUseShortUrl(event.target.checked)}
              className='h-4 w-4 rounded text-purple-600 focus:ring-purple-500'
            />
            <label htmlFor='useShortUrl' className='font-medium text-white'>
              🔗 使用短網址（更簡潔易分享）
            </label>
          </div>
          <div className='rounded-lg border border-blue-500/20 bg-blue-500/10 p-3'>
            <p className='text-xs text-blue-100'>
              助理分享只包含助理內容與連結，不再附帶 API 金鑰或服務商設定。若要分享 provider
              設定，請到「AI 服務商」頁面使用新的安全分享功能。
            </p>
          </div>
          <button
            onClick={generateShareLink}
            disabled={isGenerating}
            className='mt-4 w-full rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 py-2 font-medium text-white transition-all duration-200 hover:from-purple-500 hover:to-pink-500 disabled:opacity-50'
          >
            {isGenerating ? '生成中...' : '重新生成分享連結'}
          </button>
        </div>

        {shareStatus && (
          <div
            className={`mb-6 rounded-xl border p-4 ${
              shareStatus.type === 'success'
                ? 'border-green-600/30 bg-green-900/30 text-green-200'
                : shareStatus.type === 'error'
                  ? 'border-red-600/30 bg-red-900/30 text-red-200'
                  : 'border-blue-600/30 bg-blue-900/30 text-blue-200'
            }`}
          >
            <p className='flex items-center gap-2 text-sm'>
              <span>
                {shareStatus.type === 'success' && '✅'}
                {shareStatus.type === 'error' && '❌'}
                {shareStatus.type === 'info' && 'ℹ️'}
              </span>
              {shareStatus.message}
            </p>
          </div>
        )}

        <div className='flex gap-3'>
          <button
            onClick={handleDownloadQR}
            disabled={!qrCodeDataUrl}
            className='flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-green-600 to-emerald-600 py-3 font-medium text-white transition-all duration-200 hover:from-green-500 hover:to-emerald-500 disabled:opacity-50'
          >
            <svg className='w-4 h-4' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
              <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth={2}
                d='M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z'
              />
            </svg>
            下載 QR Code
          </button>
          <button
            onClick={onClose}
            className='flex-1 rounded-xl bg-gray-600 py-3 font-medium text-white transition-all duration-200 hover:bg-gray-500'
          >
            關閉
          </button>
        </div>
      </div>
    </div>
  );
};
