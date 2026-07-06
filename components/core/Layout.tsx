import React, { useEffect, useState } from 'react';
import { useAppContext } from './useAppContext';
import { AssistantList } from '../assistant';
import { ProjectPicker } from '../canvas';
import { ChatIcon, TrashIcon, SettingsIcon, PlusIcon } from '../ui/Icons';
import { ChatSession, SessionTokenUsage } from '../../types';
import { useTursoAssistantStatus } from '../../hooks/useTursoAssistantStatus';

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps): React.JSX.Element {
  const { state, dispatch, actions } = useAppContext();

  // Check if current assistant exists in Turso for sharing
  const { canShare } = useTursoAssistantStatus(state.currentAssistant?.id || null);

  // Desktop = anything larger than the tablet breakpoint.
  // "collapsed" only applies to desktop (the icon-rail mode); mobile/tablet use the drawer.
  const isDesktop = !state.isMobile && !state.isTablet;
  const collapsed = isDesktop && state.isSidebarCollapsed;
  const [isTokenUsageOpen, setIsTokenUsageOpen] = useState(false);

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

  // Auto-close the drawer after navigating on mobile/tablet
  const closeDrawerIfMobile = () => {
    if (state.isMobile || state.isTablet) {
      actions.setSidebarOpen(false);
    }
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
          collapsed ? 'p-2' : 'p-6'
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
            className='absolute top-24 -right-3 z-50 flex w-6 h-6 items-center justify-center rounded-full bg-gray-700 border border-gray-600 text-gray-300 hover:bg-gray-600 hover:text-white shadow-md transition-colors'
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

        {/* Close button for mobile/tablet */}
        {(state.isMobile || state.isTablet) && (
          <div className='flex items-center justify-end mb-6'>
            <button
              onClick={actions.toggleSidebar}
              className='p-2 text-gray-400 hover:text-white rounded-lg hover:bg-gray-800/50 transition-colors'
              aria-label='關閉選單'
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
          </div>
        )}

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
                onClick={() => setIsTokenUsageOpen(prev => !prev)}
                className='flex w-11 h-11 items-center justify-center bg-gray-800/60 hover:bg-gray-700/70 text-gray-200 hover:text-white rounded-xl text-sm font-medium border border-gray-600/30 hover:border-gray-500/50 transition-colors'
                title='檢視 token 用量'
                aria-label='檢視 token 用量'
                aria-expanded={isTokenUsageOpen}
              >
                <span className='text-[11px] font-semibold'>TK</span>
              </button>
              {isTokenUsageOpen && (
                <div className='w-full rounded-xl border border-gray-700/60 bg-gray-900/95 p-3 shadow-2xl'>
                  {renderTokenUsageDetails(currentSessionUsage)}
                </div>
              )}
              <button
                onClick={() => {
                  actions.createNewSession(state.currentAssistant!.id);
                  actions.setViewMode('chat');
                  closeDrawerIfMobile();
                }}
                className='flex w-11 h-11 items-center justify-center bg-gray-700/50 hover:bg-gray-600/60 text-gray-200 hover:text-white rounded-xl text-sm font-medium border border-gray-600/30 hover:border-gray-500/50 transition-colors'
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
                    <button
                      key={sess.id}
                      onClick={() => {
                        dispatch({ type: 'SET_CURRENT_SESSION', payload: sess });
                        actions.setViewMode('chat');
                        closeDrawerIfMobile();
                      }}
                      className={`flex w-11 h-11 items-center justify-center rounded-full transition-colors ${
                        isActive
                          ? 'bg-cyan-500 text-white ring-2 ring-cyan-300/40'
                          : 'bg-gray-800/40 text-gray-300 hover:bg-gray-700/60 hover:text-white'
                      }`}
                      title={sess.title}
                      aria-label={`開啟聊天 ${sess.title}`}
                      aria-pressed={isActive}
                    >
                      <ChatIcon className='w-4 h-4' />
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div
              className='flex-1 overflow-y-auto chat-scroll'
              role='navigation'
              aria-label='聊天記錄'
            >
              <div className='mb-3 flex items-center justify-between gap-2 px-2'>
                <h2 className='text-sm font-bold text-gray-300 uppercase tracking-wider'>
                  聊天記錄
                </h2>
                <button
                  type='button'
                  onClick={() => setIsTokenUsageOpen(prev => !prev)}
                  className='inline-flex items-center rounded-md border border-gray-600/40 bg-gray-800/60 px-2 py-1 text-[11px] font-medium text-gray-200 transition-colors hover:border-gray-500/60 hover:bg-gray-700/70 hover:text-white'
                  aria-expanded={isTokenUsageOpen}
                  aria-label='檢視 token 用量'
                >
                  Token 用量
                </button>
              </div>
              {isTokenUsageOpen && (
                <div className='mb-3 rounded-xl border border-gray-700/60 bg-gray-900/95 p-3 shadow-2xl'>
                  {renderTokenUsageDetails(currentSessionUsage)}
                </div>
              )}
              <button
                onClick={() => {
                  actions.createNewSession(state.currentAssistant!.id);
                  actions.setViewMode('chat');
                  closeDrawerIfMobile();
                }}
                className='w-full flex items-center justify-center p-2.5 mb-3 bg-gray-700/50 hover:bg-gray-600/60 text-gray-200 hover:text-white rounded-lg text-sm font-medium border border-gray-600/30 hover:border-gray-500/50 transition-colors'
              >
                <svg className='w-4 h-4 mr-2' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                  <path
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    strokeWidth={2}
                    d='M12 4v16m8-8H4'
                  />
                </svg>
                新增聊天
              </button>
              <div className='space-y-2'>
                {state.sessions.map((sess: ChatSession) => (
                  <div
                    key={sess.id}
                    className={`group flex items-center p-3 rounded-lg cursor-pointer transition-colors ${
                      state.currentSession?.id === sess.id
                        ? 'bg-cyan-600/20 border border-cyan-500/30 text-white'
                        : 'bg-gray-800/30 hover:bg-gray-700/50 text-gray-200 hover:text-white border border-transparent hover:border-gray-600/30'
                    }`}
                    onClick={() => {
                      dispatch({ type: 'SET_CURRENT_SESSION', payload: sess });
                      actions.setViewMode('chat');
                      closeDrawerIfMobile();
                    }}
                  >
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center mr-3 flex-shrink-0 ${
                        state.currentSession?.id === sess.id ? 'bg-cyan-500' : 'bg-gray-600'
                      }`}
                    >
                      <ChatIcon className='w-4 h-4 text-white' />
                    </div>
                    <div className='flex-1 min-w-0'>
                      <div className='truncate font-medium text-white'>{sess.title}</div>
                      <div className='text-xs text-gray-400 mt-1'>
                        {new Date(sess.updatedAt || sess.createdAt).toLocaleString('zh-TW', {
                          month: 'numeric',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                    </div>
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        actions.deleteSession(sess.id);
                      }}
                      className='opacity-0 group-hover:opacity-100 p-1.5 text-gray-400 hover:text-red-400 rounded-md hover:bg-red-500/20 transition-all duration-200 ml-2'
                      title='刪除聊天'
                    >
                      <TrashIcon className='w-4 h-4' />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}

        {/* Settings */}
        <div className='mt-auto pt-4'>
          <div
            className={`border-t border-gray-700/30 pt-3 ${collapsed ? 'px-0 flex justify-center' : 'px-2'}`}
          >
            <button
              onClick={() => {
                actions.setViewMode('settings');
                closeDrawerIfMobile();
              }}
              className={
                collapsed
                  ? 'flex w-11 h-11 items-center justify-center text-gray-400 hover:text-white rounded-lg hover:bg-gray-700/50 transition-colors'
                  : 'flex items-center p-1.5 text-gray-400 hover:text-white rounded-md hover:bg-gray-700/50 transition-colors text-xs'
              }
              title='設定'
              aria-label='設定'
            >
              <SettingsIcon className='w-4 h-4' />
              {!collapsed && <span className='ml-2'>設定</span>}
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main
        className={`relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-gradient-to-br from-gray-800 to-gray-900 backdrop-blur-sm transition-all duration-300 ease-in-out ${mainOffset}`}
      >
        {/* Top Bar with Hamburger Menu */}
        {(state.isMobile || state.isTablet) && !state.isSidebarOpen && (
          <div className='flex items-center justify-between gap-3 border-b border-gray-700/50 bg-gray-800/80 p-4 backdrop-blur-sm'>
            <div className='flex items-center'>
              <button
                onClick={actions.toggleSidebar}
                className='mr-3 rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-700/50 hover:text-white'
                aria-label='開啟選單'
                aria-expanded={state.isSidebarOpen}
                aria-haspopup='true'
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
              <h2 className='text-lg font-semibold text-white'>{title}</h2>
            </div>
            {state.viewMode === 'chat' &&
              !state.isProjectWorkspaceOpen &&
              state.activeProjectId && (
                <button
                  type='button'
                  onClick={() => actions.setProjectWorkspaceOpen(true)}
                  aria-label='顯示 HTML Canvas'
                  title='顯示 HTML Canvas'
                  className='inline-flex items-center gap-1.5 rounded-md border border-cyan-500/40 bg-cyan-500/10 px-2 py-1.5 text-xs font-medium text-cyan-100 transition hover:border-cyan-400 hover:bg-cyan-500/20 hover:text-white'
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
