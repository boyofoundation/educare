import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { Assistant, RagChunk } from '../types';

export const ASSISTANT_PACKAGE_FORMAT = 'educare-assistant-package';
export const ASSISTANT_PACKAGE_SCHEMA_VERSION = 1;

const MANIFEST_PATH = 'manifest.json';
const ASSISTANT_PATH = 'assistant.json';
const RAG_CHUNKS_PATH = 'rag-chunks.json';

interface AssistantPackageManifest {
  format: string;
  schemaVersion: number;
  exportedAt: number;
  assistantName: string;
}

interface AssistantPackageConfig {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  starterPrompts: string[];
  subagentDelegationEnabled: boolean;
}

export interface ParsedAssistantPackage {
  manifest: AssistantPackageManifest;
  assistant: AssistantPackageConfig;
  ragChunks: RagChunk[];
}

export interface AssistantPackageExportResult {
  fileName: string;
  chunkCount: number;
}

const sanitizeFileName = (name: string): string => {
  const cleaned = Array.from(name.trim())
    .map(char => {
      const code = char.charCodeAt(0);
      const isControl = code >= 0 && code <= 31;
      return /[<>:"/\\|?*]/.test(char) || isControl ? '-' : char;
    })
    .join('')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return cleaned || 'assistant';
};

const sanitizeRagChunks = (ragChunks: RagChunk[] | undefined): RagChunk[] =>
  (ragChunks ?? []).map(chunk => ({
    fileName: chunk.fileName,
    content: chunk.content,
    ...(Array.isArray(chunk.vector) && chunk.vector.length > 0 ? { vector: chunk.vector } : {}),
  }));

export const buildAssistantPackageZip = (assistant: Assistant): Uint8Array => {
  const manifest: AssistantPackageManifest = {
    format: ASSISTANT_PACKAGE_FORMAT,
    schemaVersion: ASSISTANT_PACKAGE_SCHEMA_VERSION,
    exportedAt: Date.now(),
    assistantName: assistant.name,
  };

  const config: AssistantPackageConfig = {
    id: assistant.id,
    name: assistant.name,
    description: assistant.description ?? '',
    systemPrompt: assistant.systemPrompt ?? '',
    starterPrompts: assistant.starterPrompts ?? [],
    subagentDelegationEnabled: assistant.subagentDelegationEnabled ?? false,
  };

  return zipSync(
    {
      [MANIFEST_PATH]: strToU8(JSON.stringify(manifest, null, 2)),
      [ASSISTANT_PATH]: strToU8(JSON.stringify(config, null, 2)),
      [RAG_CHUNKS_PATH]: strToU8(JSON.stringify(sanitizeRagChunks(assistant.ragChunks))),
    },
    { level: 6 },
  );
};

const readJsonEntry = (
  entries: Record<string, Uint8Array>,
  path: string,
  required: boolean,
): unknown => {
  const bytes = entries[path];
  if (!bytes) {
    if (required) {
      throw new Error(`壓縮檔缺少 ${path}，不是有效的助理設定檔。`);
    }
    return undefined;
  }

  try {
    return JSON.parse(strFromU8(bytes));
  } catch {
    throw new Error(`無法解析 ${path}，檔案內容已損毀。`);
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseManifest = (raw: unknown): AssistantPackageManifest => {
  if (!isRecord(raw) || raw.format !== ASSISTANT_PACKAGE_FORMAT) {
    throw new Error('這不是 EduCare 助理設定壓縮檔。');
  }

  const schemaVersion = raw.schemaVersion;
  if (typeof schemaVersion !== 'number' || schemaVersion > ASSISTANT_PACKAGE_SCHEMA_VERSION) {
    throw new Error('此助理設定檔版本較新，請先更新 EduCare 後再匯入。');
  }

  return {
    format: ASSISTANT_PACKAGE_FORMAT,
    schemaVersion,
    exportedAt: typeof raw.exportedAt === 'number' ? raw.exportedAt : 0,
    assistantName: typeof raw.assistantName === 'string' ? raw.assistantName : '',
  };
};

const parseAssistantConfig = (raw: unknown): AssistantPackageConfig => {
  if (!isRecord(raw)) {
    throw new Error('assistant.json 格式錯誤。');
  }

  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name) {
    throw new Error('助理設定檔缺少名稱。');
  }

  return {
    id: typeof raw.id === 'string' ? raw.id : '',
    name,
    description: typeof raw.description === 'string' ? raw.description : '',
    systemPrompt: typeof raw.systemPrompt === 'string' ? raw.systemPrompt : '',
    starterPrompts: Array.isArray(raw.starterPrompts)
      ? raw.starterPrompts.filter((prompt): prompt is string => typeof prompt === 'string')
      : [],
    subagentDelegationEnabled: raw.subagentDelegationEnabled === true,
  };
};

const parseRagChunks = (raw: unknown): RagChunk[] => {
  if (raw === undefined) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new Error('rag-chunks.json 格式錯誤。');
  }

  return raw.map((chunk, index) => {
    if (
      !isRecord(chunk) ||
      typeof chunk.fileName !== 'string' ||
      typeof chunk.content !== 'string'
    ) {
      throw new Error(`知識庫片段 #${index + 1} 格式錯誤。`);
    }

    const vector = Array.isArray(chunk.vector)
      ? chunk.vector.filter((value): value is number => Number.isFinite(value))
      : undefined;

    return {
      fileName: chunk.fileName,
      content: chunk.content,
      ...(vector && vector.length > 0 ? { vector } : {}),
    };
  });
};

export const parseAssistantPackage = (bytes: Uint8Array): ParsedAssistantPackage => {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new Error('無法解壓縮檔案，請確認選擇的是助理設定壓縮檔 (.zip)。');
  }

  const manifest = parseManifest(readJsonEntry(entries, MANIFEST_PATH, true));
  const assistant = parseAssistantConfig(readJsonEntry(entries, ASSISTANT_PATH, true));
  const ragChunks = parseRagChunks(readJsonEntry(entries, RAG_CHUNKS_PATH, false));

  return { manifest, assistant, ragChunks };
};

export const buildImportedAssistant = (
  parsed: ParsedAssistantPackage,
  existingIds: Iterable<string>,
): Assistant => {
  const idSet = new Set(existingIds);
  const keepOriginalId = parsed.assistant.id.trim().length > 0 && !idSet.has(parsed.assistant.id);

  return {
    id: keepOriginalId ? parsed.assistant.id : crypto.randomUUID(),
    name: parsed.assistant.name,
    description: parsed.assistant.description,
    systemPrompt: parsed.assistant.systemPrompt,
    starterPrompts: parsed.assistant.starterPrompts,
    subagentDelegationEnabled: parsed.assistant.subagentDelegationEnabled,
    ragChunks: parsed.ragChunks,
    createdAt: Date.now(),
    isShared: false,
  };
};

export const importAssistantPackageFile = async (
  file: File,
  existingIds: Iterable<string>,
): Promise<Assistant> => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return buildImportedAssistant(parseAssistantPackage(bytes), existingIds);
};

export const downloadAssistantPackage = (assistant: Assistant): AssistantPackageExportResult => {
  const zipData = buildAssistantPackageZip(assistant);
  const fileName = `${sanitizeFileName(assistant.name)}.educare-assistant.zip`;
  const blob = new globalThis.Blob([zipData], { type: 'application/zip' });
  const objectUrl = URL.createObjectURL(blob);

  try {
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = fileName;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }

  return { fileName, chunkCount: assistant.ragChunks?.length ?? 0 };
};
