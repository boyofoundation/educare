import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Assistant } from '../../types';
import { downloadAssistantPackage } from '../../services/assistantPackageService';
import { saveAssistantToTurso } from '../../services/tursoService';
import { generateShortUrl, buildShortUrl } from '../../services/shortUrlService';
import Modal from '../ui/Modal';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  assistant: Assistant;
}

type ShareStatus = {
  type: 'success' | 'error' | 'info';
  message: string;
};

/**
 * 分享助理設定。檔案匯出是本機優先的主要路徑；雲端連結仍保留為
 * 選用功能，但不會在開啟對話框時自動寫入 Turso 或阻擋檔案匯出。
 */
export const ShareModal: React.FC<ShareModalProps> = ({ isOpen, onClose, assistant }) => {
  const [shareUrl, setShareUrl] = useState('');
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('');
  const [useShortUrl, setUseShortUrl] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportedFileName, setExportedFileName] = useState('');
  const [shareStatus, setShareStatus] = useState<ShareStatus | null>(null);
  const isGeneratingRef = useRef(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setShareUrl('');
    setQrCodeDataUrl('');
    setUseShortUrl(false);
    setIsGenerating(false);
    setIsExporting(false);
    setExportedFileName('');
    setShareStatus(null);
    isGeneratingRef.current = false;
  }, [assistant.id, isOpen]);

  const handleExportFile = useCallback(() => {
    if (isExporting) {
      return;
    }

    setIsExporting(true);
    setShareStatus(null);
    try {
      const result = downloadAssistantPackage(assistant);
      setExportedFileName(result.fileName);
      setShareStatus({
        type: 'success',
        message: `已匯出 ${result.fileName}。檔案包含助理設定與已解析教材，不包含聊天紀錄、服務商設定或 API 金鑰。`,
      });
    } catch (error) {
      console.error('匯出助理檔案失敗:', error);
      setShareStatus({
        type: 'error',
        message: `匯出失敗，請保留此對話框並重試：${error instanceof Error ? error.message : '未知錯誤'}`,
      });
    } finally {
      setIsExporting(false);
    }
  }, [assistant, isExporting]);

  const generateCloudShareLink = useCallback(async () => {
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
        mathToolsEnabled: assistant.mathToolsEnabled,
        webSpeechToolsEnabled: assistant.webSpeechToolsEnabled,
      });

      const baseUrl = window.location.pathname.replace(/\/[^/]*$/, '') || '/';
      let url = `${window.location.origin}${baseUrl}?share=${assistant.id}`;

      if (useShortUrl) {
        const shortCode = await generateShortUrl(assistant.id);
        url = buildShortUrl(shortCode);
      }

      const { default: QRCode } = await import('qrcode');
      const qrDataUrl = await QRCode.toDataURL(url, {
        width: 256,
        margin: 2,
        color: {
          dark: '#1f2937',
          light: '#ffffff',
        },
      });

      setShareUrl(url);
      setQrCodeDataUrl(qrDataUrl);
      setShareStatus({
        type: 'success',
        message: '選用的雲端分享連結已生成。連結需要 Turso；助理檔案仍可離線傳遞。',
      });
    } catch (error) {
      console.error('生成雲端分享連結失敗:', error);
      setShareStatus({
        type: 'error',
        message: `雲端分享連結生成失敗；助理檔案仍可直接匯出。${error instanceof Error ? ` ${error.message}` : ''}`,
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
    assistant.mathToolsEnabled,
    assistant.webSpeechToolsEnabled,
    assistant.systemPrompt,
    useShortUrl,
  ]);

  const handleCopyLink = async () => {
    if (!shareUrl) {
      return;
    }

    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareStatus({
        type: 'success',
        message: '雲端分享連結已複製到剪貼簿。',
      });
    } catch {
      setShareStatus({
        type: 'error',
        message: '複製失敗，請手動複製連結。',
      });
    }
  };

  const handleDownloadQr = () => {
    if (!qrCodeDataUrl) {
      return;
    }

    const link = document.createElement('a');
    link.download = `${assistant.name}-share-qr.png`;
    link.href = qrCodeDataUrl;
    link.click();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title='分享助理'
      closeButtonLabel='關閉'
      size='wide'
      className='border border-gray-700/50 bg-gradient-to-br from-gray-800 to-gray-900'
    >
      <div data-testid='share-modal' className='space-y-6 text-white'>
        <p className='text-gray-300'>
          分享 <span className='font-medium text-cyan-400'>{assistant.name}</span> 的可攜設定，先從
          本機檔案開始，不需要先連線或設定 Turso。
        </p>

        <section
          aria-labelledby='local-share-heading'
          className='rounded-2xl border border-cyan-500/30 bg-cyan-500/10 p-5'
        >
          <div className='flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between'>
            <div>
              <h3 id='local-share-heading' className='text-lg font-semibold text-white'>
                先匯出助理檔案
              </h3>
              <p className='mt-2 max-w-2xl text-sm leading-6 text-cyan-50/90'>
                檔案包含助理設定與已解析教材，可用附件傳給其他人再匯入。聊天紀錄、服務商設定與 API
                金鑰不會放進檔案。
              </p>
            </div>
            <button
              type='button'
              onClick={handleExportFile}
              disabled={isExporting}
              className='inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-cyan-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-60'
            >
              {isExporting ? '匯出中…' : '匯出助理檔案'}
            </button>
          </div>
          {exportedFileName && (
            <p
              role='status'
              className='mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100'
            >
              已準備下載：{exportedFileName}
            </p>
          )}
        </section>

        <section
          aria-labelledby='cloud-share-heading'
          className='rounded-2xl border border-gray-700/60 bg-gray-900/45 p-5'
        >
          <div className='mb-4'>
            <h3 id='cloud-share-heading' className='text-lg font-semibold text-white'>
              選用：雲端分享連結
            </h3>
            <p className='mt-2 text-sm leading-6 text-gray-400'>
              只有按下按鈕才會寫入 Turso。雲端連結只保存助理內容，不包含聊天紀錄、服務商設定或 API
              金鑰；沒有 Turso 時請使用上方檔案匯出。
            </p>
          </div>

          <label className='mb-4 flex items-start gap-3 rounded-xl border border-gray-700/70 bg-gray-800/60 p-4'>
            <input
              type='checkbox'
              id='useShortUrl'
              checked={useShortUrl}
              onChange={event => setUseShortUrl(event.target.checked)}
              className='mt-1 h-4 w-4 rounded text-purple-600 focus:ring-purple-500'
            />
            <span>
              <span className='block font-medium text-white'>使用短網址（需要雲端服務）</span>
              <span className='mt-1 block text-xs text-gray-400'>
                短網址會額外呼叫雲端服務；關閉時使用一般分享連結。
              </span>
            </span>
          </label>

          <button
            type='button'
            onClick={() => void generateCloudShareLink()}
            disabled={isGenerating}
            className='w-full rounded-xl border border-purple-400/40 bg-purple-500/15 px-4 py-3 font-medium text-purple-100 transition hover:border-purple-300 hover:bg-purple-500/25 disabled:cursor-not-allowed disabled:opacity-60'
          >
            {isGenerating ? '生成中…' : shareUrl ? '重新生成雲端分享連結' : '建立雲端分享連結'}
          </button>

          {qrCodeDataUrl && (
            <div className='mt-6 space-y-5'>
              <div className='text-center'>
                <div className='inline-block rounded-2xl bg-white p-4 shadow-lg'>
                  <img src={qrCodeDataUrl} alt='分享 QR Code' className='h-64 w-64' />
                </div>
                <p className='mt-3 text-sm text-gray-400'>掃描 QR Code 或複製下方雲端連結</p>
              </div>

              <div>
                <label
                  htmlFor='share-link'
                  className='mb-2 block text-sm font-medium text-gray-300'
                >
                  分享連結
                </label>
                <div className='flex flex-col gap-2 sm:flex-row'>
                  <input
                    id='share-link'
                    type='text'
                    value={shareUrl}
                    readOnly
                    aria-label='分享連結'
                    className='min-w-0 flex-1 rounded-xl border border-gray-600/50 bg-gray-700/50 px-4 py-3 font-mono text-sm text-white'
                  />
                  <button
                    type='button'
                    onClick={handleCopyLink}
                    className='rounded-xl bg-cyan-600 px-4 py-3 font-medium text-white transition hover:bg-cyan-500'
                  >
                    複製連結
                  </button>
                </div>
              </div>

              <button
                type='button'
                onClick={handleDownloadQr}
                className='w-full rounded-xl bg-emerald-600 py-3 font-medium text-white transition hover:bg-emerald-500'
              >
                下載 QR Code
              </button>
            </div>
          )}
        </section>

        {shareStatus && (
          <div
            role={shareStatus.type === 'error' ? 'alert' : 'status'}
            aria-live='polite'
            className={`rounded-xl border p-4 ${
              shareStatus.type === 'success'
                ? 'border-green-600/30 bg-green-900/30 text-green-200'
                : shareStatus.type === 'error'
                  ? 'border-red-600/30 bg-red-900/30 text-red-200'
                  : 'border-blue-600/30 bg-blue-900/30 text-blue-200'
            }`}
          >
            {shareStatus.message}
          </div>
        )}

        <div className='flex justify-end'>
          <button
            type='button'
            onClick={onClose}
            className='rounded-xl bg-gray-600 px-6 py-3 font-medium text-white transition hover:bg-gray-500'
          >
            關閉
          </button>
        </div>
      </div>
    </Modal>
  );
};
