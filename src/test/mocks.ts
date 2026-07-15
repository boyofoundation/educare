import { vi } from 'vitest';

// Global mocks for common services
export const mockApiKeyManager = vi.fn().mockImplementation(() => ({
  getUserApiKeys: vi.fn().mockReturnValue({
    geminiApiKey: 'mock-gemini-key',
    tursoWriteApiKey: 'mock-turso-key',
  }),
}));

export const mockTursoService = {
  saveAssistantToTurso: vi.fn().mockResolvedValue(undefined),
  getAllAssistants: vi.fn().mockResolvedValue([]),
  getAssistant: vi.fn().mockResolvedValue(null),
  saveAssistant: vi.fn().mockResolvedValue(null),
  deleteAssistant: vi.fn().mockResolvedValue(undefined),
  saveSession: vi.fn().mockResolvedValue(null),
  deleteSession: vi.fn().mockResolvedValue(undefined),
  getSessionsForAssistant: vi.fn().mockResolvedValue([]),
};

export const mockDbService = {
  ...mockTursoService,
};

export const mockCryptoService = {
  encryptApiKeys: vi.fn().mockResolvedValue('encrypted-data'),
  generateRandomPassword: vi.fn().mockReturnValue('generated-password-123'),
};

export const mockI18n = {
  t: vi.fn((key: string) => {
    // Mock Chinese translations for tests
    const translations: Record<string, string> = {
      分享助理: '分享助理',
      分享: '分享',
      給其他人使用: '給其他人使用',
      分享連結: '分享連結',
      複製: '複製',
      '下載 QR Code': '下載 QR Code',
      關閉: '關閉',
      '包含我的 API 金鑰（讓接收者無需配置即可使用）':
        '包含我的 API 金鑰（讓接收者無需配置即可使用）',
      加密密碼: '加密密碼',
      設定密碼: '設定密碼',
      重新生成: '重新生成',
      '生成中...': '生成中...',
      '正在輸入...': '正在輸入...',
      新增助理: '新增助理',
      編輯助理: '編輯助理',
      保存助理: '保存助理',
      取消: '取消',
      // Add more as needed
    };
    return translations[key] || key;
  }),
};

// Setup mocks in test files by importing and applying
export const setupMocks = () => {
  vi.mock('@/services/apiKeyManager', () => ({
    ApiKeyManager: mockApiKeyManager,
  }));

  vi.mock('@/services/tursoService', () => ({
    ...mockTursoService,
  }));

  vi.mock('@/services/db', () => ({
    ...mockDbService,
  }));

  vi.mock('@/services/cryptoService', () => ({
    CryptoService: mockCryptoService,
  }));

  // Mock i18n if used
  vi.mock('react-i18next', () => ({
    useTranslation: () => ({
      t: mockI18n.t,
    }),
  }));
};
