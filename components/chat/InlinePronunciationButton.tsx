import React from 'react';
import type { SpeechUtteranceDoc } from '../../services/speechToolService';
import { useSpeechPlayback } from './useSpeechPlayback';

interface InlinePronunciationButtonProps {
  children: React.ReactNode;
  utterance: SpeechUtteranceDoc;
}

const InlinePronunciationButton: React.FC<InlinePronunciationButtonProps> = ({
  children,
  utterance,
}) => {
  const { speaking, supported, speak, stop } = useSpeechPlayback(utterance);
  const actionLabel = speaking ? `停止播放：${utterance.text}` : `播放發音：${utterance.text}`;

  return (
    <span className='inline-flex items-center gap-1 align-baseline'>
      <span>{children}</span>
      <button
        type='button'
        onClick={speaking ? stop : speak}
        disabled={!supported}
        aria-label={actionLabel}
        aria-pressed={speaking}
        title={supported ? actionLabel : '此瀏覽器不支援語音播放'}
        className='inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-emerald-300 transition hover:bg-emerald-500/20 hover:text-emerald-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70 disabled:cursor-not-allowed disabled:text-gray-500'
      >
        <svg className='h-4 w-4' fill='currentColor' viewBox='0 0 24 24' aria-hidden='true'>
          <path d='M4 9.5A1.5 1.5 0 0 1 5.5 8H8l5.2-4.1A1.1 1.1 0 0 1 15 4.76v14.48a1.1 1.1 0 0 1-1.8.86L8 16H5.5A1.5 1.5 0 0 1 4 14.5v-5Zm13.3-.9a1 1 0 0 1 1.4.2 5.2 5.2 0 0 1 0 6.4 1 1 0 0 1-1.6-1.2 3.2 3.2 0 0 0 0-4 1 1 0 0 1 .2-1.4Z' />
        </svg>
      </button>
    </span>
  );
};

export default InlinePronunciationButton;
