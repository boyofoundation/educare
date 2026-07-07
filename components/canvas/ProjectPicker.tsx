import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HtmlProject } from '../../types';
import { htmlProjectStore } from '../../services/htmlProjectStore';
import { htmlProjectZipService } from '../../services/htmlProjectZipService';
import Button from '../ui/Button';
import Modal from '../ui/Modal';

interface ProjectPickerProps {
  assistantId: string;
  activeProjectId?: string | null;
  onCreateProject: () => Promise<void> | void;
  onOpenProject: (projectId: string) => Promise<void> | void;
  onRenameProject: (projectId: string, name: string) => Promise<void> | void;
  onUploadProjectFiles: (projectId: string, files: File[]) => Promise<void> | void;
  onImportProjectZip: (file: File) => Promise<void> | void;
  onDeleteProject: (projectId: string) => Promise<void> | void;
  variant?: 'sidebar' | 'sidebar-collapsed';
}

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const SEARCH_THRESHOLD = 5;

function formatRelativeTime(timestamp: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - timestamp);
  if (diff < MINUTE_MS) {
    return '剛剛';
  }
  if (diff < HOUR_MS) {
    return `${Math.floor(diff / MINUTE_MS)} 分鐘前`;
  }
  if (diff < DAY_MS) {
    return `${Math.floor(diff / HOUR_MS)} 小時前`;
  }
  const nowDate = new Date(now);
  const startOfToday = new Date(
    nowDate.getFullYear(),
    nowDate.getMonth(),
    nowDate.getDate(),
  ).getTime();
  if (timestamp >= startOfToday - DAY_MS) {
    return '昨天';
  }
  const target = new Date(timestamp);
  return `${target.getMonth() + 1}月${target.getDate()}日`;
}

const ICON_PATHS = {
  pencil:
    'M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487z',
  uploadFiles:
    'M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z',
  uploadFolder:
    'M12 16.5v-5m0 0l2.25 2.25M12 11.5l-2.25 2.25M3 7.5A1.5 1.5 0 014.5 6h5.379a1.5 1.5 0 011.06.44l1.121 1.12a1.5 1.5 0 001.06.44H19.5A1.5 1.5 0 0121 9.5v9A1.5 1.5 0 0119.5 20h-15A1.5 1.5 0 013 18.5v-11z',
  download:
    'M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3',
  trash:
    'M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0',
  check: 'M4.5 12.75l6 6 9-13.5',
  x: 'M6 18L18 6M6 6l12 12',
  search: 'M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z',
  plus: 'M12 4.5v15m7.5-7.5h-15',
  archive:
    'M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z',
  folder:
    'M3 7.5A1.5 1.5 0 014.5 6h5.379a1.5 1.5 0 011.06.44l1.121 1.12a1.5 1.5 0 001.06.44H19.5A1.5 1.5 0 0121 9.5v9A1.5 1.5 0 0119.5 20h-15A1.5 1.5 0 013 18.5v-11z',
  code: 'M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5',
} as const;

function Icon({
  path,
  className = 'h-4 w-4',
}: {
  path: string;
  className?: string;
}): React.JSX.Element {
  return (
    <svg
      className={className}
      fill='none'
      stroke='currentColor'
      strokeWidth={1.8}
      viewBox='0 0 24 24'
      aria-hidden='true'
    >
      <path strokeLinecap='round' strokeLinejoin='round' d={path} />
    </svg>
  );
}

function Spinner({ className = 'h-4 w-4' }: { className?: string }): React.JSX.Element {
  return (
    <svg className={`animate-spin ${className}`} fill='none' viewBox='0 0 24 24' aria-hidden='true'>
      <circle className='opacity-25' cx='12' cy='12' r='10' stroke='currentColor' strokeWidth='4' />
      <path
        className='opacity-75'
        fill='currentColor'
        d='M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z'
      />
    </svg>
  );
}

interface ProjectMenuItem {
  label: string;
  iconPath: string;
  onSelect: () => void;
}

interface ProjectCardProps {
  project: HtmlProject;
  isActive: boolean;
  disabled: boolean;
  busyLabel: string | null;
  onOpen: () => void;
  onRenameSubmit: (name: string) => void;
  onUploadFiles: () => void;
  onUploadFolder: () => void;
  onDownload: () => void;
  onDelete: () => void;
}

function ProjectCard({
  project,
  isActive,
  disabled,
  busyLabel,
  onOpen,
  onRenameSubmit,
  onUploadFiles,
  onUploadFolder,
  onDownload,
  onDelete,
}: ProjectCardProps): React.JSX.Element {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // 外點關閉 kebab 選單
  useEffect(() => {
    if (!isMenuOpen) {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isMenuOpen]);

  // Esc 先關閉卡片內的暫態 UI(選單/inline rename/刪除確認),不讓 Modal 被關閉
  useEffect(() => {
    if (!isMenuOpen && !isEditing && !isConfirmingDelete) {
      return;
    }
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }
      event.stopPropagation();
      setIsMenuOpen(false);
      setIsEditing(false);
      setIsConfirmingDelete(false);
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [isMenuOpen, isEditing, isConfirmingDelete]);

  const startRename = () => {
    setRenameValue(project.name);
    setIsEditing(true);
  };

  const submitRename = () => {
    const nextName = renameValue.trim();
    if (!nextName) {
      return;
    }
    setIsEditing(false);
    onRenameSubmit(nextName);
  };

  const cancelRename = () => {
    setIsEditing(false);
    setRenameValue('');
  };

  const menuItems: ProjectMenuItem[] = [
    { label: 'Rename', iconPath: ICON_PATHS.pencil, onSelect: startRename },
    { label: 'Upload files', iconPath: ICON_PATHS.uploadFiles, onSelect: onUploadFiles },
    { label: 'Upload folder', iconPath: ICON_PATHS.uploadFolder, onSelect: onUploadFolder },
    { label: 'Download ZIP', iconPath: ICON_PATHS.download, onSelect: onDownload },
  ];

  const handleCardClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (disabled || isEditing || isConfirmingDelete || isMenuOpen) {
      return;
    }
    const target = event.target as HTMLElement;
    if (target.closest('button, input, a, [role="menu"]')) {
      return;
    }
    onOpen();
  };

  return (
    <div
      data-testid={`project-card-${project.id}`}
      onClick={handleCardClick}
      className={`group relative flex flex-col rounded-2xl border p-4 shadow-sm shadow-black/20 transition ${
        isActive
          ? 'border-cyan-500/40 bg-cyan-950/10'
          : 'border-gray-800 bg-gray-950/80 hover:border-cyan-500/40'
      } ${disabled ? '' : 'cursor-pointer'}`}
    >
      <div className='flex items-start justify-between gap-3'>
        <div className='min-w-0 flex-1'>
          {isEditing ? (
            <div className='flex items-center gap-1.5'>
              <input
                autoFocus
                type='text'
                value={renameValue}
                onChange={event => setRenameValue(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    event.stopPropagation();
                    submitRename();
                  } else if (event.key === 'Escape') {
                    event.stopPropagation();
                    cancelRename();
                  }
                }}
                aria-label='專案名稱'
                className='w-full min-w-0 rounded-lg border border-cyan-500/50 bg-gray-900 px-2.5 py-1.5 text-sm font-semibold text-white outline-none ring-1 ring-cyan-500/30 placeholder-gray-500 focus:border-cyan-400'
              />
              <button
                type='button'
                onClick={submitRename}
                aria-label='確認重新命名'
                className='flex-shrink-0 rounded-lg p-1.5 text-cyan-300 transition hover:bg-cyan-500/15 hover:text-cyan-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-500'
              >
                <Icon path={ICON_PATHS.check} />
              </button>
              <button
                type='button'
                onClick={cancelRename}
                aria-label='取消重新命名'
                className='flex-shrink-0 rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-800 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-500'
              >
                <Icon path={ICON_PATHS.x} />
              </button>
            </div>
          ) : (
            <div className='truncate text-sm font-semibold text-white'>{project.name}</div>
          )}
          <div className='mt-1 truncate font-mono text-xs text-gray-500'>{project.entryFile}</div>
        </div>

        <div className='flex flex-shrink-0 items-center gap-1.5'>
          {isActive && (
            <span className='rounded-full border border-cyan-500/40 bg-cyan-500/15 px-2.5 py-1 text-[11px] font-medium text-cyan-100'>
              目前使用中
            </span>
          )}
          <span className='rounded-full bg-gray-800/80 px-2.5 py-1 text-[11px] font-medium text-gray-300'>
            v{project.previewVersion}
          </span>

          <div className='relative' ref={menuRef}>
            <button
              type='button'
              aria-label='專案動作選單'
              aria-haspopup='menu'
              aria-expanded={isMenuOpen}
              disabled={disabled}
              onClick={() => setIsMenuOpen(open => !open)}
              className='rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-800 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-500 disabled:cursor-not-allowed disabled:opacity-50'
            >
              <svg className='h-5 w-5' viewBox='0 0 24 24' fill='currentColor' aria-hidden='true'>
                <circle cx='12' cy='5' r='1.6' />
                <circle cx='12' cy='12' r='1.6' />
                <circle cx='12' cy='19' r='1.6' />
              </svg>
            </button>

            {isMenuOpen && (
              <div
                role='menu'
                aria-label='專案動作'
                className='absolute right-0 top-full z-30 mt-1 w-48 overflow-hidden rounded-xl border border-gray-700 bg-gray-900 py-1 shadow-xl shadow-black/50'
              >
                {menuItems.map(item => (
                  <button
                    key={item.label}
                    type='button'
                    role='menuitem'
                    onClick={() => {
                      setIsMenuOpen(false);
                      item.onSelect();
                    }}
                    className='flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-gray-200 transition hover:bg-gray-800 hover:text-white focus-visible:bg-gray-800 focus-visible:outline-none'
                  >
                    <Icon path={item.iconPath} className='h-4 w-4 flex-shrink-0 text-gray-400' />
                    {item.label}
                  </button>
                ))}
                <div className='my-1 border-t border-gray-800' aria-hidden='true' />
                <button
                  type='button'
                  role='menuitem'
                  onClick={() => {
                    setIsMenuOpen(false);
                    setIsConfirmingDelete(true);
                  }}
                  className='flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-rose-300 transition hover:bg-rose-500/10 hover:text-rose-200 focus-visible:bg-rose-500/10 focus-visible:outline-none'
                >
                  <Icon path={ICON_PATHS.trash} className='h-4 w-4 flex-shrink-0' />
                  Delete project
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {project.description && (
        <p className='mt-3 line-clamp-2 text-sm text-gray-300'>{project.description}</p>
      )}

      <div className='mt-4 flex items-center justify-between gap-3'>
        <span className='text-xs text-gray-500'>{formatRelativeTime(project.updatedAt)}更新</span>
        <button
          type='button'
          onClick={onOpen}
          disabled={disabled}
          className='rounded-lg bg-cyan-600 px-4 py-1.5 text-xs font-semibold text-white shadow-sm shadow-cyan-950/50 transition hover:bg-cyan-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400 disabled:cursor-not-allowed disabled:opacity-60'
        >
          開啟
        </button>
      </div>

      {isConfirmingDelete && (
        <div
          onClick={event => event.stopPropagation()}
          className='absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 rounded-2xl border border-rose-500/40 bg-gray-950/95 p-4 text-center'
        >
          <p className='text-sm font-medium text-white'>確定要永久刪除「{project.name}」嗎？</p>
          <p className='text-xs text-rose-300'>此動作無法復原。</p>
          <div className='flex items-center gap-2'>
            <button
              type='button'
              onClick={() => setIsConfirmingDelete(false)}
              className='rounded-lg border border-gray-700 px-4 py-1.5 text-xs font-medium text-gray-300 transition hover:border-gray-500 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-500'
            >
              取消
            </button>
            <button
              type='button'
              onClick={() => {
                setIsConfirmingDelete(false);
                onDelete();
              }}
              className='rounded-lg bg-rose-600 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-rose-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-400'
            >
              永久刪除
            </button>
          </div>
        </div>
      )}

      {busyLabel && (
        <div
          aria-live='polite'
          className='absolute inset-0 z-20 flex items-center justify-center gap-2 rounded-2xl bg-gray-950/80 text-sm font-medium text-cyan-200 backdrop-blur-[1px]'
        >
          <Spinner />
          {busyLabel}
        </div>
      )}
    </div>
  );
}

function SkeletonCard(): React.JSX.Element {
  return (
    <div className='animate-pulse rounded-2xl border border-gray-800 bg-gray-950/70 p-4'>
      <div className='flex items-start justify-between gap-3'>
        <div className='flex-1 space-y-2'>
          <div className='h-4 w-2/5 rounded bg-gray-800' />
          <div className='h-3 w-1/4 rounded bg-gray-800/80' />
        </div>
        <div className='h-5 w-10 rounded-full bg-gray-800' />
      </div>
      <div className='mt-4 h-3 w-3/4 rounded bg-gray-800/60' />
      <div className='mt-4 flex items-center justify-between'>
        <div className='h-3 w-16 rounded bg-gray-800/60' />
        <div className='h-7 w-16 rounded-lg bg-gray-800' />
      </div>
    </div>
  );
}

export function ProjectPicker({
  assistantId,
  activeProjectId = null,
  onCreateProject,
  onOpenProject,
  onRenameProject,
  onUploadProjectFiles,
  onImportProjectZip,
  onDeleteProject,
  variant = 'sidebar',
}: ProjectPickerProps): React.JSX.Element {
  const [projects, setProjects] = useState<HtmlProject[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [openingProjectId, setOpeningProjectId] = useState<string | null>(null);
  const [downloadingProjectId, setDownloadingProjectId] = useState<string | null>(null);
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null);
  const [uploadingProjectId, setUploadingProjectId] = useState<string | null>(null);
  const [isImportingZip, setIsImportingZip] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const uploadFilesInputRef = useRef<HTMLInputElement | null>(null);
  const uploadFolderInputRef = useRef<HTMLInputElement | null>(null);
  const importZipInputRef = useRef<HTMLInputElement | null>(null);
  const pendingUploadProjectIdRef = useRef<string | null>(null);

  const loadProjects = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const nextProjects = await htmlProjectStore.listProjectsByAssistant(assistantId);
      setProjects(nextProjects);
    } catch (loadError) {
      console.error('Failed to load assistant HTML projects:', loadError);
      setError('無法載入既有 HTML 專案。');
    } finally {
      setIsLoading(false);
    }
  }, [assistantId]);

  useEffect(() => {
    loadProjects().catch(loadError => {
      console.error('Failed to initialize assistant HTML project picker:', loadError);
    });
  }, [isModalOpen, loadProjects]);

  const handleCreateProject = async () => {
    setIsCreatingProject(true);
    setError(null);
    try {
      await onCreateProject();
      setIsModalOpen(false);
    } catch (createError) {
      console.error('Failed to create HTML project:', createError);
      setError('無法建立新的 HTML 專案。');
    } finally {
      setIsCreatingProject(false);
    }
  };

  const handleOpenProject = async (projectId: string) => {
    setOpeningProjectId(projectId);
    setError(null);
    try {
      await onOpenProject(projectId);
      setIsModalOpen(false);
    } catch (openError) {
      console.error('Failed to open HTML project:', openError);
      setError('無法開啟所選的 HTML 專案。');
    } finally {
      setOpeningProjectId(null);
    }
  };

  const handleRenameProject = async (project: HtmlProject, nextName: string) => {
    if (nextName === project.name) {
      return;
    }

    setRenamingProjectId(project.id);
    setError(null);
    try {
      await onRenameProject(project.id, nextName);
      await loadProjects();
    } catch (renameError) {
      console.error('Failed to rename HTML project:', renameError);
      setError(renameError instanceof Error ? renameError.message : '無法重新命名 HTML 專案。');
    } finally {
      setRenamingProjectId(null);
    }
  };

  const handleUploadProjectFiles = async (files: File[]) => {
    const projectId = pendingUploadProjectIdRef.current;
    pendingUploadProjectIdRef.current = null;

    if (!projectId || files.length === 0) {
      return;
    }

    setUploadingProjectId(projectId);
    setError(null);
    try {
      await onUploadProjectFiles(projectId, files);
      await loadProjects();
    } catch (uploadError) {
      console.error('Failed to upload files into HTML project:', uploadError);
      setError(uploadError instanceof Error ? uploadError.message : '無法上傳檔案到 HTML 專案。');
    } finally {
      setUploadingProjectId(null);
    }
  };

  const handleProjectFileInputChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    await handleUploadProjectFiles(files);
    event.target.value = '';
  };

  const triggerProjectFileUpload = (projectId: string, mode: 'files' | 'folder') => {
    pendingUploadProjectIdRef.current = projectId;
    if (mode === 'files') {
      uploadFilesInputRef.current?.click();
      return;
    }
    uploadFolderInputRef.current?.click();
  };

  const handleImportZip = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const zipFile = event.target.files?.[0];
    if (!zipFile) {
      return;
    }

    setIsImportingZip(true);
    setError(null);
    try {
      await onImportProjectZip(zipFile);
      setIsModalOpen(false);
    } catch (importError) {
      console.error('Failed to import HTML project ZIP:', importError);
      setError(importError instanceof Error ? importError.message : '無法匯入 HTML 專案 ZIP。');
    } finally {
      setIsImportingZip(false);
      event.target.value = '';
    }
  };

  const handleDownloadProject = async (projectId: string) => {
    setDownloadingProjectId(projectId);
    setError(null);
    try {
      await htmlProjectZipService.downloadProjectZip(projectId, assistantId);
    } catch (downloadError) {
      console.error('Failed to download HTML project zip:', downloadError);
      setError('無法下載 HTML 專案 ZIP。');
    } finally {
      setDownloadingProjectId(null);
    }
  };

  const handleDeleteProject = async (project: HtmlProject) => {
    setDeletingProjectId(project.id);
    setError(null);
    try {
      await onDeleteProject(project.id);
      setProjects(currentProjects =>
        currentProjects.filter(currentProject => currentProject.id !== project.id),
      );
    } catch (deleteError) {
      console.error('Failed to delete HTML project:', deleteError);
      setError('無法刪除 HTML 專案。');
    } finally {
      setDeletingProjectId(null);
    }
  };

  const sortedProjects = useMemo(
    () => [...projects].sort((a, b) => b.updatedAt - a.updatedAt),
    [projects],
  );

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const visibleProjects = normalizedQuery
    ? sortedProjects.filter(
        project =>
          project.name.toLowerCase().includes(normalizedQuery) ||
          (project.description ?? '').toLowerCase().includes(normalizedQuery),
      )
    : sortedProjects;

  const isCollapsed = variant === 'sidebar-collapsed';
  const isModalBusy =
    isCreatingProject ||
    isImportingZip ||
    openingProjectId !== null ||
    downloadingProjectId !== null ||
    deletingProjectId !== null ||
    renamingProjectId !== null ||
    uploadingProjectId !== null;

  return (
    <>
      <section
        className={isCollapsed ? 'mb-4 flex justify-center' : 'mb-4 px-2'}
        data-testid='html-project-picker'
      >
        <Button
          type='button'
          onClick={() => setIsModalOpen(true)}
          size='sm'
          className={
            isCollapsed
              ? 'flex h-11 w-11 items-center justify-center rounded-xl border border-gray-600/40 bg-gray-800/70 px-0 text-cyan-100 shadow-lg shadow-black/20 hover:border-cyan-500/40 hover:bg-gray-700/80'
              : 'flex w-full items-center justify-between rounded-xl border border-gray-600/40 bg-gray-800/70 px-3 py-2.5 text-sm font-medium text-white shadow-lg shadow-black/20 hover:border-cyan-500/40 hover:bg-gray-700/80'
          }
          aria-label='HTML Projects'
          title='HTML Projects'
        >
          <span className='flex items-center gap-2'>
            <Icon path={ICON_PATHS.folder} className='h-4 w-4 flex-shrink-0' />
            {!isCollapsed && <span className='tracking-wide'>HTML Projects</span>}
          </span>
          {!isCollapsed && (
            <span className='rounded-full bg-black/20 px-2 py-0.5 text-[11px] text-cyan-50'>
              {isLoading ? '載入中…' : `${projects.length} 個`}
            </span>
          )}
        </Button>
      </section>

      <input
        ref={uploadFilesInputRef}
        type='file'
        multiple
        className='hidden'
        onChange={handleProjectFileInputChange}
      />
      <input
        ref={uploadFolderInputRef}
        type='file'
        multiple
        className='hidden'
        onChange={handleProjectFileInputChange}
        {...({ directory: '', webkitdirectory: '' } as Record<string, string>)}
      />
      <input
        ref={importZipInputRef}
        type='file'
        accept='.zip,application/zip'
        className='hidden'
        onChange={handleImportZip}
      />

      <Modal
        isOpen={isModalOpen}
        onClose={() => {
          if (isModalBusy) {
            return;
          }
          setIsModalOpen(false);
        }}
        title='HTML Canvas projects'
        size='fullscreen'
        className='bg-gray-900'
      >
        <div className='space-y-6'>
          <div className='rounded-2xl border border-cyan-900/40 bg-cyan-950/20 p-5'>
            <div className='flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between'>
              <div className='flex items-start gap-3'>
                <span className='flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-cyan-500/30 bg-cyan-500/15 text-cyan-300'>
                  <Icon path={ICON_PATHS.code} className='h-5 w-5' />
                </span>
                <div>
                  <p className='text-sm font-semibold text-white'>Start new HTML project</p>
                  <p className='mt-1 text-sm text-gray-300'>
                    立即建立新的 HTML Canvas workspace，載入預設 starter files，或從 ZIP
                    匯入既有專案。
                  </p>
                </div>
              </div>
              <div className='flex flex-wrap items-center gap-2'>
                <button
                  type='button'
                  onClick={() => importZipInputRef.current?.click()}
                  disabled={isImportingZip || isCreatingProject}
                  className='inline-flex items-center gap-2 self-start whitespace-nowrap rounded-xl border border-gray-600/60 bg-gray-900/60 px-5 py-2.5 text-sm font-medium text-gray-200 transition hover:border-cyan-500/40 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-500 disabled:cursor-not-allowed disabled:opacity-60'
                >
                  {isImportingZip ? (
                    <Spinner />
                  ) : (
                    <Icon path={ICON_PATHS.archive} className='h-4 w-4 text-gray-400' />
                  )}
                  Import ZIP
                </button>
                <Button
                  type='button'
                  onClick={handleCreateProject}
                  loading={isCreatingProject}
                  size='sm'
                  className='self-start whitespace-nowrap px-5 py-2.5 text-sm'
                >
                  {!isCreatingProject && <Icon path={ICON_PATHS.plus} className='mr-2 h-4 w-4' />}
                  Start new project
                </Button>
              </div>
            </div>
          </div>

          <div>
            <div className='mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between'>
              <div>
                <p className='text-sm font-semibold text-white'>Open existing HTML project</p>
                <p className='mt-1 text-sm text-gray-400'>
                  依更新時間由新到舊排序。點擊卡片即可開啟，更多動作收在卡片右上角選單。
                </p>
              </div>
              {projects.length > SEARCH_THRESHOLD && (
                <div className='relative flex-shrink-0 sm:w-64'>
                  <span className='pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500'>
                    <Icon path={ICON_PATHS.search} />
                  </span>
                  <input
                    type='search'
                    value={searchQuery}
                    onChange={event => setSearchQuery(event.target.value)}
                    placeholder='搜尋專案名稱或描述'
                    aria-label='搜尋專案'
                    className='w-full rounded-xl border border-gray-700 bg-gray-950/80 py-2 pl-9 pr-3 text-sm text-white placeholder-gray-500 outline-none transition focus:border-cyan-500/60 focus:ring-1 focus:ring-cyan-500/40'
                  />
                </div>
              )}
            </div>

            {error && (
              <div className='mb-4 rounded-2xl border border-rose-900/60 bg-rose-950/40 px-4 py-3 text-sm text-rose-200'>
                {error}
              </div>
            )}

            {isLoading ? (
              <div
                className='grid gap-3 lg:grid-cols-2'
                role='status'
                aria-label='載入既有 HTML 專案中'
              >
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
              </div>
            ) : projects.length === 0 ? (
              <div className='flex flex-col items-center rounded-2xl border border-dashed border-gray-700 bg-gray-950/60 px-6 py-12 text-center'>
                <span className='flex h-14 w-14 items-center justify-center rounded-2xl border border-gray-800 bg-gray-900 text-gray-500'>
                  <Icon path={ICON_PATHS.folder} className='h-7 w-7' />
                </span>
                <p className='mt-4 text-sm font-medium text-gray-200'>目前還沒有 HTML 專案</p>
                <p className='mt-1 max-w-sm text-sm text-gray-500'>
                  建立第一個專案開始編輯，或從 ZIP 匯入既有的 HTML 專案。
                </p>
                <Button
                  type='button'
                  onClick={handleCreateProject}
                  loading={isCreatingProject}
                  size='sm'
                  className='mt-5 whitespace-nowrap px-5 py-2.5 text-sm'
                >
                  {!isCreatingProject && <Icon path={ICON_PATHS.plus} className='mr-2 h-4 w-4' />}
                  建立新專案
                </Button>
              </div>
            ) : visibleProjects.length === 0 ? (
              <div className='rounded-2xl border border-gray-800 bg-gray-950/60 px-4 py-10 text-center text-sm text-gray-400'>
                找不到符合「{searchQuery.trim()}」的專案。
              </div>
            ) : (
              <div className='grid gap-3 lg:grid-cols-2'>
                {visibleProjects.map(project => {
                  const busyLabel =
                    openingProjectId === project.id
                      ? '開啟中…'
                      : downloadingProjectId === project.id
                        ? '下載中…'
                        : deletingProjectId === project.id
                          ? '刪除中…'
                          : renamingProjectId === project.id
                            ? '重新命名中…'
                            : uploadingProjectId === project.id
                              ? '上傳中…'
                              : null;

                  return (
                    <ProjectCard
                      key={project.id}
                      project={project}
                      isActive={activeProjectId === project.id}
                      busyLabel={busyLabel}
                      disabled={busyLabel !== null || isCreatingProject || isImportingZip}
                      onOpen={() => handleOpenProject(project.id)}
                      onRenameSubmit={nextName => handleRenameProject(project, nextName)}
                      onUploadFiles={() => triggerProjectFileUpload(project.id, 'files')}
                      onUploadFolder={() => triggerProjectFileUpload(project.id, 'folder')}
                      onDownload={() => handleDownloadProject(project.id)}
                      onDelete={() => handleDeleteProject(project)}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </Modal>
    </>
  );
}
