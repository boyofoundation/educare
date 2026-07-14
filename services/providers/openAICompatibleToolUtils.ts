import {
  ChatParams,
  StreamingResponse,
  ToolDefinition,
  type ProviderUsageMetadata,
} from '../llmAdapter';
import type { MessageImage } from '../../types';
import { buildRagPreamble } from './ragContextPreamble';
import {
  buildEscalatedToolResult,
  isRecoverableToolErrorResult,
  isStopRouteToolResult,
} from '../htmlProjectToolLoopControl';
import { readSseDataLines } from './sse';
import { resolveToolPolicy } from './toolPolicyUtils';

interface OpenAICompatibleToolCall {
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

interface OpenAICompatibleImage {
  image_url?: { url?: string };
  url?: string;
  mime_type?: string;
  mimeType?: string;
  index?: number;
}

type OpenAICompatibleContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

interface OpenAICompatibleMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | OpenAICompatibleContentPart[] | null;
  tool_calls?: OpenAICompatibleToolCall[];
  tool_call_id?: string;
  images?: OpenAICompatibleImage[];
}

interface OpenAICompatibleResponse {
  choices?: Array<{
    message?: OpenAICompatibleMessage;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_tokens_details?: {
      cached_tokens?: number;
    };
    completion_tokens_details?: {
      reasoning_tokens?: number;
    };
  };
}

interface OpenAICompatibleStreamChunk {
  choices?: Array<{
    delta?: { content?: unknown; images?: unknown[] };
    message?: { images?: unknown[] };
  }>;
  images?: unknown[];
  usage?: OpenAICompatibleResponse['usage'];
}

const buildOpenAICompatibleUsageMetadata = (
  usage:
    | OpenAICompatibleResponse['usage']
    | {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
        prompt_tokens_details?: { cached_tokens?: number };
        completion_tokens_details?: { reasoning_tokens?: number };
      }
    | undefined,
): ProviderUsageMetadata | undefined => {
  if (!usage) {
    return undefined;
  }

  const inputTokens = usage.prompt_tokens ?? 0;
  const outputTokens = usage.completion_tokens ?? 0;
  const cachedInputTokens = usage.prompt_tokens_details?.cached_tokens ?? 0;
  const reasoningTokens = usage.completion_tokens_details?.reasoning_tokens ?? 0;

  return {
    source: 'api',
    inputTokens,
    outputTokens,
    totalTokens: usage.total_tokens ?? inputTokens + outputTokens,
    cachedInputTokens,
    reasoningTokens,
  };
};

const normalizeOpenAICompatibleImages = (value: unknown): MessageImage[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((candidate, index) => {
    if (!candidate || typeof candidate !== 'object') {
      return [];
    }

    const image = candidate as OpenAICompatibleImage;
    const url =
      typeof image.image_url?.url === 'string'
        ? image.image_url.url
        : typeof image.url === 'string'
          ? image.url
          : '';
    if (!url) {
      return [];
    }

    const mimeType =
      typeof image.mime_type === 'string'
        ? image.mime_type
        : typeof image.mimeType === 'string'
          ? image.mimeType
          : undefined;
    const imageIndex = typeof image.index === 'number' ? image.index : index;
    return [{ url, ...(mimeType ? { mimeType } : {}), index: imageIndex }];
  });
};

interface StreamOptions {
  endpoint: string;
  headers: Record<string, string>;
  providerName: string;
  model: string;
  params: ChatParams;
  defaultTemperature?: number;
  defaultMaxTokens?: number;
  defaultMaxToolRounds?: number;
}

interface RepeatedRecoverableErrorEntry {
  toolName: string;
  code: string;
  count: number;
}

const buildRepeatKey = (toolName: string, code: string): string => `${toolName}::${code}`;

interface RecoverableToolErrorResult {
  ok: false;
  recoverable: true;
  code: string;
  message: string;
  guidance: string;
  details?: Record<string, unknown>;
}

interface NormalizedOpenAICompatibleToolCall {
  name: string;
  args: Record<string, unknown>;
  argsError?: RecoverableToolErrorResult;
}

const MAX_RAW_TOOL_ARGS_PREVIEW_LENGTH = 500;

const buildTruncatedRawArgsDetails = (rawArgs: string): Record<string, unknown> => ({
  rawArgsLength: rawArgs.length,
  rawArgsPreview:
    rawArgs.length > MAX_RAW_TOOL_ARGS_PREVIEW_LENGTH
      ? `${rawArgs.slice(0, MAX_RAW_TOOL_ARGS_PREVIEW_LENGTH)}…`
      : rawArgs,
  truncated: rawArgs.length > MAX_RAW_TOOL_ARGS_PREVIEW_LENGTH,
});

const buildFinalSystemPrompt = (params: ChatParams): string => {
  if (!params.ragContext) {
    return params.systemPrompt;
  }

  const ragPreamble = buildRagPreamble(params.ragContext);
  return ragPreamble ? `${params.systemPrompt}\n\n${ragPreamble}` : params.systemPrompt;
};

const buildUserContent = (
  text: string,
  attachments: ChatParams['attachments'],
): string | OpenAICompatibleContentPart[] => {
  const imageParts = (attachments ?? [])
    .filter(attachment => attachment.kind === 'image')
    .map(attachment => ({
      type: 'image_url' as const,
      image_url: { url: `data:${attachment.mimeType};base64,${attachment.data}` },
    }));

  if (imageParts.length === 0) {
    return text;
  }

  return [...(text ? [{ type: 'text' as const, text }] : []), ...imageParts];
};

const buildMessages = (params: ChatParams, systemPrompt: string): OpenAICompatibleMessage[] => {
  const MAX_HISTORY_MESSAGES = 20;
  const truncatedHistory =
    params.history.length > MAX_HISTORY_MESSAGES
      ? params.history.slice(-MAX_HISTORY_MESSAGES)
      : params.history;

  return [
    { role: 'system', content: systemPrompt },
    ...truncatedHistory.map(msg => ({
      role: msg.role === 'model' ? ('assistant' as const) : ('user' as const),
      content: msg.role === 'user' ? buildUserContent(msg.content, msg.attachments) : msg.content,
    })),
    { role: 'user', content: buildUserContent(params.message, params.attachments) },
  ];
};

const buildTools = (tools?: ToolDefinition[]) => {
  if (!tools?.length) {
    return undefined;
  }

  return tools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.prompt ? `${tool.description} ${tool.prompt}` : tool.description,
      parameters: tool.parameters,
    },
  }));
};

const buildToolChoice = (params: ChatParams, tools?: ToolDefinition[]) => {
  if (!tools?.length) {
    return undefined;
  }

  const { toolChoice } = resolveToolPolicy(params);

  switch (toolChoice.mode) {
    case 'none':
      return 'none';
    case 'requireAny':
      return 'required';
    case 'requireSpecific':
      return {
        type: 'function',
        function: {
          name: toolChoice.name,
        },
      };
    case 'auto':
    default:
      return 'auto';
  }
};

const parseToolArgs = (
  rawArgs?: string,
): { args: Record<string, unknown>; error?: RecoverableToolErrorResult } => {
  if (typeof rawArgs === 'undefined') {
    return { args: {} };
  }

  try {
    const parsed = JSON.parse(rawArgs);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { args: parsed as Record<string, unknown> };
    }
  } catch (error) {
    console.warn('Failed to parse tool arguments:', error);
    return {
      args: {},
      error: {
        ok: false,
        recoverable: true,
        code: 'tool-arguments-invalid-json',
        message: 'Tool call arguments must be valid JSON object syntax.',
        guidance:
          'Retry the same tool with a valid JSON object for arguments. Keep payloads smaller if the request is large.',
        details: buildTruncatedRawArgsDetails(rawArgs),
      },
    };
  }

  return {
    args: {},
    error: {
      ok: false,
      recoverable: true,
      code: 'tool-arguments-invalid-shape',
      message: 'Tool call arguments must decode to a JSON object.',
      guidance:
        'Retry the same tool with key/value object arguments instead of an array, string, or null.',
      details: buildTruncatedRawArgsDetails(rawArgs),
    },
  };
};

const normalizeToolCall = (
  toolCall: OpenAICompatibleToolCall,
): NormalizedOpenAICompatibleToolCall | null => {
  const name = toolCall.function?.name;
  if (!name) {
    return null;
  }

  const { args, error } = parseToolArgs(toolCall.function?.arguments);
  return {
    name,
    args,
    argsError: error,
  };
};

const createToolMessage = (toolCallId: string, result: unknown): OpenAICompatibleMessage => ({
  role: 'tool',
  tool_call_id: toolCallId,
  content: JSON.stringify(result),
});

const createRecoverableToolCallError = (
  code: string,
  message: string,
  guidance: string,
  details?: Record<string, unknown>,
): RecoverableToolErrorResult => ({
  ok: false,
  recoverable: true,
  code,
  message,
  guidance,
  details,
});

const buildHistorySafeToolCall = (
  toolCall: OpenAICompatibleToolCall,
  fallbackId: string,
): OpenAICompatibleToolCall => ({
  id: toolCall.id || fallbackId,
  type: toolCall.type || 'function',
  function: {
    name: toolCall.function?.name || '__invalid_tool_call__',
    arguments:
      typeof toolCall.function?.arguments === 'string' ? toolCall.function.arguments : '{}',
  },
});

const executeToolCalls = async (
  toolCalls: OpenAICompatibleToolCall[],
  executeTool: NonNullable<ChatParams['executeTool']>,
  repeatTracker: Map<string, number>,
): Promise<{
  assistantToolCalls: OpenAICompatibleToolCall[];
  toolMessages: OpenAICompatibleMessage[];
  repeatedRecoverableErrors: RepeatedRecoverableErrorEntry[];
  stopRoute: boolean;
}> => {
  const assistantToolCalls: OpenAICompatibleToolCall[] = [];
  const toolMessages: OpenAICompatibleMessage[] = [];
  const repeatedRecoverableErrors = new Map<string, RepeatedRecoverableErrorEntry>();
  let stopRoute = false;

  const recordRecoverableResult = (toolName: string, result: unknown) => {
    if (!isRecoverableToolErrorResult(result)) {
      return result;
    }

    const repeatKey = buildRepeatKey(toolName, result.code);
    const attempt = (repeatTracker.get(repeatKey) ?? 0) + 1;
    repeatTracker.set(repeatKey, attempt);
    const escalated = attempt >= 2 ? buildEscalatedToolResult(toolName, result, attempt) : result;

    repeatedRecoverableErrors.set(repeatKey, {
      toolName,
      code: result.code,
      count: attempt,
    });

    if (isStopRouteToolResult(escalated)) {
      stopRoute = true;
    }

    return escalated;
  };

  for (const [index, toolCall] of toolCalls.entries()) {
    const fallbackId = `invalid-tool-call-${index + 1}`;
    const historySafeToolCall = buildHistorySafeToolCall(toolCall, fallbackId);
    const toolCallId = historySafeToolCall.id as string;
    assistantToolCalls.push(historySafeToolCall);

    if (!toolCall.id) {
      const result = recordRecoverableResult(
        toolCall.function?.name || '__invalid_tool_call__',
        createRecoverableToolCallError(
          'tool-call-missing-id',
          'Tool call is missing a tool_call_id.',
          'Retry the tool call with a valid tool_call_id, function name, and JSON object arguments.',
          {
            toolCallType: toolCall.type ?? null,
            functionName: toolCall.function?.name ?? null,
          },
        ),
      );
      toolMessages.push(createToolMessage(toolCallId, result));
      continue;
    }

    if (!toolCall.function?.name) {
      const result = recordRecoverableResult(
        '__invalid_tool_call__',
        createRecoverableToolCallError(
          'tool-call-missing-name',
          'Tool call is missing a function name.',
          'Retry the tool call with a valid function name and JSON object arguments.',
          {
            toolCallType: toolCall.type ?? null,
          },
        ),
      );
      toolMessages.push(createToolMessage(toolCallId, result));
      continue;
    }

    const normalizedToolCall = normalizeToolCall(toolCall);
    if (!normalizedToolCall) {
      continue;
    }

    if (normalizedToolCall.argsError) {
      toolMessages.push(
        createToolMessage(
          toolCallId,
          recordRecoverableResult(normalizedToolCall.name, normalizedToolCall.argsError),
        ),
      );
      continue;
    }

    const rawResult = await executeTool({
      name: normalizedToolCall.name,
      args: normalizedToolCall.args,
    });
    const result = recordRecoverableResult(normalizedToolCall.name, rawResult);

    toolMessages.push(createToolMessage(toolCallId, result));
  }

  return {
    assistantToolCalls,
    toolMessages,
    repeatedRecoverableErrors: [...repeatedRecoverableErrors.values()],
    stopRoute,
  };
};

const fetchToolCallResponse = async (
  options: StreamOptions,
  messages: OpenAICompatibleMessage[],
  forceAutoToolChoice = false,
) => {
  const {
    endpoint,
    headers,
    model,
    params,
    defaultTemperature = 0.7,
    defaultMaxTokens = 4096,
  } = options;

  const { visibleTools } = resolveToolPolicy(params);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    signal: params.signal,
    body: JSON.stringify({
      model,
      messages,
      tools: buildTools(visibleTools),
      tool_choice: forceAutoToolChoice ? 'auto' : buildToolChoice(params, visibleTools),
      stream: false,
      temperature: params.temperature || defaultTemperature,
      max_tokens: params.maxTokens || defaultMaxTokens,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`${response.status} ${response.statusText} - ${errorText}`);
  }

  return (await response.json()) as OpenAICompatibleResponse;
};

export async function* streamOpenAICompatibleChat(
  options: StreamOptions,
): AsyncIterable<StreamingResponse> {
  const {
    endpoint,
    headers,
    providerName,
    model,
    params,
    defaultTemperature = 0.7,
    defaultMaxTokens = 4096,
    defaultMaxToolRounds = 20,
  } = options;

  const systemPrompt = buildFinalSystemPrompt(params);
  let messages = buildMessages(params, systemPrompt);
  // Parallel round-tag array for context eviction (T1 ④).
  // 0 = initial buildMessages output; 1..N = round in which the message was appended.
  let messageRoundTags: number[] = messages.map(() => 0);
  let promptTokenCount = 0;
  let candidatesTokenCount = 0;
  let usage: ProviderUsageMetadata | undefined;
  const { visibleTools } = resolveToolPolicy(params);
  const MAX_OPENAI_COMPATIBLE_TOOL_ROUNDS = Math.max(
    1,
    Math.round(params.maxToolRounds ?? defaultMaxToolRounds),
  );

  if (visibleTools?.length && params.executeTool) {
    let toolRoundCount = 0;
    const repeatTracker = new Map<string, number>();
    const repeatedRecoverableErrors = new Map<string, RepeatedRecoverableErrorEntry>();

    while (true) {
      // ② AbortSignal (G17): check at loop top so abort never produces a half turn.
      if (params.signal?.aborted) {
        yield {
          text: '',
          isComplete: true,
          metadata: {
            promptTokenCount,
            candidatesTokenCount,
            model,
            provider: providerName,
            usage,
            toolRoundCount,
            repeatedRecoverableErrors: [...repeatedRecoverableErrors.values()],
            finishReason: 'aborted',
          },
        };
        return;
      }

      const toolResponse = await fetchToolCallResponse(options, messages, toolRoundCount > 0);
      const assistantMessage = toolResponse.choices?.[0]?.message;

      promptTokenCount += toolResponse.usage?.prompt_tokens || 0;
      candidatesTokenCount += toolResponse.usage?.completion_tokens || 0;
      const latestUsage = buildOpenAICompatibleUsageMetadata(toolResponse.usage);
      if (latestUsage?.source === 'api') {
        usage = {
          source: 'api',
          inputTokens: (usage?.inputTokens ?? 0) + (latestUsage.inputTokens ?? 0),
          outputTokens: (usage?.outputTokens ?? 0) + (latestUsage.outputTokens ?? 0),
          totalTokens: (usage?.totalTokens ?? 0) + (latestUsage.totalTokens ?? 0),
          cachedInputTokens: (usage?.cachedInputTokens ?? 0) + (latestUsage.cachedInputTokens ?? 0),
          reasoningTokens: (usage?.reasoningTokens ?? 0) + (latestUsage.reasoningTokens ?? 0),
        };
      }

      const assistantImages = normalizeOpenAICompatibleImages(assistantMessage?.images);
      const assistantText =
        typeof assistantMessage?.content === 'string' ? assistantMessage.content : '';

      // Surface assistant content before either returning or blocking on tools.
      if (assistantText) {
        yield {
          text: assistantText,
          isComplete: false,
          metadata: {
            model,
            provider: providerName,
          },
        };
      }
      if (assistantImages.length > 0) {
        yield {
          text: '',
          isComplete: false,
          images: assistantImages,
          metadata: {
            model,
            provider: providerName,
          },
        };
      }

      if (!assistantMessage?.tool_calls?.length) {
        yield {
          text: '',
          isComplete: true,
          metadata: {
            promptTokenCount,
            candidatesTokenCount,
            model,
            provider: providerName,
            usage,
            toolRoundCount,
            repeatedRecoverableErrors: [...repeatedRecoverableErrors.values()],
            finishReason: 'complete',
            ...(assistantImages.length > 0 ? { images: assistantImages } : {}),
          },
        };
        return;
      }

      // ① Budget exhaustion (G13): no longer throws; yields a final
      // tool-budget-exhausted frame so callers can surface a clean stop.
      if (toolRoundCount >= MAX_OPENAI_COMPATIBLE_TOOL_ROUNDS) {
        yield {
          text: '',
          isComplete: true,
          metadata: {
            promptTokenCount,
            candidatesTokenCount,
            model,
            provider: providerName,
            usage,
            toolRoundCount,
            repeatedRecoverableErrors: [...repeatedRecoverableErrors.values()],
            finishReason: 'tool-budget-exhausted',
          },
        };
        return;
      }

      const toolExecution = await executeToolCalls(
        assistantMessage.tool_calls,
        params.executeTool,
        repeatTracker,
      );
      for (const entry of toolExecution.repeatedRecoverableErrors) {
        repeatedRecoverableErrors.set(buildRepeatKey(entry.toolName, entry.code), entry);
      }

      // ④ Context eviction: once we've crossed 8 completed rounds, before
      // appending the new round's results, evict tool-result messages older
      // than 3 rounds whose JSON content exceeds 2KB. Keeps message structure
      // (role:'tool', tool_call_id) intact; results remain re-readable via
      // readFile. Never evicts the most recent 3 rounds.
      if (toolRoundCount > 8) {
        const evictRoundTag = toolRoundCount - 3;
        messages = messages.map((msg, idx) => {
          if (
            msg.role === 'tool' &&
            messageRoundTags[idx] > 0 &&
            messageRoundTags[idx] <= evictRoundTag &&
            (msg.content ?? '').length > 2000
          ) {
            return {
              ...msg,
              content: '[evicted prior tool result (>2KB); re-run readFile to inspect]',
            };
          }
          return msg;
        });
      }

      const nextRoundTag = toolRoundCount + 1;
      messages = [
        ...messages,
        {
          ...assistantMessage,
          tool_calls: toolExecution.assistantToolCalls,
        },
        ...toolExecution.toolMessages,
      ];
      messageRoundTags = [
        ...messageRoundTags,
        nextRoundTag,
        ...toolExecution.toolMessages.map(() => nextRoundTag),
      ];
      toolRoundCount += 1;

      if (toolExecution.stopRoute) {
        const stopSummary = [...repeatedRecoverableErrors.values()]
          .map(entry => `${entry.toolName}:${entry.code} x${entry.count}`)
          .join(', ');
        yield {
          text: `Stopped repeated recoverable tool failures and need a different repair path: ${stopSummary}`,
          isComplete: false,
          metadata: {
            model,
            provider: providerName,
          },
        };
        yield {
          text: '',
          isComplete: true,
          metadata: {
            promptTokenCount,
            candidatesTokenCount,
            model,
            provider: providerName,
            usage,
            toolRoundCount,
            repeatedRecoverableErrors: [...repeatedRecoverableErrors.values()],
            finishReason: 'stop-route',
          },
        };
        return;
      }
    }
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    signal: params.signal,
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      stream_options: {
        include_usage: true,
      },
      temperature: params.temperature || defaultTemperature,
      max_tokens: params.maxTokens || defaultMaxTokens,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`${response.status} ${response.statusText} - ${errorText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Failed to get response reader');
  }

  for await (const data of readSseDataLines(reader)) {
    if (data === '[DONE]') {
      break;
    }

    let parsedValue: unknown;
    try {
      parsedValue = JSON.parse(data);
    } catch (error) {
      console.warn('Failed to parse OpenAI-compatible SSE chunk:', error);
      continue;
    }

    if (!parsedValue || typeof parsedValue !== 'object') {
      console.warn('Ignoring non-object OpenAI-compatible SSE chunk:', parsedValue);
      continue;
    }

    const parsed = parsedValue as OpenAICompatibleStreamChunk;
    const candidate = parsed.choices?.[0];
    const deltaContent = candidate?.delta?.content;
    const images = normalizeOpenAICompatibleImages([
      ...(Array.isArray(candidate?.delta?.images) ? candidate.delta.images : []),
      ...(Array.isArray(candidate?.message?.images) ? candidate.message.images : []),
      ...(Array.isArray(parsed.images) ? parsed.images : []),
    ]);

    if (typeof deltaContent === 'string' || images.length > 0) {
      yield {
        text: typeof deltaContent === 'string' ? deltaContent : '',
        isComplete: false,
        ...(images.length > 0 ? { images } : {}),
        metadata: {
          model,
          provider: providerName,
        },
      };
    }

    if (parsed.usage) {
      promptTokenCount = parsed.usage.prompt_tokens || promptTokenCount;
      candidatesTokenCount = parsed.usage.completion_tokens || candidatesTokenCount;
      usage = buildOpenAICompatibleUsageMetadata(parsed.usage);
    }
  }

  yield {
    text: '',
    isComplete: true,
    metadata: {
      promptTokenCount,
      candidatesTokenCount,
      model,
      provider: providerName,
      usage: usage ?? { source: 'unavailable' },
      toolRoundCount: 0,
      repeatedRecoverableErrors: [],
      finishReason: 'complete',
    },
  };
}
