import {
  DocumentParserService,
  type ParsedDocument as LegacyParsedDocument,
} from './documentParserService';
import { chunkText, DEFAULT_CHUNKING_OPTIONS, type ChunkingOptions } from './textChunkingService';
import type { RagChunk, RagSourceLocation } from '../types';
import { buildMaterialChunks, createMaterialDocument } from './materialDocumentService';

export type FileParserKind = 'pdf' | 'docx' | 'markdown' | 'text' | 'unknown';

export interface ParsedSourceSegment {
  content: string;
  sourceLocation?: RagSourceLocation;
}

export interface ParsedFile {
  fileName: string;
  mimeType: string;
  byteLength: number;
  parser: FileParserKind;
  content: string;
  segments: ParsedSourceSegment[];
  pages?: number;
  title?: string;
  author?: string;
}

export interface ParseFileOptions {
  signal?: AbortSignal;
  /** Test/benchmark seam; production callers use DocumentParserService. */
  parseDocument?: (file: File) => Promise<LegacyParsedDocument>;
  onProgress?: (progress: {
    stage: 'parsing' | 'chunking';
    completed: number;
    total?: number;
  }) => void;
  chunking?: ChunkingOptions;
  yieldEvery?: number;
}

export interface ParsedFileChunks {
  parsed: ParsedFile;
  chunks: RagChunk[];
}

export interface FileParseBatchResult {
  file: File;
  status: 'ready' | 'failed' | 'cancelled';
  parsed?: ParsedFile;
  chunks?: RagChunk[];
  error?: Error;
}

export class FileParserError extends Error {
  readonly code: 'unsupported' | 'parse-failed' | 'cancelled';
  readonly fileName: string;

  constructor(
    code: 'unsupported' | 'parse-failed' | 'cancelled',
    fileName: string,
    message: string,
  ) {
    super(message);
    this.name = 'FileParserError';
    this.code = code;
    this.fileName = fileName;
  }
}

const isAbortError = (error: unknown): boolean => {
  const DomException = globalThis.DOMException;
  return typeof DomException !== 'undefined' && error instanceof DomException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError';
};

export const createFileAbortError = (fileName: string): FileParserError =>
  new FileParserError('cancelled', fileName, `已取消解析：${fileName}`);

const throwIfAborted = (fileName: string, signal?: AbortSignal): void => {
  if (signal?.aborted) {
    throw createFileAbortError(fileName);
  }
};

const awaitWithAbort = async <T>(
  fileName: string,
  operation: Promise<T>,
  signal?: AbortSignal,
): Promise<T> => {
  throwIfAborted(fileName, signal);
  if (!signal) {
    return operation;
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    const onAbort = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(createFileAbortError(fileName));
    };

    signal.addEventListener('abort', onAbort, { once: true });
    operation.then(
      value => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve(value);
      },
      error => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(error);
      },
    );
  });
};

const yieldToMainThread = async (): Promise<void> => {
  await new Promise<void>(resolve => {
    if (typeof globalThis.setTimeout === 'function') {
      globalThis.setTimeout(resolve, 0);
    } else {
      resolve();
    }
  });
};

const detectParser = (file: File): FileParserKind => {
  const fileName = file.name.toLowerCase();
  const fileType = file.type.toLowerCase();
  if (fileName.endsWith('.pdf') || fileType === 'application/pdf') {
    return 'pdf';
  }
  if (
    fileName.endsWith('.docx') ||
    fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return 'docx';
  }
  if (fileName.endsWith('.md') || fileName.endsWith('.markdown')) {
    return 'markdown';
  }
  if (fileName.endsWith('.txt') || fileType === 'text/plain') {
    return 'text';
  }
  return 'unknown';
};

const trimWithOffsets = (
  content: string,
  startOffset: number,
  endOffset: number,
): { content: string; startOffset: number; endOffset: number } | null => {
  const raw = content.slice(startOffset, endOffset);
  const leading = raw.search(/\S/);
  if (leading < 0) {
    return null;
  }
  const trimmed = raw.trimEnd();
  return {
    content: trimmed.slice(leading),
    startOffset: startOffset + leading,
    endOffset: startOffset + trimmed.length,
  };
};

const splitParagraphs = (content: string): ParsedSourceSegment[] => {
  const segments: ParsedSourceSegment[] = [];
  const blocks = content.split(/\r?\n\s*\r?\n/);
  let cursor = 0;

  blocks.forEach((block, index) => {
    const blockStart = content.indexOf(block, cursor);
    const start = blockStart < 0 ? cursor : blockStart;
    const end = start + block.length;
    cursor = end;
    const trimmed = trimWithOffsets(content, start, end);
    if (!trimmed) {
      return;
    }
    segments.push({
      content: trimmed.content,
      sourceLocation: {
        paragraph: index + 1,
        startOffset: trimmed.startOffset,
        endOffset: trimmed.endOffset,
      },
    });
  });

  return segments;
};

const splitPdfPages = (content: string): ParsedSourceSegment[] => {
  const markerPattern = /\[第\s*(\d+)\s*頁(?:\s*-[^\]]+)?\]/gu;
  const markers = [...content.matchAll(markerPattern)];
  if (markers.length === 0) {
    return [];
  }

  return markers.flatMap((marker, index) => {
    const markerStart = marker.index ?? 0;
    const contentStart = markerStart + marker[0].length;
    const nextMarkerStart = markers[index + 1]?.index ?? content.length;
    const trimmed = trimWithOffsets(content, contentStart, nextMarkerStart);
    if (!trimmed) {
      return [];
    }
    const page = Number(marker[1]);
    return [
      {
        content: trimmed.content,
        sourceLocation: {
          ...(Number.isInteger(page) && page > 0 ? { page } : {}),
          startOffset: trimmed.startOffset,
          endOffset: trimmed.endOffset,
        },
      },
    ];
  });
};

const buildSegments = (
  fileName: string,
  parser: FileParserKind,
  content: string,
): ParsedSourceSegment[] => {
  const segments = parser === 'pdf' ? splitPdfPages(content) : splitParagraphs(content);
  if (segments.length > 0) {
    return segments;
  }
  // No page/paragraph marker can be proved for this parser. Keep the content
  // searchable, but deliberately omit a fabricated source location.
  return content.trim() ? [{ content: content.trim() }] : [];
};

const toFileParserError = (file: File, error: unknown): FileParserError => {
  if (error instanceof FileParserError) {
    return error;
  }
  if (isAbortError(error)) {
    return createFileAbortError(file.name);
  }
  const message = error instanceof Error ? error.message : '未知解析錯誤';
  return new FileParserError('parse-failed', file.name, `${file.name} 解析失敗：${message}`);
};

export const parseFile = async (
  file: File,
  options: ParseFileOptions = {},
): Promise<ParsedFile> => {
  if (!DocumentParserService.isSupportedFile(file)) {
    throw new FileParserError('unsupported', file.name, `不支援的文件：${file.name}`);
  }

  const parser = detectParser(file);
  try {
    throwIfAborted(file.name, options.signal);
    options.onProgress?.({ stage: 'parsing', completed: 0, total: 1 });
    const legacyParsed = (await awaitWithAbort(
      file.name,
      (options.parseDocument ?? (sourceFile => DocumentParserService.parseDocument(sourceFile)))(
        file,
      ),
      options.signal,
    )) as LegacyParsedDocument;
    throwIfAborted(file.name, options.signal);
    const parsed: ParsedFile = {
      fileName: file.name,
      mimeType: file.type,
      byteLength: file.size,
      parser,
      content: legacyParsed.content,
      segments: buildSegments(file.name, parser, legacyParsed.content),
      ...(legacyParsed.metadata?.pages ? { pages: legacyParsed.metadata.pages } : {}),
      ...(legacyParsed.metadata?.title ? { title: legacyParsed.metadata.title } : {}),
      ...(legacyParsed.metadata?.author ? { author: legacyParsed.metadata.author } : {}),
    };
    options.onProgress?.({ stage: 'parsing', completed: 1, total: 1 });
    return parsed;
  } catch (error) {
    throw toFileParserError(file, error);
  }
};

export const chunkParsedFile = async (
  parsed: ParsedFile,
  options: ParseFileOptions = {},
): Promise<RagChunk[]> => {
  const signal = options.signal;
  const sourceDocument = createMaterialDocument({
    fileName: parsed.fileName,
    content: parsed.content,
    mimeType: parsed.mimeType,
    byteLength: parsed.byteLength,
  });
  const allChunks: RagChunk[] = [];
  const yieldEvery = Math.max(1, options.yieldEvery ?? 8);
  const segments = parsed.segments.length > 0 ? parsed.segments : [{ content: parsed.content }];

  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
    throwIfAborted(parsed.fileName, signal);
    const segment = segments[segmentIndex];
    const textChunks = chunkText(
      segment.content,
      options.chunking ?? DEFAULT_CHUNKING_OPTIONS,
    ).chunks;
    const materialChunks = buildMaterialChunks(
      sourceDocument,
      textChunks.map(content => ({
        content,
        ...(segment.sourceLocation ? { sourceLocation: segment.sourceLocation } : {}),
      })),
    );

    for (const chunk of materialChunks) {
      throwIfAborted(parsed.fileName, signal);
      allChunks.push({
        ...chunk,
        // Chunk ids are document-local. Offset the index when a document has
        // multiple parser segments so duplicate page/chunk pairs stay unique.
        chunkId: chunk.chunkId?.replace(/chunk-(\d+)-/, `chunk-${allChunks.length}-`),
      });
      options.onProgress?.({
        stage: 'chunking',
        completed: allChunks.length,
        total: undefined,
      });
      if (allChunks.length % yieldEvery === 0) {
        await yieldToMainThread();
      }
    }
  }

  throwIfAborted(parsed.fileName, signal);
  return allChunks;
};

export const parseFileToChunks = async (
  file: File,
  options: ParseFileOptions = {},
): Promise<ParsedFileChunks> => {
  const parsed = await parseFile(file, options);
  return { parsed, chunks: await chunkParsedFile(parsed, options) };
};

export const parseFiles = async (
  files: File[],
  options: ParseFileOptions = {},
): Promise<FileParseBatchResult[]> => {
  const results: FileParseBatchResult[] = [];
  for (const file of files) {
    try {
      const result = await parseFileToChunks(file, options);
      results.push({ file, status: 'ready', parsed: result.parsed, chunks: result.chunks });
    } catch (error) {
      const normalized = toFileParserError(file, error);
      results.push({
        file,
        status: normalized.code === 'cancelled' ? 'cancelled' : 'failed',
        error: normalized,
      });
    }
    await yieldToMainThread();
  }
  return results;
};

export const isFileParserCancellation = (error: unknown): boolean =>
  error instanceof FileParserError && error.code === 'cancelled';

export const isSupportedMaterialFile = (file: File): boolean =>
  DocumentParserService.isSupportedFile(file);

export const getMaterialFileTypeName = (file: File): string =>
  DocumentParserService.getFileTypeName(file);
