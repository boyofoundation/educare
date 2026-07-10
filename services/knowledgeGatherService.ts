import { ChatMessage, MessageCitation, RagChunk } from '../types';
import { ToolCall } from './llmAdapter';
import { initializeProviders, providerManager } from './providerRegistry';
import {
  buildIndexedKnowledgeChunks,
  buildKnowledgeSearchResponse,
  createExcerpt,
  KNOWLEDGE_SEARCH_SYSTEM_PROMPT,
  KNOWLEDGE_SEARCH_TOOL_DESCRIPTION,
  KNOWLEDGE_SEARCH_TOOL_NAME,
  KNOWLEDGE_SEARCH_TOOL_SCHEMA,
} from './knowledgeSearchService';

const GATHER_TIMEOUT_MS = 15_000;
const GATHER_MAX_TOOL_ROUNDS = 2;
const MAX_SELECTED_CHUNKS = 6;

export interface KnowledgeGatherResult {
  ragContext: string;
  citations: MessageCitation[];
}

interface CapturedKnowledgeChunk {
  chunkId: string;
  chunkIndex: number;
  fileName: string;
  content: string;
  excerpt: string;
  score: number;
}

const KNOWLEDGE_GATHER_SYSTEM_PROMPT = `${KNOWLEDGE_SEARCH_SYSTEM_PROMPT}

You are a hidden background knowledge gatherer. You will receive a conversation transcript between a user and an assistant. You are NOT the assistant in that transcript: do not answer, continue, or react to the conversation. Your only job is to search the knowledge base for material relevant to the ongoing conversation — especially the user's latest message — before the main answer is generated. You may rewrite the query, call the tool multiple times, and compare results. After you are done, output only a <selected>...</selected> block listing the chunkId values that should be injected into the main answer context, separated by commas.`;

const formatTranscript = (recentHistory: ChatMessage[], message: string): string => {
  const lines = recentHistory
    .filter(entry => !entry.isError && entry.content.trim())
    .map(entry => `${entry.role === 'user' ? 'User' : 'Assistant'}: ${entry.content}`);
  lines.push(`User (latest message): ${message}`);
  return lines.join('\n\n');
};

const buildGatherInstruction = (recentHistory: ChatMessage[], message: string): string =>
  `<conversation_transcript>
${formatTranscript(recentHistory, message)}
</conversation_transcript>

The transcript above is reference material only — do not reply to it. Identify what knowledge the conversation depends on, call ${KNOWLEDGE_SEARCH_TOOL_NAME} with suitable queries, then output only the <selected>...</selected> block.`;

const parseSelectedChunkIds = (value: string): string[] => {
  const match = value.match(/<selected>([\s\S]*?)<\/selected>/i);
  if (!match) {
    return [];
  }

  return match[1]
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
};

const toRagContext = (chunks: CapturedKnowledgeChunk[]): KnowledgeGatherResult => {
  const citations = chunks.map((chunk, index) => ({
    marker: index + 1,
    chunkId: chunk.chunkId,
    fileName: chunk.fileName,
    chunkIndex: chunk.chunkIndex,
    excerpt: chunk.excerpt,
  }));

  const ragContext = chunks
    .map(
      (chunk, index) =>
        `[${index + 1}] (${chunk.fileName} · 段落 ${chunk.chunkIndex + 1})\n${chunk.content}`,
    )
    .join('\n\n');

  return {
    ragContext,
    citations,
  };
};

export const gatherKnowledge = async (params: {
  message: string;
  recentHistory: ChatMessage[];
  knowledgeChunks: RagChunk[];
  signal?: AbortSignal;
}): Promise<KnowledgeGatherResult | null> => {
  const { message, recentHistory, knowledgeChunks, signal } = params;

  if (!message.trim() || knowledgeChunks.length === 0) {
    return null;
  }

  await initializeProviders();
  const activeProvider = providerManager.getActiveProvider();
  if (!activeProvider || !activeProvider.isAvailable()) {
    return null;
  }

  const indexedChunks = buildIndexedKnowledgeChunks(knowledgeChunks);
  const indexedChunkById = new Map(indexedChunks.map(chunk => [chunk.chunkId, chunk]));
  const capturedChunks = new Map<string, CapturedKnowledgeChunk>();
  const gatherAbort = new AbortController();
  const relayAbort = () => gatherAbort.abort(signal?.reason);
  const timeoutId = globalThis.setTimeout(
    () => gatherAbort.abort('knowledge-gather-timeout'),
    GATHER_TIMEOUT_MS,
  );
  signal?.addEventListener('abort', relayAbort, { once: true });

  if (signal?.aborted) {
    relayAbort();
  }

  let fullText = '';

  const executeTool = async (call: ToolCall) => {
    if (call.name !== KNOWLEDGE_SEARCH_TOOL_NAME) {
      return {
        ok: false,
        recoverable: true,
        code: 'knowledge-gather-tool-unsupported',
        message: `Unsupported tool: ${call.name}`,
        guidance: 'Retry using searchKnowledgeBase only.',
      };
    }

    const response = buildKnowledgeSearchResponse(
      knowledgeChunks,
      call.args as {
        query: string;
        maxResults?: number;
        fileName?: string;
      },
    );
    for (const match of response.results) {
      const fullChunk = indexedChunkById.get(match.chunkId);
      if (!fullChunk) {
        continue;
      }

      const existing = capturedChunks.get(match.chunkId);
      if (!existing || match.score > existing.score) {
        capturedChunks.set(match.chunkId, {
          chunkId: match.chunkId,
          chunkIndex: match.chunkIndex,
          fileName: match.fileName,
          content: fullChunk.content,
          excerpt: createExcerpt(fullChunk.content),
          score: match.score,
        });
      }
    }

    return response;
  };

  try {
    for await (const response of activeProvider.streamChat({
      systemPrompt: KNOWLEDGE_GATHER_SYSTEM_PROMPT,
      // 對話以 transcript 形式包進單一 user 訊息;若照原始多輪格式送出,
      // gatherer LLM 會把最後一則 user 訊息當成要回答的問題而非檢索依據。
      history: [],
      message: buildGatherInstruction(recentHistory, message),
      tools: [
        {
          name: KNOWLEDGE_SEARCH_TOOL_NAME,
          description: KNOWLEDGE_SEARCH_TOOL_DESCRIPTION,
          parameters: KNOWLEDGE_SEARCH_TOOL_SCHEMA,
        },
      ],
      executeTool,
      maxToolRounds: GATHER_MAX_TOOL_ROUNDS,
      signal: gatherAbort.signal,
    })) {
      if (!response.isComplete && response.text) {
        fullText += response.text;
      }
    }
  } catch {
    return null;
  } finally {
    globalThis.clearTimeout(timeoutId);
    signal?.removeEventListener('abort', relayAbort);
  }

  if (capturedChunks.size === 0) {
    return null;
  }

  const selectedIds = parseSelectedChunkIds(fullText);
  const selectedChunks = selectedIds
    .map(id => capturedChunks.get(id))
    .filter((chunk): chunk is CapturedKnowledgeChunk => Boolean(chunk));

  const resolvedChunks = (selectedChunks.length > 0 ? selectedChunks : [...capturedChunks.values()])
    .sort(
      (a, b) =>
        b.score - a.score || a.fileName.localeCompare(b.fileName) || a.chunkIndex - b.chunkIndex,
    )
    .slice(0, MAX_SELECTED_CHUNKS);

  if (resolvedChunks.length === 0) {
    return null;
  }

  return toRagContext(resolvedChunks);
};
