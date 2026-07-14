import React from 'react';
import type { SpeechUtteranceRecord } from '../../types';
import { useSpeechPlayback } from './useSpeechPlayback';

interface SpeechUtteranceCardProps {
  utterance: SpeechUtteranceRecord;
}

const SpeechUtteranceCard: React.FC<SpeechUtteranceCardProps> = ({ utterance }) => {
  const { doc } = utterance;
  const { speaking, supported, speak, stop } = useSpeechPlayback(doc);

  return (
    <section
      className='w-full max-w-[90%] rounded-2xl border border-emerald-500/25 bg-emerald-950/20 px-4 py-3 text-sm text-emerald-50 shadow-lg md:max-w-[70ch]'
      aria-label='語音發音練習'
    >
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div className='min-w-0 flex-1'>
          <div className='font-semibold text-emerald-100'>{utterance.title}</div>
          <p className='mt-1 break-words text-base leading-7 text-white'>{doc.text}</p>
          {doc.note && <p className='mt-1 text-xs leading-5 text-emerald-100/80'>{doc.note}</p>}
          <div className='mt-2 flex flex-wrap gap-2 text-xs text-emerald-100/70'>
            <span>{doc.language}</span>
            <span>rate {doc.rate}</span>
            <span>pitch {doc.pitch}</span>
          </div>
        </div>
        <div className='flex gap-2'>
          <button
            type='button'
            onClick={speaking ? stop : speak}
            disabled={!supported}
            className='inline-flex min-h-10 items-center gap-2 rounded-lg border border-emerald-400/40 bg-emerald-600 px-3 py-2 font-medium text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:border-gray-600 disabled:bg-gray-700 disabled:text-gray-400'
            aria-label={speaking ? '停止播放' : '播放發音'}
            title={supported ? '播放發音' : '此瀏覽器不支援語音播放'}
          >
            <svg className='h-4 w-4' fill='currentColor' viewBox='0 0 24 24' aria-hidden='true'>
              <path d='M4 9.5A1.5 1.5 0 0 1 5.5 8H8l5.2-4.1A1.1 1.1 0 0 1 15 4.76v14.48a1.1 1.1 0 0 1-1.8.86L8 16H5.5A1.5 1.5 0 0 1 4 14.5v-5Zm13.3-.9a1 1 0 0 1 1.4.2 5.2 5.2 0 0 1 0 6.4 1 1 0 0 1-1.6-1.2 3.2 3.2 0 0 0 0-4 1 1 0 0 1 .2-1.4Z' />
            </svg>
            <span>{speaking ? '播放中' : '播放'}</span>
          </button>
          {speaking && (
            <button
              type='button'
              onClick={stop}
              className='inline-flex min-h-10 items-center rounded-lg border border-gray-600 px-3 py-2 font-medium text-gray-100 transition hover:bg-gray-700'
              aria-label='停止播放'
              title='停止播放'
            >
              停止
            </button>
          )}
        </div>
      </div>
    </section>
  );
};

export default SpeechUtteranceCard;
