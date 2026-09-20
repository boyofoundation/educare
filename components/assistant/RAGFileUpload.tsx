import React, { useCallback, useMemo, useRef, useState } from 'react';
import type { RagChunk } from '../../types';
import {
  getMaterialFileTypeName,
  isFileParserCancellation,
  isSupportedMaterialFile,
  parseFileToChunks,
} from '../../services/fileParserService';
import {
  mergeMaterialChunks,
  removeMaterialDocument,
} from '../../services/materialDocumentService';
import { RAGFileUploadProps } from './types';

const getFileKey = (file: File, index: number): string =>
  `${file.name}:${file.size}:${file.lastModified}:${index}`;

type ParseState =
  | { type: 'idle' }
  | { type: 'parsed'; count: number }
  | { type: 'error'; message: string; files: File[] };

const PERSISTENCE_COPY: Record<
  NonNullable<RAGFileUploadProps['persistenceState']>,
  { label: string; tone: string }
> = {
  idle: {
    label: '已解析，尚未儲存到本機。按「保存助理」才會寫入裝置。',
    tone: 'border-amber-700/70 bg-amber-950/30 text-amber-200',
  },
  saving: {
    label: '正在儲存到這台裝置…',
    tone: 'border-cyan-700/70 bg-cyan-950/30 text-cyan-200',
  },
  saved: {
    label: '已存於這台裝置。若要跨裝置使用，請另外匯出或使用選用的雲端功能。',
    tone: 'border-emerald-700/70 bg-emerald-950/30 text-emerald-200',
  },
  error: {
    label: '儲存失敗；內容仍保留在表單中，請重試。',
    tone: 'border-rose-700/70 bg-rose-950/30 text-rose-200',
  },
};

export const RAGFileUpload: React.FC<RAGFileUploadProps> = ({
  ragChunks,
  onRagChunksChange,
  disabled = false,
  persistenceState = 'idle',
}) => {
  const [processingStatus, setProcessingStatus] = useState<string | null>(null);
  const [parseState, setParseState] = useState<ParseState>({ type: 'idle' });
  const [lastFiles, setLastFiles] = useState<File[]>([]);
  const [activeFileKey, setActiveFileKey] = useState<string | null>(null);
  const abortControllersRef = useRef(new Map<string, AbortController>());

  const processFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) {
        return;
      }

      setParseState({ type: 'idle' });
      setProcessingStatus('開始處理檔案…');
      const successfulChunks: RagChunk[] = [];
      const failedFiles: File[] = [];
      const failureMessages: string[] = [];
      let hasParseFailure = false;

      for (const [fileIndex, file] of files.entries()) {
        const fileKey = getFileKey(file, fileIndex);
        if (!isSupportedMaterialFile(file)) {
          console.warn(`不支援的文件格式: ${file.name}`);
          failedFiles.push(file);
          failureMessages.push(`不支援的文件：${file.name}`);
          continue;
        }

        const controller = new AbortController();
        abortControllersRef.current.set(fileKey, controller);
        setActiveFileKey(fileKey);
        try {
          const fileTypeName = getMaterialFileTypeName(file);
          setProcessingStatus(`解析 ${fileTypeName}: ${file.name}…`);
          const parsed = await parseFileToChunks(file, {
            signal: controller.signal,
            onProgress: progress => {
              if (progress.stage === 'chunking') {
                setProcessingStatus(`處理 ${file.name} 的 ${progress.completed} 個區塊…`);
              }
            },
          });
          successfulChunks.push(...parsed.chunks);
        } catch (error) {
          console.error(`Error processing file ${file.name}:`, error);
          hasParseFailure = true;
          const errorMessage = error instanceof Error ? error.message : '未知錯誤';
          failedFiles.push(file);
          failureMessages.push(
            isFileParserCancellation(error)
              ? `${file.name} 已取消解析`
              : `${file.name} 處理失敗: ${errorMessage}`,
          );
        } finally {
          abortControllersRef.current.delete(fileKey);
          setActiveFileKey(current => (current === fileKey ? null : current));
        }
      }

      if (successfulChunks.length > 0) {
        onRagChunksChange(mergeMaterialChunks(ragChunks, successfulChunks));
        if (failedFiles.length > 0) {
          setLastFiles(failedFiles);
          setParseState({
            type: 'error',
            message: `部分檔案已解析，但以下檔案失敗：${failureMessages.join('；')}`,
            files: failedFiles,
          });
        } else {
          setLastFiles([]);
          setParseState({ type: 'parsed', count: successfulChunks.length });
        }
      } else if (failedFiles.length > 0) {
        // Preserve the current draft when parsing fails. The caller can retry.
        setLastFiles(failedFiles);
        if (!hasParseFailure) {
          // Keep the legacy callback contract for an unsupported-only selection
          // while leaving parse failures untouched for an explicit retry.
          onRagChunksChange(ragChunks);
        }
        setParseState({
          type: 'error',
          message: failureMessages.join('；'),
          files: failedFiles,
        });
      } else {
        setLastFiles([]);
        onRagChunksChange(ragChunks);
        setParseState({ type: 'idle' });
      }

      setProcessingStatus(null);
    },
    [onRagChunksChange, ragChunks],
  );

  const cancelFile = useCallback((fileKey: string) => {
    abortControllersRef.current.get(fileKey)?.abort();
  }, []);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    // Allow selecting the same file after a parse or persistence failure.
    event.target.value = '';
    await processFiles(files);
  };

  const removeDocument = (documentId: string, fileName: string) => {
    const hasDocumentId = ragChunks.some(chunk => chunk.documentId === documentId);
    onRagChunksChange(
      hasDocumentId
        ? removeMaterialDocument(ragChunks, documentId)
        : removeMaterialDocument(ragChunks, documentId, fileName),
    );
  };

  const materialDocuments = useMemo(
    () =>
      ragChunks.reduce<Array<{ id: string; fileName: string }>>((documents, chunk, index) => {
        const id = chunk.documentId ?? `legacy:${chunk.fileName}`;
        if (!documents.some(document => document.id === id)) {
          documents.push({ id, fileName: chunk.fileName || `素材 ${index + 1}` });
        }
        return documents;
      }, []),
    [ragChunks],
  );
  const persistenceCopy = PERSISTENCE_COPY[persistenceState];
  const parseError = parseState.type === 'error';

  return (
    <section className='mb-8' aria-labelledby='rag-upload-heading'>
      <h3 id='rag-upload-heading' className='mb-2 block text-sm font-semibold text-gray-300'>
        知識檔案 (RAG)
      </h3>
      <p className='mb-4 text-sm leading-relaxed text-gray-400'>
        上傳文件以建立可搜尋的知識庫。支援格式：
        <span className='font-medium text-cyan-400'>.txt, .md, .pdf, .docx</span>
        <br />
        檔案只會留在目前助理草稿；按下保存後才會寫入這台裝置，選用的雲端同步另行處理。
      </p>
      <div className='rounded-xl border-2 border-dashed border-gray-600/70 bg-gray-700/50 p-6 text-center transition-all duration-300 hover:border-cyan-500/50'>
        <label className='sr-only' htmlFor='rag-file-input'>
          選擇知識檔案
        </label>
        <input
          id='rag-file-input'
          type='file'
          multiple
          accept='.txt,.md,.markdown,.pdf,.docx'
          onChange={handleFileChange}
          className='block w-full cursor-pointer text-sm text-gray-300 file:mr-4 file:rounded-xl file:border-0 file:bg-gradient-to-r file:from-cyan-600 file:to-cyan-500 file:px-6 file:py-3 file:text-sm file:font-semibold file:text-white file:shadow-lg file:transition-all file:duration-300 hover:file:from-cyan-500 hover:file:to-cyan-400 hover:file:shadow-xl'
          disabled={disabled || !!processingStatus}
        />

        <div className='mt-4 flex flex-wrap justify-center gap-2' aria-label='支援格式'>
          <span className='rounded-full border border-blue-500/30 bg-blue-600/20 px-3 py-1 text-xs text-blue-300'>
            📄 TXT
          </span>
          <span className='rounded-full border border-green-500/30 bg-green-600/20 px-3 py-1 text-xs text-green-300'>
            📝 MD
          </span>
          <span className='rounded-full border border-red-500/30 bg-red-600/20 px-3 py-1 text-xs text-red-300'>
            📕 PDF
          </span>
          <span className='rounded-full border border-purple-500/30 bg-purple-600/20 px-3 py-1 text-xs text-purple-300'>
            📘 DOCX
          </span>
        </div>

        {processingStatus && (
          <p
            className='mt-4 flex items-center justify-center gap-2 text-sm text-cyan-400'
            role='status'
          >
            <span className='h-2 w-2 animate-bounce rounded-full bg-cyan-400' aria-hidden='true' />
            {processingStatus}
            {activeFileKey && (
              <button
                className='rounded border border-cyan-300/60 px-2 py-1 text-xs text-cyan-100 hover:bg-cyan-900/40 disabled:opacity-50'
                type='button'
                onClick={() => cancelFile(activeFileKey)}
                disabled={disabled}
              >
                取消處理
              </button>
            )}
          </p>
        )}
      </div>

      {(ragChunks.length > 0 || parseState.type !== 'idle') && !processingStatus && (
        <div
          className={`mt-4 rounded-md border p-3 text-sm ${
            parseError ? 'border-rose-700/70 bg-rose-950/30 text-rose-200' : persistenceCopy.tone
          }`}
          role={parseError || persistenceState === 'error' ? 'alert' : 'status'}
          data-testid='rag-persistence-status'
        >
          <p>{parseError ? parseState.message : persistenceCopy.label}</p>
          {parseError && lastFiles.length > 0 && (
            <button
              className='mt-2 rounded-md border border-rose-400/60 px-3 py-1.5 text-xs font-semibold text-rose-100 transition hover:bg-rose-900/50 disabled:opacity-50'
              disabled={disabled}
              onClick={() => void processFiles(lastFiles)}
              type='button'
            >
              重試解析
            </button>
          )}
        </div>
      )}

      <div className='mt-4 space-y-2'>
        {materialDocuments.map(document => (
          <div
            key={document.id}
            className='flex items-center justify-between rounded-md bg-gray-700 p-2 text-sm'
          >
            <span className='truncate text-gray-300'>{document.fileName}</span>
            <button
              aria-label={`移除 ${document.fileName}`}
              onClick={() => removeDocument(document.id, document.fileName)}
              className='ml-4 rounded px-2 py-1 text-red-300 hover:bg-red-900/30 hover:text-red-200'
              disabled={disabled || persistenceState === 'saving'}
              type='button'
            >
              移除
            </button>
          </div>
        ))}
      </div>
    </section>
  );
};
