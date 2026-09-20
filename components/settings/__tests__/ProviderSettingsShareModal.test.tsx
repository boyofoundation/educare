/// <reference types="vitest/globals" />
/* global HTMLAnchorElement */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProviderSettingsShareModal from '../ProviderSettingsShareModal';
import { CryptoService } from '../../../services/cryptoService';
import {
  buildProviderSettingsPayload,
  buildProviderSettingsShareEntryUrl,
  encryptProviderSettingsPayload,
  serializeProviderSettingsShareFile,
} from '../../../services/providerSettingsShareService';
import {
  DEFAULT_PROVIDER_SETTINGS,
  type ProviderSettings,
  type ProviderType,
} from '../../../services/llmAdapter';

vi.mock('../../../services/cryptoService', () => ({
  CryptoService: {
    generateRandomPassword: vi.fn(),
  },
}));

vi.mock('../../../services/providerSettingsShareService', () => ({
  buildProviderSettingsPayload: vi.fn(),
  buildProviderSettingsShareEntryUrl: vi.fn(),
  encryptProviderSettingsPayload: vi.fn(),
  serializeProviderSettingsShareFile: vi.fn(),
  getProviderDisplayName: vi.fn((provider: string) => {
    switch (provider) {
      case 'gemini':
        return 'Google Gemini';
      case 'openrouter':
        return 'OpenRouter';
      case 'lmstudio':
        return 'OpenAI 相容端點';
      default:
        return provider;
    }
  }),
}));

const { qrCodeToDataURLMock } = vi.hoisted(() => ({
  qrCodeToDataURLMock:
    vi.fn<(text: string, options?: { width?: number; margin?: number }) => Promise<string>>(),
}));

vi.mock('qrcode', () => ({
  default: {
    toDataURL: qrCodeToDataURLMock,
  },
}));

const SHARE_URL = 'https://example.com/settings?ps=file';
const SHARE_FILE =
  '{"format":"educare-provider-settings-share","schemaVersion":1,"encryptedPayload":"encrypted-provider-settings"}';
const QR_CODE_DATA_URL = 'data:image/png;base64,provider-share-qr';
const GENERATED_PASSWORD = 'generated-password-123';
const AVAILABLE_PROVIDERS: ProviderType[] = ['gemini', 'openrouter', 'lmstudio'];
const clipboardWriteText = vi.fn();

const buildPayloadForProvider = (provider: ProviderType) => ({
  v: 1 as const,
  kind: 'provider-settings' as const,
  provider,
  config:
    provider === 'openrouter'
      ? {
          model: 'openai/gpt-4o',
          apiKey: 'openrouter-api-key',
          baseUrl: 'https://openrouter.ai/api/v1',
        }
      : provider === 'lmstudio'
        ? {
            model: 'local-model',
            baseUrl: 'http://localhost:1234/v1',
          }
        : {
            model: 'gemini-2.5-flash',
            apiKey: 'gemini-api-key',
          },
  meta: {
    app: 'educare' as const,
    sharedAt: '2026-07-02T00:00:00.000Z',
  },
});

const createSettings = (): ProviderSettings => ({
  ...DEFAULT_PROVIDER_SETTINGS,
  activeProvider: 'gemini',
  providers: {
    ...DEFAULT_PROVIDER_SETTINGS.providers,
    gemini: {
      ...DEFAULT_PROVIDER_SETTINGS.providers.gemini,
      enabled: true,
      config: {
        ...DEFAULT_PROVIDER_SETTINGS.providers.gemini.config,
        model: 'gemini-2.5-flash',
        apiKey: 'gemini-api-key',
      },
    },
    openrouter: {
      ...DEFAULT_PROVIDER_SETTINGS.providers.openrouter,
      enabled: true,
      config: {
        ...DEFAULT_PROVIDER_SETTINGS.providers.openrouter.config,
        model: 'openai/gpt-4o',
        apiKey: 'openrouter-api-key',
        baseUrl: 'https://openrouter.ai/api/v1',
      },
    },
    lmstudio: {
      ...DEFAULT_PROVIDER_SETTINGS.providers.lmstudio,
      enabled: true,
      config: {
        ...DEFAULT_PROVIDER_SETTINGS.providers.lmstudio.config,
        model: 'local-model',
        baseUrl: 'http://localhost:1234/v1',
      },
    },
  },
});

const renderModal = () =>
  render(
    <ProviderSettingsShareModal
      isOpen={true}
      onClose={vi.fn()}
      settings={createSettings()}
      availableProviders={AVAILABLE_PROVIDERS}
      initialProvider='gemini'
    />,
  );

const waitForGeneratedState = async () => {
  await waitFor(() => {
    expect(screen.getByText('分享已準備完成')).toBeInTheDocument();
  });

  const sharePanel = screen.getByText('分享已準備完成').closest('section');
  expect(sharePanel).not.toBeNull();

  return within(sharePanel as HTMLElement);
};

describe('ProviderSettingsShareModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(CryptoService.generateRandomPassword).mockReturnValue(GENERATED_PASSWORD);
    vi.mocked(buildProviderSettingsPayload).mockImplementation((settings, provider) =>
      buildPayloadForProvider(provider),
    );
    vi.mocked(encryptProviderSettingsPayload).mockResolvedValue('encrypted-provider-settings');
    vi.mocked(buildProviderSettingsShareEntryUrl).mockReturnValue(SHARE_URL);
    vi.mocked(serializeProviderSettingsShareFile).mockReturnValue(SHARE_FILE);
    qrCodeToDataURLMock.mockResolvedValue(QR_CODE_DATA_URL);

    clipboardWriteText.mockReset();
    clipboardWriteText.mockResolvedValue(undefined);

    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: clipboardWriteText,
      },
      configurable: true,
      writable: true,
    });
  });

  it('renders the redesigned flow with the initial waiting state', () => {
    renderModal();

    expect(screen.getByText('安全分享流程')).toBeInTheDocument();
    expect(screen.getByText('選擇分享內容')).toBeInTheDocument();
    expect(screen.getByText('設定解密密碼')).toBeInTheDocument();
    expect(screen.getByText('等待生成分享結果')).toBeInTheDocument();
    expect(screen.getByText('尚未生成分享內容')).toBeInTheDocument();
    expect(screen.getByLabelText('解密密碼')).toHaveValue(GENERATED_PASSWORD);
    expect(screen.getByRole('button', { name: '生成分享連結' })).toBeInTheDocument();
    expect(screen.queryByAltText('服務商設定分享 QR Code')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('分享連結')).not.toBeInTheDocument();
  });

  it('shows the generated QR code, share link, and nearby actions', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: clipboardWriteText,
      },
      configurable: true,
      writable: true,
    });
    const mockLink = {
      download: '',
      href: '',
      click: vi.fn(),
    };
    const originalCreateElement = document.createElement.bind(document);
    const createElementSpy = vi
      .spyOn(document, 'createElement')
      .mockImplementation((tagName: string) => {
        if (tagName === 'a') {
          return mockLink as unknown as HTMLAnchorElement;
        }

        return originalCreateElement(tagName);
      });

    renderModal();

    await user.click(screen.getByRole('button', { name: '生成分享連結' }));

    const sharePanel = await waitForGeneratedState();

    expect(sharePanel.getByAltText('服務商設定分享 QR Code')).toHaveAttribute(
      'src',
      QR_CODE_DATA_URL,
    );
    expect(sharePanel.getByLabelText('分享連結')).toHaveValue(SHARE_URL);
    expect(sharePanel.getByRole('button', { name: '複製連結' })).toBeInTheDocument();
    expect(sharePanel.getByRole('button', { name: '複製密碼' })).toBeInTheDocument();
    expect(sharePanel.getByRole('button', { name: '下載 QR Code' })).toBeInTheDocument();
    expect(sharePanel.getByRole('button', { name: '下載加密設定檔' })).toBeInTheDocument();
    expect(qrCodeToDataURLMock).toHaveBeenCalledWith(
      SHARE_URL,
      expect.objectContaining({
        width: 512,
        margin: 2,
      }),
    );

    await user.click(sharePanel.getByRole('button', { name: '複製連結' }));
    await user.click(sharePanel.getByRole('button', { name: '複製密碼' }));
    await user.click(sharePanel.getByRole('button', { name: '下載 QR Code' }));

    expect(clipboardWriteText).toHaveBeenNthCalledWith(1, SHARE_URL);
    expect(clipboardWriteText).toHaveBeenNthCalledWith(2, GENERATED_PASSWORD);
    expect(mockLink.download).toBe('gemini-provider-share-qr.png');
    expect(mockLink.href).toBe(QR_CODE_DATA_URL);
    expect(mockLink.click).toHaveBeenCalledTimes(1);
    expect(serializeProviderSettingsShareFile).toHaveBeenCalledWith('encrypted-provider-settings');

    createElementSpy.mockRestore();
  });

  it('clears stale generated results when the provider or password changes', async () => {
    const user = userEvent.setup();

    renderModal();

    await user.click(screen.getByRole('button', { name: '生成分享連結' }));
    await waitForGeneratedState();
    expect(screen.getByAltText('服務商設定分享 QR Code')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /OpenRouter/ }));

    expect(screen.getByText('等待生成分享結果')).toBeInTheDocument();
    expect(screen.queryByAltText('服務商設定分享 QR Code')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('分享連結')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '生成分享連結' }));
    await waitForGeneratedState();

    const passwordInput = screen.getByLabelText('解密密碼');
    await user.clear(passwordInput);
    await user.type(passwordInput, 'updated-password');

    expect(screen.getByText('等待生成分享結果')).toBeInTheDocument();
    expect(screen.queryByAltText('服務商設定分享 QR Code')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('分享連結')).not.toBeInTheDocument();
  });

  it('generates the share result when Enter is pressed in the password field', async () => {
    const user = userEvent.setup();

    renderModal();

    const passwordInput = screen.getByLabelText('解密密碼');
    await user.clear(passwordInput);
    await user.type(passwordInput, 'enter-password{Enter}');

    await waitFor(() => {
      expect(encryptProviderSettingsPayload).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'gemini' }),
        'enter-password',
      );
    });
    expect(screen.getByText('分享已準備完成')).toBeInTheDocument();
  });
});
