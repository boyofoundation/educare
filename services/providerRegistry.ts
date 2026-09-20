import {
  ProviderManager,
  PROVIDER_SETTINGS_CHANGED_EVENT,
  type LLMProvider,
  type ProviderType,
} from './llmAdapter';

let providerManagerInstance: ProviderManager | null = null;
let initializationPromise: Promise<void> | null = null;

type ProviderLoader = {
  name: ProviderType;
  load: () => Promise<LLMProvider>;
};

// Provider implementations are intentionally loaded only when provider initialization is requested.
// Gemini brings the largest third-party runtime into the graph, while the native providers
// should not be part of the initial application module either.
const providerLoaders: ProviderLoader[] = [
  {
    name: 'gemini',
    load: async () => new (await import('./providers/geminiProvider')).GeminiProvider(),
  },
  {
    name: 'openai',
    load: async () => new (await import('./providers/openaiNativeProvider')).OpenAINativeProvider(),
  },
  {
    name: 'anthropic',
    load: async () => new (await import('./providers/anthropicProvider')).AnthropicProvider(),
  },
  {
    name: 'openrouter',
    load: async () => new (await import('./providers/openrouterProvider')).OpenRouterProvider(),
  },
  {
    name: 'lmstudio',
    load: async () => new (await import('./providers/lmstudioProvider')).LMStudioProvider(),
  },
  {
    name: 'ollama',
    load: async () => new (await import('./providers/ollamaNativeProvider')).OllamaNativeProvider(),
  },
  {
    name: 'groq',
    load: async () => new (await import('./providers/groqNativeProvider')).GroqNativeProvider(),
  },
];

// Simple lazy initialization without immediate execution
export function getProviderManager(): ProviderManager {
  if (!providerManagerInstance) {
    providerManagerInstance = ProviderManager.getInstance();

    // Don't initialize providers immediately to avoid stack overflow
    // They will be initialized when first accessed
  }

  return providerManagerInstance;
}

// Initialize providers asynchronously when needed. Keep the in-flight promise shared so
// callers racing during application startup all observe the same registration result.
export function initializeProviders(): Promise<void> {
  const manager = getProviderManager();
  if (initializationPromise) {
    return initializationPromise;
  }

  const promise = (async () => {
    const loadFailures = new Map<ProviderType, unknown>();

    try {
      // Import implementations in parallel, then register them in a stable order so the
      // available-provider order remains unchanged from the previous static implementation.
      const loadedProviders = await Promise.all(
        providerLoaders.map(async ({ name, load }) => {
          try {
            return { name, provider: await load() };
          } catch (error) {
            loadFailures.set(name, error);
            console.warn(`⚠️ Failed to load ${name} provider:`, error);
            return null;
          }
        }),
      );

      for (const loaded of loadedProviders) {
        if (loaded) {
          manager.registerProvider(loaded.name, loaded.provider);
          console.log(`✅ ${loaded.name} provider loaded successfully`);
        }
      }

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event(PROVIDER_SETTINGS_CHANGED_EVENT));
      }

      // An active or explicitly enabled provider is part of the configured contract. Optional
      // provider chunks can still fail without blocking startup, but a configured provider that
      // was not registered must be reported so settings can offer a retry.
      const settings = manager.getSettings();
      const configuredProviderTypes = new Set<ProviderType>([
        settings.activeProvider,
        ...Object.entries(settings.providers)
          .filter(([, providerSettings]) => providerSettings.enabled)
          .map(([providerType]) => providerType as ProviderType),
      ]);
      const missingProviderTypes = [...configuredProviderTypes].filter(
        providerType => !manager.getProvider(providerType),
      );

      if (missingProviderTypes.length > 0) {
        const failureDetails = missingProviderTypes
          .map(providerType => {
            const failure = loadFailures.get(providerType);
            return failure instanceof Error ? `${providerType}: ${failure.message}` : providerType;
          })
          .join('; ');
        throw new Error(`無法載入設定中的 AI 服務商：${failureDetails}`);
      }

      // Initialize providers with their configurations.
      for (const [providerType, providerSettings] of Object.entries(settings.providers)) {
        if (providerSettings.enabled) {
          const provider = manager.getProvider(providerType as ProviderType);
          if (provider) {
            await provider.initialize(providerSettings.config).catch(error => {
              console.warn(`Failed to initialize ${providerType} provider:`, error);
            });
          }
        }
      }

      console.log('✅ All configured provider modules registered successfully');
    } catch (error) {
      console.error('❌ Failed to initialize providers:', error);
      throw error;
    }
  })();

  initializationPromise = promise;
  // Clear only this attempt. A rejected attempt must be retryable, while concurrent callers
  // continue to receive the same promise until it settles.
  void promise.then(
    () => {
      if (initializationPromise === promise) {
        initializationPromise = null;
      }
    },
    () => {
      if (initializationPromise === promise) {
        initializationPromise = null;
      }
    },
  );

  return promise;
}

// Export the lazy getter
export const providerManager = getProviderManager();

export function isLLMAvailable(): boolean {
  return providerManager.getAvailableProviders().length > 0;
}
