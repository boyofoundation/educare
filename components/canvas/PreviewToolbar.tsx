import React from 'react';

interface PreviewToolbarProps {
  projectId: string;
  previewVersion: number;
  previewUrl?: string;
  isRefreshing: boolean;
  isDownloadingZip?: boolean;
  isUploadingFiles?: boolean;
  onRefresh: () => Promise<void> | void;
  onDownloadZip?: () => Promise<void> | void;
  onUploadFiles?: () => Promise<void> | void;
  onClose?: () => void;
}

const iconButtonClass =
  'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-400 transition hover:bg-gray-800 hover:text-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/70 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-gray-400';

function Spinner(): React.JSX.Element {
  return (
    <svg className='h-4 w-4 animate-spin' viewBox='0 0 24 24' fill='none' aria-hidden='true'>
      <circle className='opacity-25' cx='12' cy='12' r='10' stroke='currentColor' strokeWidth='3' />
      <path className='opacity-75' fill='currentColor' d='M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z' />
    </svg>
  );
}

export function PreviewToolbar({
  projectId,
  previewVersion,
  previewUrl,
  isRefreshing,
  isDownloadingZip = false,
  isUploadingFiles = false,
  onRefresh,
  onDownloadZip,
  onUploadFiles,
  onClose,
}: PreviewToolbarProps): React.JSX.Element {
  const isBusy = isRefreshing || isDownloadingZip || isUploadingFiles;

  return (
    <div className='flex items-center justify-between gap-3 border-b border-gray-700/60 px-4 py-3'>
      <div className='flex min-w-0 items-center gap-2'>
        <p className='shrink-0 text-sm font-semibold text-white'>HTML Preview</p>
        <span className='shrink-0 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-px text-[10px] font-medium tabular-nums text-cyan-300'>
          v{previewVersion}
        </span>
        <span className='truncate font-mono text-[11px] text-gray-500' title={projectId}>
          {projectId}
        </span>
      </div>
      <div className='flex items-center gap-1'>
        <button
          type='button'
          onClick={() => onRefresh()}
          disabled={isBusy}
          title={isRefreshing ? '重新整理中…' : '重新整理預覽'}
          aria-label='Refresh'
          className={iconButtonClass}
        >
          <svg
            className={`h-4 w-4 ${isRefreshing ? 'animate-spin text-cyan-400' : ''}`}
            fill='none'
            stroke='currentColor'
            strokeWidth={1.8}
            viewBox='0 0 24 24'
            aria-hidden='true'
          >
            <path
              strokeLinecap='round'
              strokeLinejoin='round'
              d='M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99'
            />
          </svg>
        </button>
        {previewUrl && (
          <a
            href={previewUrl}
            target='_blank'
            rel='noreferrer noopener'
            title='在新分頁開啟完整預覽'
            aria-label='Open tab'
            aria-disabled={isBusy || undefined}
            className={`${iconButtonClass} ${isBusy ? 'pointer-events-none opacity-40' : ''}`}
          >
            <svg
              className='h-4 w-4'
              fill='none'
              stroke='currentColor'
              strokeWidth={1.8}
              viewBox='0 0 24 24'
              aria-hidden='true'
            >
              <path
                strokeLinecap='round'
                strokeLinejoin='round'
                d='M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25'
              />
            </svg>
          </a>
        )}
        {onUploadFiles && (
          <button
            type='button'
            onClick={() => onUploadFiles()}
            disabled={isBusy}
            title={isUploadingFiles ? '上傳中…' : '上傳檔案到專案'}
            aria-label={isUploadingFiles ? 'Uploading…' : 'Upload files'}
            className={iconButtonClass}
          >
            {isUploadingFiles ? (
              <Spinner />
            ) : (
              <svg
                className='h-4 w-4'
                fill='none'
                stroke='currentColor'
                strokeWidth={1.8}
                viewBox='0 0 24 24'
                aria-hidden='true'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  d='M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5'
                />
              </svg>
            )}
          </button>
        )}
        {onDownloadZip && (
          <button
            type='button'
            onClick={() => onDownloadZip()}
            disabled={isBusy}
            title={isDownloadingZip ? '下載中…' : '下載專案 ZIP'}
            aria-label={isDownloadingZip ? 'Downloading…' : 'Download ZIP'}
            className={iconButtonClass}
          >
            {isDownloadingZip ? (
              <Spinner />
            ) : (
              <svg
                className='h-4 w-4'
                fill='none'
                stroke='currentColor'
                strokeWidth={1.8}
                viewBox='0 0 24 24'
                aria-hidden='true'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  d='M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3'
                />
              </svg>
            )}
          </button>
        )}
        {onClose && (
          <>
            <span className='mx-1 h-5 w-px bg-gray-700/60' aria-hidden='true' />
            <button
              type='button'
              onClick={onClose}
              title='隱藏預覽面板'
              aria-label='Hide'
              className={iconButtonClass}
            >
              <svg
                className='h-4 w-4'
                fill='none'
                stroke='currentColor'
                strokeWidth={1.8}
                viewBox='0 0 24 24'
                aria-hidden='true'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  d='M11.25 4.5l7.5 7.5-7.5 7.5m-6-15l7.5 7.5-7.5 7.5'
                />
              </svg>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
