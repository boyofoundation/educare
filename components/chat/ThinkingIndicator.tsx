import React from 'react';
import { ThinkingIndicatorProps } from './types';
import { GeminiIcon } from '../ui/Icons';

const ThinkingIndicator: React.FC<ThinkingIndicatorProps> = ({ statusText }) => {
  return (
    <div className='flex justify-start'>
      <div className='flex w-full max-w-3xl gap-3'>
        <div className='flex-shrink-0'>
          <div className='w-10 h-10 bg-gradient-to-br from-gray-700 to-gray-600 rounded-full flex items-center justify-center shadow-lg ring-2 ring-gray-600/30'>
            <GeminiIcon className='w-5 h-5 text-cyan-400 animate-pulse' />
          </div>
        </div>
        <div className='flex flex-col'>
          <div className='bg-gray-800/80 backdrop-blur-sm text-gray-100 px-5 py-4 rounded-2xl rounded-bl-md shadow-lg border border-gray-700/50'>
            <div className='flex items-center space-x-3'>
              <div className='flex space-x-1'>
                <div
                  className='w-2 h-2 bg-cyan-400 rounded-full animate-bounce'
                  style={{ animationDelay: '0ms' }}
                ></div>
                <div
                  className='w-2 h-2 bg-cyan-400 rounded-full animate-bounce'
                  style={{ animationDelay: '150ms' }}
                ></div>
                <div
                  className='w-2 h-2 bg-cyan-400 rounded-full animate-bounce'
                  style={{ animationDelay: '300ms' }}
                ></div>
              </div>
              <span className='text-gray-300 text-sm font-medium'>
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
