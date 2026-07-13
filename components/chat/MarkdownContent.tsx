import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import rehypeHighlightCodeLines from 'rehype-highlight-code-lines';
import type { MessageCitation } from '../../types';
import 'highlight.js/styles/github-dark.css';
import 'katex/dist/katex.min.css';
import 'katex/contrib/mhchem';

interface MarkdownContentProps {
  content: string;
  citations?: MessageCitation[];
  messageKey?: string;
}

const getPlainText = (children: React.ReactNode): string => {
  if (typeof children === 'string') {
    return children;
  }
  if (Array.isArray(children)) {
    return children.map(getPlainText).join('');
  }
  if (React.isValidElement(children)) {
    const element = children as React.ReactElement<{ children?: React.ReactNode }>;
    return getPlainText(element.props.children ?? '');
  }
  return '';
};

const buildCitationHref = (messageKey: string, marker: number): string =>
  `#cite-${messageKey}-${marker}`;

const rewriteCitationMarkers = (
  value: string,
  messageKey: string,
  markers: Set<number>,
): string => {
  return value.replace(/\[(\d+)\]/g, (fullMatch, rawMarker: string) => {
    const marker = Number(rawMarker);
    if (!markers.has(marker)) {
      return fullMatch;
    }

    return `[${marker}](${buildCitationHref(messageKey, marker)})`;
  });
};

const annotateCitationLinks = (
  content: string,
  citations?: MessageCitation[],
  messageKey?: string,
): string => {
  if (!citations?.length || !messageKey) {
    return content;
  }

  const markers = new Set(citations.map(citation => citation.marker));
  const protectedContentPattern =
    /(```[\s\S]*?```|`[^`\n]+`|\$\$[\s\S]*?\$\$|\$(?:\\.|[^$\\\n])+\$)/g;

  return content
    .split(protectedContentPattern)
    .map(segment => {
      if (
        segment.startsWith('```') ||
        (segment.startsWith('`') && segment.endsWith('`')) ||
        segment.startsWith('$')
      ) {
        return segment;
      }

      return rewriteCitationMarkers(segment, messageKey, markers);
    })
    .join('');
};

const MarkdownContent: React.FC<MarkdownContentProps> = ({ content, citations, messageKey }) => {
  const [copyFeedback, setCopyFeedback] = useState<{ target: string; label: string } | null>(null);
  const copyFeedbackTimerRef = useRef<number | null>(null);
  const renderedContent = annotateCitationLinks(content, citations, messageKey);

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

  return (
    <div className='markdown-content'>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex, rehypeHighlight, [rehypeHighlightCodeLines]]}
        skipHtml={false}
        urlTransform={defaultUrlTransform}
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
            const match = /language-([a-z0-9+#.-]+)/i.exec(className || '');
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
          a: ({ children, href }) => {
            if (href?.startsWith('#cite-')) {
              return (
                <a
                  href={href}
                  className='align-super text-xs font-semibold text-cyan-300 no-underline hover:text-cyan-200'
                >
                  {children}
                </a>
              );
            }

            return (
              <a
                href={href}
                target='_blank'
                rel='noopener noreferrer'
                className='text-cyan-400 underline hover:text-cyan-300'
              >
                {children}
              </a>
            );
          },
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
        {renderedContent}
      </ReactMarkdown>
    </div>
  );
};

export default MarkdownContent;
