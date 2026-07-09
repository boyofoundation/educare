import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatParams, ToolCall } from './llmAdapter';

const { mockInitializeProviders, mockGetActiveProvider } = vi.hoisted(() => ({
  mockInitializeProviders: vi.fn().mockResolvedValue(undefined),
  mockGetActiveProvider: vi.fn(),
}));

vi.mock('./providerRegistry', () => ({
  initializeProviders: mockInitializeProviders,
  providerManager: {
    getActiveProvider: mockGetActiveProvider,
  },
}));

import { gatherKnowledge } from './knowledgeGatherService';
import type { RagChunk } from '../types';

const knowledgeChunks: RagChunk[] = [
  { fileName: '員工手冊.pdf', content: '特休假規定：滿一年後享有特休假。' },
  { fileName: '請假辦法.docx', content: '病假需要檢附證明。' },
];

const createProvider = (options: {
  selectedText?: string;
  toolCall?: ToolCall;
  waitForAbort?: boolean;
  onAbort?: (reason: unknown) => void;
}) => ({
  isAvailable: () => true,
  streamChat: vi.fn(async function* (params: ChatParams) {
    if (options.waitForAbort) {
      await new Promise((_, reject) => {
        params.signal?.addEventListener(
          'abort',
          () => {
            options.onAbort?.(params.signal?.reason);
            reject(new Error('aborted'));
          },
          {
            once: true,
          },
        );
      });
      return;
    }

    if (params.executeTool && options.toolCall) {
      await params.executeTool(options.toolCall);
    }

    yield {
      text: options.selectedText ?? '',
      isComplete: false,
    };
    yield {
      text: '',
      isComplete: true,
    };
  }),
});

describe('gatherKnowledge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('returns selected chunks as rag context and citations', async () => {
    const provider = createProvider({
      toolCall: {
        name: 'searchKnowledgeBase',
        args: { query: '特休', maxResults: 3 },
      },
      selectedText: '<selected>員工手冊.pdf#0</selected>',
    });
    mockGetActiveProvider.mockReturnValue(provider);

    const result = await gatherKnowledge({
      message: '特休規定是什麼？',
      recentHistory: [],
      knowledgeChunks,
    });

    expect(result).toMatchObject({
      citations: [
        {
          marker: 1,
          fileName: '員工手冊.pdf',
          chunkIndex: 0,
        },
      ],
    });
    expect(result?.citations[0]?.chunkId).toMatch(/^員工手冊\.pdf#0:\d+:[0-9a-f]+$/);
    expect(result?.ragContext).toContain('[1] (員工手冊.pdf · 段落 1)');
    expect(result?.ragContext).toContain('特休假規定');
  });

  it('returns null without initializing providers when no knowledge chunks exist', async () => {
    const result = await gatherKnowledge({
      message: '沒有知識庫時會怎樣？',
      recentHistory: [],
      knowledgeChunks: [],
    });

    expect(result).toBeNull();
    expect(mockInitializeProviders).not.toHaveBeenCalled();
    expect(mockGetActiveProvider).not.toHaveBeenCalled();
  });

  it('falls back to captured top-scored chunks when selected block is missing', async () => {
    const provider = createProvider({
      toolCall: {
        name: 'searchKnowledgeBase',
        args: { query: '病假', maxResults: 3 },
      },
      selectedText: 'no selected block',
    });
    mockGetActiveProvider.mockReturnValue(provider);

    const result = await gatherKnowledge({
      message: '請假規則',
      recentHistory: [],
      knowledgeChunks,
    });

    expect(result).not.toBeNull();
    expect(result?.citations.length).toBeGreaterThan(0);
    expect(result?.ragContext).toContain('請假辦法.docx');
  });

  it('returns null when the provider stalls until timeout', async () => {
    const provider = createProvider({ waitForAbort: true });
    mockGetActiveProvider.mockReturnValue(provider);

    const resultPromise = gatherKnowledge({
      message: '會 timeout 嗎？',
      recentHistory: [],
      knowledgeChunks,
    });

    await vi.advanceTimersByTimeAsync(15_100);
    const result = await resultPromise;

    expect(result).toBeNull();
  }, 10000);

  it('returns null and relays abort to the provider stream when the caller aborts', async () => {
    const abortController = new AbortController();
    const onAbort = vi.fn();
    const provider = createProvider({
      waitForAbort: true,
      onAbort,
    });
    mockGetActiveProvider.mockReturnValue(provider);

    const resultPromise = gatherKnowledge({
      message: '中止測試',
      recentHistory: [],
      knowledgeChunks,
      signal: abortController.signal,
    });

    await Promise.resolve();
    abortController.abort('caller-abort');
    const result = await resultPromise;

    expect(result).toBeNull();
    expect(onAbort).toHaveBeenCalledWith('caller-abort');
  });
});
