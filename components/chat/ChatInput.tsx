import React from 'react';
import { ChatInputProps } from './types';
import { attachmentToDataUrl } from '../../services/imageAttachmentService';

const MAX_TEXTAREA_HEIGHT_PX = 128;
const MIN_TEXTAREA_HEIGHT_PX = 48;
const APPROXIMATE_LINE_HEIGHT_PX = 20;
const APPROXIMATE_VERTICAL_PADDING_PX = 28;

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

interface SpeechRecognitionResultEventLike {
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
}

const getSpeechRecognitionConstructor = (): SpeechRecognitionConstructor | undefined => {
  if (typeof window === 'undefined') {
    return undefined;
  }
  const speechWindow = window as Window &
    typeof globalThis & {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
};

const ChatInput: React.FC<ChatInputProps> = ({
  value,
  onChange,
  onSend,
  isLoading,
  disabled = false,
  isWorkspaceOpen: _isWorkspaceOpen = false,
  isRunning = false,
  onStop,
  imageInputEnabled = false,
  attachments = [],
  onAddAttachmentFiles,
  onRemoveAttachment,
}) => {
  const [isComposing, setIsComposing] = React.useState(false);
  const [isListening, setIsListening] = React.useState(false);
  const [speechInputSupported, setSpeechInputSupported] = React.useState(false);
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const speechRecognitionRef = React.useRef<SpeechRecognitionLike | null>(null);
  const inputLocked = isLoading || disabled || isRunning;
  const canSend = !inputLocked && (value.trim() !== '' || attachments.length > 0);

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!imageInputEnabled || inputLocked || !onAddAttachmentFiles) {
      return;
    }
    const imageFiles = Array.from(e.clipboardData.files).filter(file =>
      file.type.startsWith('image/'),
    );
    if (imageFiles.length > 0) {
      e.preventDefault();
      onAddAttachmentFiles(imageFiles);
    }
  };

  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) {
      onAddAttachmentFiles?.(files);
    }
    // 允許重複選同一個檔案。
    e.target.value = '';
  };

  const syncTextareaHeight = React.useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = 'auto';
    const measuredHeight =
      textarea.scrollHeight > 0
        ? textarea.scrollHeight
        : value.split('\n').length * APPROXIMATE_LINE_HEIGHT_PX + APPROXIMATE_VERTICAL_PADDING_PX;
    textarea.style.height = `${Math.min(measuredHeight, MAX_TEXTAREA_HEIGHT_PX)}px`;
  }, [value]);

  React.useEffect(() => {
    syncTextareaHeight();
  }, [syncTextareaHeight, value]);

  React.useEffect(() => {
    setSpeechInputSupported(Boolean(getSpeechRecognitionConstructor()));
    return () => {
      speechRecognitionRef.current?.abort();
      speechRecognitionRef.current = null;
    };
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !isComposing) {
      e.preventDefault();
      onSend();
    }
  };

  const handleCompositionStart = () => {
    setIsComposing(true);
  };

  const handleCompositionEnd = () => {
    setIsComposing(false);
  };

  const toggleSpeechInput = () => {
    if (inputLocked) {
      return;
    }

    if (isListening) {
      speechRecognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const Recognition = getSpeechRecognitionConstructor();
    if (!Recognition) {
      setSpeechInputSupported(false);
      return;
    }

    const recognition = new Recognition();
    recognition.lang = navigator.language || 'zh-TW';
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onresult = event => {
      let transcript = '';
      for (let index = 0; index < event.results.length; index += 1) {
        transcript += event.results[index][0].transcript;
      }
      const nextValue = value.trim().length > 0 ? `${value.trimEnd()} ${transcript}` : transcript;
      onChange(nextValue);
    };
    recognition.onend = () => {
      setIsListening(false);
      speechRecognitionRef.current = null;
    };
    recognition.onerror = () => {
      setIsListening(false);
      speechRecognitionRef.current = null;
    };
    speechRecognitionRef.current = recognition;
    try {
      setIsListening(true);
      recognition.start();
    } catch {
      recognition.abort();
      speechRecognitionRef.current = null;
      setIsListening(false);
    }
  };

  return (
    <div className='border-t border-gray-700/30 bg-gradient-to-r from-gray-800/90 to-gray-850/90 px-4 py-4 backdrop-blur-sm md:px-6 md:py-5'>
      <div className='mx-auto max-w-4xl'>
        {attachments.length > 0 && (
          <div className='mb-3 flex flex-wrap gap-2' aria-label='待送出的圖片附件'>
            {attachments.map((attachment, index) => (
              <div
                key={`${attachment.name ?? 'image'}-${index}`}
                className='group relative h-16 w-16 overflow-hidden rounded-xl border border-gray-600/50 bg-gray-700/40'
              >
                <img
                  src={attachmentToDataUrl(attachment)}
                  alt={attachment.name ?? `附件圖片 ${index + 1}`}
                  className='h-full w-full object-cover'
                />
                <button
                  type='button'
                  onClick={() => onRemoveAttachment?.(index)}
                  disabled={inputLocked}
                  className='absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-gray-900/80 text-xs text-gray-200 transition hover:bg-rose-600 hover:text-white focus:outline-none focus:ring-2 focus:ring-rose-400'
                  aria-label={`移除圖片 ${attachment.name ?? index + 1}`}
                  title='移除圖片'
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
        <div className='flex items-end gap-3 md:gap-4'>
          {imageInputEnabled && (
            <>
              <input
                ref={fileInputRef}
                type='file'
                accept='image/png,image/jpeg,image/webp,image/gif'
                multiple
                className='hidden'
                onChange={handleFilePick}
                aria-hidden='true'
                tabIndex={-1}
              />
              <button
                type='button'
                onClick={() => fileInputRef.current?.click()}
                disabled={inputLocked}
                className={`flex min-h-12 min-w-12 items-center justify-center rounded-2xl border-2 px-3 py-3 text-gray-300 shadow-lg transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 ${
                  inputLocked
                    ? 'cursor-not-allowed border-gray-600/30 bg-gray-600/40 opacity-60'
                    : 'border-gray-600/40 bg-gray-700/60 hover:border-cyan-500/60 hover:text-cyan-300'
                }`}
                aria-label='上傳圖片'
                title='上傳圖片(也可直接貼上)'
              >
                <svg className='h-5 w-5' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                  <path
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    strokeWidth={2}
                    d='M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z'
                  />
                </svg>
              </button>
            </>
          )}
          {speechInputSupported && (
            <button
              type='button'
              onClick={toggleSpeechInput}
              disabled={inputLocked}
              className={`flex min-h-12 min-w-12 items-center justify-center rounded-2xl border-2 px-3 py-3 text-gray-300 shadow-lg transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 ${
                inputLocked
                  ? 'cursor-not-allowed border-gray-600/30 bg-gray-600/40 opacity-60'
                  : isListening
                    ? 'border-emerald-400/60 bg-emerald-600/80 text-white'
                    : 'border-gray-600/40 bg-gray-700/60 hover:border-emerald-500/60 hover:text-emerald-300'
              }`}
              aria-label={isListening ? '停止語音輸入' : '開始語音輸入'}
              title={isListening ? '停止語音輸入' : '開始語音輸入'}
            >
              <svg className='h-5 w-5' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth={2}
                  d='M12 3.75a3 3 0 00-3 3v4.5a3 3 0 006 0v-4.5a3 3 0 00-3-3zM6.75 10.5v.75a5.25 5.25 0 0010.5 0v-.75M12 16.5v3.75m-3 0h6'
                />
              </svg>
            </button>
          )}
          <div className='relative flex-1'>
            <textarea
              ref={textareaRef}
              value={value}
              onChange={e => onChange(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onCompositionStart={handleCompositionStart}
              onCompositionEnd={handleCompositionEnd}
              placeholder='輸入您的訊息...'
              rows={1}
              className='w-full resize-none rounded-2xl border-2 border-gray-600/40 bg-gray-700/60 px-4 py-3 text-base leading-7 text-white shadow-lg transition-all duration-300 hover:border-gray-500/60 focus:border-cyan-500/60 focus:bg-gray-700/80 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 disabled:cursor-not-allowed disabled:opacity-60 md:px-5 md:py-3.5'
              disabled={isLoading || disabled || isRunning}
              aria-label='輸入訊息'
              aria-describedby='input-help'
              aria-multiline='true'
              role='textbox'
              style={{
                minHeight: `${MIN_TEXTAREA_HEIGHT_PX}px`,
                maxHeight: `${MAX_TEXTAREA_HEIGHT_PX}px`,
              }}
            />
            <div className='absolute bottom-2 right-4 flex items-center gap-2'>
              {value.length > 100 && (
                <div className='rounded-full bg-gray-800/80 px-2 py-1 text-xs text-gray-300'>
                  {value.length}
                </div>
              )}
            </div>
          </div>
          <button
            onClick={onSend}
            disabled={!canSend}
            className={`relative flex min-h-12 min-w-12 items-center justify-center rounded-2xl border px-4 py-3 text-base font-semibold text-white shadow-lg transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:ring-offset-2 focus:ring-offset-gray-800 md:min-w-[108px] md:px-7 ${
              !canSend
                ? 'cursor-not-allowed border-gray-600/30 bg-gray-600/50'
                : 'border-cyan-500/40 bg-cyan-600 hover:bg-cyan-500'
            } ${isRunning ? 'hidden' : ''}`}
            aria-label={isLoading ? '正在傳送訊息' : '傳送訊息'}
            type='submit'
          >
            {isLoading ? (
              <div className='h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent' />
            ) : (
              <>
                <svg
                  className='mr-1 h-4 w-4 md:mr-2 md:h-5 md:w-5'
                  fill='currentColor'
                  viewBox='0 0 24 24'
                  aria-hidden='true'
                >
                  <path d='M3.4 20.4a1 1 0 0 1-.33-1.93l16.7-6.47L3.07 5.53a1 1 0 0 1 .2-1.93 1 1 0 0 1 .43.03l17.99 6.75a1.75 1.75 0 0 1 0 3.24L3.7 20.37a1 1 0 0 1-.3.05Z' />
                </svg>
                <span className='hidden sm:inline'>傳送</span>
              </>
            )}
          </button>
          {isRunning && (
            <button
              onClick={() => onStop?.()}
              className='flex min-h-12 min-w-12 items-center justify-center rounded-2xl border border-rose-400/40 bg-rose-600 px-4 py-3 text-base font-semibold text-white shadow-lg transition-all duration-300 hover:bg-rose-500 focus:outline-none focus:ring-2 focus:ring-rose-400 focus:ring-offset-2 focus:ring-offset-gray-800 md:min-w-[108px] md:px-7'
              aria-label='停止 Agent 執行'
              title='停止 Agent 執行'
              type='button'
            >
              <svg
                className='mr-1 h-4 w-4 md:mr-2 md:h-5 md:w-5'
                fill='currentColor'
                viewBox='0 0 24 24'
                aria-hidden='true'
              >
                <rect x='6' y='6' width='12' height='12' rx='1.5' />
              </svg>
              <span className='hidden sm:inline'>停止</span>
            </button>
          )}
        </div>

        {isRunning && (
          <div
            className='mt-3 flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200'
            role='status'
            aria-live='polite'
          >
            <span className='inline-block h-2 w-2 animate-pulse rounded-full bg-rose-400' />
            <span>Agent 執行中,可按停止結束目前回合。</span>
          </div>
        )}

        <div className='mt-2 flex items-center justify-center md:mt-4' id='input-help'>
          <div
            className='hidden items-center gap-1 text-xs text-gray-400 md:flex md:gap-3'
            role='region'
            aria-label='輸入說明'
          >
            <div className='flex items-center gap-2 rounded-full border border-gray-600/30 bg-gray-700/30 px-2 py-1 md:px-3 md:py-1.5'>
              <kbd
                className='rounded bg-gray-600/50 px-2 py-1 text-xs font-medium'
                aria-label='Enter 鍵'
              >
                Enter
              </kbd>
              <span>傳送</span>
            </div>
            <div className='flex items-center gap-2 rounded-full border border-gray-600/30 bg-gray-700/30 px-2 py-1 md:px-3 md:py-1.5'>
              <kbd
                className='rounded bg-gray-600/50 px-2 py-1 text-xs font-medium'
                aria-label='Shift 加 Enter 鍵'
              >
                Shift + Enter
              </kbd>
              <span>換行</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatInput;
