import type { Assistant } from '../../types';
import { ASSISTANT_PACKAGE_SCHEMA_VERSION } from '../../services/assistantPackageService';
import Modal from '../ui/Modal';

interface Props {
  assistant: Assistant;
  onDecision: (accepted: boolean) => void;
}

/** Only text is rendered here; preview never saves data or runs author prompts. */
export function AssistantPackageImportDialog({ assistant, onDecision }: Props) {
  const chunks = assistant.ragChunks ?? [];
  const materials = [...new Set(chunks.map(chunk => chunk.fileName))];
  return (
    <Modal isOpen title='確認助理包內容' onClose={() => onDecision(false)}>
      <p role='note' className='mb-4 rounded-lg border border-amber-500/40 p-3 text-amber-100'>
        來源尚未驗證。下列名稱、指令和教材由檔案作者提供，不代表平台認可；確認後才會儲存。
      </p>
      <dl className='mb-4 space-y-2 text-gray-200'>
        <div>
          <dt className='font-semibold'>助理</dt>
          <dd>{assistant.name}</dd>
        </div>
        <div>
          <dt className='font-semibold'>檔案版本</dt>
          <dd>{ASSISTANT_PACKAGE_SCHEMA_VERSION}</dd>
        </div>
        <div>
          <dt className='font-semibold'>包含資料</dt>
          <dd>
            {materials.length} 份教材、{chunks.length} 個片段；不匯入聊天紀錄或服務商憑證。
          </dd>
        </div>
      </dl>
      <details className='mb-4 text-gray-200'>
        <summary className='min-h-11 cursor-pointer font-semibold'>作者提供的助理指令</summary>
        <pre className='max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-gray-900 p-3 text-sm'>
          {assistant.systemPrompt}
        </pre>
      </details>
      <details className='mb-4 text-gray-200'>
        <summary className='min-h-11 cursor-pointer font-semibold'>教材檔名</summary>
        {materials.length ? (
          <ul className='max-h-48 list-inside list-disc overflow-auto break-words'>
            {materials.map(name => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        ) : (
          <p>此助理包沒有教材。</p>
        )}
      </details>
      <p className='mb-4 text-sm text-gray-300'>
        檔案內自行填寫的私人內容仍可能包含在教材或指令中，請先檢查再分享。
      </p>
      <div className='flex flex-wrap gap-3'>
        <button
          type='button'
          onClick={() => onDecision(false)}
          className='min-h-11 rounded-lg border border-gray-500 px-4 py-2 text-gray-200'
        >
          取消匯入
        </button>
        <button
          type='button'
          onClick={() => onDecision(true)}
          className='min-h-11 rounded-lg bg-cyan-700 px-4 py-2 font-semibold text-white'
        >
          確認並匯入助理
        </button>
      </div>
    </Modal>
  );
}
