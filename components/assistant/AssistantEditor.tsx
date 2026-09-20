import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Assistant, RagChunk } from '../../types';
import { RAGFileUpload } from './RAGFileUpload';
import { useTursoAssistantStatus } from '../../hooks/useTursoAssistantStatus';
import { ASSISTANT_TEMPLATES, TemplateSelector, AssistantTemplate } from './TemplateSelector';
import { AppContext } from '../core/useAppContext';
import { registerWorkspaceOperationFlusher } from '../../services/workspaceOperationService';
import {
  buildAssistantDraftOwnerId,
  clearWorkspaceDraftAsync,
  isAssistantWorkspaceDraft,
  readWorkspaceDraft,
  type DraftPersistenceMode,
  WORKSPACE_DRAFT_SAVE_DELAY_MS,
  writeWorkspaceDraftWithOperationToken,
  writeWorkspaceDraftAsync,
} from '../../services/workspaceDraftService';

export type AssistantSaveStatus = 'idle' | 'saving' | 'saved' | 'error';
export type LeaveGuardResult = boolean | void | Promise<boolean | void>;

export interface AssistantEditorProps {
  assistant: Assistant | null;
  onSave: (assistant: Assistant) => Promise<void> | void;
  onCancel: () => void;
  onShare?: (assistant: Assistant) => void;
  availableAssistants?: Assistant[];
  onDraftChange?: (assistant: Assistant) => void;
  /** Called whenever the draft crosses the saved/unsaved boundary. */
  onDirtyChange?: (isDirty: boolean) => void;
  /** Return false to keep the editor open when a dirty draft is being left. */
  onBeforeLeave?: (draft: Assistant) => LeaveGuardResult;
  /** Alias for integrations that call the guard a leave attempt. */
  onLeaveAttempt?: (draft: Assistant) => LeaveGuardResult;
  onSaveStatusChange?: (status: AssistantSaveStatus) => void;
  initialTemplateId?: string;
  showFooterActions?: boolean;
  compact?: boolean;
}

const MAX_STARTER_PROMPTS = 4;
const MAX_STARTER_PROMPT_LENGTH = 100;
const DEFAULT_SYSTEM_PROMPT = '您是一個有用且專業的 AI 助理。';

type SaveSnapshot = {
  assistantId: string;
  signature: string;
};

const signatureForAssistant = (value: Assistant): string =>
  JSON.stringify({
    id: value.id,
    name: value.name,
    description: value.description,
    systemPrompt: value.systemPrompt,
    ragChunks: value.ragChunks ?? [],
    starterPrompts: value.starterPrompts ?? [],
    subagentDelegationEnabled: value.subagentDelegationEnabled ?? false,
    mathToolsEnabled: value.mathToolsEnabled ?? false,
    webSpeechToolsEnabled: value.webSpeechToolsEnabled ?? false,
    routableAssistantIds: value.routableAssistantIds ?? [],
  });

export const AssistantEditor: React.FC<AssistantEditorProps> = ({
  assistant,
  onSave,
  onCancel,
  onShare,
  availableAssistants,
  onDraftChange,
  onDirtyChange,
  onBeforeLeave,
  onLeaveAttempt,
  onSaveStatusChange,
  initialTemplateId,
  showFooterActions = true,
  compact = false,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [ragChunks, setRagChunks] = useState<RagChunk[]>([]);
  const [starterPrompts, setStarterPrompts] = useState<string[]>([]);
  const [newStarterPrompt, setNewStarterPrompt] = useState('');
  const [subagentDelegationEnabled, setSubagentDelegationEnabled] = useState(false);
  const [mathToolsEnabled, setMathToolsEnabled] = useState(false);
  const [webSpeechToolsEnabled, setWebSpeechToolsEnabled] = useState(false);
  const [routableAssistantIds, setRoutableAssistantIds] = useState<string[]>([]);
  const appContext = useContext(AppContext);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<AssistantSaveStatus>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [persistenceState, setPersistenceState] = useState<
    NonNullable<React.ComponentProps<typeof RAGFileUpload>['persistenceState']>
  >(assistant?.ragChunks?.length ? 'saved' : 'idle');
  const [advancedOpen, setAdvancedOpen] = useState(Boolean(assistant));
  const [pendingTemplate, setPendingTemplate] = useState<AssistantTemplate | null>(null);
  const [highlightFields, setHighlightFields] = useState(false);
  const draftPersistenceEnabled = showFooterActions && !assistant?.isShared;
  const draftOwnerId = buildAssistantDraftOwnerId(assistant?.id);
  const restoredDraftResult = useMemo(
    () =>
      draftPersistenceEnabled
        ? readWorkspaceDraft<Assistant>('assistant', draftOwnerId)
        : { value: undefined, mode: 'persistent' as DraftPersistenceMode },
    [draftOwnerId, draftPersistenceEnabled],
  );
  const restoredDraft = isAssistantWorkspaceDraft(restoredDraftResult.value)
    ? restoredDraftResult.value
    : null;
  const [draftPersistenceMode, setDraftPersistenceMode] = useState<DraftPersistenceMode>(
    restoredDraftResult.mode,
  );
  const hydratedAssistantIdRef = useRef<string | null | undefined>(undefined);
  const draftOwnerIdRef = useRef(draftOwnerId);
  const restoredDraftOwnerRef = useRef<string | null>(null);
  const isHydratedRef = useRef(false);
  const initialSignatureRef = useRef<string | null>(null);
  const pendingSaveRef = useRef<SaveSnapshot | null>(null);
  const lastSavedAssistantRef = useRef<SaveSnapshot | null>(null);

  if (hydratedAssistantIdRef.current !== (assistant?.id ?? null)) {
    hydratedAssistantIdRef.current = assistant?.id ?? null;
    isHydratedRef.current = false;
  }
  draftOwnerIdRef.current = draftOwnerId;

  // Check if assistant exists in Turso for sharing
  const { canShare } = useTursoAssistantStatus(assistant?.id || null);
  const routableAssistants = availableAssistants ?? appContext?.state.assistants ?? [];

  const draftAssistant = useMemo<Assistant>(
    () => ({
      ...assistant,
      id: assistant?.id ?? '',
      name: name.trim(),
      description: description.trim(),
      systemPrompt: systemPrompt.trim(),
      ragChunks,
      starterPrompts,
      createdAt: assistant?.createdAt ?? 0,
      subagentDelegationEnabled,
      mathToolsEnabled,
      webSpeechToolsEnabled,
      routableAssistantIds,
    }),
    [
      assistant,
      description,
      mathToolsEnabled,
      name,
      ragChunks,
      routableAssistantIds,
      starterPrompts,
      subagentDelegationEnabled,
      systemPrompt,
      webSpeechToolsEnabled,
    ],
  );

  // Bundle editing uses one outer save button, so keep its parent in sync with this draft.
  // This effect is declared before hydration so switching assistants cannot emit stale fields.
  useEffect(() => {
    if (assistant && onDraftChange && isHydratedRef.current) {
      onDraftChange(draftAssistant);
    }
  }, [assistant, draftAssistant, onDraftChange]);

  useEffect(() => {
    const baseline: Assistant = assistant
      ? {
          ...assistant,
          description: assistant.description || '',
          systemPrompt: assistant.systemPrompt || DEFAULT_SYSTEM_PROMPT,
          ragChunks: assistant.ragChunks || [],
          starterPrompts: assistant.starterPrompts || [],
          subagentDelegationEnabled: assistant.subagentDelegationEnabled ?? false,
          mathToolsEnabled: assistant.mathToolsEnabled ?? false,
          webSpeechToolsEnabled: assistant.webSpeechToolsEnabled ?? false,
          routableAssistantIds: assistant.routableAssistantIds ?? [],
        }
      : {
          id: '',
          name: '',
          description: '',
          systemPrompt: DEFAULT_SYSTEM_PROMPT,
          ragChunks: [],
          starterPrompts: [],
          createdAt: 0,
          subagentDelegationEnabled: false,
          mathToolsEnabled: false,
          webSpeechToolsEnabled: false,
          routableAssistantIds: [],
        };
    const baselineSignature = signatureForAssistant(baseline);
    const shouldConsiderDraft =
      draftPersistenceEnabled && restoredDraftOwnerRef.current !== draftOwnerId;
    const canRestoreDraft = Boolean(
      shouldConsiderDraft &&
        restoredDraft &&
        (!assistant || !restoredDraft.id || restoredDraft.id === assistant.id),
    );
    if (draftPersistenceEnabled) {
      // A draft is restored at most once per owner. Parent updates after a
      // successful save must hydrate from the saved assistant, not the stale
      // memoized pre-save draft value.
      restoredDraftOwnerRef.current = draftOwnerId;
    } else {
      restoredDraftOwnerRef.current = null;
    }
    const hydratedValues = canRestoreDraft
      ? {
          ...baseline,
          name: restoredDraft?.name ?? baseline.name,
          description: restoredDraft?.description ?? baseline.description,
          systemPrompt: restoredDraft?.systemPrompt ?? baseline.systemPrompt,
          ragChunks: restoredDraft?.ragChunks ?? baseline.ragChunks,
          starterPrompts: restoredDraft?.starterPrompts ?? baseline.starterPrompts,
          subagentDelegationEnabled:
            restoredDraft?.subagentDelegationEnabled ?? baseline.subagentDelegationEnabled,
          mathToolsEnabled: restoredDraft?.mathToolsEnabled ?? baseline.mathToolsEnabled,
          webSpeechToolsEnabled:
            restoredDraft?.webSpeechToolsEnabled ?? baseline.webSpeechToolsEnabled,
          routableAssistantIds:
            restoredDraft?.routableAssistantIds ?? baseline.routableAssistantIds,
        }
      : baseline;
    const incomingAssistantId = assistant?.id ?? null;
    const expectedSave = pendingSaveRef.current ?? lastSavedAssistantRef.current;
    const isExpectedSaveUpdate =
      expectedSave?.assistantId === incomingAssistantId &&
      expectedSave.signature === baselineSignature;
    const isPendingSaveUpdate =
      pendingSaveRef.current?.assistantId === incomingAssistantId &&
      pendingSaveRef.current?.signature === baselineSignature;

    if (!isExpectedSaveUpdate) {
      pendingSaveRef.current = null;
      lastSavedAssistantRef.current = null;
    }

    if (!isPendingSaveUpdate) {
      initialSignatureRef.current = baselineSignature;
    }

    if (assistant || canRestoreDraft) {
      setName(hydratedValues.name);
      setDescription(hydratedValues.description || '');
      setSystemPrompt(hydratedValues.systemPrompt || DEFAULT_SYSTEM_PROMPT);
      setRagChunks(hydratedValues.ragChunks || []);
      setStarterPrompts(hydratedValues.starterPrompts || []);
      setNewStarterPrompt('');
      setSubagentDelegationEnabled(hydratedValues.subagentDelegationEnabled ?? false);
      setMathToolsEnabled(hydratedValues.mathToolsEnabled ?? false);
      setWebSpeechToolsEnabled(hydratedValues.webSpeechToolsEnabled ?? false);
      setRoutableAssistantIds(hydratedValues.routableAssistantIds ?? []);
    } else {
      setName('');
      setDescription('');
      setSystemPrompt('您是一個有用且專業的 AI 助理。');
      setRagChunks([]);
      setStarterPrompts([]);
      setNewStarterPrompt('');
      setSubagentDelegationEnabled(false);
      setMathToolsEnabled(false);
      setWebSpeechToolsEnabled(false);
      setRoutableAssistantIds([]);
    }
    setAdvancedOpen(Boolean(assistant));
    setPendingTemplate(null);
    if (!isExpectedSaveUpdate) {
      setSaveStatus('idle');
      setSaveError(null);
      onSaveStatusChange?.('idle');
    }
    if (!isPendingSaveUpdate) {
      setPersistenceState(
        canRestoreDraft ? 'idle' : assistant?.ragChunks?.length ? 'saved' : 'idle',
      );
    }
    setDraftPersistenceMode(restoredDraftResult.mode);
    isHydratedRef.current = true;
  }, [
    assistant,
    draftOwnerId,
    draftPersistenceEnabled,
    onSaveStatusChange,
    restoredDraft,
    restoredDraftResult.mode,
  ]);

  const isDirty =
    isHydratedRef.current &&
    initialSignatureRef.current !== null &&
    signatureForAssistant(draftAssistant) !== initialSignatureRef.current;

  const latestDraftRef = useRef(draftAssistant);
  const latestDirtyRef = useRef(isDirty);
  latestDraftRef.current = draftAssistant;
  latestDirtyRef.current = isDirty;

  useEffect(() => {
    latestDraftRef.current = draftAssistant;
    latestDirtyRef.current = isDirty;
  }, [draftAssistant, isDirty]);

  useEffect(() => {
    if (!draftPersistenceEnabled || !isHydratedRef.current || !isDirty) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      const draft = latestDraftRef.current;
      void writeWorkspaceDraftAsync('assistant', draftOwnerId, draft).then(mode => {
        if (isHydratedRef.current && draftOwnerIdRef.current === draftOwnerId) {
          setDraftPersistenceMode(mode);
        }
      });
    }, WORKSPACE_DRAFT_SAVE_DELAY_MS);

    return () => window.clearTimeout(timeoutId);
  }, [draftAssistant, draftOwnerId, draftPersistenceEnabled, isDirty]);

  useEffect(() => {
    if (!draftPersistenceEnabled) {
      return;
    }

    // Capture the mounted form even when the 500ms debounce has not fired.
    // This callback runs inside the active archive barrier, so it must use the
    // opaque raw token path rather than enqueueing another gated write.
    return registerWorkspaceOperationFlusher(operationToken => {
      if (!isHydratedRef.current || !latestDirtyRef.current) {
        return;
      }
      writeWorkspaceDraftWithOperationToken(
        operationToken,
        'assistant',
        draftOwnerIdRef.current,
        latestDraftRef.current,
      );
    });
  }, [draftPersistenceEnabled]);

  useEffect(() => {
    return () => {
      if (draftPersistenceEnabled && latestDirtyRef.current) {
        void writeWorkspaceDraftAsync('assistant', draftOwnerId, latestDraftRef.current);
      }
    };
  }, [draftOwnerId, draftPersistenceEnabled]);

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  useEffect(() => {
    if (typeof window === 'undefined' || !isDirty) {
      return;
    }

    const handleBeforeUnload = (event: Event) => {
      event.preventDefault();
      (event as unknown as { returnValue: string }).returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  useEffect(() => {
    if (assistant || !initialTemplateId) {
      return;
    }
    const template = ASSISTANT_TEMPLATES.find(item => item.id === initialTemplateId);
    if (!template) {
      return;
    }
    setName(template.name);
    setDescription(template.description);
    setSystemPrompt(template.systemPrompt);
    setHighlightFields(true);
    setTimeout(() => setHighlightFields(false), 1000);
  }, [assistant, initialTemplateId]);

  const updateSaveStatus = (status: AssistantSaveStatus) => {
    setSaveStatus(status);
    onSaveStatusChange?.(status);
  };

  const hasMeaningfulDraft = (): boolean =>
    Boolean(
      name.trim() ||
        description.trim() ||
        (systemPrompt.trim() && systemPrompt.trim() !== DEFAULT_SYSTEM_PROMPT) ||
        starterPrompts.length > 0 ||
        newStarterPrompt.trim() ||
        ragChunks.length > 0 ||
        subagentDelegationEnabled ||
        mathToolsEnabled ||
        webSpeechToolsEnabled ||
        routableAssistantIds.length > 0,
    );

  const applyTemplate = (template: AssistantTemplate) => {
    setName(template.name);
    setDescription(template.description);
    setSystemPrompt(template.systemPrompt);
    setPendingTemplate(null);
    setAdvancedOpen(false);
    setHighlightFields(true);
    setTimeout(() => setHighlightFields(false), 1000);
  };

  const handleTemplateSelect = (template: AssistantTemplate) => {
    if (hasMeaningfulDraft()) {
      setPendingTemplate(template);
      return;
    }
    applyTemplate(template);
  };

  const handleCancel = async () => {
    if (isDirty) {
      const guard = onBeforeLeave ?? onLeaveAttempt;
      if (guard) {
        const result = await guard(draftAssistant);
        if (result === false) {
          return;
        }
      } else if (
        typeof window !== 'undefined' &&
        !window.confirm('尚有未保存的變更，確定要離開嗎？')
      ) {
        return;
      }
    }
    onDirtyChange?.(false);
    onCancel();
  };

  // 將輸入框中尚未按「新增」的建議提問一併納入；驗證失敗回傳 null（呼叫端應中止）。
  const commitPendingStarterPrompt = (): string[] | null => {
    const pendingPrompt = newStarterPrompt.trim();
    if (!pendingPrompt) {
      return starterPrompts;
    }
    if (starterPrompts.length >= MAX_STARTER_PROMPTS) {
      alert('建議提問最多只能設定 4 條。');
      setSaveError('建議提問最多只能設定 4 條。');
      updateSaveStatus('error');
      return null;
    }
    if (pendingPrompt.length > MAX_STARTER_PROMPT_LENGTH) {
      alert(`建議提問請控制在 ${MAX_STARTER_PROMPT_LENGTH} 字以內。`);
      setSaveError(`建議提問請控制在 ${MAX_STARTER_PROMPT_LENGTH} 字以內。`);
      updateSaveStatus('error');
      return null;
    }
    const nextPrompts = [...starterPrompts, pendingPrompt];
    setStarterPrompts(nextPrompts);
    setNewStarterPrompt('');
    return nextPrompts;
  };

  const handleSave = async () => {
    if (isSaving) {
      return;
    }

    if (!name.trim()) {
      alert('助理名稱為必填。');
      setSaveError('請輸入助理名稱後再保存。');
      updateSaveStatus('error');
      return;
    }

    const finalStarterPrompts = commitPendingStarterPrompt();
    if (finalStarterPrompts === null) {
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    updateSaveStatus('saving');
    setPersistenceState('saving');
    let saveSnapshot: SaveSnapshot | null = null;
    try {
      const assistantId = assistant?.id || `asst_${Date.now()}`;
      const newAssistant: Assistant = {
        ...assistant,
        id: assistantId,
        name: name.trim(),
        description: description.trim(),
        systemPrompt: systemPrompt.trim(),
        ragChunks,
        starterPrompts: finalStarterPrompts,
        createdAt: assistant?.createdAt ?? Date.now(),
        subagentDelegationEnabled,
        mathToolsEnabled,
        webSpeechToolsEnabled,
        routableAssistantIds,
      };
      saveSnapshot = {
        assistantId,
        signature: signatureForAssistant(newAssistant),
      };
      pendingSaveRef.current = saveSnapshot;
      lastSavedAssistantRef.current = null;

      await onSave(newAssistant);
      if (draftPersistenceEnabled) {
        setDraftPersistenceMode(await clearWorkspaceDraftAsync('assistant', draftOwnerId));
      }
      latestDraftRef.current = newAssistant;
      latestDirtyRef.current = false;
      const currentAssistantId = hydratedAssistantIdRef.current ?? null;
      const originalAssistantId = assistant?.id ?? null;
      const saveIsStillCurrent =
        pendingSaveRef.current === saveSnapshot &&
        (currentAssistantId === originalAssistantId ||
          currentAssistantId === saveSnapshot.assistantId);
      if (!saveIsStillCurrent) {
        return;
      }

      pendingSaveRef.current = null;
      lastSavedAssistantRef.current = saveSnapshot;
      initialSignatureRef.current = saveSnapshot.signature;
      setPersistenceState('saved');
      updateSaveStatus('saved');
    } catch (error) {
      if (saveSnapshot && pendingSaveRef.current === saveSnapshot) {
        pendingSaveRef.current = null;
        lastSavedAssistantRef.current = null;
      }
      const message = error instanceof Error ? error.message : '未知錯誤';
      setSaveError(`保存失敗：${message}。內容仍保留在表單中，請重試。`);
      setPersistenceState('error');
      updateSaveStatus('error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRagChunksChange = (newChunks: RagChunk[]) => {
    setRagChunks(newChunks);
    setPersistenceState('idle');
  };

  const handleAddStarterPrompt = () => {
    commitPendingStarterPrompt();
  };

  const handleRemoveStarterPrompt = (index: number) => {
    setStarterPrompts(current => current.filter((_, currentIndex) => currentIndex !== index));
  };

  return (
    <div
      data-testid='assistant-editor'
      className={`assistant-editor chat-scroll relative flex h-full flex-col overflow-y-auto ${
        compact ? 'bg-[#141c26] p-5' : 'bg-gradient-to-br from-gray-800 to-gray-900 p-8'
      }`}
    >
      <h2
        className={`assistant-editor__title ${
          compact
            ? 'mb-5 text-lg font-semibold text-gray-100'
            : 'mb-8 bg-gradient-to-r from-white to-gray-300 bg-clip-text text-3xl font-bold text-transparent'
        }`}
      >
        {assistant ? '編輯助理' : '新增助理'}
      </h2>

      {!assistant && <TemplateSelector onSelectTemplate={handleTemplateSelect} />}

      {pendingTemplate && (
        <div
          className='mb-6 rounded-xl border border-amber-500/60 bg-amber-950/30 p-4 text-amber-100'
          data-testid='template-overwrite-confirmation'
          role='alert'
        >
          <p className='font-semibold'>目前的編輯內容會被樣板覆蓋</p>
          <p className='mt-1 text-sm text-amber-200/80'>
            若要套用「{pendingTemplate.name}
            」，現有名稱、描述與系統提示將被替換；其他進階資料會保留。
          </p>
          <div className='mt-3 flex flex-wrap gap-2'>
            <button
              className='rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-amber-950 transition hover:bg-amber-400'
              onClick={() => applyTemplate(pendingTemplate)}
              type='button'
            >
              套用並覆蓋
            </button>
            <button
              className='rounded-lg border border-amber-400/60 px-3 py-2 text-sm font-semibold text-amber-100 transition hover:bg-amber-900/40'
              onClick={() => setPendingTemplate(null)}
              type='button'
            >
              取消套用
            </button>
          </div>
        </div>
      )}

      <div className='mb-6'>
        <label htmlFor='name' className='mb-2 block text-sm font-semibold text-gray-300'>
          助理名稱
        </label>
        <input
          type='text'
          id='name'
          value={name}
          onChange={e => setName(e.target.value)}
          className={`w-full rounded-xl border-2 bg-gray-700/80 px-4 py-3 text-white placeholder-gray-400 shadow-inner transition-all duration-300 focus:border-cyan-500/50 focus:bg-gray-700 focus:ring-2 focus:ring-cyan-500/50 ${
            highlightFields
              ? 'animate-pulse border-cyan-500 bg-gray-750/90 ring-4 ring-cyan-500/30'
              : 'border-gray-600/50'
          }`}
          placeholder='例如：行銷文案寫手'
        />
      </div>

      <div className='mb-6'>
        <label htmlFor='description' className='mb-2 block text-sm font-semibold text-gray-300'>
          公開描述
          <span className='ml-2 text-xs text-gray-500'>(分享時顯示給用戶)</span>
        </label>
        <textarea
          id='description'
          value={description}
          onChange={e => setDescription(e.target.value)}
          rows={3}
          className={`w-full resize-none rounded-xl border-2 bg-gray-700/80 px-4 py-3 text-white placeholder-gray-400 shadow-inner transition-all duration-300 focus:border-cyan-500/50 focus:bg-gray-700 focus:ring-2 focus:ring-cyan-500/50 ${
            highlightFields
              ? 'animate-pulse border-cyan-500 bg-gray-750/90 ring-4 ring-cyan-500/30'
              : 'border-gray-600/50'
          }`}
          placeholder='簡單描述這個助理能幫助什麼...'
        />
      </div>

      <details
        className='mb-6 rounded-xl border border-gray-700/60 bg-gray-900/30 p-4'
        data-testid='advanced-settings'
        open={advancedOpen}
        onToggle={event => setAdvancedOpen(event.currentTarget.open)}
      >
        <summary className='cursor-pointer list-none text-sm font-semibold text-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400'>
          進階設定
          <span className='ml-2 text-xs font-normal text-gray-500'>
            系統提示、建議提問、工具與教材
          </span>
        </summary>
        <div className='mt-5'>
          <div className='mb-6'>
            <label
              htmlFor='systemPrompt'
              className='mb-2 block text-sm font-semibold text-gray-300'
            >
              系統提示
            </label>
            <textarea
              id='systemPrompt'
              value={systemPrompt}
              onChange={e => setSystemPrompt(e.target.value)}
              rows={8}
              className={`w-full resize-none rounded-xl border-2 bg-gray-700/80 px-4 py-3 text-white placeholder-gray-400 shadow-inner transition-all duration-300 focus:border-cyan-500/50 focus:bg-gray-700 focus:ring-2 focus:ring-cyan-500/50 ${
                highlightFields
                  ? 'animate-pulse border-cyan-500 bg-gray-750/90 ring-4 ring-cyan-500/30'
                  : 'border-gray-600/50'
              }`}
              placeholder='定義助理的角色、個性和指導。'
            />
          </div>

          <div className='mb-6'>
            <label className='mb-2 block text-sm font-semibold text-gray-300'>
              建議提問
              <span className='ml-2 text-xs text-gray-500'>(最多 4 條，每條建議 100 字以內)</span>
            </label>
            <div className='space-y-3'>
              <div className='flex gap-3'>
                <input
                  type='text'
                  value={newStarterPrompt}
                  onChange={e => setNewStarterPrompt(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      handleAddStarterPrompt();
                    }
                  }}
                  className='flex-1 rounded-xl border border-gray-600/50 bg-gray-700/80 px-4 py-3 text-white placeholder-gray-400 shadow-inner transition-all duration-300 focus:border-cyan-500/50 focus:bg-gray-700 focus:ring-2 focus:ring-cyan-500/50'
                  placeholder='例如：幫我整理這份教材的重點'
                />
                <button
                  type='button'
                  onClick={handleAddStarterPrompt}
                  className='rounded-xl border border-cyan-500/40 bg-cyan-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-cyan-500'
                >
                  新增
                </button>
              </div>
              <ul className='space-y-2'>
                {starterPrompts.map((prompt, index) => (
                  <li
                    key={`${prompt}-${index}`}
                    className='flex items-center justify-between rounded-xl border border-gray-700/50 bg-gray-800/60 px-4 py-3 text-sm text-gray-200'
                  >
                    <span>{prompt}</span>
                    <button
                      type='button'
                      onClick={() => handleRemoveStarterPrompt(index)}
                      className='rounded-lg px-3 py-1 text-xs text-rose-200 transition hover:bg-rose-500/10 hover:text-rose-100'
                    >
                      刪除
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className='mb-6'>
            <label
              htmlFor='subagent-delegation-enabled'
              className='flex cursor-pointer select-none items-start gap-3'
            >
              <input
                id='subagent-delegation-enabled'
                type='checkbox'
                checked={subagentDelegationEnabled}
                onChange={e => setSubagentDelegationEnabled(e.target.checked)}
                disabled={isSaving}
                className='mt-1 h-4 w-4 rounded border-gray-500 bg-gray-700 text-cyan-500 focus:ring-2 focus:ring-cyan-500/50 focus:ring-offset-0'
                aria-describedby='subagent-delegation-help'
              />
              <span className='flex flex-col'>
                <span className='text-sm font-semibold text-gray-300'>
                  Subagent delegation (平行子代理人委派)
                </span>
                <span
                  id='subagent-delegation-help'
                  className='mt-1 text-xs leading-relaxed text-gray-500'
                >
                  開啟後,主模型可把研究或受限 HTML 工作委派給 1-4 個子代理人並行處理。這會增加 token
                  成本,且 shared mode 會在執行時強制停用。
                </span>
              </span>
            </label>
          </div>

          <div className='mb-6'>
            <label
              htmlFor='math-tools-enabled'
              className='flex cursor-pointer select-none items-start gap-3'
            >
              <input
                id='math-tools-enabled'
                type='checkbox'
                checked={mathToolsEnabled}
                onChange={e => setMathToolsEnabled(e.target.checked)}
                disabled={isSaving}
                className='mt-1 h-4 w-4 rounded border-gray-500 bg-gray-700 text-cyan-500 focus:ring-2 focus:ring-cyan-500/50 focus:ring-offset-0'
                aria-describedby='math-tools-help'
              />
              <span className='flex flex-col'>
                <span className='text-sm font-semibold text-gray-300'>數學計算與幾何繪圖工具</span>
                <span id='math-tools-help' className='mt-1 text-xs leading-relaxed text-gray-500'>
                  開啟後，助理可使用數學計算與幾何繪圖工具。Ollama
                  目前不支援工具呼叫，因此無法使用此功能。
                </span>
              </span>
            </label>
          </div>

          <div className='mb-6'>
            <label
              htmlFor='web-speech-tools-enabled'
              className='flex cursor-pointer select-none items-start gap-3'
            >
              <input
                id='web-speech-tools-enabled'
                type='checkbox'
                checked={webSpeechToolsEnabled}
                onChange={e => setWebSpeechToolsEnabled(e.target.checked)}
                disabled={isSaving}
                className='mt-1 h-4 w-4 rounded border-gray-500 bg-gray-700 text-cyan-500 focus:ring-2 focus:ring-cyan-500/50 focus:ring-offset-0'
                aria-describedby='web-speech-tools-help'
              />
              <span className='flex flex-col'>
                <span className='text-sm font-semibold text-gray-300'>語音發音與聽說練習工具</span>
                <span
                  id='web-speech-tools-help'
                  className='mt-1 text-xs leading-relaxed text-gray-500'
                >
                  開啟後，助理可產生瀏覽器原生 Web Speech
                  發音卡，適合英文與其他語言聽說練習；此模式會停用 HTML 專案工具。
                </span>
              </span>
            </label>
          </div>

          <div className='mb-6'>
            <fieldset>
              <legend className='text-sm font-semibold text-gray-300'>可轉接助理</legend>
              <p className='mt-1 text-xs text-gray-500'>
                僅勾選可由此助理建議轉接的目標；分享模式下目標也必須已分享。
              </p>
              <div className='mt-3 space-y-2'>
                {routableAssistants
                  .filter(item => item.id !== assistant?.id)
                  .map(item => (
                    <label
                      key={item.id}
                      className='flex cursor-pointer items-center gap-2 text-sm text-gray-200'
                    >
                      <input
                        type='checkbox'
                        checked={routableAssistantIds.includes(item.id)}
                        disabled={isSaving}
                        onChange={event =>
                          setRoutableAssistantIds(current =>
                            event.target.checked
                              ? [...new Set([...current, item.id])]
                              : current.filter(id => id !== item.id),
                          )
                        }
                      />
                      {item.name}
                    </label>
                  ))}
              </div>
            </fieldset>
          </div>

          <RAGFileUpload
            ragChunks={ragChunks}
            onRagChunksChange={handleRagChunksChange}
            disabled={isSaving}
            persistenceState={persistenceState}
          />
        </div>
      </details>

      {showFooterActions && (
        <div className='assistant-editor__footer sticky bottom-0 z-10 mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-gray-700/70 bg-gray-900/95 py-4 backdrop-blur'>
          <div className='min-h-10 flex-1 text-sm' aria-live='polite'>
            {saveStatus === 'saving' && (
              <p className='text-cyan-300' data-testid='assistant-save-status' role='status'>
                正在保存助理…
              </p>
            )}
            {saveStatus === 'saved' && (
              <p className='text-emerald-300' data-testid='assistant-save-status' role='status'>
                已保存於這台裝置。
              </p>
            )}
            {saveStatus === 'error' && saveError && (
              <p className='text-rose-300' data-testid='assistant-save-status' role='alert'>
                {saveError}
              </p>
            )}
            {draftPersistenceEnabled && draftPersistenceMode === 'session' && (
              <p
                className='text-amber-200'
                data-testid='assistant-draft-persistence-warning'
                role='status'
              >
                瀏覽器儲存空間目前無法使用；草稿只會保留在本分頁，關閉分頁後可能遺失。
              </p>
            )}
          </div>
          {/* Left side - Share section (only show for existing assistants) */}
          <div>
            {assistant && (
              <div className='space-y-2'>
                <div className='flex items-center space-x-2'>
                  <button
                    onClick={() => {
                      if (canShare) {
                        onShare?.(assistant);
                      }
                    }}
                    disabled={!canShare}
                    className={`flex items-center space-x-2 rounded-xl px-6 py-3 font-semibold shadow-lg transition-all duration-300 ${
                      canShare
                        ? 'cursor-pointer bg-gradient-to-r from-blue-600 to-purple-600 text-white hover:-translate-y-0.5 hover:from-blue-500 hover:to-purple-500 hover:shadow-xl'
                        : 'cursor-not-allowed bg-gray-600 text-gray-400 opacity-50'
                    }`}
                    title={canShare ? '分享助理' : '需要先遷移到 Turso 才能分享'}
                  >
                    <svg className='h-4 w-4' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                      <path
                        strokeLinecap='round'
                        strokeLinejoin='round'
                        strokeWidth={2}
                        d='M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z'
                      />
                    </svg>
                    <span>🎯 分享助理</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Right side - Save and Cancel buttons */}
          <div className='flex space-x-4'>
            <button
              data-testid='cancel-button'
              onClick={() => void handleCancel()}
              className='assistant-editor__cancel rounded-xl bg-gray-600/80 px-6 py-3 font-semibold text-white transition-all duration-300 hover:-translate-y-0.5 hover:bg-gray-500 hover:shadow-lg'
              type='button'
            >
              取消
            </button>
            <button
              data-testid='save-button'
              onClick={handleSave}
              className='assistant-editor__save rounded-xl bg-gradient-to-r from-cyan-600 to-cyan-500 px-8 py-3 font-bold text-white transition-all duration-300 hover:-translate-y-0.5 hover:from-cyan-500 hover:to-cyan-400 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:transform-none'
              disabled={isSaving}
              type='button'
            >
              {isSaving ? (
                <span className='flex items-center gap-2'>
                  <div className='h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent'></div>
                  處理中...
                </span>
              ) : (
                '保存助理'
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
