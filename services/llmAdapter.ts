import { ChatMessage, FinishReason, MessageAttachment, MessageImage } from '../types';

export interface ProviderUsageMetadata {
  source: 'api' | 'unavailable';
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  toolUseTokens?: number;
}

export interface StreamingResponse {
  text: string;
  isComplete: boolean;
  images?: MessageImage[];
  toolCalls?: ToolCall[];
  metadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    model?: string;
    provider?: string;
    usage?: ProviderUsageMetadata;
    toolRoundCount?: number;
    repeatedRecoverableErrors?: Array<{
      toolName: string;
      code: string;
      count: number;
    }>;
    /** Agentic harness 結束原因 (G13/T1)。預算耗盡不再 throw。*/
    finishReason?: FinishReason;
    images?: MessageImage[];
  };
}

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  prompt?: string;
}

export type ToolChoicePolicy =
  | { mode: 'auto' | 'none' | 'requireAny' }
  | { mode: 'requireSpecific'; name: string };

export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  maxToolRounds?: number;
  [key: string]: string | number | boolean | undefined;
}

export interface ChatParams {
  systemPrompt: string;
  ragContext?: string;
  history: ChatMessage[];
  message: string;
  /**
   * 本回合使用者訊息附加的圖片。僅在作用中模型支援多模態時由 UI 傳入;
   * 各 provider 將其轉為對應 API 的圖片內容格式。歷史訊息中的圖片
   * 由 history 內各 ChatMessage 的 attachments 欄位攜帶。
   */
  attachments?: MessageAttachment[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDefinition[];
  allowedToolNames?: string[];
  toolChoice?: ToolChoicePolicy;
  executeTool?: (call: ToolCall) => Promise<unknown> | unknown;
  /**
   * Per-call tool-round override for nested/subagent runs. When omitted,
   * providers fall back to their configured maxToolRounds.
   */
  maxToolRounds?: number;
  /**
   * 續跑回合直接指定的 pack 集合 (G2)。由 controller 在續跑回合傳入,
   * 繞過 intent 分類器,避免續跑被重路由。
   */
  packSetOverride?: string[];
  /**
   * AbortSignal (G4/G17)。串流與所有 fetch 應接收並轉發;
   * 每輪迴圈開頭檢查 aborted 以便在 ~1 輪內中止,保證不產生半個 turn。
   */
  signal?: AbortSignal;
}

export interface LLMProvider {
  readonly name: string;
  readonly displayName: string;
  readonly supportedModels: string[];
  readonly requiresApiKey: boolean;
  readonly supportsLocalMode: boolean;

  initialize(config: ProviderConfig): Promise<void>;
  isAvailable(): boolean;
  streamChat(params: ChatParams): AsyncIterable<StreamingResponse>;
  getAvailableModels?(): Promise<string[]>;
  reinitialize?(): void;
}

export type ProviderType =
  | 'gemini'
  | 'openai'
  | 'anthropic'
  | 'ollama'
  | 'groq'
  | 'openrouter'
  | 'lmstudio';

export interface ProviderSettings {
  activeProvider: ProviderType;
  providers: {
    [key in ProviderType]: {
      enabled: boolean;
      config: ProviderConfig;
    };
  };
}

export const DEFAULT_PROVIDER_SETTINGS: ProviderSettings = {
  activeProvider: 'gemini',
  providers: {
    gemini: {
      enabled: true,
      config: {
        model: 'gemini-2.5-flash',
        temperature: 0.7,
        maxTokens: 4096,
        maxToolRounds: 50,
      },
    },
    openai: {
      enabled: false,
      config: {
        model: 'gpt-4o',
        temperature: 0.7,
        maxTokens: 4096,
        maxToolRounds: 50,
      },
    },
    anthropic: {
      enabled: false,
      config: {
        model: 'claude-opus-4-8',
        temperature: 0.7,
        maxTokens: 4096,
        maxToolRounds: 50,
      },
    },
    ollama: {
      enabled: false,
      config: {
        baseUrl: 'http://localhost:11434',
        model: 'llama3.2:latest',
        temperature: 0.7,
        maxTokens: 4096,
        maxToolRounds: 50,
      },
    },
    groq: {
      enabled: false,
      config: {
        model: 'llama-3.1-70b-versatile',
        temperature: 0.7,
        maxTokens: 4096,
        maxToolRounds: 50,
      },
    },
    openrouter: {
      enabled: false,
      config: {
        model: 'openai/gpt-4o',
        temperature: 0.7,
        maxTokens: 4096,
        maxToolRounds: 50,
      },
    },
    lmstudio: {
      enabled: false,
      config: {
        baseUrl: 'http://localhost:1234/v1',
        model: 'local-model',
        temperature: 0.7,
        maxTokens: 4096,
        maxToolRounds: 50,
      },
    },
  },
};

const sanitizeNumber = (
  value: unknown,
  fallback: number,
  options?: { min?: number; max?: number },
): number => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  const roundedValue = Number.isInteger(fallback) ? Math.round(numericValue) : numericValue;
  const min = options?.min ?? roundedValue;
  const max = options?.max ?? roundedValue;
  return Math.min(max, Math.max(min, roundedValue));
};

const sanitizeProviderConfig = (
  defaultConfig: ProviderConfig,
  savedConfig?: Partial<ProviderConfig>,
): ProviderConfig => ({
  ...defaultConfig,
  ...savedConfig,
  temperature: sanitizeNumber(savedConfig?.temperature, defaultConfig.temperature ?? 0.7, {
    min: 0,
    max: 2,
  }),
  maxTokens: sanitizeNumber(savedConfig?.maxTokens, defaultConfig.maxTokens ?? 4096, {
    min: 100,
    max: 64000,
  }),
  maxToolRounds: sanitizeNumber(savedConfig?.maxToolRounds, defaultConfig.maxToolRounds ?? 50, {
    min: 1,
    max: 200,
  }),
});

export interface SessionProviderOverride {
  type: ProviderType;
  config: ProviderConfig;
}

export interface BundleProviderOverrideSource {
  kind: 'bundle';
  bundleId: string;
  credentialFingerprint: string;
}

interface BundleProviderOverride extends SessionProviderOverride {
  source: BundleProviderOverrideSource;
}

export const BUNDLE_SESSION_PROVIDER_STORAGE_KEY = 'educare_bundle_session_provider';

/** Provider 設定(active provider / model / config)變更時發出的 window 事件。 */
export const PROVIDER_SETTINGS_CHANGED_EVENT = 'educare:provider-settings-changed';

const emitProviderSettingsChanged = (): void => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(PROVIDER_SETTINGS_CHANGED_EVENT));
  }
};

export class ProviderManager {
  private static instance: ProviderManager;
  private providers: Map<ProviderType, LLMProvider> = new Map();
  private settings: ProviderSettings;
  private sessionProviderOverride: SessionProviderOverride | null;
  private bundleProviderOverride: BundleProviderOverride | null = null;

  private constructor() {
    this.settings = this.loadSettings();
    this.sessionProviderOverride = this.loadSessionProviderOverride();
  }

  static getInstance(): ProviderManager {
    if (!ProviderManager.instance) {
      ProviderManager.instance = new ProviderManager();
    }
    return ProviderManager.instance;
  }

  private loadSettings(): ProviderSettings {
    const saved = localStorage.getItem('providerSettings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as Partial<ProviderSettings>;
        const mergedProviders = (
          Object.keys(DEFAULT_PROVIDER_SETTINGS.providers) as ProviderType[]
        ).reduce(
          (acc, providerType) => {
            const defaultProvider = DEFAULT_PROVIDER_SETTINGS.providers[providerType];
            const savedProvider = parsed.providers?.[providerType];

            acc[providerType] = {
              ...defaultProvider,
              ...savedProvider,
              config: sanitizeProviderConfig(defaultProvider.config, savedProvider?.config),
            };

            return acc;
          },
          {} as ProviderSettings['providers'],
        );

        return {
          ...DEFAULT_PROVIDER_SETTINGS,
          ...parsed,
          providers: mergedProviders,
        };
      } catch (error) {
        console.warn('Failed to parse provider settings, using defaults:', error);
      }
    }
    return DEFAULT_PROVIDER_SETTINGS;
  }

  private loadSessionProviderOverride(): SessionProviderOverride | null {
    if (typeof sessionStorage === 'undefined') {
      return null;
    }

    try {
      const raw = sessionStorage.getItem(BUNDLE_SESSION_PROVIDER_STORAGE_KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw) as Partial<SessionProviderOverride>;
      if (!parsed.type || !parsed.config || !(parsed.type in DEFAULT_PROVIDER_SETTINGS.providers)) {
        return null;
      }
      const type = parsed.type as ProviderType;
      return {
        type,
        config: sanitizeProviderConfig(
          DEFAULT_PROVIDER_SETTINGS.providers[type].config,
          parsed.config,
        ),
      };
    } catch {
      sessionStorage.removeItem(BUNDLE_SESSION_PROVIDER_STORAGE_KEY);
      return null;
    }
  }

  async setSessionProviderConfig(
    type: ProviderType,
    config: Partial<ProviderConfig>,
  ): Promise<void> {
    const provider = this.providers.get(type);
    if (!provider) {
      throw new Error('找不到指定的 AI 服務商。');
    }

    const configured = sanitizeProviderConfig(
      DEFAULT_PROVIDER_SETTINGS.providers[type].config,
      config,
    );
    const override = { type, config: configured };
    this.sessionProviderOverride = override;
    sessionStorage.setItem(BUNDLE_SESSION_PROVIDER_STORAGE_KEY, JSON.stringify(override));

    if (provider.reinitialize) {
      provider.reinitialize();
    }
    await provider.initialize(configured);
    emitProviderSettingsChanged();
  }

  clearSessionProviderConfig(): void {
    this.sessionProviderOverride = null;
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(BUNDLE_SESSION_PROVIDER_STORAGE_KEY);
    }
    emitProviderSettingsChanged();
  }

  async setBundleProviderConfig(
    source: BundleProviderOverrideSource,
    type: ProviderType,
    config: Partial<ProviderConfig>,
  ): Promise<void> {
    const provider = this.providers.get(type);
    if (
      !provider ||
      source.kind !== 'bundle' ||
      !source.bundleId ||
      !source.credentialFingerprint
    ) {
      throw new Error('無法啟用隨附服務商設定。');
    }

    const previousOverride = this.bundleProviderOverride;
    const configured = sanitizeProviderConfig(
      DEFAULT_PROVIDER_SETTINGS.providers[type].config,
      config,
    );
    this.bundleProviderOverride = {
      source: { ...source },
      type,
      config: configured,
    };

    try {
      if (provider.reinitialize) {
        provider.reinitialize();
      }
      await provider.initialize(configured);
      emitProviderSettingsChanged();
    } catch {
      this.bundleProviderOverride = null;
      provider.reinitialize?.();

      if (previousOverride) {
        const previousProvider = this.providers.get(previousOverride.type);
        try {
          if (!previousProvider) {
            throw new Error('Previous bundle provider is unavailable.');
          }
          previousProvider.reinitialize?.();
          await previousProvider.initialize(previousOverride.config);
          this.bundleProviderOverride = previousOverride;
        } catch {
          this.bundleProviderOverride = null;
        }
      }

      throw new Error('無法啟用隨附服務商設定。');
    }
  }

  getBundleProviderOverrideSource(): BundleProviderOverrideSource | null {
    return this.bundleProviderOverride ? { ...this.bundleProviderOverride.source } : null;
  }

  matchesBundleProviderOverride(source: BundleProviderOverrideSource): boolean {
    return (
      source.kind === 'bundle' &&
      this.bundleProviderOverride?.source.bundleId === source.bundleId &&
      this.bundleProviderOverride.source.credentialFingerprint === source.credentialFingerprint
    );
  }

  async clearBundleProviderConfig(source: BundleProviderOverrideSource): Promise<boolean> {
    if (!this.matchesBundleProviderOverride(source)) {
      return false;
    }

    const bundleProviderType = this.bundleProviderOverride!.type;
    this.bundleProviderOverride = null;

    const activeProviderType = this.sessionProviderOverride?.type ?? this.settings.activeProvider;
    const configFor = (type: ProviderType): ProviderConfig =>
      type === this.sessionProviderOverride?.type
        ? this.sessionProviderOverride.config
        : sanitizeProviderConfig(
            DEFAULT_PROVIDER_SETTINGS.providers[type].config,
            this.settings.providers[type]?.config,
          );
    const resetProvider = async (type: ProviderType) => {
      const provider = this.providers.get(type);
      if (!provider) {
        return;
      }

      provider.reinitialize?.();
      await provider.initialize(configFor(type));
    };

    try {
      await resetProvider(bundleProviderType);
    } catch {
      // reinitialize above has already removed the bundle credential; continue restoring the active provider.
    }

    if (activeProviderType !== bundleProviderType) {
      try {
        await resetProvider(activeProviderType);
      } catch {
        // Cleanup must not reactivate the encrypted bundle credential when a fallback provider is unavailable.
      }
    }

    emitProviderSettingsChanged();
    return true;
  }

  getSessionProviderConfig(): SessionProviderOverride | null {
    return this.sessionProviderOverride
      ? { ...this.sessionProviderOverride, config: { ...this.sessionProviderOverride.config } }
      : null;
  }

  saveSettings(): void {
    localStorage.setItem('providerSettings', JSON.stringify(this.settings));
    emitProviderSettingsChanged();
  }

  /**
   * 目前作用中的 provider、model 與 config(依 bundle override → session
   * override → 全域設定的優先序解析)。用於模型能力偵測(如多模態圖片輸入):
   * config 提供本地 provider 能力查詢所需的 baseUrl。
   */
  getActiveModelInfo(): { provider: ProviderType; model: string; config: ProviderConfig } | null {
    const activeOverride = this.bundleProviderOverride ?? this.sessionProviderOverride;
    const providerType = activeOverride?.type ?? this.settings.activeProvider;
    const config = activeOverride?.config ?? this.settings.providers[providerType]?.config;
    const model =
      typeof config?.model === 'string' && config.model
        ? config.model
        : (DEFAULT_PROVIDER_SETTINGS.providers[providerType]?.config.model ?? '');

    return model ? { provider: providerType, model, config: { ...config } } : null;
  }

  registerProvider(type: ProviderType, provider: LLMProvider): void {
    this.providers.set(type, provider);
  }

  getProvider(type?: ProviderType): LLMProvider | null {
    const providerType = type || this.sessionProviderOverride?.type || this.settings.activeProvider;
    return this.providers.get(providerType) || null;
  }

  getActiveProvider(): LLMProvider | null {
    return this.getProvider(
      this.bundleProviderOverride?.type ??
        this.sessionProviderOverride?.type ??
        this.settings.activeProvider,
    );
  }

  setActiveProvider(type: ProviderType): void {
    if (this.providers.has(type)) {
      this.settings.activeProvider = type;
      this.saveSettings();
    }
  }

  getSettings(): ProviderSettings {
    return { ...this.settings };
  }

  updateProviderConfig(type: ProviderType, config: Partial<ProviderConfig>): void {
    if (this.settings.providers[type]) {
      const mergedConfig = {
        ...this.settings.providers[type].config,
        ...config,
      };
      this.settings.providers[type].config = sanitizeProviderConfig(
        DEFAULT_PROVIDER_SETTINGS.providers[type].config,
        mergedConfig,
      );
      this.saveSettings();

      // Reinitialize the provider if it exists with the updated config
      const provider = this.providers.get(type);
      if (provider) {
        // Pass the updated config to the provider
        const updatedConfig = this.settings.providers[type].config;
        if (provider.reinitialize) {
          provider.reinitialize();
        }
        // Initialize with the updated config
        provider.initialize(updatedConfig).catch(error => {
          console.warn(`Failed to reinitialize ${type} provider:`, error);
        });
      }
    }
  }

  enableProvider(type: ProviderType, enabled = true): void {
    if (this.settings.providers[type]) {
      this.settings.providers[type].enabled = enabled;
      this.saveSettings();
    }
  }

  isProviderEnabled(type: ProviderType): boolean {
    return (
      this.bundleProviderOverride?.type === type ||
      this.sessionProviderOverride?.type === type ||
      this.settings.providers[type]?.enabled ||
      false
    );
  }

  getAvailableProviders(): Array<{ type: ProviderType; provider: LLMProvider }> {
    return Array.from(this.providers.entries())
      .filter(([type, provider]) => this.isProviderEnabled(type) && provider.isAvailable())
      .map(([type, provider]) => ({ type, provider }));
  }

  async streamChat(params: ChatParams): Promise<AsyncIterable<StreamingResponse>> {
    const activeProvider = this.getActiveProvider();
    if (!activeProvider) {
      throw new Error('No active LLM provider available');
    }
    console.log('[CHAT DEBUG] Using provider for chat:', activeProvider.name);

    if (!activeProvider.isAvailable()) {
      throw new Error(`Provider ${activeProvider.displayName} is not available`);
    }

    return activeProvider.streamChat(params);
  }
}
