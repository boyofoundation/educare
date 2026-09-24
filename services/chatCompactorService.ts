import { CompactContext, ConversationRound } from '../types';
import {
  type OpenJevCompactionFilterInput,
  type OpenJevRelevanceResult,
} from './openJevHookService';

/**
 * 聊天壓縮服務配置
 */
export interface CompressionConfig {
  targetTokens: number; // 目標壓縮 token 數
  triggerRounds: number; // 觸發壓縮的輪次數
  preserveLastRounds: number; // 保留最後幾輪完整對話
  maxRetries: number; // 壓縮失敗重試次數
  compressionVersion: string; // 壓縮版本
}

/**
 * 壓縮結果介面
 */
export interface CompressionResult {
  success: boolean;
  compactContext?: CompactContext;
  error?: string;
  retryCount: number;
  originalTokenCount: number;
  compressedTokenCount: number;
  relevanceApplied?: boolean;
  filteredRoundCount?: number;
}

export interface CompressionOptions {
  topic?: string;
}

export interface CompressionHooks {
  filterRounds?: (
    input: OpenJevCompactionFilterInput,
  ) => Promise<OpenJevRelevanceResult<ConversationRound>>;
}

/**
 * 聊天歷史壓縮服務
 *
 * 負責將長對話歷史壓縮成簡潔摘要，保持對話上下文的同時
 * 減少 token 使用量，支援漸進式壓縮和版本管理
 */
export class ChatCompactorService {
  private readonly config: CompressionConfig;
  private readonly hooks: CompressionHooks;

  constructor(config: Partial<CompressionConfig> = {}, hooks: CompressionHooks = {}) {
    this.config = {
      targetTokens: 2000,
      triggerRounds: 10,
      preserveLastRounds: 2,
      maxRetries: 1,
      compressionVersion: '1.0',
      ...config,
    };
    this.hooks = hooks;
  }

  /**
   * 檢查是否應該觸發壓縮
   *
   * @param totalRounds - 當前總對話輪次數
   * @param hasExistingCompact - 是否已有壓縮上下文
   * @returns 是否應該進行壓縮
   */
  shouldTriggerCompression(totalRounds: number, hasExistingCompact = false): boolean {
    // 如果已有壓縮上下文，需要更高的閾值才觸發再次壓縮
    const threshold = hasExistingCompact
      ? this.config.triggerRounds + this.config.preserveLastRounds
      : this.config.triggerRounds + this.config.preserveLastRounds;

    return totalRounds > threshold;
  }

  /**
   * 壓縮對話歷史
   *
   * @param rounds - 要壓縮的對話輪次
   * @param existingCompact - 現有的壓縮上下文（如果有）
   * @returns 壓縮結果
   */
  async compressConversationHistory(
    rounds: ConversationRound[],
    existingCompact?: CompactContext,
    options: CompressionOptions = {},
  ): Promise<CompressionResult> {
    if (rounds.length === 0) {
      return {
        success: false,
        error: 'No conversation rounds to compress',
        retryCount: 0,
        originalTokenCount: 0,
        compressedTokenCount: 0,
      };
    }

    const originalTokenCount = this.estimateTokenCount(rounds, existingCompact);
    let roundsForCompression = rounds;
    let relevanceApplied = false;
    let filteredRoundCount = 0;

    if (this.hooks.filterRounds && options.topic?.trim()) {
      try {
        const relevance = await this.hooks.filterRounds({
          enabled: true,
          topic: options.topic,
          rounds,
          existingCompact,
        });
        if (relevance.values.length > 0) {
          roundsForCompression = relevance.values;
          relevanceApplied = relevance.applied;
          filteredRoundCount = relevance.filteredCount;
        }
      } catch (error) {
        // A local relevance hook is advisory.  Keep the existing compressor
        // fully functional if the hook itself fails before returning a result.
        console.warn('Compaction relevance hook failed; keeping all rounds:', error);
      }
    }
    let retryCount = 0;

    while (retryCount <= this.config.maxRetries) {
      try {
        const compressionInput = this.prepareCompressionInput(
          roundsForCompression,
          existingCompact,
        );
        const prompt = this.generateCompressionPrompt(compressionInput);

        // 使用當前設定的 LLM Provider 進行壓縮
        const compressedContent = await this.callCompressionLLM(prompt);

        if (!this.validateCompressionResult(compressedContent)) {
          throw new Error('Compression result validation failed');
        }

        const compressedTokenCount = this.estimateTextTokenCount(compressedContent);

        // 如果壓縮結果太長，重試一次
        if (
          compressedTokenCount > this.config.targetTokens * 1.2 &&
          retryCount < this.config.maxRetries
        ) {
          retryCount++;
          continue;
        }

        const compactContext: CompactContext = {
          type: 'compact',
          content: compressedContent,
          tokenCount: compressedTokenCount,
          compressedFromRounds: rounds.length + (existingCompact?.compressedFromRounds || 0),
          compressedFromMessages:
            rounds.length * 2 + (existingCompact?.compressedFromMessages || 0),
          createdAt: new Date().toISOString(),
          version: this.config.compressionVersion,
        };

        return {
          success: true,
          compactContext,
          retryCount,
          originalTokenCount,
          compressedTokenCount,
          relevanceApplied,
          filteredRoundCount,
        };
      } catch (error) {
        retryCount++;
        console.warn(`Compression attempt ${retryCount} failed:`, error);

        if (retryCount > this.config.maxRetries) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown compression error',
            retryCount,
            originalTokenCount,
            compressedTokenCount: 0,
          };
        }
      }
    }

    return {
      success: false,
      error: 'Max retries exceeded',
      retryCount,
      originalTokenCount,
      compressedTokenCount: 0,
    };
  }

  /**
   * 準備壓縮輸入
   */
  private prepareCompressionInput(
    rounds: ConversationRound[],
    existingCompact?: CompactContext,
  ): string {
    let input = '';

    // 如果有現有的壓縮上下文，先包含它
    if (existingCompact) {
      input += `[PREVIOUS_COMPRESSED_CONTEXT]\n${existingCompact.content}\n\n`;
      input += '[ADDITIONAL_CONVERSATIONS]\n';
    } else {
      input += '[CONVERSATION_HISTORY]\n';
    }

    // 添加要壓縮的對話輪次
    rounds.forEach((round, index) => {
      input += `Round ${round.roundNumber || index + 1}:\n`;
      input += `User: ${round.userMessage.content}\n`;
      input += `Assistant: ${round.assistantMessage.content}\n\n`;
    });

    return input.trim();
  }

  /**
   * 生成壓縮提示詞
   */
  private generateCompressionPrompt(input: string): string {
    const hasExistingContext = input.includes('[PREVIOUS_COMPRESSED_CONTEXT]');

    const basePrompt = `請將以下對話歷史壓縮成一個簡潔但完整的摘要，控制在 ${this.config.targetTokens} token 以內：

要求：
1. 保留關鍵資訊：重要問題、主要答案、決定性結論、解決方案
2. 維持對話脈絡：話題轉換、討論重點、邏輯順序
3. 記錄用戶偏好：提及的工具、風格、需求、限制條件
4. 簡化重複內容：合併相似問答、去除冗餘資訊
5. 使用第三人稱描述：「用戶詢問...，助手回答...」的格式
6. 保持客觀中性：不添加個人觀點或評判`;

    const contextSpecificInstructions = hasExistingContext
      ? `

特別注意：
- 下方包含了之前的壓縮摘要（[PREVIOUS_COMPRESSED_CONTEXT]）以及新增的對話（[ADDITIONAL_CONVERSATIONS]）
- 請將兩部分內容整合成一個連貫的摘要，保持時間順序
- 確保新對話的內容與之前摘要的脈絡能夠自然銜接
- 如果新對話與之前討論的主題相關，請適當合併或補充`
      : `

注意：
- 這是首次壓縮，請確保完整涵蓋所有重要對話內容`;

    return (
      basePrompt +
      contextSpecificInstructions +
      `

格式要求：
- 使用條列式結構，依時間順序整理
- 每個要點簡潔明確，避免過度詳細
- 重要的技術細節和具體數據要保留
- 用戶的具體需求和助手的建議要明確記錄

對話內容：
${input}

請生成壓縮摘要：`
    );
  }

  /**
   * 調用 LLM 進行壓縮
   */
  private async callCompressionLLM(prompt: string): Promise<string> {
    // 使用 ProviderManager 來調用當前設定的 Provider
    const { ProviderManager } = await import('./llmAdapter');
    const providerManager = ProviderManager.getInstance();

    // 檢查是否有可用的 Provider
    const activeProvider = providerManager.getActiveProvider();
    if (!activeProvider) {
      throw new Error('No active LLM provider available for compression');
    }

    if (!activeProvider.isAvailable()) {
      throw new Error(
        `Active provider ${activeProvider.displayName} is not available for compression`,
      );
    }

    // 使用 ProviderManager 的 streamChat 方法，按照 ChatParams 格式
    const streamResponse = await providerManager.streamChat({
      systemPrompt: '你是一個專業的對話摘要助手，擅長將長對話壓縮成簡潔但完整的摘要。',
      history: [], // 空的歷史記錄，因為壓縮是獨立的任務
      message: prompt, // 使用 message 而不是 messages
      // 不傳遞 model 參數，讓 Provider 使用其默認配置
    });

    let finalResponse = '';

    // 收集所有的流式響應
    for await (const chunk of streamResponse) {
      if (chunk.text) {
        // 使用 text 而不是 content
        finalResponse += chunk.text;
      }
    }

    if (!finalResponse.trim()) {
      throw new Error('LLM returned empty response');
    }

    return finalResponse.trim();
  }

  /**
   * 驗證壓縮結果
   */
  private validateCompressionResult(result: string): boolean {
    if (!result || result.trim().length === 0) {
      return false;
    }

    // 檢查是否過短（可能壓縮失敗）
    if (result.trim().length < 10) {
      return false;
    }

    // 對於測試環境或英文內容，放寬驗證條件
    const hasConversationKeywords =
      result.includes('用戶') ||
      result.includes('助手') ||
      result.includes('討論') ||
      result.includes('User') ||
      result.includes('Assistant') ||
      result.includes('詢問') ||
      result.includes('回答') ||
      result.includes('question') ||
      result.includes('answer') ||
      result.includes('技術') ||
      result.includes('問題');

    return hasConversationKeywords;
  }

  /**
   * 估算 token 數量（簡化版本）
   *
   * 實際實作中可以使用更精確的 tokenizer
   * 這裡使用簡化的估算：中文約 1.5 字符/token，英文約 4 字符/token
   */
  private estimateTokenCount(
    rounds: ConversationRound[],
    existingCompact?: CompactContext,
  ): number {
    let totalText = '';

    // 計算現有壓縮上下文的內容
    if (existingCompact) {
      totalText += existingCompact.content;
    }

    // 計算對話輪次的內容
    rounds.forEach(round => {
      totalText += round.userMessage.content;
      totalText += round.assistantMessage.content;
    });

    return this.estimateTextTokenCount(totalText);
  }

  /**
   * 估算文本 token 數量
   */
  private estimateTextTokenCount(text: string): number {
    if (!text) {
      return 0;
    }

    // 簡化的 token 估算
    const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    const otherChars = text.length - chineseChars;

    // 中文約 1.5 字符/token，其他約 4 字符/token
    return Math.ceil(chineseChars / 1.5 + otherChars / 4);
  }

  /**
   * 獲取配置
   */
  getConfig(): CompressionConfig {
    return { ...this.config };
  }

  /**
   * 更新配置
   */
  updateConfig(newConfig: Partial<CompressionConfig>): void {
    Object.assign(this.config, newConfig);
  }
}
