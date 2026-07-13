/**
 * @vitest-environment happy-dom
 */

import { webcrypto } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AgentBundle, AgentBundleV2 } from '../types';
import type { ProviderSettings } from './llmAdapter';
import {
  AGENT_BUNDLE_FORMAT,
  buildImportedBundle,
  getBundleContentFingerprint,
} from './agentBundleService';
import {
  BUNDLE_PROVIDER_CREDENTIALS_ERROR,
  decryptBundleProviderCredentials,
  encryptBundleProviderCredentials,
  validateEncryptedProviderSettingsEnvelope,
} from './bundleProviderCredentialsService';

const bundle: AgentBundle = {
  manifest: {
    format: AGENT_BUNDLE_FORMAT,
    schemaVersion: 1,
    name: 'STEM Team',
    description: 'Teaching assistants',
    version: '1.0.0',
    exportedAt: 1_700_000_000_000,
    entryAgentId: 'math-tutor',
  },
  agents: [
    {
      id: 'math-tutor',
      name: 'Math Tutor',
      description: 'Helps with algebra.',
      systemPrompt: 'Teach math clearly.',
      starterPrompts: [],
      ragChunks: [],
    },
  ],
  routes: [],
};

const settings = {
  activeProvider: 'openai',
  providers: {
    gemini: { enabled: false, config: { model: 'gemini-2.5-flash' } },
    openai: { enabled: true, config: { model: 'gpt-4o-mini', apiKey: 'bundle-secret' } },
    anthropic: { enabled: false, config: { model: 'claude-opus-4-8' } },
    ollama: {
      enabled: false,
      config: { model: 'llama3.2:latest', baseUrl: 'http://localhost:11434' },
    },
    groq: { enabled: false, config: { model: 'llama-3.1-70b-versatile' } },
    openrouter: { enabled: false, config: { model: 'openai/gpt-4o' } },
    lmstudio: {
      enabled: false,
      config: { model: 'local-model', baseUrl: 'http://localhost:1234/v1' },
    },
  },
} satisfies ProviderSettings;

const createCredentialBundle = async (): Promise<AgentBundleV2> => {
  const v2Bundle: AgentBundleV2 = {
    ...bundle,
    manifest: { ...bundle.manifest, schemaVersion: 2 },
  };
  return {
    ...v2Bundle,
    encryptedProviderSettings: await encryptBundleProviderCredentials(
      v2Bundle,
      settings,
      'openai',
      'shared-password',
    ),
  };
};

describe('bundleProviderCredentialsService', () => {
  beforeAll(() => {
    Object.defineProperty(globalThis, 'crypto', {
      value: webcrypto,
      configurable: true,
    });
  });

  it('encrypts provider settings without serializing plaintext credentials', async () => {
    const credentialBundle = await createCredentialBundle();
    const serialized = JSON.stringify(credentialBundle);

    expect(credentialBundle.manifest.schemaVersion).toBe(2);
    expect(serialized).not.toContain('bundle-secret');
    expect(serialized).not.toContain('"apiKey"');

    await expect(
      decryptBundleProviderCredentials(credentialBundle, 'shared-password'),
    ).resolves.toEqual({
      provider: 'openai',
      config: { model: 'gpt-4o-mini', apiKey: 'bundle-secret' },
      credentialFingerprint: await getBundleContentFingerprint(credentialBundle),
    });
  });

  it('binds credentials to the unnamespaced public bundle content', async () => {
    const credentialBundle = await createCredentialBundle();
    const imported = buildImportedBundle(credentialBundle);

    await expect(
      decryptBundleProviderCredentials(imported.bundle, 'shared-password', imported.id),
    ).resolves.toMatchObject({ provider: 'openai', config: { apiKey: 'bundle-secret' } });

    const changedBundle: AgentBundleV2 = {
      ...credentialBundle,
      manifest: { ...credentialBundle.manifest, name: 'Modified Team' },
    };
    await expect(
      decryptBundleProviderCredentials(changedBundle, 'shared-password'),
    ).rejects.toThrow(BUNDLE_PROVIDER_CREDENTIALS_ERROR);
  });

  it('returns generic errors for wrong passwords and malformed envelopes', async () => {
    const credentialBundle = await createCredentialBundle();

    await expect(
      decryptBundleProviderCredentials(credentialBundle, 'wrong-password'),
    ).rejects.toThrow(BUNDLE_PROVIDER_CREDENTIALS_ERROR);
    expect(
      validateEncryptedProviderSettingsEnvelope({
        ...credentialBundle.encryptedProviderSettings,
        apiKey: 'plaintext-not-allowed',
      }),
    ).toBeNull();
  });

  it('encrypts and restores an Anthropic API key without serializing it in the v2 bundle', async () => {
    const anthropicSettings: ProviderSettings = {
      ...settings,
      activeProvider: 'anthropic',
      providers: {
        ...settings.providers,
        anthropic: {
          enabled: true,
          config: { model: 'claude-sonnet-4-6', apiKey: 'anthropic-bundle-secret' },
        },
      },
    };
    const v2Bundle: AgentBundleV2 = {
      ...bundle,
      manifest: { ...bundle.manifest, schemaVersion: 2 },
    };
    const credentialBundle: AgentBundleV2 = {
      ...v2Bundle,
      encryptedProviderSettings: await encryptBundleProviderCredentials(
        v2Bundle,
        anthropicSettings,
        'anthropic',
        'shared-password',
      ),
    };

    expect(JSON.stringify(credentialBundle)).not.toContain('anthropic-bundle-secret');
    await expect(
      decryptBundleProviderCredentials(credentialBundle, 'shared-password'),
    ).resolves.toMatchObject({
      provider: 'anthropic',
      config: { model: 'claude-sonnet-4-6', apiKey: 'anthropic-bundle-secret' },
    });
  });
});
