import { LLMProvider, ProviderConfig, ChatParams, StreamingResponse } from '../llmAdapter';
import { streamOpenAICompatibleChat } from './openAICompatibleToolUtils';

interface OpenAIModel {
  id: string;
}

export class OpenAINativeProvider implements LLMProvider {
  readonly name = 'openai';
  readonly displayName = 'OpenAI';
  readonly supportedModels = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo'];
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
    // Nothing specific needed for reinitializing OpenAI
  }

  async getAvailableModels(): Promise<string[]> {
    if (!this.config.apiKey) {
      return this.supportedModels;
    }

    try {
      const response = await fetch('https://api.openai.com/v1/models', {
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
        },
      });

      if (!response.ok) {
        console.warn('Failed to fetch OpenAI models, using default list');
        return this.supportedModels;
      }

      const data = await response.json();
      const models = data.data
        .filter((model: OpenAIModel) => model.id.startsWith('gpt-'))
        .map((model: OpenAIModel) => model.id)
        .sort();

      return models.length > 0 ? models : this.supportedModels;
    } catch (error) {
      console.warn('Error fetching OpenAI models:', error);
      return this.supportedModels;
    }
  }

  async *streamChat(params: ChatParams): AsyncIterable<StreamingResponse> {
    if (!this.config.apiKey) {
      throw new Error('請先在設定中配置 OpenAI API KEY 才能使用聊天功能。');
    }

    const model = params.model || this.config.model || 'gpt-4o';

    try {
      yield* streamOpenAICompatibleChat({
        endpoint: 'https://api.openai.com/v1/chat/completions',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
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
      console.error('OpenAI streaming error:', error);
      throw new Error(`OpenAI API 錯誤: ${error instanceof Error ? error.message : '未知錯誤'}`);
    }
  }
}
