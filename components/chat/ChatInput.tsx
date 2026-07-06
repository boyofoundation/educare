import React from 'react';
import { ChatInputProps } from './types';

const MAX_TEXTAREA_HEIGHT_PX = 128;
const MIN_TEXTAREA_HEIGHT_PX = 48;
const APPROXIMATE_LINE_HEIGHT_PX = 20;
const APPROXIMATE_VERTICAL_PADDING_PX = 28;

const ChatInput: React.FC<ChatInputProps> = ({
  value,
  onChange,
  onSend,
  isLoading,
  statusText,
  disabled = false,
  isWorkspaceOpen: _isWorkspaceOpen = false,
  isRunning = false,
  onStop,
}) => {
  const [isComposing, setIsComposing] = React.useState(false);
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);

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

  return (
    <div className='border-t border-gray-700/30 bg-gradient-to-r from-gray-800/90 to-gray-850/90 p-3 backdrop-blur-sm md:p-6'>
      <div className='mx-auto max-w-3xl'>
        {statusText && (
          <div className='mb-4 rounded-lg border border-gray-600/30 bg-gray-700/30 p-3 backdrop-blur-sm'>
            <div className='flex items-center gap-3'>
              <div className='relative'>
                <div className='h-3 w-3 rounded-full bg-cyan-400 animate-pulse' />
                <div className='absolute inset-0 h-3 w-3 rounded-full bg-cyan-400 opacity-75 animate-ping' />
              </div>
              <span className='text-sm font-medium text-cyan-300'>{statusText}</span>
            </div>
          </div>
        )}
        <div className='flex items-end gap-2 md:gap-4'>
          <div className='relative flex-1'>
            <textarea
              ref={textareaRef}
              value={value}
              onChange={e => onChange(e.target.value)}
              onKeyDown={handleKeyDown}
              onCompositionStart={handleCompositionStart}
              onCompositionEnd={handleCompositionEnd}
              placeholder='輸入您的訊息...'
              rows={1}
              className='w-full resize-none rounded-2xl border-2 border-gray-600/40 bg-gray-700/60 px-4 py-3 text-sm text-white shadow-lg transition-all duration-300 hover:border-gray-500/60 focus:border-cyan-500/60 focus:bg-gray-700/80 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 disabled:cursor-not-allowed disabled:opacity-60 md:px-6 md:py-4 md:text-base'
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
            disabled={isLoading || !value.trim() || disabled || isRunning}
            className={`relative flex min-w-[80px] items-center justify-center rounded-2xl border px-4 py-3 text-sm font-medium text-white shadow-lg transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:ring-offset-2 focus:ring-offset-gray-800 md:min-w-[100px] md:px-8 md:py-4 md:text-base md:font-semibold ${
              isLoading || !value.trim() || disabled || isRunning
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
                <span className='hidden sm:inline md:inline'>傳送</span>
              </>
            )}
          </button>
          {isRunning && (
            <button
              onClick={() => onStop?.()}
              className='flex min-w-[80px] items-center justify-center rounded-2xl border border-rose-400/40 bg-rose-600 px-4 py-3 text-sm font-medium text-white shadow-lg transition-all duration-300 hover:bg-rose-500 focus:outline-none focus:ring-2 focus:ring-rose-400 focus:ring-offset-2 focus:ring-offset-gray-800 md:min-w-[100px] md:px-8 md:py-4 md:text-base md:font-semibold'
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
              <span className='hidden sm:inline md:inline'>停止</span>
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
