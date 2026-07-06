import React from 'react';
import { StreamingResponseProps } from './types';
import { GeminiIcon } from '../ui/Icons';
import ReactMarkdown from 'react-markdown';
import SubagentActivityCard from './SubagentActivityCard';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';

const StreamingResponse: React.FC<StreamingResponseProps> = ({ content, subagentBatches }) => {
  const renderMessageContent = (content: string) => {
    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          // 自定義 code 區塊樣式
          code(props: React.ComponentProps<'code'>) {
            const { className, children, ...rest } = props;
            const match = /language-(\w+)/.exec(className || '');
            const language = match ? match[1] : '';

            if (match) {
              // 多行代碼塊
              return (
                <div className='bg-gray-900 rounded-md my-2 overflow-hidden'>
                  <div className='flex justify-between items-center px-4 py-2 bg-gray-700 text-xs'>
                    <span className='text-gray-300'>{language || 'code'}</span>
                    <button
                      onClick={() => navigator.clipboard.writeText(String(children))}
                      className='text-gray-400 hover:text-white transition-colors'
                    >
                      複製
                    </button>
                  </div>
                  <pre className='p-4 text-sm overflow-x-auto'>
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
    <div className='flex justify-start'>
      <div className='flex gap-3 max-w-4xl'>
        <div className='flex-shrink-0'>
          <div className='w-10 h-10 bg-gradient-to-br from-gray-700 to-gray-600 rounded-full flex items-center justify-center shadow-lg ring-2 ring-cyan-400/30'>
            <GeminiIcon className='w-5 h-5 text-cyan-400' />
          </div>
        </div>
        <div className='flex flex-col group gap-3'>
          {subagentBatches &&
            Object.entries(subagentBatches).map(([batchId, runs]) => (
              <SubagentActivityCard key={batchId} runs={runs} />
            ))}
          <div className='bg-gray-800/80 backdrop-blur-sm text-gray-100 px-5 py-3 rounded-2xl rounded-bl-md shadow-lg border border-gray-700/50 relative'>
            <div className='text-sm leading-relaxed'>
              {renderMessageContent(content)}
              <span className='inline-block w-0.5 h-4 bg-cyan-400 ml-1 animate-pulse'></span>
            </div>
            {/* Streaming indicator */}
            <div className='absolute -top-2 -right-2 w-4 h-4 bg-cyan-500 rounded-full animate-pulse shadow-lg ring-2 ring-cyan-400/30'></div>
          </div>
          {/* Real-time timestamp */}
          <div className='text-xs text-gray-400 mt-1 px-2 opacity-60'>正在輸入...</div>
        </div>
      </div>
    </div>
  );
};

export default StreamingResponse;
