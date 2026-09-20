/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProviderSettingsImportModal from './ProviderSettingsImportModal';

const { shareService, cryptoService } = vi.hoisted(() => ({
  shareService: {
    applyProviderSettingsPayload: vi.fn(),
    clearProviderSettingsShareFromUrl: vi.fn(),
    decryptProviderSettingsPayload: vi.fn(),
    extractProviderSettingsShareFromUrl: vi.fn(() => 'file'),
    getProviderDisplayName: vi.fn(() => 'OpenAI'),
    isProviderSettingsShareEntry: vi.fn(() => true),
    parseProviderSettingsShareFile: vi.fn(),
    PROVIDER_SETTINGS_SHARE_FILE_MAX_BYTES: 64 * 1024,
    PROVIDER_SETTINGS_SHARE_PARAM: 'ps',
  },
  cryptoService: {
    CryptoService: {
      clearUrlParam: vi.fn(),
      extractKeysFromUrl: vi.fn(() => null),
    },
  },
}));

vi.mock('../../services/providerSettingsShareService', () => shareService);
vi.mock('../../services/cryptoService', () => cryptoService);
vi.mock('../ui/Modal', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe('ProviderSettingsImportModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    shareService.extractProviderSettingsShareFromUrl.mockReturnValue('file');
    shareService.isProviderSettingsShareEntry.mockReturnValue(true);
  });

  it('rejects an oversized file before reading its contents', async () => {
    render(<ProviderSettingsImportModal />);
    const input = await waitFor(() => {
      const element = document.querySelector('input[type="file"]');
      expect(element).not.toBeNull();
      return element as HTMLInputElement;
    });
    const file = {
      name: 'provider-settings.json',
      size: shareService.PROVIDER_SETTINGS_SHARE_FILE_MAX_BYTES + 1,
      text: vi.fn().mockResolvedValue('{"unexpected":true}'),
    } as unknown as File;

    fireEvent.change(input, { target: { files: [file], value: '' } });

    expect(file.text).not.toHaveBeenCalled();
    expect(
      await screen.findByText('分享檔案過大，請確認你選取的是有效的設定檔。'),
    ).toBeInTheDocument();
  });
});
