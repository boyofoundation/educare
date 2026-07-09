import { RagChunk } from '../types';

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
  const fileChunkCounters = new Map<string, number>();

  return knowledgeChunks.map(chunk => {
    const nextChunkIndex = fileChunkCounters.get(chunk.fileName) ?? 0;
    fileChunkCounters.set(chunk.fileName, nextChunkIndex + 1);

    return {
      ...chunk,
      chunkIndex: nextChunkIndex,
      chunkId: `${chunk.fileName}#${nextChunkIndex}:${buildChunkContentFingerprint(chunk.content)}`,
    };
  });
};

export const searchKnowledgeBase = (
  knowledgeChunks: RagChunk[],
  args: KnowledgeSearchArgs,
): KnowledgeSearchMatch[] => {
  if (!hasKnowledgeChunks(knowledgeChunks) || !args.query.trim()) {
    return [];
  }

  const query = args.query.trim();
  const normalizedQuery = normalizeText(query);
  const queryTokens = tokenize(query);
  const requestedFile = args.fileName ? normalizeText(args.fileName) : '';
  const maxResults = Math.min(Math.max(Math.round(args.maxResults || 5), 1), 8);

  const scored = buildIndexedKnowledgeChunks(knowledgeChunks)
    .map(chunk => {
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

      for (const token of queryTokens) {
        if (normalizedContent.includes(token)) {
          score += 1;
        }
        if (normalizedFileName.includes(token)) {
          score += 1.5;
        }
      }

      return {
        fileName: chunk.fileName,
        content: createExcerpt(chunk.content),
        score,
        chunkId: chunk.chunkId,
        chunkIndex: chunk.chunkIndex,
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

export const buildKnowledgeSearchResponse = (
  knowledgeChunks: RagChunk[],
  args: KnowledgeSearchArgs,
) => {
  const matches = searchKnowledgeBase(knowledgeChunks, args);

  return {
    query: args.query,
    fileNameFilter: args.fileName || null,
    totalMatches: matches.length,
    results: matches,
  };
};
