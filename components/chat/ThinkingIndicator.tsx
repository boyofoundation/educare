import React from 'react';
import { ThinkingIndicatorProps } from './types';
import { GeminiIcon } from '../ui/Icons';

const ThinkingIndicator: React.FC<ThinkingIndicatorProps> = ({ statusText }) => {
  return (
    <div className='flex justify-start'>
      <div className='flex w-full max-w-3xl gap-3'>
        <div className='flex-shrink-0'>
          <div className='flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-gray-700 to-gray-600 shadow-lg ring-1 ring-gray-600/30'>
            <GeminiIcon className='h-5 w-5 animate-pulse text-cyan-400' />
          </div>
        </div>
        <div className='flex flex-col'>
          <div className='rounded-2xl rounded-bl-md border border-gray-700/50 bg-gray-800/80 px-5 py-4 text-gray-100 shadow-lg backdrop-blur-sm'>
            <div className='flex items-center space-x-3'>
              <div className='flex space-x-1'>
                <div
                  className='h-2 w-2 animate-bounce rounded-full bg-cyan-400'
                  style={{ animationDelay: '0ms' }}
                />
                <div
                  className='h-2 w-2 animate-bounce rounded-full bg-cyan-400'
                  style={{ animationDelay: '150ms' }}
                />
                <div
                  className='h-2 w-2 animate-bounce rounded-full bg-cyan-400'
                  style={{ animationDelay: '300ms' }}
                />
              </div>
              <span className='text-sm font-medium text-gray-300'>
                {statusText || 'AI 正在思考...'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ThinkingIndicator;
