import React, { useMemo, useState } from 'react';
import {
  completeOnboardingAsync,
  getOnboardingPreferences,
  OnboardingCompletionReason,
  OnboardingPersistenceResult,
} from '../../services/onboardingPreferences';
import { ASSISTANT_TEMPLATES, AssistantTemplate } from '../assistant/TemplateSelector';
import Modal from '../ui/Modal';

export interface OnboardingProps {
  /** Pass this prop when the shell owns visibility. Omit it for first-run mode. */
  isOpen?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  onApplyTemplate?: (template: AssistantTemplate) => void;
  onImportAssistant?: () => void;
  onBrowse?: () => void;
  onComplete?: (reason: OnboardingCompletionReason) => void;
  onSkip?: () => void;
  className?: string;
}

const closeGuide = async (
  reason: OnboardingCompletionReason,
  onOpenChange: OnboardingProps['onOpenChange'],
  onComplete: OnboardingProps['onComplete'],
  onSkip: OnboardingProps['onSkip'],
  templateId?: string,
): Promise<OnboardingPersistenceResult> => {
  let result: OnboardingPersistenceResult;
  try {
    result = await completeOnboardingAsync(reason, templateId);
  } catch {
    const preferences = getOnboardingPreferences();
    result = { ...preferences, preferences: { ...preferences }, persisted: false };
  }
  onComplete?.(reason);
  if (reason === 'skip') {
    onSkip?.();
  }
  onOpenChange?.(false);
  return result;
};

/**
 * A reusable first-run guide.  The app shell can control it, while isolated
 * consumers get a sensible local-first default based on persisted preferences.
 */
export const Onboarding: React.FC<OnboardingProps> = ({
  isOpen,
  defaultOpen,
  onOpenChange,
  onApplyTemplate,
  onImportAssistant,
  onBrowse,
  onComplete,
  onSkip,
  className,
}) => {
  const [internalOpen, setInternalOpen] = useState(
    () => defaultOpen ?? !getOnboardingPreferences().completed,
  );
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [persistenceWarning, setPersistenceWarning] = useState(false);

  const open = isOpen ?? internalOpen;
  const selectedTemplate = useMemo(
    () => ASSISTANT_TEMPLATES.find(template => template.id === selectedTemplateId) ?? null,
    [selectedTemplateId],
  );

  const finish = async (reason: OnboardingCompletionReason, templateId?: string) => {
    const result = await closeGuide(reason, onOpenChange, onComplete, onSkip, templateId);
    setPersistenceWarning(!result.persisted);
    if (isOpen === undefined) {
      setInternalOpen(false);
    }
  };

  if (!open) {
    return persistenceWarning ? (
      <div
        className='border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100'
        data-testid='onboarding-persistence-warning'
        role='status'
      >
        本次引導已完成，但瀏覽器未允許永久保存；目前只會保留在本分頁，關閉分頁後可能需要重新開始。
      </div>
    ) : null;
  }

  return (
    <Modal
      isOpen={open}
      onClose={() => void finish('skip')}
      title='先選用途，再開始備課'
      size='wide'
      className={`max-h-[calc(100dvh-2rem)] border-cyan-800/60 ${className ?? ''}`}
    >
      <div data-testid='onboarding-overlay' className='p-0'>
        {persistenceWarning && (
          <div
            className='mb-5 border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100'
            data-testid='onboarding-persistence-warning'
            role='status'
          >
            本次引導已完成，但瀏覽器未允許永久保存；目前只會保留在本分頁，關閉分頁後可能需要重新開始。
          </div>
        )}
        <div className='flex items-start justify-between gap-4'>
          <div>
            <p className='text-sm font-semibold uppercase tracking-[0.18em] text-cyan-300'>
              EduCare 開始引導
            </p>
            <p className='ui-muted mt-3 max-w-2xl text-sm leading-6'>
              你可以直接套用教學樣板、匯入現有助理，或先瀏覽已保存的內容。這些選擇只會記錄在這台裝置，之後可從設定重新開啟引導。
            </p>
          </div>
        </div>

        <div className='mt-7 grid gap-3 sm:grid-cols-2' role='list' aria-label='教學用途樣板'>
          {ASSISTANT_TEMPLATES.map(template => {
            const selected = template.id === selectedTemplateId;
            return (
              <button
                aria-pressed={selected}
                aria-label={`${template.name}樣板${selected ? '（已選取）' : ''}`}
                className={`ui-panel rounded-xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
                  selected
                    ? 'border-cyan-400 ring-1 ring-cyan-400/40'
                    : 'border-slate-700 bg-slate-800/60 hover:border-slate-500'
                }`}
                key={template.id}
                onClick={() => setSelectedTemplateId(template.id)}
                type='button'
              >
                <div className='flex items-center gap-3'>
                  <span aria-hidden='true' className='text-2xl'>
                    {template.icon}
                  </span>
                  <span>
                    <span className='ui-text block font-semibold'>{template.name}</span>
                    <span className='ui-muted text-xs'>{template.badge}</span>
                  </span>
                </div>
                <span className='ui-muted mt-3 block text-sm leading-5'>
                  {template.description}
                </span>
              </button>
            );
          })}
        </div>

        <div className='ui-panel mt-5 flex flex-col gap-3 rounded-xl p-4 sm:flex-row sm:items-center sm:justify-between'>
          <div className='min-w-0'>
            <p className='font-semibold text-white'>
              <span className='ui-text'>
                {selectedTemplate ? `已選：${selectedTemplate.name}` : '尚未選擇樣板'}
              </span>
            </p>
            <p className='ui-muted mt-1 text-sm'>套用後仍可在編輯器中調整名稱、描述與進階設定。</p>
          </div>
          <button
            className='shrink-0 rounded-lg bg-cyan-600 px-4 py-3 font-semibold text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50'
            disabled={!selectedTemplate}
            onClick={() => {
              if (!selectedTemplate) {
                return;
              }
              onApplyTemplate?.(selectedTemplate);
              void finish('template', selectedTemplate.id);
            }}
            type='button'
          >
            套用樣板並開始
          </button>
        </div>

        <div className='mt-5 grid gap-3 sm:grid-cols-2'>
          <button
            className='ui-panel rounded-lg border border-slate-600 px-4 py-3 text-left text-sm font-semibold transition hover:border-cyan-400 hover:bg-slate-800'
            onClick={() => {
              onImportAssistant?.();
              void finish('import');
            }}
            type='button'
          >
            <span className='ui-text'>匯入助理／協作包</span>
            <span className='ui-muted mt-1 block text-xs font-normal'>
              使用現有檔案，不需要先設定雲端。
            </span>
          </button>
          <button
            className='ui-panel rounded-lg border border-slate-600 px-4 py-3 text-left text-sm font-semibold transition hover:border-cyan-400 hover:bg-slate-800'
            onClick={() => {
              onBrowse?.();
              void finish('browse');
            }}
            type='button'
          >
            <span className='ui-text'>先瀏覽已保存內容</span>
            <span className='ui-muted mt-1 block text-xs font-normal'>
              資料留在本機，可稍後再建立助理。
            </span>
          </button>
        </div>

        <div className='mt-6 flex items-center justify-between border-t border-slate-800 pt-4'>
          <p className='ui-muted text-xs'>可在設定中重新開啟此引導。</p>
          <button
            className='ui-muted min-h-11 rounded-lg px-3 py-2 text-sm font-medium transition hover:bg-slate-800 hover:text-white'
            onClick={() => {
              void finish('skip');
            }}
            type='button'
          >
            先跳過
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default Onboarding;
