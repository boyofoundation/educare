import React, { useState, useEffect } from 'react';
import { Assistant, RagChunk } from '../../types';
import { RAGFileUpload } from './RAGFileUpload';
import { useTursoAssistantStatus } from '../../hooks/useTursoAssistantStatus';
import { TemplateSelector, AssistantTemplate } from './TemplateSelector';

interface AssistantEditorProps {
  assistant: Assistant | null;
  onSave: (assistant: Assistant) => Promise<void> | void;
  onCancel: () => void;
  onShare?: (assistant: Assistant) => void;
}

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
  const [agentHarnessEnabled, setAgentHarnessEnabled] = useState(true);
  const [subagentDelegationEnabled, setSubagentDelegationEnabled] = useState(false);
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
      setAgentHarnessEnabled(assistant.agentHarnessEnabled ?? true);
      setSubagentDelegationEnabled(assistant.subagentDelegationEnabled ?? false);
    } else {
      setName('');
      setDescription('');
      setSystemPrompt('您是一個有用且專業的 AI 助理。');
      setRagChunks([]);
      setAgentHarnessEnabled(true);
      setSubagentDelegationEnabled(false);
    }
  }, [assistant]);

  const handleSave = async () => {
    if (isSaving) {
      return;
    }

    if (!name.trim()) {
      alert('助理名稱為必填。');
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
        ragChunks: ragChunks,
        createdAt: assistant?.createdAt || Date.now(),
        agentHarnessEnabled,
        subagentDelegationEnabled,
      };

      // 只保存到本地，不自動上傳到 Turso
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

  return (
    <div
      data-testid='assistant-editor'
      className='flex flex-col h-full bg-gradient-to-br from-gray-800 to-gray-900 p-8 overflow-y-auto chat-scroll'
    >
      <h2 className='text-3xl font-bold mb-8 bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent'>
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
        <label htmlFor='name' className='block text-sm font-semibold text-gray-300 mb-2'>
          助理名稱
        </label>
        <input
          type='text'
          id='name'
          value={name}
          onChange={e => setName(e.target.value)}
          className={`w-full bg-gray-700/80 border-2 rounded-xl px-4 py-3 text-white placeholder-gray-400 focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50 focus:bg-gray-700 transition-all duration-300 shadow-inner ${
            highlightFields
              ? 'border-cyan-500 ring-4 ring-cyan-500/30 bg-gray-750/90 animate-pulse'
              : 'border-gray-600/50'
          }`}
          placeholder='例如：行銷文案寫手'
        />
      </div>

      <div className='mb-6'>
        <label htmlFor='description' className='block text-sm font-semibold text-gray-300 mb-2'>
          公開描述
          <span className='text-xs text-gray-500 ml-2'>(分享時顯示給用戶)</span>
        </label>
        <textarea
          id='description'
          value={description}
          onChange={e => setDescription(e.target.value)}
          rows={3}
          className={`w-full bg-gray-700/80 border-2 rounded-xl px-4 py-3 text-white placeholder-gray-400 focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50 focus:bg-gray-700 transition-all duration-300 shadow-inner resize-none ${
            highlightFields
              ? 'border-cyan-500 ring-4 ring-cyan-500/30 bg-gray-750/90 animate-pulse'
              : 'border-gray-600/50'
          }`}
          placeholder='簡單描述這個助理能幫助什麼...'
        />
      </div>

      <div className='mb-6'>
        <label htmlFor='systemPrompt' className='block text-sm font-semibold text-gray-300 mb-2'>
          系統提示
        </label>
        <textarea
          id='systemPrompt'
          value={systemPrompt}
          onChange={e => setSystemPrompt(e.target.value)}
          rows={8}
          className={`w-full bg-gray-700/80 border-2 rounded-xl px-4 py-3 text-white placeholder-gray-400 focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50 focus:bg-gray-700 transition-all duration-300 shadow-inner resize-none ${
            highlightFields
              ? 'border-cyan-500 ring-4 ring-cyan-500/30 bg-gray-750/90 animate-pulse'
              : 'border-gray-600/50'
          }`}
          placeholder='定義助理的角色、個性和指導。'
        />
      </div>

      {/* G9: Agentic harness 開關 */}
      <div className='mb-6'>
        <label
          htmlFor='agent-harness-enabled'
          className='flex items-start gap-3 cursor-pointer select-none'
        >
          <input
            id='agent-harness-enabled'
            type='checkbox'
            checked={agentHarnessEnabled}
            onChange={e => setAgentHarnessEnabled(e.target.checked)}
            disabled={isSaving}
            className='mt-1 h-4 w-4 rounded border-gray-500 bg-gray-700 text-cyan-500 focus:ring-2 focus:ring-cyan-500/50 focus:ring-offset-0'
            aria-describedby='agent-harness-help'
          />
          <span className='flex flex-col'>
            <span className='text-sm font-semibold text-gray-300'>
              Agentic harness (自動跨回合續跑)
            </span>
            <span id='agent-harness-help' className='mt-1 text-xs text-gray-500 leading-relaxed'>
              開啟後,模型會依 todo 進度與預覽診斷自動續跑(預設最多 5
              回合);關閉則退回單回合行為。Shared mode 不受此設定影響(續跑預算 = 1)。
            </span>
          </span>
        </label>
      </div>

      <div className='mb-6'>
        <label
          htmlFor='subagent-delegation-enabled'
          className='flex items-start gap-3 cursor-pointer select-none'
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
              className='mt-1 text-xs text-gray-500 leading-relaxed'
            >
              開啟後,主模型可把研究或受限 HTML 工作委派給 1-4 個子代理人並行處理。這會增加 token
              成本,且 shared mode 會在執行時強制停用。
            </span>
          </span>
        </label>
      </div>

      <RAGFileUpload
        ragChunks={ragChunks}
        onRagChunksChange={handleRagChunksChange}
        disabled={isSaving}
      />

      <div className='mt-auto flex justify-between items-center'>
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
                  className={`px-6 py-3 rounded-xl font-semibold flex items-center space-x-2 shadow-lg transition-all duration-300 ${
                    canShare
                      ? 'bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white hover:shadow-xl transform hover:-translate-y-0.5 cursor-pointer'
                      : 'bg-gray-600 text-gray-400 cursor-not-allowed opacity-50'
                  }`}
                  title={canShare ? '分享助理' : '需要先遷移到 Turso 才能分享'}
                >
                  <svg className='w-4 h-4' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
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
            className='px-6 py-3 rounded-xl bg-gray-600/80 hover:bg-gray-500 text-white font-semibold transition-all duration-300 hover:shadow-lg hover:transform hover:-translate-y-0.5'
          >
            取消
          </button>
          <button
            data-testid='save-button'
            onClick={handleSave}
            className='px-8 py-3 rounded-xl bg-gradient-to-r from-cyan-600 to-cyan-500 hover:from-cyan-500 hover:to-cyan-400 text-white font-bold transition-all duration-300 hover:shadow-xl hover:transform hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:transform-none'
            disabled={isSaving}
          >
            {isSaving ? (
              <span className='flex items-center gap-2'>
                <div className='w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin'></div>
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
