import React, { useContext, useEffect, useRef, useState } from 'react';
import { MessageBubbleProps } from './types';
import { UserIcon, GeminiIcon } from '../ui/Icons';
import AgentActivityTimeline from './AgentActivityTimeline';
import GeometryBoard from './GeometryBoard';
import SpeechUtteranceCard from './SpeechUtteranceCard';
import MarkdownContent from './MarkdownContent';
import { AppContext } from '../core/useAppContext';
import { attachmentToDataUrl } from '../../services/imageAttachmentService';
import type { MessageAttachment, RouteProposal } from '../../types';

const EMPTY_MESSAGE_FALLBACK = '（本次回覆沒有內容）';

const AttachmentImageGrid: React.FC<{ attachments: MessageAttachment[] }> = ({ attachments }) => {
  const images = attachments.filter(attachment => attachment.kind === 'image');
  if (images.length === 0) {
    return null;
  }

  return (
    <div className='mb-3 flex flex-wrap gap-2' aria-label='訊息附加圖片'>
      {images.map((attachment, index) => (
        <img
          key={`${attachment.name ?? 'image'}-${index}`}
          src={attachmentToDataUrl(attachment)}
          alt={attachment.name ?? `附加圖片 ${index + 1}`}
          loading='lazy'
          className='max-h-48 max-w-full rounded-xl border border-white/20 object-contain'
        />
      ))}
    </div>
  );
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

const RouteProposalCard: React.FC<{
  proposal: RouteProposal;
  onAccept?: (proposal: RouteProposal) => Promise<void>;
  onDecline?: (proposal: RouteProposal) => Promise<void>;
}> = ({ proposal, onAccept, onDecline }) => {
  const context = useContext(AppContext);
  const pending = proposal.status === 'pending';

  if (proposal.automatic) {
    return (
      <details
        className='w-full max-w-[85%] rounded-xl border border-gray-700 bg-gray-800/50 px-4 py-3 text-sm text-gray-200 md:max-w-[65ch]'
        aria-label='自動轉接紀錄'
      >
        <summary className='cursor-pointer font-medium text-gray-100'>
          已自動轉接至 {proposal.targetAssistantName}
        </summary>
        <p className='mt-2 text-gray-300'>{proposal.reason}</p>
      </details>
    );
  }
  const statusLabel: Record<RouteProposal['status'], string> = {
    pending: '建議轉接',
    accepted: '已轉接',
    declined: '已婉拒',
    failed: '轉接失敗',
  };
  return (
    <section
      className='w-full max-w-[85%] rounded-2xl border border-cyan-500/30 bg-cyan-950/30 px-4 py-3 text-sm text-cyan-50 md:max-w-[65ch]'
      aria-label='助理轉接建議'
    >
      <div className='font-semibold text-cyan-200'>
        {statusLabel[proposal.status]}：{proposal.targetAssistantName}
      </div>
      <p className='mt-1 text-gray-200'>{proposal.reason}</p>
      {pending && (
        <div className='mt-3 flex gap-2'>
          <button
            type='button'
            onClick={() =>
              void (onAccept?.(proposal) ?? context?.actions.acceptRouteProposal(proposal))
            }
            className='rounded-lg bg-cyan-600 px-3 py-1.5 font-medium text-white hover:bg-cyan-500'
          >
            轉接至 {proposal.targetAssistantName}
          </button>
          <button
            type='button'
            onClick={() =>
              void (onDecline?.(proposal) ?? context?.actions.declineRouteProposal(proposal))
            }
            className='rounded-lg border border-gray-600 px-3 py-1.5 text-gray-200 hover:bg-gray-700'
          >
            留在原助理
          </button>
        </div>
      )}
    </section>
  );
};

const MessageBubbleBase: React.FC<MessageBubbleProps> = ({
  message,
  index,
  citationContentsById,
  onAcceptRouteProposal,
  onDeclineRouteProposal,
}) => {
  const [syntheticExpanded, setSyntheticExpanded] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const copyFeedbackTimerRef = useRef<number | null>(null);
  const messageKey = `msg-${index}`;

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
            className='inline-flex min-h-10 items-center gap-2 rounded-full border border-gray-700/60 bg-gray-800/40 px-3 py-2 text-sm text-gray-300 transition hover:border-gray-600 hover:text-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/70'
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
            <div className='mt-2 rounded-xl border border-dashed border-gray-700/50 bg-gray-900/40 px-4 py-3 text-sm leading-6 text-gray-300'>
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
  const citations = message.citations ?? [];

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
            <div className='flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 shadow-lg ring-1 ring-cyan-400/20'>
              <UserIcon className='h-5 w-5 text-white' />
            </div>
          </div>
          <div className='group flex min-w-0 flex-col items-end'>
            <div className='w-full max-w-[90%] rounded-2xl rounded-br-md bg-gradient-to-br from-cyan-500 to-blue-600 px-5 py-4 text-white shadow-lg md:max-w-[70ch] md:px-6'>
              {message.attachments && <AttachmentImageGrid attachments={message.attachments} />}
              {(message.content.trim() !== '' || !message.attachments?.length) && (
                <div className='text-base leading-7'>
                  <MarkdownContent content={displayContent} />
                </div>
              )}
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
          <div className='flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-gray-700 to-gray-600 shadow-lg ring-1 ring-gray-600/30'>
            <GeminiIcon className='h-5 w-5 text-cyan-400' />
          </div>
        </div>
        <div className='group flex min-w-0 flex-col gap-3'>
          <div
            className={`w-full max-w-[90%] rounded-2xl rounded-bl-md px-5 py-4 shadow-lg md:max-w-[70ch] md:px-6 ${
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
            <div className='text-base leading-7'>
              <MarkdownContent
                content={displayContent}
                citations={citations}
                messageKey={messageKey}
              />
            </div>
          </div>
          {message.geometryBoards?.map(board => (
            <GeometryBoard key={board.id} board={board} />
          ))}
          {message.speechUtterances?.map(utterance => (
            <SpeechUtteranceCard key={utterance.id} utterance={utterance} />
          ))}
          <AgentActivityTimeline
            toolCalls={message.toolCallLog}
            subagentRuns={message.subagentRuns}
          />
          {message.routeProposal && (
            <RouteProposalCard
              proposal={message.routeProposal}
              onAccept={onAcceptRouteProposal}
              onDecline={onDeclineRouteProposal}
            />
          )}
          {citations.length > 0 && (
            <details
              data-testid='citation-list'
              className='w-full max-w-[85%] rounded-2xl border border-cyan-500/20 bg-gray-900/60 px-4 py-3 text-sm text-gray-200 md:max-w-[65ch]'
            >
              <summary className='flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-1 text-sm font-medium text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400'>
                <span>📚 參考資料</span>
                <span className='text-xs font-normal text-cyan-100/75'>
                  {citations.length} 個來源
                </span>
              </summary>
              <div className='mt-3 space-y-2'>
                {citations.map(citation => {
                  const sourceContent = citationContentsById?.[citation.chunkId];
                  const resolvedContent = sourceContent ?? citation.excerpt;
                  const sourceMissing = !sourceContent;

                  return (
                    <details
                      key={citation.chunkId}
                      id={`cite-${messageKey}-${citation.marker}`}
                      className='rounded-xl border border-gray-700/70 bg-gray-800/80 px-3 py-2'
                    >
                      <summary className='cursor-pointer list-none text-sm font-medium text-cyan-100'>
                        <span className='mr-2'>[{citation.marker}]</span>
                        <span>
                          {citation.fileName} · 段落 {citation.chunkIndex + 1}
                        </span>
                      </summary>
                      <div className='mt-3 space-y-2'>
                        {sourceMissing && (
                          <p className='text-xs text-amber-200'>
                            來源檔案已更新或移除，以下顯示儲存時的摘錄。
                          </p>
                        )}
                        <pre className='whitespace-pre-wrap rounded-lg bg-gray-950/70 p-3 text-xs text-gray-100'>
                          {resolvedContent}
                        </pre>
                      </div>
                    </details>
                  );
                })}
              </div>
            </details>
          )}
          {actionRow}
        </div>
      </div>
    </div>
  );
};

// Phase 4 note: session switches and checkpoint merges still replace the backing array,
// and ChatContainer currently uses list index as the rendered key. Memoization therefore
// mainly protects already-committed rows from rerendering during live streaming updates.
const MessageBubble = React.memo(MessageBubbleBase);

export default MessageBubble;
