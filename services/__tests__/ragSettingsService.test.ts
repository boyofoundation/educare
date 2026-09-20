import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getRagSettingsService,
  DEFAULT_RAG_SETTINGS,
  RagSettingsService,
} from '../ragSettingsService';
import {
  __resetWorkspaceOperationServiceForTesting,
  withWorkspaceOperation,
} from '../workspaceOperationService';

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn().mockReturnValue(null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

describe('RagSettingsService', () => {
  let service: RagSettingsService;

  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks();

    // Reset localStorage mock
    localStorageMock.getItem.mockReturnValue(null);

    // Create a new service instance for each test
    // Note: We need to reset the singleton for testing
    (RagSettingsService as unknown as { instance?: unknown }).instance = undefined;
    service = getRagSettingsService();
  });

  afterEach(() => {
    __resetWorkspaceOperationServiceForTesting();
    localStorageMock.setItem.mockImplementation(() => undefined);
  });

  describe('getInstance', () => {
    it('should return a singleton instance', () => {
      const service1 = getRagSettingsService();
      const service2 = getRagSettingsService();
      expect(service1).toBe(service2);
    });
  });

  describe('default settings', () => {
    it('should load default settings when localStorage is empty', () => {
      const settings = service.getSettings();
      expect(settings).toEqual(DEFAULT_RAG_SETTINGS);
    });

    it('should have correct default values', () => {
      expect(DEFAULT_RAG_SETTINGS).toEqual({
        vectorSearchLimit: 20,
        enableReranking: false,
        rerankLimit: 5,
        minSimilarity: 0.3,
      });
    });
  });

  describe('settings persistence', () => {
    it('should save settings to localStorage', () => {
      const newSettings = {
        vectorSearchLimit: 30,
        enableReranking: false,
        rerankLimit: 3,
        minSimilarity: 0.5,
      };

      service.updateSettings(newSettings);

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'gemini_assistant_rag_settings',
        JSON.stringify(newSettings),
      );
    });

    it('should load settings from localStorage', () => {
      const savedSettings = {
        vectorSearchLimit: 15,
        enableReranking: false,
        rerankLimit: 8,
        minSimilarity: 0.2,
      };

      localStorageMock.getItem.mockReturnValue(JSON.stringify(savedSettings));

      // Create a new instance to test loading
      (RagSettingsService as unknown as { instance?: unknown }).instance = undefined;
      const newService = getRagSettingsService();

      expect(newService.getSettings()).toEqual(savedSettings);
    });
  });

  describe('settings validation', () => {
    it('should validate positive integers', () => {
      service.updateSettings({
        vectorSearchLimit: -5, // Invalid
        rerankLimit: 0, // Invalid
      });

      const settings = service.getSettings();
      expect(settings.vectorSearchLimit).toBe(DEFAULT_RAG_SETTINGS.vectorSearchLimit);
      expect(settings.rerankLimit).toBe(DEFAULT_RAG_SETTINGS.rerankLimit);
    });

    it('should validate similarity range', () => {
      service.updateSettings({
        minSimilarity: 1.5, // Invalid (> 1)
      });

      const settings = service.getSettings();
      expect(settings.minSimilarity).toBe(DEFAULT_RAG_SETTINGS.minSimilarity);

      service.updateSettings({
        minSimilarity: -0.1, // Invalid (< 0)
      });

      const updatedSettings = service.getSettings();
      expect(updatedSettings.minSimilarity).toBe(DEFAULT_RAG_SETTINGS.minSimilarity);
    });

    it('should validate boolean values', () => {
      service.updateSettings({
        enableReranking: 'true' as unknown as boolean, // Invalid type to test validation
      });

      const settings = service.getSettings();
      expect(settings.enableReranking).toBe(DEFAULT_RAG_SETTINGS.enableReranking);
    });
  });

  describe('convenience methods', () => {
    it('should provide convenience getters', () => {
      expect(service.getVectorSearchLimit()).toBe(DEFAULT_RAG_SETTINGS.vectorSearchLimit);
      expect(service.isRerankingEnabled()).toBe(DEFAULT_RAG_SETTINGS.enableReranking);
      expect(service.getRerankLimit()).toBe(DEFAULT_RAG_SETTINGS.rerankLimit);
      expect(service.getMinSimilarity()).toBe(DEFAULT_RAG_SETTINGS.minSimilarity);
    });

    it('should reflect updated values in convenience getters', () => {
      const newSettings = {
        vectorSearchLimit: 25,
        enableReranking: false,
        rerankLimit: 7,
        minSimilarity: 0.4,
      };

      service.updateSettings(newSettings);

      expect(service.getVectorSearchLimit()).toBe(25);
      expect(service.isRerankingEnabled()).toBe(false);
      expect(service.getRerankLimit()).toBe(7);
      expect(service.getMinSimilarity()).toBe(0.4);
    });
  });

  describe('reset functionality', () => {
    it('should reset to default settings', () => {
      // First update to non-default values
      service.updateSettings({
        vectorSearchLimit: 100,
        enableReranking: false,
        rerankLimit: 10,
        minSimilarity: 0.8,
      });

      // Then reset
      service.resetToDefaults();

      expect(service.getSettings()).toEqual(DEFAULT_RAG_SETTINGS);
      expect(localStorageMock.setItem).toHaveBeenLastCalledWith(
        'gemini_assistant_rag_settings',
        JSON.stringify(DEFAULT_RAG_SETTINGS),
      );
    });
  });

  describe('error handling', () => {
    it('should handle localStorage save errors gracefully', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      localStorageMock.setItem.mockImplementation(() => {
        throw new Error('Storage quota exceeded');
      });

      // Should not throw an error
      expect(() => {
        service.updateSettings({ vectorSearchLimit: 30 });
      }).not.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    it('should handle localStorage load errors gracefully', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      localStorageMock.getItem.mockImplementation(() => {
        throw new Error('Storage access denied');
      });

      // Create a new instance to test loading error
      (RagSettingsService as unknown as { instance?: unknown }).instance = undefined;
      const newService = getRagSettingsService();

      // Should fall back to default settings
      expect(newService.getSettings()).toEqual(DEFAULT_RAG_SETTINGS);
      expect(consoleWarnSpy).toHaveBeenCalled();
      consoleWarnSpy.mockRestore();
    });

    it('should handle malformed JSON in localStorage', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      localStorageMock.getItem.mockReturnValue('invalid json');

      // Create a new instance to test malformed JSON error
      (RagSettingsService as unknown as { instance?: unknown }).instance = undefined;
      const newService = getRagSettingsService();

      // Should fall back to default settings
      expect(newService.getSettings()).toEqual(DEFAULT_RAG_SETTINGS);
      expect(consoleWarnSpy).toHaveBeenCalled();
      consoleWarnSpy.mockRestore();
    });
  });

  describe('workspace write barrier', () => {
    it('defers async settings writes until an exclusive workspace operation finishes', async () => {
      let pendingWrite: Promise<boolean> | undefined;

      await withWorkspaceOperation('export', async () => {
        localStorageMock.setItem.mockClear();
        pendingWrite = service.updateSettingsAsync({ vectorSearchLimit: 30 });
        await Promise.resolve();
        expect(localStorageMock.setItem).not.toHaveBeenCalled();
      });

      await expect(pendingWrite).resolves.toBe(true);
      expect(service.getVectorSearchLimit()).toBe(30);
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'gemini_assistant_rag_settings',
        expect.stringContaining('"vectorSearchLimit":30'),
      );
    });

    it('retains the previous in-memory settings when an async write fails', async () => {
      const previousSettings = service.getSettings();
      localStorageMock.setItem.mockImplementation(() => {
        throw new Error('Storage quota exceeded');
      });

      await expect(service.updateSettingsAsync({ vectorSearchLimit: 30 })).resolves.toBe(false);
      expect(service.getSettings()).toEqual(previousSettings);
    });
  });
});
