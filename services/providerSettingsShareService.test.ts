/**
 * @vitest-environment happy-dom
 */

import { webcrypto } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CryptoService } from './cryptoService';
import {
  applyProviderSettingsPayload,
  buildProviderSettingsPayload,
  buildLegacyProviderSettingsShareUrl,
  buildProviderSettingsShareEntryUrl,
  buildProviderSettingsShareUrl,
  clearProviderSettingsShareFromUrl,
  decryptProviderSettingsPayload,
  encryptProviderSettingsPayload,
  extractProviderSettingsShareFromUrl,
  getProviderDisplayName,
  getProviderSettingsTransferClassification,
  getShareableProviderSummary,
  parseProviderSettingsShareFile,
  PROVIDER_SETTINGS_SHARE_CIPHERTEXT_MAX_LENGTH,
  PROVIDER_SETTINGS_SHARE_FILE_MAX_BYTES,
  serializeProviderSettingsShareFile,
  validateProviderSettingsPayload,
  type SharedProviderSettingsPayload,
} from './providerSettingsShareService';
import type { ProviderSettings } from './llmAdapter';
import { providerManager } from './providerRegistry';

vi.mock('./providerRegistry', () => ({
  providerManager: {
    updateProviderConfig: vi.fn(),
    enableProvider: vi.fn(),
    setActiveProvider: vi.fn(),
    getProvider: vi.fn(),
    setSessionProviderConfig: vi.fn().mockResolvedValue(undefined),
  },
}));

const buildSettings = (): ProviderSettings => ({
  activeProvider: 'gemini',
  providers: {
    gemini: {
      enabled: true,
      config: {
        model: 'gemini-2.5-flash',
        apiKey: 'gemini-key',
      },
    },
    openai: {
      enabled: false,
      config: {
        model: ' gpt-4o-mini ',
        apiKey: ' openai-key ',
        baseUrl: ' https://api.openai.example/v1 ',
      },
    },
    anthropic: {
      enabled: false,
      config: {
        model: 'claude-opus-4-8',
        apiKey: 'anthropic-key',
      },
    },
    ollama: {
      enabled: false,
      config: {
        model: 'llama3.2:latest',
        baseUrl: 'http://localhost:11434',
      },
    },
    groq: {
      enabled: false,
      config: {
        model: 'llama-3.1-70b-versatile',
        apiKey: 'groq-key',
      },
    },
    openrouter: {
      enabled: false,
      config: {
        model: 'openai/gpt-4o',
        apiKey: 'openrouter-key',
      },
    },
    lmstudio: {
      enabled: false,
      config: {
        model: 'local-model',
        baseUrl: 'http://localhost:1234/v1',
      },
    },
  },
});

const buildPayload = (): SharedProviderSettingsPayload => ({
  v: 1,
  kind: 'provider-settings',
  provider: 'openai',
  config: {
    model: 'gpt-4o-mini',
    apiKey: 'openai-key',
    baseUrl: 'https://api.openai.example/v1',
  },
  meta: {
    app: 'educare',
    sharedAt: '2026-07-02T00:00:00.000Z',
  },
});

describe('providerSettingsShareService', () => {
  beforeAll(() => {
    Object.defineProperty(globalThis, 'crypto', {
      value: webcrypto,
      configurable: true,
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/settings');
  });

  describe('buildProviderSettingsPayload', () => {
    it('builds a shareable payload with trimmed provider config', () => {
      const payload = buildProviderSettingsPayload(buildSettings(), 'openai');

      expect(payload).toMatchObject({
        v: 1,
        kind: 'provider-settings',
        provider: 'openai',
        config: {
          model: 'gpt-4o-mini',
          apiKey: 'openai-key',
          baseUrl: 'https://api.openai.example/v1',
        },
        meta: {
          app: 'educare',
        },
      });
      expect(() => new Date(payload.meta.sharedAt)).not.toThrow();
    });

    it('rejects missing provider settings', () => {
      const settings = buildSettings();
      const providersWithoutOpenai = Object.fromEntries(
        Object.entries(settings.providers).filter(([providerKey]) => providerKey !== 'openai'),
      );
      const invalidSettings = {
        ...settings,
        providers: providersWithoutOpenai,
      } as unknown as ProviderSettings;

      expect(() => buildProviderSettingsPayload(invalidSettings, 'openai')).toThrow(
        '找不到要分享的服務商設定',
      );
    });

    it('rejects configs without a model', () => {
      const settings = buildSettings();
      settings.providers.openai.config.model = '   ';

      expect(() => buildProviderSettingsPayload(settings, 'openai')).toThrow('分享前請先設定模型');
    });

    it('rejects configs without api key or base url', () => {
      const settings = buildSettings();
      settings.providers.openai.config.apiKey = '   ';
      settings.providers.openai.config.baseUrl = '   ';

      expect(() => buildProviderSettingsPayload(settings, 'openai')).toThrow(
        '分享前請先設定 API 金鑰或端點網址',
      );
    });
  });

  describe('getShareableProviderSummary', () => {
    it('returns the visible provider summary for sharing previews', () => {
      const summary = getShareableProviderSummary(buildSettings(), 'openai');

      expect(summary).toEqual({
        provider: 'openai',
        providerName: 'OpenAI',
        model: 'gpt-4o-mini',
        baseUrl: 'https://api.openai.example/v1',
        hasApiKey: true,
      });
    });
  });

  describe('encryption roundtrip', () => {
    it('encrypts and decrypts provider settings payloads', async () => {
      const payload = buildPayload();

      const encrypted = await encryptProviderSettingsPayload(payload, 'test-password');
      const decrypted = await decryptProviderSettingsPayload(encrypted, 'test-password');

      expect(typeof encrypted).toBe('string');
      expect(encrypted).not.toContain(payload.config.apiKey as string);
      expect(decrypted).toEqual(payload);
    });

    it('rejects decrypted payloads that fail validation', async () => {
      const encrypted = await CryptoService.encryptPayload(
        {
          ...buildPayload(),
          kind: 'unexpected-kind',
        },
        'test-password',
      );

      await expect(decryptProviderSettingsPayload(encrypted, 'test-password')).rejects.toThrow(
        '不支援的分享內容版本',
      );
    });
  });

  describe('validateProviderSettingsPayload', () => {
    it('accepts a valid provider settings payload', () => {
      expect(() => validateProviderSettingsPayload(buildPayload())).not.toThrow();
    });

    it('rejects unsupported payload versions', () => {
      expect(() =>
        validateProviderSettingsPayload({
          ...buildPayload(),
          v: 2,
        } as unknown as SharedProviderSettingsPayload),
      ).toThrow('不支援的分享內容版本');
    });

    it('rejects invalid providers', () => {
      expect(() =>
        validateProviderSettingsPayload({
          ...buildPayload(),
          provider: 'invalid-provider',
        } as unknown as SharedProviderSettingsPayload),
      ).toThrow('分享內容中的服務商無效');
    });

    it('rejects missing models', () => {
      expect(() =>
        validateProviderSettingsPayload({
          ...buildPayload(),
          config: {
            ...buildPayload().config,
            model: '  ',
          },
        }),
      ).toThrow('分享內容缺少模型設定');
    });

    it('rejects payloads without api key or base url', () => {
      expect(() =>
        validateProviderSettingsPayload({
          ...buildPayload(),
          config: {
            model: 'gpt-4o-mini',
          },
        }),
      ).toThrow('分享內容缺少 API 金鑰或端點網址');
    });

    it('rejects malformed config field types without throwing a runtime TypeError', () => {
      expect(() =>
        validateProviderSettingsPayload({
          ...buildPayload(),
          config: { model: 42, apiKey: 'openai-key' },
        } as unknown as SharedProviderSettingsPayload),
      ).toThrow('分享內容缺少模型設定');

      expect(() =>
        validateProviderSettingsPayload({
          ...buildPayload(),
          config: { model: 'gpt-4o-mini', apiKey: 42 },
        } as unknown as SharedProviderSettingsPayload),
      ).toThrow('分享內容中的連線設定無效');
    });
  });

  describe('URL helpers', () => {
    it('builds a payload-free entry URL and preserves legacy URL reading', () => {
      const shareUrl = buildProviderSettingsShareUrl('encrypted-payload');
      expect(shareUrl).toBe('http://localhost:3000/settings?ps=file');
      expect(buildProviderSettingsShareEntryUrl()).toBe(shareUrl);
      expect(shareUrl).not.toContain('encrypted-payload');

      const legacyUrl = buildLegacyProviderSettingsShareUrl('encrypted-payload');
      expect(legacyUrl).toBe('http://localhost:3000/settings?ps=encrypted-payload');

      window.history.replaceState({}, '', legacyUrl);
      expect(extractProviderSettingsShareFromUrl()).toBe('encrypted-payload');

      clearProviderSettingsShareFromUrl();
      expect(extractProviderSettingsShareFromUrl()).toBeNull();
      expect(window.location.search).toBe('');
    });

    it('serializes and validates encrypted settings files without exposing ciphertext in a URL', async () => {
      const encryptedPayload = await encryptProviderSettingsPayload(
        buildPayload(),
        'test-password',
      );
      const fileText = serializeProviderSettingsShareFile(encryptedPayload);
      expect(fileText).toContain('educare-provider-settings-share');
      expect(parseProviderSettingsShareFile(fileText)).toBe(encryptedPayload);
      expect(() => parseProviderSettingsShareFile('{"format":"wrong"}')).toThrow(
        '分享檔案格式錯誤或內容已損毀',
      );
      expect(getProviderSettingsTransferClassification()).toMatchObject({
        kind: 'provider-settings',
        credentialsIncluded: true,
        previewRequired: true,
        trust: 'untrusted',
      });
    });

    it('rejects oversized, extra-key, invalid-date, and oversized-ciphertext files before decrypt', async () => {
      const encryptedPayload = await encryptProviderSettingsPayload(
        buildPayload(),
        'test-password',
      );
      const parsed = JSON.parse(serializeProviderSettingsShareFile(encryptedPayload)) as Record<
        string,
        unknown
      >;

      expect(() =>
        parseProviderSettingsShareFile(JSON.stringify({ ...parsed, unexpected: true })),
      ).toThrow('分享檔案格式錯誤或內容已損毀');
      expect(() =>
        parseProviderSettingsShareFile(JSON.stringify({ ...parsed, createdAt: 'not-a-date' })),
      ).toThrow('分享檔案格式錯誤或內容已損毀');
      expect(() =>
        parseProviderSettingsShareFile('x'.repeat(PROVIDER_SETTINGS_SHARE_FILE_MAX_BYTES + 1)),
      ).toThrow('分享檔案格式錯誤或內容已損毀');

      const oversizedEnvelope = btoa(
        JSON.stringify({
          iv: 'abcdefghijklmnop',
          salt: 'abcdefghijklmnopqrstuv',
          data: 'a'.repeat(PROVIDER_SETTINGS_SHARE_CIPHERTEXT_MAX_LENGTH + 1),
        }),
      )
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
      const oversizedFile = JSON.stringify({ ...parsed, encryptedPayload: oversizedEnvelope });
      expect(() => parseProviderSettingsShareFile(oversizedFile)).toThrow(
        '分享檔案格式錯誤或內容已損毀',
      );
    });
  });

  describe('applyProviderSettingsPayload', () => {
    it('keeps imported settings temporary by default', async () => {
      await applyProviderSettingsPayload(buildPayload());

      expect(providerManager.setSessionProviderConfig).toHaveBeenCalledWith('openai', {
        model: 'gpt-4o-mini',
        apiKey: 'openai-key',
        baseUrl: 'https://api.openai.example/v1',
      });
      expect(providerManager.updateProviderConfig).not.toHaveBeenCalled();
      expect(providerManager.enableProvider).not.toHaveBeenCalled();
      expect(providerManager.setActiveProvider).not.toHaveBeenCalled();
    });

    it('fails closed instead of writing global settings when temporary storage is unavailable', async () => {
      const manager = providerManager as unknown as Record<string, unknown>;
      const original = manager.setSessionProviderConfig;
      delete manager.setSessionProviderConfig;

      try {
        await expect(applyProviderSettingsPayload(buildPayload())).rejects.toThrow(
          '目前環境不支援僅此分頁保存',
        );
        expect(providerManager.updateProviderConfig).not.toHaveBeenCalled();
        expect(providerManager.enableProvider).not.toHaveBeenCalled();
        expect(providerManager.setActiveProvider).not.toHaveBeenCalled();
      } finally {
        manager.setSessionProviderConfig = original;
      }
    });

    it('updates provider settings, enables the provider, and initializes it when persistence is explicit', async () => {
      const initialize = vi.fn().mockResolvedValue(undefined);
      vi.mocked(providerManager.getProvider).mockReturnValue({ initialize } as never);

      await applyProviderSettingsPayload(buildPayload(), { persistence: 'persistent' });

      expect(providerManager.updateProviderConfig).toHaveBeenCalledWith('openai', {
        model: 'gpt-4o-mini',
        apiKey: 'openai-key',
        baseUrl: 'https://api.openai.example/v1',
      });
      expect(providerManager.enableProvider).toHaveBeenCalledWith('openai', true);
      expect(providerManager.setActiveProvider).toHaveBeenCalledWith('openai');
      expect(providerManager.getProvider).toHaveBeenCalledWith('openai');
      expect(initialize).toHaveBeenCalledWith({
        model: 'gpt-4o-mini',
        apiKey: 'openai-key',
        baseUrl: 'https://api.openai.example/v1',
      });
    });

    it('continues when provider initialization fails', async () => {
      const initialize = vi.fn().mockRejectedValue(new Error('boom'));
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      vi.mocked(providerManager.getProvider).mockReturnValue({ initialize } as never);

      await expect(
        applyProviderSettingsPayload(buildPayload(), { persistence: 'persistent' }),
      ).resolves.toBeUndefined();

      expect(providerManager.updateProviderConfig).toHaveBeenCalledWith('openai', {
        model: 'gpt-4o-mini',
        apiKey: 'openai-key',
        baseUrl: 'https://api.openai.example/v1',
      });
      expect(warnSpy).toHaveBeenCalledWith(
        'Failed to initialize imported provider openai:',
        expect.any(Error),
      );
    });
  });

  describe('getProviderDisplayName', () => {
    it('returns the visible display name for supported providers', () => {
      expect(getProviderDisplayName('lmstudio')).toBe('OpenAI 相容端點');
    });
  });
});
