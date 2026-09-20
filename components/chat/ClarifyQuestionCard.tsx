import React, { useState } from 'react';
import type { ClarifyRecord } from '../../types';
import type { ClarifyRequest, ClarifyUserAnswer } from '../../services/clarifyToolService';

export type ClarifyQuestionCardProps =
  | { record: ClarifyRecord }
  | {
      request: ClarifyRequest;
      onAnswer: (answer: ClarifyUserAnswer) => void;
      onDismiss: () => void;
    };

const ClarifyOptionListView: React.FC<{
  request: ClarifyRequest;
  chosenLabel?: string;
  onOptionPick?: (label: string) => void;
}> = ({ request, chosenLabel, onOptionPick }) => (
  <div className='mt-3 flex flex-col gap-2' role={onOptionPick ? 'group' : undefined}>
    {request.options.map(option => {
      const chosen = chosenLabel !== undefined && option.label === chosenLabel;
      const buttonClass = chosen
        ? 'border-cyan-400/70 bg-cyan-500/15 text-cyan-50'
        : onOptionPick
          ? 'border-gray-600/70 bg-gray-800/60 text-gray-100 transition hover:border-cyan-500/60 hover:bg-gray-700/60'
          : 'border-gray-700/50 bg-gray-800/30 text-gray-400';

      const content = (
        <>
          <span className='flex min-w-0 items-center gap-2'>
            {chosen && (
              <svg
                className='h-4 w-4 flex-shrink-0 text-cyan-300'
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
                aria-hidden='true'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth={2.4}
                  d='M4.5 12.75l6 6 9-13.5'
                />
              </svg>
            )}
            <span className='truncate font-medium'>{option.label}</span>
          </span>
          {option.description && (
            <span
              className={`mt-1 block text-xs leading-5 ${
                chosen ? 'text-cyan-100/80' : 'text-gray-400'
              }`}
            >
              {option.description}
            </span>
          )}
        </>
      );

      return onOptionPick ? (
        <button
          key={option.label}
          type='button'
          onClick={() => onOptionPick(option.label)}
          className={`min-h-11 w-full rounded-xl border px-4 py-2.5 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/70 ${buttonClass}`}
        >
          {content}
        </button>
      ) : (
        <div
          key={option.label}
          className={`w-full rounded-xl border px-4 py-2.5 text-sm ${buttonClass}`}
        >
          {content}
        </div>
      );
    })}
  </div>
);

/**
 * askUser 澄清問題卡片。
 * 傳入 `record` 時為靜態歷史紀錄 (顯示使用者的最終回答);
 * 傳入 `request` + callbacks 時為互動模式,等待使用者點選/自訂輸入。
 */
const ClarifyQuestionCard: React.FC<ClarifyQuestionCardProps> = props => {
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState('');
  const isRecord = 'record' in props;
  if (isRecord) {
    const { record } = props;
    const { request, answer } = record;

    return (
      <section
        className='w-full max-w-[90%] rounded-2xl border border-cyan-500/25 bg-gray-900/60 px-4 py-3 text-sm text-gray-100 shadow-lg md:max-w-[70ch]'
        aria-label='澄清問題紀錄'
        data-testid='clarify-question-card'
      >
        <div className='flex flex-wrap items-center gap-2'>
          {request.header && (
            <span className='rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2 py-0.5 text-xs text-cyan-200'>
              {request.header}
            </span>
          )}
          <span className='text-xs text-gray-400'>澄清問題</span>
        </div>
        <p className='mt-2 whitespace-pre-wrap text-base leading-7 text-gray-100'>
          {request.question}
        </p>
        {answer.kind === 'dismissed' ? (
          <p className='mt-3 rounded-xl border border-dashed border-gray-600/60 px-4 py-2.5 text-sm text-gray-400'>
            使用者略過了此問題
          </p>
        ) : (
          <ClarifyOptionListView
            request={request}
            chosenLabel={answer.kind === 'option' ? answer.label : undefined}
          />
        )}
        {answer.kind === 'custom' && (
          <p
            className='mt-2 whitespace-pre-wrap rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-2.5 text-sm text-cyan-50'
            data-testid='clarify-custom-answer'
          >
            <span className='mr-1 text-cyan-300/80'>自訂回答:</span>
            {answer.text}
          </p>
        )}
      </section>
    );
  }

  const { request, onAnswer, onDismiss } = props;
  const customSubmitBlocked = customText.trim().length === 0;

  return (
    <section
      className='w-full max-w-[90%] rounded-2xl border border-cyan-500/40 bg-gray-900/70 px-4 py-3 text-sm text-gray-100 shadow-lg md:max-w-[70ch]'
      aria-label='助理提問,等待您的選擇'
      data-testid='clarify-question-card'
      data-pending='true'
    >
      <div className='flex flex-wrap items-center gap-2'>
        {request.header && (
          <span className='rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2 py-0.5 text-xs text-cyan-200'>
            {request.header}
          </span>
        )}
        <span className='text-xs font-medium text-cyan-300'>需要您的決定</span>
      </div>
      <p className='mt-2 whitespace-pre-wrap text-base leading-7 text-gray-100'>
        {request.question}
      </p>

      <ClarifyOptionListView
        request={request}
        onOptionPick={label => onAnswer({ kind: 'option', label })}
      />

      {request.allowCustomAnswer && (
        <div className='mt-2'>
          {customOpen ? (
            <div className='rounded-xl border border-gray-600/70 bg-gray-800/60 p-3'>
              <label className='block text-xs text-gray-300' htmlFor='clarify-custom-input'>
                自訂回答
              </label>
              <textarea
                id='clarify-custom-input'
                value={customText}
                onChange={event => setCustomText(event.target.value)}
                rows={2}
                className='mt-1.5 w-full resize-y rounded-lg border border-gray-600 bg-gray-900/80 px-3 py-2 text-sm text-gray-100 placeholder:text-gray-500 focus:border-cyan-500/60 focus:outline-none focus:ring-2 focus:ring-cyan-500/40'
                placeholder='輸入您的回答…'
                data-testid='clarify-custom-input'
              />
              <div className='mt-2 flex justify-end gap-2'>
                <button
                  type='button'
                  onClick={() => setCustomOpen(false)}
                  className='min-h-9 rounded-lg px-3 py-1.5 text-xs text-gray-400 transition hover:bg-gray-700/60 hover:text-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/70'
                >
                  收合
                </button>
                <button
                  type='button'
                  disabled={customSubmitBlocked}
                  onClick={() => {
                    if (!customSubmitBlocked) {
                      onAnswer({ kind: 'custom', text: customText.trim() });
                    }
                  }}
                  className='min-h-9 rounded-lg border border-cyan-400/40 bg-cyan-600 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-cyan-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:cursor-not-allowed disabled:border-gray-600 disabled:bg-gray-700 disabled:text-gray-400'
                  data-testid='clarify-custom-submit'
                >
                  送出回答
                </button>
              </div>
            </div>
          ) : (
            <button
              type='button'
              onClick={() => setCustomOpen(true)}
              className='min-h-9 w-full rounded-xl border border-dashed border-gray-600/70 px-4 py-2 text-sm text-gray-300 transition hover:border-cyan-500/50 hover:text-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/70'
              data-testid='clarify-custom-toggle'
            >
              ✎ 自訂回答
            </button>
          )}
        </div>
      )}

      <div className='mt-3 flex justify-end'>
        <button
          type='button'
          onClick={() => onDismiss()}
          className='min-h-9 rounded-lg px-3 py-1.5 text-xs text-gray-500 transition hover:bg-gray-700/40 hover:text-gray-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/70'
          data-testid='clarify-dismiss'
        >
          略過此問題
        </button>
      </div>
    </section>
  );
};

export default ClarifyQuestionCard;
