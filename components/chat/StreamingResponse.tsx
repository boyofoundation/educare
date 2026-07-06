import React from 'react';
import { StreamingResponseProps } from './types';
import { GeminiIcon } from '../ui/Icons';
import MarkdownContent from './MarkdownContent';
import SubagentActivityCard from './SubagentActivityCard';
import ToolCallCard from './ToolCallCard';

const StreamingResponse: React.FC<StreamingResponseProps> = ({
  content,
  subagentBatches,
  toolCallLog,
}) => {
  return (
    <div className='flex justify-start' aria-live='polite' aria-busy='true'>
      <div className='flex w-full max-w-3xl gap-3'>
        <div className='flex-shrink-0'>
          <div className='flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-gray-700 to-gray-600 shadow-lg ring-1 ring-cyan-400/30'>
            <GeminiIcon className='h-5 w-5 text-cyan-400' />
          </div>
        </div>
        <div className='flex flex-col gap-3'>
          {toolCallLog && toolCallLog.length > 0 && <ToolCallCard records={toolCallLog} />}
          {subagentBatches &&
            Object.entries(subagentBatches).map(([batchId, runs]) => (
              <SubagentActivityCard key={batchId} runs={runs} />
            ))}
          <div className='relative rounded-2xl rounded-bl-md border border-gray-700/50 bg-gray-800/80 px-5 py-3 text-gray-100 shadow-lg backdrop-blur-sm'>
            <div className='text-sm leading-relaxed'>
              <MarkdownContent content={content} />
              <span className='ml-1 inline-block h-4 w-0.5 animate-pulse bg-cyan-400' />
            </div>
          </div>
          <div className='mt-1 px-2 text-xs text-gray-300 opacity-70'>正在輸入...</div>
        </div>
      </div>
    </div>
  );
};

export default StreamingResponse;
