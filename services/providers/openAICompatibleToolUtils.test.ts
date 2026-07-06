import { afterEach, describe, expect, it, vi } from 'vitest';
import { streamOpenAICompatibleChat } from './openAICompatibleToolUtils';
import { TOOL_LOOP_CONTRACT_CASES } from './toolLoopContract.cases';

const TOOL_DEFINITIONS = [
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
  {
    name: 'render_preview',
    description: 'Render preview',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
      },
      required: ['projectId'],
      additionalProperties: false,
    },
  },
] as const;

const createJsonResponse = (payload: unknown) =>
  new globalThis.Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

describe('streamOpenAICompatibleChat', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses auto tool choice by default and avoids Gemini-only fields', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      createJsonResponse({
        choices: [{ message: { role: 'assistant', content: 'done' } }],
        usage: { prompt_tokens: 3, completion_tokens: 1 },
      }),
    );

    const responses = [];
    for await (const chunk of streamOpenAICompatibleChat({
      endpoint: 'https://example.com/chat/completions',
      headers: { Authorization: 'Bearer test' },
      providerName: 'openai',
      model: 'gpt-4o',
      params: {
        systemPrompt: 'You are helpful.',
        history: [],
        message: 'hello',
        tools: [...TOOL_DEFINITIONS],
        executeTool: vi.fn(),
      },
    })) {
      responses.push(chunk);
    }

    expect(responses[0]?.text).toBe('done');

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(body.tool_choice).toBe('auto');
    expect(body.tools).toHaveLength(2);
    expect(body.toolConfig).toBeUndefined();
    expect(body.allowedFunctionNames).toBeUndefined();
    expect(body.functionCallingConfig).toBeUndefined();
  });

  it('prunes visible tools without forcing a tool call', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      createJsonResponse({
        choices: [{ message: { role: 'assistant', content: 'subset ok' } }],
        usage: { prompt_tokens: 2, completion_tokens: 1 },
      }),
    );

    for await (const chunk of streamOpenAICompatibleChat({
      endpoint: 'https://example.com/chat/completions',
      headers: { Authorization: 'Bearer test' },
      providerName: 'openai',
      model: 'gpt-4o',
      params: {
        systemPrompt: 'You are helpful.',
        history: [],
        message: 'hello',
        tools: [...TOOL_DEFINITIONS],
        allowedToolNames: ['render_preview'],
        executeTool: vi.fn(),
      },
    })) {
      void chunk;
    }

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(body.tool_choice).toBe('auto');
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0]?.function?.name).toBe('render_preview');
  });

  it('maps requireAny to required tool choice', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      createJsonResponse({
        choices: [{ message: { role: 'assistant', content: 'required' } }],
        usage: { prompt_tokens: 2, completion_tokens: 1 },
      }),
    );

    for await (const chunk of streamOpenAICompatibleChat({
      endpoint: 'https://example.com/chat/completions',
      headers: { Authorization: 'Bearer test' },
      providerName: 'openai',
      model: 'gpt-4o',
      params: {
        systemPrompt: 'You are helpful.',
        history: [],
        message: 'hello',
        tools: [...TOOL_DEFINITIONS],
        toolChoice: { mode: 'requireAny' },
        executeTool: vi.fn(),
      },
    })) {
      void chunk;
    }

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(body.tool_choice).toBe('required');
  });

  it('maps requireSpecific to the OpenAI-specific function shape', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      createJsonResponse({
        choices: [{ message: { role: 'assistant', content: 'specific' } }],
        usage: { prompt_tokens: 2, completion_tokens: 1 },
      }),
    );

    for await (const chunk of streamOpenAICompatibleChat({
      endpoint: 'https://example.com/chat/completions',
      headers: { Authorization: 'Bearer test' },
      providerName: 'openai',
      model: 'gpt-4o',
      params: {
        systemPrompt: 'You are helpful.',
        history: [],
        message: 'hello',
        tools: [...TOOL_DEFINITIONS],
        toolChoice: { mode: 'requireSpecific', name: 'render_preview' },
        executeTool: vi.fn(),
      },
    })) {
      void chunk;
    }

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(body.tool_choice).toEqual({
      type: 'function',
      function: {
        name: 'render_preview',
      },
    });
  });

  it('downgrades forced tool choice to auto after the first tool round', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const executeTool = vi.fn().mockResolvedValueOnce({ html: '<div>preview</div>' });

    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse({
          choices: [
            {
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call-1',
                    type: 'function',
                    function: {
                      name: 'render_preview',
                      arguments: JSON.stringify({ projectId: 'proj-123' }),
                    },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 2, completion_tokens: 1 },
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'Recovered after required tool call.',
              },
            },
          ],
          usage: { prompt_tokens: 3, completion_tokens: 2 },
        }),
      );

    const responses = [];
    for await (const chunk of streamOpenAICompatibleChat({
      endpoint: 'https://example.com/chat/completions',
      headers: { Authorization: 'Bearer test' },
      providerName: 'openai',
      model: 'gpt-4o',
      params: {
        systemPrompt: 'You are helpful.',
        history: [],
        message: 'hello',
        tools: [...TOOL_DEFINITIONS],
        toolChoice: { mode: 'requireSpecific', name: 'render_preview' },
        executeTool,
      },
    })) {
      responses.push(chunk);
    }

    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(responses.at(0)).toMatchObject({ text: 'Recovered after required tool call.' });

    const firstRequestBody = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    const secondRequestBody = JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string);
    expect(firstRequestBody.tool_choice).toEqual({
      type: 'function',
      function: {
        name: 'render_preview',
      },
    });
    expect(secondRequestBody.tool_choice).toBe('auto');
  });

  it('handles two tool-call rounds before yielding the final assistant text', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const executeTool = vi
      .fn()
      .mockResolvedValueOnce({ matches: ['doc-1'] })
      .mockResolvedValueOnce({ html: '<div>preview</div>' });

    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse({
          choices: [
            {
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call-1',
                    type: 'function',
                    function: {
                      name: 'search_docs',
                      arguments: JSON.stringify({ query: 'financial aid' }),
                    },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 3, completion_tokens: 1 },
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          choices: [
            {
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call-2',
                    type: 'function',
                    function: {
                      name: 'render_preview',
                      arguments: JSON.stringify({ projectId: 'proj-123' }),
                    },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 4, completion_tokens: 2 },
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'Here is the completed preview.',
              },
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 3 },
        }),
      );

    const responses = [];
    for await (const chunk of streamOpenAICompatibleChat({
      endpoint: 'https://example.com/chat/completions',
      headers: { Authorization: 'Bearer test' },
      providerName: 'openai',
      model: 'gpt-4o',
      params: {
        systemPrompt: 'You are helpful.',
        history: [],
        message: 'hello',
        tools: [...TOOL_DEFINITIONS],
        executeTool,
      },
    })) {
      responses.push(chunk);
    }

    expect(executeTool).toHaveBeenNthCalledWith(1, {
      name: 'search_docs',
      args: { query: 'financial aid' },
    });
    expect(executeTool).toHaveBeenNthCalledWith(2, {
      name: 'render_preview',
      args: { projectId: 'proj-123' },
    });
    expect(responses).toEqual([
      {
        text: 'Here is the completed preview.',
        isComplete: false,
        metadata: {
          model: 'gpt-4o',
          provider: 'openai',
        },
      },
      {
        text: '',
        isComplete: true,
        metadata: {
          promptTokenCount: 12,
          candidatesTokenCount: 6,
          model: 'gpt-4o',
          provider: 'openai',
          usage: {
            source: 'api',
            inputTokens: 12,
            outputTokens: 6,
            totalTokens: 18,
            cachedInputTokens: 0,
            reasoningTokens: 0,
          },
          toolRoundCount: 2,
          repeatedRecoverableErrors: [],
          finishReason: 'complete',
        },
      },
    ]);

    const secondRequestBody = JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string);
    const thirdRequestBody = JSON.parse(fetchMock.mock.calls[2]?.[1]?.body as string);

    expect(secondRequestBody.messages.at(-1)).toEqual({
      role: 'tool',
      tool_call_id: 'call-1',
      content: JSON.stringify({ matches: ['doc-1'] }),
    });
    expect(thirdRequestBody.messages.at(-1)).toEqual({
      role: 'tool',
      tool_call_id: 'call-2',
      content: JSON.stringify({ html: '<div>preview</div>' }),
    });
  });

  it('serializes malformed tool calls without a function name as recoverable tool errors', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const executeTool = vi.fn();

    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse({
          choices: [
            {
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call-missing-name',
                    type: 'function',
                    function: {
                      arguments: JSON.stringify({ query: 'financial aid' }),
                    },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 2, completion_tokens: 1 },
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'Recovered after missing tool name.',
              },
            },
          ],
          usage: { prompt_tokens: 3, completion_tokens: 2 },
        }),
      );

    const responses = [];
    for await (const chunk of streamOpenAICompatibleChat({
      endpoint: 'https://example.com/chat/completions',
      headers: { Authorization: 'Bearer test' },
      providerName: 'openai',
      model: 'gpt-4o',
      params: {
        systemPrompt: 'You are helpful.',
        history: [],
        message: 'hello',
        tools: [...TOOL_DEFINITIONS],
        executeTool,
      },
    })) {
      responses.push(chunk);
    }

    expect(executeTool).not.toHaveBeenCalled();
    expect(responses.at(0)).toMatchObject({ text: 'Recovered after missing tool name.' });

    const secondRequestBody = JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string);
    expect(secondRequestBody.messages.at(-2)).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'call-missing-name',
          type: 'function',
          function: {
            name: '__invalid_tool_call__',
            arguments: JSON.stringify({ query: 'financial aid' }),
          },
        },
      ],
    });
    expect(secondRequestBody.messages.at(-1)).toEqual({
      role: 'tool',
      tool_call_id: 'call-missing-name',
      content: JSON.stringify({
        ok: false,
        recoverable: true,
        code: 'tool-call-missing-name',
        message: 'Tool call is missing a function name.',
        guidance: 'Retry the tool call with a valid function name and JSON object arguments.',
        details: {
          toolCallType: 'function',
        },
      }),
    });
  });

  it('serializes malformed tool calls without an id as recoverable tool errors', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const executeTool = vi.fn();

    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse({
          choices: [
            {
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    type: 'function',
                    function: {
                      name: 'search_docs',
                      arguments: JSON.stringify({ query: 'financial aid' }),
                    },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 2, completion_tokens: 1 },
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'Recovered after missing tool id.',
              },
            },
          ],
          usage: { prompt_tokens: 3, completion_tokens: 2 },
        }),
      );

    const responses = [];
    for await (const chunk of streamOpenAICompatibleChat({
      endpoint: 'https://example.com/chat/completions',
      headers: { Authorization: 'Bearer test' },
      providerName: 'openai',
      model: 'gpt-4o',
      params: {
        systemPrompt: 'You are helpful.',
        history: [],
        message: 'hello',
        tools: [...TOOL_DEFINITIONS],
        executeTool,
      },
    })) {
      responses.push(chunk);
    }

    expect(executeTool).not.toHaveBeenCalled();
    expect(responses.at(0)).toMatchObject({ text: 'Recovered after missing tool id.' });

    const secondRequestBody = JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string);
    expect(secondRequestBody.messages.at(-2)).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'invalid-tool-call-1',
          type: 'function',
          function: {
            name: 'search_docs',
            arguments: JSON.stringify({ query: 'financial aid' }),
          },
        },
      ],
    });
    expect(secondRequestBody.messages.at(-1)).toEqual({
      role: 'tool',
      tool_call_id: 'invalid-tool-call-1',
      content: JSON.stringify({
        ok: false,
        recoverable: true,
        code: 'tool-call-missing-id',
        message: 'Tool call is missing a tool_call_id.',
        guidance:
          'Retry the tool call with a valid tool_call_id, function name, and JSON object arguments.',
        details: {
          toolCallType: 'function',
          functionName: 'search_docs',
        },
      }),
    });
  });

  it('serializes malformed tool-call JSON as a recoverable tool error and continues to final text', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const executeTool = vi.fn();
    const malformedArguments = '{"query":';

    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse({
          choices: [
            {
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call-1',
                    type: 'function',
                    function: {
                      name: 'search_docs',
                      arguments: malformedArguments,
                    },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 3, completion_tokens: 1 },
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'Recovered after invalid tool arguments.',
              },
            },
          ],
          usage: { prompt_tokens: 4, completion_tokens: 2 },
        }),
      );

    const responses = [];
    for await (const chunk of streamOpenAICompatibleChat({
      endpoint: 'https://example.com/chat/completions',
      headers: { Authorization: 'Bearer test' },
      providerName: 'openai',
      model: 'gpt-4o',
      params: {
        systemPrompt: 'You are helpful.',
        history: [],
        message: 'hello',
        tools: [...TOOL_DEFINITIONS],
        executeTool,
      },
    })) {
      responses.push(chunk);
    }

    expect(executeTool).not.toHaveBeenCalled();
    expect(responses).toEqual([
      {
        text: 'Recovered after invalid tool arguments.',
        isComplete: false,
        metadata: {
          model: 'gpt-4o',
          provider: 'openai',
        },
      },
      {
        text: '',
        isComplete: true,
        metadata: {
          promptTokenCount: 7,
          candidatesTokenCount: 3,
          model: 'gpt-4o',
          provider: 'openai',
          usage: {
            source: 'api',
            inputTokens: 7,
            outputTokens: 3,
            totalTokens: 10,
            cachedInputTokens: 0,
            reasoningTokens: 0,
          },
          toolRoundCount: 1,
          repeatedRecoverableErrors: [
            {
              toolName: 'search_docs',
              code: 'tool-arguments-invalid-json',
              count: 1,
            },
          ],
          finishReason: 'complete',
        },
      },
    ]);

    const secondRequestBody = JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string);
    expect(secondRequestBody.messages.at(-1)).toEqual({
      role: 'tool',
      tool_call_id: 'call-1',
      content: JSON.stringify({
        ok: false,
        recoverable: true,
        code: 'tool-arguments-invalid-json',
        message: 'Tool call arguments must be valid JSON object syntax.',
        guidance:
          'Retry the same tool with a valid JSON object for arguments. Keep payloads smaller if the request is large.',
        details: {
          rawArgsLength: malformedArguments.length,
          rawArgsPreview: malformedArguments,
          truncated: false,
        },
      }),
    });
  });

  it('treats empty tool argument strings as invalid JSON instead of silently calling the tool with {}', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const executeTool = vi.fn();

    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse({
          choices: [
            {
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call-empty',
                    type: 'function',
                    function: {
                      name: 'search_docs',
                      arguments: '',
                    },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 2, completion_tokens: 1 },
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'Recovered after empty tool arguments.',
              },
            },
          ],
          usage: { prompt_tokens: 3, completion_tokens: 2 },
        }),
      );

    const responses = [];
    for await (const chunk of streamOpenAICompatibleChat({
      endpoint: 'https://example.com/chat/completions',
      headers: { Authorization: 'Bearer test' },
      providerName: 'openai',
      model: 'gpt-4o',
      params: {
        systemPrompt: 'You are helpful.',
        history: [],
        message: 'hello',
        tools: [...TOOL_DEFINITIONS],
        executeTool,
      },
    })) {
      responses.push(chunk);
    }

    expect(executeTool).not.toHaveBeenCalled();
    expect(responses.at(0)).toMatchObject({ text: 'Recovered after empty tool arguments.' });

    const secondRequestBody = JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string);
    expect(secondRequestBody.messages.at(-1)).toEqual({
      role: 'tool',
      tool_call_id: 'call-empty',
      content: JSON.stringify({
        ok: false,
        recoverable: true,
        code: 'tool-arguments-invalid-json',
        message: 'Tool call arguments must be valid JSON object syntax.',
        guidance:
          'Retry the same tool with a valid JSON object for arguments. Keep payloads smaller if the request is large.',
        details: {
          rawArgsLength: 0,
          rawArgsPreview: '',
          truncated: false,
        },
      }),
    });
  });

  it('stops after repeated recoverable tool errors and reports matching completion metadata', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const recoverableError = {
      ok: false,
      recoverable: true,
      code: 'search-temporary-unavailable',
      message: 'Search index is warming up.',
      guidance: 'Retry the same search in a moment.',
      details: { retryAfterMs: 500 },
    };
    const executeTool = vi.fn().mockResolvedValue(recoverableError);

    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse({
          choices: [
            {
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call-1',
                    type: 'function',
                    function: {
                      name: 'search_docs',
                      arguments: JSON.stringify({ query: 'financial aid' }),
                    },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 2, completion_tokens: 1 },
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          choices: [
            {
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call-2',
                    type: 'function',
                    function: {
                      name: 'search_docs',
                      arguments: JSON.stringify({ query: 'financial aid' }),
                    },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 3, completion_tokens: 1 },
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          choices: [
            {
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call-3',
                    type: 'function',
                    function: {
                      name: 'search_docs',
                      arguments: JSON.stringify({ query: 'financial aid' }),
                    },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 4, completion_tokens: 1 },
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'unused stop-route response',
              },
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 1 },
        }),
      );

    const responses = [];
    for await (const chunk of streamOpenAICompatibleChat({
      endpoint: 'https://example.com/chat/completions',
      headers: { Authorization: 'Bearer test' },
      providerName: 'openai',
      model: 'gpt-4o',
      params: {
        systemPrompt: 'You are helpful.',
        history: [],
        message: 'hello',
        tools: [...TOOL_DEFINITIONS],
        executeTool,
      },
    })) {
      responses.push(chunk);
    }

    expect(executeTool).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(responses).toEqual([
      {
        text: 'Stopped repeated recoverable tool failures and need a different repair path: search_docs:search-temporary-unavailable x3',
        isComplete: false,
        metadata: {
          model: 'gpt-4o',
          provider: 'openai',
        },
      },
      {
        text: '',
        isComplete: true,
        metadata: {
          promptTokenCount: 9,
          candidatesTokenCount: 3,
          model: 'gpt-4o',
          provider: 'openai',
          usage: {
            source: 'api',
            inputTokens: 9,
            outputTokens: 3,
            totalTokens: 12,
            cachedInputTokens: 0,
            reasoningTokens: 0,
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

  it('yields finishReason=tool-budget-exhausted instead of throwing when the round budget is exceeded', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(
        createJsonResponse({
          choices: [
            {
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'loop-call',
                    type: 'function',
                    function: {
                      name: 'search_docs',
                      arguments: JSON.stringify({ query: 'loop forever' }),
                    },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
      ),
    );
    const executeTool = vi.fn().mockResolvedValue({ matches: [] });

    const responses = [];
    for await (const chunk of streamOpenAICompatibleChat({
      endpoint: 'https://example.com/chat/completions',
      headers: { Authorization: 'Bearer test' },
      providerName: 'openai',
      model: 'gpt-4o',
      params: {
        systemPrompt: 'You are helpful.',
        history: [],
        message: 'hello',
        tools: [...TOOL_DEFINITIONS],
        executeTool,
      },
    })) {
      responses.push(chunk);
    }

    // G13: budget exhaustion must NOT throw; it yields a final frame with
    // finishReason='tool-budget-exhausted'.
    const final = responses.at(-1);
    expect(final).toMatchObject({
      text: '',
      isComplete: true,
    });
    expect(final?.metadata?.finishReason).toBe('tool-budget-exhausted');
    expect(final?.metadata?.toolRoundCount).toBe(20);

    expect(executeTool).toHaveBeenCalledTimes(20);
    expect(fetchMock).toHaveBeenCalledTimes(21);
  });

  it('forwards params.signal to fetch and yields finishReason=aborted on abort', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(
        createJsonResponse({
          choices: [
            {
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call-1',
                    type: 'function',
                    function: {
                      name: 'search_docs',
                      arguments: JSON.stringify({ query: 'financial aid' }),
                    },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 2, completion_tokens: 1 },
        }),
      ),
    );

    const controller = new AbortController();
    const executeTool = vi.fn().mockImplementation(async () => {
      // Abort mid-round (after the first tool execution); the next loop-top
      // check must observe signal.aborted and terminate with finishReason=aborted.
      controller.abort();
      return { matches: ['doc-1'] };
    });

    const responses = [];
    for await (const chunk of streamOpenAICompatibleChat({
      endpoint: 'https://example.com/chat/completions',
      headers: { Authorization: 'Bearer test' },
      providerName: 'openai',
      model: 'gpt-4o',
      params: {
        systemPrompt: 'You are helpful.',
        history: [],
        message: 'hello',
        tools: [...TOOL_DEFINITIONS],
        executeTool,
        signal: controller.signal,
      },
    })) {
      responses.push(chunk);
    }

    const fetchMock = vi.mocked(globalThis.fetch);
    // Signal forwarded to every fetch call (G17).
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(controller.signal);

    const final = responses.at(-1);
    expect(final?.metadata?.finishReason).toBe('aborted');
    expect(final?.isComplete).toBe(true);
    // Tool ran exactly once (round 1) before abort was observed at the top of round 2.
    expect(executeTool).toHaveBeenCalledTimes(1);
  });

  it('yields assistant content incrementally when a tool-call message also carries text', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const executeTool = vi.fn().mockResolvedValueOnce({ matches: ['doc-1'] });

    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse({
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'Let me search for that.',
                tool_calls: [
                  {
                    id: 'call-1',
                    type: 'function',
                    function: {
                      name: 'search_docs',
                      arguments: JSON.stringify({ query: 'financial aid' }),
                    },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 3, completion_tokens: 2 },
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'Here are the results.',
              },
            },
          ],
          usage: { prompt_tokens: 4, completion_tokens: 2 },
        }),
      );

    const responses = [];
    for await (const chunk of streamOpenAICompatibleChat({
      endpoint: 'https://example.com/chat/completions',
      headers: { Authorization: 'Bearer test' },
      providerName: 'openai',
      model: 'gpt-4o',
      params: {
        systemPrompt: 'You are helpful.',
        history: [],
        message: 'hello',
        tools: [...TOOL_DEFINITIONS],
        executeTool,
      },
    })) {
      responses.push(chunk);
    }

    // ③ Incremental yield: the round-1 assistant text is yielded BEFORE the
    // final answer so the user sees progress during the tool round.
    expect(responses.map(r => r.text)).toEqual([
      'Let me search for that.',
      'Here are the results.',
      '',
    ]);
    expect(responses.at(-1)?.metadata?.finishReason).toBe('complete');
  });

  it('evicts tool-result content older than 3 rounds and larger than 2KB after round 8', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const largeResult = { matches: ['x'.repeat(2500)] };
    const smallResult = { matches: ['ok'] };

    // executeTool returns a large result on the first call (round 1) and
    // small results afterwards; round 1's tool message should be evicted
    // once the loop crosses round 8 + 3-round lookback.
    const executeTool = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(executeTool.mock.calls.length === 1 ? largeResult : smallResult),
      );

    // Fetch always returns a tool call (10 rounds) then a final text answer.
    const toolCallResponse = () =>
      createJsonResponse({
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call-1',
                  type: 'function',
                  function: {
                    name: 'search_docs',
                    arguments: JSON.stringify({ query: 'q' }),
                  },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      });

    const fetchSequence = Array.from({ length: 10 }, () => Promise.resolve(toolCallResponse()));
    fetchSequence.push(
      Promise.resolve(
        createJsonResponse({
          choices: [{ message: { role: 'assistant', content: 'done' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
      ),
    );
    fetchMock.mockImplementation(() => fetchSequence.shift() as Promise<Response>);

    for await (const chunk of streamOpenAICompatibleChat({
      endpoint: 'https://example.com/chat/completions',
      headers: { Authorization: 'Bearer test' },
      providerName: 'openai',
      model: 'gpt-4o',
      params: {
        systemPrompt: 'You are helpful.',
        history: [],
        message: 'hello',
        tools: [...TOOL_DEFINITIONS],
        executeTool,
      },
    })) {
      void chunk;
    }

    expect(executeTool).toHaveBeenCalledTimes(10);

    // The 11th fetch (index 10) is the first request sent AFTER the eviction
    // at the round-9 append (toolRoundCount was 9 > 8). Round 1's tool result
    // (tag=1, age=8 > 3) is > 2KB and must be replaced with the placeholder.
    const evictedFetchBody = JSON.parse(fetchMock.mock.calls[10]?.[1]?.body as string);
    const toolMessages = evictedFetchBody.messages.filter(
      (m: { role: string }) => m.role === 'tool',
    );
    const round1ToolMessage = toolMessages[0];
    expect(round1ToolMessage.content).toBe(
      '[evicted prior tool result (>2KB); re-run readFile to inspect]',
    );
    // Structural integrity: tool_call_id preserved, role unchanged.
    expect(round1ToolMessage.role).toBe('tool');
    expect(round1ToolMessage.tool_call_id).toBe('call-1');

    // Recent rounds' tool results (still small) are untouched.
    const lastToolMessage = toolMessages.at(-1);
    expect(lastToolMessage.content).toBe(JSON.stringify(smallResult));
  });

  it('pure-text path yields finishReason=complete', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      createJsonResponse({
        choices: [{ message: { role: 'assistant', content: 'plain answer' } }],
        usage: { prompt_tokens: 2, completion_tokens: 1 },
      }),
    );

    const responses = [];
    for await (const chunk of streamOpenAICompatibleChat({
      endpoint: 'https://example.com/chat/completions',
      headers: { Authorization: 'Bearer test' },
      providerName: 'openai',
      model: 'gpt-4o',
      params: {
        systemPrompt: 'You are helpful.',
        history: [],
        message: 'hello',
        tools: [...TOOL_DEFINITIONS],
        executeTool: vi.fn(),
      },
    })) {
      responses.push(chunk);
    }

    expect(responses.at(-1)?.metadata?.finishReason).toBe('complete');
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
        const fetchMock = vi.spyOn(globalThis, 'fetch');
        const executeTool = vi.fn();
        testCase.setup({ fetch: fetchMock, executeTool });

        const responses = [];
        for await (const chunk of streamOpenAICompatibleChat({
          endpoint: 'https://example.com/chat/completions',
          headers: { Authorization: 'Bearer test' },
          providerName: 'openai',
          model: 'gpt-4o',
          params: {
            ...sharedParams,
            ...testCase.chatParamsOverride,
            executeTool,
          },
        })) {
          responses.push(chunk);
        }

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
