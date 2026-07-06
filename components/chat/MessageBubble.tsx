import React, { useState } from 'react';
import { MessageBubbleProps } from './types';
import { UserIcon, GeminiIcon } from '../ui/Icons';
import ReactMarkdown from 'react-markdown';
import SubagentActivityCard from './SubagentActivityCard';
import ToolCallCard from './ToolCallCard';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import rehypeHighlightCodeLines from 'rehype-highlight-code-lines';
import 'highlight.js/styles/github-dark.css';

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

const MessageBubble: React.FC<MessageBubbleProps> = ({ message, index: _index }) => {
  // G6: 合成 (synthetic) 訊息預設摺疊,使用者可展開檢視。
  const [syntheticExpanded, setSyntheticExpanded] = useState(false);

  if (message.synthetic) {
    return (
      <div className='flex justify-start' data-testid='synthetic-message'>
        <div className='max-w-4xl'>
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

  const renderMessageContent = (content: string) => {
    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight, [rehypeHighlightCodeLines]]}
        components={{
          // 自定義 code 區塊樣式
          code(props) {
            const { className, children, ...rest } = props;
            const match = /language-(\w+)/.exec(className || '');
            const language = match ? match[1] : '';

            // check position
            const node = rest.node;
            const position = node?.position;
            const start_line = position?.start.line || 0;
            const end_line = position?.end.line || 0;
            const checker = end_line - start_line;

            if (match || checker) {
              // 多行代碼塊
              const code_text = getPlainText(children);
              return (
                <div className='bg-gray-900 rounded-md my-2 overflow-x-auto w-full max-w-sm sm:max-w-md md:max-w-lg lg:max-w-2xl mx-auto'>
                  <div className='flex justify-between items-center px-4 py-2 bg-gray-700 text-xs'>
                    <span className='text-gray-300'>{language || 'code'}</span>
                    <button
                      onClick={() => navigator.clipboard.writeText(code_text)}
                      className='text-gray-400 hover:text-white transition-colors'
                    >
                      複製
                    </button>
                  </div>
                  <pre className='p-4 text-sm mx-auto'>
                    <code className={className} {...rest}>
                      {children}
                    </code>
                  </pre>
                </div>
              );
            } else {
              // 內聯代碼
              return (
                <code
                  className='bg-gray-700 text-cyan-300 px-1.5 py-0.5 rounded text-sm font-mono'
                  {...rest}
                >
                  {children}
                </code>
              );
            }
          },
          // 自定義其他元素樣式
          h1: ({ children }) => <h1 className='text-xl font-bold mb-2 text-white'>{children}</h1>,
          h2: ({ children }) => (
            <h2 className='text-lg font-semibold mb-2 text-white'>{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className='text-base font-medium mb-1 text-white'>{children}</h3>
          ),
          p: ({ children }) => <p className='mb-2 leading-relaxed'>{children}</p>,
          ul: ({ children }) => (
            <ul className='list-disc list-inside mb-2 space-y-1'>{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className='list-decimal list-inside mb-2 space-y-1'>{children}</ol>
          ),
          li: ({ children }) => <li className='text-sm'>{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className='border-l-4 border-cyan-500 pl-4 my-2 bg-gray-800/50 py-2 rounded-r'>
              {children}
            </blockquote>
          ),
          a: ({ children, href }) => (
            <a
              href={href}
              target='_blank'
              rel='noopener noreferrer'
              className='text-cyan-400 hover:text-cyan-300 underline'
            >
              {children}
            </a>
          ),
          strong: ({ children }) => (
            <strong className='font-semibold text-white'>{children}</strong>
          ),
          em: ({ children }) => <em className='italic'>{children}</em>,
          table: ({ children }) => (
            <div className='overflow-x-auto my-2'>
              <table className='min-w-full border-collapse border border-gray-600'>
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th className='border border-gray-600 px-4 py-2 bg-gray-700 font-semibold text-left'>
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

  return (
    <div className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
      {message.role === 'user' ? (
        /* User Message - Right Side */
        <div className='flex flex-row-reverse gap-3 max-w-4xl'>
          <div className='flex-shrink-0'>
            <div className='w-10 h-10 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-full flex items-center justify-center shadow-lg ring-2 ring-cyan-400/20'>
              <UserIcon className='w-5 h-5 text-white' />
            </div>
          </div>
          <div className='flex flex-col items-end group'>
            <div className='bg-gradient-to-br from-cyan-500 to-blue-600 text-white px-5 py-3 rounded-2xl rounded-br-md shadow-lg max-w-lg relative'>
              <div className='text-sm leading-relaxed'>{renderMessageContent(message.content)}</div>
              {/* Message actions */}
              <div className='absolute -left-12 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-200'>
                <button
                  onClick={() => navigator.clipboard.writeText(message.content)}
                  className='p-2 text-gray-400 hover:text-gray-600 bg-white/90 rounded-lg shadow-md hover:shadow-lg transition-all duration-200'
                  title='複製訊息'
                >
                  <svg className='w-4 h-4' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                    <path
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      strokeWidth={2}
                      d='M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z'
                    />
                  </svg>
                </button>
              </div>
            </div>
            {/* Timestamp */}
            <div className='text-xs text-gray-400 mt-2 px-2 opacity-60 group-hover:opacity-100 transition-opacity duration-200 bg-gray-800/30 rounded-full px-3 py-1'>
              {new Date().toLocaleTimeString('zh-TW', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </div>
          </div>
        </div>
      ) : (
        /* Assistant Message - Left Side */
        <div className='flex gap-3 max-w-4xl'>
          <div className='flex-shrink-0'>
            <div className='w-10 h-10 bg-gradient-to-br from-gray-700 to-gray-600 rounded-full flex items-center justify-center shadow-lg ring-2 ring-gray-600/30'>
              <GeminiIcon className='w-5 h-5 text-cyan-400' />
            </div>
          </div>
          <div className='flex flex-col group gap-3'>
            {message.toolCallLog && message.toolCallLog.length > 0 && (
              <ToolCallCard records={message.toolCallLog} />
            )}
            {message.subagentRuns && message.subagentRuns.length > 0 && (
              <SubagentActivityCard runs={message.subagentRuns} />
            )}
            <div className='bg-gray-800/80 backdrop-blur-sm text-gray-100 px-5 py-3 rounded-2xl rounded-bl-md shadow-lg border border-gray-700/50 relative'>
              <div className='text-sm leading-relaxed'>{renderMessageContent(message.content)}</div>
              {/* Message actions */}
              <div className='absolute -right-12 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-200'>
                <button
                  onClick={() => navigator.clipboard.writeText(message.content)}
                  className='p-2 text-gray-400 hover:text-gray-600 bg-white/90 rounded-lg shadow-md hover:shadow-lg transition-all duration-200'
                  title='複製回應'
                >
                  <svg className='w-4 h-4' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                    <path
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      strokeWidth={2}
                      d='M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z'
                    />
                  </svg>
                </button>
              </div>
            </div>
            {/* Timestamp */}
            <div className='text-xs text-gray-400 mt-2 px-2 opacity-60 group-hover:opacity-100 transition-opacity duration-200 bg-gray-800/30 rounded-full px-3 py-1'>
              {new Date().toLocaleTimeString('zh-TW', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MessageBubble;
