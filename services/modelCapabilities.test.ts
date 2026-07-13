import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearModelCapabilityCache,
  resolveModelImageSupport,
  supportsImageInput,
} from './modelCapabilities';

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

describe('supportsImageInput (pattern fallback)', () => {
  it('accepts vision-capable models per provider', () => {
    expect(supportsImageInput('gemini', 'gemini-2.5-flash')).toBe(true);
    expect(supportsImageInput('gemini', 'gemini-1.5-pro')).toBe(true);
    // 向前相容:之後的世代自動涵蓋。
    expect(supportsImageInput('gemini', 'gemini-3-pro')).toBe(true);
    // 無版本號的通用別名。
    expect(supportsImageInput('gemini', 'gemini-flash-latest')).toBe(true);
    expect(supportsImageInput('gemini', 'gemini-pro-latest')).toBe(true);
    expect(supportsImageInput('gemini', 'gemini-flash-lite-latest')).toBe(true);
    expect(supportsImageInput('anthropic', 'claude-opus-4-8')).toBe(true);
    expect(supportsImageInput('anthropic', 'claude-3-5-sonnet-20241022')).toBe(true);
    expect(supportsImageInput('anthropic', 'claude-fable-5')).toBe(true);
    expect(supportsImageInput('openai', 'gpt-4o')).toBe(true);
    expect(supportsImageInput('openai', 'gpt-4.1-mini')).toBe(true);
    expect(supportsImageInput('openai', 'gpt-5-turbo')).toBe(true);
    expect(supportsImageInput('openai', 'o3-mini')).toBe(true);
  });

  it('accepts openrouter vendor-prefixed model ids', () => {
    expect(supportsImageInput('openrouter', 'openai/gpt-4o')).toBe(true);
    expect(supportsImageInput('openrouter', 'anthropic/claude-sonnet-4-6')).toBe(true);
    expect(supportsImageInput('openrouter', 'google/gemini-2.0-flash-001')).toBe(true);
    expect(supportsImageInput('openrouter', 'qwen/qwen2.5-vl-72b-instruct')).toBe(true);
    expect(supportsImageInput('openrouter', 'mistralai/mistral-7b-instruct')).toBe(false);
  });

  it('accepts common local vision models for ollama and lmstudio', () => {
    expect(supportsImageInput('ollama', 'llava:latest')).toBe(true);
    expect(supportsImageInput('ollama', 'llama3.2-vision:11b')).toBe(true);
    expect(supportsImageInput('ollama', 'gemma3:4b')).toBe(true);
    expect(supportsImageInput('ollama', 'llama3.2:latest')).toBe(false);
    expect(supportsImageInput('lmstudio', 'qwen2-vl-7b-instruct')).toBe(true);
    expect(supportsImageInput('lmstudio', 'mistral-7b-instruct')).toBe(false);
  });

  it('rejects text-only, embedding, and unknown models (conservative default)', () => {
    expect(supportsImageInput('openai', 'gpt-3.5-turbo')).toBe(false);
    expect(supportsImageInput('openai', 'text-embedding-3-small')).toBe(false);
    expect(supportsImageInput('gemini', 'gemini-embedding-001')).toBe(false);
    expect(supportsImageInput('anthropic', 'claude-2.1')).toBe(false);
    expect(supportsImageInput('anthropic', 'claude-instant-1.2')).toBe(false);
    expect(supportsImageInput('groq', 'llama-3.1-70b-versatile')).toBe(false);
    expect(supportsImageInput('groq', 'meta-llama/llama-4-scout-17b-16e-instruct')).toBe(true);
    expect(supportsImageInput('unknown-provider', 'gpt-4o')).toBe(false);
    expect(supportsImageInput('gemini', '')).toBe(false);
  });
});

describe('resolveModelImageSupport (API-based detection)', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    clearModelCapabilityCache();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses openrouter architecture.input_modalities over patterns', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: [
          {
            id: 'somevendor/brand-new-model',
            architecture: { input_modalities: ['text', 'image'] },
          },
          { id: 'somevendor/text-only-model', architecture: { input_modalities: ['text'] } },
        ],
      }),
    );

    // pattern 判斷不到的新模型,由 API 實查判定支援。
    await expect(
      resolveModelImageSupport('openrouter', 'somevendor/brand-new-model'),
    ).resolves.toBe(true);
    await expect(
      resolveModelImageSupport('openrouter', 'somevendor/text-only-model'),
    ).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/models',
      expect.anything(),
    );
  });

  it('uses ollama /api/show capabilities', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ capabilities: ['completion', 'vision'] }));

    await expect(
      resolveModelImageSupport('ollama', 'custom-model:latest', {
        baseUrl: 'http://localhost:11434',
      }),
    ).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:11434/api/show',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('uses lmstudio /api/v0/models type vlm', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: [
          { id: 'my-vision-model', type: 'vlm' },
          { id: 'my-text-model', type: 'llm' },
        ],
      }),
    );

    await expect(
      resolveModelImageSupport('lmstudio', 'my-vision-model', {
        baseUrl: 'http://localhost:1234/v1',
      }),
    ).resolves.toBe(true);
    await expect(
      resolveModelImageSupport('lmstudio', 'my-text-model', {
        baseUrl: 'http://localhost:1234/v1',
      }),
    ).resolves.toBe(false);
    // baseUrl 的 /v1 已剝除,REST API 掛在根路徑。
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:1234/api/v0/models',
      expect.anything(),
    );
  });

  it('falls back to patterns when the capability query fails', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));

    await expect(
      resolveModelImageSupport('ollama', 'llava:latest', { baseUrl: 'http://localhost:11434' }),
    ).resolves.toBe(true);
    await expect(
      resolveModelImageSupport('ollama', 'llama3.2:latest', { baseUrl: 'http://localhost:11434' }),
    ).resolves.toBe(false);
  });

  it('does not query providers without capability endpoints', async () => {
    await expect(resolveModelImageSupport('gemini', 'gemini-2.5-flash')).resolves.toBe(true);
    await expect(resolveModelImageSupport('openai', 'gpt-4o')).resolves.toBe(true);
    await expect(resolveModelImageSupport('anthropic', 'claude-opus-4-8')).resolves.toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('caches query results for 24h and skips repeat fetches', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ capabilities: ['completion', 'vision'] }));

    await resolveModelImageSupport('ollama', 'custom-model:latest', {
      baseUrl: 'http://localhost:11434',
    });
    await resolveModelImageSupport('ollama', 'custom-model:latest', {
      baseUrl: 'http://localhost:11434',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
