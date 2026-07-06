import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnthropicProvider } from './anthropicProvider';
import { TOOL_LOOP_CONTRACT_CASES } from './toolLoopContract.cases';

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
] as const;

const createJsonResponse = (payload: unknown) =>
  new globalThis.Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

describe('AnthropicProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends Anthropic-native tool fields in auto mode', async () => {
    const provider = new AnthropicProvider();
    await provider.initialize({ apiKey: 'anthropic-test-key', model: 'claude-opus-4-8' });

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      createJsonResponse({
        content: [{ type: 'text', text: 'done' }],
        usage: { input_tokens: 3, output_tokens: 1 },
      }),
    );

    const chunks = [];
    for await (const chunk of provider.streamChat({
      systemPrompt: 'You are helpful.',
      history: [],
      message: 'hello',
      tools: [...TOOL_DEFINITIONS],
    })) {
      chunks.push(chunk);
    }

    expect(chunks[0]?.text).toBe('done');

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(body.tool_choice).toEqual({ type: 'auto' });
    expect(body.tools[0]).toMatchObject({
      name: 'render_preview',
      input_schema: TOOL_DEFINITIONS[0].parameters,
    });
    expect(body.tools[0]?.function).toBeUndefined();
    expect(body.allowedFunctionNames).toBeUndefined();
    expect(body.toolConfig).toBeUndefined();
  });

  it('preserves auto mode when restricting visible tools', async () => {
    const provider = new AnthropicProvider();
    await provider.initialize({ apiKey: 'anthropic-test-key', model: 'claude-opus-4-8' });

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      createJsonResponse({
        content: [{ type: 'text', text: 'subset' }],
        usage: { input_tokens: 2, output_tokens: 1 },
      }),
    );

    for await (const chunk of provider.streamChat({
      systemPrompt: 'You are helpful.',
      history: [],
      message: 'hello',
      tools: [
        ...TOOL_DEFINITIONS,
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
      ],
      allowedToolNames: ['render_preview'],
    })) {
      void chunk;
    }

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(body.tool_choice).toEqual({ type: 'auto' });
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0]?.name).toBe('render_preview');
  });

  it('maps requireSpecific to Anthropic tool choice', async () => {
    const provider = new AnthropicProvider();
    await provider.initialize({ apiKey: 'anthropic-test-key', model: 'claude-opus-4-8' });

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      createJsonResponse({
        content: [{ type: 'text', text: 'specific' }],
        usage: { input_tokens: 2, output_tokens: 1 },
      }),
    );

    for await (const chunk of provider.streamChat({
      systemPrompt: 'You are helpful.',
      history: [],
      message: 'hello',
      tools: [...TOOL_DEFINITIONS],
      toolChoice: { mode: 'requireSpecific', name: 'render_preview' },
    })) {
      void chunk;
    }

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(body.tool_choice).toEqual({
      type: 'tool',
      name: 'render_preview',
    });
  });

  it('downgrades forced tool choice to auto after the first tool round', async () => {
    const provider = new AnthropicProvider();
    await provider.initialize({
      apiKey: 'anthropic-test-key',
      model: 'claude-opus-4-8',
      maxToolRounds: 20,
    });

    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse({
          content: [
            {
              type: 'tool_use',
              id: 'call-1',
              name: 'render_preview',
              input: { projectId: 'project-1' },
            },
          ],
          usage: { input_tokens: 2, output_tokens: 1 },
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          content: [{ type: 'text', text: 'done' }],
          usage: { input_tokens: 3, output_tokens: 2 },
        }),
      );

    const executeTool = vi.fn().mockResolvedValue({ ok: true });

    for await (const chunk of provider.streamChat({
      systemPrompt: 'You are helpful.',
      history: [],
      message: 'hello',
      tools: [...TOOL_DEFINITIONS],
      toolChoice: { mode: 'requireSpecific', name: 'render_preview' },
      executeTool,
    })) {
      void chunk;
    }

    const firstBody = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    const secondBody = JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string);
    expect(firstBody.tool_choice).toEqual({ type: 'tool', name: 'render_preview' });
    expect(secondBody.tool_choice).toEqual({ type: 'auto' });
  });

  it('supports multiple tool rounds before yielding final text', async () => {
    const provider = new AnthropicProvider();
    await provider.initialize({
      apiKey: 'anthropic-test-key',
      model: 'claude-opus-4-8',
      maxToolRounds: 20,
    });

    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse({
          content: [
            {
              type: 'tool_use',
              id: 'call-1',
              name: 'render_preview',
              input: { projectId: 'project-1' },
            },
          ],
          usage: { input_tokens: 2, output_tokens: 1 },
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          content: [
            {
              type: 'tool_use',
              id: 'call-2',
              name: 'render_preview',
              input: { projectId: 'project-2' },
            },
          ],
          usage: { input_tokens: 3, output_tokens: 1 },
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          content: [{ type: 'text', text: 'done' }],
          usage: { input_tokens: 4, output_tokens: 2 },
        }),
      );

    const executeTool = vi
      .fn()
      .mockResolvedValueOnce({ ok: 'first' })
      .mockResolvedValueOnce({ ok: 'second' });

    const chunks = [];
    for await (const chunk of provider.streamChat({
      systemPrompt: 'You are helpful.',
      history: [],
      message: 'hello',
      tools: [...TOOL_DEFINITIONS],
      executeTool,
    })) {
      chunks.push(chunk);
    }

    expect(executeTool).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(chunks[0]?.text).toBe('done');
  });

  it('serializes recoverable tool error payloads into tool_result content and continues to final text', async () => {
    const provider = new AnthropicProvider();
    await provider.initialize({
      apiKey: 'anthropic-test-key',
      model: 'claude-opus-4-8',
      maxToolRounds: 20,
    });

    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse({
          content: [
            {
              type: 'tool_use',
              id: 'call-1',
              name: 'render_preview',
              input: { projectId: 'project-1' },
            },
          ],
          usage: { input_tokens: 2, output_tokens: 1 },
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          content: [{ type: 'text', text: 'Recovered after tool error' }],
          usage: { input_tokens: 3, output_tokens: 2 },
        }),
      );

    const recoverableError = {
      ok: false,
      recoverable: true,
      code: 'preview-temporary-unavailable',
      message: 'Preview service is still starting.',
      guidance: 'Retry the same preview shortly.',
      details: { retryAfterMs: 750 },
    };
    const executeTool = vi.fn().mockResolvedValue(recoverableError);

    const chunks = [];
    for await (const chunk of provider.streamChat({
      systemPrompt: 'You are helpful.',
      history: [],
      message: 'hello',
      tools: [...TOOL_DEFINITIONS],
      executeTool,
    })) {
      chunks.push(chunk);
    }

    expect(executeTool).toHaveBeenCalledWith({
      name: 'render_preview',
      args: { projectId: 'project-1' },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(chunks[0]?.text).toBe('Recovered after tool error');

    const secondRequestBody = JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string);
    expect(secondRequestBody.messages.at(-1)).toEqual({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'call-1',
          content: JSON.stringify(recoverableError),
        },
      ],
    });
  });

  it('stops after repeated recoverable tool errors and reports matching completion metadata', async () => {
    const provider = new AnthropicProvider();
    await provider.initialize({
      apiKey: 'anthropic-test-key',
      model: 'claude-opus-4-8',
      maxToolRounds: 20,
    });

    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse({
          content: [
            {
              type: 'tool_use',
              id: 'call-1',
              name: 'render_preview',
              input: { projectId: 'project-1' },
            },
          ],
          usage: { input_tokens: 2, output_tokens: 1 },
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          content: [
            {
              type: 'tool_use',
              id: 'call-2',
              name: 'render_preview',
              input: { projectId: 'project-1' },
            },
          ],
          usage: { input_tokens: 3, output_tokens: 1 },
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          content: [
            {
              type: 'tool_use',
              id: 'call-3',
              name: 'render_preview',
              input: { projectId: 'project-1' },
            },
          ],
          usage: { input_tokens: 4, output_tokens: 1 },
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          content: [{ type: 'text', text: 'unused stop-route response' }],
          usage: { input_tokens: 5, output_tokens: 1 },
        }),
      );

    const recoverableError = {
      ok: false,
      recoverable: true,
      code: 'preview-temporary-unavailable',
      message: 'Preview service is still starting.',
      guidance: 'Retry the same preview shortly.',
      details: { retryAfterMs: 750 },
    };
    const executeTool = vi.fn().mockResolvedValue(recoverableError);

    const chunks = [];
    for await (const chunk of provider.streamChat({
      systemPrompt: 'You are helpful.',
      history: [],
      message: 'hello',
      tools: [...TOOL_DEFINITIONS],
      executeTool,
    })) {
      chunks.push(chunk);
    }

    expect(executeTool).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(chunks[0]).toMatchObject({
      text: 'Stopped repeated recoverable tool failures and need a different repair path: render_preview:preview-temporary-unavailable x3',
      isComplete: false,
      metadata: {
        model: 'claude-opus-4-8',
        provider: 'anthropic',
      },
    });
    expect(chunks[1]).toMatchObject({
      text: '',
      isComplete: true,
      metadata: {
        model: 'claude-opus-4-8',
        provider: 'anthropic',
        toolRoundCount: 3,
        repeatedRecoverableErrors: [
          {
            toolName: 'render_preview',
            code: 'preview-temporary-unavailable',
            count: 3,
          },
        ],
      },
    });

    const fourthRequestBody = JSON.parse(fetchMock.mock.calls[3]?.[1]?.body as string);
    const stopRoutePayload = JSON.parse(fourthRequestBody.messages.at(-1).content[0].content);
    expect(stopRoutePayload).toMatchObject({
      recoverable: false,
      loopAction: 'stop-route',
      escalation: {
        toolName: 'render_preview',
        code: 'preview-temporary-unavailable',
        attempt: 3,
      },
    });
  });

  it('yields finishReason=tool-budget-exhausted instead of throwing when the round budget is exceeded', async () => {
    const provider = new AnthropicProvider();
    await provider.initialize({
      apiKey: 'anthropic-test-key',
      model: 'claude-opus-4-8',
      maxToolRounds: 2,
    });

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(
        createJsonResponse({
          content: [
            {
              type: 'tool_use',
              id: 'loop-call',
              name: 'render_preview',
              input: { projectId: 'project-loop' },
            },
          ],
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      ),
    );
    const executeTool = vi.fn().mockResolvedValue({ ok: true });

    const chunks = [];
    for await (const chunk of provider.streamChat({
      systemPrompt: 'You are helpful.',
      history: [],
      message: 'hello',
      tools: [...TOOL_DEFINITIONS],
      executeTool,
    })) {
      chunks.push(chunk);
    }

    // G13: budget exhaustion must NOT throw; it yields a final frame with
    // finishReason='tool-budget-exhausted'.
    const final = chunks.at(-1);
    expect(final).toMatchObject({ text: '', isComplete: true });
    expect(final?.metadata?.finishReason).toBe('tool-budget-exhausted');
    expect(final?.metadata?.toolRoundCount).toBe(2);

    expect(executeTool).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('forwards params.signal to fetch and yields finishReason=aborted on abort', async () => {
    const provider = new AnthropicProvider();
    await provider.initialize({
      apiKey: 'anthropic-test-key',
      model: 'claude-opus-4-8',
    });

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(
        createJsonResponse({
          content: [
            {
              type: 'tool_use',
              id: 'call-1',
              name: 'render_preview',
              input: { projectId: 'project-1' },
            },
          ],
          usage: { input_tokens: 2, output_tokens: 1 },
        }),
      ),
    );

    const controller = new AbortController();
    const executeTool = vi.fn().mockImplementation(async () => {
      // Abort mid-round (after the first tool execution); the next loop-top
      // check must observe signal.aborted and terminate with finishReason=aborted.
      controller.abort();
      return { ok: true };
    });

    const chunks = [];
    for await (const chunk of provider.streamChat({
      systemPrompt: 'You are helpful.',
      history: [],
      message: 'hello',
      tools: [...TOOL_DEFINITIONS],
      executeTool,
      signal: controller.signal,
    })) {
      chunks.push(chunk);
    }

    // G17: signal forwarded to every fetch call.
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
    expect(fetchMock.mock.calls[1]?.[1]?.signal).toBe(controller.signal);

    const final = chunks.at(-1);
    expect(final?.metadata?.finishReason).toBe('aborted');
    // Tool ran exactly once (round 1) before abort was observed at the top of round 2.
    expect(executeTool).toHaveBeenCalledTimes(1);
  });

  it('yields finishReason=aborted without executing tools when the signal is pre-aborted', async () => {
    const provider = new AnthropicProvider();
    await provider.initialize({
      apiKey: 'anthropic-test-key',
      model: 'claude-opus-4-8',
    });

    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(
        createJsonResponse({
          content: [
            {
              type: 'tool_use',
              id: 'call-1',
              name: 'render_preview',
              input: { projectId: 'project-1' },
            },
          ],
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      ),
    );

    const controller = new AbortController();
    controller.abort();

    const executeTool = vi.fn();

    const chunks = [];
    for await (const chunk of provider.streamChat({
      systemPrompt: 'You are helpful.',
      history: [],
      message: 'hello',
      tools: [...TOOL_DEFINITIONS],
      executeTool,
      signal: controller.signal,
    })) {
      chunks.push(chunk);
    }

    expect(executeTool).not.toHaveBeenCalled();
    const final = chunks.at(-1);
    expect(final?.metadata?.finishReason).toBe('aborted');
  });

  it('yields incremental text content alongside tool_use before continuing the loop', async () => {
    const provider = new AnthropicProvider();
    await provider.initialize({
      apiKey: 'anthropic-test-key',
      model: 'claude-opus-4-8',
    });

    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock
      .mockResolvedValueOnce(
        createJsonResponse({
          content: [
            { type: 'text', text: 'Let me render that for you.' },
            {
              type: 'tool_use',
              id: 'call-1',
              name: 'render_preview',
              input: { projectId: 'project-1' },
            },
          ],
          usage: { input_tokens: 2, output_tokens: 1 },
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          content: [{ type: 'text', text: 'done' }],
          usage: { input_tokens: 3, output_tokens: 2 },
        }),
      );

    const executeTool = vi.fn().mockResolvedValue({ ok: true });

    const chunks = [];
    for await (const chunk of provider.streamChat({
      systemPrompt: 'You are helpful.',
      history: [],
      message: 'hello',
      tools: [...TOOL_DEFINITIONS],
      executeTool,
    })) {
      chunks.push(chunk);
    }

    // ⑤ First yielded chunk is the incremental text surfaced during the tool round.
    expect(chunks[0]).toMatchObject({
      text: 'Let me render that for you.',
      isComplete: false,
    });
    expect(chunks[1]).toMatchObject({ text: 'done', isComplete: false });
    expect(chunks.at(-1)?.metadata?.finishReason).toBe('complete');
  });

  it('evicts large tool_result content older than 3 rounds after 8 rounds', async () => {
    const provider = new AnthropicProvider();
    await provider.initialize({
      apiKey: 'anthropic-test-key',
      model: 'claude-opus-4-8',
      maxToolRounds: 20,
    });

    // Each response is a tool call; final response is terminal text.
    const toolCallResponse = () =>
      createJsonResponse({
        content: [
          {
            type: 'tool_use',
            id: `call-${Math.random()}`,
            name: 'render_preview',
            input: { projectId: 'project-1' },
          },
        ],
        usage: { input_tokens: 1, output_tokens: 1 },
      });

    const fetchMock = vi.spyOn(globalThis, 'fetch');
    for (let i = 0; i < 10; i += 1) {
      fetchMock.mockResolvedValueOnce(toolCallResponse());
    }
    fetchMock.mockResolvedValueOnce(
      createJsonResponse({
        content: [{ type: 'text', text: 'done' }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );

    // Tool result with content > 2KB; should be evicted once it's older than
    // 3 rounds (after >8 rounds have completed).
    const bigContent = 'x'.repeat(2500);
    const executeTool = vi.fn().mockResolvedValue({ output: bigContent });

    for await (const chunk of provider.streamChat({
      systemPrompt: 'You are helpful.',
      history: [],
      message: 'hello',
      tools: [...TOOL_DEFINITIONS],
      executeTool,
    })) {
      void chunk;
    }

    // Inspect the final request body — the earliest tool_result content should
    // have been replaced with the eviction placeholder.
    const lastCallIndex = fetchMock.mock.calls.length - 1;
    const lastRequestBody = JSON.parse(
      fetchMock.mock.calls[lastCallIndex]?.[1]?.body as string,
    ) as {
      messages: Array<{ role: string; content?: unknown }>;
    };
    const userMessages = lastRequestBody.messages.filter(
      (m): m is { role: string; content: Array<{ type: string; content?: string }> } =>
        m.role === 'user' && Array.isArray(m.content),
    );
    const toolResults = userMessages.flatMap(m => m.content.filter(b => b.type === 'tool_result'));
    const evictedCount = toolResults.filter(
      r => r.content === '[evicted prior tool result (>2KB); re-run readFile to inspect]',
    ).length;
    expect(evictedCount).toBeGreaterThan(0);

    // Most recent 3 rounds must never be evicted.
    const lastThree = toolResults.slice(-3);
    for (const r of lastThree) {
      expect(r.content).not.toBe('[evicted prior tool result (>2KB); re-run readFile to inspect]');
    }
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
        const provider = new AnthropicProvider();
        await provider.initialize({
          apiKey: 'anthropic-test-key',
          model: 'claude-opus-4-8',
          maxToolRounds: 3,
        });

        const fetchMock = vi.spyOn(globalThis, 'fetch');
        const executeTool = vi.fn();

        // Adapter: T1's shared contract mocks build OpenAI-shaped responses.
        // Anthropic needs Anthropic-shaped transport, so we re-implement each
        // scenario here using the case id as the scenario discriminator.
        const toolCallResponse = (id: string, name: string, input: Record<string, unknown>) =>
          createJsonResponse({
            content: [{ type: 'tool_use', id, name, input }],
            usage: { input_tokens: 1, output_tokens: 1 },
          });
        const textResponse = (text: string) =>
          createJsonResponse({
            content: [{ type: 'text', text }],
            usage: { input_tokens: 1, output_tokens: 1 },
          });

        let providerParams: Record<string, unknown> = {};

        switch (testCase.id) {
          case 'budget-exhausted-no-throw':
            fetchMock.mockImplementation(() =>
              Promise.resolve(
                toolCallResponse('loop-call', 'render_preview', { projectId: 'loop' }),
              ),
            );
            executeTool.mockResolvedValue({ ok: true });
            break;
          case 'per-call-max-tool-rounds-override':
            fetchMock.mockImplementation(() =>
              Promise.resolve(
                toolCallResponse('loop-call', 'render_preview', { projectId: 'override' }),
              ),
            );
            executeTool.mockResolvedValue({ ok: true });
            providerParams = {
              maxToolRounds: testCase.chatParamsOverride?.maxToolRounds,
            };
            break;
          case 'provider-default-max-tool-rounds':
            fetchMock.mockImplementation(() =>
              Promise.resolve(
                toolCallResponse('loop-call', 'render_preview', { projectId: 'default-budget' }),
              ),
            );
            executeTool.mockResolvedValue({ ok: true });
            break;
          case 'pure-text-complete':
            fetchMock.mockResolvedValue(textResponse('done'));
            break;
          case 'stop-route':
            fetchMock.mockImplementation(() =>
              Promise.resolve(toolCallResponse('call-1', 'render_preview', { projectId: 'q' })),
            );
            executeTool.mockResolvedValue({
              ok: false,
              recoverable: true,
              code: 'preview-temporary-unavailable',
              message: 'Preview service is still starting.',
              guidance: 'Retry the same preview shortly.',
            });
            break;
          default:
            throw new Error(`Unhandled contract case: ${testCase.id}`);
        }

        const chunks = [];
        for await (const chunk of provider.streamChat({
          ...sharedParams,
          ...providerParams,
          executeTool,
        })) {
          chunks.push(chunk);
        }

        expect(chunks.at(-1)?.metadata?.finishReason).toBe(testCase.expectedFinishReason);
        if (testCase.expectedToolRoundCount !== undefined) {
          expect(chunks.at(-1)?.metadata?.toolRoundCount).toBe(testCase.expectedToolRoundCount);
        }
        if (testCase.requiresProviderDefaultRoundAssertion) {
          expect(chunks.at(-1)?.metadata?.toolRoundCount).toBe(3);
        }
      },
    );
  });
});
