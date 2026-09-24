import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChatCompactorService, CompressionConfig } from './chatCompactorService';
import { CompactContext, ConversationRound } from '../types';
import {
  ProviderManager,
  type LLMProvider,
  type ChatParams,
  type StreamingResponse,
  type ProviderSettings,
  type ProviderType,
  type ProviderConfig,
  DEFAULT_PROVIDER_SETTINGS,
} from './llmAdapter';

import type { MockedFunction } from 'vitest';

const mockInitialize = vi
  .fn<(config: ProviderConfig) => Promise<void>>()
  .mockResolvedValue(undefined) as unknown as MockedFunction<
  (config: ProviderConfig) => Promise<void>
>;
const mockIsAvailable = vi.fn<() => boolean>().mockReturnValue(true) as MockedFunction<
  () => boolean
>;
const mockGetAvailableModels = vi
  .fn<() => Promise<string[]>>()
  .mockResolvedValue([]) as MockedFunction<() => Promise<string[]>>;
const mockReinitialize = vi.fn<() => void>().mockReturnValue(undefined) as MockedFunction<
  () => void
>;
const mockManagerStreamChat = vi
  .fn<(params: ChatParams) => Promise<AsyncIterable<StreamingResponse>>>()
  .mockResolvedValue(
    (async function* () {
      yield { text: '', isComplete: true };
    })(),
  ) as MockedFunction<(params: ChatParams) => Promise<AsyncIterable<StreamingResponse>>>;

mockIsAvailable.mockReturnValue(true);

const mockProvider: LLMProvider = {
  name: 'gemini' as ProviderType,
  displayName: 'Mock Provider',
  supportedModels: [],
  requiresApiKey: false,
  supportsLocalMode: false,
  initialize: async (config: ProviderConfig) => await mockInitialize(config),
  isAvailable: () => mockIsAvailable(),
  streamChat: async function* (_params: ChatParams) {
    yield { text: '', isComplete: true };
  },
  getAvailableModels: async () => await mockGetAvailableModels(),
  reinitialize: () => mockReinitialize(),
};

const mockGetActiveProvider = vi
  .fn<() => LLMProvider | null>()
  .mockReturnValue(mockProvider) as MockedFunction<() => LLMProvider | null>;
const mockRegisterProvider = vi
  .fn<(type: ProviderType, provider: LLMProvider) => void>()
  .mockReturnValue(undefined) as MockedFunction<
  (type: ProviderType, provider: LLMProvider) => void
>;
const mockGetProvider = vi
  .fn<(type?: ProviderType) => LLMProvider | null>()
  .mockReturnValue(mockProvider) as MockedFunction<(type?: ProviderType) => LLMProvider | null>;
const mockSetActiveProvider = vi
  .fn<(type: ProviderType) => void>()
  .mockReturnValue(undefined) as MockedFunction<(type: ProviderType) => void>;
const mockGetSettings = vi
  .fn<() => ProviderSettings>()
  .mockReturnValue(DEFAULT_PROVIDER_SETTINGS) as MockedFunction<() => ProviderSettings>;
const mockUpdateProviderConfig = vi
  .fn<(type: ProviderType, config: Partial<ProviderConfig>) => void>()
  .mockReturnValue(undefined) as MockedFunction<
  (type: ProviderType, config: Partial<ProviderConfig>) => void
>;
const mockEnableProvider = vi
  .fn<(type: ProviderType, enabled?: boolean) => void>()
  .mockReturnValue(undefined) as MockedFunction<(type: ProviderType, enabled?: boolean) => void>;
const mockIsProviderEnabled = vi
  .fn<(type: ProviderType) => boolean>()
  .mockReturnValue(true) as MockedFunction<(type: ProviderType) => boolean>;
const mockSaveSettings = vi.fn<() => void>().mockReturnValue(undefined) as MockedFunction<
  () => void
>;

const mockGetAvailableProviders = vi
  .fn<() => Array<{ type: ProviderType; provider: LLMProvider }>>()
  .mockReturnValue([{ type: 'gemini' as ProviderType, provider: mockProvider }]) as MockedFunction<
  () => Array<{ type: ProviderType; provider: LLMProvider }>
>;

mockGetActiveProvider.mockReturnValue(mockProvider);

const mockProviderManager = {
  getActiveProvider: mockGetActiveProvider,
  streamChat: mockManagerStreamChat,
  saveSettings: mockSaveSettings,
  registerProvider: mockRegisterProvider,
  getProvider: mockGetProvider,
  setActiveProvider: mockSetActiveProvider,
  getSettings: mockGetSettings,
  updateProviderConfig: mockUpdateProviderConfig,
  enableProvider: mockEnableProvider,
  isProviderEnabled: mockIsProviderEnabled,
  getAvailableProviders: mockGetAvailableProviders,
} as unknown as ProviderManager;

describe('ChatCompactorService', () => {
  let compactorService: ChatCompactorService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsAvailable.mockReturnValue(true);
    mockGetActiveProvider.mockReturnValue(mockProvider);
    vi.spyOn(ProviderManager, 'getInstance').mockReturnValue(mockProviderManager);
    compactorService = new ChatCompactorService();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const createTestRound = (
    roundNumber: number,
    userContent: string,
    assistantContent: string,
  ): ConversationRound => ({
    userMessage: { role: 'user', content: userContent },
    assistantMessage: { role: 'model', content: assistantContent },
    roundNumber,
  });

  const createTestCompactContext = (): CompactContext => ({
    type: 'compact',
    content: 'Previous compressed conversation summary',
    tokenCount: 500,
    compressedFromRounds: 5,
    compressedFromMessages: 10,
    createdAt: '2025-09-10T12:00:00Z',
    version: '1.0',
  });

  describe('Configuration', () => {
    it('should use default configuration', () => {
      const config = compactorService.getConfig();

      expect(config.targetTokens).toBe(2000);
      expect(config.triggerRounds).toBe(10);
      expect(config.preserveLastRounds).toBe(2);
      expect(config.maxRetries).toBe(1);
      // compressionModel 已移除，現在使用 ProviderManager 的設定
      expect(config.compressionVersion).toBe('1.0');
    });

    it('should accept custom configuration', () => {
      const customConfig: Partial<CompressionConfig> = {
        targetTokens: 1500,
        triggerRounds: 8,
        preserveLastRounds: 3,
      };

      const customCompactor = new ChatCompactorService(customConfig);
      const config = customCompactor.getConfig();

      expect(config.targetTokens).toBe(1500);
      expect(config.triggerRounds).toBe(8);
      expect(config.preserveLastRounds).toBe(3);
      expect(config.maxRetries).toBe(1); // Should keep default
    });

    it('should allow updating configuration', () => {
      compactorService.updateConfig({ targetTokens: 3000 });

      expect(compactorService.getConfig().targetTokens).toBe(3000);
    });
  });

  describe('Compression Trigger Logic', () => {
    it('should not trigger compression for insufficient rounds', () => {
      // Default: triggerRounds(10) + preserveLastRounds(2) = 12
      expect(compactorService.shouldTriggerCompression(10)).toBe(false);
      expect(compactorService.shouldTriggerCompression(12)).toBe(false);
    });

    it('should trigger compression when rounds exceed threshold', () => {
      expect(compactorService.shouldTriggerCompression(13)).toBe(true);
      expect(compactorService.shouldTriggerCompression(15)).toBe(true);
    });

    it('should handle existing compact context', () => {
      // With existing compact, threshold is the same
      expect(compactorService.shouldTriggerCompression(13, true)).toBe(true);
      expect(compactorService.shouldTriggerCompression(12, true)).toBe(false);
    });

    it('should work with custom configuration', () => {
      const customCompactor = new ChatCompactorService({
        triggerRounds: 5,
        preserveLastRounds: 1,
      });

      expect(customCompactor.shouldTriggerCompression(6)).toBe(false);
      expect(customCompactor.shouldTriggerCompression(7)).toBe(true);
    });
  });

  describe('Token Estimation', () => {
    it('should estimate token count for Chinese text', () => {
      const rounds = [
        createTestRound(1, '你好世界', '你好！很高興見到你'),
        createTestRound(2, '今天天氣如何？', '今天天氣很好，陽光明媚'),
      ];

      const tokenCount = (
        compactorService as unknown as {
          estimateTokenCount: (rounds: ConversationRound[]) => number;
        }
      ).estimateTokenCount(rounds);
      expect(tokenCount).toBeGreaterThan(0);
      expect(tokenCount).toBeLessThan(100); // Should be reasonable for short Chinese text
    });

    it('should estimate token count for English text', () => {
      const rounds = [
        createTestRound(1, 'Hello world', 'Hello! Nice to meet you'),
        createTestRound(2, 'How are you?', 'I am doing well, thank you'),
      ];

      const tokenCount = (
        compactorService as unknown as {
          estimateTokenCount: (rounds: ConversationRound[]) => number;
        }
      ).estimateTokenCount(rounds);
      expect(tokenCount).toBeGreaterThan(0);
      expect(tokenCount).toBeLessThan(50);
    });

    it('should include existing compact context in token estimation', () => {
      const rounds = [createTestRound(1, 'Test', 'Response')];
      const existingCompact = createTestCompactContext();

      const withCompact = (
        compactorService as unknown as {
          estimateTokenCount: (rounds: ConversationRound[], existing?: CompactContext) => number;
        }
      ).estimateTokenCount(rounds, existingCompact);
      const withoutCompact = (
        compactorService as unknown as {
          estimateTokenCount: (rounds: ConversationRound[], existing?: CompactContext) => number;
        }
      ).estimateTokenCount(rounds);

      expect(withCompact).toBeGreaterThan(withoutCompact);
    });
  });

  describe('Compression Input Preparation', () => {
    it('should prepare input without existing compact context', () => {
      const rounds = [
        createTestRound(1, 'First question', 'First answer'),
        createTestRound(2, 'Second question', 'Second answer'),
      ];

      const input = (
        compactorService as unknown as {
          prepareCompressionInput: (
            rounds: ConversationRound[],
            existing?: CompactContext,
          ) => string;
        }
      ).prepareCompressionInput(rounds);

      expect(input).toContain('[CONVERSATION_HISTORY]');
      expect(input).toContain('Round 1:');
      expect(input).toContain('User: First question');
      expect(input).toContain('Assistant: First answer');
      expect(input).toContain('Round 2:');
      expect(input).not.toContain('[PREVIOUS_COMPRESSED_CONTEXT]');
    });

    it('should prepare input with existing compact context', () => {
      const rounds = [createTestRound(1, 'New question', 'New answer')];
      const existingCompact = createTestCompactContext();

      const input = (
        compactorService as unknown as {
          prepareCompressionInput: (
            rounds: ConversationRound[],
            existing?: CompactContext,
          ) => string;
        }
      ).prepareCompressionInput(rounds, existingCompact);

      expect(input).toContain('[PREVIOUS_COMPRESSED_CONTEXT]');
      expect(input).toContain('Previous compressed conversation summary');
      expect(input).toContain('[ADDITIONAL_CONVERSATIONS]');
      expect(input).toContain('User: New question');
    });
  });

  describe('Compression Prompt Generation', () => {
    it('should generate comprehensive compression prompt', () => {
      const input = 'Test conversation input';
      const prompt = (
        compactorService as unknown as { generateCompressionPrompt: (input: string) => string }
      ).generateCompressionPrompt(input);

      expect(prompt).toContain('壓縮成一個簡潔但完整的摘要');
      expect(prompt).toContain('2000 token 以內');
      expect(prompt).toContain('保留關鍵資訊');
      expect(prompt).toContain('維持對話脈絡');
      expect(prompt).toContain('條列式結構');
      expect(prompt).toContain(input);
    });

    it('should use custom target tokens in prompt', () => {
      compactorService.updateConfig({ targetTokens: 1500 });
      const prompt = (
        compactorService as unknown as { generateCompressionPrompt: (input: string) => string }
      ).generateCompressionPrompt('test');

      expect(prompt).toContain('1500 token 以內');

      // Reset config for subsequent tests
      compactorService.updateConfig({ targetTokens: 2000 });
    });

    it('should generate different prompts for existing vs new compression', () => {
      const newCompressionInput = '[CONVERSATION_HISTORY]\nUser: Test\nAssistant: Response';
      const existingCompressionInput =
        '[PREVIOUS_COMPRESSED_CONTEXT]\nPrevious summary\n\n[ADDITIONAL_CONVERSATIONS]\nUser: New question\nAssistant: New answer';

      const newPrompt = (
        compactorService as unknown as { generateCompressionPrompt: (input: string) => string }
      ).generateCompressionPrompt(newCompressionInput);
      const existingPrompt = (
        compactorService as unknown as { generateCompressionPrompt: (input: string) => string }
      ).generateCompressionPrompt(existingCompressionInput);

      // New compression prompt should have first-time instructions
      expect(newPrompt).toContain('這是首次壓縮');
      expect(newPrompt).not.toContain('特別注意');

      // Existing compression prompt should have integration instructions
      expect(existingPrompt).toContain('特別注意');
      expect(existingPrompt).toContain('將兩部分內容整合');
      expect(existingPrompt).toContain('自然銜接');
      expect(existingPrompt).not.toContain('這是首次壓縮');
    });
  });

  describe('Compression Result Validation', () => {
    it('should accept valid compression results', () => {
      const validResults = [
        '用戶詢問關於技術問題，助手提供了詳細解答',
        '討論了多個話題：首先用戶問候，然後詢問天氣，助手都給予了適當回應',
        '助手幫助用戶解決了編程問題，提供了代碼示例和說明',
      ];

      validResults.forEach(result => {
        expect(
          (
            compactorService as unknown as {
              validateCompressionResult: (result: string) => boolean;
            }
          ).validateCompressionResult(result),
        ).toBe(true);
      });
    });

    it('should reject invalid compression results', () => {
      const invalidResults = [
        '', // Empty
        '   ', // Whitespace only
        'Too short', // Too short
        'No keywords whatsoever in this text', // No conversation keywords
      ];

      invalidResults.forEach(result => {
        expect(
          (
            compactorService as unknown as {
              validateCompressionResult: (result: string) => boolean;
            }
          ).validateCompressionResult(result),
        ).toBe(false);
      });
    });
  });

  describe('End-to-End Compression', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    afterEach(() => {
      consoleSpy.mockRestore();
    });

    it('filters compaction input through the advisory relevance hook', async () => {
      vi.mocked(mockManagerStreamChat).mockImplementation(async (params: ChatParams) => {
        expect(params.message).toContain('Keep this round');
        expect(params.message).not.toContain('Drop this round');
        return (async function* () {
          yield { text: '用戶詢問了保留的主題，助手提供了解答。', isComplete: false };
          yield { text: '', isComplete: true };
        })();
      });

      const filterRounds = vi.fn(async (input: { rounds: ConversationRound[] }) => ({
        values: input.rounds.slice(0, 1),
        judgments: [],
        applied: true,
        fallback: false,
        evaluatedCount: input.rounds.length,
        filteredCount: input.rounds.length - 1,
      }));
      const hookCompactor = new ChatCompactorService({}, { filterRounds });
      const rounds = [
        createTestRound(1, 'Keep this round', 'Keep answer'),
        createTestRound(2, 'Drop this round', 'Drop answer'),
      ];

      const result = await hookCompactor.compressConversationHistory(rounds, undefined, {
        topic: 'current topic',
      });

      expect(filterRounds).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: true, topic: 'current topic', rounds }),
      );
      expect(result.success).toBe(true);
      expect(result.relevanceApplied).toBe(true);
      expect(result.filteredRoundCount).toBe(1);
      expect(result.compactContext?.compressedFromRounds).toBe(2);
    });

    it('should successfully compress conversation rounds', async () => {
      // Mock successful LLM response using AsyncIterable
      const responseText =
        '用戶詢問了技術問題，助手提供了詳細的解答和示例代碼。接著討論了最佳實踐和注意事項。';

      vi.mocked(mockManagerStreamChat).mockImplementation(async (_params: ChatParams) =>
        (async function* () {
          yield {
            text: responseText,
            isComplete: false,
          };
          yield {
            text: '',
            isComplete: true,
          };
        })(),
      );

      const rounds = [
        createTestRound(1, 'How to use React hooks?', 'React hooks allow you to use state...'),
        createTestRound(2, 'What about useEffect?', 'useEffect is used for side effects...'),
      ];

      const result = await compactorService.compressConversationHistory(rounds);

      expect(result.success).toBe(true);
      expect(result.compactContext).toBeDefined();
      expect(result.compactContext?.type).toBe('compact');
      expect(result.compactContext?.compressedFromRounds).toBe(2);
      expect(result.compactContext?.compressedFromMessages).toBe(4);
      expect(result.retryCount).toBe(0);
    });

    it('should handle compression with existing compact context', async () => {
      const responseText = '結合之前的討論和新的問題，用戶繼續探索技術主題...';

      vi.mocked(mockManagerStreamChat).mockImplementation(async (_params: ChatParams) =>
        (async function* () {
          yield {
            text: responseText,
            isComplete: false,
          };
          yield {
            text: '',
            isComplete: true,
          };
        })(),
      );

      const rounds = [createTestRound(3, 'Another question', 'Another answer')];
      const existingCompact = createTestCompactContext();

      const result = await compactorService.compressConversationHistory(rounds, existingCompact);

      expect(result.success).toBe(true);
      expect(result.compactContext?.compressedFromRounds).toBe(6); // 1 + 5 from existing
      expect(result.compactContext?.compressedFromMessages).toBe(12); // 2 + 10 from existing
    });

    it('should handle empty rounds', async () => {
      const result = await compactorService.compressConversationHistory([]);

      expect(result.success).toBe(false);
      expect(result.error).toBe('No conversation rounds to compress');
    });

    it('should handle LLM errors with retry', async () => {
      const successResponseText = '用戶詢問了測試問題，助手提供了回應摘要。';
      vi.mocked(mockManagerStreamChat)
        .mockImplementationOnce(async () => {
          throw new Error('Simulated LLM error 1');
        })
        .mockImplementationOnce(async () => {
          const successGen = (async function* () {
            yield { text: successResponseText, isComplete: false };
            yield { text: '', isComplete: true };
          })();
          return successGen;
        });

      const rounds = [createTestRound(1, 'Test', 'Response')];
      const result = await compactorService.compressConversationHistory(rounds);

      expect(result.success).toBe(true);
      expect(result.retryCount).toBe(1);
      expect(result.compactContext).toBeDefined();
      expect(result.compactContext?.content).toContain('用戶詢問了測試問題');
      expect(mockManagerStreamChat).toHaveBeenCalledTimes(2);
    });

    it('should retry when compression result is too long', async () => {
      const longResponse = 'Very long response '.repeat(1000) + '用戶助手討論長內容';
      const shortResponse = '用戶詢問問題，助手提供了解答。';
      vi.mocked(mockManagerStreamChat)
        .mockResolvedValueOnce(
          (async function* () {
            yield { text: longResponse, isComplete: false };
            yield { text: '', isComplete: true };
          })(),
        )
        .mockResolvedValueOnce(
          (async function* () {
            yield { text: shortResponse, isComplete: false };
            yield { text: '', isComplete: true };
          })(),
        );

      const rounds = [createTestRound(1, 'Test', 'Response')];
      const result = await compactorService.compressConversationHistory(rounds);

      expect(mockManagerStreamChat).toHaveBeenCalledTimes(2);
      expect(result.success).toBe(true);
      expect(result.retryCount).toBe(1);
      expect(result.compactContext?.content).toBe(shortResponse);
    });

    it('should fail after max retries', async () => {
      vi.mocked(mockManagerStreamChat).mockImplementation(async () => {
        throw new Error('Persistent LLM error');
      });

      const rounds = [createTestRound(1, 'Test', 'Response')];
      const result = await compactorService.compressConversationHistory(rounds);

      expect(result.success).toBe(false);
      expect(result.retryCount).toBe(2);
      expect(result.error).toContain('Persistent LLM error');
      expect(mockManagerStreamChat).toHaveBeenCalledTimes(2);
    });
  });

  describe('Integration with ProviderManager', () => {
    it('should call ProviderManager.streamChat with correct parameters', async () => {
      const responseText = '用戶詢問助手回答的摘要';

      const mockImplementation = vi.fn(async (params: ChatParams) => {
        expect(params.systemPrompt).toContain('專業的對話摘要助手');
        expect(params.history).toEqual([]);
        expect(params.message).toContain('請將以下對話歷史壓縮');

        return (async function* () {
          yield {
            text: responseText,
            isComplete: false,
          };
          yield {
            text: '',
            isComplete: true,
          };
        })();
      });

      vi.mocked(mockManagerStreamChat).mockImplementation(mockImplementation);

      const rounds = [createTestRound(1, 'Test question', 'Test answer')];
      await compactorService.compressConversationHistory(rounds);

      expect(mockManagerStreamChat).toHaveBeenCalledTimes(1);
    });

    it('should handle no active provider', async () => {
      mockGetActiveProvider.mockReturnValue(null);

      const rounds = [createTestRound(1, 'Test', 'Response')];
      const result = await compactorService.compressConversationHistory(rounds);

      expect(result.success).toBe(false);
      expect(result.retryCount).toBe(2);
      expect(result.error).toContain('No active LLM provider available');
    });
  });
});
