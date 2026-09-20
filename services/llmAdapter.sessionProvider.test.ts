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

  it('keeps independent session overrides for multiple providers and exposes effective settings', async () => {
    const gemini = {
      name: 'gemini',
      displayName: 'Gemini',
      supportedModels: [],
      requiresApiKey: true,
      supportsLocalMode: false,
      initialize: vi.fn().mockResolvedValue(undefined),
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
      isAvailable: vi.fn(() => true),
      streamChat: vi.fn(),
    } satisfies LlmAdapter.LLMProvider;
    const manager = ProviderManager.getInstance();
    manager.registerProvider('gemini', gemini);
    manager.registerProvider('openai', openai);

    await manager.setSessionProviderConfig('gemini', { apiKey: 'gemini-session-key' });
    await manager.setSessionProviderConfig('openai', { apiKey: 'openai-session-key' });

    expect(manager.getSessionProviderConfigs()).toMatchObject({
      gemini: { type: 'gemini', config: { apiKey: 'gemini-session-key' } },
      openai: { type: 'openai', config: { apiKey: 'openai-session-key' } },
    });
    expect(JSON.parse(sessionStorage.getItem(bundleSessionProviderStorageKey) as string)).toEqual(
      expect.objectContaining({
        gemini: expect.objectContaining({
          config: expect.objectContaining({ apiKey: 'gemini-session-key' }),
        }),
        openai: expect.objectContaining({
          config: expect.objectContaining({ apiKey: 'openai-session-key' }),
        }),
      }),
    );
    expect(manager.getEffectiveProviderSettings().providers.gemini.config.apiKey).toBe(
      'gemini-session-key',
    );
    expect(manager.getEffectiveProviderSettings().providers.openai.config.apiKey).toBe(
      'openai-session-key',
    );

    manager.clearSessionProviderConfig('openai');
    expect(manager.getSessionProviderConfig('gemini')?.config.apiKey).toBe('gemini-session-key');
    expect(manager.getSessionProviderConfig('openai')).toBeNull();
  });

  it('loads the legacy single-slot session format into the keyed override map', () => {
    sessionValues.set(
      bundleSessionProviderStorageKey,
      JSON.stringify({ type: 'gemini', config: { apiKey: 'legacy-session-key' } }),
    );
    const manager = ProviderManager.getInstance();

    expect(manager.getSessionProviderConfigs()).toMatchObject({
      gemini: { type: 'gemini', config: { apiKey: 'legacy-session-key' } },
    });
  });

  it('rolls back the previous session override and storage when initialization fails', async () => {
    const provider = {
      name: 'gemini',
      displayName: 'Gemini',
      supportedModels: [],
      requiresApiKey: true,
      supportsLocalMode: false,
      initialize: vi
        .fn<() => Promise<void>>()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('unavailable'))
        .mockResolvedValueOnce(undefined),
      reinitialize: vi.fn(),
      isAvailable: vi.fn(() => true),
      streamChat: vi.fn(),
    } satisfies LlmAdapter.LLMProvider;
    const manager = ProviderManager.getInstance();
    manager.registerProvider('gemini', provider);

    await manager.setSessionProviderConfig('gemini', { apiKey: 'previous-key' });
    const previousStorage = sessionStorage.getItem(bundleSessionProviderStorageKey);

    await expect(
      manager.setSessionProviderConfig('gemini', { apiKey: 'failing-key' }),
    ).rejects.toThrow('無法啟用分頁服務商設定。');

    expect(manager.getSessionProviderConfig('gemini')).toMatchObject({
      config: { apiKey: 'previous-key' },
    });
    expect(sessionStorage.getItem(bundleSessionProviderStorageKey)).toBe(previousStorage);
    expect(provider.initialize).toHaveBeenLastCalledWith(
      expect.objectContaining({ apiKey: 'previous-key' }),
    );
  });

  it('rolls back the previous session override when session storage commit fails', async () => {
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

    await manager.setSessionProviderConfig('gemini', { apiKey: 'previous-key' });
    const previousStorage = sessionStorage.getItem(bundleSessionProviderStorageKey);
    vi.mocked(sessionStorage.setItem).mockImplementationOnce(() => {
      throw new Error('quota');
    });

    await expect(manager.setSessionProviderConfig('gemini', { apiKey: 'new-key' })).rejects.toThrow(
      '無法保存分頁服務商設定。',
    );

    expect(manager.getSessionProviderConfig('gemini')).toMatchObject({
      config: { apiKey: 'previous-key' },
    });
    expect(sessionStorage.getItem(bundleSessionProviderStorageKey)).toBe(previousStorage);
    expect(provider.initialize).toHaveBeenLastCalledWith(
      expect.objectContaining({ apiKey: 'previous-key' }),
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

  it('serializes bundle cleanup before a replacement so stale cleanup cannot reapply old config', async () => {
    let resolveCleanup: (() => void) | undefined;
    const provider = {
      name: 'gemini',
      displayName: 'Gemini',
      supportedModels: [],
      requiresApiKey: true,
      supportsLocalMode: false,
      initialize: vi
        .fn<() => Promise<void>>()
        .mockResolvedValueOnce(undefined)
        .mockImplementationOnce(
          () =>
            new Promise<void>(resolve => {
              resolveCleanup = resolve;
            }),
        )
        .mockResolvedValueOnce(undefined),
      reinitialize: vi.fn(),
      isAvailable: vi.fn(() => true),
      streamChat: vi.fn(),
    } satisfies LlmAdapter.LLMProvider;
    const manager = ProviderManager.getInstance();
    manager.registerProvider('gemini', provider);
    const previousSource = {
      kind: 'bundle' as const,
      bundleId: 'bundle-previous',
      credentialFingerprint: 'previous-fingerprint',
    };
    const nextSource = {
      kind: 'bundle' as const,
      bundleId: 'bundle-next',
      credentialFingerprint: 'next-fingerprint',
    };

    await manager.setBundleProviderConfig(previousSource, 'gemini', { apiKey: 'previous-key' });
    const cleanup = manager.clearBundleProviderConfig(previousSource);
    const replacement = manager.setBundleProviderConfig(nextSource, 'gemini', {
      apiKey: 'next-key',
    });

    await Promise.resolve();
    expect(provider.initialize).toHaveBeenCalledTimes(2);
    resolveCleanup?.();
    await Promise.all([cleanup, replacement]);

    expect(manager.matchesBundleProviderOverride(previousSource)).toBe(false);
    expect(manager.matchesBundleProviderOverride(nextSource)).toBe(true);
    expect(provider.initialize).toHaveBeenLastCalledWith(
      expect.objectContaining({ apiKey: 'next-key' }),
    );
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
