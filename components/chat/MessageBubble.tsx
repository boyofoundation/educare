import React, { useEffect, useRef, useState } from 'react';
import { MessageBubbleProps } from './types';
import { UserIcon, GeminiIcon } from '../ui/Icons';
import ReactMarkdown from 'react-markdown';
import SubagentActivityCard from './SubagentActivityCard';
import ToolCallCard from './ToolCallCard';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import rehypeHighlightCodeLines from 'rehype-highlight-code-lines';
import 'highlight.js/styles/github-dark.css';

const EMPTY_MESSAGE_FALLBACK = '（本次回覆沒有內容）';

const getPlainText = (children: React.ReactNode): string => {
  if (typeof children === 'string') {
    return children;
  }
  if (Array.isArray(children)) {
    return children.map(getPlainText).join('');
  }
  if (React.isValidElement(children)) {
    const element = children as React.ReactElement<{ children?: React.ReactNode }>;
    const innerChildren = element.props.children ?? '';
    return getPlainText(innerChildren as React.ReactNode);
  }
  return '';
};

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
  const [copyFeedback, setCopyFeedback] = useState<{ target: string; label: string } | null>(null);
  const copyFeedbackTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyFeedbackTimerRef.current !== null) {
        window.clearTimeout(copyFeedbackTimerRef.current);
      }
    };
  }, []);

  const setCopyFeedbackLabel = (target: string, label: string) => {
    if (copyFeedbackTimerRef.current !== null) {
      window.clearTimeout(copyFeedbackTimerRef.current);
    }

    setCopyFeedback({ target, label });
    copyFeedbackTimerRef.current = window.setTimeout(() => {
      setCopyFeedback(null);
    }, 1500);
  };

  const handleCopy = async (text: string, target: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyFeedbackLabel(target, '✓ 已複製');
    } catch {
      setCopyFeedbackLabel(target, '複製失敗');
    }
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
  const messageCopyTarget = `${message.role}-message-copy`;
  const messageCopyLabel =
    copyFeedback?.target === messageCopyTarget
      ? copyFeedback.label
      : isUser
        ? '複製訊息'
        : '複製回應';

  const renderMessageContent = (content: string) => {
    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight, [rehypeHighlightCodeLines]]}
        components={{
          code(props) {
            const { className, children, ...rest } = props as React.ComponentProps<'code'> & {
              node?: {
                position?: {
                  start?: { line?: number };
                  end?: { line?: number };
                };
              };
            };
            const match = /language-(\w+)/.exec(className || '');
            const language = match ? match[1] : '';
            const position = rest.node?.position;
            const startLine = position?.start?.line || 0;
            const endLine = position?.end?.line || 0;
            const isMultiline = Boolean(match) || endLine - startLine > 0;

            if (isMultiline) {
              const codeText = getPlainText(children);
              const codeCopyTarget = `code-copy:${language}:${codeText}`;
              const codeCopyLabel =
                copyFeedback?.target === codeCopyTarget ? copyFeedback.label : '複製';

              return (
                <div className='my-2 overflow-hidden rounded-xl border border-gray-700/70 bg-gray-900'>
                  <div className='flex items-center justify-between gap-3 border-b border-gray-700/70 bg-gray-800/80 px-4 py-2 text-xs'>
                    <span className='text-gray-300'>{language || 'code'}</span>
                    <button
                      type='button'
                      onClick={() => void handleCopy(codeText, codeCopyTarget)}
                      className='rounded-md px-2 py-1 text-gray-300 transition hover:bg-gray-700/60 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/70'
                      title={codeCopyLabel}
                    >
                      {codeCopyLabel}
                    </button>
                  </div>
                  <pre className='w-full overflow-x-auto p-4 text-sm'>
                    <code className={className} {...rest}>
                      {children}
                    </code>
                  </pre>
                </div>
              );
            }

            return (
              <code
                className='rounded bg-gray-700 px-1.5 py-0.5 text-sm font-mono text-cyan-300'
                {...rest}
              >
                {children}
              </code>
            );
          },
          h1: ({ children }) => <h1 className='mb-2 text-xl font-bold text-white'>{children}</h1>,
          h2: ({ children }) => (
            <h2 className='mb-2 text-lg font-semibold text-white'>{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className='mb-1 text-base font-medium text-white'>{children}</h3>
          ),
          p: ({ children }) => <p className='mb-2 leading-relaxed'>{children}</p>,
          ul: ({ children }) => (
            <ul className='mb-2 list-inside list-disc space-y-1'>{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className='mb-2 list-inside list-decimal space-y-1'>{children}</ol>
          ),
          li: ({ children }) => <li className='text-sm'>{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className='my-2 rounded-r border-l-4 border-cyan-500 bg-gray-800/50 py-2 pl-4'>
              {children}
            </blockquote>
          ),
          a: ({ children, href }) => (
            <a
              href={href}
              target='_blank'
              rel='noopener noreferrer'
              className='text-cyan-400 underline hover:text-cyan-300'
            >
              {children}
            </a>
          ),
          strong: ({ children }) => (
            <strong className='font-semibold text-white'>{children}</strong>
          ),
          em: ({ children }) => <em className='italic'>{children}</em>,
          table: ({ children }) => (
            <div className='my-2 overflow-x-auto'>
              <table className='min-w-full border-collapse border border-gray-600'>
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th className='border border-gray-600 bg-gray-700 px-4 py-2 text-left font-semibold'>
              {children}
            </th>
          ),
          td: ({ children }) => <td className='border border-gray-600 px-4 py-2'>{children}</td>,
        }}
      >
        {content}
      </ReactMarkdown>
    );
  };

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
        onClick={() => void handleCopy(displayContent, messageCopyTarget)}
        className='rounded-md px-2 py-1 text-gray-400 opacity-100 transition hover:bg-gray-700/60 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/70 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100'
        title={messageCopyLabel}
      >
        {messageCopyLabel}
      </button>
    </div>
  );

  if (isUser) {
    return (
      <div className='flex justify-end'>
        <div className='flex w-full max-w-3xl flex-row-reverse gap-3'>
          <div className='flex-shrink-0'>
            <div className='flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 shadow-lg ring-2 ring-cyan-400/20'>
              <UserIcon className='h-5 w-5 text-white' />
            </div>
          </div>
          <div className='group flex min-w-0 flex-col items-end'>
            <div className='w-full max-w-[85%] rounded-2xl rounded-br-md bg-gradient-to-br from-cyan-500 to-blue-600 px-5 py-3 text-white shadow-lg md:max-w-[65ch]'>
              <div className='text-sm leading-relaxed'>{renderMessageContent(displayContent)}</div>
            </div>
            {actionRow}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className='flex justify-start'>
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
            <div className='text-sm leading-relaxed'>{renderMessageContent(displayContent)}</div>
          </div>
          {actionRow}
        </div>
      </div>
    </div>
  );
};

export default MessageBubble;
