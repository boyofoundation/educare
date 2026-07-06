import React, { useEffect, useRef, useState } from 'react';
import { MessageBubbleProps } from './types';
import { UserIcon, GeminiIcon } from '../ui/Icons';
import SubagentActivityCard from './SubagentActivityCard';
import ToolCallCard from './ToolCallCard';
import MarkdownContent from './MarkdownContent';

const EMPTY_MESSAGE_FALLBACK = '（本次回覆沒有內容）';

const formatTimestamp = (timestamp?: number): string | null => {
  if (typeof timestamp !== 'number') {
    return null;
  }

  const date = new Date(timestamp);
  const now = new Date(Date.now());
  const isSameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (isSameDay) {
    return date.toLocaleTimeString('zh-TW', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  return date.toLocaleString('zh-TW', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const MessageBubble: React.FC<MessageBubbleProps> = ({ message, index: _index }) => {
  const [syntheticExpanded, setSyntheticExpanded] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const copyFeedbackTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyFeedbackTimerRef.current !== null) {
        window.clearTimeout(copyFeedbackTimerRef.current);
      }
    };
  }, []);

  const handleCopy = async (text: string) => {
    if (copyFeedbackTimerRef.current !== null) {
      window.clearTimeout(copyFeedbackTimerRef.current);
    }

    try {
      await navigator.clipboard.writeText(text);
      setCopyFeedback('✓ 已複製');
    } catch {
      setCopyFeedback('複製失敗');
    }

    copyFeedbackTimerRef.current = window.setTimeout(() => {
      setCopyFeedback(null);
    }, 1500);
  };

  if (message.synthetic) {
    return (
      <div className='flex justify-start' data-testid='synthetic-message'>
        <div className='max-w-3xl'>
          <button
            type='button'
            onClick={() => setSyntheticExpanded(open => !open)}
            className='inline-flex items-center gap-2 rounded-full border border-gray-700/60 bg-gray-800/40 px-3 py-1 text-xs text-gray-400 transition hover:border-gray-600 hover:text-gray-200'
            aria-expanded={syntheticExpanded}
            aria-label={syntheticExpanded ? '摺疊續跑訊息' : '展開續跑訊息'}
            title={syntheticExpanded ? '摺疊續跑訊息' : '展開續跑訊息'}
          >
            <span
              className='inline-block h-1.5 w-1.5 rounded-full bg-gray-500'
              aria-hidden='true'
            />
            <span>Agent 續跑銜接訊息</span>
            <svg
              className={`h-3 w-3 transition-transform ${syntheticExpanded ? 'rotate-180' : ''}`}
              fill='none'
              stroke='currentColor'
              viewBox='0 0 24 24'
              aria-hidden='true'
            >
              <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth={2}
                d='M19 9l-7 7-7-7'
              />
            </svg>
          </button>
          {syntheticExpanded && (
            <div className='mt-2 rounded-xl border border-dashed border-gray-700/50 bg-gray-900/40 px-4 py-2 text-xs text-gray-400'>
              {message.content}
              {message.agentTurnLog && (
                <div className='mt-2 border-t border-gray-800 pt-2 text-[10px] text-gray-500'>
                  {message.agentTurnLog}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  const displayContent = message.content.trim() === '' ? EMPTY_MESSAGE_FALLBACK : message.content;
  const timestampLabel = formatTimestamp(message.timestamp);
  const isUser = message.role === 'user';
  const copyLabel = copyFeedback ?? (isUser ? '複製訊息' : '複製回應');

  const actionRow = (
    <div
      className={`mt-2 flex flex-wrap items-center gap-2 text-xs ${
        isUser ? 'justify-end' : 'justify-start'
      } text-gray-500`}
    >
      {timestampLabel && (
        <span className='transition group-hover:text-gray-300 group-focus-within:text-gray-300'>
          {timestampLabel}
        </span>
      )}
      <button
        type='button'
        onClick={() => void handleCopy(displayContent)}
        className='rounded-md px-2 py-1 text-gray-400 opacity-100 transition hover:bg-gray-700/60 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/70 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100'
        title={copyLabel}
      >
        {copyLabel}
      </button>
    </div>
  );

  if (isUser) {
    return (
      <div className='flex justify-end' aria-label='使用者訊息'>
        <div className='flex w-full max-w-3xl flex-row-reverse gap-3'>
          <div className='flex-shrink-0'>
            <div className='flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 shadow-lg ring-2 ring-cyan-400/20'>
              <UserIcon className='h-5 w-5 text-white' />
            </div>
          </div>
          <div className='group flex min-w-0 flex-col items-end'>
            <div className='w-full max-w-[85%] rounded-2xl rounded-br-md bg-gradient-to-br from-cyan-500 to-blue-600 px-5 py-3 text-white shadow-lg md:max-w-[65ch]'>
              <div className='text-sm leading-relaxed'>
                <MarkdownContent content={displayContent} />
              </div>
            </div>
            {actionRow}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className='flex justify-start' aria-label={message.isError ? '系統錯誤訊息' : '助理回覆'}>
      <div className='flex w-full max-w-3xl gap-3'>
        <div className='flex-shrink-0'>
          <div className='flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-gray-700 to-gray-600 shadow-lg ring-2 ring-gray-600/30'>
            <GeminiIcon className='h-5 w-5 text-cyan-400' />
          </div>
        </div>
        <div className='group flex min-w-0 flex-col gap-3'>
          {message.toolCallLog && message.toolCallLog.length > 0 && (
            <ToolCallCard records={message.toolCallLog} />
          )}
          {message.subagentRuns && message.subagentRuns.length > 0 && (
            <SubagentActivityCard runs={message.subagentRuns} />
          )}
          <div
            className={`w-full max-w-[85%] rounded-2xl rounded-bl-md px-5 py-3 shadow-lg md:max-w-[65ch] ${
              message.isError
                ? 'border border-rose-500/40 bg-rose-500/10 text-rose-50'
                : 'border border-gray-700/50 bg-gray-800/80 text-gray-100 backdrop-blur-sm'
            }`}
          >
            {message.isError && (
              <div className='mb-2 flex items-center gap-2 text-sm font-medium text-rose-200'>
                <svg
                  className='h-4 w-4 flex-shrink-0'
                  fill='none'
                  stroke='currentColor'
                  viewBox='0 0 24 24'
                >
                  <path
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    strokeWidth={2}
                    d='M12 9v3.75m0 3.75h.008v.008H12v-.008zm8.25-3.75a8.25 8.25 0 11-16.5 0 8.25 8.25 0 0116.5 0z'
                  />
                </svg>
                <span>系統錯誤</span>
              </div>
            )}
            <div className='text-sm leading-relaxed'>
              <MarkdownContent content={displayContent} />
            </div>
          </div>
          {actionRow}
        </div>
      </div>
    </div>
  );
};

export default MessageBubble;
