import React, { useMemo, useState } from 'react';
import { HtmlProjectFileDescriptor } from '../../types';

interface FileTreeProps {
  files: HtmlProjectFileDescriptor[];
  entryFile: string;
}

interface FolderGroup {
  directory: string;
  files: HtmlProjectFileDescriptor[];
}

function getDirectory(path: string): string {
  const lastSlash = path.lastIndexOf('/');
  if (lastSlash <= 0) {
    return '/';
  }
  return path.slice(0, lastSlash);
}

function getFileName(path: string): string {
  const lastSlash = path.lastIndexOf('/');
  return lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
}

function formatFileSize(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  return `${(size / 1024).toFixed(1)} KB`;
}

type FileIconKind = 'html' | 'css' | 'js' | 'other';

function getFileIconKind(path: string): FileIconKind {
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  if (extension === 'html' || extension === 'htm') {
    return 'html';
  }
  if (extension === 'css') {
    return 'css';
  }
  if (extension === 'js' || extension === 'mjs' || extension === 'ts') {
    return 'js';
  }
  return 'other';
}

const FILE_ICON_STYLES: Record<FileIconKind, { className: string; path: string }> = {
  html: {
    className: 'text-orange-400',
    path: 'M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25',
  },
  css: {
    className: 'text-sky-400',
    path: 'M5.25 8.25h15m-16.5 7.5h15m-1.8-13.5l-3.9 19.5m-2.1-19.5l-3.9 19.5',
  },
  js: {
    className: 'text-yellow-300',
    path: 'M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5',
  },
  other: {
    className: 'text-gray-500',
    path: 'M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z',
  },
};

function FileTypeIcon({ path }: { path: string }): React.JSX.Element {
  const icon = FILE_ICON_STYLES[getFileIconKind(path)];
  return (
    <svg
      className={`h-3.5 w-3.5 shrink-0 ${icon.className}`}
      fill='none'
      stroke='currentColor'
      strokeWidth={1.8}
      viewBox='0 0 24 24'
      aria-hidden='true'
    >
      <path strokeLinecap='round' strokeLinejoin='round' d={icon.path} />
    </svg>
  );
}

export function FileTree({ files, entryFile }: FileTreeProps): React.JSX.Element {
  const [collapsedDirectories, setCollapsedDirectories] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const groups = useMemo<FolderGroup[]>(() => {
    const byDirectory = new Map<string, HtmlProjectFileDescriptor[]>();
    for (const file of files) {
      const directory = getDirectory(file.path);
      const bucket = byDirectory.get(directory);
      if (bucket) {
        bucket.push(file);
      } else {
        byDirectory.set(directory, [file]);
      }
    }

    return Array.from(byDirectory.entries())
      .sort(([a], [b]) => {
        if (a === '/') {
          return -1;
        }
        if (b === '/') {
          return 1;
        }
        return a.localeCompare(b);
      })
      .map(([directory, groupFiles]) => ({
        directory,
        files: [...groupFiles].sort((a, b) => a.path.localeCompare(b.path)),
      }));
  }, [files]);

  if (files.length === 0) {
    return (
      <div className='flex flex-col items-center gap-2 rounded-2xl border border-dashed border-gray-700 bg-gray-900/50 px-4 py-8 text-center'>
        <svg
          className='h-6 w-6 text-gray-600'
          fill='none'
          stroke='currentColor'
          strokeWidth={1.5}
          viewBox='0 0 24 24'
          aria-hidden='true'
        >
          <path
            strokeLinecap='round'
            strokeLinejoin='round'
            d='M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h2.879a1.5 1.5 0 011.06.44l1.122 1.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 8v1.776'
          />
        </svg>
        <p className='text-sm text-gray-400'>目前尚未建立任何檔案。</p>
      </div>
    );
  }

  const toggleDirectory = (directory: string) => {
    setCollapsedDirectories(previous => {
      const next = new Set(previous);
      if (next.has(directory)) {
        next.delete(directory);
      } else {
        next.add(directory);
      }
      return next;
    });
  };

  return (
    <div className='space-y-1'>
      {groups.map(group => {
        const isCollapsed = collapsedDirectories.has(group.directory);
        return (
          <div key={group.directory}>
            <button
              type='button'
              onClick={() => toggleDirectory(group.directory)}
              aria-expanded={!isCollapsed}
              aria-label={`資料夾 ${group.directory}`}
              className='flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-xs font-medium text-gray-400 transition hover:bg-gray-800/70 hover:text-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/70'
            >
              <svg
                className={`h-3 w-3 shrink-0 transition-transform ${isCollapsed ? '' : 'rotate-90'}`}
                fill='none'
                stroke='currentColor'
                strokeWidth={2}
                viewBox='0 0 24 24'
                aria-hidden='true'
              >
                <path strokeLinecap='round' strokeLinejoin='round' d='M8.25 4.5l7.5 7.5-7.5 7.5' />
              </svg>
              <svg
                className='h-3.5 w-3.5 shrink-0 text-gray-500'
                fill='none'
                stroke='currentColor'
                strokeWidth={1.8}
                viewBox='0 0 24 24'
                aria-hidden='true'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  d='M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h2.879a1.5 1.5 0 011.06.44l1.122 1.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 8v1.776'
                />
              </svg>
              <span className='truncate font-mono'>{group.directory}</span>
              <span className='ml-auto shrink-0 rounded-full bg-gray-800 px-1.5 py-px text-[10px] tabular-nums text-gray-400'>
                {group.files.length}
              </span>
            </button>
            {!isCollapsed && (
              <ul className='ml-3 space-y-px border-l border-gray-800 pl-2'>
                {group.files.map(file => {
                  const isEntry = file.path === entryFile;
                  return (
                    <li
                      key={file.path}
                      className='flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm text-gray-200 transition hover:bg-gray-800/70'
                    >
                      <div className='flex min-w-0 items-center gap-2'>
                        <FileTypeIcon path={file.path} />
                        <span className='truncate' title={file.path}>
                          {getFileName(file.path)}
                        </span>
                        {isEntry && (
                          <span className='shrink-0 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-px text-[10px] font-medium text-cyan-300'>
                            entry
                          </span>
                        )}
                      </div>
                      <div className='flex shrink-0 items-center gap-2 text-[11px] tabular-nums text-gray-500'>
                        <span>{formatFileSize(file.size)}</span>
                        <span>
                          {new Date(file.updatedAt).toLocaleTimeString('zh-TW', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
