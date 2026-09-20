/// <reference types="vitest/globals" />
import { beforeEach, describe, expect, it, vi } from 'vitest';

const providerMocks = vi.hoisted(() => {
  const loads = {
    gemini: 0,
    openai: 0,
    anthropic: 0,
    openrouter: 0,
    lmstudio: 0,
    ollama: 0,
    groq: 0,
  };
  const failedLoads = new Set<string>();

  const createProvider = (name: string, key: keyof typeof loads) => {
    loads[key] += 1;
    return class MockProvider {
      constructor() {
        if (failedLoads.has(name)) {
          throw new Error(`${name} provider chunk failed`);
        }
      }

      readonly name = name;
      readonly displayName = name;
      readonly supportedModels: string[] = [];
      readonly requiresApiKey = false;
      readonly supportsLocalMode = true;
      readonly initialize = vi.fn().mockResolvedValue(undefined);
      readonly isAvailable = vi.fn(() => true);
      readonly streamChat = vi.fn();
    };
  };

  return { loads, failedLoads, createProvider };
});

vi.mock('./providers/geminiProvider', () => ({
  GeminiProvider: providerMocks.createProvider('gemini', 'gemini'),
}));
vi.mock('./providers/openaiNativeProvider', () => ({
  OpenAINativeProvider: providerMocks.createProvider('openai', 'openai'),
}));
vi.mock('./providers/anthropicProvider', () => ({
  AnthropicProvider: providerMocks.createProvider('anthropic', 'anthropic'),
}));
vi.mock('./providers/openrouterProvider', () => ({
  OpenRouterProvider: providerMocks.createProvider('openrouter', 'openrouter'),
}));
vi.mock('./providers/lmstudioProvider', () => ({
  LMStudioProvider: providerMocks.createProvider('lmstudio', 'lmstudio'),
}));
vi.mock('./providers/ollamaNativeProvider', () => ({
  OllamaNativeProvider: providerMocks.createProvider('ollama', 'ollama'),
}));
vi.mock('./providers/groqNativeProvider', () => ({
  GroqNativeProvider: providerMocks.createProvider('groq', 'groq'),
}));

import { initializeProviders, providerManager } from './providerRegistry';

describe('providerRegistry lazy loading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not load provider implementations until initialization is requested', async () => {
    expect(providerMocks.loads).toEqual({
      gemini: 0,
      openai: 0,
      anthropic: 0,
      openrouter: 0,
      lmstudio: 0,
      ollama: 0,
      groq: 0,
    });
    expect(providerManager.getProvider('gemini')).toBeNull();

    const firstInitialization = initializeProviders();
    const concurrentInitialization = initializeProviders();

    await concurrentInitialization;
    expect(providerManager.getProvider('gemini')).not.toBeNull();
    await firstInitialization;

    expect(providerMocks.loads).toEqual({
      gemini: 1,
      openai: 1,
      anthropic: 1,
      openrouter: 1,
      lmstudio: 1,
      ollama: 1,
      groq: 1,
    });
    expect(providerManager.getProvider('gemini')).not.toBeNull();
    expect(providerManager.getProvider('openai')).not.toBeNull();
  });

  it('surfaces a missing configured provider and allows a later retry', async () => {
    const providers = (providerManager as unknown as { providers: Map<string, unknown> }).providers;
    providers.clear();
    providerMocks.failedLoads.add('gemini');

    await expect(initializeProviders()).rejects.toThrow(/gemini/);
    expect(providerManager.getProvider('gemini')).toBeNull();

    providerMocks.failedLoads.delete('gemini');
    await initializeProviders();

    expect(providerManager.getProvider('gemini')).not.toBeNull();
  });
});
