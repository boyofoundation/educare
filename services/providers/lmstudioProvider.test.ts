import { afterEach, describe, expect, it, vi } from 'vitest';
import { LMStudioProvider } from './lmstudioProvider';

const createJsonResponse = (payload: unknown) =>
  new globalThis.Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

describe('LMStudioProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('omits Authorization when no API key is configured', async () => {
    const provider = new LMStudioProvider();
    await provider.initialize({ baseUrl: 'http://localhost:1234/v1' });

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(createJsonResponse({ data: [{ id: 'model-1' }] }));

    const models = await provider.getAvailableModels();

    expect(models).toEqual(['model-1']);
    expect(fetchMock.mock.calls[0]?.[1]).toEqual({ headers: {} });
  });

  it('sends Bearer authorization for model listing when an API key is configured', async () => {
    const provider = new LMStudioProvider();
    await provider.initialize({
      baseUrl: 'http://localhost:1234/v1',
      apiKey: 'lmstudio-secret',
    });

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(createJsonResponse({ data: [{ id: 'model-1' }] }));

    await provider.getAvailableModels();

    expect(fetchMock.mock.calls[0]?.[1]).toEqual({
      headers: {
        Authorization: 'Bearer lmstudio-secret',
      },
    });
  });

  it('forwards abort signals to the chat fetch request', async () => {
    const provider = new LMStudioProvider();
    await provider.initialize({
      baseUrl: 'http://localhost:1234/v1',
      apiKey: 'lmstudio-secret',
      model: 'local-model',
    });

    const abortController = new AbortController();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      expect(init?.signal).toBe(abortController.signal);
      return new globalThis.Response(
        JSON.stringify({ choices: [{ message: { content: 'done' }, finish_reason: 'stop' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const responses: unknown[] = [];
    for await (const response of provider.streamChat({
      systemPrompt: 'You are helpful.',
      history: [],
      message: 'hello',
      signal: abortController.signal,
    })) {
      responses.push(response);
      break;
    }

    expect(responses.length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalled();
  });
});
