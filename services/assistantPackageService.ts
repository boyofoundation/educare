import {
  Inflate,
  strFromU8,
  strToU8,
  Unzip,
  type AsyncFlateStreamHandler,
  type UnzipDecoder,
  zipSync,
} from 'fflate';
import { Assistant, RagChunk, RagSourceLocation, RagSourceType } from '../types';
import { getTransferClassification, type TransferClassification } from './fileTransferPolicy';

export const ASSISTANT_PACKAGE_FORMAT = 'educare-assistant-package';
export const ASSISTANT_PACKAGE_SCHEMA_VERSION = 1;
export const ASSISTANT_PACKAGE_MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
export const ASSISTANT_PACKAGE_MAX_ENTRIES = 5_000;

const MANIFEST_PATH = 'manifest.json';
const ASSISTANT_PATH = 'assistant.json';
const RAG_CHUNKS_PATH = 'rag-chunks.json';

const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP_CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
type AssistantPackageArchiveErrorCode = 'missing-index';

export interface AssistantPackageArchiveSummary {
  entryCount: number;
  declaredUncompressedBytes: number;
}

export class AssistantPackageArchiveError extends Error {
  readonly code?: AssistantPackageArchiveErrorCode;

  constructor(message: string, code?: AssistantPackageArchiveErrorCode) {
    super(message);
    this.name = 'AssistantPackageArchiveError';
    this.code = code;
  }
}

export interface AssistantPackageManifest {
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
  mathToolsEnabled: boolean;
  webSpeechToolsEnabled: boolean;
}

interface AssistantPackageArchiveEntry {
  path: string;
  compressedSize: number;
  uncompressedSize: number;
  compressionMethod: number;
}

interface InspectedAssistantPackageArchive {
  summary: AssistantPackageArchiveSummary;
  entries: AssistantPackageArchiveEntry[];
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

export interface AssistantPackagePreview {
  classification: TransferClassification;
  format: typeof ASSISTANT_PACKAGE_FORMAT;
  schemaVersion: number;
  assistantName: string;
  materialCount: number;
  materialNames: string[];
  trust: 'untrusted';
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

const sanitizeSourceLocation = (location: unknown): RagSourceLocation | undefined => {
  if (!isRecord(location)) {
    return undefined;
  }
  const result: RagSourceLocation = {};
  if (Number.isInteger(location.page) && (location.page as number) > 0) {
    result.page = location.page as number;
  }
  if (Number.isInteger(location.paragraph) && (location.paragraph as number) > 0) {
    result.paragraph = location.paragraph as number;
  }
  if (Number.isInteger(location.startOffset) && (location.startOffset as number) >= 0) {
    result.startOffset = location.startOffset as number;
  }
  if (Number.isInteger(location.endOffset) && (location.endOffset as number) >= 0) {
    result.endOffset = location.endOffset as number;
  }
  return Object.keys(result).length > 0 ? result : undefined;
};

const sanitizeRagChunks = (ragChunks: RagChunk[] | undefined): RagChunk[] =>
  (ragChunks ?? []).map(chunk => ({
    fileName: chunk.fileName,
    content: chunk.content,
    ...(Array.isArray(chunk.vector) && chunk.vector.length > 0 ? { vector: chunk.vector } : {}),
    ...(chunk.documentId ? { documentId: chunk.documentId } : {}),
    ...(chunk.contentHash ? { contentHash: chunk.contentHash } : {}),
    ...(Number.isInteger(chunk.sourceVersion) && (chunk.sourceVersion as number) > 0
      ? { sourceVersion: chunk.sourceVersion as number }
      : {}),
    ...(sanitizeSourceLocation(chunk.sourceLocation)
      ? { sourceLocation: sanitizeSourceLocation(chunk.sourceLocation) }
      : {}),
    ...(chunk.sourceType === 'file' || chunk.sourceType === 'legacy-import'
      ? { sourceType: chunk.sourceType }
      : {}),
    ...(chunk.chunkId ? { chunkId: chunk.chunkId } : {}),
  }));

const isSafeMaterialPath = (fileName: string): boolean => {
  const normalized = fileName.trim().replace(/\\/g, '/');
  return Boolean(
    normalized &&
      normalized.length <= 512 &&
      !normalized.startsWith('/') &&
      !/^[A-Za-z]:\//.test(normalized) &&
      !normalized.split('/').some(segment => segment === '..' || segment === '.') &&
      !Array.from(normalized).some(char => char.charCodeAt(0) <= 31),
  );
};

const readZipUint16 = (bytes: Uint8Array, offset: number): number => {
  if (offset < 0 || offset + 2 > bytes.length) {
    throw new AssistantPackageArchiveError('助理設定壓縮檔的 ZIP 索引損毀。');
  }
  return bytes[offset] | (bytes[offset + 1] << 8);
};

const readZipUint32 = (bytes: Uint8Array, offset: number): number => {
  if (offset < 0 || offset + 4 > bytes.length) {
    throw new AssistantPackageArchiveError('助理設定壓縮檔的 ZIP 索引損毀。');
  }
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
};

const findZipEndOfCentralDirectory = (bytes: Uint8Array): number => {
  const minimumOffset = Math.max(0, bytes.length - (0xffff + 22));
  for (let offset = bytes.length - 22; offset >= minimumOffset; offset -= 1) {
    if (offset >= 0 && readZipUint32(bytes, offset) === ZIP_END_OF_CENTRAL_DIRECTORY) {
      return offset;
    }
  }
  throw new AssistantPackageArchiveError('助理設定壓縮檔缺少 ZIP 索引。', 'missing-index');
};

/**
 * Inspect the ZIP central directory before inflation. This keeps an attacker
 * from turning a small compressed package into an unbounded allocation.
 */
const inspectAssistantPackageArchiveDetails = (
  bytes: Uint8Array,
): InspectedAssistantPackageArchive => {
  if (bytes.byteLength > ASSISTANT_PACKAGE_MAX_UNCOMPRESSED_BYTES) {
    throw new AssistantPackageArchiveError('助理設定壓縮檔超過 50MiB 上限。');
  }

  const endOffset = findZipEndOfCentralDirectory(bytes);
  const diskNumber = readZipUint16(bytes, endOffset + 4);
  const centralDirectoryDisk = readZipUint16(bytes, endOffset + 6);
  const entriesOnDisk = readZipUint16(bytes, endOffset + 8);
  const entryCount = readZipUint16(bytes, endOffset + 10);
  const centralDirectorySize = readZipUint32(bytes, endOffset + 12);
  const centralDirectoryOffset = readZipUint32(bytes, endOffset + 16);

  if (
    diskNumber !== 0 ||
    centralDirectoryDisk !== 0 ||
    entriesOnDisk !== entryCount ||
    entryCount === 0xffff ||
    centralDirectorySize === 0xffffffff ||
    centralDirectoryOffset === 0xffffffff
  ) {
    throw new AssistantPackageArchiveError('不支援多磁碟或 ZIP64 助理設定壓縮檔。');
  }
  if (entryCount > ASSISTANT_PACKAGE_MAX_ENTRIES) {
    throw new AssistantPackageArchiveError('助理設定壓縮檔超過 5,000 個檔案上限。');
  }
  if (
    centralDirectoryOffset + centralDirectorySize > endOffset ||
    centralDirectoryOffset + centralDirectorySize > bytes.length
  ) {
    throw new AssistantPackageArchiveError('助理設定壓縮檔的 ZIP 索引範圍錯誤。');
  }

  let cursor = centralDirectoryOffset;
  let declaredUncompressedBytes = 0;
  const names = new Set<string>();
  const entries: AssistantPackageArchiveEntry[] = [];
  for (let index = 0; index < entryCount; index += 1) {
    if (readZipUint32(bytes, cursor) !== ZIP_CENTRAL_DIRECTORY_ENTRY) {
      throw new AssistantPackageArchiveError('助理設定壓縮檔的 ZIP 檔案項目損毀。');
    }
    const compressionMethod = readZipUint16(bytes, cursor + 10);
    if (compressionMethod !== 0 && compressionMethod !== 8) {
      throw new AssistantPackageArchiveError('不支援此助理設定壓縮檔的壓縮格式。');
    }
    const compressedSize = readZipUint32(bytes, cursor + 20);
    const uncompressedSize = readZipUint32(bytes, cursor + 24);
    const nameLength = readZipUint16(bytes, cursor + 28);
    const extraLength = readZipUint16(bytes, cursor + 30);
    const commentLength = readZipUint16(bytes, cursor + 32);
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      throw new AssistantPackageArchiveError('不支援 ZIP64 助理設定壓縮檔。');
    }

    const entryLength = 46 + nameLength + extraLength + commentLength;
    if (cursor + entryLength > centralDirectoryOffset + centralDirectorySize) {
      throw new AssistantPackageArchiveError('助理設定壓縮檔的 ZIP 檔案項目超出索引。');
    }
    const name = new TextDecoder().decode(bytes.slice(cursor + 46, cursor + 46 + nameLength));
    if (!name || !isSafeMaterialPath(name) || names.has(name)) {
      throw new AssistantPackageArchiveError('助理設定壓縮檔含有不安全或重複的檔案路徑。');
    }
    names.add(name);
    declaredUncompressedBytes += uncompressedSize;
    if (declaredUncompressedBytes > ASSISTANT_PACKAGE_MAX_UNCOMPRESSED_BYTES) {
      throw new AssistantPackageArchiveError('助理設定壓縮檔解壓後超過 50MiB 上限。');
    }
    entries.push({
      path: name,
      compressedSize,
      uncompressedSize,
      compressionMethod,
    });
    cursor += entryLength;
  }

  if (cursor !== centralDirectoryOffset + centralDirectorySize) {
    throw new AssistantPackageArchiveError('助理設定壓縮檔的 ZIP 索引大小不一致。');
  }

  return {
    summary: { entryCount, declaredUncompressedBytes },
    entries,
  };
};

export const inspectAssistantPackageArchive = (bytes: Uint8Array): AssistantPackageArchiveSummary =>
  inspectAssistantPackageArchiveDetails(bytes).summary;

/**
 * fflate's built-in UnzipInflate catches decoder callback errors, which would
 * let a caller's size guard observe the overflow only after the decoder keeps
 * processing the input. This adapter deliberately leaves callback errors
 * uncaught so the archive boundary can stop inflation at the first overflow.
 */
class StreamingUnzipInflate implements UnzipDecoder {
  static compression = 8;

  ondata: AsyncFlateStreamHandler = () => undefined;

  private readonly inflater: Inflate;

  constructor() {
    this.inflater = new Inflate((data, final) => {
      this.ondata(null, data, final);
    });
  }

  push(chunk: Uint8Array, final: boolean): void {
    this.inflater.push(chunk, final);
  }
}

const joinUnzippedChunks = (chunks: Uint8Array[], byteLength: number): Uint8Array => {
  if (chunks.length === 0) {
    return new Uint8Array();
  }
  if (chunks.length === 1) {
    return chunks[0];
  }

  const joined = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
};

export const unzipAssistantPackage = (bytes: Uint8Array): Record<string, Uint8Array> => {
  const { summary, entries: expectedEntries } = inspectAssistantPackageArchiveDetails(bytes);
  const expectedByPath = new Map(expectedEntries.map(entry => [entry.path, entry]));
  const entries: Record<string, Uint8Array> = {};
  const completedPaths = new Set<string>();
  let actualUncompressedBytes = 0;

  const archiveSizeMismatch = (): AssistantPackageArchiveError =>
    new AssistantPackageArchiveError('助理設定壓縮檔宣告大小與解壓內容不一致。');

  const unzip = new Unzip(file => {
    const expected = expectedByPath.get(file.name);
    if (!expected || completedPaths.has(file.name)) {
      throw new AssistantPackageArchiveError('助理設定壓縮檔含有未知或重複的檔案項目。');
    }
    if (file.compression !== expected.compressionMethod) {
      throw new AssistantPackageArchiveError('助理設定壓縮檔的 ZIP 檔案項目損毀。');
    }
    if (file.size !== undefined && file.size !== expected.compressedSize) {
      throw archiveSizeMismatch();
    }
    if (file.originalSize !== undefined && file.originalSize !== expected.uncompressedSize) {
      throw archiveSizeMismatch();
    }

    const chunks: Uint8Array[] = [];
    let entryUncompressedBytes = 0;
    file.ondata = (error, data, final) => {
      if (error) {
        throw archiveSizeMismatch();
      }
      if (!data) {
        throw archiveSizeMismatch();
      }

      const nextEntryBytes = entryUncompressedBytes + data.byteLength;
      const nextTotalBytes = actualUncompressedBytes + data.byteLength;
      if (nextEntryBytes > expected.uncompressedSize) {
        throw archiveSizeMismatch();
      }
      if (nextTotalBytes > ASSISTANT_PACKAGE_MAX_UNCOMPRESSED_BYTES) {
        throw new AssistantPackageArchiveError('助理設定壓縮檔解壓後超過 50MiB 上限。');
      }

      entryUncompressedBytes = nextEntryBytes;
      actualUncompressedBytes = nextTotalBytes;
      if (data.byteLength > 0) {
        chunks.push(data);
      }

      if (final) {
        if (entryUncompressedBytes !== expected.uncompressedSize) {
          throw archiveSizeMismatch();
        }
        entries[file.name] = joinUnzippedChunks(chunks, entryUncompressedBytes);
        completedPaths.add(file.name);
      }
    };
    file.start();
  });
  unzip.register(StreamingUnzipInflate);

  try {
    unzip.push(bytes, true);
  } catch (error) {
    if (error instanceof AssistantPackageArchiveError) {
      throw error;
    }
    throw new AssistantPackageArchiveError('無法解壓縮助理設定檔，檔案可能已損毀。');
  }

  if (
    completedPaths.size !== summary.entryCount ||
    Object.keys(entries).length !== summary.entryCount ||
    actualUncompressedBytes !== summary.declaredUncompressedBytes
  ) {
    throw archiveSizeMismatch();
  }

  return entries;
};

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
    mathToolsEnabled: assistant.mathToolsEnabled ?? false,
    webSpeechToolsEnabled: assistant.webSpeechToolsEnabled ?? false,
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
    mathToolsEnabled: raw.mathToolsEnabled === true,
    webSpeechToolsEnabled: raw.webSpeechToolsEnabled === true,
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
      typeof chunk.content !== 'string' ||
      !isSafeMaterialPath(chunk.fileName)
    ) {
      throw new Error(
        isRecord(chunk) && typeof chunk.fileName === 'string' && !isSafeMaterialPath(chunk.fileName)
          ? `知識庫片段 #${index + 1} 檔名不安全。`
          : `知識庫片段 #${index + 1} 格式錯誤。`,
      );
    }

    const vector = Array.isArray(chunk.vector)
      ? chunk.vector.filter((value): value is number => Number.isFinite(value))
      : undefined;
    const sourceLocation = sanitizeSourceLocation(chunk.sourceLocation);

    return {
      fileName: chunk.fileName,
      content: chunk.content,
      ...(vector && vector.length > 0 ? { vector } : {}),
      ...(typeof chunk.documentId === 'string' && chunk.documentId.trim()
        ? { documentId: chunk.documentId }
        : {}),
      ...(typeof chunk.contentHash === 'string' && chunk.contentHash.trim()
        ? { contentHash: chunk.contentHash }
        : {}),
      ...(Number.isInteger(chunk.sourceVersion) && (chunk.sourceVersion as number) > 0
        ? { sourceVersion: chunk.sourceVersion as number }
        : {}),
      ...(sourceLocation ? { sourceLocation } : {}),
      ...(chunk.sourceType === 'file' || chunk.sourceType === 'legacy-import'
        ? { sourceType: chunk.sourceType as RagSourceType }
        : {}),
      ...(typeof chunk.chunkId === 'string' && chunk.chunkId.trim()
        ? { chunkId: chunk.chunkId }
        : {}),
    };
  });
};

export const parseAssistantPackage = (bytes: Uint8Array): ParsedAssistantPackage => {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipAssistantPackage(bytes);
  } catch (error) {
    if (error instanceof AssistantPackageArchiveError) {
      if (error.code === 'missing-index') {
        throw new Error('無法解壓縮檔案，請確認選擇的是助理設定壓縮檔 (.zip)。');
      }
      throw error;
    }
    throw new Error('無法解壓縮檔案，請確認選擇的是助理設定壓縮檔 (.zip)。');
  }

  const manifest = parseManifest(readJsonEntry(entries, MANIFEST_PATH, true));
  const assistant = parseAssistantConfig(readJsonEntry(entries, ASSISTANT_PATH, true));
  const ragChunks = parseRagChunks(readJsonEntry(entries, RAG_CHUNKS_PATH, false));

  return { manifest, assistant, ragChunks };
};

/**
 * Return a safe, prompt-free preview for an import confirmation screen.  The
 * caller can show material names and counts without rendering author prompts.
 */
export const previewAssistantPackage = (bytes: Uint8Array): AssistantPackagePreview => {
  const parsed = parseAssistantPackage(bytes);
  return {
    classification: getTransferClassification('assistant-package'),
    format: ASSISTANT_PACKAGE_FORMAT,
    schemaVersion: parsed.manifest.schemaVersion,
    assistantName: parsed.assistant.name,
    materialCount: parsed.ragChunks.length,
    materialNames: parsed.ragChunks.map(chunk => chunk.fileName),
    trust: 'untrusted',
  };
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
    mathToolsEnabled: parsed.assistant.mathToolsEnabled,
    webSpeechToolsEnabled: parsed.assistant.webSpeechToolsEnabled,
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
