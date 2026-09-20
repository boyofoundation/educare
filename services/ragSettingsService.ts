import { RagSettings } from '../types';
import { withWorkspaceWrite } from './workspaceOperationService';

const RAG_SETTINGS_KEY = 'gemini_assistant_rag_settings';

/**
 * 預設 RAG 設定
 */
export const DEFAULT_RAG_SETTINGS: RagSettings = {
  vectorSearchLimit: 20,
  enableReranking: false,
  rerankLimit: 5,
  minSimilarity: 0.3,
};

/**
 * RAG 設定服務 - 管理全域 RAG 配置
 */
export class RagSettingsService {
  private static instance: RagSettingsService;
  private settings: RagSettings;

  private constructor() {
    this.settings = this.loadSettings();
  }

  /**
   * 取得服務實例 (單例模式)
   */
  static getInstance(): RagSettingsService {
    if (!RagSettingsService.instance) {
      RagSettingsService.instance = new RagSettingsService();
    }
    return RagSettingsService.instance;
  }

  /**
   * 從 localStorage 載入設定
   */
  private loadSettings(): RagSettings {
    try {
      const stored = localStorage.getItem(RAG_SETTINGS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as RagSettings;
        // 驗證設定值是否有效，無效則使用預設值
        return this.validateAndMergeSettings(parsed);
      }
    } catch (error) {
      console.warn('Failed to load RAG settings from localStorage:', error);
    }
    return { ...DEFAULT_RAG_SETTINGS };
  }

  /**
   * 驗證並合併設定
   */
  private validateAndMergeSettings(settings: Partial<RagSettings>): RagSettings {
    return {
      vectorSearchLimit: this.validatePositiveInteger(
        settings.vectorSearchLimit,
        DEFAULT_RAG_SETTINGS.vectorSearchLimit,
      ),
      enableReranking:
        typeof settings.enableReranking === 'boolean'
          ? settings.enableReranking
          : DEFAULT_RAG_SETTINGS.enableReranking,
      rerankLimit: this.validatePositiveInteger(
        settings.rerankLimit,
        DEFAULT_RAG_SETTINGS.rerankLimit,
      ),
      minSimilarity: this.validateSimilarity(
        settings.minSimilarity,
        DEFAULT_RAG_SETTINGS.minSimilarity,
      ),
    };
  }

  /**
   * 驗證正整數
   */
  private validatePositiveInteger(value: unknown, defaultValue: number): number {
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
      return value;
    }
    return defaultValue;
  }

  /**
   * 驗證相似度值 (0-1 之間)
   */
  private validateSimilarity(value: unknown, defaultValue: number): number {
    if (typeof value === 'number' && value >= 0 && value <= 1) {
      return value;
    }
    return defaultValue;
  }

  /**
   * 儲存設定到 localStorage
   */
  private saveSettings(): boolean {
    try {
      localStorage.setItem(RAG_SETTINGS_KEY, JSON.stringify(this.settings));
      return true;
    } catch (error) {
      console.error('Failed to save RAG settings to localStorage:', error);
      return false;
    }
  }

  /**
   * 取得當前設定
   */
  getSettings(): RagSettings {
    return { ...this.settings };
  }

  /**
   * 更新設定
   */
  updateSettings(newSettings: Partial<RagSettings>): void {
    const validatedSettings = this.validateAndMergeSettings(newSettings);
    this.settings = { ...this.settings, ...validatedSettings };
    this.saveSettings();
  }

  /**
   * Update settings after entering the workspace write barrier. The existing
   * synchronous method remains for compatibility with current consumers.
   */
  updateSettingsAsync(newSettings: Partial<RagSettings>): Promise<boolean> {
    return withWorkspaceWrite(async () => {
      const previousSettings = this.settings;
      const validatedSettings = this.validateAndMergeSettings(newSettings);
      this.settings = { ...this.settings, ...validatedSettings };
      const persisted = this.saveSettings();
      if (!persisted) {
        this.settings = previousSettings;
      }
      return persisted;
    });
  }

  /**
   * 重設為預設設定
   */
  resetToDefaults(): void {
    this.settings = { ...DEFAULT_RAG_SETTINGS };
    this.saveSettings();
  }

  /** Reset settings after entering the workspace write barrier. */
  resetToDefaultsAsync(): Promise<boolean> {
    return withWorkspaceWrite(async () => {
      const previousSettings = this.settings;
      this.settings = { ...DEFAULT_RAG_SETTINGS };
      const persisted = this.saveSettings();
      if (!persisted) {
        this.settings = previousSettings;
      }
      return persisted;
    });
  }

  /**
   * 取得向量搜尋限制
   */
  getVectorSearchLimit(): number {
    return this.settings.vectorSearchLimit;
  }

  /**
   * 是否啟用重新排序
   */
  isRerankingEnabled(): boolean {
    return this.settings.enableReranking;
  }

  /**
   * 取得重新排序限制
   */
  getRerankLimit(): number {
    return this.settings.rerankLimit;
  }

  /**
   * 取得最低相似度閾值
   */
  getMinSimilarity(): number {
    return this.settings.minSimilarity;
  }
}

/**
 * 便捷函數 - 取得 RAG 設定服務實例
 */
export const getRagSettingsService = (): RagSettingsService => {
  return RagSettingsService.getInstance();
};

/**
 * 便捷函數 - 取得當前 RAG 設定
 */
export const getCurrentRagSettings = (): RagSettings => {
  return getRagSettingsService().getSettings();
};
