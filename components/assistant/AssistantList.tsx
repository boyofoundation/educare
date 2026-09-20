import React, { useEffect, useRef, useState } from 'react';
import { AssistantListProps } from './types';
import { CustomSelect } from '../ui/CustomSelect';
import { EditIcon, PlusIcon, TrashIcon } from '../ui/Icons';

const ExportGlyph: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    aria-hidden='true'
    className={className}
    fill='none'
    focusable='false'
    stroke='currentColor'
    viewBox='0 0 24 24'
  >
    <path
      d='M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 4v12m0 0l-4-4m4 4l4-4'
      strokeLinecap='round'
      strokeLinejoin='round'
      strokeWidth={2}
    />
  </svg>
);

const ImportGlyph: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    aria-hidden='true'
    className={className}
    fill='none'
    focusable='false'
    stroke='currentColor'
    viewBox='0 0 24 24'
  >
    <path
      d='M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 16V4m0 0L8 8m4-4l4 4'
      strokeLinecap='round'
      strokeLinejoin='round'
      strokeWidth={2}
    />
  </svg>
);

const ShareGlyph: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    aria-hidden='true'
    className={className}
    fill='none'
    focusable='false'
    stroke='currentColor'
    viewBox='0 0 24 24'
  >
    <path
      d='M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z'
      strokeLinecap='round'
      strokeLinejoin='round'
      strokeWidth={2}
    />
  </svg>
);

const BundleGlyph: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    aria-hidden='true'
    className={className}
    fill='none'
    focusable='false'
    stroke='currentColor'
    viewBox='0 0 24 24'
  >
    <path
      d='M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4'
      strokeLinecap='round'
      strokeLinejoin='round'
      strokeWidth={2}
    />
  </svg>
);

const MoreGlyph: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    aria-hidden='true'
    className={className}
    fill='currentColor'
    focusable='false'
    viewBox='0 0 20 20'
  >
    <circle cx='4' cy='10' r='1.5' />
    <circle cx='10' cy='10' r='1.5' />
    <circle cx='16' cy='10' r='1.5' />
  </svg>
);

export const AssistantList: React.FC<AssistantListProps> = ({
  assistants,
  selectedAssistant,
  onSelect,
  onEdit,
  onDelete,
  onShare,
  onCreateNew,
  onExport,
  onImport,
  onBuildBundle,
}) => {
  const importInputRef = useRef<globalThis.HTMLInputElement | null>(null);
  const menuRef = useRef<globalThis.HTMLDivElement | null>(null);
  const menuTriggerRef = useRef<globalThis.HTMLButtonElement | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const hasManagementActions = Boolean(selectedAssistant || onImport || onBuildBundle);

  useEffect(() => {
    if (!isMenuOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !menuTriggerRef.current?.contains(target)) {
        setIsMenuOpen(false);
      }
    };

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }
      event.preventDefault();
      setIsMenuOpen(false);
      menuTriggerRef.current?.focus();
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMenuOpen]);

  const handleImportFileChange = (event: React.ChangeEvent<globalThis.HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && onImport) {
      onImport(file);
    }
    event.target.value = '';
  };

  const runMenuAction = (action: () => void) => {
    setIsMenuOpen(false);
    action();
  };

  return (
    <nav aria-label='助理選擇' className='assistant-switcher relative mb-5 px-1'>
      <div className='mb-2 flex items-center justify-between gap-3'>
        <span className='sidebar-section-label text-xs font-semibold text-gray-400 uppercase tracking-wider'>
          選擇助理
        </span>
        <span
          className='sidebar-count text-xs text-gray-500'
          aria-label={`${assistants.length} 個助理`}
        >
          {assistants.length}
        </span>
      </div>

      <CustomSelect
        assistants={assistants}
        className='assistant-select'
        onSelect={onSelect}
        placeholder='請選擇一個助理'
        selectedAssistant={selectedAssistant ?? null}
      />

      <div className='mt-2 flex items-center gap-1'>
        <button
          aria-label='新增助理'
          className='assistant-action assistant-action--primary flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-gray-300 hover:text-cyan-400 hover:bg-cyan-500/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60'
          onClick={onCreateNew}
          title='新增助理'
          type='button'
        >
          <PlusIcon className='h-4 w-4' />
          <span>新增</span>
        </button>

        {selectedAssistant && (
          <button
            aria-label='分享助理'
            className='assistant-action flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-gray-300 transition-colors hover:bg-blue-500/20 hover:text-blue-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60'
            onClick={() => onShare(selectedAssistant)}
            title='分享助理'
            type='button'
          >
            <ShareGlyph className='h-4 w-4' />
            <span>分享</span>
          </button>
        )}

        {hasManagementActions && (
          <div className='relative'>
            <button
              ref={menuTriggerRef}
              aria-expanded={isMenuOpen}
              aria-haspopup='true'
              aria-label='管理助理'
              className='assistant-action assistant-action--icon flex h-11 w-11 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-700/50 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60'
              onClick={() => setIsMenuOpen(open => !open)}
              title='管理助理'
              type='button'
            >
              <MoreGlyph className='h-5 w-5' />
            </button>

            {isMenuOpen && (
              <div
                ref={menuRef}
                aria-label='助理管理選單'
                className='assistant-menu absolute right-0 top-full z-50 mt-2 w-52 overflow-hidden rounded-xl border border-gray-700/60 bg-gray-800 p-1.5 shadow-xl'
              >
                {selectedAssistant && (
                  <button
                    aria-label='編輯助理'
                    className='assistant-menu__item flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-gray-200 transition-colors hover:bg-gray-700/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60'
                    onClick={() => runMenuAction(() => onEdit(selectedAssistant))}
                    title='編輯助理'
                    type='button'
                  >
                    <EditIcon className='h-4 w-4' />
                    <span>編輯助理</span>
                  </button>
                )}

                {selectedAssistant && onExport && (
                  <button
                    aria-label='匯出助理設定檔'
                    className='assistant-menu__item flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-gray-200 transition-colors hover:bg-gray-700/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60'
                    onClick={() => runMenuAction(() => onExport(selectedAssistant))}
                    title='匯出助理設定檔'
                    type='button'
                  >
                    <ExportGlyph className='h-4 w-4' />
                    <span>匯出設定檔</span>
                  </button>
                )}

                {onImport && (
                  <button
                    aria-label='匯入助理設定檔'
                    className='assistant-menu__item flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-gray-200 transition-colors hover:bg-gray-700/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60'
                    onClick={() => runMenuAction(() => importInputRef.current?.click())}
                    title='匯入助理設定檔'
                    type='button'
                  >
                    <ImportGlyph className='h-4 w-4' />
                    <span>匯入設定檔</span>
                  </button>
                )}

                {onBuildBundle && (
                  <button
                    aria-label='打包協作包'
                    className='assistant-menu__item flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-gray-200 transition-colors hover:bg-gray-700/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60'
                    onClick={() => runMenuAction(onBuildBundle)}
                    title='打包協作包'
                    type='button'
                  >
                    <BundleGlyph className='h-4 w-4' />
                    <span>打包協作包</span>
                  </button>
                )}

                {selectedAssistant && (
                  <>
                    <div className='sidebar-divider my-1 border-t border-gray-700/60' />
                    <button
                      aria-label='刪除助理'
                      className='assistant-menu__item assistant-menu__item--danger flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-red-300 transition-colors hover:bg-red-500/15 hover:text-red-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/60'
                      onClick={() => runMenuAction(() => onDelete(selectedAssistant.id))}
                      title='刪除助理'
                      type='button'
                    >
                      <TrashIcon className='h-4 w-4' />
                      <span>刪除助理</span>
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {onImport && (
        <input
          ref={importInputRef}
          accept='.zip,application/zip'
          aria-hidden='true'
          className='hidden'
          onChange={handleImportFileChange}
          tabIndex={-1}
          type='file'
        />
      )}
    </nav>
  );
};
