import { LLMProvider, ProviderConfig, ChatParams, StreamingResponse } from '../llmAdapter';
import { streamOpenAICompatibleChat } from './openAICompatibleToolUtils';

interface LMStudioModel {
  id: string;
}

export class LMStudioProvider implements LLMProvider {
  readonly name = 'lmstudio';
  readonly displayName = 'LM Studio';
  readonly supportedModels = [
    'local-model',
    'llama-2-7b-chat',
    'llama-2-13b-chat',
    'code-llama-7b-instruct',
    'mistral-7b-instruct',
    'phi-2',
  ];
  readonly requiresApiKey = false;
  readonly supportsLocalMode = true;

  private config: ProviderConfig = {};

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;
  }

  isAvailable(): boolean {
    // For local mode, we assume it's available if baseUrl is configured
    return !!this.config.baseUrl;
  }

  reinitialize(): void {
    // Nothing specific needed for reinitializing LMStudio
  }

  async getAvailableModels(): Promise<string[]> {
    const baseUrl = this.config.baseUrl || 'http://localhost:1234/v1';

    try {
      const headers: Record<string, string> = {};
      if (this.config.apiKey) {
        headers.Authorization = `Bearer ${this.config.apiKey}`;
      }

      const response = await fetch(`${baseUrl}/models`, {
        headers,
      });

      if (!response.ok) {
        console.warn('Failed to fetch LM Studio models, using default list');
        return this.supportedModels;
      }

      const data = await response.json();
      const models = data.data?.map((model: LMStudioModel) => model.id) || [];

      return models.length > 0 ? models : this.supportedModels;
    } catch (error) {
      console.warn('Error fetching LM Studio models:', error);
      return this.supportedModels;
    }
  }

  async *streamChat(params: ChatParams): AsyncIterable<StreamingResponse> {
    const baseUrl = this.config.baseUrl || 'http://localhost:1234/v1';

    if (!baseUrl) {
      throw new Error('請先在設定中配置 LM Studio 基礎 URL 才能使用聊天功能。');
    }

    const model = params.model || this.config.model || 'local-model';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    try {
      yield* streamOpenAICompatibleChat({
        endpoint: `${baseUrl}/chat/completions`,
        headers,
        providerName: this.name,
        model,
        params,
        defaultTemperature: (this.config.temperature as number | undefined) || 0.7,
        defaultMaxTokens: (this.config.maxTokens as number | undefined) || 4096,
        defaultMaxToolRounds:
          (params.maxToolRounds ?? (this.config.maxToolRounds as number | undefined)) || 20,
      });
    } catch (error) {
      console.error('LM Studio streaming error:', error);
      throw new Error(`LM Studio API 錯誤: ${error instanceof Error ? error.message : '未知錯誤'}`);
    }
  }
}
