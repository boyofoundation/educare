import {
  ChatParams,
  LLMProvider,
  ProviderConfig,
  StreamingResponse,
  type ProviderUsageMetadata,
} from '../llmAdapter';
import {
  buildEscalatedToolResult,
  isRecoverableToolErrorResult,
  isStopRouteToolResult,
} from '../htmlProjectToolLoopControl';
import { resolveToolPolicy } from './toolPolicyUtils';

interface AnthropicTextBlock {
  type: 'text';
  text: string;
}

interface AnthropicToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input?: Record<string, unknown>;
}

interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface AnthropicMessageResponse {
  content?: Array<AnthropicTextBlock | AnthropicToolUseBlock>;
  usage?: AnthropicUsage;
  stop_reason?: string | null;
}

interface AnthropicRequestMessage {
  role: 'user' | 'assistant';
  content:
    | string
    | Array<
        | { type: 'text'; text: string }
        | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
        | { type: 'tool_result'; tool_use_id: string; content: string }
      >;
}

interface RepeatedRecoverableErrorEntry {
  toolName: string;
  code: string;
  count: number;
}

const buildRepeatKey = (toolName: string, code: string): string => `${toolName}::${code}`;

const buildAnthropicUsageMetadata = (
  usage: AnthropicUsage | undefined,
): ProviderUsageMetadata | undefined => {
  if (!usage) {
    return undefined;
  }

  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const cacheCreationInputTokens = usage.cache_creation_input_tokens ?? 0;
  const cacheReadInputTokens = usage.cache_read_input_tokens ?? 0;

  return {
    source: 'api',
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens + cacheCreationInputTokens + cacheReadInputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
  };
};

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';
  readonly displayName = 'Anthropic Claude';
  readonly supportedModels = [
    'claude-opus-4-8',
    'claude-opus-4-7',
    'claude-opus-4-6',
    'claude-sonnet-4-6',
    'claude-haiku-4-5',
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
    // Nothing specific needed for reinitializing Anthropic
  }

  private buildFinalSystemPrompt(params: ChatParams): string {
    if (!params.ragContext) {
      return params.systemPrompt;
    }

    const ragPreamble = `Use the information from the following context to inform your response to the user's question. Provide a natural, conversational answer as if the information is part of your general knowledge, without mentioning the context or documents directly. If the answer is not found in the provided information, state that you don't have the relevant information to answer the question. <context> ${params.ragContext} </context>`;
    return `${params.systemPrompt}\n\n${ragPreamble}`;
  }

  private buildMessages(params: ChatParams): AnthropicRequestMessage[] {
    const MAX_HISTORY_MESSAGES = 20;
    const truncatedHistory =
      params.history.length > MAX_HISTORY_MESSAGES
        ? params.history.slice(-MAX_HISTORY_MESSAGES)
        : params.history;

    return [
      ...truncatedHistory.map(message => ({
        role: message.role === 'model' ? ('assistant' as const) : ('user' as const),
        content: message.content,
      })),
      { role: 'user', content: params.message },
    ];
  }

  private buildToolChoice(
    toolChoice: ReturnType<typeof resolveToolPolicy>['toolChoice'],
    forceAuto = false,
  ): Record<string, string> {
    if (forceAuto) {
      return { type: 'auto' };
    }

    switch (toolChoice.mode) {
      case 'none':
        return { type: 'none' };
      case 'requireAny':
        return { type: 'any' };
      case 'requireSpecific':
        return { type: 'tool', name: toolChoice.name };
      case 'auto':
      default:
        return { type: 'auto' };
    }
  }

  private async createMessage(
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<AnthropicMessageResponse> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey || '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`${response.status} ${response.statusText} - ${errorText}`);
    }

    return (await response.json()) as AnthropicMessageResponse;
  }

  private extractText(response: AnthropicMessageResponse): string {
    return (
      response.content
        ?.filter((block): block is AnthropicTextBlock => block.type === 'text')
        .map(block => block.text)
        .join('') || ''
    );
  }

  async *streamChat(params: ChatParams): AsyncIterable<StreamingResponse> {
    if (!this.config.apiKey) {
      throw new Error('請先在設定中配置 Anthropic API KEY 才能使用聊天功能。');
    }

    const model = params.model || this.config.model || 'claude-opus-4-8';
    const finalSystemPrompt = this.buildFinalSystemPrompt(params);
    const { visibleTools, toolChoice } = resolveToolPolicy(params);
    const messages = this.buildMessages(params);

    const requestBody: Record<string, unknown> = {
      model,
      system: finalSystemPrompt,
      messages,
      max_tokens: params.maxTokens || this.config.maxTokens || 4096,
    };

    if (visibleTools?.length) {
      requestBody.tools = visibleTools.map(tool => ({
        name: tool.name,
        description: tool.prompt ? `${tool.description} ${tool.prompt}` : tool.description,
        input_schema: tool.parameters,
      }));
      requestBody.tool_choice = this.buildToolChoice(toolChoice);
    }

    try {
      let response = await this.createMessage(requestBody, params.signal);
      let promptTokenCount = response.usage?.input_tokens || 0;
      let candidatesTokenCount = response.usage?.output_tokens || 0;
      let usage = buildAnthropicUsageMetadata(response.usage);
      const maxToolRounds = Math.max(1, Math.round(Number(this.config.maxToolRounds ?? 20)));
      let toolRoundCount = 0;
      let conversationMessages = [...messages];
      // ⑥ Round-tag array for context eviction (mirrors T1). 0 = initial build
      // messages; 1..N = round in which the message was appended.
      let messageRoundTags: number[] = conversationMessages.map(() => 0);
      const repeatTracker = new Map<string, number>();
      const repeatedRecoverableErrors = new Map<string, RepeatedRecoverableErrorEntry>();

      while (visibleTools?.length && params.executeTool) {
        // ④ AbortSignal (G17): check at loop top so abort never produces a half turn.
        if (params.signal?.aborted) {
          yield {
            text: '',
            isComplete: true,
            metadata: {
              promptTokenCount,
              candidatesTokenCount,
              model,
              provider: this.name,
              usage,
              toolRoundCount,
              repeatedRecoverableErrors: [...repeatedRecoverableErrors.values()],
              finishReason: 'aborted',
            },
          };
          return;
        }

        const toolUseBlocks =
          response.content?.filter(
            (block): block is AnthropicToolUseBlock => block.type === 'tool_use',
          ) || [];

        if (toolUseBlocks.length === 0) {
          break;
        }

        // ⑤ Incremental tool-round content yield: if the assistant turn has
        // text alongside tool_use, surface it before the round blocks on tools.
        const incrementalText =
          response.content
            ?.filter((block): block is AnthropicTextBlock => block.type === 'text')
            .map(block => block.text)
            .join('') || '';
        if (incrementalText) {
          yield {
            text: incrementalText,
            isComplete: false,
            metadata: {
              model,
              provider: this.name,
            },
          };
        }

        // ① Budget exhaustion (G13): no longer throws; yields a final
        // tool-budget-exhausted frame so callers can surface a clean stop.
        if (toolRoundCount >= maxToolRounds) {
          yield {
            text: '',
            isComplete: true,
            metadata: {
              promptTokenCount,
              candidatesTokenCount,
              model,
              provider: this.name,
              usage,
              toolRoundCount,
              repeatedRecoverableErrors: [...repeatedRecoverableErrors.values()],
              finishReason: 'tool-budget-exhausted',
            },
          };
          return;
        }

        const toolResults = [] as Array<{
          type: 'tool_result';
          tool_use_id: string;
          content: string;
        }>;
        const roundRecoverableErrors = new Map<string, RepeatedRecoverableErrorEntry>();
        let stopRoute = false;

        for (const toolUseBlock of toolUseBlocks) {
          const rawResult = await params.executeTool({
            name: toolUseBlock.name,
            args: toolUseBlock.input || {},
          });
          const result = (() => {
            if (!isRecoverableToolErrorResult(rawResult)) {
              return rawResult;
            }

            const repeatKey = buildRepeatKey(toolUseBlock.name, rawResult.code);
            const attempt = (repeatTracker.get(repeatKey) ?? 0) + 1;
            repeatTracker.set(repeatKey, attempt);
            roundRecoverableErrors.set(repeatKey, {
              toolName: toolUseBlock.name,
              code: rawResult.code,
              count: attempt,
            });
            const escalated =
              attempt >= 2
                ? buildEscalatedToolResult(toolUseBlock.name, rawResult, attempt)
                : rawResult;
            if (isStopRouteToolResult(escalated)) {
              stopRoute = true;
            }
            return escalated;
          })();

          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUseBlock.id,
            content: JSON.stringify(result),
          });
        }

        for (const [repeatKey, entry] of roundRecoverableErrors.entries()) {
          repeatedRecoverableErrors.set(repeatKey, entry);
        }

        // ⑥ Context eviction (mirrors T1): once we've crossed 8 completed
        // rounds, before appending the new round's results, evict tool_result
        // content blocks older than 3 rounds whose JSON content exceeds 2KB.
        // Round tags are tracked in the parallel messageRoundTags array
        // (0 = initial buildMessages; N = round in which the message was
        // appended). Never evicts the most recent 3 rounds.
        if (toolRoundCount > 8) {
          const evictRoundTag = toolRoundCount - 3;
          conversationMessages = conversationMessages.map((msg, idx) => {
            if (msg.role !== 'user' || typeof msg.content === 'string') {
              return msg;
            }
            const msgRoundTag = messageRoundTags[idx] ?? 0;
            if (msgRoundTag === 0 || msgRoundTag > evictRoundTag) {
              return msg;
            }
            let mutated = false;
            const newContent = msg.content.map(block => {
              if (block.type === 'tool_result' && (block.content ?? '').length > 2000) {
                mutated = true;
                return {
                  ...block,
                  content: '[evicted prior tool result (>2KB); re-run readFile to inspect]',
                };
              }
              return block;
            });
            return mutated ? { ...msg, content: newContent } : msg;
          });
        }

        const nextRoundTag = toolRoundCount + 1;
        conversationMessages = [
          ...conversationMessages,
          {
            role: 'assistant',
            content: (response.content ?? []).map(block =>
              block.type === 'text'
                ? { type: 'text', text: block.text }
                : {
                    type: 'tool_use',
                    id: block.id,
                    name: block.name,
                    input: block.input || {},
                  },
            ),
          },
          {
            role: 'user',
            content: toolResults,
          },
        ];
        messageRoundTags = [
          ...messageRoundTags,
          nextRoundTag, // assistant message
          nextRoundTag, // user tool_result message
        ];

        response = await this.createMessage(
          {
            model,
            system: finalSystemPrompt,
            messages: conversationMessages,
            max_tokens: params.maxTokens || this.config.maxTokens || 4096,
            tools: visibleTools.map(tool => ({
              name: tool.name,
              description: tool.prompt ? `${tool.description} ${tool.prompt}` : tool.description,
              input_schema: tool.parameters,
            })),
            tool_choice: this.buildToolChoice(toolChoice, true),
          },
          params.signal,
        );

        promptTokenCount += response.usage?.input_tokens || 0;
        candidatesTokenCount += response.usage?.output_tokens || 0;
        usage = buildAnthropicUsageMetadata({
          input_tokens: promptTokenCount,
          output_tokens: candidatesTokenCount,
          cache_creation_input_tokens:
            (usage?.cacheCreationInputTokens ?? 0) +
            (response.usage?.cache_creation_input_tokens ?? 0),
          cache_read_input_tokens:
            (usage?.cacheReadInputTokens ?? 0) + (response.usage?.cache_read_input_tokens ?? 0),
        });
        toolRoundCount += 1;

        if (stopRoute) {
          const stopSummary = [...repeatedRecoverableErrors.values()]
            .map(entry => `${entry.toolName}:${entry.code} x${entry.count}`)
            .join(', ');
          yield {
            text: `Stopped repeated recoverable tool failures and need a different repair path: ${stopSummary}`,
            isComplete: false,
            metadata: {
              model,
              provider: this.name,
            },
          };
          yield {
            text: '',
            isComplete: true,
            metadata: {
              promptTokenCount,
              candidatesTokenCount,
              model,
              provider: this.name,
              usage,
              toolRoundCount,
              repeatedRecoverableErrors: [...repeatedRecoverableErrors.values()],
              finishReason: 'stop-route',
            },
          };
          return;
        }
      }

      const finalText = this.extractText(response);
      if (finalText) {
        yield {
          text: finalText,
          isComplete: false,
          metadata: {
            model,
            provider: this.name,
          },
        };
      }

      yield {
        text: '',
        isComplete: true,
        metadata: {
          promptTokenCount,
          candidatesTokenCount,
          model,
          provider: this.name,
          toolRoundCount,
          repeatedRecoverableErrors: [...repeatedRecoverableErrors.values()],
          finishReason: 'complete',
        },
      };
    } catch (error) {
      console.error('Anthropic streaming error:', error);
      throw new Error(`Anthropic API 錯誤: ${error instanceof Error ? error.message : '未知錯誤'}`);
    }
  }
}
