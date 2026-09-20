import { RagChunk, RagSourceLocation, RagSourceType } from '../types';
import { computeMaterialContentHash, migrateLegacyRagChunks } from './materialDocumentService';

export const KNOWLEDGE_SEARCH_TOOL_NAME = 'searchKnowledgeBase';

export const KNOWLEDGE_SEARCH_TOOL_DESCRIPTION =
  'Search the assistant knowledge database stored in the browser for relevant document chunks before answering questions about uploaded materials.';

export const KNOWLEDGE_SEARCH_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    query: {
      type: 'string',
      description: 'The search query used to find relevant knowledge chunks.',
    },
    maxResults: {
      type: 'number',
      description: 'Maximum number of matching chunks to return.',
    },
    fileName: {
      type: 'string',
      description: 'Optional file name filter when the user asks about a specific document.',
    },
  },
  required: ['query'],
} as const;

export const KNOWLEDGE_SEARCH_SYSTEM_PROMPT = `You can access the assistant's uploaded knowledge by calling ${KNOWLEDGE_SEARCH_TOOL_NAME}. Use it when the user asks about course materials, uploaded documents, or any fact that may come from the assistant knowledge database. Prefer the tool over guessing, and cite the document names naturally in your answer when helpful.`;

export interface KnowledgeSearchArgs {
  query: string;
  maxResults?: number;
  fileName?: string;
}

export interface IndexedKnowledgeChunk extends RagChunk {
  chunkId: string;
  chunkIndex: number;
}

export interface KnowledgeSearchIndex {
  /** Caller-owned privacy scope. An index never combines scopes implicitly. */
  scopeId: string;
  /** Deterministic checksum of the source revision set used to build this index. */
  revisionSetChecksum: string;
  chunks: IndexedKnowledgeChunk[];
  tokenPostings: Map<string, number[]>;
}

export interface SerializedKnowledgeSearchIndex {
  scopeId: string;
  revisionSetChecksum: string;
  chunks: IndexedKnowledgeChunk[];
}

const buildChunkContentFingerprint = (content: string): string => {
  let hash = 0;
  for (let index = 0; index < content.length; index += 1) {
    hash = (hash * 31 + content.charCodeAt(index)) >>> 0;
  }

  return `${content.length}:${hash.toString(16)}`;
};

export interface KnowledgeSearchMatch {
  fileName: string;
  content: string;
  score: number;
  chunkId: string;
  chunkIndex: number;
  documentId?: string;
  contentHash?: string;
  sourceVersion?: number;
  sourceLocation?: RagSourceLocation;
  sourceType?: RagSourceType;
  /** False means the caller must not present this result as a traceable source. */
  hasSource: boolean;
}

const CJK_CHAR_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const CJK_RUN_OR_OTHER_PATTERN =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+|[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu;

const normalizeText = (value: string): string => {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const tokenizePart = (part: string): string[] => {
  const value = part.trim();
  if (!value) {
    return [];
  }

  if (!CJK_CHAR_PATTERN.test(value)) {
    return value.length > 1 ? [value] : [];
  }

  if (value.length === 1) {
    return [value];
  }

  const bigrams: string[] = [];
  for (let index = 0; index < value.length - 1; index += 1) {
    bigrams.push(value.slice(index, index + 2));
  }
  return bigrams;
};

const tokenize = (value: string): string[] => {
  const seen = new Set<string>();

  return normalizeText(value)
    .split(' ')
    .flatMap(token => token.match(CJK_RUN_OR_OTHER_PATTERN) ?? [])
    .flatMap(tokenizePart)
    .filter(token => {
      if (seen.has(token)) {
        return false;
      }
      seen.add(token);
      return true;
    });
};

export const createExcerpt = (content: string, limit = 800): string => {
  if (content.length <= limit) {
    return content;
  }

  return `${content.slice(0, limit)}…`;
};

export const hasKnowledgeChunks = (knowledgeChunks?: RagChunk[]): boolean => {
  return Array.isArray(knowledgeChunks) && knowledgeChunks.length > 0;
};

export const buildIndexedKnowledgeChunks = (
  knowledgeChunks: RagChunk[],
): IndexedKnowledgeChunk[] => {
  const documentChunkCounters = new Map<string, number>();

  return knowledgeChunks.map(chunk => {
    const documentKey = chunk.documentId
      ? `document:${chunk.documentId}`
      : `legacy:${chunk.fileName}`;
    const nextChunkIndex = documentChunkCounters.get(documentKey) ?? 0;
    documentChunkCounters.set(documentKey, nextChunkIndex + 1);
    const sourceVersion = Number.isInteger(chunk.sourceVersion) ? chunk.sourceVersion : 1;
    const chunkId =
      (chunk.sourceType !== 'legacy-import' ? chunk.chunkId : undefined) ??
      (chunk.documentId && chunk.sourceType !== 'legacy-import'
        ? `${chunk.documentId}:v${sourceVersion}#${nextChunkIndex}:${buildChunkContentFingerprint(chunk.content)}`
        : `${chunk.fileName}#${nextChunkIndex}:${buildChunkContentFingerprint(chunk.content)}`);

    return {
      ...chunk,
      chunkIndex: nextChunkIndex,
      chunkId,
    };
  });
};

const buildRevisionSetChecksum = (chunks: IndexedKnowledgeChunk[]): string =>
  computeMaterialContentHash(
    JSON.stringify(
      chunks.map(chunk => ({
        chunkId: chunk.chunkId,
        documentId: chunk.documentId ?? null,
        contentHash: chunk.contentHash ?? null,
        sourceVersion: chunk.sourceVersion ?? 1,
      })),
    ),
  );

export const buildKnowledgeSearchIndex = (
  knowledgeChunks: RagChunk[],
  scopeId = 'assistant-local',
): KnowledgeSearchIndex => {
  const normalizedChunks = migrateLegacyRagChunks(knowledgeChunks);
  const chunks = buildIndexedKnowledgeChunks(normalizedChunks);
  const tokenPostings = new Map<string, number[]>();

  chunks.forEach((chunk, index) => {
    for (const token of tokenize(`${chunk.fileName} ${chunk.content}`)) {
      const posting = tokenPostings.get(token) ?? [];
      posting.push(index);
      tokenPostings.set(token, posting);
    }
  });

  return {
    scopeId,
    revisionSetChecksum: buildRevisionSetChecksum(chunks),
    chunks,
    tokenPostings,
  };
};

export const serializeKnowledgeSearchIndex = (
  index: KnowledgeSearchIndex,
): SerializedKnowledgeSearchIndex => ({
  scopeId: index.scopeId,
  revisionSetChecksum: index.revisionSetChecksum,
  chunks: index.chunks.map(chunk => ({ ...chunk })),
});

export const deserializeKnowledgeSearchIndex = (
  snapshot: SerializedKnowledgeSearchIndex,
): KnowledgeSearchIndex => buildKnowledgeSearchIndex(snapshot.chunks, snapshot.scopeId);

const scoreIndexedChunks = (
  searchIndex: KnowledgeSearchIndex,
  args: KnowledgeSearchArgs,
): KnowledgeSearchMatch[] => {
  if (!args.query.trim()) {
    return [];
  }

  const query = args.query.trim();
  const normalizedQuery = normalizeText(query);
  const queryTokens = tokenize(query);
  const requestedFile = args.fileName ? normalizeText(args.fileName) : '';
  const maxResults = Math.min(Math.max(Math.round(args.maxResults || 5), 1), 8);

  const candidateIndexes = new Set<number>();
  if (queryTokens.length === 0) {
    searchIndex.chunks.forEach((_chunk, candidateIndex) => candidateIndexes.add(candidateIndex));
  } else {
    for (const token of queryTokens) {
      for (const candidateIndex of searchIndex.tokenPostings.get(token) ?? []) {
        candidateIndexes.add(candidateIndex);
      }
    }
    // A phrase can match punctuation-normalized text even when tokenization
    // drops a one-character token; retain a bounded fallback in that case.
    if (candidateIndexes.size === 0) {
      searchIndex.chunks.forEach((_chunk, candidateIndex) => candidateIndexes.add(candidateIndex));
    }
  }

  const scored = [...candidateIndexes]
    .map(candidateIndex => {
      const chunk = searchIndex.chunks[candidateIndex];
      if (!chunk) {
        return null;
      }
      const normalizedContent = normalizeText(chunk.content);
      const normalizedFileName = normalizeText(chunk.fileName);

      if (requestedFile && !normalizedFileName.includes(requestedFile)) {
        return null;
      }

      let score = 0;

      if (normalizedQuery && normalizedContent.includes(normalizedQuery)) {
        score += 8;
      }

      if (normalizedQuery && normalizedFileName.includes(normalizedQuery)) {
        score += 6;
      }

      let matchedTokenCount = 0;
      for (const token of queryTokens) {
        let matched = false;
        if (normalizedContent.includes(token)) {
          score += 1;
          matched = true;
        }
        if (normalizedFileName.includes(token)) {
          score += 1.5;
          matched = true;
        }
        if (matched) {
          matchedTokenCount += 1;
        }
      }

      // Avoid returning a plausible-looking source when a long query only
      // shares one incidental short token with an unrelated document.
      if (
        queryTokens.length > 1 &&
        matchedTokenCount < Math.max(1, Math.ceil(queryTokens.length / 2)) &&
        score < 6
      ) {
        return null;
      }

      return {
        fileName: chunk.fileName,
        content: createExcerpt(chunk.content),
        score,
        chunkId: chunk.chunkId,
        chunkIndex: chunk.chunkIndex,
        ...(chunk.documentId ? { documentId: chunk.documentId } : {}),
        ...(chunk.contentHash ? { contentHash: chunk.contentHash } : {}),
        ...(chunk.sourceVersion ? { sourceVersion: chunk.sourceVersion } : {}),
        ...(chunk.sourceLocation ? { sourceLocation: chunk.sourceLocation } : {}),
        ...(chunk.sourceType ? { sourceType: chunk.sourceType } : {}),
        hasSource: Boolean(
          chunk.documentId && chunk.contentHash && chunk.sourceType !== 'legacy-import',
        ),
      } satisfies KnowledgeSearchMatch;
    })
    .filter((chunk): chunk is KnowledgeSearchMatch => chunk !== null && chunk.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || a.fileName.localeCompare(b.fileName) || a.chunkIndex - b.chunkIndex,
    )
    .slice(0, maxResults);

  return scored;
};

export const searchKnowledgeIndex = (
  index: KnowledgeSearchIndex,
  args: KnowledgeSearchArgs,
  scopeId = index.scopeId,
): KnowledgeSearchMatch[] => (scopeId === index.scopeId ? scoreIndexedChunks(index, args) : []);

export const searchKnowledgeBase = (
  knowledgeChunks: RagChunk[],
  args: KnowledgeSearchArgs,
): KnowledgeSearchMatch[] => {
  if (!hasKnowledgeChunks(knowledgeChunks)) {
    return [];
  }
  return searchKnowledgeIndex(buildKnowledgeSearchIndex(knowledgeChunks), args);
};

export const buildKnowledgeSearchResponse = (
  knowledgeChunks: RagChunk[],
  args: KnowledgeSearchArgs,
) => {
  const matches = searchKnowledgeBase(knowledgeChunks, args);

  return {
    query: args.query,
    fileNameFilter: args.fileName || null,
    totalMatches: matches.length,
    sourceStatus: matches.length > 0 ? 'found' : 'no-source',
    results: matches,
  };
};
