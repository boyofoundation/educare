import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAppContext } from './useAppContext';
import { OfflineStatusBanner } from './OfflineStatusBanner';
import { AssistantList } from '../assistant';
import { ProjectPicker } from '../canvas';
import Modal from '../ui/Modal';
import { ChatIcon, TrashIcon, SettingsIcon, PlusIcon } from '../ui/Icons';
import { ChatSession, SessionTokenUsage } from '../../types';
import { useTursoAssistantStatus } from '../../hooks/useTursoAssistantStatus';
import { downloadAssistantPackage } from '../../services/assistantPackageService';
import { htmlProjectStore } from '../../services/htmlProjectStore';
import * as db from '../../services/db';
import {
  getLocalSearchResultKindLabel,
  searchLocalWorkspace,
  type LocalSearchResult,
} from '../../services/localSearchService';

interface LayoutProps {
  children: React.ReactNode;
}

/**
 * 將 timestamp 轉為 zh-TW 相對時間：
 * 剛剛 / N 分鐘前 / N 小時前 / 昨天 / M月D日
 */
// eslint-disable-next-line react-refresh/only-export-components -- 純函式 helper，供 Layout 與其測試共用
export function formatRelativeTime(timestamp: number, now: number = Date.now()): string {
  const MINUTE = 60_000;
  const HOUR = 3_600_000;
  const DAY = 86_400_000;
  const diffMs = now - timestamp;

  if (diffMs < MINUTE) {
    return '剛剛';
  }
  if (diffMs < HOUR) {
    return `${Math.floor(diffMs / MINUTE)} 分鐘前`;
  }

  const nowDate = new Date(now);
  const startOfToday = new Date(
    nowDate.getFullYear(),
    nowDate.getMonth(),
    nowDate.getDate(),
  ).getTime();

  if (timestamp >= startOfToday) {
    return `${Math.floor(diffMs / HOUR)} 小時前`;
  }
  if (timestamp >= startOfToday - DAY) {
    return '昨天';
  }

  const date = new Date(timestamp);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

/** EduCare logo mark：漸層圓角方塊 + 白色書本 glyph */
const BrandMark: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox='0 0 32 32' className={className} aria-hidden='true' focusable='false'>
    <defs>
      <linearGradient
        id='educare-brand-gradient'
        x1='0'
        y1='0'
        x2='32'
        y2='32'
        gradientUnits='userSpaceOnUse'
      >
        <stop stopColor='#22d3ee' />
        <stop offset='1' stopColor='#2563eb' />
      </linearGradient>
    </defs>
    <rect x='1' y='1' width='30' height='30' rx='9' fill='url(#educare-brand-gradient)' />
    <path
      d='M16 10.9c-1.9-1.3-4.3-1.8-6.8-1.3v11.2c2.5-.5 4.9 0 6.8 1.3 1.9-1.3 4.3-1.8 6.8-1.3V9.6c-2.5-.5-4.9 0-6.8 1.3z'
      fill='rgba(255,255,255,0.92)'
    />
    <path d='M16 11v11' stroke='#0e7490' strokeWidth='1.4' strokeLinecap='round' fill='none' />
  </svg>
);

export function Layout({ children }: LayoutProps): React.JSX.Element {
  const { state, actions } = useAppContext();

  // Check if current assistant exists in Turso for sharing
  const { canShare } = useTursoAssistantStatus(state.currentAssistant?.id || null);

  // Desktop = anything larger than the tablet breakpoint.
  // "collapsed" only applies to desktop (the icon-rail mode); mobile/tablet use the drawer.
  const isDesktop = !state.isMobile && !state.isTablet;
  const collapsed = isDesktop && state.isSidebarCollapsed;
  const isTouch = state.isMobile || state.isTablet;

  const [isTokenUsageOpen, setIsTokenUsageOpen] = useState(false);
  const tokenPopoverRef = useRef<HTMLDivElement | null>(null);
  const expandedTokenBtnRef = useRef<globalThis.HTMLButtonElement | null>(null);
  const drawerCloseButtonRef = useRef<globalThis.HTMLButtonElement | null>(null);
  const drawerTriggerRef = useRef<globalThis.HTMLButtonElement | null>(null);
  const previouslyFocusedRef = useRef<globalThis.HTMLElement | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<LocalSearchResult[]>([]);
  const [isSearchLoading, setIsSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchRetryToken, setSearchRetryToken] = useState(0);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [sessionTitleDraft, setSessionTitleDraft] = useState('');
  const [sessionActionError, setSessionActionError] = useState<string | null>(null);
  const [retrySessionAction, setRetrySessionAction] = useState<(() => void) | null>(null);
  const [showAllSessions, setShowAllSessions] = useState(false);
  const [isWorkspaceOpen, setIsWorkspaceOpen] = useState(false);
  const [openSessionMenuId, setOpenSessionMenuId] = useState<string | null>(null);
  const sessionMenuRef = useRef<globalThis.HTMLDivElement | null>(null);
  const sessionMenuTriggerRef = useRef<globalThis.HTMLButtonElement | null>(null);

  const orderedSessions = useMemo(
    () =>
      [...state.sessions].sort((left, right) => {
        if (Boolean(left.isPinned) !== Boolean(right.isPinned)) {
          return left.isPinned ? -1 : 1;
        }
        const leftTime = left.lastOpenedAt ?? left.updatedAt ?? left.createdAt;
        const rightTime = right.lastOpenedAt ?? right.updatedAt ?? right.createdAt;
        return rightTime - leftTime;
      }),
    [state.sessions],
  );

  const visibleSessions = useMemo(
    () => orderedSessions.slice(0, showAllSessions ? orderedSessions.length : 6),
    [orderedSessions, showAllSessions],
  );

  const drawerInteractive = !isTouch || state.isSidebarOpen;

  const requestNavigation = (request: Parameters<typeof actions.navigate>[0]) => {
    const result = actions.navigate(request);
    if (result.allowed) {
      closeDrawerIfMobile();
    }
  };

  const beginRenameSession = (session: ChatSession) => {
    setEditingSessionId(session.id);
    setSessionTitleDraft(session.title);
    setSessionActionError(null);
  };

  const runSessionAction = (operation: () => Promise<void>, onSuccess?: () => void): void => {
    const attempt = async () => {
      try {
        await operation();
        setSessionActionError(null);
        setRetrySessionAction(null);
        onSuccess?.();
      } catch (error) {
        console.error('Failed to update chat metadata:', error);
        setSessionActionError('聊天更新失敗，請重試。');
        setRetrySessionAction(() => attempt);
      }
    };
    void attempt();
  };

  const commitRenameSession = (sessionId: string) => {
    const nextTitle = sessionTitleDraft.trim();
    if (nextTitle) {
      runSessionAction(
        () => actions.renameSession(sessionId, nextTitle),
        () => {
          setEditingSessionId(null);
          setSessionTitleDraft('');
        },
      );
      return;
    }
    setEditingSessionId(null);
    setSessionTitleDraft('');
  };

  const openSessionFromSidebar = (sessionId: string) => {
    const result = actions.navigate({ viewMode: 'chat', sessionId });
    if (!result.allowed) {
      return;
    }
    void actions.openSession(sessionId);
    closeDrawerIfMobile();
  };

  useEffect(() => {
    setShowAllSessions(false);
    setOpenSessionMenuId(null);
    setEditingSessionId(null);
  }, [state.currentAssistant?.id]);

  useEffect(() => {
    if (!openSessionMenuId) {
      return;
    }

    const handlePointerDown = (event: globalThis.MouseEvent) => {
      const target = event.target as Node;
      if (
        !sessionMenuRef.current?.contains(target) &&
        !sessionMenuTriggerRef.current?.contains(target)
      ) {
        setOpenSessionMenuId(null);
      }
    };

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }
      setOpenSessionMenuId(null);
      sessionMenuTriggerRef.current?.focus();
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [openSessionMenuId]);

  useEffect(() => {
    if (!isTouch || !state.isSidebarOpen) {
      if (isTouch && previouslyFocusedRef.current) {
        const previous = previouslyFocusedRef.current;
        window.setTimeout(() => {
          // The trigger unmounts while the drawer is open. Prefer its new
          // instance rather than the body (focused when the old node vanished).
          if (drawerTriggerRef.current) {
            drawerTriggerRef.current?.focus();
          } else if (previous.isConnected && previous !== document.body) {
            previous.focus();
          }
        }, 0);
        previouslyFocusedRef.current = null;
      }
      return;
    }

    previouslyFocusedRef.current = document.activeElement as globalThis.HTMLElement | null;
    const focusTimer = window.setTimeout(() => drawerCloseButtonRef.current?.focus(), 0);
    return () => window.clearTimeout(focusTimer);
  }, [isTouch, state.isSidebarOpen]);

  useEffect(() => {
    let active = true;
    const query = searchQuery.trim();
    if (
      state.isShared ||
      state.bundleMode ||
      state.isBundleImportRoute ||
      !isSearchOpen ||
      !query
    ) {
      setSearchResults([]);
      setSearchError(null);
      setIsSearchLoading(false);
      return () => {
        active = false;
      };
    }

    setIsSearchLoading(true);
    const loadSearchResults = async () => {
      try {
        const sessions = (
          await Promise.all(
            state.assistants.map(assistant => db.getSessionsForAssistant(assistant.id)),
          )
        ).flat();
        const projects = (
          await Promise.all(
            state.assistants.map(assistant =>
              htmlProjectStore.listProjectsByAssistant(assistant.id),
            ),
          )
        ).flat();
        if (!active) {
          return;
        }
        setSearchResults(
          searchLocalWorkspace({
            query,
            assistants: state.assistants,
            sessions,
            projects,
          }),
        );
        setSearchError(null);
      } catch {
        if (active) {
          setSearchResults([]);
          setSearchError('搜尋本機內容失敗，請重試。');
        }
      } finally {
        if (active) {
          setIsSearchLoading(false);
        }
      }
    };
    void loadSearchResults();

    return () => {
      active = false;
    };
  }, [
    isSearchOpen,
    searchQuery,
    state.assistants,
    state.bundleMode,
    state.isBundleImportRoute,
    state.isShared,
    searchRetryToken,
  ]);

  // Escape closes the mobile/tablet drawer
  useEffect(() => {
    if (!(state.isMobile || state.isTablet) || !state.isSidebarOpen) {
      return;
    }
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        actions.setSidebarOpen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [state.isMobile, state.isTablet, state.isSidebarOpen, actions]);

  // Token usage popover：外點關閉 + Escape 關閉
  useEffect(() => {
    if (!isTokenUsageOpen) {
      return;
    }
    const handlePointerDown = (e: globalThis.MouseEvent) => {
      const target = e.target as globalThis.Node;
      if (tokenPopoverRef.current?.contains(target)) {
        return;
      }
      if (expandedTokenBtnRef.current?.contains(target)) {
        return;
      }
      setIsTokenUsageOpen(false);
    };
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsTokenUsageOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isTokenUsageOpen]);

  // 收折狀態切換時關閉 popover（定位邏輯不同）
  useEffect(() => {
    setIsTokenUsageOpen(false);
  }, [collapsed]);

  // Auto-close the drawer after navigating on mobile/tablet
  const closeDrawerIfMobile = () => {
    if (state.isMobile || state.isTablet) {
      actions.setSidebarOpen(false);
    }
  };

  // In shared / bundle / standalone bundle-import mode, render a simplified layout without sidebar
  if (state.isShared || state.bundleMode || state.isBundleImportRoute) {
    return (
      <div className='flex min-h-[100svh] h-[100dvh] font-sans bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900'>
        {/* Main content area - full width in shared mode */}
        <div className='flex-1 flex flex-col overflow-hidden'>{children}</div>
      </div>
    );
  }

  const mainOffset = isDesktop && state.isSidebarOpen && !collapsed ? 'pl-72' : '';

  const title =
    state.viewMode === 'chat' && state.currentAssistant
      ? state.currentAssistant.name
      : state.viewMode === 'new_assistant'
        ? '新增助理'
        : state.viewMode === 'edit_assistant'
          ? '編輯助理'
          : state.viewMode === 'settings'
            ? '設定'
            : state.viewMode === 'provider_settings'
              ? 'AI 服務商'
              : state.viewMode === 'data_management'
                ? '資料管理'
                : state.viewMode === 'practice'
                  ? '備課與練習'
                  : '專業助理';

  const currentSessionUsage = state.currentSession?.tokenUsage;
  const currentSessionTotals = currentSessionUsage?.totals;
  const hasLegacyOnlyUsage = Boolean(
    !currentSessionTotals && state.currentSession && state.currentSession.tokenCount > 0,
  );

  const formatTokenCount = (value: number | undefined): string => {
    if (typeof value !== 'number') {
      return '—';
    }

    return new Intl.NumberFormat('zh-TW').format(value);
  };

  const renderTokenUsageDetails = (usage: SessionTokenUsage | undefined): React.JSX.Element => {
    if (!state.currentSession) {
      return <p className='text-sm text-gray-400'>目前沒有選中的聊天。</p>;
    }

    if (usage?.totals) {
      return (
        <div className='space-y-3 text-sm text-gray-200'>
          <div>
            <div className='text-xs uppercase tracking-wide text-cyan-300'>API 回報總量</div>
            <div className='mt-1 text-lg font-semibold text-white'>
              {formatTokenCount(usage.totals.totalTokens)} tokens
            </div>
          </div>
          <div className='grid grid-cols-2 gap-2 text-xs'>
            <div className='rounded-lg bg-gray-800/70 p-2'>
              <div className='text-gray-400'>Input</div>
              <div className='mt-1 font-medium text-white'>
                {formatTokenCount(usage.totals.inputTokens)}
              </div>
            </div>
            <div className='rounded-lg bg-gray-800/70 p-2'>
              <div className='text-gray-400'>Output</div>
              <div className='mt-1 font-medium text-white'>
                {formatTokenCount(usage.totals.outputTokens)}
              </div>
            </div>
            <div className='rounded-lg bg-gray-800/70 p-2'>
              <div className='text-gray-400'>Cache Read</div>
              <div className='mt-1 font-medium text-white'>
                {formatTokenCount(usage.totals.cacheReadInputTokens)}
              </div>
            </div>
            <div className='rounded-lg bg-gray-800/70 p-2'>
              <div className='text-gray-400'>Cache Create</div>
              <div className='mt-1 font-medium text-white'>
                {formatTokenCount(usage.totals.cacheCreationInputTokens)}
              </div>
            </div>
            <div className='rounded-lg bg-gray-800/70 p-2'>
              <div className='text-gray-400'>Cached Input</div>
              <div className='mt-1 font-medium text-white'>
                {formatTokenCount(usage.totals.cachedInputTokens)}
              </div>
            </div>
            <div className='rounded-lg bg-gray-800/70 p-2'>
              <div className='text-gray-400'>Reasoning</div>
              <div className='mt-1 font-medium text-white'>
                {formatTokenCount(usage.totals.reasoningTokens)}
              </div>
            </div>
            <div className='rounded-lg bg-gray-800/70 p-2 col-span-2'>
              <div className='text-gray-400'>Tool Use</div>
              <div className='mt-1 font-medium text-white'>
                {formatTokenCount(usage.totals.toolUseTokens)}
              </div>
            </div>
          </div>
          <div className='rounded-lg border border-gray-700/60 bg-gray-800/40 p-3 text-xs text-gray-300'>
            <div>Provider：{usage.lastProvider || '—'}</div>
            <div className='mt-1'>Model：{usage.lastModel || '—'}</div>
            <div className='mt-1'>
              更新時間：
              {usage.lastUpdatedAt ? new Date(usage.lastUpdatedAt).toLocaleString('zh-TW') : '—'}
            </div>
            <div className='mt-1'>未回傳 usage 次數：{usage.unavailableTurns ?? 0}</div>
          </div>
        </div>
      );
    }

    if (hasLegacyOnlyUsage) {
      return (
        <div className='space-y-2 text-sm text-gray-300'>
          <p>目前只有舊版累計資料，這不是完整的 API 回報 token 用量。</p>
          <div className='rounded-lg bg-gray-800/70 p-3 text-white'>
            Legacy tokenCount：{formatTokenCount(state.currentSession.tokenCount)}
          </div>
        </div>
      );
    }

    return (
      <div className='space-y-2 text-sm text-gray-300'>
        <p>目前尚無 API 回報的 token 用量。</p>
        {usage?.source === 'unavailable' && (
          <p className='text-amber-300'>此服務商未回傳 token 用量，未進行本地估算。</p>
        )}
      </div>
    );
  };

  // Token usage popover 共用面板（展開模式與收折 rail 皆使用）
  const tokenUsagePopoverPanel = (
    <>
      <div className='flex items-center justify-between border-b border-gray-700/50 px-3 py-2'>
        <span className='text-xs font-semibold uppercase tracking-wider text-gray-400'>
          Token 用量
        </span>
        <button
          type='button'
          onClick={() => setIsTokenUsageOpen(false)}
          className='rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-700/60 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60'
          aria-label='關閉 token 用量'
          title='關閉'
        >
          <svg
            className='h-3.5 w-3.5'
            fill='none'
            stroke='currentColor'
            viewBox='0 0 24 24'
            aria-hidden='true'
          >
            <path
              strokeLinecap='round'
              strokeLinejoin='round'
              strokeWidth={2}
              d='M6 18L18 6M6 6l12 12'
            />
          </svg>
        </button>
      </div>
      <div className='max-h-[50vh] overflow-y-auto chat-scroll p-3'>
        {renderTokenUsageDetails(currentSessionUsage)}
      </div>
    </>
  );

  const sessionActionFeedback = sessionActionError ? (
    <div
      role='alert'
      className='mb-2 flex items-center justify-between gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-2 text-xs text-red-200'
    >
      <span>{sessionActionError}</span>
      {retrySessionAction && (
        <button
          type='button'
          onClick={retrySessionAction}
          className='rounded border border-red-300/40 px-2 py-1 font-medium text-red-100 hover:bg-red-500/20'
        >
          重試
        </button>
      )}
    </div>
  ) : null;

  return (
    <div className='app-shell relative flex min-h-[100svh] h-[100dvh] overflow-hidden bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 font-sans'>
      {/* Sidebar Overlay for Mobile and Tablet */}
      {(state.isMobile || state.isTablet) && state.isSidebarOpen && (
        <div
          className='fixed inset-0 z-40 bg-black/50 lg:hidden'
          onClick={() => actions.setSidebarOpen(false)}
          aria-hidden='true'
        />
      )}

      {/* Sidebar */}
      {/* Sidebar — 桌面收折時整個隱藏 (w-0)，只留 shell 層的浮動展開鈕。 */}
      <div
        className={`app-sidebar ${state.isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} fixed left-0 top-0 h-[100dvh] z-50 overflow-hidden ${
          state.isMobile || state.isTablet ? 'w-80' : collapsed ? 'w-0' : 'w-72'
        } ${collapsed ? 'border-r-0' : 'border-r border-gray-700/50'} bg-gray-900/95 backdrop-blur-sm shadow-2xl transition-all duration-300 ease-in-out`}
        role='navigation'
        aria-label='主要導覽'
        aria-hidden={!drawerInteractive || collapsed}
        inert={!drawerInteractive || collapsed}
      >
        {!collapsed && (
          <div
            className={`flex h-full ${state.isMobile || state.isTablet ? 'w-80' : 'w-72'} flex-col px-4 pt-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]`}
          >
            {/* Desktop collapse toggle — visible only while expanded (no dead-end state) */}
            {isDesktop && !collapsed && (
              <button
                type='button'
                data-testid='sidebar-collapse-toggle'
                onClick={actions.toggleSidebarCollapse}
                className='sidebar-collapse-toggle absolute top-[5.25rem] -right-[1.375rem] z-50 flex h-11 w-11 items-center justify-center rounded-xl text-gray-300 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60'
                aria-label='收折側邊欄'
                aria-expanded={false}
                title='收折側邊欄'
              >
                <span className='sidebar-collapse-toggle__glyph flex h-6 w-6 items-center justify-center rounded-full border bg-gray-700 shadow-md'>
                  <svg
                    className='h-3.5 w-3.5'
                    fill='none'
                    stroke='currentColor'
                    viewBox='0 0 24 24'
                  >
                    <path
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      strokeWidth={2.5}
                      d='M15 19l-7-7 7-7'
                    />
                  </svg>
                </span>
              </button>
            )}

            {/* Brand area — mobile/tablet 時右側附關閉鈕 */}
            <div className='sidebar-brand flex items-center justify-between gap-2 border-b border-gray-700/50 px-1 pb-3.5 mb-4'>
              <div className='flex items-center gap-2.5 min-w-0'>
                <BrandMark className='h-8 w-8 flex-shrink-0' />
                <div className='min-w-0 leading-tight'>
                  <div className='sidebar-brand__title truncate text-base font-bold tracking-tight text-white'>
                    EduCare
                  </div>
                  <div className='sidebar-brand__subtitle text-[10px] font-medium uppercase tracking-[0.18em] text-cyan-400/90'>
                    AI 教學助理
                  </div>
                </div>
              </div>
              {(state.isMobile || state.isTablet) && (
                <button
                  ref={drawerCloseButtonRef}
                  onClick={() => actions.setSidebarOpen(false)}
                  className='sidebar-close flex min-h-11 min-w-11 items-center justify-center p-2 text-gray-400 hover:text-white rounded-lg hover:bg-gray-800/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 flex-shrink-0'
                  aria-label='關閉選單'
                  title='關閉選單'
                >
                  <svg className='w-5 h-5' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                    <path
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      strokeWidth={2}
                      d='M6 18L18 6M6 6l12 12'
                    />
                  </svg>
                </button>
              )}
            </div>

            {/* Assistant Selection */}
            <AssistantList
              assistants={state.assistants}
              selectedAssistant={state.currentAssistant}
              onSelect={assistantId => {
                // 強制切換到聊天模式，無論當前是什麼模式
                const result = actions.navigate({ viewMode: 'chat', assistantId });
                if (result.allowed) {
                  closeDrawerIfMobile();
                }
              }}
              onEdit={assistant => {
                const result = actions.navigate({
                  viewMode: 'edit_assistant',
                  assistantId: assistant.id,
                });
                if (result.allowed) {
                  closeDrawerIfMobile();
                }
              }}
              onDelete={actions.deleteAssistant}
              onShare={actions.openShareModal}
              onCreateNew={() => {
                requestNavigation({ viewMode: 'new_assistant' });
              }}
              onExport={assistant => {
                try {
                  downloadAssistantPackage(assistant);
                } catch (error) {
                  window.alert(`匯出助理設定檔失敗：${(error as Error).message}`);
                }
              }}
              onImport={async file => {
                try {
                  const result = actions.navigate({ viewMode: 'chat', file });
                  if (!result.allowed) {
                    return;
                  }
                  await result.completion;
                  closeDrawerIfMobile();
                } catch (error) {
                  window.alert(`匯入助理設定檔失敗：${(error as Error).message}`);
                }
              }}
              onBuildBundle={() => {
                requestNavigation({ viewMode: 'bundle_builder' });
              }}
              canShare={canShare}
            />

            {/* Local navigation search stays in the current app shell; it never queries shared or bundle data. */}
            <div className='mb-3 px-1'>
              <button
                type='button'
                data-testid='sidebar-search-toggle'
                onClick={() => setIsSearchOpen(previous => !previous)}
                className='sidebar-search-toggle flex min-h-11 w-full items-center gap-2 rounded-lg border bg-gray-800/50 px-3 py-2 text-left text-sm text-gray-300 transition hover:border-cyan-500/50 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60'
                aria-expanded={isSearchOpen}
                aria-controls='sidebar-local-search'
                aria-label='搜尋助理、聊天與素材'
                title='搜尋助理、聊天與素材'
              >
                <svg
                  className='h-4 w-4 flex-shrink-0'
                  fill='none'
                  stroke='currentColor'
                  viewBox='0 0 24 24'
                >
                  <path
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    strokeWidth={2}
                    d='m21 21-4.35-4.35m2.1-5.4a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z'
                  />
                </svg>
                <span>搜尋助理、聊天與素材</span>
              </button>
              {isSearchOpen && (
                <div
                  id='sidebar-local-search'
                  data-testid='navigation-search-results'
                  className='mt-2 space-y-2'
                >
                  <input
                    type='search'
                    autoFocus
                    value={searchQuery}
                    onChange={event => setSearchQuery(event.target.value)}
                    placeholder='搜尋名稱、訊息或檔案…'
                    className='sidebar-search-input w-full rounded-lg border border-gray-600/50 bg-gray-800 px-3 py-2 text-sm text-white outline-none transition placeholder:text-gray-500 focus:border-cyan-500/70 focus:ring-2 focus:ring-cyan-500/20'
                    aria-label='搜尋本機內容'
                  />
                  {searchError && (
                    <div
                      role='alert'
                      className='flex items-center justify-between gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-2 text-xs text-red-200'
                    >
                      <span>{searchError}</span>
                      <button
                        type='button'
                        onClick={() => setSearchRetryToken(previous => previous + 1)}
                        className='rounded border border-red-300/40 px-2 py-1 font-medium text-red-100 hover:bg-red-500/20'
                      >
                        重試
                      </button>
                    </div>
                  )}
                  {isSearchLoading && <p className='px-2 text-xs text-gray-500'>搜尋中…</p>}
                  {!isSearchLoading &&
                    !searchError &&
                    searchQuery.trim() &&
                    searchResults.length === 0 && (
                      <p className='px-2 text-xs text-gray-500'>找不到符合的本機內容。</p>
                    )}
                  {searchResults.length > 0 && (
                    <div className='sidebar-search-results max-h-64 space-y-1 overflow-y-auto rounded-lg border border-gray-700/60 bg-gray-950/50 p-1'>
                      {searchResults.map(result => (
                        <button
                          type='button'
                          key={`${result.kind}:${result.id}`}
                          onClick={() => {
                            void actions.openSearchResult(result);
                            setSearchQuery('');
                            setIsSearchOpen(false);
                            closeDrawerIfMobile();
                          }}
                          className='sidebar-search-result w-full rounded-md px-2.5 py-2 text-left transition hover:bg-cyan-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60'
                        >
                          <div className='flex items-center gap-2'>
                            <span className='rounded bg-cyan-500/15 px-1.5 py-0.5 text-[10px] font-medium text-cyan-200'>
                              {getLocalSearchResultKindLabel(result.kind)}
                            </span>
                            <span className='min-w-0 flex-1 truncate text-xs font-medium text-gray-100'>
                              {result.title}
                            </span>
                          </div>
                          <p className='mt-1 line-clamp-2 text-[11px] leading-4 text-gray-400'>
                            {result.snippet || result.subtitle}
                          </p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {sessionActionFeedback}

            {/* Conversation list */}
            {state.currentAssistant && (
              <section
                className='sidebar-section flex min-h-0 flex-1 flex-col'
                aria-label='聊天記錄'
              >
                <div className='relative mb-2 flex items-center gap-1 px-1'>
                  <span className='sidebar-section-label flex min-h-11 flex-1 items-baseline gap-2 px-2 text-sm font-semibold'>
                    對話
                    <span className='sidebar-count text-xs font-normal'>
                      {orderedSessions.length}
                    </span>
                  </span>
                  <button
                    type='button'
                    ref={expandedTokenBtnRef}
                    onClick={() => setIsTokenUsageOpen(prev => !prev)}
                    className='sidebar-quiet-action inline-flex h-11 w-11 items-center justify-center rounded-lg text-[10px] font-bold tracking-wide text-gray-400 transition-colors hover:bg-gray-800/60 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60'
                    aria-expanded={isTokenUsageOpen}
                    aria-haspopup='dialog'
                    aria-label='檢視 token 用量'
                    title='檢視 token 用量'
                  >
                    TK
                  </button>
                  {isTokenUsageOpen && (
                    <div
                      ref={tokenPopoverRef}
                      role='dialog'
                      aria-label='Token 用量詳細資訊'
                      className='sidebar-popover absolute right-0 top-full z-30 mt-2 w-64 rounded-xl border border-gray-700/60 bg-gray-900 shadow-2xl shadow-black/50'
                    >
                      {tokenUsagePopoverPanel}
                    </div>
                  )}
                </div>
                <div className='flex min-h-0 flex-1 flex-col'>
                  <button
                    type='button'
                    onClick={() => {
                      if (
                        actions.navigate({
                          viewMode: 'chat',
                          newSessionAssistantId: state.currentAssistant!.id,
                        }).allowed
                      ) {
                        closeDrawerIfMobile();
                      }
                    }}
                    className='sidebar-primary-action mb-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-cyan-600 px-3 py-2 text-sm font-semibold text-white shadow-lg shadow-cyan-600/25 transition-colors hover:bg-cyan-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70'
                  >
                    <PlusIcon className='h-4 w-4' />
                    新增聊天
                  </button>
                  <div
                    id='sidebar-conversation-list'
                    className='chat-scroll min-h-0 flex-1 space-y-1 overflow-y-auto pb-1'
                    role='region'
                    aria-label='對話清單'
                  >
                    {orderedSessions.length === 0 && (
                      <p className='px-2 py-3 text-xs text-gray-500'>
                        尚無聊天記錄，點擊上方「新增聊天」開始。
                      </p>
                    )}
                    {visibleSessions.map((sess: ChatSession) => {
                      const isActive = state.currentSession?.id === sess.id;
                      const isMenuOpen = openSessionMenuId === sess.id;
                      return (
                        <div
                          key={sess.id}
                          className={`session-row group relative flex items-center gap-1 rounded-lg ${
                            isActive ? 'session-row--active bg-cyan-500/10' : ''
                          }`}
                        >
                          {isActive && (
                            <span
                              aria-hidden='true'
                              className='sidebar-active-spine absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-cyan-400'
                            />
                          )}
                          {editingSessionId === sess.id ? (
                            <input
                              autoFocus
                              value={sessionTitleDraft}
                              onChange={event => setSessionTitleDraft(event.target.value)}
                              onKeyDown={event => {
                                if (event.key === 'Enter') {
                                  event.preventDefault();
                                  commitRenameSession(sess.id);
                                } else if (event.key === 'Escape') {
                                  event.preventDefault();
                                  setEditingSessionId(null);
                                }
                              }}
                              className='session-row__rename ml-2 min-h-10 min-w-0 flex-1 rounded-lg border border-cyan-500/60 bg-gray-900 px-2 text-sm text-white outline-none focus:ring-2 focus:ring-cyan-500/20'
                              aria-label={`重新命名聊天 ${sess.title}`}
                            />
                          ) : (
                            <button
                              ref={isMenuOpen ? sessionMenuTriggerRef : undefined}
                              type='button'
                              onClick={() => openSessionFromSidebar(sess.id)}
                              className={`session-row__open flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg py-2 pl-3 pr-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 ${
                                isActive
                                  ? 'font-medium text-white'
                                  : 'text-gray-300 hover:bg-gray-800/60 hover:text-white'
                              }`}
                              aria-current={isActive ? 'page' : undefined}
                              aria-label={`開啟聊天 ${sess.title}`}
                            >
                              <ChatIcon className='h-4 w-4 flex-shrink-0' />
                              <span className='min-w-0 flex-1 truncate text-sm'>{sess.title}</span>
                              <span
                                aria-hidden='true'
                                className='flex-shrink-0 text-[11px] tabular-nums text-gray-500'
                              >
                                {formatRelativeTime(
                                  sess.lastOpenedAt ?? sess.updatedAt ?? sess.createdAt,
                                )}
                              </span>
                            </button>
                          )}
                          <div className='relative flex-shrink-0'>
                            <button
                              type='button'
                              data-session-menu-trigger={sess.id}
                              onClick={() =>
                                setOpenSessionMenuId(current =>
                                  current === sess.id ? null : sess.id,
                                )
                              }
                              className='session-row__menu-trigger flex h-11 w-9 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-700/60 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60'
                              aria-label={`對話選項 ${sess.title}`}
                              aria-expanded={isMenuOpen}
                              aria-haspopup='true'
                              title='對話選項'
                            >
                              <span aria-hidden='true' className='text-lg leading-none'>
                                ···
                              </span>
                            </button>
                            {isMenuOpen && (
                              <div
                                ref={sessionMenuRef}
                                aria-label={`管理對話 ${sess.title}`}
                                className='session-menu absolute right-0 top-full z-40 mt-1 w-52 rounded-xl border border-gray-700/60 bg-gray-900 p-1.5 shadow-2xl shadow-black/40'
                              >
                                <button
                                  type='button'
                                  onClick={() => {
                                    setOpenSessionMenuId(null);
                                    runSessionAction(() => actions.toggleSessionPinned(sess.id));
                                  }}
                                  className='session-menu__item flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-gray-200 transition-colors hover:bg-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60'
                                  aria-label={
                                    sess.isPinned ? `取消置頂 ${sess.title}` : `置頂 ${sess.title}`
                                  }
                                >
                                  <span aria-hidden='true'>{sess.isPinned ? '★' : '☆'}</span>
                                  <span>{sess.isPinned ? '取消置頂' : '置頂聊天'}</span>
                                </button>
                                <button
                                  type='button'
                                  onClick={() => {
                                    setOpenSessionMenuId(null);
                                    beginRenameSession(sess);
                                  }}
                                  className='session-menu__item flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-gray-200 transition-colors hover:bg-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60'
                                  aria-label={`重新命名聊天 ${sess.title}`}
                                >
                                  <span aria-hidden='true'>✎</span>
                                  <span>重新命名</span>
                                </button>
                                <label className='session-menu__field block px-3 py-2 text-xs text-gray-400'>
                                  <span>分類</span>
                                  <select
                                    value={sess.category ?? ''}
                                    onChange={event =>
                                      runSessionAction(() =>
                                        actions.setSessionCategory(sess.id, event.target.value),
                                      )
                                    }
                                    className='mt-1 min-h-10 w-full rounded-lg border border-gray-700/60 bg-gray-950 px-2 text-sm text-gray-200 outline-none focus:border-cyan-500/60'
                                    aria-label={`設定聊天分類 ${sess.title}`}
                                  >
                                    <option value=''>未分類</option>
                                    {sess.category &&
                                      !['課程', '研究', '工作', '其他'].includes(sess.category) && (
                                        <option value={sess.category}>{sess.category}</option>
                                      )}
                                    <option value='課程'>課程</option>
                                    <option value='研究'>研究</option>
                                    <option value='工作'>工作</option>
                                    <option value='其他'>其他</option>
                                  </select>
                                </label>
                                <div className='sidebar-divider my-1 border-t border-gray-700/60' />
                                <button
                                  type='button'
                                  onClick={() => {
                                    setOpenSessionMenuId(null);
                                    runSessionAction(() => actions.deleteSession(sess.id));
                                  }}
                                  className='session-menu__item session-menu__item--danger flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-red-300 transition-colors hover:bg-red-500/15 hover:text-red-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/60'
                                  aria-label={`刪除聊天 ${sess.title}`}
                                >
                                  <TrashIcon className='h-4 w-4' />
                                  <span>刪除聊天</span>
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {orderedSessions.length > 6 && (
                      <button
                        type='button'
                        onClick={() => setShowAllSessions(show => !show)}
                        className='sidebar-show-all mt-1 flex min-h-11 w-full items-center justify-center rounded-lg px-3 text-sm font-medium text-gray-400 transition-colors hover:bg-gray-800/60 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60'
                        aria-label={
                          showAllSessions
                            ? '僅顯示近期 6 個對話'
                            : `顯示全部 ${orderedSessions.length} 個對話`
                        }
                      >
                        {showAllSessions
                          ? '收起較早對話'
                          : `顯示全部 ${orderedSessions.length} 個對話`}
                      </button>
                    )}
                  </div>
                </div>
              </section>
            )}

            <section className='sidebar-section sidebar-workspace mt-2 border-t border-gray-700/50 pt-2'>
              <button
                type='button'
                data-testid='sidebar-workspace-toggle'
                onClick={() => setIsWorkspaceOpen(true)}
                className='ui-control sidebar-tool-link flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-sm'
                aria-haspopup='dialog'
                aria-expanded={isWorkspaceOpen}
                aria-label='工作區'
                title='工作區'
              >
                <svg
                  className='h-4 w-4 flex-shrink-0'
                  fill='none'
                  stroke='currentColor'
                  viewBox='0 0 24 24'
                  aria-hidden='true'
                >
                  <path
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    strokeWidth={2}
                    d='M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4'
                  />
                </svg>
                <span>工作區</span>
                <svg
                  className='ml-auto h-4 w-4 flex-shrink-0'
                  fill='none'
                  stroke='currentColor'
                  viewBox='0 0 24 24'
                  aria-hidden='true'
                >
                  <path
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    strokeWidth={2}
                    d='M9 5l7 7-7 7'
                  />
                </svg>
              </button>
            </section>

            {/* Settings stays persistent while secondary tools remain grouped above. */}
            <div className='mt-auto pt-2'>
              <div className='border-t border-gray-700/50 pt-2.5'>
                <button
                  type='button'
                  onClick={() => {
                    requestNavigation({ viewMode: 'settings' });
                  }}
                  className='sidebar-settings flex min-h-11 w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-gray-400 transition-colors hover:bg-gray-800/60 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60'
                  title='設定'
                  aria-label='設定'
                >
                  <SettingsIcon className='w-4 h-4' />
                  <span>設定</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Floating expand button — 桌面收折時左側唯一的進入點 */}
      {isDesktop && collapsed && (
        <button
          type='button'
          data-testid='sidebar-expand-toggle'
          className='sidebar-expand-toggle fixed left-0 top-1/2 z-40 flex h-12 w-11 -translate-y-1/2 items-center justify-center rounded-r-xl border border-l-0 shadow-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60'
          onClick={actions.toggleSidebarCollapse}
          aria-label='展開側邊欄'
          aria-expanded={false}
          title='展開側邊欄'
        >
          <svg className='h-4 w-4' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
            <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2.5} d='M9 5l7 7-7 7' />
          </svg>
        </button>
      )}

      {/* 工作區選單 modal — 側欄只留一個觸發鈕,工具集中於此。 */}
      <Modal
        isOpen={isWorkspaceOpen}
        onClose={() => setIsWorkspaceOpen(false)}
        title='工作區'
        ariaLabel='工作區選單'
      >
        <div className='space-y-2' data-testid='workspace-tools'>
          {state.currentAssistant &&
            state.currentSession &&
            !state.currentAssistant.mathToolsEnabled &&
            !state.currentAssistant.webSpeechToolsEnabled && (
              <ProjectPicker
                assistantId={state.currentAssistant.id}
                activeProjectId={state.activeProjectId}
                onCreateProject={async () => {
                  await actions.createProjectForCurrentSession();
                  setIsWorkspaceOpen(false);
                  closeDrawerIfMobile();
                }}
                onOpenProject={async projectId => {
                  await actions.openProjectForCurrentSession(projectId);
                  setIsWorkspaceOpen(false);
                  closeDrawerIfMobile();
                }}
                onRenameProject={actions.renameProjectForCurrentSession}
                onUploadProjectFiles={actions.uploadFilesToProjectForCurrentSession}
                onImportProjectZip={async file => {
                  await actions.importProjectZipForCurrentSession(file);
                  setIsWorkspaceOpen(false);
                  closeDrawerIfMobile();
                }}
                onDeleteProject={actions.deleteProjectForCurrentSession}
                variant='sidebar'
              />
            )}
          {(
            [
              ['practice', '備課與練習', '習'],
              ['data_management', '資料管理', '存'],
            ] as const
          ).map(([viewMode, label, abbreviation]) => (
            <button
              key={viewMode}
              type='button'
              onClick={() => {
                setIsWorkspaceOpen(false);
                requestNavigation({ viewMode });
              }}
              className='ui-control flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm'
              title={label}
              aria-label={label}
              aria-current={state.viewMode === viewMode ? 'page' : undefined}
            >
              <span aria-hidden='true' className='text-xs font-semibold'>
                {abbreviation}
              </span>
              <span>{label}</span>
            </button>
          ))}
          <button
            type='button'
            onClick={() => {
              setIsWorkspaceOpen(false);
              requestNavigation({ viewMode: 'bundle_import' });
            }}
            className='ui-control flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm'
            title='匯入協作包'
            aria-label='匯入協作包'
          >
            <svg
              className='h-4 w-4 flex-shrink-0'
              fill='none'
              stroke='currentColor'
              aria-hidden='true'
            >
              <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth={2}
                d='M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4'
              />
            </svg>
            <span>匯入協作包</span>
          </button>
        </div>
      </Modal>

      {/* Main Content */}
      <main
        className={`app-main relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-gradient-to-br from-gray-800 to-gray-900 backdrop-blur-sm transition-all duration-300 ease-in-out ${mainOffset}`}
        aria-hidden={isTouch && state.isSidebarOpen}
        inert={isTouch && state.isSidebarOpen}
      >
        <OfflineStatusBanner />
        {/* Top Bar with Hamburger Menu */}
        {(state.isMobile || state.isTablet) && !state.isSidebarOpen && (
          <div className='flex items-center justify-between gap-3 border-b border-gray-700/50 bg-gray-800/80 px-4 py-3 backdrop-blur-sm'>
            <div className='flex min-w-0 items-center'>
              <button
                ref={drawerTriggerRef}
                onClick={() => actions.setSidebarOpen(true)}
                className='mr-3 flex min-h-11 min-w-11 flex-shrink-0 items-center justify-center rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-700/50 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60'
                aria-label='開啟選單'
                aria-expanded={state.isSidebarOpen}
                aria-haspopup='true'
                title='開啟選單'
              >
                <svg className='w-6 h-6' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                  <path
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    strokeWidth={2}
                    d='M4 6h16M4 12h16M4 18h16'
                  />
                </svg>
              </button>
              <h2 className='min-w-0 truncate text-lg font-semibold text-white'>{title}</h2>
            </div>
            {state.viewMode === 'chat' &&
              !state.isProjectWorkspaceOpen &&
              state.activeProjectId && (
                <button
                  type='button'
                  onClick={() => actions.setProjectWorkspaceOpen(true)}
                  aria-label='顯示 HTML Canvas'
                  title='顯示 HTML Canvas'
                  className='inline-flex flex-shrink-0 items-center gap-1.5 rounded-md border border-cyan-500/40 bg-cyan-500/10 px-2 py-1.5 text-xs font-medium text-cyan-100 transition hover:border-cyan-400 hover:bg-cyan-500/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60'
                >
                  <svg
                    className='h-3.5 w-3.5'
                    fill='none'
                    stroke='currentColor'
                    viewBox='0 0 24 24'
                    aria-hidden='true'
                  >
                    <path
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      strokeWidth={2}
                      d='M13 5l7 7-7 7M5 5v14'
                    />
                  </svg>
                  <span className='hidden sm:inline'>顯示 HTML Canvas</span>
                </button>
              )}
          </div>
        )}

        {/* Content Area */}
        <div className='relative flex min-h-0 min-w-0 flex-1 overflow-hidden'>{children}</div>
      </main>
    </div>
  );
}
