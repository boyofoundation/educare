import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ApiKeyManager from './apiKeyManager';

describe('ApiKeyManager.validateGroqApiKey', () => {
  it('accepts Groq keys with variable lengths after the gsk_ prefix', () => {
    expect(
      ApiKeyManager.validateGroqApiKey(
        'gsk_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234',
      ),
    ).toBe(true);
    expect(ApiKeyManager.validateGroqApiKey('gsk_shortbutvalid123456')).toBe(true);
  });

  it('rejects keys without the gsk_ prefix or with invalid characters', () => {
    expect(ApiKeyManager.validateGroqApiKey('sk_abcdefghijklmnopqrstuvwxyz')).toBe(false);
    expect(ApiKeyManager.validateGroqApiKey('gsk_invalid-key')).toBe(false);
    expect(ApiKeyManager.validateGroqApiKey('gsk_')).toBe(false);
  });
});

describe('ApiKeyManager LM Studio API key support', () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    const temporaryStorage = new Map<string, string>();

    vi.mocked(localStorage.getItem).mockImplementation(key => storage.get(key) ?? null);
    vi.mocked(localStorage.setItem).mockImplementation((key, value) => {
      storage.set(key, String(value));
    });
    vi.mocked(localStorage.removeItem).mockImplementation(key => {
      storage.delete(key);
    });
    vi.mocked(localStorage.clear).mockImplementation(() => {
      storage.clear();
    });

    vi.mocked(sessionStorage.getItem).mockImplementation(key => temporaryStorage.get(key) ?? null);
    vi.mocked(sessionStorage.setItem).mockImplementation((key, value) => {
      temporaryStorage.set(key, String(value));
    });
    vi.mocked(sessionStorage.removeItem).mockImplementation(key => {
      temporaryStorage.delete(key);
    });
    vi.mocked(sessionStorage.clear).mockImplementation(() => {
      temporaryStorage.clear();
    });

    localStorage.clear();
    sessionStorage.clear();
    ApiKeyManager.clearTemporaryApiKeys();
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    ApiKeyManager.clearTemporaryApiKeys();
    vi.restoreAllMocks();
  });

  it('stores and returns the optional LM Studio API key', () => {
    ApiKeyManager.setUserApiKeys(
      {
        lmstudioBaseUrl: 'http://localhost:1234/v1',
        lmstudioApiKey: 'lmstudio-secret',
      },
      { persistence: 'persistent' },
    );

    const apiKeys = ApiKeyManager.getUserApiKeys();

    expect(localStorage.getItem('user_lmstudio_api_key')).toBe('lmstudio-secret');
    expect(ApiKeyManager.getLmstudioApiKey()).toBe('lmstudio-secret');
    expect(apiKeys.lmstudioBaseUrl).toBe('http://localhost:1234/v1');
  });

  it('removes the stored LM Studio API key when omitted', () => {
    ApiKeyManager.setUserApiKeys(
      {
        lmstudioBaseUrl: 'http://localhost:1234/v1',
        lmstudioApiKey: 'lmstudio-secret',
      },
      { persistence: 'persistent' },
    );

    ApiKeyManager.setUserApiKeys(
      {
        lmstudioBaseUrl: 'http://localhost:1234/v1',
      },
      { persistence: 'persistent' },
    );

    const apiKeys = ApiKeyManager.getUserApiKeys();
    expect(apiKeys.lmstudioApiKey).toBeUndefined();
  });

  it('keeps newly entered keys in session storage by default', () => {
    ApiKeyManager.setUserApiKeys({ openaiApiKey: 'temporary-openai-key' });

    expect(ApiKeyManager.getOpenaiApiKey()).toBe('temporary-openai-key');
    expect(localStorage.getItem('user_openai_api_key')).toBeNull();
    expect(sessionStorage.getItem('educare_temporary_api_keys')).toContain('temporary-openai-key');
    expect(ApiKeyManager.getApiKeyPersistence()).toBe('temporary');
  });

  it('supports memory-only credentials without writing browser storage', () => {
    ApiKeyManager.setTemporaryApiKeys({ geminiApiKey: 'memory-only-key' }, 'memory');

    expect(ApiKeyManager.getGeminiApiKey()).toBe('memory-only-key');
    expect(localStorage.getItem('user_gemini_api_key')).toBeNull();
    expect(sessionStorage.getItem('educare_temporary_api_keys')).toBeNull();
    expect(ApiKeyManager.getApiKeyPersistence()).toBe('temporary');

    ApiKeyManager.clearTemporaryApiKeys();
    expect(ApiKeyManager.getGeminiApiKey()).toBeNull();
    expect(ApiKeyManager.getApiKeyPersistence()).toBe('none');
  });

  it('clears previous session credentials when switching to memory mode', () => {
    ApiKeyManager.setTemporaryApiKeys({ openaiApiKey: 'stale-session-key' }, 'session');

    ApiKeyManager.setTemporaryApiKeys({ geminiApiKey: 'memory-only-key' }, 'memory');

    expect(sessionStorage.getItem('educare_temporary_api_keys')).toBeNull();
    expect(ApiKeyManager.getOpenaiApiKey()).toBeNull();
    expect(ApiKeyManager.getGeminiApiKey()).toBe('memory-only-key');
  });

  it('does not expose stale session credentials after a failed session write', () => {
    ApiKeyManager.setTemporaryApiKeys({ openaiApiKey: 'stale-session-key' }, 'session');
    vi.mocked(sessionStorage.setItem).mockImplementationOnce(() => {
      throw new Error('quota');
    });

    ApiKeyManager.setTemporaryApiKeys({ geminiApiKey: 'memory-fallback-key' }, 'session');

    expect(sessionStorage.getItem('educare_temporary_api_keys')).toBeNull();
    expect(ApiKeyManager.getOpenaiApiKey()).toBeNull();
    expect(ApiKeyManager.getGeminiApiKey()).toBe('memory-fallback-key');
  });
});
