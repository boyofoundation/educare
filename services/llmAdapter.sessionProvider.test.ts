/**
 * @vitest-environment happy-dom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as LlmAdapter from './llmAdapter';

let ProviderManager: typeof LlmAdapter.ProviderManager;
let bundleSessionProviderStorageKey: typeof LlmAdapter.BUNDLE_SESSION_PROVIDER_STORAGE_KEY;

const resetProviderManager = () => {
  (ProviderManager as unknown as { instance?: unknown }).instance = undefined;
};

const sessionValues = new Map<string, string>();

describe('ProviderManager session provider configuration', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    sessionValues.clear();
    vi.stubGlobal('localStorage', window.localStorage);
    vi.stubGlobal('sessionStorage', window.sessionStorage);
    vi.mocked(sessionStorage.getItem).mockImplementation(key => sessionValues.get(key) ?? null);
    vi.mocked(sessionStorage.setItem).mockImplementation((key, value) => {
      sessionValues.set(key, value);
    });
    vi.resetModules();
    ({ ProviderManager, BUNDLE_SESSION_PROVIDER_STORAGE_KEY: bundleSessionProviderStorageKey } =
      await import('./llmAdapter'));
    resetProviderManager();
  });

  afterEach(() => {
    resetProviderManager();
    vi.unstubAllGlobals();
  });

  it('keeps a session-scoped provider configuration out of localStorage and activates it from sessionStorage', async () => {
    const provider = {
      name: 'gemini',
      displayName: 'Gemini',
      supportedModels: [],
      requiresApiKey: true,
      supportsLocalMode: false,
      initialize: vi.fn().mockResolvedValue(undefined),
      isAvailable: vi.fn(() => true),
      streamChat: vi.fn(),
    } satisfies LlmAdapter.LLMProvider;
    const manager = ProviderManager.getInstance();
    manager.registerProvider('gemini', provider);

    await manager.setSessionProviderConfig('gemini', { apiKey: 'session-only-key' });

    expect(localStorage.getItem('providerSettings')).toBeFalsy();
    expect(sessionStorage.getItem(bundleSessionProviderStorageKey)).toEqual(
      expect.stringContaining('session-only-key'),
    );
    expect(manager.getSessionProviderConfig()).toMatchObject({
      type: 'gemini',
      config: { apiKey: 'session-only-key' },
    });
    expect(manager.getActiveProvider()).toBe(provider);
    expect(provider.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'session-only-key' }),
    );
  });
});
