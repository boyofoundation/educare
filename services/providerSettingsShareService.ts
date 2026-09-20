import { CryptoService } from './cryptoService';
import { getTransferClassification, type TransferClassification } from './fileTransferPolicy';
import type { ProviderConfig, ProviderSettings, ProviderType } from './llmAdapter';
import { providerManager } from './providerRegistry';

export const PROVIDER_SETTINGS_SHARE_PARAM = 'ps';
export const PROVIDER_SETTINGS_SHARE_ENTRY = 'file';
export const PROVIDER_SETTINGS_SHARE_FILE_FORMAT = 'educare-provider-settings-share';
export const PROVIDER_SETTINGS_SHARE_FILE_SCHEMA_VERSION = 1;
export const PROVIDER_SETTINGS_SHARE_FILE_MAX_BYTES = 64 * 1024;
export const PROVIDER_SETTINGS_SHARE_CIPHERTEXT_MAX_LENGTH = 16_384;
export const PROVIDER_SETTINGS_SHARE_PAYLOAD_MAX_LENGTH = 32_768;

export interface ProviderSettingsShareFile {
  format: typeof PROVIDER_SETTINGS_SHARE_FILE_FORMAT;
  schemaVersion: typeof PROVIDER_SETTINGS_SHARE_FILE_SCHEMA_VERSION;
  encryptedPayload: string;
  createdAt: string;
}

export interface SharedProviderSettingsPayload {
  v: 1;
  kind: 'provider-settings';
  provider: ProviderType;
  config: {
    model: string;
    apiKey?: string;
    baseUrl?: string;
  };
  meta: {
    app: 'educare';
    sharedAt: string;
  };
}

const VISIBLE_PROVIDER_NAMES: Record<ProviderType, string> = {
  gemini: 'Google Gemini',
  openai: 'OpenAI',
  anthropic: 'Anthropic Claude',
  ollama: 'Ollama',
  groq: 'Groq',
  openrouter: 'OpenRouter',
  lmstudio: 'OpenAI 相容端點',
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).length === keys.length && keys.every(key => key in value);

const isCanonicalIsoDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length > 64) {
    return false;
  }
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
};

const isBase64Url = (value: unknown, maxLength: number, minLength = 1): value is string =>
  typeof value === 'string' &&
  value.length >= minLength &&
  value.length <= maxLength &&
  value.length % 4 !== 1 &&
  /^[A-Za-z0-9_-]+$/.test(value);

const decodeBase64UrlJson = (value: string): unknown => {
  const base64 =
    value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(base64);
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0))));
};

const decodeBase64UrlBytes = (value: string): Uint8Array => {
  const base64 =
    value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  return Uint8Array.from(atob(base64), char => char.charCodeAt(0));
};

const isValidEncryptedPayloadEnvelope = (encryptedPayload: string): boolean => {
  if (!isBase64Url(encryptedPayload, PROVIDER_SETTINGS_SHARE_PAYLOAD_MAX_LENGTH, 1)) {
    return false;
  }

  try {
    const parsed = decodeBase64UrlJson(encryptedPayload);
    if (!isRecord(parsed) || !hasExactKeys(parsed, ['iv', 'data', 'salt'])) {
      return false;
    }
    if (
      !isBase64Url(parsed.iv, 16, 16) ||
      !isBase64Url(parsed.salt, 22, 22) ||
      !isBase64Url(parsed.data, PROVIDER_SETTINGS_SHARE_CIPHERTEXT_MAX_LENGTH, 22)
    ) {
      return false;
    }

    const ivBytes = decodeBase64UrlBytes(parsed.iv);
    const saltBytes = decodeBase64UrlBytes(parsed.salt);
    const ciphertextBytes = decodeBase64UrlBytes(parsed.data);
    return ivBytes.length === 12 && saltBytes.length === 16 && ciphertextBytes.length >= 16;
  } catch {
    return false;
  }
};

const getShareableConfig = (config: ProviderConfig): SharedProviderSettingsPayload['config'] => ({
  model: String(config.model || '').trim(),
  apiKey:
    typeof config.apiKey === 'string' && config.apiKey.trim() ? config.apiKey.trim() : undefined,
  baseUrl:
    typeof config.baseUrl === 'string' && config.baseUrl.trim() ? config.baseUrl.trim() : undefined,
});

export function getProviderDisplayName(provider: ProviderType): string {
  return VISIBLE_PROVIDER_NAMES[provider] || provider;
}

export function buildProviderSettingsPayload(
  settings: ProviderSettings,
  provider: ProviderType,
): SharedProviderSettingsPayload {
  const providerSettings = settings.providers[provider];
  if (!providerSettings) {
    throw new Error('找不到要分享的服務商設定');
  }

  const config = getShareableConfig(providerSettings.config);
  if (!config.model) {
    throw new Error('分享前請先設定模型');
  }

  if (!config.apiKey && !config.baseUrl) {
    throw new Error('分享前請先設定 API 金鑰或端點網址');
  }

  return {
    v: 1,
    kind: 'provider-settings',
    provider,
    config,
    meta: {
      app: 'educare',
      sharedAt: new Date().toISOString(),
    },
  };
}

export function getShareableProviderSummary(settings: ProviderSettings, provider: ProviderType) {
  const payload = buildProviderSettingsPayload(settings, provider);
  return {
    provider,
    providerName: getProviderDisplayName(provider),
    model: payload.config.model,
    baseUrl: payload.config.baseUrl,
    hasApiKey: Boolean(payload.config.apiKey),
  };
}

export function getProviderSettingsTransferClassification(): TransferClassification {
  return getTransferClassification('provider-settings');
}

export async function encryptProviderSettingsPayload(
  payload: SharedProviderSettingsPayload,
  password: string,
): Promise<string> {
  return CryptoService.encryptPayload(payload, password);
}

export async function decryptProviderSettingsPayload(
  encryptedPayload: string,
  password: string,
): Promise<SharedProviderSettingsPayload> {
  if (!isValidEncryptedPayloadEnvelope(encryptedPayload)) {
    throw new Error('加密分享內容格式錯誤');
  }

  const payload = await CryptoService.decryptPayload<SharedProviderSettingsPayload>(
    encryptedPayload,
    password,
  );

  validateProviderSettingsPayload(payload);
  return payload;
}

export function validateProviderSettingsPayload(payload: SharedProviderSettingsPayload): void {
  if (
    !payload ||
    !isRecord(payload) ||
    !hasExactKeys(payload, ['v', 'kind', 'provider', 'config', 'meta']) ||
    payload.kind !== 'provider-settings' ||
    payload.v !== 1
  ) {
    throw new Error('不支援的分享內容版本');
  }

  if (!payload.provider || !(payload.provider in VISIBLE_PROVIDER_NAMES)) {
    throw new Error('分享內容中的服務商無效');
  }

  if (
    !isRecord(payload.config) ||
    !hasExactKeys(
      payload.config,
      ['model', 'apiKey', 'baseUrl'].filter(key => key in payload.config),
    ) ||
    typeof payload.config.model !== 'string' ||
    !payload.config.model.trim() ||
    payload.config.model.length > 512
  ) {
    throw new Error('分享內容缺少模型設定');
  }

  if (
    (payload.config.apiKey !== undefined && typeof payload.config.apiKey !== 'string') ||
    (payload.config.baseUrl !== undefined && typeof payload.config.baseUrl !== 'string') ||
    (typeof payload.config.apiKey === 'string' && payload.config.apiKey.length > 4096) ||
    (typeof payload.config.baseUrl === 'string' && payload.config.baseUrl.length > 2048)
  ) {
    throw new Error('分享內容中的連線設定無效');
  }

  if (!payload.config.apiKey?.trim() && !payload.config.baseUrl?.trim()) {
    throw new Error('分享內容缺少 API 金鑰或端點網址');
  }

  if (
    !isRecord(payload.meta) ||
    !hasExactKeys(payload.meta, ['app', 'sharedAt']) ||
    payload.meta.app !== 'educare' ||
    !isCanonicalIsoDate(payload.meta.sharedAt)
  ) {
    throw new Error('分享內容的來源資訊無效');
  }
}

export function buildProviderSettingsShareUrl(encryptedPayload: string): string {
  // New links are deliberately payload-free. The encrypted data travels in a
  // separately downloaded file; the URL is only an entry point for the importer.
  void encryptedPayload;
  return buildProviderSettingsShareEntryUrl();
}

/** Build the QR/entry URL used by new transfers; no encrypted data is put in the URL. */
export function buildProviderSettingsShareEntryUrl(): string {
  if (typeof window === 'undefined') {
    return '';
  }
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set(PROVIDER_SETTINGS_SHARE_PARAM, PROVIDER_SETTINGS_SHARE_ENTRY);
  return url.toString();
}

/** Explicit legacy writer retained only for callers that intentionally create old links. */
export function buildLegacyProviderSettingsShareUrl(encryptedPayload: string): string {
  return CryptoService.generateSharingUrlForParam(PROVIDER_SETTINGS_SHARE_PARAM, encryptedPayload);
}

export function serializeProviderSettingsShareFile(encryptedPayload: string): string {
  if (
    !isBase64Url(encryptedPayload, PROVIDER_SETTINGS_SHARE_PAYLOAD_MAX_LENGTH) ||
    !isValidEncryptedPayloadEnvelope(encryptedPayload)
  ) {
    throw new Error('分享檔案缺少加密內容');
  }
  const file: ProviderSettingsShareFile = {
    format: PROVIDER_SETTINGS_SHARE_FILE_FORMAT,
    schemaVersion: PROVIDER_SETTINGS_SHARE_FILE_SCHEMA_VERSION,
    encryptedPayload,
    createdAt: new Date().toISOString(),
  };
  return JSON.stringify(file, null, 2);
}

export function parseProviderSettingsShareFile(text: string): string {
  try {
    if (
      typeof text !== 'string' ||
      new TextEncoder().encode(text).byteLength > PROVIDER_SETTINGS_SHARE_FILE_MAX_BYTES
    ) {
      throw new Error('share file too large');
    }
    const parsed: unknown = JSON.parse(text);
    if (
      !isRecord(parsed) ||
      !hasExactKeys(parsed, ['format', 'schemaVersion', 'encryptedPayload', 'createdAt']) ||
      (parsed as unknown as ProviderSettingsShareFile).format !==
        PROVIDER_SETTINGS_SHARE_FILE_FORMAT ||
      (parsed as unknown as ProviderSettingsShareFile).schemaVersion !==
        PROVIDER_SETTINGS_SHARE_FILE_SCHEMA_VERSION ||
      !isValidEncryptedPayloadEnvelope(
        (parsed as unknown as ProviderSettingsShareFile).encryptedPayload,
      ) ||
      !isCanonicalIsoDate((parsed as unknown as ProviderSettingsShareFile).createdAt)
    ) {
      throw new Error('invalid share file');
    }
    return (parsed as unknown as ProviderSettingsShareFile).encryptedPayload;
  } catch {
    throw new Error('分享檔案格式錯誤或內容已損毀');
  }
}

export function isProviderSettingsShareEntry(value: string | null): boolean {
  return value === PROVIDER_SETTINGS_SHARE_ENTRY;
}

export function extractProviderSettingsShareFromUrl(): string | null {
  return CryptoService.extractFromUrl(PROVIDER_SETTINGS_SHARE_PARAM);
}

export function clearProviderSettingsShareFromUrl(): void {
  CryptoService.clearUrlParam(PROVIDER_SETTINGS_SHARE_PARAM);
}

export async function applyProviderSettingsPayload(
  payload: SharedProviderSettingsPayload,
  options: { persistence?: 'session' | 'persistent' } = {},
): Promise<void> {
  validateProviderSettingsPayload(payload);

  const { provider, config } = payload;

  // Imported settings are temporary by default. The recipient must explicitly
  // choose persistent storage elsewhere; this protects the legacy global store
  // from an unlocked old bundle or a copied share file.
  if (options.persistence !== 'persistent') {
    if (!providerManager.setSessionProviderConfig) {
      throw new Error('目前環境不支援僅此分頁保存，為避免誤寫入請改用設定頁明確保存。');
    }
    await providerManager.setSessionProviderConfig(provider, config);
    return;
  }

  providerManager.updateProviderConfig(provider, config);
  providerManager.enableProvider(provider, true);
  providerManager.setActiveProvider(provider);

  const providerInstance = providerManager.getProvider(provider);
  if (providerInstance) {
    try {
      await providerInstance.initialize(config);
    } catch (error) {
      console.warn(`Failed to initialize imported provider ${provider}:`, error);
    }
  }
}
