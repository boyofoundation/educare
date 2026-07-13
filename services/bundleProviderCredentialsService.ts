import type { EncryptedProviderSettingsEnvelope, VersionedAgentBundle } from '../types';
import { CryptoService } from './cryptoService';
import { getBundleContentFingerprint } from './agentBundleService';
import type { ProviderConfig, ProviderSettings, ProviderType } from './llmAdapter';
import { buildProviderSettingsPayload } from './providerSettingsShareService';

const PROVIDER_TYPES: readonly ProviderType[] = [
  'gemini',
  'openai',
  'anthropic',
  'ollama',
  'groq',
  'openrouter',
  'lmstudio',
];
const MAX_CIPHERTEXT_LENGTH = 16_384;
const MAX_API_KEY_LENGTH = 4_096;
const MAX_BASE_URL_LENGTH = 2_048;
const MAX_MODEL_LENGTH = 512;
const BUNDLE_PROVIDER_PAYLOAD_KIND = 'bundle-provider-credentials';
const BUNDLE_PROVIDER_PAYLOAD_VERSION = 1;

export const BUNDLE_PROVIDER_CREDENTIALS_ERROR = '無法解密或驗證隨附服務商設定';

export interface BundleProviderCredentials {
  provider: ProviderType;
  config: Pick<ProviderConfig, 'apiKey' | 'baseUrl' | 'model'>;
  credentialFingerprint: string;
}

interface BundleProviderCredentialsPayload {
  kind: typeof BUNDLE_PROVIDER_PAYLOAD_KIND;
  v: typeof BUNDLE_PROVIDER_PAYLOAD_VERSION;
  fingerprint: string;
  provider: ProviderType;
  config: BundleProviderCredentials['config'];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).every(key => keys.includes(key)) && keys.every(key => key in value);

const isBase64Url = (value: unknown, maxLength: number, minLength = 1): value is string =>
  typeof value === 'string' &&
  value.length >= minLength &&
  value.length <= maxLength &&
  /^[A-Za-z0-9_-]+$/.test(value);

const isProviderType = (value: unknown): value is ProviderType =>
  typeof value === 'string' && PROVIDER_TYPES.includes(value as ProviderType);

const sanitizeConfig = (value: unknown): BundleProviderCredentials['config'] | null => {
  if (
    !isRecord(value) ||
    !Object.keys(value).every(key => ['model', 'apiKey', 'baseUrl'].includes(key)) ||
    !('model' in value)
  ) {
    return null;
  }

  const model = typeof value.model === 'string' ? value.model.trim() : '';
  const apiKey = typeof value.apiKey === 'string' ? value.apiKey.trim() : undefined;
  const baseUrl = typeof value.baseUrl === 'string' ? value.baseUrl.trim() : undefined;
  if (
    !model ||
    model.length > MAX_MODEL_LENGTH ||
    (apiKey !== undefined && (!apiKey || apiKey.length > MAX_API_KEY_LENGTH)) ||
    (baseUrl !== undefined && (!baseUrl || baseUrl.length > MAX_BASE_URL_LENGTH)) ||
    (!apiKey && !baseUrl)
  ) {
    return null;
  }

  return {
    model,
    ...(apiKey === undefined ? {} : { apiKey }),
    ...(baseUrl === undefined ? {} : { baseUrl }),
  };
};

export function validateEncryptedProviderSettingsEnvelope(
  value: unknown,
): EncryptedProviderSettingsEnvelope | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['v', 'algorithm', 'kdf', 'salt', 'iv', 'ciphertext'])
  ) {
    return null;
  }
  if (
    value.v !== 1 ||
    value.algorithm !== 'AES-GCM' ||
    !isRecord(value.kdf) ||
    !hasExactKeys(value.kdf, ['name', 'hash', 'iterations']) ||
    value.kdf.name !== 'PBKDF2' ||
    value.kdf.hash !== 'SHA-256' ||
    value.kdf.iterations !== CryptoService.PBKDF2_ITERATIONS ||
    !isBase64Url(value.salt, 22, 22) ||
    !isBase64Url(value.iv, 16, 16) ||
    !isBase64Url(value.ciphertext, MAX_CIPHERTEXT_LENGTH, 16)
  ) {
    return null;
  }

  return {
    v: 1,
    algorithm: 'AES-GCM',
    kdf: {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations: CryptoService.PBKDF2_ITERATIONS,
    },
    salt: value.salt,
    iv: value.iv,
    ciphertext: value.ciphertext,
  };
}

export async function encryptBundleProviderCredentials(
  bundle: VersionedAgentBundle,
  settings: ProviderSettings,
  provider: ProviderType,
  password: string,
): Promise<EncryptedProviderSettingsEnvelope> {
  try {
    const sharedPayload = buildProviderSettingsPayload(settings, provider);
    const config = sanitizeConfig(sharedPayload.config);
    if (!config || !password) {
      throw new Error(BUNDLE_PROVIDER_CREDENTIALS_ERROR);
    }
    const fingerprint = await getBundleContentFingerprint(bundle);
    const payload: BundleProviderCredentialsPayload = {
      kind: BUNDLE_PROVIDER_PAYLOAD_KIND,
      v: BUNDLE_PROVIDER_PAYLOAD_VERSION,
      fingerprint,
      provider,
      config,
    };
    const encrypted = await CryptoService.encryptPayloadWithPassword(payload, password, {
      additionalData: fingerprint,
      iterations: CryptoService.PBKDF2_ITERATIONS,
    });

    return {
      v: 1,
      algorithm: 'AES-GCM',
      kdf: {
        name: 'PBKDF2',
        hash: 'SHA-256',
        iterations: CryptoService.PBKDF2_ITERATIONS,
      },
      salt: encrypted.salt,
      iv: encrypted.iv,
      ciphertext: encrypted.data,
    };
  } catch {
    throw new Error(BUNDLE_PROVIDER_CREDENTIALS_ERROR);
  }
}

export async function decryptBundleProviderCredentials(
  bundle: VersionedAgentBundle,
  password: string,
  importedBundleId?: string,
): Promise<BundleProviderCredentials> {
  try {
    if (bundle.manifest.schemaVersion !== 2 || !bundle.encryptedProviderSettings || !password) {
      throw new Error(BUNDLE_PROVIDER_CREDENTIALS_ERROR);
    }
    const envelope = validateEncryptedProviderSettingsEnvelope(bundle.encryptedProviderSettings);
    if (!envelope) {
      throw new Error(BUNDLE_PROVIDER_CREDENTIALS_ERROR);
    }
    const fingerprint = await getBundleContentFingerprint(bundle, importedBundleId);
    const payload =
      await CryptoService.decryptPayloadWithPassword<BundleProviderCredentialsPayload>(
        { salt: envelope.salt, iv: envelope.iv, data: envelope.ciphertext },
        password,
        {
          additionalData: fingerprint,
          iterations: envelope.kdf.iterations,
        },
      );
    const config = sanitizeConfig(payload?.config);
    if (
      !payload ||
      payload.kind !== BUNDLE_PROVIDER_PAYLOAD_KIND ||
      payload.v !== BUNDLE_PROVIDER_PAYLOAD_VERSION ||
      payload.fingerprint !== fingerprint ||
      !isProviderType(payload.provider) ||
      !config
    ) {
      throw new Error(BUNDLE_PROVIDER_CREDENTIALS_ERROR);
    }

    return {
      provider: payload.provider,
      config,
      credentialFingerprint: fingerprint,
    };
  } catch {
    throw new Error(BUNDLE_PROVIDER_CREDENTIALS_ERROR);
  }
}
