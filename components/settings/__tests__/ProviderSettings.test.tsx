/**
 * @vitest-environment jsdom
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProviderSettings from '../ProviderSettings';
import {
  DEFAULT_PROVIDER_SETTINGS,
  type ProviderConfig,
  type ProviderSettings as ProviderSettingsState,
  type ProviderType,
} from '../../../services/llmAdapter';

const { providerManagerMock, providerMock } = vi.hoisted(() => ({
  providerManagerMock: {
    getSettings: vi.fn(),
    getProvider: vi.fn(),
    enableProvider: vi.fn(),
    updateProviderConfig: vi.fn(),
    setActiveProvider: vi.fn(),
  },
  providerMock: {
    name: 'gemini',
    displayName: 'Google Gemini',
    supportedModels: ['gemini-2.5-flash'],
    requiresApiKey: true,
    supportsLocalMode: false,
    isAvailable: vi.fn(),
    streamChat: vi.fn(),
    getAvailableModels: vi.fn(),
  },
}));

vi.mock('../../../services/providerRegistry', () => ({
  providerManager: providerManagerMock,
}));

vi.mock('../ProviderSettingsShareModal', () => ({
  default: () => null,
}));

const cloneSettings = (): ProviderSettingsState => ({
  activeProvider: DEFAULT_PROVIDER_SETTINGS.activeProvider,
  providers: Object.fromEntries(
    Object.entries(DEFAULT_PROVIDER_SETTINGS.providers).map(([providerType, provider]) => [
      providerType,
      {
        enabled: provider.enabled,
        config: { ...provider.config },
      },
    ]),
  ) as ProviderSettingsState['providers'],
});

const renderSettings = (onClose?: () => void) => render(<ProviderSettings onClose={onClose} />);

const expandGemini = async () => {
  const user = userEvent.setup();
  renderSettings();
  await user.click(screen.getByRole('heading', { name: 'Google Gemini' }));
  return user;
};

describe('ProviderSettings', () => {
  let settings: ProviderSettingsState;

  beforeEach(() => {
    vi.clearAllMocks();
    settings = cloneSettings();
    providerManagerMock.getSettings.mockImplementation(() => ({
      activeProvider: settings.activeProvider,
      providers: Object.fromEntries(
        Object.entries(settings.providers).map(([providerType, provider]) => [
          providerType,
          { enabled: provider.enabled, config: { ...provider.config } },
        ]),
      ) as ProviderSettingsState['providers'],
    }));
    providerManagerMock.getProvider.mockReturnValue(providerMock);
    providerManagerMock.enableProvider.mockImplementation(
      (providerType: ProviderType, enabled: boolean) => {
        settings.providers[providerType].enabled = enabled;
      },
    );
    providerManagerMock.updateProviderConfig.mockImplementation(
      (providerType: ProviderType, config: Partial<ProviderConfig>) => {
        settings.providers[providerType].config = {
          ...settings.providers[providerType].config,
          ...config,
        };
      },
    );
    providerManagerMock.setActiveProvider.mockImplementation((providerType: ProviderType) => {
      settings.activeProvider = providerType;
    });
    providerMock.isAvailable.mockReturnValue(true);
    providerMock.getAvailableModels.mockResolvedValue(['gemini-2.5-flash']);
    providerMock.streamChat.mockImplementation(async function* () {
      yield { text: 'Test successful', isComplete: true };
    });
  });

  it('shows inline validation errors without invoking browser alerts', async () => {
    const alertSpy = vi.spyOn(window, 'alert');
    const user = await expandGemini();

    const apiKey = screen.getByLabelText('Gemini API Key');
    await user.click(screen.getByRole('button', { name: '🔌 測試連接' }));

    expect(await screen.findByText('請先修正標示的設定，再執行連線測試。')).toBeInTheDocument();
    expect(apiKey).toHaveAttribute('aria-invalid', 'true');
    expect(apiKey).toHaveAttribute('aria-describedby', 'gemini-api-key-error');
    expect(screen.getByText('請先輸入 API 金鑰，再測試此服務商。')).toBeInTheDocument();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('reports a successful test as an honest inline status', async () => {
    const user = await expandGemini();
    await user.type(screen.getByLabelText('Gemini API Key'), 'gemini-test-key');
    await user.click(screen.getByRole('button', { name: '🔌 測試連接' }));

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Google Gemini 連線測試成功');
    expect(status).toHaveTextContent('不代表之後每次請求都可用');
  });

  it('reports provider failures inline and preserves the configured fields', async () => {
    providerMock.streamChat.mockImplementation(async function* () {
      yield { text: '', isComplete: true };
      throw new Error('端點離線');
    });

    const user = await expandGemini();
    const apiKey = screen.getByLabelText('Gemini API Key');
    await user.type(apiKey, 'gemini-test-key');
    await user.click(screen.getByRole('button', { name: '🔌 測試連接' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Google Gemini 測試失敗：端點離線');
    });
    expect(apiKey).toHaveValue('gemini-test-key');
  });

  it('calls the optional close callback from the settings header', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderSettings(onClose);

    await user.click(screen.getByRole('button', { name: '關閉' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
