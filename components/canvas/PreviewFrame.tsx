import React, { useEffect, useRef, useState } from 'react';
import { HtmlProjectPreviewArtifact } from '../../types';
import {
  isHarnessMessage,
  previewRuntimeDiagnostics,
} from '../../services/previewRuntimeDiagnostics';

interface PreviewFrameProps {
  preview: HtmlProjectPreviewArtifact | null;
}

type PreviewViewport = 'desktop' | 'tablet' | 'mobile';

interface ViewportOption {
  id: PreviewViewport;
  label: string;
  title: string;
  width: string;
  iconPath: string;
}

const VIEWPORT_OPTIONS: ViewportOption[] = [
  {
    id: 'desktop',
    label: 'Desktop',
    title: 'Desktop（滿版）',
    width: '100%',
    iconPath:
      'M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25',
  },
  {
    id: 'tablet',
    label: 'Tablet',
    title: 'Tablet（768px）',
    width: '768px',
    iconPath:
      'M10.5 19.5h3m-6.75 2.25h10.5a2.25 2.25 0 002.25-2.25v-15a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 4.5v15a2.25 2.25 0 002.25 2.25z',
  },
  {
    id: 'mobile',
    label: 'Mobile',
    title: 'Mobile（390px）',
    width: '390px',
    iconPath:
      'M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3',
  },
];

export function PreviewFrame({ preview }: PreviewFrameProps): React.JSX.Element {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [viewport, setViewport] = useState<PreviewViewport>('desktop');
  const [isFrameLoading, setIsFrameLoading] = useState(true);
  const [warningsExpanded, setWarningsExpanded] = useState(false);

  const projectId = preview?.projectId;
  const previewVersion = preview?.previewVersion;
  const previewUrl = preview?.url;
  const isMounted = Boolean(preview?.previewReady && previewUrl);

  useEffect(() => {
    setIsFrameLoading(true);
    setWarningsExpanded(false);
  }, [previewUrl, previewVersion]);

  useEffect(() => {
    if (!isMounted || projectId === undefined || previewVersion === undefined) {
      return;
    }

    const expected = { projectId, previewVersion };

    const handleMessage = (event: MessageEvent) => {
      const source = iframeRef.current?.contentWindow ?? null;
      if (event.source !== source) {
        return;
      }
      if (!isHarnessMessage(event.data, expected, { expectedSource: source })) {
        return;
      }
      const data = event.data;
      if (data.type === 'ready') {
        previewRuntimeDiagnostics.recordReadyAck(projectId, previewVersion);
      } else if (data.type === 'runtime-errors') {
        previewRuntimeDiagnostics.recordRuntimeErrors(projectId, previewVersion, data.errors);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [isMounted, projectId, previewVersion]);

  if (!preview) {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-gray-700 bg-gray-900/70 p-8 text-center'>
        <span className='flex h-12 w-12 items-center justify-center rounded-2xl border border-gray-700/70 bg-gray-800/70'>
          <svg
            className='h-6 w-6 text-gray-500'
            fill='none'
            stroke='currentColor'
            strokeWidth={1.5}
            viewBox='0 0 24 24'
            aria-hidden='true'
          >
            <path
              strokeLinecap='round'
              strokeLinejoin='round'
              d='M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5'
            />
          </svg>
        </span>
        <p className='text-sm font-medium text-gray-300'>尚未建立專案預覽</p>
        <p className='text-xs text-gray-500'>請先要求助理建立或更新 HTML project。</p>
      </div>
    );
  }

  if (!preview.previewReady || !preview.url) {
    return (
      <div className='rounded-2xl border border-red-500/30 bg-red-950/20 p-4 text-sm text-red-100'>
        <p className='font-semibold'>Preview error</p>
        <p className='mt-2 text-red-200'>{preview.error || 'Unknown preview error.'}</p>
        {preview.warnings.length > 0 && (
          <ul className='mt-3 list-disc space-y-1 pl-5 text-xs text-red-200/90'>
            {preview.warnings.map(warning => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const warnings = preview.warnings;
  const hiddenWarningCount = warnings.length - 1;
  const activeViewport =
    VIEWPORT_OPTIONS.find(option => option.id === viewport) ?? VIEWPORT_OPTIONS[0];

  return (
    <div className='flex h-full min-h-0 flex-col gap-3 overflow-hidden'>
      {warnings.length > 0 && (
        <div className='rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100'>
          {warningsExpanded ? (
            <ul className='list-disc space-y-1 pl-4'>
              {warnings.map(warning => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : (
            <p>{warnings[0]}</p>
          )}
          {hiddenWarningCount > 0 && (
            <button
              type='button'
              onClick={() => setWarningsExpanded(expanded => !expanded)}
              aria-expanded={warningsExpanded}
              className='mt-1.5 rounded font-medium text-amber-300 underline-offset-2 transition hover:text-amber-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70'
            >
              {warningsExpanded ? '收合警告' : `還有 ${hiddenWarningCount} 則警告`}
            </button>
          )}
        </div>
      )}

      <div className='flex items-center justify-center'>
        <div
          role='group'
          aria-label='預覽裝置寬度'
          className='inline-flex items-center gap-0.5 rounded-lg border border-gray-800 bg-gray-900/80 p-0.5'
        >
          {VIEWPORT_OPTIONS.map(option => {
            const isActive = viewport === option.id;
            return (
              <button
                key={option.id}
                type='button'
                onClick={() => setViewport(option.id)}
                title={option.title}
                aria-label={option.label}
                aria-pressed={isActive}
                className={`inline-flex h-7 w-8 items-center justify-center rounded-md transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/70 ${
                  isActive
                    ? 'bg-gray-700/80 text-cyan-300'
                    : 'text-gray-500 hover:bg-gray-800 hover:text-gray-200'
                }`}
              >
                <svg
                  className='h-4 w-4'
                  fill='none'
                  stroke='currentColor'
                  strokeWidth={1.8}
                  viewBox='0 0 24 24'
                  aria-hidden='true'
                >
                  <path strokeLinecap='round' strokeLinejoin='round' d={option.iconPath} />
                </svg>
              </button>
            );
          })}
        </div>
      </div>

      <div className='min-h-0 flex-1 overflow-auto'>
        <div
          data-testid='preview-frame-viewport'
          className='relative mx-auto h-full min-h-[320px] transition-all duration-300'
          style={{ width: activeViewport.width, maxWidth: '100%' }}
        >
          <iframe
            ref={iframeRef}
            title='HTML project preview'
            src={preview.url}
            sandbox='allow-scripts allow-forms allow-modals'
            onLoad={() => setIsFrameLoading(false)}
            className='h-full w-full rounded-2xl border border-gray-700 bg-white'
          />
          {isFrameLoading && (
            <div
              role='status'
              aria-live='polite'
              className='absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-2xl bg-gray-950/70 backdrop-blur-sm'
            >
              <svg
                className='h-6 w-6 animate-spin text-cyan-400'
                viewBox='0 0 24 24'
                fill='none'
                aria-hidden='true'
              >
                <circle
                  className='opacity-25'
                  cx='12'
                  cy='12'
                  r='10'
                  stroke='currentColor'
                  strokeWidth='3'
                />
                <path
                  className='opacity-75'
                  fill='currentColor'
                  d='M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z'
                />
              </svg>
              <span className='text-xs text-gray-300'>載入預覽中…</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
