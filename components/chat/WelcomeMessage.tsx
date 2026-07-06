import React from 'react';
import { WelcomeMessageProps } from './types';
import { GeminiIcon } from '../ui/Icons';

const WelcomeMessage: React.FC<WelcomeMessageProps> = ({
  assistantName,
  assistantDescription,
  sharedMode = false,
}) => {
  return (
    <div data-testid='welcome-message' className='py-12 text-center'>
      <div className='mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-gray-800/80 shadow-lg ring-1 ring-cyan-500/30'>
        <GeminiIcon className='h-10 w-10 text-cyan-400' />
      </div>
      <h3 className='mb-3 text-2xl font-semibold text-white'>{assistantName}</h3>
      {assistantDescription && (
        <p className='mx-auto mb-6 max-w-2xl leading-relaxed text-gray-300'>
          {assistantDescription}
        </p>
      )}
      {sharedMode && (
        <div className='mb-6 inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-gray-800/80 px-4 py-2 text-sm text-gray-300'>
          <span>💡</span>
          <span>分享的 AI 助理 - 您的對話不會永久儲存</span>
        </div>
      )}
      <div className='mx-auto max-w-xl rounded-2xl border border-gray-700/50 bg-gray-800/50 px-6 py-5 shadow-lg backdrop-blur-sm'>
        <p className='text-lg text-gray-300'>
          {assistantDescription ? '讓我們開始聊天吧！' : '問我任何問題，我會幫助您！'}
        </p>
      </div>
    </div>
  );
};

export default WelcomeMessage;
