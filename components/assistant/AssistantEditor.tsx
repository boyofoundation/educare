import React, { useContext, useEffect, useState } from 'react';
import { Assistant, RagChunk } from '../../types';
import { RAGFileUpload } from './RAGFileUpload';
import { useTursoAssistantStatus } from '../../hooks/useTursoAssistantStatus';
import { TemplateSelector, AssistantTemplate } from './TemplateSelector';
import { AppContext } from '../core/useAppContext';

interface AssistantEditorProps {
  assistant: Assistant | null;
  onSave: (assistant: Assistant) => Promise<void> | void;
  onCancel: () => void;
  onShare?: (assistant: Assistant) => void;
}

const MAX_STARTER_PROMPTS = 4;
const MAX_STARTER_PROMPT_LENGTH = 100;

export const AssistantEditor: React.FC<AssistantEditorProps> = ({
  assistant,
  onSave,
  onCancel,
  onShare,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [ragChunks, setRagChunks] = useState<RagChunk[]>([]);
  const [starterPrompts, setStarterPrompts] = useState<string[]>([]);
  const [newStarterPrompt, setNewStarterPrompt] = useState('');
  const [subagentDelegationEnabled, setSubagentDelegationEnabled] = useState(false);
  const [routableAssistantIds, setRoutableAssistantIds] = useState<string[]>([]);
  const appContext = useContext(AppContext);
  const [isSaving, setIsSaving] = useState(false);
  const [highlightFields, setHighlightFields] = useState(false);

  // Check if assistant exists in Turso for sharing
  const { canShare } = useTursoAssistantStatus(assistant?.id || null);

  useEffect(() => {
    if (assistant) {
      setName(assistant.name);
      setDescription(assistant.description || '');
      setSystemPrompt(assistant.systemPrompt);
      setRagChunks(assistant.ragChunks || []);
      setStarterPrompts(assistant.starterPrompts || []);
      setNewStarterPrompt('');
      setSubagentDelegationEnabled(assistant.subagentDelegationEnabled ?? false);
      setRoutableAssistantIds(assistant.routableAssistantIds ?? []);
    } else {
      setName('');
      setDescription('');
      setSystemPrompt('您是一個有用且專業的 AI 助理。');
      setRagChunks([]);
      setStarterPrompts([]);
      setNewStarterPrompt('');
      setSubagentDelegationEnabled(false);
      setRoutableAssistantIds([]);
    }
  }, [assistant]);

  // 將輸入框中尚未按「新增」的建議提問一併納入；驗證失敗回傳 null（呼叫端應中止）。
  const commitPendingStarterPrompt = (): string[] | null => {
    const pendingPrompt = newStarterPrompt.trim();
    if (!pendingPrompt) {
      return starterPrompts;
    }
    if (starterPrompts.length >= MAX_STARTER_PROMPTS) {
      alert('建議提問最多只能設定 4 條。');
      return null;
    }
    if (pendingPrompt.length > MAX_STARTER_PROMPT_LENGTH) {
      alert(`建議提問請控制在 ${MAX_STARTER_PROMPT_LENGTH} 字以內。`);
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
      return;
    }

    const finalStarterPrompts = commitPendingStarterPrompt();
    if (finalStarterPrompts === null) {
      return;
    }

    setIsSaving(true);
    try {
      const assistantId = assistant?.id || `asst_${Date.now()}`;
      const newAssistant: Assistant = {
        id: assistantId,
        name: name.trim(),
        description: description.trim(),
        systemPrompt: systemPrompt.trim(),
        ragChunks,
        starterPrompts: finalStarterPrompts,
        createdAt: assistant?.createdAt || Date.now(),
        subagentDelegationEnabled,
        routableAssistantIds,
      };

      console.log('Assistant saved locally. Use migration settings to sync to Turso if needed.');

      await onSave(newAssistant);
    } catch (error) {
      console.error('Failed to save assistant:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleRagChunksChange = (newChunks: RagChunk[]) => {
    setRagChunks(newChunks);
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
      className='chat-scroll flex h-full flex-col overflow-y-auto bg-gradient-to-br from-gray-800 to-gray-900 p-8'
    >
      <h2 className='mb-8 bg-gradient-to-r from-white to-gray-300 bg-clip-text text-3xl font-bold text-transparent'>
        {assistant ? '編輯助理' : '新增助理'}
      </h2>

      {!assistant && (
        <TemplateSelector
          onSelectTemplate={(template: AssistantTemplate) => {
            setName(template.name);
            setDescription(template.description);
            setSystemPrompt(template.systemPrompt);
            setHighlightFields(true);
            setTimeout(() => setHighlightFields(false), 1000);
          }}
        />
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

      <div className='mb-6'>
        <label htmlFor='systemPrompt' className='mb-2 block text-sm font-semibold text-gray-300'>
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
        <fieldset>
          <legend className='text-sm font-semibold text-gray-300'>可轉接助理</legend>
          <p className='mt-1 text-xs text-gray-500'>
            僅勾選可由此助理建議轉接的目標；分享模式下目標也必須已分享。
          </p>
          <div className='mt-3 space-y-2'>
            {(appContext?.state.assistants ?? [])
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
      />

      <div className='mt-auto flex items-center justify-between'>
        {/* Left side - Share section (only show for existing assistants) */}
        <div className='flex-1'>
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
            onClick={onCancel}
            className='rounded-xl bg-gray-600/80 px-6 py-3 font-semibold text-white transition-all duration-300 hover:-translate-y-0.5 hover:bg-gray-500 hover:shadow-lg'
          >
            取消
          </button>
          <button
            data-testid='save-button'
            onClick={handleSave}
            className='rounded-xl bg-gradient-to-r from-cyan-600 to-cyan-500 px-8 py-3 font-bold text-white transition-all duration-300 hover:-translate-y-0.5 hover:from-cyan-500 hover:to-cyan-400 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:transform-none'
            disabled={isSaving}
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
    </div>
  );
};
