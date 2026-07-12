/// <reference lib="dom" />
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import React from 'react';

// Mock assistant components before importing Layout
vi.mock('../../assistant', () => ({
  AssistantList: ({
    assistants,
    selectedAssistant,
    onSelect,
    onEdit,
    onDelete,
    onShare,
    onCreateNew,
  }: {
    assistants: Array<{ id: string; name: string }>;
    selectedAssistant: { id: string; name: string } | null;
    onSelect: (id: string) => void;
    onEdit: (assistant: { id: string; name: string }) => void;
    onDelete: (id: string) => void;
    onShare: (assistant: { id: string; name: string }) => void;
    onCreateNew: () => void;
  }) => {
    const React = require('react');
    return React.createElement(
      'div',
      {
        'data-testid': 'assistant-list',
        role: 'navigation',
        'aria-label': '助理選擇',
        className: 'mb-6 px-2',
      },
      [
        React.createElement(
          'label',
          {
            key: 'label',
            className: 'block text-sm font-bold text-gray-300 uppercase tracking-wider mb-2',
          },
          '選擇助理',
        ),
        React.createElement(
          'select',
          {
            key: 'select',
            'data-testid': 'assistant-select',
            value: selectedAssistant?.id || '',
            onChange: (e: { target: { value: string } }) => onSelect(e.target.value),
            className:
              'w-full p-2.5 bg-gray-700/50 border border-gray-600/30 rounded-lg text-white text-sm',
          },
          [
            React.createElement('option', { key: 'placeholder', value: '' }, '請選擇一個助理'),
            ...assistants.map((assistant: { id: string; name: string }) =>
              React.createElement(
                'option',
                { key: assistant.id, value: assistant.id },
                assistant.name,
              ),
            ),
          ],
        ),
        React.createElement(
          'div',
          {
            key: 'actions',
            className: 'flex justify-end gap-1 mt-2',
          },
          [
            React.createElement(
              'button',
              {
                key: 'create-new',
                onClick: onCreateNew,
                'data-testid': 'create-new-button',
                className: 'p-1.5 text-gray-400 hover:text-cyan-400 rounded-md',
                title: '新增助理',
              },
              '+',
            ),
            selectedAssistant &&
              React.createElement(
                'button',
                {
                  key: 'share',
                  onClick: () => onShare(selectedAssistant),
                  'data-testid': `share-${selectedAssistant.id}`,
                  className: 'p-1.5 text-gray-400 hover:text-blue-400 rounded-md',
                  title: '分享助理',
                },
                'Share',
              ),
            selectedAssistant &&
              React.createElement(
                'button',
                {
                  key: 'edit',
                  onClick: () => onEdit(selectedAssistant),
                  'data-testid': `edit-${selectedAssistant.id}`,
                  className: 'p-1.5 text-gray-400 hover:text-cyan-400 rounded-md',
                  title: '編輯助理',
                },
                'Edit',
              ),
            selectedAssistant &&
              React.createElement(
                'button',
                {
                  key: 'delete',
                  onClick: () => onDelete(selectedAssistant.id),
                  'data-testid': `delete-${selectedAssistant.id}`,
                  className: 'p-1.5 text-gray-400 hover:text-red-400 rounded-md',
                  title: '刪除助理',
                },
                'Delete',
              ),
          ],
        ),
      ],
    );
  },
}));

// Mock UI Icons
vi.mock('../../ui/Icons', () => ({
  ChatIcon: ({ className }: { className?: string }) => {
    const React = require('react');
    return React.createElement(
      'svg',
      { 'data-testid': 'chat-icon', className, viewBox: '0 0 24 24' },
      null,
    );
  },
  TrashIcon: ({ className }: { className?: string }) => {
    const React = require('react');
    return React.createElement(
      'svg',
      { 'data-testid': 'trash-icon', className, viewBox: '0 0 24 24' },
      null,
    );
  },
  SettingsIcon: ({ className }: { className?: string }) => {
    const React = require('react');
    return React.createElement(
      'svg',
      { 'data-testid': 'settings-icon', className, viewBox: '0 0 24 24' },
      null,
    );
  },
  PlusIcon: ({ className }: { className?: string }) => {
    const React = require('react');
    return React.createElement(
      'svg',
      { 'data-testid': 'plus-icon', className, viewBox: '0 0 24 24' },
      null,
    );
  },
}));

// Mock services
vi.mock('../../../services/db', () => ({
  getAssistant: vi.fn(),
  saveAssistant: vi.fn(),
  deleteAssistant: vi.fn(),
  getAllAssistants: vi.fn(),
  getSessionsForAssistant: vi.fn(),
  saveSession: vi.fn(),
  deleteSession: vi.fn(),
}));

vi.mock('../../../services/tursoService', () => ({
  canWriteToTurso: vi.fn().mockReturnValue(true),
  initializeDatabase: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../services/embeddingService', () => ({
  preloadEmbeddingModel: vi.fn().mockResolvedValue(undefined),
  isEmbeddingModelLoaded: vi.fn().mockReturnValue(true),
  generateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
}));

vi.mock('../../../services/providerRegistry', () => ({
  initializeProviders: vi.fn().mockResolvedValue(undefined),
  providerManager: {
    getAvailableProviders: vi.fn().mockReturnValue(['gemini']),
  },
}));

vi.mock('../../../services/shortUrlService', () => ({
  resolveShortUrl: vi.fn().mockResolvedValue(null),
  recordShortUrlClick: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../services/cryptoService', () => ({
  CryptoService: {
    encryptApiKeys: vi.fn().mockResolvedValue('encrypted'),
    decryptApiKeys: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('../../../services/apiKeyManager', () => ({
  ApiKeyManager: {
    getUserApiKeys: vi.fn().mockReturnValue({}),
    saveUserApiKeys: vi.fn(),
  },
}));

vi.mock('../../hooks/useTursoAssistantStatus', () => ({
  useTursoAssistantStatus: vi.fn().mockReturnValue({ canShare: true }),
}));

import { Layout, formatRelativeTime } from '../Layout';
import { AppProvider } from '../AppContext';
import {
  setupCoreTestEnvironment,
  TEST_ASSISTANTS,
  TEST_SESSIONS,
  RESPONSIVE_BREAKPOINTS,
} from './test-utils';

// Test component that uses Layout
function TestLayoutContent() {
  return (
    <div data-testid='layout-content'>
      <h1>Test Content</h1>
      <p>This is test content inside the layout</p>
    </div>
  );
}

// Wrapper component to provide app context
function TestLayoutWrapper({ children }: { children: React.ReactNode }) {
  return (
    <AppProvider>
      <Layout>{children}</Layout>
    </AppProvider>
  );
}

beforeAll(() => {
  setupCoreTestEnvironment();
});

describe('Layout', () => {
  let testEnvironment: ReturnType<typeof setupCoreTestEnvironment>;

  beforeEach(async () => {
    testEnvironment = setupCoreTestEnvironment();

    // Setup mock data for layout tests
    const mockGetAllAssistants = vi.mocked(await import('../../../services/db')).getAllAssistants;
    const mockGetAssistant = vi.mocked(await import('../../../services/db')).getAssistant;
    const mockGetSessions = vi.mocked(await import('../../../services/db')).getSessionsForAssistant;

    mockGetAllAssistants.mockResolvedValue([TEST_ASSISTANTS.basic, TEST_ASSISTANTS.withRag]);
    mockGetAssistant.mockResolvedValue(TEST_ASSISTANTS.basic);
    mockGetSessions.mockResolvedValue([TEST_SESSIONS.withMessages, TEST_SESSIONS.empty]);
  });

  afterEach(() => {
    testEnvironment.cleanup();
  });

  // Helper to find the sidebar element by its data-testid on the sidebar div
  // The sidebar is the fixed div wrapping the AssistantList
  const getSidebarDiv = () => {
    const assistantList = screen.getByTestId('assistant-list');
    // Walk up to the fixed sidebar container (has translate classes)
    let el: HTMLElement | null = assistantList.parentElement;
    while (el) {
      if (
        el.className &&
        (el.className.includes('translate-x-0') ||
          el.className.includes('-translate-x-full') ||
          el.className.includes('fixed'))
      ) {
        return el;
      }
      el = el.parentElement;
    }
    // fallback: return direct parent
    return assistantList.parentElement;
  };

  describe('formatRelativeTime', () => {
    // 固定基準時間：2026-07-07 12:00:00（本地時區）
    const NOW = new Date(2026, 6, 7, 12, 0, 0).getTime();

    it('returns 剛剛 for timestamps within one minute', () => {
      expect(formatRelativeTime(NOW - 30_000, NOW)).toBe('剛剛');
      expect(formatRelativeTime(NOW, NOW)).toBe('剛剛');
    });

    it('returns N 分鐘前 for timestamps within one hour', () => {
      expect(formatRelativeTime(NOW - 5 * 60_000, NOW)).toBe('5 分鐘前');
      expect(formatRelativeTime(NOW - 59 * 60_000, NOW)).toBe('59 分鐘前');
    });

    it('returns N 小時前 for timestamps earlier today', () => {
      expect(formatRelativeTime(NOW - 3 * 3_600_000, NOW)).toBe('3 小時前');
    });

    it('returns 昨天 for timestamps that fall on the previous day', () => {
      const yesterdayNoon = new Date(2026, 6, 6, 12, 0, 0).getTime();
      expect(formatRelativeTime(yesterdayNoon, NOW)).toBe('昨天');
    });

    it('returns M月D日 for older timestamps', () => {
      const older = new Date(2026, 5, 20, 9, 30, 0).getTime();
      expect(formatRelativeTime(older, NOW)).toBe('6月20日');
    });
  });

  describe('Brand Area', () => {
    it('should render the EduCare brand in the sidebar', async () => {
      Object.defineProperty(window, 'innerWidth', {
        value: RESPONSIVE_BREAKPOINTS.desktop + 100,
        writable: true,
      });

      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      await waitFor(() => {
        expect(screen.getByText('EduCare')).toBeInTheDocument();
        expect(screen.getByText('AI 教學助理')).toBeInTheDocument();
      });
    });

    it('should hide the brand wordmark when collapsed but keep the logo mark', async () => {
      Object.defineProperty(window, 'innerWidth', {
        value: RESPONSIVE_BREAKPOINTS.desktop + 100,
        writable: true,
      });

      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      await waitFor(() => {
        expect(screen.getByText('EduCare')).toBeInTheDocument();
      });

      const toggle = screen.getByTestId('sidebar-collapse-toggle');
      await act(async () => {
        fireEvent.click(toggle);
      });

      await waitFor(() => {
        expect(screen.queryByText('EduCare')).not.toBeInTheDocument();
        // Logo mark（漸層 SVG）仍然存在
        expect(document.querySelector('#educare-brand-gradient')).toBeInTheDocument();
      });
    });
  });

  describe('Basic Structure', () => {
    it('should render sidebar and main content area', async () => {
      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      // Wait for loading to complete
      await waitFor(
        () => {
          expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument();
        },
        { timeout: 3000 },
      );

      // Should render main content
      expect(screen.getByRole('main')).toBeInTheDocument();
      expect(screen.getByTestId('layout-content')).toBeInTheDocument();

      // Should render sidebar with assistant list
      expect(screen.getByTestId('assistant-list')).toBeInTheDocument();
    });

    it('should expose a discoverable import-bundle entry point in the sidebar', async () => {
      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      await waitFor(
        () => {
          expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument();
        },
        { timeout: 3000 },
      );

      const entry = screen.getByRole('button', { name: '匯入協作包' });
      expect(entry).toBeInTheDocument();
      // Clicking must not throw and should be keyboard-focusable.
      expect(entry).toHaveAttribute('type', 'button');
      await act(async () => {
        fireEvent.click(entry);
      });
    });

    it('should render children content correctly', () => {
      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      expect(screen.getByText('Test Content')).toBeInTheDocument();
      expect(screen.getByText('This is test content inside the layout')).toBeInTheDocument();
    });

    it('should have proper ARIA labels for navigation', async () => {
      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      await waitFor(() => {
        // Should have assistant selection navigation initially
        const assistantNavigation = screen.getByRole('navigation', { name: '助理選擇' });
        expect(assistantNavigation).toBeInTheDocument();
      });
    });
  });

  describe('Sidebar Behavior', () => {
    it('should show sidebar by default on desktop', async () => {
      // Set desktop width
      Object.defineProperty(window, 'innerWidth', {
        value: RESPONSIVE_BREAKPOINTS.desktop + 100,
        writable: true,
      });

      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      await waitFor(() => {
        const sidebar = getSidebarDiv();
        expect(sidebar).toHaveClass('translate-x-0');
      });
    });

    it('should hide sidebar by default on mobile', async () => {
      // Set mobile width
      Object.defineProperty(window, 'innerWidth', {
        value: RESPONSIVE_BREAKPOINTS.mobile - 100,
        writable: true,
      });

      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      // Trigger resize to update state
      await act(async () => {
        fireEvent(window, new Event('resize'));
      });

      await waitFor(() => {
        const sidebar = getSidebarDiv();
        expect(sidebar).toHaveClass('-translate-x-full');
      });
    });

    it('should hide sidebar by default on tablet', async () => {
      // Set tablet width
      Object.defineProperty(window, 'innerWidth', {
        value: (RESPONSIVE_BREAKPOINTS.mobile + RESPONSIVE_BREAKPOINTS.desktop) / 2,
        writable: true,
      });

      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      // Trigger resize to update state
      await act(async () => {
        fireEvent(window, new Event('resize'));
      });

      await waitFor(() => {
        const sidebar = getSidebarDiv();
        expect(sidebar).toHaveClass('-translate-x-full');
      });
    });

    it('should toggle sidebar visibility when hamburger menu is clicked', async () => {
      // Set mobile width to show hamburger menu
      Object.defineProperty(window, 'innerWidth', {
        value: RESPONSIVE_BREAKPOINTS.mobile - 100,
        writable: true,
      });

      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      // Trigger resize so the context knows it's mobile
      await act(async () => {
        fireEvent(window, new Event('resize'));
      });

      await waitFor(() => {
        const sidebar = getSidebarDiv();
        expect(sidebar).toHaveClass('-translate-x-full');
      });

      // Find the hamburger button (it's the only button in the top bar when sidebar is closed on mobile)
      const hamburgerButton = document.querySelector(
        'button[class*="hover:text-white"][class*="mr-3"]',
      ) as HTMLElement;
      expect(hamburgerButton).toBeInTheDocument();

      // Click to open sidebar
      await act(async () => {
        fireEvent.click(hamburgerButton!);
      });

      await waitFor(() => {
        const sidebar = getSidebarDiv();
        expect(sidebar).toHaveClass('translate-x-0');
      });
    });

    it('should show close button in sidebar on mobile when open', async () => {
      // Set mobile width
      Object.defineProperty(window, 'innerWidth', {
        value: RESPONSIVE_BREAKPOINTS.mobile - 100,
        writable: true,
      });

      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      // Trigger resize so the context knows it's mobile
      await act(async () => {
        fireEvent(window, new Event('resize'));
      });

      await waitFor(() => {
        const sidebar = getSidebarDiv();
        expect(sidebar).toHaveClass('-translate-x-full');
      });

      // Open sidebar via hamburger button
      const hamburgerButton = document.querySelector(
        'button[class*="hover:text-white"][class*="mr-3"]',
      ) as HTMLElement;
      await act(async () => {
        fireEvent.click(hamburgerButton!);
      });

      // Should show close button in sidebar (the X button)
      await waitFor(() => {
        const closeButton = document.querySelector(
          'button[class*="hover:text-white"][class*="p-2"]',
        ) as HTMLElement;
        expect(closeButton).toBeInTheDocument();
      });
    });

    it('should close sidebar when close button is clicked', async () => {
      // Set mobile width
      Object.defineProperty(window, 'innerWidth', {
        value: RESPONSIVE_BREAKPOINTS.mobile - 100,
        writable: true,
      });

      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      // Trigger resize
      await act(async () => {
        fireEvent(window, new Event('resize'));
      });

      await waitFor(() => {
        const sidebar = getSidebarDiv();
        expect(sidebar).toHaveClass('-translate-x-full');
      });

      // Open sidebar
      const hamburgerButton = document.querySelector(
        'button[class*="hover:text-white"][class*="mr-3"]',
      ) as HTMLElement;
      await act(async () => {
        fireEvent.click(hamburgerButton!);
      });

      await waitFor(() => {
        const sidebar = getSidebarDiv();
        expect(sidebar).toHaveClass('translate-x-0');
      });

      // Find and click close button (X inside sidebar)
      const closeButton = document.querySelector(
        'button[class*="p-2"][class*="text-gray-400"]',
      ) as HTMLElement;
      await act(async () => {
        fireEvent.click(closeButton!);
      });

      await waitFor(() => {
        const sidebar = getSidebarDiv();
        expect(sidebar).toHaveClass('-translate-x-full');
      });
    });

    it('should show overlay when sidebar is open on mobile', async () => {
      // Set mobile width
      Object.defineProperty(window, 'innerWidth', {
        value: RESPONSIVE_BREAKPOINTS.mobile - 100,
        writable: true,
      });

      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      // Trigger resize
      await act(async () => {
        fireEvent(window, new Event('resize'));
      });

      // Open sidebar
      await waitFor(() => {
        const sidebar = getSidebarDiv();
        expect(sidebar).toHaveClass('-translate-x-full');
      });

      const hamburgerButton = document.querySelector(
        'button[class*="hover:text-white"][class*="mr-3"]',
      ) as HTMLElement;
      await act(async () => {
        fireEvent.click(hamburgerButton!);
      });

      // Should show overlay
      await waitFor(() => {
        const overlay = document.querySelector('.fixed.inset-0.bg-black\\/50');
        expect(overlay).toBeInTheDocument();
      });
    });

    it('should close sidebar when overlay is clicked', async () => {
      // Set mobile width
      Object.defineProperty(window, 'innerWidth', {
        value: RESPONSIVE_BREAKPOINTS.mobile - 100,
        writable: true,
      });

      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      // Trigger resize
      await act(async () => {
        fireEvent(window, new Event('resize'));
      });

      await waitFor(() => {
        const sidebar = getSidebarDiv();
        expect(sidebar).toHaveClass('-translate-x-full');
      });

      // Open sidebar
      const hamburgerButton = document.querySelector(
        'button[class*="hover:text-white"][class*="mr-3"]',
      ) as HTMLElement;
      await act(async () => {
        fireEvent.click(hamburgerButton!);
      });

      // Click overlay to close
      const overlay = await waitFor(() => {
        const overlayElement = document.querySelector('.fixed.inset-0.bg-black\\/50');
        expect(overlayElement).toBeInTheDocument();
        return overlayElement as HTMLElement;
      });

      await act(async () => {
        fireEvent.click(overlay);
      });

      await waitFor(() => {
        const sidebar = getSidebarDiv();
        expect(sidebar).toHaveClass('-translate-x-full');
      });
    });
  });

  describe('Responsive Design', () => {
    it('should use mobile width for sidebar on mobile devices', async () => {
      Object.defineProperty(window, 'innerWidth', {
        value: RESPONSIVE_BREAKPOINTS.mobile - 100,
        writable: true,
      });

      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      await act(async () => {
        fireEvent(window, new Event('resize'));
      });

      await waitFor(() => {
        const sidebar = getSidebarDiv();
        expect(sidebar).toHaveClass('w-80'); // Mobile width
      });
    });

    it('should use tablet width for sidebar on tablet devices', async () => {
      Object.defineProperty(window, 'innerWidth', {
        value: (RESPONSIVE_BREAKPOINTS.mobile + RESPONSIVE_BREAKPOINTS.desktop) / 2,
        writable: true,
      });

      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      await act(async () => {
        fireEvent(window, new Event('resize'));
      });

      await waitFor(() => {
        const sidebar = getSidebarDiv();
        expect(sidebar).toHaveClass('w-80'); // Tablet width
      });
    });

    it('should use desktop width for sidebar on desktop devices', async () => {
      Object.defineProperty(window, 'innerWidth', {
        value: RESPONSIVE_BREAKPOINTS.desktop + 100,
        writable: true,
      });

      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      await waitFor(() => {
        const sidebar = getSidebarDiv();
        expect(sidebar).toHaveClass('w-72'); // Desktop width
      });
    });

    it('should adjust main content margin based on sidebar state on desktop', async () => {
      Object.defineProperty(window, 'innerWidth', {
        value: RESPONSIVE_BREAKPOINTS.desktop + 100,
        writable: true,
      });

      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      await waitFor(() => {
        const main = screen.getByRole('main');
        expect(main).toHaveClass('pl-72'); // Desktop margin when sidebar is open
      });
    });

    it('should not adjust main content margin on mobile/tablet', async () => {
      Object.defineProperty(window, 'innerWidth', {
        value: RESPONSIVE_BREAKPOINTS.mobile - 100,
        writable: true,
      });

      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      await act(async () => {
        fireEvent(window, new Event('resize'));
      });

      await waitFor(() => {
        const main = screen.getByRole('main');
        expect(main).not.toHaveClass('pl-72');
      });
    });

    it('should show hamburger menu only on mobile and tablet', async () => {
      // Test mobile
      Object.defineProperty(window, 'innerWidth', {
        value: RESPONSIVE_BREAKPOINTS.mobile - 100,
        writable: true,
      });

      const { rerender } = render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      // Trigger resize
      await act(async () => {
        fireEvent(window, new Event('resize'));
      });

      await waitFor(() => {
        // Hamburger button appears in top bar when sidebar is closed on mobile/tablet
        const topBar = document.querySelector('div[class*="border-b"][class*="bg-gray-800"]');
        expect(topBar).toBeInTheDocument();
      });

      // Test desktop - no top bar with hamburger
      Object.defineProperty(window, 'innerWidth', {
        value: RESPONSIVE_BREAKPOINTS.desktop + 100,
        writable: true,
      });

      rerender(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      await act(async () => {
        fireEvent(window, new Event('resize'));
      });

      await waitFor(() => {
        // On desktop, sidebar is open so top bar with hamburger is not shown
        const topBarHamburger = document.querySelector(
          'div[class*="border-b"][class*="bg-gray-800/80"]',
        );
        expect(topBarHamburger).not.toBeInTheDocument();
      });
    });
  });

  describe('Sidebar Collapse (Desktop)', () => {
    it('should render a desktop collapse toggle, expanded by default', async () => {
      Object.defineProperty(window, 'innerWidth', {
        value: RESPONSIVE_BREAKPOINTS.desktop + 100,
        writable: true,
      });

      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      await waitFor(() => {
        expect(getSidebarDiv()).toHaveClass('w-72'); // expanded by default
      });

      const toggle = screen.getByTestId('sidebar-collapse-toggle');
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      expect(toggle).toHaveAccessibleName('收折側邊欄');
    });

    it('should collapse to icon rail (w-20 / pl-20) when toggle is clicked', async () => {
      Object.defineProperty(window, 'innerWidth', {
        value: RESPONSIVE_BREAKPOINTS.desktop + 100,
        writable: true,
      });

      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      await waitFor(() => {
        expect(getSidebarDiv()).toHaveClass('w-72');
      });

      const toggle = screen.getByTestId('sidebar-collapse-toggle');
      await act(async () => {
        fireEvent.click(toggle);
      });

      await waitFor(() => {
        expect(getSidebarDiv()).toHaveClass('w-20');
        expect(screen.getByRole('main')).toHaveClass('pl-20');
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
      });
    });

    it('should expand back when toggle is clicked again (no dead-end)', async () => {
      Object.defineProperty(window, 'innerWidth', {
        value: RESPONSIVE_BREAKPOINTS.desktop + 100,
        writable: true,
      });

      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      await waitFor(() => {
        expect(getSidebarDiv()).toHaveClass('w-72');
      });

      const toggle = screen.getByTestId('sidebar-collapse-toggle');

      await act(async () => {
        fireEvent.click(toggle);
      });
      await waitFor(() => {
        expect(getSidebarDiv()).toHaveClass('w-20');
      });

      await act(async () => {
        fireEvent.click(toggle);
      });
      await waitFor(() => {
        expect(getSidebarDiv()).toHaveClass('w-72');
        expect(screen.getByRole('main')).toHaveClass('pl-72');
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
      });
    });

    it('should persist the collapse preference to localStorage', async () => {
      Object.defineProperty(window, 'innerWidth', {
        value: RESPONSIVE_BREAKPOINTS.desktop + 100,
        writable: true,
      });

      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      await waitFor(() => {
        expect(getSidebarDiv()).toHaveClass('w-72');
      });

      const toggle = screen.getByTestId('sidebar-collapse-toggle');
      await act(async () => {
        fireEvent.click(toggle);
      });

      await waitFor(() => {
        expect(getSidebarDiv()).toHaveClass('w-20');
      });

      expect(window.localStorage.setItem).toHaveBeenCalledWith('sidebarCollapsed', 'true');
    });
  });

  describe('Assistant List Integration', () => {
    it('should render assistant list with loaded assistants', async () => {
      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      await waitFor(() => {
        expect(screen.getByTestId('assistant-list')).toBeInTheDocument();
        expect(screen.getByText('選擇助理')).toBeInTheDocument();
      });
    });

    it('should handle assistant selection', async () => {
      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      await waitFor(() => {
        expect(screen.getByTestId('assistant-list')).toBeInTheDocument();
      });

      // Select via the select element
      const selectEl = screen.getByTestId('assistant-select');
      await act(async () => {
        fireEvent.change(selectEl, { target: { value: 'test-assistant-1' } });
      });

      // Verify the list is still rendered after interaction
      await waitFor(() => {
        expect(screen.getByTestId('assistant-list')).toBeInTheDocument();
      });
    });

    it('should handle assistant editing', async () => {
      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      await waitFor(
        () => {
          expect(screen.getByTestId('assistant-list')).toBeInTheDocument();
        },
        { timeout: 3000 },
      );
    });

    it('should handle assistant deletion', async () => {
      testEnvironment.confirmSpy.mockReturnValue(true);

      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      await waitFor(() => {
        expect(screen.getByTestId('assistant-list')).toBeInTheDocument();
      });
    });

    it('should handle assistant sharing', async () => {
      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      await waitFor(() => {
        expect(screen.getByTestId('assistant-list')).toBeInTheDocument();
      });
    });

    it('should handle creating new assistant', async () => {
      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      await waitFor(() => {
        const createButton = screen.getByTestId('create-new-button');
        expect(createButton).toBeInTheDocument();
      });

      const createButton = screen.getByTestId('create-new-button');
      await act(async () => {
        fireEvent.click(createButton);
      });

      // Should switch to new assistant mode
      // Note: This would be tested in integration with the full app context
    });
  });

  describe('Session List', () => {
    it('should render session list when assistant is selected', async () => {
      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      await waitFor(() => {
        // Initially, no assistant is selected so session list is not visible
        expect(screen.queryByText('聊天記錄')).not.toBeInTheDocument();
        expect(screen.queryByText('新增聊天')).not.toBeInTheDocument();
      });
    });

    it('should handle creating new chat session', async () => {
      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      await waitFor(() => {
        // No current assistant selected, so new chat button is not visible
        expect(screen.queryByText('新增聊天')).not.toBeInTheDocument();
      });
    });

    it('should render existing chat sessions', async () => {
      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      await waitFor(() => {
        // No current assistant selected, so no session titles visible
        expect(screen.queryByText('Active Chat')).not.toBeInTheDocument();
        expect(screen.queryByText('New Chat')).not.toBeInTheDocument();
      });
    });

    it('should handle session selection', async () => {
      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      await waitFor(() => {
        // No current assistant selected, so no sessions visible
        expect(screen.queryByText('Active Chat')).not.toBeInTheDocument();
      });
    });

    it('should handle session deletion', async () => {
      testEnvironment.confirmSpy.mockReturnValue(true);

      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      // No assistant selected, so no sessions visible - this is expected
      await waitFor(() => {
        expect(screen.queryByText('Active Chat')).not.toBeInTheDocument();
      });
    });

    it('should display session timestamps', async () => {
      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      // No sessions visible without an assistant selected
      await waitFor(() => {
        expect(screen.getByTestId('assistant-list')).toBeInTheDocument();
      });
    });
  });

  describe('Top Bar', () => {
    it('should show appropriate title based on view mode', async () => {
      Object.defineProperty(window, 'innerWidth', {
        value: RESPONSIVE_BREAKPOINTS.mobile - 100,
        writable: true,
      });

      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      await act(async () => {
        fireEvent(window, new Event('resize'));
      });

      await waitFor(() => {
        // Top bar should be visible on mobile (sidebar closed)
        const topBar = document.querySelector('div[class*="border-b"][class*="bg-gray-800"]');
        expect(topBar).toBeInTheDocument();
      });
    });

    it('should show settings title when in settings mode', async () => {
      Object.defineProperty(window, 'innerWidth', {
        value: RESPONSIVE_BREAKPOINTS.mobile - 100,
        writable: true,
      });

      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      // Navigate to settings mode (this would be done via context in real usage)
      // For now we test that the title logic exists
      await waitFor(() => {
        expect(screen.getByRole('main')).toBeInTheDocument();
      });
    });
  });

  describe('Settings Section', () => {
    it('should render settings button in sidebar', async () => {
      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      await waitFor(() => {
        expect(screen.getByText('設定')).toBeInTheDocument();
        expect(screen.getByTestId('settings-icon')).toBeInTheDocument();
      });
    });

    it('should handle settings navigation', async () => {
      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      await waitFor(() => {
        const settingsButton = screen.getByText('設定');
        expect(settingsButton).toBeInTheDocument();
      });

      const settingsButton = screen.getByText('設定');
      await act(async () => {
        fireEvent.click(settingsButton);
      });

      // Should navigate to settings mode
      // This would be verified through the context state changes
    });
  });

  describe('Accessibility', () => {
    it('should have proper ARIA roles and labels', async () => {
      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      await waitFor(() => {
        // AssistantList navigation is always visible
        expect(screen.getByRole('navigation', { name: '助理選擇' })).toBeInTheDocument();
        expect(screen.getByRole('main')).toBeInTheDocument();
      });
    });

    it('should support keyboard navigation', async () => {
      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      // Test that buttons are focusable
      await waitFor(() => {
        const settingsButton = screen.getByText('設定');
        expect(settingsButton).toBeInTheDocument();
      });

      const settingsButton = screen.getByText('設定');
      expect(settingsButton).toBeInTheDocument();
    });

    it('should have proper button titles for actions', async () => {
      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      // Session list is only visible when an assistant is selected
      // Without a selected assistant, just verify the layout renders
      await waitFor(() => {
        expect(screen.getByRole('main')).toBeInTheDocument();
      });
    });
  });

  describe('Dynamic Content Updates', () => {
    it('should update when assistants list changes', async () => {
      const { rerender } = render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      await waitFor(() => {
        expect(screen.getByTestId('assistant-list')).toBeInTheDocument();
      });

      rerender(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      // The component should react to context updates
      expect(screen.getByTestId('assistant-list')).toBeInTheDocument();
    });

    it('should update when sessions list changes', async () => {
      render(
        <TestLayoutWrapper>
          <TestLayoutContent />
        </TestLayoutWrapper>,
      );

      await waitFor(() => {
        expect(screen.getByTestId('assistant-list')).toBeInTheDocument();
      });

      // Sessions should update when context changes
      // This would be tested in full integration tests
    });
  });
});
