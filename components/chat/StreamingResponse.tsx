import React, { useMemo } from 'react';
import { StreamingResponseProps } from './types';
import { GeminiIcon } from '../ui/Icons';
import MarkdownContent from './MarkdownContent';
import AgentActivityTimeline from './AgentActivityTimeline';
import GeometryBoard from './GeometryBoard';
import SpeechUtteranceCard from './SpeechUtteranceCard';
import GeneratedImageGrid from './GeneratedImageGrid';

const StreamingResponse: React.FC<StreamingResponseProps> = ({
  content,
  images,
  subagentBatches,
  toolCallLog,
  geometryBoards,
  speechUtterances,
}) => {
  const subagentRuns = useMemo(
    () => Object.values(subagentBatches ?? {}).flat(),
    [subagentBatches],
  );
  const hasActivity = (toolCallLog?.length ?? 0) > 0 || subagentRuns.length > 0;

  return (
    <div className='flex justify-start' aria-live='polite' aria-busy='true'>
      <div className='flex w-full max-w-3xl gap-3'>
        <div className='flex-shrink-0'>
          <div className='flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-gray-700 to-gray-600 shadow-lg ring-1 ring-gray-600/30'>
            <GeminiIcon className='h-5 w-5 text-cyan-400' />
          </div>
        </div>
        <div className='flex min-w-0 flex-1 flex-col gap-3'>
          {hasActivity && (
            <AgentActivityTimeline toolCalls={toolCallLog} subagentRuns={subagentRuns} live />
          )}
          {geometryBoards?.map(board => (
            <GeometryBoard key={board.id} board={board} />
          ))}
          {speechUtterances?.map(utterance => (
            <SpeechUtteranceCard key={utterance.id} utterance={utterance} />
          ))}
          {images?.length ? <GeneratedImageGrid images={images} /> : null}
          {content !== '' && (
            <div className='relative w-full max-w-[90%] rounded-2xl rounded-bl-md border border-gray-700/50 bg-gray-800/80 px-5 py-4 text-gray-100 shadow-lg backdrop-blur-sm md:max-w-[70ch] md:px-6'>
              <div className='text-base leading-7'>
                <MarkdownContent content={content} />
                <span className='ml-1 inline-block h-4 w-0.5 animate-pulse bg-cyan-400' />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default StreamingResponse;
