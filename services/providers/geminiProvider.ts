import {
  Chat,
  createPartFromFunctionResponse,
  FunctionCallingConfigMode,
  Modality,
  type FunctionCall,
  type FunctionDeclaration,
  GenerateContentResponse,
  GoogleGenAI,
  type Part,
} from '@google/genai';
import {
  LLMProvider,
  ProviderConfig,
  ChatParams,
  StreamingResponse,
  type ProviderUsageMetadata,
} from '../llmAdapter';
import type { MessageImage } from '../../types';
import { buildRagPreamble } from './ragContextPreamble';
import { ApiKeyManager } from '../apiKeyManager';
import {
  buildEscalatedToolResult,
  isRecoverableToolErrorResult,
  isStopRouteToolResult,
} from '../htmlProjectToolLoopControl';
import { resolveToolPolicy } from './toolPolicyUtils';

interface GeminiListedModel {
  name?: string;
  supportedGenerationMethods?: string[];
}

interface GeminiModelListingClient {
  models?: {
    list?: (options: {
      config: { pageSize: number };
    }) => AsyncIterable<GeminiListedModel> | Promise<AsyncIterable<GeminiListedModel>>;
  };
}

interface RepeatedRecoverableErrorEntry {
  toolName: string;
  code: string;
  count: number;
}

interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  cachedContentTokenCount?: number;
  thoughtsTokenCount?: number;
  toolUsePromptTokenCount?: number;
}

const buildRepeatKey = (toolName: string, code: string): string => `${toolName}::${code}`;

const isGeminiImageGenerationModel = (model: string): boolean =>
  /(?:image-generation|image)/i.test(model);

const buildGeminiUsageMetadata = (
  response: GenerateContentResponse,
): ProviderUsageMetadata | undefined => {
  const usageMetadata = response.usageMetadata as GeminiUsageMetadata | undefined;
  if (!usageMetadata) {
    return undefined;
  }

  return {
    source: 'api',
    inputTokens: usageMetadata.promptTokenCount ?? 0,
    outputTokens: usageMetadata.candidatesTokenCount ?? 0,
    totalTokens:
      usageMetadata.totalTokenCount ??
      (usageMetadata.promptTokenCount ?? 0) + (usageMetadata.candidatesTokenCount ?? 0),
    cachedInputTokens: usageMetadata.cachedContentTokenCount ?? 0,
    reasoningTokens: usageMetadata.thoughtsTokenCount ?? 0,
    toolUseTokens: usageMetadata.toolUsePromptTokenCount ?? 0,
  };
};

const normalizeGeminiSchema = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(normalizeGeminiSchema);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  const schema = value as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(schema)) {
    if (key === 'const') {
      normalized.enum = [child];
    } else if (key === 'oneOf') {
      normalized.anyOf = normalizeGeminiSchema(child);
    } else {
      normalized[key] = normalizeGeminiSchema(child);
    }
  }
  return normalized;
};

export class GeminiProvider implements LLMProvider {
  readonly name = 'gemini';
  readonly displayName = 'Google Gemini';
  readonly supportedModels = [
    'gemini-2.5-flash',
    'gemini-1.5-pro',
    'gemini-1.5-flash',
    'gemini-1.0-pro',
    'gemini-2.5-flash-image',
    'gemini-3.1-flash-image',
    'gemini-3-pro-image-preview',
  ];
  readonly requiresApiKey = true;
  readonly supportsLocalMode = false;

  private ai: GoogleGenAI | null = null;
  private initializationAttempted = false;
  private initializationPromise: Promise<void> | null = null;
  private config: ProviderConfig = {};

  async initialize(config: ProviderConfig): Promise<void> {
    this.config = config;
    this.initializationAttempted = true;

    this.initializationPromise = (async () => {
      const userApiKey = ApiKeyManager.getGeminiApiKey();
      const builtInApiKey =
        typeof process !== 'undefined' && process.env ? process.env.API_KEY : undefined;
      const apiKey = config.apiKey || userApiKey || builtInApiKey;

      if (apiKey) {
        this.ai = new GoogleGenAI({ apiKey });
      } else {
        this.ai = null;
        console.warn('No Gemini API key available. Please configure one in settings.');
      }
    })();

    await this.initializationPromise;
  }

  isAvailable(): boolean {
    if (this.ai) {
      return true;
    }

    if (this.config.apiKey) {
      return true;
    }

    if (ApiKeyManager.hasGeminiApiKey()) {
      return true;
    }

    if (typeof process !== 'undefined' && process.env?.API_KEY) {
      return true;
    }

    return false;
  }

  reinitialize(): void {
    this.ai = null;
    this.initializationAttempted = false;
    this.initializationPromise = null;
    // Don't call initialize here - it will be called by ProviderManager
    // with the correct updated config
  }

  async getAvailableModels(): Promise<string[]> {
    const ai = await this.getAi();

    if (!ai) {
      return this.supportedModels;
    }

    try {
      const modelPager = await (ai as GeminiModelListingClient).models?.list?.({
        config: {
          pageSize: 100,
        },
      });

      if (!modelPager) {
        return this.supportedModels;
      }

      const models: string[] = [];

      for await (const listedModel of modelPager as AsyncIterable<{
        name?: string;
        supportedGenerationMethods?: string[];
      }>) {
        const supportedGenerationMethods = Array.isArray(listedModel?.supportedGenerationMethods)
          ? listedModel.supportedGenerationMethods
          : [];

        if (
          supportedGenerationMethods.length > 0 &&
          !supportedGenerationMethods.includes('generateContent')
        ) {
          continue;
        }

        const normalizedName = listedModel?.name?.replace(/^models\//, '');
        if (!normalizedName) {
          continue;
        }

        models.push(normalizedName);
      }

      const uniqueModels = Array.from(new Set(models)).sort();
      return uniqueModels.length > 0 ? uniqueModels : this.supportedModels;
    } catch (error) {
      console.warn('Error fetching Gemini models:', error);
      return this.supportedModels;
    }
  }

  private async getAi(): Promise<GoogleGenAI | null> {
    if (!this.initializationAttempted) {
      await this.initialize(this.config);
    } else if (this.initializationPromise) {
      await this.initializationPromise;
    }

    return this.ai;
  }

  private buildFinalSystemPrompt(params: ChatParams): string {
    if (!params.ragContext) {
      return params.systemPrompt;
    }

    const ragPreamble = buildRagPreamble(params.ragContext);
    return ragPreamble ? `${params.systemPrompt}\n\n${ragPreamble}` : params.systemPrompt;
  }

  private buildChatConfig(
    params: ChatParams,
    finalSystemPrompt: string,
    forceAutoToolChoice: boolean,
    model: string,
  ) {
    const { visibleTools, toolChoice } = resolveToolPolicy(params);
    const functionDeclarations: FunctionDeclaration[] | undefined = visibleTools?.map(tool => ({
      name: tool.name,
      description: tool.prompt ? `${tool.description} ${tool.prompt}` : tool.description,
      parameters: normalizeGeminiSchema(tool.parameters) as FunctionDeclaration['parameters'],
    }));

    const functionCallingConfig = (() => {
      if (forceAutoToolChoice) {
        return {
          mode: FunctionCallingConfigMode.AUTO,
        };
      }

      switch (toolChoice.mode) {
        case 'none':
          return {
            mode: FunctionCallingConfigMode.NONE,
          };
        case 'requireAny':
          return {
            mode: FunctionCallingConfigMode.ANY,
          };
        case 'requireSpecific':
          return {
            mode: FunctionCallingConfigMode.ANY,
            allowedFunctionNames: [toolChoice.name],
          };
        case 'auto':
        default:
          return {
            mode: FunctionCallingConfigMode.AUTO,
          };
      }
    })();

    return {
      systemInstruction: finalSystemPrompt,
      temperature: (params.temperature as number | undefined) || this.config.temperature || 0.7,
      maxOutputTokens: (params.maxTokens as number | undefined) || this.config.maxTokens || 4096,
      abortSignal: params.signal,
      ...(isGeminiImageGenerationModel(model)
        ? { responseModalities: [Modality.TEXT, Modality.IMAGE] }
        : {}),
      ...(functionDeclarations?.length
        ? {
            tools: [{ functionDeclarations }],
            toolConfig: {
              functionCallingConfig,
            },
          }
        : {}),
    };
  }

  private async createChat(
    params: ChatParams,
    finalSystemPrompt: string,
    model: string,
  ): Promise<Chat> {
    const MAX_HISTORY_MESSAGES = 20;
    const truncatedHistory =
      params.history.length > MAX_HISTORY_MESSAGES
        ? params.history.slice(-MAX_HISTORY_MESSAGES)
        : params.history;

    const ai = await this.getAi();
    if (!ai) {
      throw new Error('請先在設定中配置 Gemini API KEY 才能使用聊天功能。');
    }

    return ai.chats.create({
      model,
      config: this.buildChatConfig(params, finalSystemPrompt, false, model),
      history: truncatedHistory.map(msg => ({
        role: msg.role,
        parts: [
          { text: msg.content },
          ...(msg.attachments ?? [])
            .filter(attachment => attachment.kind === 'image')
            .map(attachment => ({
              inlineData: {
                mimeType: attachment.mimeType,
                data: attachment.data,
              },
            })),
        ],
      })),
    });
  }

  /** 本回合使用者訊息:有圖片附件時組成 multi-part(文字 + inlineData 圖片)。 */
  private buildUserMessage(params: ChatParams): string | Part[] {
    const imageAttachments = (params.attachments ?? []).filter(
      attachment => attachment.kind === 'image',
    );
    if (imageAttachments.length === 0) {
      return params.message;
    }

    return [
      { text: params.message },
      ...imageAttachments.map(attachment => ({
        inlineData: {
          mimeType: attachment.mimeType,
          data: attachment.data,
        },
      })),
    ];
  }

  private getResponseParts(response: GenerateContentResponse): Part[] {
    return response.candidates?.[0]?.content?.parts ?? [];
  }

  private extractVisibleText(response: GenerateContentResponse): string {
    const parts = this.getResponseParts(response);

    if (parts.length > 0) {
      return parts
        .filter(part => typeof part.text === 'string' && !part.thought)
        .map(part => part.text ?? '')
        .join('');
    }

    return response.text ?? '';
  }

  private extractImages(response: GenerateContentResponse): MessageImage[] {
    return this.getResponseParts(response).flatMap((part, index) => {
      const inlineData = part.inlineData;
      if (!inlineData?.data) {
        return [];
      }

      const mimeType = inlineData.mimeType || 'image/png';
      return [
        {
          url: `data:${mimeType};base64,${inlineData.data}`,
          mimeType,
          index,
        },
      ];
    });
  }

  private getFunctionCalls(response: GenerateContentResponse): FunctionCall[] {
    const parts = this.getResponseParts(response);

    if (parts.length > 0) {
      return parts.flatMap(part => (part.functionCall?.name ? [part.functionCall] : []));
    }

    return (response.functionCalls ?? []).filter((functionCall): functionCall is FunctionCall =>
      Boolean(functionCall.name),
    );
  }

  private normalizeToolResult(result: unknown): unknown {
    if (typeof result === 'undefined') {
      return null;
    }

    try {
      return JSON.parse(JSON.stringify(result)) as unknown;
    } catch {
      throw new Error('Gemini tool result could not be serialized.');
    }
  }

  private buildCompletionChunk(
    response: GenerateContentResponse,
    model: string,
    images: MessageImage[],
  ): StreamingResponse {
    return {
      text: '',
      isComplete: true,
      ...(images.length > 0 ? { images } : {}),
      metadata: {
        promptTokenCount: response.usageMetadata?.promptTokenCount ?? 0,
        candidatesTokenCount: response.usageMetadata?.candidatesTokenCount ?? 0,
        model,
        provider: this.name,
        usage: buildGeminiUsageMetadata(response),
      },
    };
  }

  async *streamChat(params: ChatParams): AsyncIterable<StreamingResponse> {
    const genAI = await this.getAi();

    if (!genAI) {
      throw new Error('請先在設定中配置 Gemini API KEY 才能使用聊天功能。');
    }

    if (!this.isAvailable()) {
      throw new Error('請先在設定中配置 Gemini API KEY 才能使用聊天功能。');
    }

    const model = params.model || this.config.model || 'gemini-2.5-flash';
    const finalSystemPrompt = this.buildFinalSystemPrompt(params);
    const MAX_GEMINI_TOOL_ROUNDS = Math.max(
      1,
      Math.round(Number(params.maxToolRounds ?? this.config.maxToolRounds ?? 20)),
    );

    try {
      const chat = await this.createChat(params, finalSystemPrompt, model);

      if (params.tools?.length && params.executeTool) {
        let response = await chat.sendMessage({
          message: this.buildUserMessage(params),
          config: this.buildChatConfig(params, finalSystemPrompt, false, model),
        });
        let toolRoundCount = 0;
        let usage = buildGeminiUsageMetadata(response);
        const repeatTracker = new Map<string, number>();
        const repeatedRecoverableErrors = new Map<string, RepeatedRecoverableErrorEntry>();

        while (true) {
          // ④ AbortSignal (G17): check at loop top so abort never produces a half turn.
          if (params.signal?.aborted) {
            yield {
              text: '',
              isComplete: true,
              metadata: {
                promptTokenCount: usage?.inputTokens ?? 0,
                candidatesTokenCount: usage?.outputTokens ?? 0,
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

          const functionCalls = this.getFunctionCalls(response);

          if (functionCalls.length === 0) {
            const visibleText = this.extractVisibleText(response);
            const images = this.extractImages(response);
            if (!visibleText && images.length === 0) {
              throw new Error(
                'Gemini terminal response had no visible text or actionable tool calls.',
              );
            }

            yield {
              text: visibleText,
              isComplete: false,
              ...(images.length > 0 ? { images } : {}),
              metadata: {
                model,
                provider: this.name,
              },
            };

            const completion = this.buildCompletionChunk(response, model, images);
            completion.metadata = {
              ...completion.metadata,
              promptTokenCount: usage?.inputTokens ?? completion.metadata?.promptTokenCount ?? 0,
              candidatesTokenCount:
                usage?.outputTokens ?? completion.metadata?.candidatesTokenCount ?? 0,
              usage,
              toolRoundCount,
              repeatedRecoverableErrors: [...repeatedRecoverableErrors.values()],
              finishReason: 'complete',
            };
            yield completion;
            return;
          }

          // ⑤ Incremental tool-round content yield: surface any visible text
          // that arrived alongside the function call before the round blocks.
          const incrementalText = this.extractVisibleText(response);
          const incrementalImages = this.extractImages(response);
          if (incrementalText || incrementalImages.length > 0) {
            yield {
              text: incrementalText,
              isComplete: false,
              ...(incrementalImages.length > 0 ? { images: incrementalImages } : {}),
              metadata: {
                model,
                provider: this.name,
              },
            };
          }

          // ① Budget exhaustion (G13): no longer throws; yields a final
          // tool-budget-exhausted frame so callers can surface a clean stop.
          if (toolRoundCount >= MAX_GEMINI_TOOL_ROUNDS) {
            yield {
              text: '',
              isComplete: true,
              metadata: {
                promptTokenCount: usage?.inputTokens ?? 0,
                candidatesTokenCount: usage?.outputTokens ?? 0,
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

          const toolResponses = [];
          const roundRecoverableErrors = new Map<string, RepeatedRecoverableErrorEntry>();
          let stopRoute = false;

          for (const functionCall of functionCalls) {
            const functionName = functionCall.name;
            if (!functionName) {
              continue;
            }

            const rawResult = await params.executeTool({
              name: functionName,
              args:
                functionCall.args && typeof functionCall.args === 'object'
                  ? (functionCall.args as Record<string, unknown>)
                  : {},
            });
            const result = (() => {
              if (!isRecoverableToolErrorResult(rawResult)) {
                return rawResult;
              }

              const repeatKey = buildRepeatKey(functionName, rawResult.code);
              const attempt = (repeatTracker.get(repeatKey) ?? 0) + 1;
              repeatTracker.set(repeatKey, attempt);
              roundRecoverableErrors.set(repeatKey, {
                toolName: functionName,
                code: rawResult.code,
                count: attempt,
              });
              const escalated =
                attempt >= 2
                  ? buildEscalatedToolResult(functionName, rawResult, attempt)
                  : rawResult;
              if (isStopRouteToolResult(escalated)) {
                stopRoute = true;
              }
              return escalated;
            })();

            toolResponses.push(
              createPartFromFunctionResponse(functionCall.id ?? '', functionName, {
                output: this.normalizeToolResult(result),
              }),
            );
          }

          for (const [repeatKey, entry] of roundRecoverableErrors.entries()) {
            repeatedRecoverableErrors.set(repeatKey, entry);
          }
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
                promptTokenCount:
                  usage?.inputTokens ?? response.usageMetadata?.promptTokenCount ?? 0,
                candidatesTokenCount:
                  usage?.outputTokens ?? response.usageMetadata?.candidatesTokenCount ?? 0,
                model,
                provider: this.name,
                usage: usage ?? { source: 'unavailable' },
                toolRoundCount,
                repeatedRecoverableErrors: [...repeatedRecoverableErrors.values()],
                finishReason: 'stop-route',
              },
            };
            return;
          }

          response = await chat.sendMessage({
            message: toolResponses,
            config: this.buildChatConfig(params, finalSystemPrompt, true, model),
          });
          const latestUsage = buildGeminiUsageMetadata(response);
          if (latestUsage?.source === 'api') {
            usage = {
              source: 'api',
              inputTokens: (usage?.inputTokens ?? 0) + (latestUsage.inputTokens ?? 0),
              outputTokens: (usage?.outputTokens ?? 0) + (latestUsage.outputTokens ?? 0),
              totalTokens: (usage?.totalTokens ?? 0) + (latestUsage.totalTokens ?? 0),
              cachedInputTokens:
                (usage?.cachedInputTokens ?? 0) + (latestUsage.cachedInputTokens ?? 0),
              reasoningTokens: (usage?.reasoningTokens ?? 0) + (latestUsage.reasoningTokens ?? 0),
              toolUseTokens: (usage?.toolUseTokens ?? 0) + (latestUsage.toolUseTokens ?? 0),
            };
          }
        }
      }

      const stream = await chat.sendMessageStream({
        message: this.buildUserMessage(params),
        config: this.buildChatConfig(params, finalSystemPrompt, false, model),
      });
      let aggregatedResponse: GenerateContentResponse | null = null;
      const streamedImages: MessageImage[] = [];

      for await (const chunk of stream) {
        const chunkText = this.extractVisibleText(chunk);
        const chunkImages = this.extractImages(chunk);
        if (chunkImages.length > 0) {
          for (const image of chunkImages) {
            if (!streamedImages.some(existing => existing.url === image.url)) {
              streamedImages.push(image);
            }
          }
        }
        if (chunkText || chunkImages.length > 0) {
          yield {
            text: chunkText,
            isComplete: false,
            ...(chunkImages.length > 0 ? { images: chunkImages } : {}),
            metadata: {
              model,
              provider: this.name,
            },
          };
        }
        aggregatedResponse = chunk;
      }

      const completion = this.buildCompletionChunk(
        aggregatedResponse ?? new GenerateContentResponse(),
        model,
        streamedImages,
      );
      completion.metadata = {
        ...completion.metadata,
        toolRoundCount: 0,
        repeatedRecoverableErrors: [],
        finishReason: 'complete',
      };
      yield completion;
    } catch (error) {
      console.error('Gemini streaming error:', error);
      throw error;
    }
  }
}
