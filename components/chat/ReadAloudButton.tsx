import React, { useMemo } from 'react';
import type { SpeechUtteranceDoc } from '../../services/speechToolService';
import { getReadAloudLanguage, getReadAloudText } from './readAloudText';
import { useSpeechPlayback } from './useSpeechPlayback';

const LEARNER_SPEECH_RATE = 0.85;
const UNSUPPORTED_TITLE = '此瀏覽器不支援語音播放';

interface ReadAloudButtonProps {
  content: string;
}

const ReadAloudButton: React.FC<ReadAloudButtonProps> = ({ content }) => {
  const speechText = useMemo(() => getReadAloudText(content), [content]);
  const utterance = useMemo<SpeechUtteranceDoc>(
    () => ({
      text: speechText,
      language: getReadAloudLanguage(speechText),
      title: '朗讀回應',
      rate: LEARNER_SPEECH_RATE,
      pitch: 1,
    }),
    [speechText],
  );
  const { speaking, supported, speak, stop } = useSpeechPlayback(utterance);
  const actionLabel = speaking ? '停止朗讀回應' : '朗讀回應';
  const unavailableTitle = supported ? '沒有可朗讀的文字' : UNSUPPORTED_TITLE;

  return (
    <button
      type='button'
      onClick={speaking ? stop : speak}
      disabled={!supported || speechText.length === 0}
      aria-label={actionLabel}
      aria-pressed={speaking}
      title={supported && speechText.length > 0 ? actionLabel : unavailableTitle}
      className='inline-flex items-center gap-1 rounded-md px-2 py-1 text-cyan-300 transition hover:bg-gray-700/60 hover:text-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/70 disabled:cursor-not-allowed disabled:text-gray-500'
    >
      <svg className='h-3.5 w-3.5' fill='currentColor' viewBox='0 0 24 24' aria-hidden='true'>
        {speaking ? (
          <path d='M7 7h10v10H7z' />
        ) : (
          <path d='M4 9.5A1.5 1.5 0 0 1 5.5 8H8l5.2-4.1A1.1 1.1 0 0 1 15 4.76v14.48a1.1 1.1 0 0 1-1.8.86L8 16H5.5A1.5 1.5 0 0 1 4 14.5v-5Zm13.3-.9a1 1 0 0 1 1.4.2 5.2 5.2 0 0 1 0 6.4 1 1 0 0 1-1.6-1.2 3.2 3.2 0 0 0 0-4 1 1 0 0 1 .2-1.4Z' />
        )}
      </svg>
      <span>{speaking ? '停止朗讀' : '朗讀回應'}</span>
    </button>
  );
};

export default ReadAloudButton;
