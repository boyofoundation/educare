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

/**
 * Session-scoped provider overrides are keyed by provider so editing one
 * provider cannot discard another provider's temporary credentials.
 *
 * The storage reader still accepts the legacy single `{ type, config }`
 * representation and normalizes it into this map.
 */
export type SessionProviderOverrides = Partial<Record<ProviderType, SessionProviderOverride>>;

export interface BundleProviderOverrideSource {
  kind: 'bundle';
  bundleId: string;
  credentialFingerprint: string;
}

interface BundleProviderOverride extends SessionProviderOverride {
  source: BundleProviderOverrideSource;
}

const BUNDLE_SOURCE_TOKEN = Symbol('bundle-source-token');
type OwnedBundleProviderOverrideSource = BundleProviderOverrideSource & {
  [BUNDLE_SOURCE_TOKEN]?: symbol;
};

export const BUNDLE_SESSION_PROVIDER_STORAGE_KEY = 'educare_bundle_session_provider';

/** Provider 設定(active provider / model / config)變更時發出的 window 事件。 */
export const PROVIDER_SETTINGS_CHANGED_EVENT = 'educare:provider-settings-changed';

const emitProviderSettingsChanged = (): void => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(PROVIDER_SETTINGS_CHANGED_EVENT));
  }
};

const getBundleSourceToken = (source: BundleProviderOverrideSource): symbol | undefined =>
  (source as OwnedBundleProviderOverrideSource)[BUNDLE_SOURCE_TOKEN];

const ensureBundleSourceToken = (source: BundleProviderOverrideSource): symbol => {
  const existing = getBundleSourceToken(source);
  if (existing) {
    return existing;
  }
  const token = Symbol('bundle-source-owner');
  Object.defineProperty(source, BUNDLE_SOURCE_TOKEN, {
    configurable: false,
    enumerable: false,
    value: token,
  });
  return token;
};

export class ProviderManager {
  private static instance: ProviderManager;
  private providers: Map<ProviderType, LLMProvider> = new Map();
  private settings: ProviderSettings;
  private sessionProviderOverrides: SessionProviderOverrides;
  private bundleProviderOverride: BundleProviderOverride | null = null;
  private bundleProviderOperation: Promise<void> = Promise.resolve();

  private constructor() {
    this.settings = this.loadSettings();
    this.sessionProviderOverrides = this.loadSessionProviderOverrides();
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

  private cloneSessionProviderOverrides(
    overrides: SessionProviderOverrides,
  ): SessionProviderOverrides {
    return Object.fromEntries(
      Object.entries(overrides).map(([type, override]) => [
        type,
        override
          ? {
              type: override.type,
              config: { ...override.config },
            }
          : override,
      ]),
    ) as SessionProviderOverrides;
  }

  private readSessionProviderStorage(): string | null {
    if (typeof sessionStorage === 'undefined') {
      return null;
    }
    try {
      return sessionStorage.getItem(BUNDLE_SESSION_PROVIDER_STORAGE_KEY);
    } catch {
      return null;
    }
  }

  private restoreSessionProviderStorage(value: string | null): void {
    if (typeof sessionStorage === 'undefined') {
      return;
    }
    try {
      if (value === null) {
        sessionStorage.removeItem(BUNDLE_SESSION_PROVIDER_STORAGE_KEY);
      } else {
        sessionStorage.setItem(BUNDLE_SESSION_PROVIDER_STORAGE_KEY, value);
      }
    } catch {
      // Storage failures are handled by the caller's in-memory rollback.
    }
  }

  private writeSessionProviderOverrides(overrides: SessionProviderOverrides): void {
    if (typeof sessionStorage === 'undefined') {
      return;
    }

    const entries = Object.entries(overrides).filter(([, override]) => Boolean(override));
    if (entries.length === 0) {
      sessionStorage.removeItem(BUNDLE_SESSION_PROVIDER_STORAGE_KEY);
      return;
    }

    sessionStorage.setItem(
      BUNDLE_SESSION_PROVIDER_STORAGE_KEY,
      JSON.stringify(Object.fromEntries(entries)),
    );
  }

  private parseSessionProviderOverride(
    value: unknown,
    expectedType?: ProviderType,
  ): SessionProviderOverride | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const candidate = value as Partial<SessionProviderOverride>;
    const type = candidate.type ?? expectedType;
    if (
      !type ||
      !(type in DEFAULT_PROVIDER_SETTINGS.providers) ||
      (expectedType !== undefined && type !== expectedType) ||
      !candidate.config ||
      typeof candidate.config !== 'object' ||
      Array.isArray(candidate.config)
    ) {
      return null;
    }

    return {
      type,
      config: sanitizeProviderConfig(
        DEFAULT_PROVIDER_SETTINGS.providers[type].config,
        candidate.config,
      ),
    };
  }

  private loadSessionProviderOverrides(): SessionProviderOverrides {
    const raw = this.readSessionProviderStorage();
    if (!raw) {
      return {};
    }

    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('invalid session provider settings');
      }

      // Backward-compatible reader for the previous single-slot format.
      const legacyOverride = this.parseSessionProviderOverride(parsed);
      if (legacyOverride) {
        return { [legacyOverride.type]: legacyOverride };
      }

      const overrides: SessionProviderOverrides = {};
      for (const providerType of Object.keys(
        DEFAULT_PROVIDER_SETTINGS.providers,
      ) as ProviderType[]) {
        const override = this.parseSessionProviderOverride(
          (parsed as Record<string, unknown>)[providerType],
          providerType,
        );
        if (override) {
          overrides[providerType] = override;
        }
      }
      return overrides;
    } catch {
      this.restoreSessionProviderStorage(null);
      return {};
    }
  }

  private getProviderConfigForType(type: ProviderType): ProviderConfig {
    if (this.bundleProviderOverride?.type === type) {
      return { ...this.bundleProviderOverride.config };
    }
    const sessionOverride = this.sessionProviderOverrides[type];
    if (sessionOverride) {
      return { ...sessionOverride.config };
    }
    return sanitizeProviderConfig(
      DEFAULT_PROVIDER_SETTINGS.providers[type].config,
      this.settings.providers[type]?.config,
    );
  }

  private getActiveSessionProviderOverride(): SessionProviderOverride | null {
    const activeOverride = this.sessionProviderOverrides[this.settings.activeProvider];
    if (activeOverride) {
      return activeOverride;
    }

    const overrides = Object.values(this.sessionProviderOverrides);
    return overrides.at(-1) ?? null;
  }

  private async restoreProviderConfig(type: ProviderType, config: ProviderConfig): Promise<void> {
    const provider = this.providers.get(type);
    if (!provider) {
      return;
    }
    try {
      provider.reinitialize?.();
      await provider.initialize(config);
    } catch {
      // The caller must still retain the previous logical override/storage even
      // when a provider cannot be reinitialized during rollback.
    }
  }

  private enqueueBundleProviderOperation<T>(operation: () => Promise<T>): Promise<T> {
    const queuedOperation = this.bundleProviderOperation.then(operation, operation);
    this.bundleProviderOperation = queuedOperation.then(
      () => undefined,
      () => undefined,
    );
    return queuedOperation;
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

    const previousOverrides = this.cloneSessionProviderOverrides(this.sessionProviderOverrides);
    const previousStorage = this.readSessionProviderStorage();
    const previousConfig = this.getProviderConfigForType(type);
    const nextOverrides = this.cloneSessionProviderOverrides(previousOverrides);
    nextOverrides[type] = { type, config: { ...configured } };

    try {
      provider.reinitialize?.();
      await provider.initialize(configured);
    } catch {
      await this.restoreProviderConfig(type, previousConfig);
      throw new Error('無法啟用分頁服務商設定。');
    }

    try {
      this.writeSessionProviderOverrides(nextOverrides);
      this.sessionProviderOverrides = nextOverrides;
    } catch {
      this.restoreSessionProviderStorage(previousStorage);
      this.sessionProviderOverrides = previousOverrides;
      await this.restoreProviderConfig(type, previousConfig);
      throw new Error('無法保存分頁服務商設定。');
    }

    emitProviderSettingsChanged();
  }

  clearSessionProviderConfig(type?: ProviderType): void {
    const nextOverrides = this.cloneSessionProviderOverrides(this.sessionProviderOverrides);
    if (type) {
      delete nextOverrides[type];
    } else {
      for (const providerType of Object.keys(nextOverrides) as ProviderType[]) {
        delete nextOverrides[providerType];
      }
    }

    this.writeSessionProviderOverrides(nextOverrides);
    this.sessionProviderOverrides = nextOverrides;
    emitProviderSettingsChanged();
  }

  async setBundleProviderConfig(
    source: BundleProviderOverrideSource,
    type: ProviderType,
    config: Partial<ProviderConfig>,
  ): Promise<void> {
    return this.enqueueBundleProviderOperation(async () => {
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
      ensureBundleSourceToken(source);
      this.bundleProviderOverride = {
        // Retain the exact source object as the ownership token. A stale async
        // cleanup must not clear a newer override with the same field values.
        source,
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
    });
  }

  getBundleProviderOverrideSource(): BundleProviderOverrideSource | null {
    if (!this.bundleProviderOverride) {
      return null;
    }
    const source = { ...this.bundleProviderOverride.source };
    const token = getBundleSourceToken(this.bundleProviderOverride.source);
    if (token) {
      Object.defineProperty(source, BUNDLE_SOURCE_TOKEN, {
        configurable: false,
        enumerable: false,
        value: token,
      });
    }
    return source;
  }

  matchesBundleProviderOverride(source: BundleProviderOverrideSource): boolean {
    const currentSource = this.bundleProviderOverride?.source;
    const sourceToken = getBundleSourceToken(source);
    const currentToken = currentSource ? getBundleSourceToken(currentSource) : undefined;
    return (
      source.kind === 'bundle' &&
      currentSource?.bundleId === source.bundleId &&
      currentSource?.credentialFingerprint === source.credentialFingerprint &&
      (!sourceToken || !currentToken || sourceToken === currentToken)
    );
  }

  async clearBundleProviderConfig(source: BundleProviderOverrideSource): Promise<boolean> {
    return this.enqueueBundleProviderOperation(async () => {
      if (!this.matchesBundleProviderOverride(source)) {
        return false;
      }

      const bundleProviderType = this.bundleProviderOverride!.type;
      this.bundleProviderOverride = null;

      const activeSessionOverride = this.getActiveSessionProviderOverride();
      const activeProviderType = activeSessionOverride?.type ?? this.settings.activeProvider;
      const configFor = (type: ProviderType): ProviderConfig =>
        this.sessionProviderOverrides[type]?.config ??
        sanitizeProviderConfig(
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
    });
  }

  getSessionProviderConfigs(): SessionProviderOverrides {
    return this.cloneSessionProviderOverrides(this.sessionProviderOverrides);
  }

  getSessionProviderConfig(type?: ProviderType): SessionProviderOverride | null {
    const override = type
      ? this.sessionProviderOverrides[type]
      : this.getActiveSessionProviderOverride();
    return override ? { ...override, config: { ...override.config } } : null;
  }

  /**
   * Returns global provider settings with all temporary provider overrides
   * applied. Bundle memory credentials remain the highest-priority source.
   */
  getEffectiveProviderSettings(): ProviderSettings {
    const effectiveProviders = Object.fromEntries(
      (Object.keys(DEFAULT_PROVIDER_SETTINGS.providers) as ProviderType[]).map(providerType => {
        const providerSettings = this.settings.providers[providerType];
        const sessionOverride = this.sessionProviderOverrides[providerType];
        const bundleOverride =
          this.bundleProviderOverride?.type === providerType ? this.bundleProviderOverride : null;
        return [
          providerType,
          {
            ...providerSettings,
            enabled: providerSettings.enabled || Boolean(sessionOverride || bundleOverride),
            config: {
              ...providerSettings.config,
              ...(sessionOverride?.config ?? {}),
              ...(bundleOverride?.config ?? {}),
            },
          },
        ];
      }),
    ) as ProviderSettings['providers'];

    const activeOverride = this.bundleProviderOverride ?? this.getActiveSessionProviderOverride();
    return {
      ...this.settings,
      activeProvider: activeOverride?.type ?? this.settings.activeProvider,
      providers: effectiveProviders,
    };
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
    const activeOverride = this.bundleProviderOverride ?? this.getActiveSessionProviderOverride();
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
    const providerType =
      type ||
      this.bundleProviderOverride?.type ||
      this.getActiveSessionProviderOverride()?.type ||
      this.settings.activeProvider;
    return this.providers.get(providerType) || null;
  }

  getActiveProvider(): LLMProvider | null {
    return this.getProvider(
      this.bundleProviderOverride?.type ??
        this.getActiveSessionProviderOverride()?.type ??
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
      Boolean(this.sessionProviderOverrides[type]) ||
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
