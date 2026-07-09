import {
  LLMProvider,
  ProviderConfig,
  ChatParams,
  StreamingResponse,
  type ProviderUsageMetadata,
} from '../llmAdapter';
import { buildRagPreamble } from './ragContextPreamble';

interface OllamaModel {
  name: string;
}

interface OllamaChatChunk {
  done?: boolean;
  message?: {
    content?: string;
  };
  prompt_eval_count?: number;
  eval_count?: number;
}

export class OllamaNativeProvider implements LLMProvider {
  readonly name = 'ollama';
  readonly displayName = 'Ollama';
  readonly supportedModels = [
    'llama3.2:latest',
    'llama3.1:latest',
    'llama3.2:3b',
    'llama3.1:8b',
    'llama3.1:70b',
    'gemma2:latest',
    'mistral:latest',
    'codellama:latest',
    'qwen2:latest',
    'phi3:latest',
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
    // Nothing specific needed for reinitializing Ollama
  }

  async getAvailableModels(): Promise<string[]> {
    const baseUrl = this.config.baseUrl || 'http://localhost:11434';

    try {
      const response = await fetch(`${baseUrl}/api/tags`);

      if (!response.ok) {
        console.warn('Failed to fetch Ollama models, using default list');
        return this.supportedModels;
      }

      const data = await response.json();
      const models = data.models?.map((model: OllamaModel) => model.name) || [];

      return models.length > 0 ? models : this.supportedModels;
    } catch (error) {
      console.warn('Error fetching Ollama models:', error);
      return this.supportedModels;
    }
  }

  async *streamChat(params: ChatParams): AsyncIterable<StreamingResponse> {
    const baseUrl = this.config.baseUrl || 'http://localhost:11434';

    if (!baseUrl) {
      throw new Error('請先在設定中配置 Ollama 基礎 URL 才能使用聊天功能。');
    }

    const MAX_HISTORY_MESSAGES = 20;
    const truncatedHistory =
      params.history.length > MAX_HISTORY_MESSAGES
        ? params.history.slice(-MAX_HISTORY_MESSAGES)
        : params.history;

    let finalSystemPrompt = params.systemPrompt;
    if (params.ragContext) {
      const ragPreamble = buildRagPreamble(params.ragContext);
      finalSystemPrompt = ragPreamble
        ? `${params.systemPrompt}\n\n${ragPreamble}`
        : params.systemPrompt;
    }

    const model = params.model || this.config.model || 'llama3.2:latest';

    // Build Ollama messages format
    const messages = [
      { role: 'system', content: finalSystemPrompt },
      ...truncatedHistory.map(msg => ({
        role: msg.role === 'model' ? 'assistant' : msg.role,
        content: msg.content,
      })),
      { role: 'user', content: params.message },
    ];

    try {
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages,
          stream: true,
          options: {
            temperature: params.temperature || this.config.temperature || 0.7,
            num_predict: params.maxTokens || this.config.maxTokens || 4096,
          },
        }),
        signal: params.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Ollama API error: ${response.status} ${response.statusText} - ${errorText}`,
        );
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Failed to get response reader');
      }

      const decoder = new TextDecoder();
      let usage: ProviderUsageMetadata | undefined;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n').filter(line => line.trim());

          for (const line of lines) {
            try {
              const parsed = JSON.parse(line) as OllamaChatChunk;

              if (parsed.message?.content) {
                const content = parsed.message.content;

                yield {
                  text: content,
                  isComplete: false,
                  metadata: {
                    model,
                    provider: this.name,
                  },
                };
              }

              if (
                parsed.done &&
                (typeof parsed.prompt_eval_count === 'number' ||
                  typeof parsed.eval_count === 'number')
              ) {
                const inputTokens = parsed.prompt_eval_count ?? 0;
                const outputTokens = parsed.eval_count ?? 0;
                usage = {
                  source: 'api',
                  inputTokens,
                  outputTokens,
                  totalTokens: inputTokens + outputTokens,
                };
              }

              // Check if response is complete
              if (parsed.done) {
                break;
              }
            } catch {
              // Skip invalid JSON lines
              continue;
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      // Final response with metadata
      yield {
        text: '',
        isComplete: true,
        metadata: {
          promptTokenCount: usage?.inputTokens ?? 0,
          candidatesTokenCount: usage?.outputTokens ?? 0,
          model,
          provider: this.name,
          usage: usage ?? { source: 'unavailable' },
        },
      };
    } catch (error) {
      console.error('Ollama streaming error:', error);
      throw new Error(`Ollama API 錯誤: ${error instanceof Error ? error.message : '未知錯誤'}`);
    }
  }
}
