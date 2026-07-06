import { LLMProvider, ProviderConfig, ChatParams, StreamingResponse } from '../llmAdapter';
import { streamOpenAICompatibleChat } from './openAICompatibleToolUtils';

interface GroqModel {
  id: string;
  active: boolean;
}

export class GroqNativeProvider implements LLMProvider {
  readonly name = 'groq';
  readonly displayName = 'Groq';
  readonly supportedModels = [
    'llama-3.1-70b-versatile',
    'llama-3.1-8b-instant',
    'llama3-70b-8192',
    'llama3-8b-8192',
    'mixtral-8x7b-32768',
    'gemma-7b-it',
    'gemma2-9b-it',
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
    // Nothing specific needed for reinitializing Groq
  }

  async getAvailableModels(): Promise<string[]> {
    if (!this.config.apiKey) {
      return this.supportedModels;
    }

    try {
      const response = await fetch('https://api.groq.com/openai/v1/models', {
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
        },
      });

      if (!response.ok) {
        console.warn('Failed to fetch Groq models, using default list');
        return this.supportedModels;
      }

      const data = await response.json();
      const models = data.data
        .filter((model: GroqModel) => model.active)
        .map((model: GroqModel) => model.id)
        .sort();

      return models.length > 0 ? models : this.supportedModels;
    } catch (error) {
      console.warn('Error fetching Groq models:', error);
      return this.supportedModels;
    }
  }

  async *streamChat(params: ChatParams): AsyncIterable<StreamingResponse> {
    if (!this.config.apiKey) {
      throw new Error('請先在設定中配置 Groq API KEY 才能使用聊天功能。');
    }

    const model = params.model || this.config.model || 'llama-3.1-70b-versatile';

    try {
      yield* streamOpenAICompatibleChat({
        endpoint: 'https://api.groq.com/openai/v1/chat/completions',
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
      console.error('Groq streaming error:', error);
      throw new Error(`Groq API 錯誤: ${error instanceof Error ? error.message : '未知錯誤'}`);
    }
  }
}
