import React, { useEffect, useRef, useState } from 'react';
import { useAppContext } from './useAppContext';
import { AssistantList } from '../assistant';
import { ProjectPicker } from '../canvas';
import { ChatIcon, TrashIcon, SettingsIcon, PlusIcon } from '../ui/Icons';
import { ChatSession, SessionTokenUsage } from '../../types';
import { useTursoAssistantStatus } from '../../hooks/useTursoAssistantStatus';
import { downloadAssistantPackage } from '../../services/assistantPackageService';

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
  const { state, dispatch, actions } = useAppContext();

  // Check if current assistant exists in Turso for sharing
  const { canShare } = useTursoAssistantStatus(state.currentAssistant?.id || null);

  // Desktop = anything larger than the tablet breakpoint.
  // "collapsed" only applies to desktop (the icon-rail mode); mobile/tablet use the drawer.
  const isDesktop = !state.isMobile && !state.isTablet;
  const collapsed = isDesktop && state.isSidebarCollapsed;
  const isTouch = state.isMobile || state.isTablet;

  const [isTokenUsageOpen, setIsTokenUsageOpen] = useState(false);
  const [railPopoverTop, setRailPopoverTop] = useState(96);
  const tokenPopoverRef = useRef<HTMLDivElement | null>(null);
  const expandedTokenBtnRef = useRef<globalThis.HTMLButtonElement | null>(null);
  const railTokenBtnRef = useRef<globalThis.HTMLButtonElement | null>(null);

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
      if (railTokenBtnRef.current?.contains(target)) {
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

  const toggleRailTokenUsage = () => {
    if (!isTokenUsageOpen && typeof window !== 'undefined') {
      const rect = railTokenBtnRef.current?.getBoundingClientRect();
      if (rect) {
        const estimatedHeight = Math.min(window.innerHeight * 0.6, 460);
        setRailPopoverTop(
          Math.max(16, Math.min(rect.top, window.innerHeight - estimatedHeight - 16)),
        );
      }
    }
    setIsTokenUsageOpen(prev => !prev);
  };

  // In shared mode, render a simplified layout without sidebar
  if (state.isShared) {
    return (
      <div className='flex h-screen font-sans bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900'>
        {/* Main content area - full width in shared mode */}
        <div className='flex-1 flex flex-col overflow-hidden'>{children}</div>
      </div>
    );
  }

  const mainOffset = isDesktop && state.isSidebarOpen ? (collapsed ? 'pl-20' : 'pl-72') : '';

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

  return (
    <div className='relative flex h-screen overflow-hidden bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 font-sans'>
      {/* Sidebar Overlay for Mobile and Tablet */}
      {(state.isMobile || state.isTablet) && state.isSidebarOpen && (
        <div className='fixed inset-0 bg-black/50 z-40 lg:hidden' onClick={actions.toggleSidebar} />
      )}

      {/* Sidebar */}
      <div
        className={`${state.isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} fixed left-0 top-0 h-full z-50 ${
          state.isMobile || state.isTablet ? 'w-80' : collapsed ? 'w-20' : 'w-72'
        } bg-gray-900/95 backdrop-blur-sm flex flex-col overflow-hidden ${
          collapsed ? 'px-2 pt-4 pb-3' : 'px-4 pt-4 pb-3'
        } border-r border-gray-700/50 shadow-2xl transition-all duration-300 ease-in-out`}
        role='navigation'
        aria-label='主要導覽'
      >
        {/* Desktop collapse toggle — always reachable so there is no dead-end state */}
        {isDesktop && (
          <button
            type='button'
            data-testid='sidebar-collapse-toggle'
            onClick={actions.toggleSidebarCollapse}
            className='absolute top-24 -right-3 z-50 flex w-6 h-6 items-center justify-center rounded-full bg-gray-700 border border-gray-600 text-gray-300 hover:bg-gray-600 hover:text-white shadow-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60'
            aria-label={collapsed ? '展開側邊欄' : '收折側邊欄'}
            aria-expanded={!collapsed}
            title={collapsed ? '展開側邊欄' : '收折側邊欄'}
          >
            <svg className='w-3.5 h-3.5' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
              <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth={2.5}
                d={collapsed ? 'M9 5l7 7-7 7' : 'M15 19l-7-7 7-7'}
              />
            </svg>
          </button>
        )}

        {/* Brand area — 收折模式只顯示 logo；mobile/tablet 時右側附關閉鈕 */}
        <div
          className={`flex items-center border-b border-gray-700/50 ${
            collapsed ? 'justify-center pb-3 mb-3' : 'justify-between gap-2 px-1 pb-3.5 mb-4'
          }`}
        >
          <div className={`flex items-center ${collapsed ? '' : 'gap-2.5 min-w-0'}`}>
            <BrandMark className='h-8 w-8 flex-shrink-0' />
            {!collapsed && (
              <div className='min-w-0 leading-tight'>
                <div className='truncate text-base font-bold tracking-tight text-white'>
                  EduCare
                </div>
                <div className='text-[10px] font-medium uppercase tracking-[0.18em] text-cyan-400/90'>
                  AI 教學助理
                </div>
              </div>
            )}
          </div>
          {(state.isMobile || state.isTablet) && (
            <button
              onClick={actions.toggleSidebar}
              className='p-2 text-gray-400 hover:text-white rounded-lg hover:bg-gray-800/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 flex-shrink-0'
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
            actions.selectAssistant(assistantId, true);
            closeDrawerIfMobile();
          }}
          onEdit={assistant => {
            actions.selectAssistant(assistant.id, false);
            actions.setViewMode('edit_assistant');
            closeDrawerIfMobile();
          }}
          onDelete={actions.deleteAssistant}
          onShare={actions.openShareModal}
          onCreateNew={() => {
            actions.setViewMode('new_assistant');
            closeDrawerIfMobile();
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
              await actions.importAssistantPackage(file);
              closeDrawerIfMobile();
            } catch (error) {
              window.alert(`匯入助理設定檔失敗：${(error as Error).message}`);
            }
          }}
          canShare={canShare}
          collapsed={collapsed}
        />

        {state.currentAssistant && state.currentSession && (
          <ProjectPicker
            assistantId={state.currentAssistant.id}
            activeProjectId={state.activeProjectId}
            onCreateProject={async () => {
              await actions.createProjectForCurrentSession();
              closeDrawerIfMobile();
            }}
            onOpenProject={async projectId => {
              await actions.openProjectForCurrentSession(projectId);
              closeDrawerIfMobile();
            }}
            onRenameProject={actions.renameProjectForCurrentSession}
            onUploadProjectFiles={actions.uploadFilesToProjectForCurrentSession}
            onImportProjectZip={async file => {
              await actions.importProjectZipForCurrentSession(file);
              closeDrawerIfMobile();
            }}
            onDeleteProject={actions.deleteProjectForCurrentSession}
            variant={collapsed ? 'sidebar-collapsed' : 'sidebar'}
          />
        )}

        {/* Session List */}
        {state.currentAssistant &&
          (collapsed ? (
            <div
              className='flex-1 overflow-y-auto chat-scroll flex flex-col items-center gap-1.5 py-2'
              role='navigation'
              aria-label='聊天記錄'
            >
              <button
                type='button'
                ref={railTokenBtnRef}
                onClick={toggleRailTokenUsage}
                className='flex w-11 h-11 items-center justify-center rounded-xl border border-gray-600/30 bg-gray-800/60 text-gray-300 transition-colors hover:border-gray-500/50 hover:bg-gray-700/70 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60'
                title='檢視 token 用量'
                aria-label='檢視 token 用量'
                aria-expanded={isTokenUsageOpen}
                aria-haspopup='dialog'
              >
                <span className='text-[10px] font-bold tracking-wide'>TK</span>
              </button>
              <button
                onClick={() => {
                  actions.createNewSession(state.currentAssistant!.id);
                  actions.setViewMode('chat');
                  closeDrawerIfMobile();
                }}
                className='flex w-11 h-11 items-center justify-center rounded-xl bg-cyan-600 text-white shadow-lg shadow-cyan-600/25 transition-colors hover:bg-cyan-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70'
                title='新增聊天'
                aria-label='新增聊天'
              >
                <PlusIcon className='w-4 h-4' />
              </button>
              <div className='w-8 border-t border-gray-700/40 my-1' />
              <div className='flex flex-col items-center gap-1.5 w-full'>
                {state.sessions.map((sess: ChatSession) => {
                  const isActive = state.currentSession?.id === sess.id;
                  return (
                    <div key={sess.id} className='relative flex w-full justify-center'>
                      {isActive && (
                        <span
                          aria-hidden='true'
                          className='absolute left-1 top-1/2 h-6 w-1 -translate-y-1/2 rounded-full bg-cyan-400'
                        />
                      )}
                      <button
                        onClick={() => {
                          dispatch({ type: 'SET_CURRENT_SESSION', payload: sess });
                          actions.setViewMode('chat');
                          closeDrawerIfMobile();
                        }}
                        className={`flex w-11 h-11 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 ${
                          isActive
                            ? 'bg-cyan-500 text-white shadow-lg shadow-cyan-500/30 ring-2 ring-cyan-300/50'
                            : 'bg-gray-800/40 text-gray-300 hover:bg-gray-700/60 hover:text-white'
                        }`}
                        title={sess.title}
                        aria-label={`開啟聊天 ${sess.title}`}
                        aria-pressed={isActive}
                      >
                        <ChatIcon className='w-4 h-4' />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className='flex min-h-0 flex-1 flex-col' role='navigation' aria-label='聊天記錄'>
              {/* 區段標題 + Token 用量 popover 錨點 */}
              <div className='relative mb-2 flex items-center justify-between gap-2 px-1'>
                <h2 className='text-xs font-semibold uppercase tracking-wider text-gray-400'>
                  聊天記錄
                </h2>
                <button
                  type='button'
                  ref={expandedTokenBtnRef}
                  onClick={() => setIsTokenUsageOpen(prev => !prev)}
                  className='inline-flex items-center rounded-md border border-gray-600/40 bg-gray-800/60 px-2 py-1 text-[11px] font-medium text-gray-300 transition-colors hover:border-gray-500/60 hover:bg-gray-700/70 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60'
                  aria-expanded={isTokenUsageOpen}
                  aria-haspopup='dialog'
                  aria-label='檢視 token 用量'
                  title='檢視 token 用量'
                >
                  Token 用量
                </button>
                {isTokenUsageOpen && (
                  <div
                    ref={tokenPopoverRef}
                    role='dialog'
                    aria-label='Token 用量詳細資訊'
                    className='absolute right-0 top-full z-30 mt-2 w-64 rounded-xl border border-gray-700/60 bg-gray-900 shadow-2xl shadow-black/50'
                  >
                    {tokenUsagePopoverPanel}
                  </div>
                )}
              </div>
              <button
                onClick={() => {
                  actions.createNewSession(state.currentAssistant!.id);
                  actions.setViewMode('chat');
                  closeDrawerIfMobile();
                }}
                className='mb-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-cyan-600 py-2 text-sm font-semibold text-white shadow-lg shadow-cyan-600/25 transition-colors hover:bg-cyan-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70'
              >
                <PlusIcon className='w-4 h-4' />
                新增聊天
              </button>
              <div className='min-h-0 flex-1 space-y-0.5 overflow-y-auto chat-scroll pb-1'>
                {state.sessions.length === 0 && (
                  <p className='px-2 py-3 text-xs text-gray-500'>
                    尚無聊天記錄，點擊上方「新增聊天」開始。
                  </p>
                )}
                {state.sessions.map((sess: ChatSession) => {
                  const isActive = state.currentSession?.id === sess.id;
                  const openSession = () => {
                    dispatch({ type: 'SET_CURRENT_SESSION', payload: sess });
                    actions.setViewMode('chat');
                    closeDrawerIfMobile();
                  };
                  return (
                    <div
                      key={sess.id}
                      role='button'
                      tabIndex={0}
                      aria-current={isActive ? 'true' : undefined}
                      className={`group relative flex cursor-pointer items-center gap-2 rounded-lg py-2 pl-3 pr-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 ${
                        isActive
                          ? 'bg-cyan-500/10 text-white'
                          : 'text-gray-300 hover:bg-gray-800/60 hover:text-white'
                      }`}
                      onClick={openSession}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          openSession();
                        }
                      }}
                    >
                      {isActive && (
                        <span
                          aria-hidden='true'
                          className='absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-cyan-400'
                        />
                      )}
                      <span
                        className={`min-w-0 flex-1 truncate text-sm ${isActive ? 'font-medium' : ''}`}
                      >
                        {sess.title}
                      </span>
                      <span className='flex-shrink-0 text-[11px] tabular-nums text-gray-500'>
                        {formatRelativeTime(sess.updatedAt || sess.createdAt)}
                      </span>
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          actions.deleteSession(sess.id);
                        }}
                        className={`${
                          isTouch
                            ? 'opacity-100'
                            : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100'
                        } pointer-coarse:opacity-100 flex-shrink-0 rounded-md p-1.5 text-gray-500 transition-all duration-200 hover:bg-red-500/15 hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/60`}
                        title='刪除聊天'
                        aria-label={`刪除聊天 ${sess.title}`}
                      >
                        <TrashIcon className='w-4 h-4' />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

        {/* Settings */}
        <div className='mt-auto pt-3'>
          <div
            className={`border-t border-gray-700/50 pt-2.5 ${collapsed ? 'flex justify-center' : ''}`}
          >
            <button
              onClick={() => {
                actions.setViewMode('settings');
                closeDrawerIfMobile();
              }}
              className={
                collapsed
                  ? 'flex w-11 h-11 items-center justify-center text-gray-400 hover:text-white rounded-lg hover:bg-gray-700/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60'
                  : 'flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-gray-400 transition-colors hover:bg-gray-800/60 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60'
              }
              title='設定'
              aria-label='設定'
            >
              <SettingsIcon className='w-4 h-4' />
              {!collapsed && <span>設定</span>}
            </button>
          </div>
        </div>
      </div>

      {/* 收折 rail 的 token 用量 popover：開在 rail 右側（sidebar overflow-hidden，故置於其外） */}
      {collapsed && isTokenUsageOpen && (
        <div
          ref={tokenPopoverRef}
          role='dialog'
          aria-label='Token 用量詳細資訊'
          style={{ top: railPopoverTop }}
          className='fixed left-[5.5rem] z-[60] w-72 rounded-xl border border-gray-700/60 bg-gray-900 shadow-2xl shadow-black/50'
        >
          {tokenUsagePopoverPanel}
        </div>
      )}

      {/* Main Content */}
      <main
        className={`relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-gradient-to-br from-gray-800 to-gray-900 backdrop-blur-sm transition-all duration-300 ease-in-out ${mainOffset}`}
      >
        {/* Top Bar with Hamburger Menu */}
        {(state.isMobile || state.isTablet) && !state.isSidebarOpen && (
          <div className='flex items-center justify-between gap-3 border-b border-gray-700/50 bg-gray-800/80 px-4 py-3 backdrop-blur-sm'>
            <div className='flex min-w-0 items-center'>
              <button
                onClick={actions.toggleSidebar}
                className='mr-3 flex-shrink-0 rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-700/50 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60'
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
        <div className='flex min-h-0 flex-1 overflow-hidden'>{children}</div>
      </main>
    </div>
  );
}
