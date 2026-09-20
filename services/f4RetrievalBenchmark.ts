import type { Assistant, ChatSession, RagChunk } from '../types';
import type { ParsedDocument } from './documentParserService';
import { parseFile } from './fileParserService';
import {
  F4_MATERIAL_FIXTURES,
  F4_QUERY_LABELS,
  F4_RETRIEVAL_TARGET_TOP5,
  type F4QueryLabel,
} from './f4RetrievalFixtures';
import { buildKnowledgeSearchIndex, searchKnowledgeIndex } from './knowledgeSearchService';
import { buildLocalSearchIndex, searchLocalSearchIndex } from './localSearchService';

export interface F4RetrievalEvaluation {
  queryCount: number;
  answerableQueryCount: number;
  top5Hits: number;
  top5Accuracy: number;
  noAnswerFalsePositives: number;
  targetTop5Accuracy: number;
  meetsTarget: boolean;
}

export const evaluateF4Retrieval = (
  chunks: RagChunk[] = F4_MATERIAL_FIXTURES.flatMap(fixture => fixture.chunks),
  labels: F4QueryLabel[] = F4_QUERY_LABELS,
): F4RetrievalEvaluation => {
  const index = buildKnowledgeSearchIndex(chunks, 'f4-benchmark');
  const answerableLabels = labels.filter(label => label.answerable && label.expectedDocumentId);
  let top5Hits = 0;
  let noAnswerFalsePositives = 0;

  for (const label of labels) {
    const results = searchKnowledgeIndex(index, { query: label.query, maxResults: 5 });
    if (!label.answerable) {
      if (results.length > 0) {
        noAnswerFalsePositives += 1;
      }
      continue;
    }
    if (results.some(result => result.documentId === label.expectedDocumentId)) {
      top5Hits += 1;
    }
  }

  const top5Accuracy = answerableLabels.length > 0 ? top5Hits / answerableLabels.length : 0;
  return {
    queryCount: labels.length,
    answerableQueryCount: answerableLabels.length,
    top5Hits,
    top5Accuracy,
    noAnswerFalsePositives,
    targetTop5Accuracy: F4_RETRIEVAL_TARGET_TOP5,
    meetsTarget: top5Accuracy >= F4_RETRIEVAL_TARGET_TOP5 && noAnswerFalsePositives === 0,
  };
};

/** Recorded deterministic baseline for the checked-in 20-material/50-query fixture. */
export const F4_RETRIEVAL_BASELINE = evaluateF4Retrieval();

export interface F4PerformanceMeasurement {
  chunkCount: number;
  sessionCount: number;
  sessionMessageCount: number;
  coldP95Ms: number;
  hotP95Ms: number;
  cancelP95Ms: number;
  targets: {
    coldP95Ms: number;
    hotP95Ms: number;
    cancelP95Ms: number;
  };
  environmentNote: string;
}

/** Measure end-to-end abort propagation against a deliberately deferred parser. */
export const measureF4Cancellation = async (iterations = 20): Promise<number> => {
  const file = new File(['deferred parser fixture'], 'f4-cancel.txt', { type: 'text/plain' });
  const durations: number[] = [];
  for (let iteration = 0; iteration < Math.max(1, iterations); iteration += 1) {
    const controller = new AbortController();
    const started = now();
    const pending = parseFile(file, {
      signal: controller.signal,
      parseDocument: async (_sourceFile): Promise<ParsedDocument> => await new Promise(() => {}),
    }).catch(() => undefined);
    controller.abort();
    await pending;
    durations.push(now() - started);
  }
  return percentile95(durations);
};

const percentile95 = (values: number[]): number => {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
};

const now = (): number =>
  typeof globalThis.performance?.now === 'function' ? globalThis.performance.now() : Date.now();

/**
 * Fixed, opt-in local benchmark. It deliberately returns measured values and
 * does not claim a CI/device-independent guarantee; callers should record the
 * result with browser and build identifiers.
 */
export const measureF4Performance = async (
  options: {
    chunkCount?: number;
    sessionCount?: number;
    iterations?: number;
  } = {},
): Promise<F4PerformanceMeasurement> => {
  const chunkCount = Math.max(1, options.chunkCount ?? 10_000);
  const sessionCount = Math.max(1, options.sessionCount ?? 100);
  const iterations = Math.max(5, options.iterations ?? 20);
  const chunks = Array.from(
    { length: chunkCount },
    (_, index): RagChunk => ({
      fileName: `benchmark-${index % 20}.md`,
      content: `benchmark material ${index} water cycle algorithm privacy`,
      documentId: `benchmark-document-${index % 20}`,
      contentHash: `benchmark-hash-${index % 20}`,
      sourceVersion: 1,
      sourceType: 'file',
    }),
  );
  const coldDurations: number[] = [];
  const hotDurations: number[] = [];
  const assistants: Assistant[] = [
    {
      id: 'f4-performance-assistant',
      name: 'Performance materials',
      description: '',
      systemPrompt: '',
      createdAt: 1,
      ragChunks: chunks,
    },
  ];
  const sessions: ChatSession[] = Array.from({ length: sessionCount }, (_, sessionIndex) => ({
    id: `f4-session-${sessionIndex}`,
    assistantId: assistants[0].id,
    title: `Teaching session ${sessionIndex}`,
    createdAt: 1,
    updatedAt: 1,
    tokenCount: 0,
    messages: Array.from({ length: 20 }, (_, messageIndex) => ({
      role: messageIndex % 2 === 0 ? ('user' as const) : ('model' as const),
      content: `Session ${sessionIndex} message ${messageIndex}: water cycle algorithm privacy`,
      timestamp: messageIndex,
    })),
  }));
  const localInput = { query: '', assistants, sessions, scopeId: 'f4-performance' };

  let index = buildKnowledgeSearchIndex(chunks, 'f4-performance');
  let localIndex = buildLocalSearchIndex(localInput);
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const coldStart = now();
    index = buildKnowledgeSearchIndex(chunks, 'f4-performance');
    localIndex = buildLocalSearchIndex(localInput);
    searchKnowledgeIndex(index, { query: 'water cycle', maxResults: 5 });
    searchLocalSearchIndex(localIndex, 'water cycle');
    coldDurations.push(now() - coldStart);

    const hotStart = now();
    searchKnowledgeIndex(index, { query: iteration % 2 ? 'privacy' : 'algorithm', maxResults: 5 });
    searchLocalSearchIndex(localIndex, iteration % 2 ? 'privacy' : 'algorithm');
    hotDurations.push(now() - hotStart);
  }

  return {
    chunkCount,
    sessionCount,
    sessionMessageCount: sessions.reduce((count, session) => count + session.messages.length, 0),
    coldP95Ms: percentile95(coldDurations),
    hotP95Ms: percentile95(hotDurations),
    cancelP95Ms: await measureF4Cancellation(iterations),
    targets: { coldP95Ms: 300, hotP95Ms: 300, cancelP95Ms: 1_000 },
    environmentNote:
      'Record browser, OS, CPU, build hash, and parser fixture when publishing this result.',
  };
};
