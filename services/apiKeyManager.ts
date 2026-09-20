/**
 * API KEY 管理服務
 * 處理雙層 API KEY 架構：
 * 1. 內建只讀權限（Turso 只讀）- 所有人都可以讀取分享的助理
 * 2. 用戶提供（Gemini + Turso 讀寫）- 儲存在 LocalStorage
 * 3. 與 providerManager 系統整合 - 也檢查 providerManager 的設定
 */

import { providerManager } from './providerRegistry';

// LocalStorage 鍵值
const STORAGE_KEYS = {
  // AI Providers
  GEMINI_API_KEY: 'user_gemini_api_key',
  OPENAI_API_KEY: 'user_openai_api_key',
  GROQ_API_KEY: 'user_groq_api_key',
  OPENROUTER_API_KEY: 'user_openrouter_api_key',
  LMSTUDIO_API_KEY: 'user_lmstudio_api_key',
  // Local providers (use base URLs instead of API keys)
  OLLAMA_BASE_URL: 'user_ollama_base_url',
  LMSTUDIO_BASE_URL: 'user_lmstudio_base_url',
  // Database
  TURSO_WRITE_API_KEY: 'user_turso_write_api_key',
  // Active Provider
  ACTIVE_PROVIDER: 'active_provider',
} as const;

const TEMPORARY_STORAGE_KEY = 'educare_temporary_api_keys';

/**
 * Credentials entered for a newly configured provider are ephemeral by default.
 * `persistent` is intentionally an explicit opt-in; `session` survives route
 * changes/reloads in the current tab but is not written to localStorage.
 */
export type ApiKeyPersistence = 'memory' | 'session' | 'persistent';

export interface ApiKeyStorageOptions {
  persistence?: ApiKeyPersistence;
}

export interface UserApiKeys {
  // AI Provider API Keys
  geminiApiKey?: string;
  openaiApiKey?: string;
  groqApiKey?: string;
  openrouterApiKey?: string;
  lmstudioApiKey?: string;
  // Local provider base URLs
  ollamaBaseUrl?: string;
  lmstudioBaseUrl?: string;
  // Database API Key
  tursoWriteApiKey?: string;
  // Active Provider
  provider?: string;
}

/**
 * API KEY 管理器
 */
export class ApiKeyManager {
  private static memoryApiKeys: UserApiKeys = {};
  private static sessionApiKeysSuppressed = false;

  /**
   * 檢查是否有用戶設定的 Gemini API KEY
   */
  static hasGeminiApiKey(): boolean {
    return !!this.getGeminiApiKey();
  }

  /**
   * 檢查是否有用戶設定的 Turso 寫入權限
   */
  static hasTursoWriteAccess(): boolean {
    return !!this.getTursoWriteApiKey();
  }

  /**
   * 檢查是否有用戶設定的 OpenAI API KEY
   */
  static hasOpenaiApiKey(): boolean {
    return !!this.getOpenaiApiKey();
  }

  /**
   * 檢查是否有用戶設定的 Groq API KEY
   */
  static hasGroqApiKey(): boolean {
    return !!this.getGroqApiKey();
  }

  /**
   * 檢查是否有用戶設定的 OpenRouter API KEY
   */
  static hasOpenrouterApiKey(): boolean {
    return !!this.getOpenrouterApiKey();
  }

  /**
   * 檢查是否有用戶設定的 Ollama Base URL
   */
  static hasOllamaBaseUrl(): boolean {
    return !!this.getOllamaBaseUrl();
  }

  /**
   * 檢查是否有用戶設定的 LM Studio Base URL
   */
  static hasLmstudioBaseUrl(): boolean {
    return !!this.getLmstudioBaseUrl();
  }

  /**
   * 獲取 Gemini API KEY (用戶設定)
   */
  static getGeminiApiKey(): string | null {
    return this.getEffectiveValue('geminiApiKey', STORAGE_KEYS.GEMINI_API_KEY);
  }

  /**
   * 獲取 Turso 寫入 API KEY (用戶設定)
   */
  static getTursoWriteApiKey(): string | null {
    return this.getEffectiveValue('tursoWriteApiKey', STORAGE_KEYS.TURSO_WRITE_API_KEY);
  }

  /**
   * 獲取 OpenAI API KEY (用戶設定)
   */
  static getOpenaiApiKey(): string | null {
    return this.getEffectiveValue('openaiApiKey', STORAGE_KEYS.OPENAI_API_KEY);
  }

  /**
   * 獲取 Groq API KEY (用戶設定)
   */
  static getGroqApiKey(): string | null {
    return this.getEffectiveValue('groqApiKey', STORAGE_KEYS.GROQ_API_KEY);
  }

  /**
   * 獲取 OpenRouter API KEY (用戶設定)
   */
  static getOpenrouterApiKey(): string | null {
    return this.getEffectiveValue('openrouterApiKey', STORAGE_KEYS.OPENROUTER_API_KEY);
  }

  /**
   * 獲取 LM Studio API KEY (用戶設定)
   */
  static getLmstudioApiKey(): string | null {
    return this.getEffectiveValue('lmstudioApiKey', STORAGE_KEYS.LMSTUDIO_API_KEY);
  }

  /**
   * 獲取 Ollama Base URL (用戶設定)
   */
  static getOllamaBaseUrl(): string | null {
    return this.getEffectiveValue('ollamaBaseUrl', STORAGE_KEYS.OLLAMA_BASE_URL);
  }

  /**
   * 獲取 LM Studio Base URL (用戶設定)
   */
  static getLmstudioBaseUrl(): string | null {
    return this.getEffectiveValue('lmstudioBaseUrl', STORAGE_KEYS.LMSTUDIO_BASE_URL);
  }

  // 不再需要獨立的 getTursoWriteUrl()，因為使用共用 URL

  /**
   * 獲取 Turso 只讀配置 (內建)
   */
  static getTursoReadConfig(): { url: string; authToken: string } | null {
    // 從 Vite runtime env 讀取共用 URL 和只讀 API KEY
    const url = import.meta.env.VITE_TURSO_URL;
    const authToken = import.meta.env.VITE_TURSO_READ_API_KEY;

    if (!url || !authToken) {
      console.warn('內建 Turso 只讀配置不存在');
      return null;
    }

    return { url, authToken };
  }

  /**
   * 獲取 Turso 寫入配置 (用戶設定)
   */
  static getTursoWriteConfig(): { url: string; authToken: string } | null {
    const authToken = this.getTursoWriteApiKey();

    if (!authToken) {
      return null;
    }

    // 使用共用的 URL，但是用戶提供的寫入權限 API KEY
    const url = import.meta.env.VITE_TURSO_URL;
    if (!url) {
      return null;
    }

    return { url, authToken };
  }

  /**
   * 設定用戶 API KEY
   */
  static setUserApiKeys(
    keys: UserApiKeys,
    options: ApiKeyStorageOptions = { persistence: 'session' },
  ): void {
    if (typeof window === 'undefined') {
      return;
    }

    const persistence = options.persistence ?? 'session';
    if (persistence !== 'persistent') {
      this.setTemporaryApiKeys(keys, persistence);
      return;
    }

    this.clearTemporaryApiKeys();

    // AI Provider API Keys
    if (keys.geminiApiKey) {
      localStorage.setItem(STORAGE_KEYS.GEMINI_API_KEY, keys.geminiApiKey);
    } else {
      localStorage.removeItem(STORAGE_KEYS.GEMINI_API_KEY);
    }

    if (keys.openaiApiKey) {
      localStorage.setItem(STORAGE_KEYS.OPENAI_API_KEY, keys.openaiApiKey);
    } else {
      localStorage.removeItem(STORAGE_KEYS.OPENAI_API_KEY);
    }

    if (keys.groqApiKey) {
      localStorage.setItem(STORAGE_KEYS.GROQ_API_KEY, keys.groqApiKey);
    } else {
      localStorage.removeItem(STORAGE_KEYS.GROQ_API_KEY);
    }

    if (keys.openrouterApiKey) {
      localStorage.setItem(STORAGE_KEYS.OPENROUTER_API_KEY, keys.openrouterApiKey);
    } else {
      localStorage.removeItem(STORAGE_KEYS.OPENROUTER_API_KEY);
    }

    if (keys.lmstudioApiKey) {
      localStorage.setItem(STORAGE_KEYS.LMSTUDIO_API_KEY, keys.lmstudioApiKey);
    } else {
      localStorage.removeItem(STORAGE_KEYS.LMSTUDIO_API_KEY);
    }

    // Local Provider Base URLs
    if (keys.ollamaBaseUrl) {
      localStorage.setItem(STORAGE_KEYS.OLLAMA_BASE_URL, keys.ollamaBaseUrl);
    } else {
      localStorage.removeItem(STORAGE_KEYS.OLLAMA_BASE_URL);
    }

    if (keys.lmstudioBaseUrl) {
      localStorage.setItem(STORAGE_KEYS.LMSTUDIO_BASE_URL, keys.lmstudioBaseUrl);
    } else {
      localStorage.removeItem(STORAGE_KEYS.LMSTUDIO_BASE_URL);
    }

    // Database API Key
    if (keys.tursoWriteApiKey) {
      localStorage.setItem(STORAGE_KEYS.TURSO_WRITE_API_KEY, keys.tursoWriteApiKey);
    } else {
      localStorage.removeItem(STORAGE_KEYS.TURSO_WRITE_API_KEY);
    }

    // Active Provider
    if (keys.provider) {
      localStorage.setItem(STORAGE_KEYS.ACTIVE_PROVIDER, keys.provider);
    } else {
      localStorage.removeItem(STORAGE_KEYS.ACTIVE_PROVIDER);
    }
  }

  /**
   * 清除所有用戶 API KEY
   */
  static clearUserApiKeys(): void {
    if (typeof window === 'undefined') {
      return;
    }

    this.clearTemporaryApiKeys();

    Object.values(STORAGE_KEYS).forEach(key => {
      localStorage.removeItem(key);
    });
  }

  /**
   * Store credentials without touching the legacy persistent key store.
   * Memory scope is useful for a single interaction; session scope intentionally
   * uses sessionStorage so a page refresh does not silently lose a configured tab.
   */
  static setTemporaryApiKeys(
    keys: UserApiKeys,
    persistence: Exclude<ApiKeyPersistence, 'persistent'> = 'session',
  ): void {
    if (typeof window === 'undefined') {
      return;
    }

    const sanitized = this.sanitizeApiKeys(keys);
    if (persistence === 'memory') {
      this.removeTemporarySessionApiKeys();
      this.sessionApiKeysSuppressed = true;
      this.memoryApiKeys = sanitized;
      return;
    }

    try {
      // Replace the session record rather than allowing a failed write to leave
      // an older credential visible through getUserApiKeys().
      this.removeTemporarySessionApiKeys();
      sessionStorage.setItem(TEMPORARY_STORAGE_KEY, JSON.stringify(sanitized));
      this.sessionApiKeysSuppressed = false;
      this.memoryApiKeys = {};
    } catch {
      // Private browsing or a blocked sessionStorage must not turn an ephemeral
      // credential entry into a persistent fallback.
      this.removeTemporarySessionApiKeys();
      this.sessionApiKeysSuppressed = true;
      this.memoryApiKeys = sanitized;
    }
  }

  static clearTemporaryApiKeys(): void {
    this.memoryApiKeys = {};
    this.sessionApiKeysSuppressed = false;
    if (typeof window !== 'undefined') {
      this.removeTemporarySessionApiKeys();
    }
  }

  static getApiKeyPersistence(): 'none' | 'temporary' | 'persistent' {
    if (
      Object.keys(this.memoryApiKeys).length > 0 ||
      Object.keys(this.getSessionApiKeys()).length > 0
    ) {
      return 'temporary';
    }
    if (typeof window !== 'undefined') {
      try {
        return Object.values(STORAGE_KEYS).some(key => Boolean(localStorage.getItem(key)))
          ? 'persistent'
          : 'none';
      } catch {
        return 'none';
      }
    }
    return 'none';
  }

  /**
   * 獲取所有用戶 API KEY
   */
  static getUserApiKeys(): UserApiKeys {
    const temporary = {
      ...this.getSessionApiKeys(),
      ...this.memoryApiKeys,
    };
    const lmstudioApiKey =
      temporary.lmstudioApiKey ||
      this.getStoredApiKey(STORAGE_KEYS.LMSTUDIO_API_KEY) ||
      this.getProviderApiKey('lmstudio') ||
      undefined;

    // Get API keys from both localStorage (new system) and providerManager (existing system)
    return {
      // AI Provider API Keys - check both systems
      geminiApiKey:
        temporary.geminiApiKey ||
        this.getStoredApiKey(STORAGE_KEYS.GEMINI_API_KEY) ||
        this.getProviderApiKey('gemini') ||
        undefined,
      openaiApiKey:
        temporary.openaiApiKey ||
        this.getStoredApiKey(STORAGE_KEYS.OPENAI_API_KEY) ||
        this.getProviderApiKey('openai') ||
        undefined,
      groqApiKey:
        temporary.groqApiKey ||
        this.getStoredApiKey(STORAGE_KEYS.GROQ_API_KEY) ||
        this.getProviderApiKey('groq') ||
        undefined,
      openrouterApiKey:
        temporary.openrouterApiKey ||
        this.getStoredApiKey(STORAGE_KEYS.OPENROUTER_API_KEY) ||
        this.getProviderApiKey('openrouter') ||
        undefined,
      lmstudioApiKey,
      // Local Provider Base URLs
      ollamaBaseUrl:
        temporary.ollamaBaseUrl ||
        this.getStoredApiKey(STORAGE_KEYS.OLLAMA_BASE_URL) ||
        this.getProviderBaseUrl('ollama') ||
        undefined,
      lmstudioBaseUrl:
        temporary.lmstudioBaseUrl ||
        this.getStoredApiKey(STORAGE_KEYS.LMSTUDIO_BASE_URL) ||
        this.getProviderBaseUrl('lmstudio') ||
        undefined,
      // Database API Key
      tursoWriteApiKey:
        temporary.tursoWriteApiKey ||
        this.getStoredApiKey(STORAGE_KEYS.TURSO_WRITE_API_KEY) ||
        undefined,
      // Active provider
      provider:
        temporary.provider || this.getStoredApiKey(STORAGE_KEYS.ACTIVE_PROVIDER) || undefined,
    };
  }

  private static getStoredApiKey(key: string): string | null {
    if (typeof window === 'undefined') {
      return null;
    }
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  private static getSessionApiKeys(): UserApiKeys {
    if (typeof window === 'undefined' || this.sessionApiKeysSuppressed) {
      return {};
    }
    try {
      const raw = sessionStorage.getItem(TEMPORARY_STORAGE_KEY);
      if (!raw) {
        return {};
      }
      const parsed: unknown = JSON.parse(raw);
      return this.sanitizeApiKeys(parsed);
    } catch {
      try {
        sessionStorage.removeItem(TEMPORARY_STORAGE_KEY);
      } catch {
        // Ignore unavailable storage.
      }
      return {};
    }
  }

  private static removeTemporarySessionApiKeys(): void {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      sessionStorage.removeItem(TEMPORARY_STORAGE_KEY);
    } catch {
      // Ignore unavailable storage; the suppression flag prevents stale reads.
    }
  }

  private static getEffectiveValue(field: keyof UserApiKeys, storedKey: string): string | null {
    const temporary = { ...this.getSessionApiKeys(), ...this.memoryApiKeys };
    return temporary[field] || this.getStoredApiKey(storedKey);
  }

  private static sanitizeApiKeys(value: unknown): UserApiKeys {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    const candidate = value as Record<string, unknown>;
    const result: UserApiKeys = {};
    const fields: Array<keyof UserApiKeys> = [
      'geminiApiKey',
      'openaiApiKey',
      'groqApiKey',
      'openrouterApiKey',
      'lmstudioApiKey',
      'ollamaBaseUrl',
      'lmstudioBaseUrl',
      'tursoWriteApiKey',
      'provider',
    ];
    fields.forEach(field => {
      if (typeof candidate[field] === 'string' && candidate[field].trim()) {
        result[field] = candidate[field] as string;
      }
    });
    return result;
  }

  /**
   * Helper method to get API key from providerManager
   */
  private static getProviderApiKey(providerType: string): string | null {
    try {
      if (!providerManager) {
        return null;
      }
      const settings = providerManager.getSettings();
      const providers = settings?.providers as
        | Record<string, { enabled: boolean; config?: { apiKey?: string; baseUrl?: string } }>
        | undefined;
      return providers?.[providerType]?.config?.apiKey || null;
    } catch (error) {
      console.error('Error getting provider API key:', error);
      return null;
    }
  }

  /**
   * Helper method to get base URL from providerManager
   */
  private static getProviderBaseUrl(providerType: string): string | null {
    try {
      if (!providerManager) {
        return null;
      }
      const settings = providerManager.getSettings();
      const providers = settings?.providers as
        | Record<string, { enabled: boolean; config?: { apiKey?: string; baseUrl?: string } }>
        | undefined;
      return providers?.[providerType]?.config?.baseUrl || null;
    } catch (error) {
      console.error('Error getting provider base URL:', error);
      return null;
    }
  }

  /**
   * 檢查 API KEY 格式是否有效
   */
  static validateGeminiApiKey(apiKey: string): boolean {
    // Gemini API KEY 通常以 AIzaSy 開頭
    return /^AIzaSy[A-Za-z0-9_-]{33}$/.test(apiKey);
  }

  /**
   * 檢查 Turso API KEY 格式是否有效
   */
  static validateTursoApiKey(apiKey: string): boolean {
    // Turso JWT token 格式檢查
    try {
      const parts = apiKey.split('.');
      return parts.length === 3 && parts.every(part => part.length > 0);
    } catch {
      return false;
    }
  }

  /**
   * 檢查 OpenAI API KEY 格式是否有效
   */
  static validateOpenaiApiKey(apiKey: string): boolean {
    // OpenAI API KEY 通常以 sk- 開頭
    return /^sk-[A-Za-z0-9]{32,}$/.test(apiKey);
  }

  /**
   * 檢查 Groq API KEY 格式是否有效
   */
  static validateGroqApiKey(apiKey: string): boolean {
    // Groq API KEY 通常以 gsk_ 開頭，後綴長度可能變動
    return /^gsk_[A-Za-z0-9]{16,}$/.test(apiKey);
  }

  /**
   * 檢查 OpenRouter API KEY 格式是否有效
   */
  static validateOpenrouterApiKey(apiKey: string): boolean {
    // OpenRouter API KEY 通常以 sk-or-v1- 開頭
    return /^sk-or-v1-[A-Za-z0-9]{64}$/.test(apiKey);
  }

  /**
   * 檢查 Ollama Base URL 格式是否有效
   */
  static validateOllamaBaseUrl(baseUrl: string): boolean {
    try {
      const url = new URL(baseUrl);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  /**
   * 檢查 LM Studio Base URL 格式是否有效
   */
  static validateLmstudioBaseUrl(baseUrl: string): boolean {
    try {
      const url = new URL(baseUrl);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  // 不再需要 validateTursoUrl()，因為使用內建 URL
}

export default ApiKeyManager;
