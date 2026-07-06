import { LLMProvider, ProviderConfig, ChatParams, StreamingResponse } from '../llmAdapter';
import { streamOpenAICompatibleChat } from './openAICompatibleToolUtils';

interface OpenRouterModel {
  id: string;
}

export class OpenRouterProvider implements LLMProvider {
  readonly name = 'openrouter';
  readonly displayName = 'OpenRouter';
  readonly supportedModels = [
    'openai/gpt-4o',
    'openai/gpt-4o-mini',
    'anthropic/claude-3.5-sonnet',
    'anthropic/claude-3-haiku',
    'google/gemini-pro',
    'meta-llama/llama-3.1-405b-instruct',
    'mistralai/mistral-7b-instruct',
    'deepseek/deepseek-chat',
  ];
  readonly requiresApiKey = true;
  readonly supportsLocalMode = false;

  private config: ProviderConfig = {};

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;
  }

  isAvailable(): boolean {
    return !!this.config.apiKey;
  }

  reinitialize(): void {
    // Nothing specific needed for reinitializing OpenRouter
  }

  async getAvailableModels(): Promise<string[]> {
    if (!this.config.apiKey) {
      return this.supportedModels;
    }

    try {
      const response = await fetch('https://openrouter.ai/api/v1/models', {
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
        },
      });

      if (!response.ok) {
        console.warn('Failed to fetch OpenRouter models, using default list');
        return this.supportedModels;
      }

      const data = await response.json();
      const models = data.data.map((model: OpenRouterModel) => model.id).sort();

      return models.length > 0 ? models : this.supportedModels;
    } catch (error) {
      console.warn('Error fetching OpenRouter models:', error);
      return this.supportedModels;
    }
  }

  async *streamChat(params: ChatParams): AsyncIterable<StreamingResponse> {
    if (!this.config.apiKey) {
      throw new Error('請先在設定中配置 OpenRouter API KEY 才能使用聊天功能。');
    }

    const model = params.model || this.config.model || 'openai/gpt-4o';

    try {
      yield* streamOpenAICompatibleChat({
        endpoint: 'https://openrouter.ai/api/v1/chat/completions',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
          'HTTP-Referer': window.location.origin,
          'X-Title': 'Gemini Professional Assistant',
        },
        providerName: this.name,
        model,
        params,
        defaultTemperature: (this.config.temperature as number | undefined) || 0.7,
        defaultMaxTokens: (this.config.maxTokens as number | undefined) || 4096,
        defaultMaxToolRounds:
          (params.maxToolRounds ?? (this.config.maxToolRounds as number | undefined)) || 20,
      });
    } catch (error) {
      console.error('OpenRouter streaming error:', error);
      throw new Error(
        `OpenRouter API 錯誤: ${error instanceof Error ? error.message : '未知錯誤'}`,
      );
    }
  }
}
