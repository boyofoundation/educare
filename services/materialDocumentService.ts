import type { RagChunk, RagSourceLocation, RagSourceType } from '../types';

/** Current version of the persisted material provenance shape. */
export const MATERIAL_PROVENANCE_VERSION = 1;

export interface MaterialDocumentInput {
  fileName: string;
  content: string;
  mimeType?: string;
  byteLength?: number;
  documentId?: string;
  sourceVersion?: number;
  sourceType?: RagSourceType;
}

export interface MaterialDocument {
  documentId: string;
  fileName: string;
  content: string;
  contentHash: string;
  sourceVersion: number;
  sourceType: RagSourceType;
  mimeType?: string;
  byteLength: number;
}

export interface MaterialChunkInput {
  content: string;
  sourceLocation?: RagSourceLocation;
}

export interface MaterialUploadResolution {
  status: 'created' | 'revision' | 'duplicate';
  document: MaterialDocument;
  chunks: RagChunk[];
}

const HASH_SEEDS = [0x811c9dc5, 0x9e3779b1, 0x85ebca6b, 0xc2b2ae35] as const;
const HASH_PRIMES = [0x01000193, 0x27d4eb2d, 0x165667b1, 0x9e3779b1] as const;

const textBytes = (value: string): Uint8Array => {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value);
  }

  // The browser and supported test runtimes expose TextEncoder. This fallback
  // only keeps the identity function usable in a very small older-runtime
  // surface; it intentionally hashes UTF-16 code units deterministically.
  return Uint8Array.from(Array.from(value, character => character.charCodeAt(0) & 0xff));
};

/**
 * Deterministic content hash used for local identity. It is intentionally
 * synchronous so indexing can be rebuilt without a crypto worker. The value
 * is an opaque identity token; it is not presented as a cryptographic proof.
 */
export const computeMaterialContentHash = (content: string): string => {
  const bytes = textBytes(content);
  const words = HASH_SEEDS.map((seed, seedIndex) => {
    let hash = seed;
    const prime = HASH_PRIMES[seedIndex];
    for (const byte of bytes) {
      hash ^= byte;
      hash = Math.imul(hash, prime) >>> 0;
      hash ^= hash >>> 13;
    }
    return hash.toString(16).padStart(8, '0');
  });

  return words.join('');
};

const normalizeFileName = (fileName: string): string => fileName.trim().replace(/\\/g, '/');

const stableIdentitySeed = (fileName: string, contentHash: string, sourceKey?: string): string =>
  `${sourceKey?.trim() || normalizeFileName(fileName)}\u0000${contentHash}`;

/**
 * Build an id for a document when no persisted id is available. Same-name
 * documents with different content therefore remain distinct, while an exact
 * re-upload can be recognized as the same document.
 */
export const buildMaterialDocumentId = (
  fileName: string,
  contentHash: string,
  sourceKey?: string,
): string =>
  `material-${computeMaterialContentHash(stableIdentitySeed(fileName, contentHash, sourceKey)).slice(0, 32)}`;

export const buildMaterialChunkId = (
  documentId: string,
  sourceVersion: number,
  chunkIndex: number,
  content: string,
): string =>
  `${documentId}:v${sourceVersion}:chunk-${chunkIndex}-${computeMaterialContentHash(content).slice(0, 16)}`;

const copyLocation = (location: RagSourceLocation | undefined): RagSourceLocation | undefined => {
  if (!location) {
    return undefined;
  }

  const result: RagSourceLocation = {};
  if (location.page !== undefined) {
    result.page = location.page;
  }
  if (location.paragraph !== undefined) {
    result.paragraph = location.paragraph;
  }
  if (location.startOffset !== undefined) {
    result.startOffset = location.startOffset;
  }
  if (location.endOffset !== undefined) {
    result.endOffset = location.endOffset;
  }
  return Object.keys(result).length > 0 ? result : undefined;
};

export const createMaterialDocument = (input: MaterialDocumentInput): MaterialDocument => {
  const fileName = normalizeFileName(input.fileName);
  const content = input.content;
  const contentHash = computeMaterialContentHash(content);
  const sourceVersion =
    Number.isInteger(input.sourceVersion) && input.sourceVersion! > 0 ? input.sourceVersion! : 1;

  return {
    documentId: input.documentId?.trim() || buildMaterialDocumentId(fileName, contentHash),
    fileName,
    content,
    contentHash,
    sourceVersion,
    sourceType: input.sourceType ?? 'file',
    ...(input.mimeType ? { mimeType: input.mimeType } : {}),
    byteLength: input.byteLength ?? textBytes(content).byteLength,
  };
};

export const buildMaterialChunks = (
  document: MaterialDocument,
  chunks: MaterialChunkInput[],
): RagChunk[] =>
  chunks
    .filter(chunk => chunk.content.trim().length > 0)
    .map((chunk, index) => ({
      fileName: document.fileName,
      content: chunk.content,
      documentId: document.documentId,
      contentHash: document.contentHash,
      sourceVersion: document.sourceVersion,
      sourceType: document.sourceType,
      chunkId: buildMaterialChunkId(
        document.documentId,
        document.sourceVersion,
        index,
        chunk.content,
      ),
      ...(copyLocation(chunk.sourceLocation)
        ? { sourceLocation: copyLocation(chunk.sourceLocation) }
        : {}),
    }));

const chunksForDocument = (chunks: RagChunk[], documentId: string): RagChunk[] =>
  chunks.filter(chunk => chunk.documentId === documentId);

const contentHashForChunks = (chunks: RagChunk[]): string =>
  computeMaterialContentHash(chunks.map(chunk => chunk.content).join('\n'));

/**
 * Resolve an upload against the current draft. Exact identity is a no-op;
 * same-name/different-content uploads are separate documents unless the caller
 * explicitly supplies an existing document id for a new revision.
 */
export const resolveMaterialUpload = (
  existingChunks: RagChunk[],
  input: MaterialDocumentInput,
  chunkInputs: MaterialChunkInput[],
): MaterialUploadResolution => {
  const incomingHash = computeMaterialContentHash(input.content);
  const exactMatch = existingChunks.find(
    chunk =>
      chunk.fileName === normalizeFileName(input.fileName) &&
      chunk.contentHash === incomingHash &&
      (!input.documentId || chunk.documentId === input.documentId),
  );

  if (exactMatch) {
    const matching = exactMatch.documentId
      ? chunksForDocument(existingChunks, exactMatch.documentId)
      : existingChunks.filter(chunk => chunk.fileName === exactMatch.fileName);
    return {
      status: 'duplicate',
      document: createMaterialDocument({
        ...input,
        documentId: exactMatch.documentId,
        sourceVersion: exactMatch.sourceVersion,
        sourceType: exactMatch.sourceType,
      }),
      chunks: matching,
    };
  }

  const previousRevision = input.documentId
    ? existingChunks.find(chunk => chunk.documentId === input.documentId)
    : undefined;
  const sourceVersion = previousRevision
    ? Math.max(
        ...chunksForDocument(existingChunks, input.documentId!).map(
          chunk => chunk.sourceVersion ?? 1,
        ),
        1,
      ) + 1
    : input.sourceVersion;
  const document = createMaterialDocument({
    ...input,
    sourceVersion,
    documentId: previousRevision?.documentId ?? input.documentId,
  });

  return {
    status: previousRevision ? 'revision' : 'created',
    document,
    chunks: buildMaterialChunks(document, chunkInputs),
  };
};

/** Merge incoming material without silently replacing same-name documents. */
export const mergeMaterialChunks = (
  existingChunks: RagChunk[],
  incomingChunks: RagChunk[],
): RagChunk[] => {
  if (incomingChunks.length === 0) {
    return [...existingChunks];
  }

  const incomingDocumentIds = new Set(
    incomingChunks.map(chunk => chunk.documentId).filter((id): id is string => Boolean(id)),
  );
  const incomingChunkIds = new Set(
    incomingChunks.map(chunk => chunk.chunkId).filter((id): id is string => Boolean(id)),
  );
  const result = existingChunks.filter(chunk => {
    if (chunk.chunkId && incomingChunkIds.has(chunk.chunkId)) {
      return false;
    }
    return !(chunk.documentId && incomingDocumentIds.has(chunk.documentId));
  });

  return [...result, ...incomingChunks];
};

/** Remove one logical document; legacy chunks fall back to an exact filename match. */
export const removeMaterialDocument = (
  chunks: RagChunk[],
  documentId: string,
  legacyFileName?: string,
): RagChunk[] =>
  chunks.filter(chunk => {
    if (chunk.documentId) {
      return chunk.documentId !== documentId;
    }
    return legacyFileName ? chunk.fileName !== legacyFileName : true;
  });

/**
 * Give pre-F4 chunks stable identities without fabricating page/paragraph
 * locations. Existing content remains unchanged and is marked as a legacy
 * import so callers can explain the lower-fidelity provenance.
 */
export const migrateLegacyRagChunks = (chunks: RagChunk[]): RagChunk[] => {
  const groups = new Map<string, RagChunk[]>();
  for (const chunk of chunks) {
    if (chunk.documentId && chunk.contentHash && chunk.sourceVersion) {
      continue;
    }
    const group = groups.get(chunk.fileName) ?? [];
    group.push(chunk);
    groups.set(chunk.fileName, group);
  }

  const migrated = new Map<string, RagChunk[]>();
  for (const [fileName, group] of groups) {
    const contentHash = contentHashForChunks(group);
    const documentId = buildMaterialDocumentId(fileName, contentHash, 'legacy-import');
    const document = createMaterialDocument({
      fileName,
      content: group.map(chunk => chunk.content).join('\n'),
      documentId,
      sourceType: 'legacy-import',
    });
    migrated.set(
      fileName,
      buildMaterialChunks(
        document,
        group.map(chunk => ({ content: chunk.content })),
      ),
    );
  }

  return chunks.map(chunk => {
    if (chunk.documentId && chunk.contentHash && chunk.sourceVersion) {
      return { ...chunk };
    }
    const replacement = migrated.get(chunk.fileName)?.shift();
    return replacement ?? { ...chunk };
  });
};

export const getMaterialDocumentId = (chunk: RagChunk): string | undefined => chunk.documentId;

export const getMaterialSourceLocation = (chunk: RagChunk): RagSourceLocation | undefined =>
  copyLocation(chunk.sourceLocation);
