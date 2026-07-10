import React, { useRef } from 'react';
import { AssistantListProps } from './types';
import { CustomSelect } from '../ui/CustomSelect';
import { PlusIcon, EditIcon, TrashIcon } from '../ui/Icons';

const ExportGlyph: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill='none' stroke='currentColor' viewBox='0 0 24 24'>
    <path
      strokeLinecap='round'
      strokeLinejoin='round'
      strokeWidth={2}
      d='M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 4v12m0 0l-4-4m4 4l4-4'
    />
  </svg>
);

const ImportGlyph: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill='none' stroke='currentColor' viewBox='0 0 24 24'>
    <path
      strokeLinecap='round'
      strokeLinejoin='round'
      strokeWidth={2}
      d='M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 16V4m0 0L8 8m4-4l4 4'
    />
  </svg>
);

const ShareGlyph: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill='none' stroke='currentColor' viewBox='0 0 24 24'>
    <path
      strokeLinecap='round'
      strokeLinejoin='round'
      strokeWidth={2}
      d='M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z'
    />
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
  canShare = true, // 預設為可分享
  collapsed = false,
}) => {
  const importInputRef = useRef<globalThis.HTMLInputElement | null>(null);

  const handleImportFileChange = (event: React.ChangeEvent<globalThis.HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && onImport) {
      onImport(file);
    }
    event.target.value = '';
  };

  const importFileInput = onImport ? (
    <input
      ref={importInputRef}
      type='file'
      accept='.zip,application/zip'
      className='hidden'
      onChange={handleImportFileChange}
      aria-hidden='true'
      tabIndex={-1}
    />
  ) : null;

  // --- Collapsed: compact icon rail ---
  if (collapsed) {
    return (
      <div
        className='mb-4 flex flex-col items-center gap-2'
        role='navigation'
        aria-label='助理選擇'
      >
        <button
          onClick={onCreateNew}
          className='flex w-12 h-12 items-center justify-center rounded-xl bg-cyan-600/20 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/30 hover:text-cyan-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60'
          title='新增助理'
          aria-label='新增助理'
        >
          <PlusIcon className='w-5 h-5' />
        </button>

        {onImport && (
          <>
            {importFileInput}
            <button
              onClick={() => importInputRef.current?.click()}
              className='flex w-9 h-9 items-center justify-center rounded-lg text-gray-400 hover:text-emerald-400 hover:bg-emerald-500/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60'
              title='匯入助理設定檔'
              aria-label='匯入助理設定檔'
            >
              <ImportGlyph className='w-4 h-4' />
            </button>
          </>
        )}

        <div className='w-full border-t border-gray-700/40' />

        <div
          className='flex flex-col items-center gap-1.5 w-full max-h-48 overflow-y-auto chat-scroll py-1'
          role='listbox'
          aria-label='助理列表'
        >
          {assistants.map(assistant => {
            const isSelected = selectedAssistant?.id === assistant.id;
            const initial = (assistant.name?.trim()?.[0] ?? '?').toUpperCase();
            return (
              <div key={assistant.id} className='relative flex w-full justify-center'>
                {isSelected && (
                  <span
                    aria-hidden='true'
                    className='absolute left-1 top-1/2 h-6 w-1 -translate-y-1/2 rounded-full bg-cyan-400'
                  />
                )}
                <button
                  onClick={() => onSelect(assistant.id)}
                  className={`flex w-11 h-11 items-center justify-center rounded-full text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 ${
                    isSelected
                      ? 'bg-cyan-500 text-white ring-2 ring-cyan-300/50 shadow-lg shadow-cyan-500/20'
                      : 'bg-gray-700/60 text-gray-300 hover:bg-gray-600/70 hover:text-white'
                  }`}
                  title={assistant.name}
                  aria-label={`選擇助理 ${assistant.name}`}
                  aria-pressed={isSelected}
                >
                  {initial}
                </button>
              </div>
            );
          })}
        </div>

        {selectedAssistant && (
          <>
            <div className='w-full border-t border-gray-700/40' />
            <div className='flex flex-col items-center gap-1'>
              <button
                onClick={() => {
                  if (canShare) {
                    onShare(selectedAssistant);
                  }
                }}
                disabled={!canShare}
                className={`flex w-9 h-9 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 ${
                  canShare
                    ? 'text-gray-400 hover:text-blue-400 hover:bg-blue-500/20'
                    : 'text-gray-600 cursor-not-allowed opacity-50'
                }`}
                title={canShare ? '分享助理' : '需要先遷移到 Turso 才能分享'}
                aria-label={canShare ? '分享助理' : '需要遷移到 Turso'}
              >
                <ShareGlyph className='w-4 h-4' />
              </button>
              {onExport && (
                <button
                  onClick={() => onExport(selectedAssistant)}
                  className='flex w-9 h-9 items-center justify-center rounded-lg text-gray-400 hover:text-emerald-400 hover:bg-emerald-500/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60'
                  title='匯出助理設定檔'
                  aria-label='匯出助理設定檔'
                >
                  <ExportGlyph className='w-4 h-4' />
                </button>
              )}
              <button
                onClick={() => onEdit(selectedAssistant)}
                className='flex w-9 h-9 items-center justify-center rounded-lg text-gray-400 hover:text-cyan-400 hover:bg-cyan-500/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60'
                title='編輯助理'
                aria-label='編輯助理'
              >
                <EditIcon className='w-4 h-4' />
              </button>
              <button
                onClick={() => onDelete(selectedAssistant.id)}
                className='flex w-9 h-9 items-center justify-center rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-500/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/60'
                title='刪除助理'
                aria-label='刪除助理'
              >
                <TrashIcon className='w-4 h-4' />
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  // --- Expanded: original layout ---
  return (
    <div className='mb-5 px-1' role='navigation' aria-label='助理選擇'>
      <label className='block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2'>
        選擇助理
      </label>

      <CustomSelect
        assistants={assistants}
        selectedAssistant={selectedAssistant ?? null}
        onSelect={onSelect}
        placeholder='請選擇一個助理'
      />

      <div className='flex justify-end gap-1 mt-2'>
        <button
          onClick={onCreateNew}
          className='p-1.5 text-gray-400 hover:text-cyan-400 rounded-md hover:bg-cyan-500/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60'
          title='新增助理'
          aria-label='新增助理'
        >
          <PlusIcon className='w-4 h-4' />
        </button>
        {onImport && (
          <>
            {importFileInput}
            <button
              onClick={() => importInputRef.current?.click()}
              className='p-1.5 text-gray-400 hover:text-emerald-400 rounded-md hover:bg-emerald-500/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60'
              title='匯入助理設定檔'
              aria-label='匯入助理設定檔'
            >
              <ImportGlyph className='w-4 h-4' />
            </button>
          </>
        )}
        {selectedAssistant && (
          <>
            <button
              onClick={() => {
                if (canShare) {
                  onShare(selectedAssistant);
                }
              }}
              disabled={!canShare}
              className={`p-1.5 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 ${
                canShare
                  ? 'text-gray-400 hover:text-blue-400 hover:bg-blue-500/20 cursor-pointer'
                  : 'text-gray-600 cursor-not-allowed opacity-50'
              }`}
              title={canShare ? '分享助理' : '需要先遷移到 Turso 才能分享'}
              aria-label={canShare ? '分享助理' : '需要遷移到 Turso'}
            >
              <ShareGlyph className='w-4 h-4' />
            </button>
            {onExport && (
              <button
                onClick={() => onExport(selectedAssistant)}
                className='p-1.5 text-gray-400 hover:text-emerald-400 rounded-md hover:bg-emerald-500/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60'
                title='匯出助理設定檔'
                aria-label='匯出助理設定檔'
              >
                <ExportGlyph className='w-4 h-4' />
              </button>
            )}
            <button
              onClick={() => onEdit(selectedAssistant)}
              className='p-1.5 text-gray-400 hover:text-cyan-400 rounded-md hover:bg-cyan-500/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60'
              title='編輯助理'
              aria-label='編輯助理'
            >
              <EditIcon className='w-4 h-4' />
            </button>
            <button
              onClick={() => onDelete(selectedAssistant.id)}
              className='p-1.5 text-gray-400 hover:text-red-400 rounded-md hover:bg-red-500/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/60'
              title='刪除助理'
              aria-label='刪除助理'
            >
              <TrashIcon className='w-4 h-4' />
            </button>
          </>
        )}
      </div>
    </div>
  );
};
