import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FunctionCallingConfigMode } from '@google/genai';
import { GeminiProvider } from './geminiProvider';
import { ApiKeyManager } from '../apiKeyManager';
import { TOOL_LOOP_CONTRACT_CASES } from './toolLoopContract.cases';
import {
  DRAW_GEOMETRY_TOOL_DESCRIPTION,
  DRAW_GEOMETRY_TOOL_NAME,
  DRAW_GEOMETRY_TOOL_SCHEMA,
} from '../geometryToolService';

const TOOL_DEFINITIONS = [
  {
    name: 'render_preview',
    description: 'Render an HTML preview',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
      },
      required: ['projectId'],
      additionalProperties: false,
    },
  },
  {
    name: 'search_docs',
    description: 'Search docs',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
] as const;

type MockResponse = {
  text?: string;
  functionCalls?: Array<{
    id?: string;
    name?: string;
    args?: Record<string, unknown>;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
};

type SetupProviderOptions = {
  sendMessageResponses?: MockResponse[];
  streamChunks?: MockResponse[];
};

type ListedModel = {
  name?: string;
  supportedGenerationMethods?: string[];
};

describe('GeminiProvider', () => {
  const originalProcess = globalThis.process;

  beforeEach(() => {
    vi.restoreAllMocks();
    globalThis.process = {
      env: {},
    } as typeof process;
  });

  afterEach(() => {
    globalThis.process = originalProcess;
    vi.restoreAllMocks();
  });

  const collectResponses = async (
    provider: GeminiProvider,
    params?: Partial<Parameters<GeminiProvider['streamChat']>[0]>,
  ) => {
    const responses = [];

    for await (const chunk of provider.streamChat({
      message: 'Hi',
      history: [],
      systemPrompt: 'You are helpful.',
      model: 'gemini-2.5-flash',
      ...params,
    })) {
      responses.push(chunk);
    }

    return responses;
  };

  const setupProvider = async (provider: GeminiProvider, options: SetupProviderOptions = {}) => {
    vi.spyOn(ApiKeyManager, 'getGeminiApiKey').mockImplementation(
      () => 'AIzaSy123456789012345678901234567890123',
    );
    vi.spyOn(ApiKeyManager, 'hasGeminiApiKey').mockReturnValue(true);

    const streamChunks = options.streamChunks ?? [
      { text: 'hello', usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } },
    ];

    const fakeStream = (async function* () {
      for (const chunk of streamChunks) {
        yield chunk;
      }
    })();

    const sendMessage = vi.fn();
    for (const response of options.sendMessageResponses ?? []) {
      sendMessage.mockResolvedValueOnce(response);
    }

    const sendMessageStream = vi.fn().mockResolvedValue(fakeStream);
    const create = vi.fn().mockReturnValue({
      sendMessage,
      sendMessageStream,
    });

    const chats = { create };

    vi.spyOn(provider, 'initialize').mockImplementation(async config => {
      await Promise.resolve();
      Object.assign(provider as object, {
        config,
        initializationAttempted: true,
        initializationPromise: Promise.resolve(),
        ai: { chats },
      });
    });

    return { create, sendMessage, sendMessageStream };
  };

  const setupModelListing = async (
    provider: GeminiProvider,
    options: {
      listedModels?: ListedModel[];
      listError?: Error;
    } = {},
  ) => {
    vi.spyOn(ApiKeyManager, 'getGeminiApiKey').mockImplementation(
      () => 'AIzaSy123456789012345678901234567890123',
    );
    vi.spyOn(ApiKeyManager, 'hasGeminiApiKey').mockReturnValue(true);

    const list = vi.fn();

    if (options.listError) {
      list.mockRejectedValueOnce(options.listError);
    } else {
      const listedModels = options.listedModels ?? [];
      list.mockResolvedValueOnce(
        (async function* () {
          for (const listedModel of listedModels) {
            yield listedModel;
          }
        })(),
      );
    }

    vi.spyOn(provider, 'initialize').mockImplementation(async config => {
      await Promise.resolve();
      Object.assign(provider as object, {
        config,
        initializationAttempted: true,
        initializationPromise: Promise.resolve(),
        ai: {
          models: { list },
        },
      });
    });

    return { list };
  };

  it('lists available models from the Google GenAI client and normalizes model names', async () => {
    const provider = new GeminiProvider();
    const { list } = await setupModelListing(provider, {
      listedModels: [
        { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
        {
          name: 'gemini-2.5-flash',
          supportedGenerationMethods: ['generateContent', 'countTokens'],
        },
        { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-2.0-flash' },
        { supportedGenerationMethods: ['generateContent'] },
      ],
    });

    const models = await provider.getAvailableModels();

    expect(list).toHaveBeenCalledWith({
      config: {
        pageSize: 100,
      },
    });
    expect(models).toEqual(['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-pro']);
  });

  it('falls back to supportedModels when model listing throws', async () => {
    const provider = new GeminiProvider();
    const warningSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { list } = await setupModelListing(provider, {
      listError: new Error('listing failed'),
    });

    const models = await provider.getAvailableModels();

    expect(list).toHaveBeenCalledTimes(1);
    expect(models).toEqual(provider.supportedModels);
    expect(warningSpy).toHaveBeenCalledWith(
      'Error fetching Gemini models:',
      expect.objectContaining({ message: 'listing failed' }),
    );
  });

  it('falls back to supportedModels when listing yields no usable models', async () => {
    const provider = new GeminiProvider();
    const { list } = await setupModelListing(provider, {
      listedModels: [
        { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
        { name: 'models/code-execution-only', supportedGenerationMethods: ['countTokens'] },
        {},
      ],
    });

    const models = await provider.getAvailableModels();

    expect(list).toHaveBeenCalledTimes(1);
    expect(models).toEqual(provider.supportedModels);
  });

  it('awaits lazy initialization before creating a chat stream', async () => {
    const provider = new GeminiProvider();
    const { create, sendMessageStream } = await setupProvider(provider);

    const responses = await collectResponses(provider);

    expect(create).toHaveBeenCalledTimes(1);
    expect(sendMessageStream).toHaveBeenCalledWith({
      message: 'Hi',
      config: expect.objectContaining({
        systemInstruction: 'You are helpful.',
        temperature: 0.7,
        maxOutputTokens: 4096,
        abortSignal: undefined,
      }),
    });
    expect(responses[0]?.text).toBe('hello');
    expect(responses.at(-1)?.isComplete).toBe(true);
  });

  it('recursively converts JSON Schema const and oneOf into Gemini-compatible enum and anyOf', async () => {
    // Arrange
    const provider = new GeminiProvider();
    const { create } = await setupProvider(provider);
    const parameters = {
      type: 'object',
      properties: {
        object: {
          oneOf: [
            {
              type: 'object',
              properties: {
                kind: { const: 'point' },
                x: { type: 'number' },
                y: { type: 'number' },
              },
              required: ['kind', 'x', 'y'],
            },
            {
              type: 'object',
              properties: { kind: { const: 'line' }, points: { type: 'array' } },
              required: ['kind', 'points'],
            },
          ],
        },
      },
    } as const;

    // Act
    await collectResponses(provider, {
      tools: [{ name: 'geometry_fixture', description: 'Geometry fixture', parameters }],
    });

    // Assert
    const declaration = create.mock.calls[0]?.[0]?.config?.tools?.[0]?.functionDeclarations?.[0];
    expect(declaration?.parameters).toStrictEqual({
      type: 'object',
      properties: {
        object: {
          anyOf: [
            {
              type: 'object',
              properties: {
                kind: { enum: ['point'] },
                x: { type: 'number' },
                y: { type: 'number' },
              },
              required: ['kind', 'x', 'y'],
            },
            {
              type: 'object',
              properties: { kind: { enum: ['line'] }, points: { type: 'array' } },
              required: ['kind', 'points'],
            },
          ],
        },
      },
    });
    expect(JSON.stringify(declaration?.parameters)).not.toContain('"const"');
    expect(JSON.stringify(declaration?.parameters)).not.toContain('"oneOf"');
  });

  it('normalizes draw_geometry schemas for Gemini while retaining each required kind constraint', async () => {
    const provider = new GeminiProvider();
    const { create } = await setupProvider(provider);
    const sourceSchemaJson = JSON.stringify(DRAW_GEOMETRY_TOOL_SCHEMA);

    await collectResponses(provider, {
      tools: [
        {
          name: DRAW_GEOMETRY_TOOL_NAME,
          description: DRAW_GEOMETRY_TOOL_DESCRIPTION,
          parameters: DRAW_GEOMETRY_TOOL_SCHEMA,
        },
      ],
    });

    const declaration = create.mock.calls[0]?.[0]?.config?.tools?.[0]?.functionDeclarations?.[0];
    const variants = declaration?.parameters?.properties?.objects?.items?.anyOf;

    expect(declaration).toMatchObject({
      name: DRAW_GEOMETRY_TOOL_NAME,
      parameters: {
        properties: {
          objects: {
            items: {
              anyOf: expect.any(Array),
            },
          },
        },
      },
    });
    expect(JSON.stringify(declaration?.parameters)).not.toContain('"const"');
    expect(JSON.stringify(declaration?.parameters)).not.toContain('"oneOf"');
    expect(variants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          properties: expect.objectContaining({ kind: { enum: ['point'] } }),
          required: expect.arrayContaining(['kind']),
        }),
        expect.objectContaining({
          properties: expect.objectContaining({ kind: { enum: ['line'] } }),
          required: expect.arrayContaining(['kind']),
        }),
      ]),
    );
    expect(variants).toHaveLength(15);
    expect(
      variants.every((variant: { required?: string[] }) => variant.required?.includes('kind')),
    ).toBe(true);
    expect(
      variants.every((variant: { properties?: object; required?: string[] }) =>
        variant.required?.every(required =>
          Object.prototype.hasOwnProperty.call(variant.properties ?? {}, required),
        ),
      ),
    ).toBe(true);
    expect(JSON.stringify(DRAW_GEOMETRY_TOOL_SCHEMA)).toBe(sourceSchemaJson);
    expect(DRAW_GEOMETRY_TOOL_SCHEMA.properties.objects.items).toHaveProperty('oneOf');
    expect(DRAW_GEOMETRY_TOOL_SCHEMA.properties.objects.items).not.toHaveProperty('anyOf');
  });

  it('keeps AUTO mode without allowedFunctionNames by default', async () => {
    const provider = new GeminiProvider();
    const { create } = await setupProvider(provider);

    await collectResponses(provider, {
      tools: [...TOOL_DEFINITIONS],
    });

    const createConfig = create.mock.calls[0]?.[0]?.config;
    expect(createConfig.tools[0].functionDeclarations).toEqual([
      expect.objectContaining({
        name: 'render_preview',
        parameters: TOOL_DEFINITIONS[0].parameters,
      }),
      expect.objectContaining({
        name: 'search_docs',
        parameters: TOOL_DEFINITIONS[1].parameters,
      }),
    ]);
    expect(createConfig.tools[0].functionDeclarations[0]?.parametersJsonSchema).toBeUndefined();
    expect(createConfig.toolConfig.functionCallingConfig.mode).toBe(FunctionCallingConfigMode.AUTO);
    expect(createConfig.toolConfig.functionCallingConfig.allowedFunctionNames).toBeUndefined();
  });

  it('prunes visible tools while preserving AUTO mode', async () => {
    const provider = new GeminiProvider();
    const { create } = await setupProvider(provider);

    await collectResponses(provider, {
      tools: [...TOOL_DEFINITIONS],
      allowedToolNames: ['render_preview'],
    });

    const createConfig = create.mock.calls[0]?.[0]?.config;
    expect(createConfig.tools[0].functionDeclarations).toHaveLength(1);
    expect(createConfig.tools[0].functionDeclarations[0]).toEqual(
      expect.objectContaining({
        name: 'render_preview',
        parameters: TOOL_DEFINITIONS[0].parameters,
      }),
    );
    expect(createConfig.tools[0].functionDeclarations[0]?.parametersJsonSchema).toBeUndefined();
    expect(createConfig.toolConfig.functionCallingConfig.mode).toBe(FunctionCallingConfigMode.AUTO);
    expect(createConfig.toolConfig.functionCallingConfig.allowedFunctionNames).toBeUndefined();
  });

  it('uses ANY plus allowedFunctionNames only for requireSpecific', async () => {
    const provider = new GeminiProvider();
    const { create } = await setupProvider(provider);

    await collectResponses(provider, {
      tools: [...TOOL_DEFINITIONS],
      toolChoice: { mode: 'requireSpecific', name: 'render_preview' },
    });

    const createConfig = create.mock.calls[0]?.[0]?.config;
    expect(createConfig.tools[0].functionDeclarations[0]).toEqual(
      expect.objectContaining({
        name: 'render_preview',
        parameters: TOOL_DEFINITIONS[0].parameters,
      }),
    );
    expect(createConfig.toolConfig.functionCallingConfig).toEqual({
      mode: FunctionCallingConfigMode.ANY,
      allowedFunctionNames: ['render_preview'],
    });
  });

  it('downgrades forced tool choice to AUTO after the first tool round', async () => {
    const provider = new GeminiProvider();
    const { create, sendMessage } = await setupProvider(provider, {
      sendMessageResponses: [
        {
          functionCalls: [
            { id: 'call-1', name: 'render_preview', args: { projectId: 'project-1' } },
          ],
        },
        {
          text: 'Preview ready',
          functionCalls: [],
          usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 8 },
        },
      ],
    });

    const executeTool = vi.fn().mockResolvedValue({ ok: true });

    await collectResponses(provider, {
      tools: [...TOOL_DEFINITIONS],
      toolChoice: { mode: 'requireSpecific', name: 'render_preview' },
      executeTool,
    });

    const createConfig = create.mock.calls[0]?.[0]?.config;
    expect(createConfig.toolConfig.functionCallingConfig).toEqual({
      mode: FunctionCallingConfigMode.ANY,
      allowedFunctionNames: ['render_preview'],
    });

    const followupConfig = sendMessage.mock.calls[1]?.[0]?.config;
    expect(followupConfig.toolConfig.functionCallingConfig).toEqual({
      mode: FunctionCallingConfigMode.AUTO,
    });
    expect(followupConfig.abortSignal).toBeUndefined();
  });

  it('streams a text-only response even when tools are available', async () => {
    const provider = new GeminiProvider();
    const { sendMessage, sendMessageStream } = await setupProvider(provider, {
      sendMessageResponses: [
        {
          text: 'Tool-capable hello',
          functionCalls: [],
          usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 3 },
        },
      ],
    });

    const executeTool = vi.fn();
    const responses = await collectResponses(provider, {
      tools: [...TOOL_DEFINITIONS],
      executeTool,
    });

    expect(sendMessage).toHaveBeenCalledWith({
      message: 'Hi',
      config: expect.objectContaining({
        systemInstruction: 'You are helpful.',
        temperature: 0.7,
        maxOutputTokens: 4096,
        abortSignal: undefined,
        toolConfig: {
          functionCallingConfig: {
            mode: FunctionCallingConfigMode.AUTO,
          },
        },
      }),
    });
    expect(sendMessageStream).not.toHaveBeenCalled();
    expect(executeTool).not.toHaveBeenCalled();
    expect(responses).toEqual([
      expect.objectContaining({ text: 'Tool-capable hello', isComplete: false }),
      expect.objectContaining({
        text: '',
        isComplete: true,
        metadata: expect.objectContaining({ promptTokenCount: 2, candidatesTokenCount: 3 }),
      }),
    ]);
  });

  it('continues from one function call to a final text response without switching to streaming', async () => {
    const provider = new GeminiProvider();
    const { sendMessage, sendMessageStream } = await setupProvider(provider, {
      sendMessageResponses: [
        {
          functionCalls: [
            { id: 'call-1', name: 'render_preview', args: { projectId: 'project-1' } },
          ],
        },
        {
          text: 'Preview ready',
          functionCalls: [],
          usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 8 },
        },
      ],
    });

    const executeTool = vi.fn().mockResolvedValue({ ok: true });
    const responses = await collectResponses(provider, {
      tools: [...TOOL_DEFINITIONS],
      executeTool,
    });

    expect(executeTool).toHaveBeenCalledWith({
      name: 'render_preview',
      args: { projectId: 'project-1' },
    });
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage.mock.calls[1]?.[0]).toMatchObject({
      message: [
        expect.objectContaining({
          functionResponse: expect.objectContaining({ name: 'render_preview' }),
        }),
      ],
    });
    expect(sendMessageStream).not.toHaveBeenCalled();
    expect(responses).toEqual([
      expect.objectContaining({ text: 'Preview ready', isComplete: false }),
      expect.objectContaining({ isComplete: true }),
    ]);
  });

  it('supports multiple tool rounds before yielding final text', async () => {
    const provider = new GeminiProvider();
    await setupProvider(provider, {
      sendMessageResponses: [
        {
          functionCalls: [{ id: 'call-1', name: 'search_docs', args: { query: 'pricing' } }],
        },
        {
          functionCalls: [
            { id: 'call-2', name: 'render_preview', args: { projectId: 'project-2' } },
          ],
        },
        {
          text: 'Done after two rounds',
          functionCalls: [],
          usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 11 },
        },
      ],
    });

    const executeTool = vi
      .fn()
      .mockResolvedValueOnce({ results: ['pricing doc'] })
      .mockResolvedValueOnce({ previewUrl: 'blob:project-2' });

    const responses = await collectResponses(provider, {
      tools: [...TOOL_DEFINITIONS],
      executeTool,
    });

    expect(executeTool).toHaveBeenNthCalledWith(1, {
      name: 'search_docs',
      args: { query: 'pricing' },
    });
    expect(executeTool).toHaveBeenNthCalledWith(2, {
      name: 'render_preview',
      args: { projectId: 'project-2' },
    });
    expect(responses).toEqual([
      expect.objectContaining({ text: 'Done after two rounds', isComplete: false }),
      expect.objectContaining({ isComplete: true }),
    ]);
  });

  it('serializes recoverable tool error payloads into function responses and continues to final text', async () => {
    const provider = new GeminiProvider();
    const { sendMessage, sendMessageStream } = await setupProvider(provider, {
      sendMessageResponses: [
        {
          functionCalls: [{ id: 'call-1', name: 'search_docs', args: { query: 'financial aid' } }],
        },
        {
          text: 'Recovered after tool error',
          functionCalls: [],
          usageMetadata: { promptTokenCount: 6, candidatesTokenCount: 9 },
        },
      ],
    });

    const recoverableError = {
      ok: false,
      recoverable: true,
      code: 'search-temporary-unavailable',
      message: 'Search index is warming up.',
      guidance: 'Retry the same search in a moment.',
      details: { retryAfterMs: 500 },
    };
    const executeTool = vi.fn().mockResolvedValue(recoverableError);

    const responses = await collectResponses(provider, {
      tools: [...TOOL_DEFINITIONS],
      executeTool,
    });

    expect(executeTool).toHaveBeenCalledWith({
      name: 'search_docs',
      args: { query: 'financial aid' },
    });
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage.mock.calls[1]?.[0]).toMatchObject({
      message: [
        {
          functionResponse: {
            id: 'call-1',
            name: 'search_docs',
            response: {
              output: recoverableError,
            },
          },
        },
      ],
    });
    expect(sendMessageStream).not.toHaveBeenCalled();
    expect(responses).toEqual([
      expect.objectContaining({ text: 'Recovered after tool error', isComplete: false }),
      expect.objectContaining({ isComplete: true }),
    ]);
  });

  it('executes multiple function calls returned in the same turn before final text', async () => {
    const provider = new GeminiProvider();
    const { sendMessage } = await setupProvider(provider, {
      sendMessageResponses: [
        {
          functionCalls: [
            { id: 'call-1', name: 'search_docs', args: { query: 'safety' } },
            { id: 'call-2', name: 'render_preview', args: { projectId: 'project-3' } },
          ],
        },
        {
          text: 'Both tools complete',
          functionCalls: [],
          usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 12 },
        },
      ],
    });

    const executeTool = vi
      .fn()
      .mockResolvedValueOnce({ documents: 2 })
      .mockResolvedValueOnce({ previewReady: true });

    const responses = await collectResponses(provider, {
      tools: [...TOOL_DEFINITIONS],
      executeTool,
    });

    expect(executeTool).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage.mock.calls[1]?.[0]).toMatchObject({
      message: [
        expect.objectContaining({
          functionResponse: expect.objectContaining({ name: 'search_docs' }),
        }),
        expect.objectContaining({
          functionResponse: expect.objectContaining({ name: 'render_preview' }),
        }),
      ],
    });
    expect(responses).toEqual([
      expect.objectContaining({ text: 'Both tools complete', isComplete: false }),
      expect.objectContaining({ isComplete: true }),
    ]);
  });

  it('stops after repeated recoverable tool errors and reports matching completion metadata', async () => {
    const provider = new GeminiProvider();
    const { sendMessage, sendMessageStream } = await setupProvider(provider, {
      sendMessageResponses: [
        {
          functionCalls: [{ id: 'call-1', name: 'search_docs', args: { query: 'financial aid' } }],
          usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1 },
        },
        {
          functionCalls: [{ id: 'call-2', name: 'search_docs', args: { query: 'financial aid' } }],
          usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 1 },
        },
        {
          functionCalls: [{ id: 'call-3', name: 'search_docs', args: { query: 'financial aid' } }],
          usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 1 },
        },
        {
          text: 'unused stop-route response',
          functionCalls: [],
          usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 1 },
        },
      ],
    });

    const recoverableError = {
      ok: false,
      recoverable: true,
      code: 'search-temporary-unavailable',
      message: 'Search index is warming up.',
      guidance: 'Retry the same search in a moment.',
      details: { retryAfterMs: 500 },
    };
    const executeTool = vi.fn().mockResolvedValue(recoverableError);

    const responses = await collectResponses(provider, {
      tools: [...TOOL_DEFINITIONS],
      executeTool,
    });

    expect(executeTool).toHaveBeenCalledTimes(3);
    expect(sendMessage).toHaveBeenCalledTimes(3);
    expect(sendMessageStream).not.toHaveBeenCalled();
    expect(responses).toEqual([
      {
        text: 'Stopped repeated recoverable tool failures and need a different repair path: search_docs:search-temporary-unavailable x3',
        isComplete: false,
        metadata: {
          model: 'gemini-2.5-flash',
          provider: 'gemini',
        },
      },
      {
        text: '',
        isComplete: true,
        metadata: {
          promptTokenCount: 9,
          candidatesTokenCount: 3,
          model: 'gemini-2.5-flash',
          provider: 'gemini',
          usage: {
            source: 'api',
            inputTokens: 9,
            outputTokens: 3,
            totalTokens: 12,
            cachedInputTokens: 0,
            reasoningTokens: 0,
            toolUseTokens: 0,
          },
          toolRoundCount: 3,
          repeatedRecoverableErrors: [
            {
              toolName: 'search_docs',
              code: 'search-temporary-unavailable',
              count: 3,
            },
          ],
          finishReason: 'stop-route',
        },
      },
    ]);
  });

  it('surfaces tool execution failures without attempting a follow-up stream', async () => {
    const provider = new GeminiProvider();
    const { sendMessageStream } = await setupProvider(provider, {
      sendMessageResponses: [
        {
          functionCalls: [{ id: 'call-1', name: 'search_docs', args: { query: 'broken' } }],
        },
      ],
    });

    const executeTool = vi.fn().mockRejectedValue(new Error('Tool exploded'));

    await expect(
      collectResponses(provider, {
        tools: [...TOOL_DEFINITIONS],
        executeTool,
      }),
    ).rejects.toThrow('Tool exploded');

    expect(sendMessageStream).not.toHaveBeenCalled();
  });

  it('throws when a tool result cannot be serialized for Gemini', async () => {
    const provider = new GeminiProvider();
    await setupProvider(provider, {
      sendMessageResponses: [
        {
          functionCalls: [{ id: 'call-1', name: 'search_docs', args: { query: 'broken' } }],
        },
      ],
    });

    const circularResult: { self?: unknown } = {};
    circularResult.self = circularResult;

    const executeTool = vi.fn().mockResolvedValue(circularResult);

    await expect(
      collectResponses(provider, {
        tools: [...TOOL_DEFINITIONS],
        executeTool,
      }),
    ).rejects.toThrow('Gemini tool result could not be serialized.');
  });

  it('yields finishReason=tool-budget-exhausted instead of throwing when the round budget is exceeded', async () => {
    const provider = new GeminiProvider();
    await setupProvider(provider, {
      sendMessageResponses: Array.from({ length: 22 }, (_, index) => ({
        functionCalls: [
          {
            id: `call-${index + 1}`,
            name: 'search_docs',
            args: { query: `round-${index + 1}` },
          },
        ],
      })),
    });

    const executeTool = vi.fn().mockResolvedValue({ ok: true });

    const responses = await collectResponses(provider, {
      tools: [...TOOL_DEFINITIONS],
      executeTool,
    });

    // G13: budget exhaustion must NOT throw; it yields a final frame with
    // finishReason='tool-budget-exhausted'.
    const final = responses.at(-1);
    expect(final).toMatchObject({ text: '', isComplete: true });
    expect(final?.metadata?.finishReason).toBe('tool-budget-exhausted');
    expect(final?.metadata?.toolRoundCount).toBe(20);
  });

  it('forwards params.signal via sendMessage config and yields finishReason=aborted on abort', async () => {
    const provider = new GeminiProvider();
    const { sendMessage } = await setupProvider(provider, {
      sendMessageResponses: [
        {
          functionCalls: [{ id: 'call-1', name: 'search_docs', args: { query: 'q' } }],
        },
        {
          functionCalls: [{ id: 'call-2', name: 'search_docs', args: { query: 'q' } }],
        },
      ],
    });

    const controller = new AbortController();
    const executeTool = vi.fn().mockImplementation(async () => {
      // Abort mid-round (after the first tool execution); the next loop-top
      // check must observe signal.aborted and terminate with finishReason=aborted.
      controller.abort();
      return { matches: ['doc-1'] };
    });

    const responses = await collectResponses(provider, {
      tools: [...TOOL_DEFINITIONS],
      executeTool,
      signal: controller.signal,
    });

    // G17: abortSignal forwarded via sendMessage config.
    expect(sendMessage.mock.calls[0]?.[0]?.config?.abortSignal).toBe(controller.signal);
    expect(sendMessage.mock.calls[1]?.[0]?.config?.abortSignal).toBe(controller.signal);

    const final = responses.at(-1);
    expect(final?.metadata?.finishReason).toBe('aborted');
    expect(executeTool).toHaveBeenCalledTimes(1);
  });

  it('yields finishReason=aborted without executing tools when the signal is pre-aborted', async () => {
    const provider = new GeminiProvider();
    await setupProvider(provider, {
      sendMessageResponses: [
        {
          functionCalls: [{ id: 'call-1', name: 'search_docs', args: { query: 'q' } }],
        },
      ],
    });

    const controller = new AbortController();
    controller.abort();

    const executeTool = vi.fn();

    const responses = await collectResponses(provider, {
      tools: [...TOOL_DEFINITIONS],
      executeTool,
      signal: controller.signal,
    });

    expect(executeTool).not.toHaveBeenCalled();
    expect(responses.at(-1)?.metadata?.finishReason).toBe('aborted');
  });

  it('yields incremental text content alongside function calls before continuing the loop', async () => {
    const provider = new GeminiProvider();
    await setupProvider(provider, {
      sendMessageResponses: [
        {
          text: 'Let me search for that.',
          functionCalls: [{ id: 'call-1', name: 'search_docs', args: { query: 'q' } }],
        },
        {
          text: 'Done',
          functionCalls: [],
          usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 8 },
        },
      ],
    });

    const executeTool = vi.fn().mockResolvedValue({ results: ['doc-1'] });

    const responses = await collectResponses(provider, {
      tools: [...TOOL_DEFINITIONS],
      executeTool,
    });

    // ⑤ First yielded chunk is the incremental text surfaced during the tool round.
    expect(responses[0]).toMatchObject({
      text: 'Let me search for that.',
      isComplete: false,
    });
    expect(responses[1]).toMatchObject({ text: 'Done', isComplete: false });
    expect(responses.at(-1)?.metadata?.finishReason).toBe('complete');
  });

  it('throws for a non-text terminal response with no actionable tool calls', async () => {
    const provider = new GeminiProvider();
    await setupProvider(provider, {
      sendMessageResponses: [
        {
          functionCalls: [],
          usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 6 },
        },
      ],
    });

    await expect(
      collectResponses(provider, {
        tools: [...TOOL_DEFINITIONS],
        executeTool: vi.fn(),
      }),
    ).rejects.toThrow(/non-text|no text|terminal/i);
  });

  it('preserves no-tools streaming behavior across multiple chunks', async () => {
    const provider = new GeminiProvider();
    await setupProvider(provider, {
      streamChunks: [
        { text: 'Hello ', usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 0 } },
        { text: 'world', usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 5 } },
      ],
    });

    const responses = await collectResponses(provider);

    expect(responses).toEqual([
      expect.objectContaining({ text: 'Hello ', isComplete: false }),
      expect.objectContaining({ text: 'world', isComplete: false }),
      expect.objectContaining({
        text: '',
        isComplete: true,
        metadata: expect.objectContaining({ promptTokenCount: 3, candidatesTokenCount: 5 }),
      }),
    ]);
  });

  describe('tool-loop contract cases (shared)', () => {
    const sharedParams = {
      systemPrompt: 'You are helpful.',
      history: [],
      message: 'hello',
      tools: [...TOOL_DEFINITIONS],
    };

    it.each(TOOL_LOOP_CONTRACT_CASES)(
      '$id yields finishReason=$expectedFinishReason',
      async testCase => {
        const provider = new GeminiProvider();

        // Adapter: each contract case is mapped to Gemini-shaped mock
        // responses (functionCalls + text) using the case id as discriminator.
        const toolCallResponse = (id: string, name: string, args: Record<string, unknown>) => ({
          functionCalls: [{ id, name, args }],
        });
        const textResponse = (text: string) => ({ text, functionCalls: [] });

        let sendMessageResponses: MockResponse[] = [];
        let executeToolValue: unknown = { ok: true };
        let providerParams: Record<string, unknown> = {};

        switch (testCase.id) {
          case 'budget-exhausted-no-throw':
            // Provider default maxToolRounds is 20; flood past it.
            sendMessageResponses = Array.from({ length: 22 }, () =>
              toolCallResponse('loop-call', 'search_docs', { query: 'loop' }),
            );
            break;
          case 'per-call-max-tool-rounds-override':
            sendMessageResponses = Array.from({ length: 4 }, () =>
              toolCallResponse('loop-call', 'search_docs', { query: 'override' }),
            );
            providerParams = { maxToolRounds: testCase.chatParamsOverride?.maxToolRounds };
            break;
          case 'provider-default-max-tool-rounds':
            sendMessageResponses = Array.from({ length: 22 }, () =>
              toolCallResponse('loop-call', 'search_docs', { query: 'default-budget' }),
            );
            break;
          case 'pure-text-complete':
            sendMessageResponses = [textResponse('done')];
            break;
          case 'stop-route':
            sendMessageResponses = Array.from({ length: 6 }, (_, idx) =>
              toolCallResponse(`call-${idx + 1}`, 'search_docs', { query: 'q' }),
            );
            executeToolValue = {
              ok: false,
              recoverable: true,
              code: 'search-temporary-unavailable',
              message: 'Search index is warming up.',
              guidance: 'Retry the same search in a moment.',
            };
            break;
          default:
            throw new Error(`Unhandled contract case: ${testCase.id}`);
        }

        const { sendMessage } = await setupProvider(provider, { sendMessageResponses });

        const executeTool = vi.fn().mockResolvedValue(executeToolValue);

        const responses = await collectResponses(provider, {
          ...sharedParams,
          ...providerParams,
          executeTool,
        });

        expect(sendMessage).toHaveBeenCalled();
        expect(responses.at(-1)?.metadata?.finishReason).toBe(testCase.expectedFinishReason);
        if (testCase.expectedToolRoundCount !== undefined) {
          expect(responses.at(-1)?.metadata?.toolRoundCount).toBe(testCase.expectedToolRoundCount);
        }
        if (testCase.requiresProviderDefaultRoundAssertion) {
          expect(responses.at(-1)?.metadata?.toolRoundCount).toBe(20);
        }
      },
    );
  });
});
