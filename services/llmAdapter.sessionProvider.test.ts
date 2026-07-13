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

  it('keeps bundle credentials in memory and clears only a matching bundle source', async () => {
    const provider = {
      name: 'gemini',
      displayName: 'Gemini',
      supportedModels: [],
      requiresApiKey: true,
      supportsLocalMode: false,
      initialize: vi.fn().mockResolvedValue(undefined),
      reinitialize: vi.fn(),
      isAvailable: vi.fn(() => true),
      streamChat: vi.fn(),
    } satisfies LlmAdapter.LLMProvider;
    const manager = ProviderManager.getInstance();
    manager.registerProvider('gemini', provider);
    const source = {
      kind: 'bundle' as const,
      bundleId: 'bundle-1',
      credentialFingerprint: 'fingerprint-1',
    };

    await manager.setBundleProviderConfig(source, 'gemini', { apiKey: 'bundle-only-key' });

    expect(localStorage.getItem('providerSettings')).toBeFalsy();
    expect(sessionStorage.getItem(bundleSessionProviderStorageKey)).toBeNull();
    expect(manager.getBundleProviderOverrideSource()).toEqual(source);
    expect(manager.matchesBundleProviderOverride(source)).toBe(true);
    await expect(
      manager.clearBundleProviderConfig({ ...source, credentialFingerprint: 'other-fingerprint' }),
    ).resolves.toBe(false);
    expect(manager.matchesBundleProviderOverride(source)).toBe(true);
    await expect(manager.clearBundleProviderConfig(source)).resolves.toBe(true);
    expect(manager.getBundleProviderOverrideSource()).toBeNull();
    expect(provider.reinitialize).toHaveBeenCalledTimes(2);
    expect(provider.initialize).toHaveBeenLastCalledWith(
      expect.objectContaining({ model: 'gemini-2.5-flash' }),
    );
    expect(provider.initialize).not.toHaveBeenLastCalledWith(
      expect.objectContaining({ apiKey: 'bundle-only-key' }),
    );
  });

  it('restores the active session provider after clearing a bundle provider override', async () => {
    const gemini = {
      name: 'gemini',
      displayName: 'Gemini',
      supportedModels: [],
      requiresApiKey: true,
      supportsLocalMode: false,
      initialize: vi.fn().mockResolvedValue(undefined),
      reinitialize: vi.fn(),
      isAvailable: vi.fn(() => true),
      streamChat: vi.fn(),
    } satisfies LlmAdapter.LLMProvider;
    const openai = {
      name: 'openai',
      displayName: 'OpenAI',
      supportedModels: [],
      requiresApiKey: true,
      supportsLocalMode: false,
      initialize: vi.fn().mockResolvedValue(undefined),
      reinitialize: vi.fn(),
      isAvailable: vi.fn(() => true),
      streamChat: vi.fn(),
    } satisfies LlmAdapter.LLMProvider;
    const manager = ProviderManager.getInstance();
    manager.registerProvider('gemini', gemini);
    manager.registerProvider('openai', openai);
    const source = {
      kind: 'bundle' as const,
      bundleId: 'bundle-1',
      credentialFingerprint: 'fingerprint-1',
    };

    await manager.setSessionProviderConfig('openai', { apiKey: 'recipient-session-key' });
    await manager.setBundleProviderConfig(source, 'gemini', { apiKey: 'bundle-only-key' });
    await manager.clearBundleProviderConfig(source);

    expect(gemini.initialize).toHaveBeenLastCalledWith(
      expect.objectContaining({ model: 'gemini-2.5-flash' }),
    );
    expect(gemini.initialize).not.toHaveBeenLastCalledWith(
      expect.objectContaining({ apiKey: 'bundle-only-key' }),
    );
    expect(openai.initialize).toHaveBeenLastCalledWith(
      expect.objectContaining({ apiKey: 'recipient-session-key' }),
    );
    expect(manager.getActiveProvider()).toBe(openai);
  });

  it('restores the previous bundle credential override when initialization fails', async () => {
    const provider = {
      name: 'gemini',
      displayName: 'Gemini',
      supportedModels: [],
      requiresApiKey: true,
      supportsLocalMode: false,
      initialize: vi
        .fn<() => Promise<void>>()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('unavailable')),
      reinitialize: vi.fn(),
      isAvailable: vi.fn(() => true),
      streamChat: vi.fn(),
    } satisfies LlmAdapter.LLMProvider;
    const manager = ProviderManager.getInstance();
    manager.registerProvider('gemini', provider);
    const activeSource = {
      kind: 'bundle' as const,
      bundleId: 'bundle-1',
      credentialFingerprint: 'fingerprint-1',
    };

    await manager.setBundleProviderConfig(activeSource, 'gemini', { apiKey: 'active-key' });
    await expect(
      manager.setBundleProviderConfig(
        { ...activeSource, bundleId: 'bundle-2', credentialFingerprint: 'fingerprint-2' },
        'gemini',
        { apiKey: 'failing-key' },
      ),
    ).rejects.toThrow('無法啟用隨附服務商設定。');

    expect(manager.matchesBundleProviderOverride(activeSource)).toBe(true);
    expect(provider.initialize).toHaveBeenCalledTimes(3);
    expect(provider.initialize).toHaveBeenLastCalledWith(
      expect.objectContaining({ apiKey: 'active-key' }),
    );
    expect(sessionStorage.getItem(bundleSessionProviderStorageKey)).toBeNull();
  });
});
