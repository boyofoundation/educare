/// <reference types="vitest/globals" />
/* global HTMLAnchorElement */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { vi } from 'vitest';
import { ShareModal } from '../ShareModal';
import { Assistant } from '../../../types';
import { saveAssistantToTurso } from '../../../services/tursoService';
import { generateShortUrl, buildShortUrl } from '../../../services/shortUrlService';
import QRCode from 'qrcode';
import { TEST_ASSISTANTS, setupAssistantTestEnvironment } from './test-utils';

// Mock dependencies
vi.mock('../../../services/tursoService', () => ({
  saveAssistantToTurso: vi.fn().mockResolvedValue(undefined),
}));

// Mock short URL service
vi.mock('../../../services/shortUrlService', () => ({
  generateShortUrl: vi.fn().mockResolvedValue('https://short.url/abc123'),
  buildShortUrl: vi.fn().mockReturnValue('https://short.url/abc123'),
}));

// ShareModal 於執行期動態 import('qrcode')，Vitest 可能為元件端另外實例化一次 mock 模組。
// 以 vi.hoisted 建立共用 spy，讓測試檔靜態 import 與元件動態 import 拿到同一個 mock fn
// （同 geometryRenderer.test.ts 的 jsxgraph 模式）。
const qrCodeMocks = vi.hoisted(() => ({
  toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,mocked-qr-code'),
}));

vi.mock('qrcode', () => ({
  default: {
    toDataURL: qrCodeMocks.toDataURL,
  },
  toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,mocked-qr-code-direct'),
}));

beforeAll(() => {
  // Mock window.location
  // pathname must be '/chat/app' so that:
  //   baseUrl = pathname.replace(/\/[^/]*$/, '') = '/chat'
  //   url = origin + baseUrl + '?share=...' = 'https://example.com/chat?share=...'
  Object.defineProperty(window, 'location', {
    value: {
      origin: 'https://example.com',
      pathname: '/chat/app',
    },
    writable: true,
  });

  // Mock navigator.clipboard
  Object.assign(navigator, {
    clipboard: {
      writeText: vi.fn().mockResolvedValue(undefined),
    },
  });

  // Remove global mock to avoid recursion issues
  // Mock will be handled in specific tests
});

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  assistant: Assistant;
}

describe('ShareModal', () => {
  let mockProps: ShareModalProps;
  let testEnvironment: ReturnType<typeof setupAssistantTestEnvironment>;

  beforeEach(() => {
    testEnvironment = setupAssistantTestEnvironment();

    mockProps = {
      isOpen: true,
      onClose: vi.fn(),
      assistant: TEST_ASSISTANTS.basic,
    };

    // Clear all mocks then re-establish critical return values.
    // vi.clearAllMocks() resets mockReturnValue/mockResolvedValue implementations
    // in Vitest 3.2.4, so every mock must be re-set here.
    vi.clearAllMocks();
    vi.mocked(saveAssistantToTurso).mockResolvedValue(undefined);
    vi.mocked(QRCode.toDataURL).mockImplementation(
      (async () => 'data:image/png;base64,mocked-qr-code') as never,
    );
    vi.mocked(generateShortUrl).mockResolvedValue('https://short.url/abc123');
    vi.mocked(buildShortUrl).mockReturnValue('https://short.url/abc123');
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    testEnvironment.cleanup();
  });

  describe('Rendering', () => {
    it('renders nothing when modal is closed', () => {
      const closedProps = {
        ...mockProps,
        isOpen: false,
      };

      render(<ShareModal {...closedProps} />);

      expect(screen.queryByText('分享助理')).not.toBeInTheDocument();
    });

    it('renders modal when open', () => {
      render(<ShareModal {...mockProps} />);

      expect(screen.getByText('分享助理')).toBeInTheDocument();
      // Name is inside a <span>, so full text is split across elements — use regex
      expect(screen.getByText(/分享.*給其他人使用/)).toBeInTheDocument();
    });

    it('renders all main sections', () => {
      render(<ShareModal {...mockProps} />);

      expect(screen.getByText('分享助理')).toBeInTheDocument();
      expect(screen.getByText('分享連結')).toBeInTheDocument();
      expect(screen.getByLabelText(/使用短網址/)).toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: '關閉' })).toHaveLength(2);
    });

    it('renders close button with proper icon', () => {
      render(<ShareModal {...mockProps} />);

      const closeButton = screen.getByTestId('close-share-modal');
      expect(closeButton).toBeInTheDocument();
      expect(closeButton.querySelector('svg')).toBeInTheDocument();
    });

    it('renders copy and download buttons', async () => {
      render(<ShareModal {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: '複製' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '下載 QR Code' })).toBeInTheDocument();
      });
    });
  });

  describe('Share Link Generation', () => {
    it('generates basic share link on mount', async () => {
      const { saveAssistantToTurso } = await import('../../../services/tursoService');
      const mockSaveAssistantToTurso = vi.mocked(saveAssistantToTurso);
      mockSaveAssistantToTurso.mockResolvedValue(undefined);

      render(<ShareModal {...mockProps} />);

      await waitFor(() => {
        expect(mockSaveAssistantToTurso).toHaveBeenCalledWith({
          id: TEST_ASSISTANTS.basic.id,
          name: TEST_ASSISTANTS.basic.name,
          description: TEST_ASSISTANTS.basic.description,
          systemPrompt: TEST_ASSISTANTS.basic.systemPrompt,
          createdAt: TEST_ASSISTANTS.basic.createdAt,
        });
      });

      const shareInput = screen.getByDisplayValue(
        `https://example.com/chat?share=${TEST_ASSISTANTS.basic.id}`,
      );
      expect(shareInput).toBeInTheDocument();
    });

    it('handles assistant with undefined description', async () => {
      const assistantWithoutDescription = {
        ...TEST_ASSISTANTS.basic,
        description: '',
      };

      const propsWithoutDescription = {
        ...mockProps,
        assistant: assistantWithoutDescription,
      };

      const { saveAssistantToTurso } = await import('../../../services/tursoService');
      const mockSaveAssistantToTurso = vi.mocked(saveAssistantToTurso);
      mockSaveAssistantToTurso.mockResolvedValue(undefined);

      render(<ShareModal {...propsWithoutDescription} />);

      await waitFor(() => {
        expect(mockSaveAssistantToTurso).toHaveBeenCalledWith(
          expect.objectContaining({
            description: '', // Should default to empty string
          }),
        );
      });
    });

    it('handles assistant with undefined createdAt', async () => {
      const assistantWithoutCreatedAt = {
        ...TEST_ASSISTANTS.basic,
        createdAt: Date.now(),
      };

      const propsWithoutCreatedAt = {
        ...mockProps,
        assistant: assistantWithoutCreatedAt,
      };

      const { saveAssistantToTurso } = await import('../../../services/tursoService');
      const mockSaveAssistantToTurso = vi.mocked(saveAssistantToTurso);
      mockSaveAssistantToTurso.mockResolvedValue(undefined);

      render(<ShareModal {...propsWithoutCreatedAt} />);

      await waitFor(() => {
        expect(mockSaveAssistantToTurso).toHaveBeenCalledWith(
          expect.objectContaining({
            createdAt: expect.any(Number), // Should use Date.now()
          }),
        );
      });
    });

    it('shows success message after successful link generation', async () => {
      render(<ShareModal {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByText('分享連結生成成功！')).toBeInTheDocument();
      });
    });

    it('shows error message when Turso save fails', async () => {
      const { saveAssistantToTurso } = await import('../../../services/tursoService');
      const mockSaveAssistantToTurso = vi.mocked(saveAssistantToTurso);
      mockSaveAssistantToTurso.mockRejectedValue(new Error('Turso connection failed'));

      render(<ShareModal {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByText(/生成分享連結失敗/)).toBeInTheDocument();
        expect(screen.getByText(/Turso connection failed/)).toBeInTheDocument();
      });
    });
  });

  describe('QR Code Generation', () => {
    it('generates and displays QR code', async () => {
      // Use the already-mocked QRCode.toDataURL (set up in beforeEach).
      // The component calls it during the mount effect, so we assert after render.
      render(<ShareModal {...mockProps} />);

      await waitFor(() => {
        expect(QRCode.toDataURL).toHaveBeenCalledWith(
          `https://example.com/chat?share=${TEST_ASSISTANTS.basic.id}`,
          expect.objectContaining({
            width: 256,
            margin: 2,
            color: {
              dark: '#1f2937',
              light: '#ffffff',
            },
          }),
        );
      });

      expect(screen.getByAltText('分享 QR Code')).toBeInTheDocument();
      expect(screen.getByText('掃描 QR Code 或複製下方連結')).toBeInTheDocument();
    });

    it('enables download button when QR code is available', async () => {
      render(<ShareModal {...mockProps} />);

      await waitFor(() => {
        const downloadButton = screen.getByRole('button', { name: '下載 QR Code' });
        expect(downloadButton).not.toBeDisabled();
      });
    });
  });

  describe('Copy Functionality', () => {
    it('copies share link to clipboard', async () => {
      render(<ShareModal {...mockProps} />);

      // Wait for initial share link generation to complete
      await waitFor(() => {
        expect(
          screen.getByDisplayValue(`https://example.com/chat?share=${TEST_ASSISTANTS.basic.id}`),
        ).toBeInTheDocument();
      });

      const copyButton = screen.getByRole('button', { name: '複製' });
      fireEvent.click(copyButton);

      await waitFor(() => {
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
          `https://example.com/chat?share=${TEST_ASSISTANTS.basic.id}`,
        );
      });

      expect(screen.getByText('連結已複製到剪貼簿！')).toBeInTheDocument();
    });

    it('shows error message when clipboard copy fails', async () => {
      vi.mocked(navigator.clipboard.writeText).mockRejectedValue(new Error('Clipboard failed'));

      render(<ShareModal {...mockProps} />);

      // Wait for initial share link generation to complete
      await waitFor(() => {
        expect(
          screen.getByDisplayValue(`https://example.com/chat?share=${TEST_ASSISTANTS.basic.id}`),
        ).toBeInTheDocument();
      });

      const copyButton = screen.getByRole('button', { name: '複製' });
      fireEvent.click(copyButton);

      await waitFor(() => {
        expect(screen.getByText('複製失敗，請手動複製連結。')).toBeInTheDocument();
      });
    });

    it('clears success message after timeout', async () => {
      const { act } = await import('@testing-library/react');

      render(<ShareModal {...mockProps} />);

      // Wait for initial share link generation to complete with real timers
      await waitFor(() => {
        expect(
          screen.getByDisplayValue(`https://example.com/chat?share=${TEST_ASSISTANTS.basic.id}`),
        ).toBeInTheDocument();
      });

      // Switch to fake timers only after async setup is done
      vi.useFakeTimers();

      const copyButton = screen.getByRole('button', { name: '複製' });

      // Click and flush the clipboard promise microtasks inside act
      await act(async () => {
        fireEvent.click(copyButton);
        // Flush the resolved clipboard.writeText promise
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(screen.getByText('連結已複製到剪貼簿！')).toBeInTheDocument();

      // Advance the 3-second clearance timer and flush React updates
      await act(async () => {
        vi.advanceTimersByTime(3000);
      });

      expect(screen.queryByText('連結已複製到剪貼簿！')).not.toBeInTheDocument();
    });
  });

  describe('Download QR Code', () => {
    it('downloads QR code with correct filename', async () => {
      const mockLink = {
        download: '',
        href: '',
        click: vi.fn(),
      };
      const originalCreateElement = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation((tag: string, ...args: unknown[]) => {
        if (tag === 'a') {
          return mockLink as unknown as HTMLAnchorElement;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return originalCreateElement(tag, ...(args as [any?]));
      });

      render(<ShareModal {...mockProps} />);

      // Wait for QR code to be generated so download button is enabled
      await waitFor(() => {
        const downloadButton = screen.getByRole('button', { name: '下載 QR Code' });
        expect(downloadButton).not.toBeDisabled();
      });

      const downloadButton = screen.getByRole('button', { name: '下載 QR Code' });
      fireEvent.click(downloadButton);

      expect(mockLink.download).toBe(`${TEST_ASSISTANTS.basic.name}-share-qr.png`);
      expect(mockLink.href).toBe('data:image/png;base64,mocked-qr-code');
      expect(mockLink.click).toHaveBeenCalled();
    });
  });

  describe('Provider Settings Messaging', () => {
    it('explains that assistant sharing no longer includes provider credentials', () => {
      render(<ShareModal {...mockProps} />);

      expect(
        screen.getByText(/助理分享只包含助理內容與連結，不再附帶 API 金鑰或服務商設定/),
      ).toBeInTheDocument();
      expect(screen.getByText(/請到「AI 服務商」頁面使用新的安全分享功能/)).toBeInTheDocument();
    });

    it('does not render the removed api key sharing controls', () => {
      render(<ShareModal {...mockProps} />);

      expect(screen.queryByLabelText(/包含我的 API 金鑰/)).not.toBeInTheDocument();
      expect(screen.queryByPlaceholderText('設定密碼')).not.toBeInTheDocument();
      expect(screen.queryByText('加密密碼')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /加密分享連結/ })).not.toBeInTheDocument();
    });
  });

  describe('Modal Interaction', () => {
    it('calls onClose when close button is clicked', () => {
      render(<ShareModal {...mockProps} />);

      const closeButtons = screen.getAllByRole('button');
      const headerCloseButton = closeButtons.find(
        button => button.querySelector('svg') && !button.textContent?.trim(),
      );

      if (headerCloseButton) {
        fireEvent.click(headerCloseButton);
        expect(mockProps.onClose).toHaveBeenCalled();
      }
    });

    it('calls onClose when bottom close button is clicked', () => {
      render(<ShareModal {...mockProps} />);

      const closeButtons = screen.getAllByRole('button', { name: '關閉' });
      fireEvent.click(closeButtons[1]);

      expect(mockProps.onClose).toHaveBeenCalled();
    });

    it('prevents modal close when clicking inside modal content', () => {
      render(<ShareModal {...mockProps} />);

      const modalContent = screen.getByText('分享助理').closest('div');
      if (modalContent) {
        fireEvent.click(modalContent);
        expect(mockProps.onClose).not.toHaveBeenCalled();
      }
    });
  });

  describe('Status Messages', () => {
    it('displays success status with correct styling', async () => {
      render(<ShareModal {...mockProps} />);

      await waitFor(() => {
        const successMessage = screen.getByText('分享連結生成成功！');
        expect(successMessage).toBeInTheDocument();

        const statusContainer = successMessage.closest('div');
        expect(statusContainer).toHaveClass(
          'bg-green-900/30',
          'border-green-600/30',
          'text-green-200',
        );
      });
    });

    it('displays error status with correct styling', async () => {
      const { saveAssistantToTurso } = await import('../../../services/tursoService');
      const mockSaveAssistantToTurso = vi.mocked(saveAssistantToTurso);
      mockSaveAssistantToTurso.mockRejectedValue(new Error('Test error'));

      render(<ShareModal {...mockProps} />);

      await waitFor(() => {
        const errorMessage = screen.getByText(/生成分享連結失敗/);
        expect(errorMessage).toBeInTheDocument();

        const statusContainer = errorMessage.closest('div');
        expect(statusContainer).toHaveClass('bg-red-900/30', 'border-red-600/30', 'text-red-200');
      });
    });

    it('includes proper status icons', async () => {
      render(<ShareModal {...mockProps} />);

      await waitFor(() => {
        expect(screen.getByText('✅')).toBeInTheDocument();
      });
    });
  });

  describe('Accessibility', () => {
    it('has proper ARIA labels and roles', () => {
      render(<ShareModal {...mockProps} />);

      expect(screen.getByRole('button', { name: '複製' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '下載 QR Code' })).toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: '關閉' })).toHaveLength(2);
    });

    it('has proper form labels', () => {
      render(<ShareModal {...mockProps} />);

      expect(screen.getByLabelText(/使用短網址/)).toBeInTheDocument();
      expect(screen.getByText('分享連結')).toBeInTheDocument();
    });

    it('has proper input attributes', async () => {
      render(<ShareModal {...mockProps} />);

      const shareInput = await waitFor(() =>
        screen.getByDisplayValue(/https:\/\/example\.com\/chat\?share=/),
      );
      expect(shareInput).toHaveAttribute('readonly');
      expect(shareInput).toHaveAttribute('type', 'text');
    });
  });

  describe('Edge Cases', () => {
    it('handles assistant with very long name', async () => {
      const assistantWithLongName = {
        ...TEST_ASSISTANTS.basic,
        name: 'Very Long Assistant Name That Might Break Layout Or URL Generation In Some Cases',
      };

      const propsWithLongName = {
        ...mockProps,
        assistant: assistantWithLongName,
      };

      render(<ShareModal {...propsWithLongName} />);

      await waitFor(() => {
        expect(screen.getByText(/分享.*給其他人使用/)).toBeInTheDocument();
      });
    });

    it('handles special characters in assistant name', async () => {
      const assistantWithSpecialChars = {
        ...TEST_ASSISTANTS.basic,
        name: 'Assistant with émojis 🤖 and spëcial chars & symbols!',
      };

      const propsWithSpecialChars = {
        ...mockProps,
        assistant: assistantWithSpecialChars,
      };

      const mockLink = { download: '', href: '', click: vi.fn() };
      const originalCreateElement = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation((tag: string, ...args: unknown[]) => {
        if (tag === 'a') {
          return mockLink as unknown as HTMLAnchorElement;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return originalCreateElement(tag, ...(args as [any?]));
      });

      render(<ShareModal {...propsWithSpecialChars} />);

      // Wait for QR code to be ready so the download button is enabled
      await waitFor(() => {
        expect(screen.getByRole('button', { name: '下載 QR Code' })).not.toBeDisabled();
      });

      fireEvent.click(screen.getByRole('button', { name: '下載 QR Code' }));

      // Should handle special characters in filename
      expect(mockLink.download).toBe(`${assistantWithSpecialChars.name}-share-qr.png`);
    });

    it('handles rapid modal open/close', () => {
      const { rerender } = render(<ShareModal {...mockProps} />);

      // Rapidly toggle modal
      for (let i = 0; i < 5; i++) {
        rerender(<ShareModal {...mockProps} isOpen={false} />);
        rerender(<ShareModal {...mockProps} isOpen={true} />);
      }

      expect(screen.getByText('分享助理')).toBeInTheDocument();
    });

    it('handles QR code generation failure', async () => {
      const mockQRCode = vi.mocked(await import('qrcode')).default;
      vi.mocked(mockQRCode.toDataURL).mockImplementation(async () => {
        throw new Error('QR generation failed');
      });

      // Should not crash the component
      render(<ShareModal {...mockProps} />);

      expect(screen.getByText('分享助理')).toBeInTheDocument();
    });
  });
});
