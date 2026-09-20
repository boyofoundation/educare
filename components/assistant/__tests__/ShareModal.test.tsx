/// <reference types="vitest/globals" />
/* global HTMLAnchorElement */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { ShareModal } from '../ShareModal';
import { downloadAssistantPackage } from '../../../services/assistantPackageService';
import { saveAssistantToTurso } from '../../../services/tursoService';
import { generateShortUrl, buildShortUrl } from '../../../services/shortUrlService';
import { TEST_ASSISTANTS } from './test-utils';

vi.mock('../../../services/assistantPackageService', () => ({
  downloadAssistantPackage: vi.fn(),
}));

vi.mock('../../../services/tursoService', () => ({
  saveAssistantToTurso: vi.fn(),
}));

vi.mock('../../../services/shortUrlService', () => ({
  generateShortUrl: vi.fn(),
  buildShortUrl: vi.fn(),
}));

const qrCodeMocks = vi.hoisted(() => ({
  toDataURL: vi.fn(),
}));

vi.mock('qrcode', () => ({
  default: {
    toDataURL: qrCodeMocks.toDataURL,
  },
  toDataURL: qrCodeMocks.toDataURL,
}));

const renderModal = (overrides: Partial<ComponentProps<typeof ShareModal>> = {}) =>
  render(
    <ShareModal isOpen={true} onClose={vi.fn()} assistant={TEST_ASSISTANTS.basic} {...overrides} />,
  );

describe('ShareModal', () => {
  beforeAll(() => {
    Object.defineProperty(window, 'location', {
      value: {
        origin: 'https://example.com',
        pathname: '/chat/app',
      },
      configurable: true,
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(downloadAssistantPackage).mockReturnValue({
      fileName: 'Basic-Assistant.educare-assistant.zip',
      chunkCount: 0,
    });
    vi.mocked(saveAssistantToTurso).mockResolvedValue(undefined);
    vi.mocked(generateShortUrl).mockResolvedValue('short-code');
    vi.mocked(buildShortUrl).mockReturnValue('https://short.url/short-code');
    qrCodeMocks.toDataURL.mockResolvedValue('data:image/png;base64,mocked-qr-code');
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
      writable: true,
    });
  });

  it('renders nothing when closed and does not perform cloud writes', () => {
    renderModal({ isOpen: false });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(saveAssistantToTurso).not.toHaveBeenCalled();
  });

  it('shows local export first and explains the data boundary', () => {
    renderModal();

    expect(screen.getByRole('dialog', { name: '分享助理' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '先匯出助理檔案' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '匯出助理檔案' })).toBeInTheDocument();
    expect(screen.getByText(/不包含聊天紀錄、服務商設定或 API 金鑰/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '選用：雲端分享連結' })).toBeInTheDocument();
    expect(saveAssistantToTurso).not.toHaveBeenCalled();
  });

  it('exports a local assistant package without requiring Turso', async () => {
    renderModal();

    fireEvent.click(screen.getByRole('button', { name: '匯出助理檔案' }));

    expect(downloadAssistantPackage).toHaveBeenCalledWith(TEST_ASSISTANTS.basic);
    expect(saveAssistantToTurso).not.toHaveBeenCalled();
    expect(
      await screen.findByText('已準備下載：Basic-Assistant.educare-assistant.zip'),
    ).toBeInTheDocument();
    expect(screen.getByText(/已匯出 Basic-Assistant/)).toBeInTheDocument();
  });

  it('keeps the export route available when local export fails', async () => {
    vi.mocked(downloadAssistantPackage).mockImplementation(() => {
      throw new Error('storage unavailable');
    });

    renderModal();
    fireEvent.click(screen.getByRole('button', { name: '匯出助理檔案' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('storage unavailable');
    expect(screen.getByRole('button', { name: '匯出助理檔案' })).toBeInTheDocument();
    expect(saveAssistantToTurso).not.toHaveBeenCalled();
  });

  it('only writes to Turso after the optional cloud action is requested', async () => {
    renderModal();

    fireEvent.click(screen.getByRole('button', { name: '建立雲端分享連結' }));

    await waitFor(() => expect(saveAssistantToTurso).toHaveBeenCalledTimes(1));
    expect(await screen.findByAltText('分享 QR Code')).toBeInTheDocument();
    expect(qrCodeMocks.toDataURL).toHaveBeenCalledWith(
      'https://example.com/chat?share=test-assistant-1',
      expect.objectContaining({ width: 256, margin: 2 }),
    );
    expect(await screen.findByAltText('分享 QR Code')).toBeInTheDocument();
    expect(screen.getByLabelText('分享連結')).toHaveValue(
      'https://example.com/chat?share=test-assistant-1',
    );
    expect(screen.getByText(/選用的雲端分享連結已生成/)).toBeInTheDocument();
  });

  it('reports cloud failures without hiding local export', async () => {
    vi.mocked(saveAssistantToTurso).mockRejectedValue(new Error('Turso unavailable'));

    renderModal();
    fireEvent.click(screen.getByRole('button', { name: '建立雲端分享連結' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Turso unavailable');
    expect(screen.getByRole('button', { name: '匯出助理檔案' })).toBeInTheDocument();
    expect(screen.queryByAltText('分享 QR Code')).not.toBeInTheDocument();
  });

  it('supports optional short URLs only for cloud sharing', async () => {
    renderModal();
    fireEvent.click(screen.getByLabelText(/使用短網址/));
    fireEvent.click(screen.getByRole('button', { name: '建立雲端分享連結' }));

    await waitFor(() => expect(generateShortUrl).toHaveBeenCalledWith('test-assistant-1'));
    expect(buildShortUrl).toHaveBeenCalledWith('short-code');
    expect(await screen.findByDisplayValue('https://short.url/short-code')).toBeInTheDocument();
  });

  it('supports copying and downloading a generated cloud QR code', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: '建立雲端分享連結' }));
    await screen.findByAltText('分享 QR Code');

    fireEvent.click(screen.getByRole('button', { name: '複製連結' }));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        'https://example.com/chat?share=test-assistant-1',
      );
    });

    fireEvent.click(screen.getByRole('button', { name: '下載 QR Code' }));
    expect(mockLink.download).toBe('Basic Assistant-share-qr.png');
    expect(mockLink.href).toBe('data:image/png;base64,mocked-qr-code');
    expect(mockLink.click).toHaveBeenCalledTimes(1);

    createElementSpy.mockRestore();
  });

  it('uses the shared modal close controls', () => {
    const onClose = vi.fn();
    renderModal({ onClose });

    const closeButtons = screen.getAllByRole('button', { name: '關閉' });
    expect(closeButtons).toHaveLength(2);
    fireEvent.click(closeButtons[0]);
    fireEvent.click(closeButtons[1]);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
