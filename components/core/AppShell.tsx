import React from 'react';
import { AppProvider, useAppContext, ErrorBoundary, Layout, ModelLoadingOverlay } from './index';
import { AssistantEditor, ShareModal } from '../assistant';
import { ChatContainer } from '../chat';
import { HtmlProjectWorkspace } from '../canvas';
import { ChatSession } from '../../types';
import type { ChatTokenInfo } from '../chat/types';
import SharedAssistant from '../features/SharedAssistant';
import ProviderSettings from '../settings/ProviderSettings';
import ProviderSettingsImportModal from '../settings/ProviderSettingsImportModal';
import { providerManager } from '../../services/providerRegistry';
import { ChatCompactorService } from '../../services/chatCompactorService';
import { countConversationRounds, groupMessagesByRounds } from '../../services/conversationUtils';

function AppContent(): React.JSX.Element {
  const { state, actions } = useAppContext();

  // Initialize compression service with default configuration
  const compressionService = new ChatCompactorService({
    targetTokens: 2000,
    triggerRounds: 10,
    preserveLastRounds: 2,
    maxRetries: 2,
    compressionVersion: '1.0',
  });

  const handleNewMessage = async (
    session: ChatSession,
    userMessage: string,
    _modelResponse: string,
    _tokenInfo: ChatTokenInfo,
  ) => {
    let updatedSession = {
      ...session,
      title:
        session.title === 'New Chat' && userMessage ? userMessage.substring(0, 40) : session.title,
      updatedAt: Date.now(),
    };

    try {
      // Check if compression should be triggered
      const totalRounds = countConversationRounds(session.messages);
      const hasExistingCompact = !!session.compactContext;

      if (compressionService.shouldTriggerCompression(totalRounds, hasExistingCompact)) {
        console.log(
          '🗜️ [COMPRESSION] Triggering compression - Total rounds:',
          totalRounds,
          'Has existing compact:',
          hasExistingCompact,
        );

        // Get conversation rounds to compress
        const allRounds = groupMessagesByRounds(session.messages);
        const preserveRounds = compressionService.getConfig().preserveLastRounds;

        // Determine which rounds to compress
        const roundsToCompress = allRounds.slice(0, -preserveRounds);

        if (roundsToCompress.length > 0) {
          console.log(
            '🗜️ [COMPRESSION] Compressing',
            roundsToCompress.length,
            'rounds, preserving last',
            preserveRounds,
            'rounds',
          );

          // Perform compression
          const compressionResult = await compressionService.compressConversationHistory(
            roundsToCompress,
            session.compactContext,
          );

          if (compressionResult.success && compressionResult.compactContext) {
            console.log('✅ [COMPRESSION] Compression successful!', {
              originalTokens: compressionResult.originalTokenCount,
              compressedTokens: compressionResult.compressedTokenCount,
              retryCount: compressionResult.retryCount,
            });

            // Calculate preserved messages (keep last N rounds + any incomplete message)
            const preservedRounds = allRounds.slice(-preserveRounds);
            const preservedMessages = preservedRounds.flatMap(round => [
              round.userMessage,
              round.assistantMessage,
            ]);

            // Update session with compressed context and reduced message history
            updatedSession = {
              ...updatedSession,
              compactContext: compressionResult.compactContext,
              lastCompactionAt: new Date().toISOString(),
              messages: preservedMessages,
              // Recalculate token count for the preserved messages only
              tokenCount:
                compressionResult.compactContext.tokenCount +
                Math.floor(preservedMessages.length * 50), // Rough estimate for preserved messages
              tokenUsage: updatedSession.tokenUsage
                ? {
                    ...updatedSession.tokenUsage,
                    totals: updatedSession.tokenUsage.totals
                      ? {
                          ...updatedSession.tokenUsage.totals,
                          totalTokens:
                            compressionResult.compactContext.tokenCount +
                            Math.floor(preservedMessages.length * 50),
                        }
                      : updatedSession.tokenUsage.totals,
                  }
                : updatedSession.tokenUsage,
            };
          } else {
            console.warn('❌ [COMPRESSION] Compression failed:', compressionResult.error);
            // Continue without compression if it fails
          }
        }
      }
    } catch (error) {
      console.error('❌ [COMPRESSION] Compression error:', error);
      // Continue without compression if there's an error
    }

    await actions.updateSession(updatedSession);
  };

  // If in shared mode, render SharedAssistant component (which sets up state) and continue with normal rendering
  if (state.isShared && state.sharedAssistantId) {
    // SharedAssistant component handles loading the shared assistant and setting up state
    return (
      <Layout>
        <SharedAssistant assistantId={state.sharedAssistantId} />

        {/* Render content based on current view mode, just like normal mode */}
        {(state.viewMode === 'provider_settings' || state.viewMode === 'api_setup') && (
          <div className='absolute inset-0 overflow-y-auto bg-gray-900'>
            <ProviderSettings onClose={() => actions.setViewMode('chat')} />
          </div>
        )}

        {state.viewMode === 'chat' && state.currentAssistant && state.currentSession && (
          <ChatContainer
            session={state.currentSession}
            assistantName={state.currentAssistant.name}
            systemPrompt={state.currentAssistant.systemPrompt}
            assistantId={state.currentAssistant.id}
            ragChunks={state.currentAssistant.ragChunks ?? []}
            onNewMessage={handleNewMessage}
            sharedMode={!!state.isShared}
            assistantDescription={state.currentAssistant.description}
            starterPrompts={state.currentAssistant.starterPrompts ?? []}
            subagentDelegationEnabled={state.currentAssistant.subagentDelegationEnabled ?? false}
          />
        )}

        {/* Loading Screen */}
        {state.isLoading && (
          <div className='flex flex-col items-center justify-center h-full text-gray-400 p-8'>
            <div className='relative mb-6'>
              <div className='w-16 h-16 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin'></div>
              <div className='absolute inset-0 w-16 h-16 border-4 border-cyan-300/20 rounded-full'></div>
            </div>
            <div className='text-center max-w-md'>
              <p className='text-lg font-medium text-white mb-2'>載入分享的助理中...</p>
              <p className='text-sm text-gray-400'>正在從雲端載入助理資料</p>
            </div>
          </div>
        )}

        {/* Error State */}
        {state.error && !state.isLoading && (
          <div className='flex flex-col items-center justify-center h-full text-gray-400 p-8'>
            <div className='w-20 h-20 bg-red-900/20 rounded-full flex items-center justify-center mb-6'>
              <svg
                className='w-10 h-10 text-red-500'
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth={2}
                  d='M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
                />
              </svg>
            </div>
            <h3 className='text-xl font-semibold text-white mb-2'>載入失敗</h3>
            <p className='text-gray-400 mb-6 text-center max-w-md'>{state.error}</p>
            <button
              onClick={() => window.location.reload()}
              className='px-6 py-3 bg-gradient-to-r from-cyan-600 to-cyan-500 hover:from-cyan-500 hover:to-cyan-400 text-white rounded-xl font-semibold shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-0.5'
            >
              重新載入
            </button>
          </div>
        )}

        {/* Model Loading Overlay for Shared Mode */}
        <ModelLoadingOverlay
          isVisible={state.isModelLoading}
          progress={state.modelLoadingProgress || undefined}
        />

        <ProviderSettingsImportModal onApplied={() => actions.setViewMode('chat')} />
      </Layout>
    );
  }

  return (
    <Layout>
      {/* View Mode Content */}
      {state.viewMode === 'new_assistant' && (
        <AssistantEditor
          assistant={null}
          onSave={actions.saveAssistant}
          onCancel={() => {
            if (state.assistants.length > 0) {
              actions.setViewMode('chat');
            } else {
              actions.setViewMode('new_assistant');
            }
          }}
          onShare={actions.openShareModal}
        />
      )}

      {state.viewMode === 'edit_assistant' && state.currentAssistant && (
        <AssistantEditor
          assistant={state.currentAssistant}
          onSave={actions.saveAssistant}
          onCancel={() => actions.setViewMode('chat')}
          onShare={actions.openShareModal}
        />
      )}

      {state.viewMode === 'chat' && state.currentAssistant && state.currentSession && (
        <div className='flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden lg:flex-row'>
          <div
            className={`relative flex min-h-0 min-w-0 flex-1 flex-col ${state.isProjectWorkspaceOpen && state.activeProjectId ? 'lg:w-[55%]' : 'w-full'}`}
          >
            <div className='min-h-0 flex-1'>
              <ChatContainer
                session={state.currentSession}
                assistantName={state.currentAssistant.name}
                systemPrompt={state.currentAssistant.systemPrompt}
                assistantId={state.currentAssistant.id}
                ragChunks={state.currentAssistant.ragChunks ?? []}
                onNewMessage={handleNewMessage}
                sharedMode={!!state.isShared}
                assistantDescription={state.currentAssistant.description}
                starterPrompts={state.currentAssistant.starterPrompts ?? []}
                subagentDelegationEnabled={
                  state.currentAssistant.subagentDelegationEnabled ?? false
                }
                hideHeader={state.isMobile || state.isTablet}
                isWorkspaceOpen={Boolean(state.isProjectWorkspaceOpen && state.activeProjectId)}
                headerActions={
                  state.isMobile || state.isTablet ? undefined : !state.isProjectWorkspaceOpen &&
                    state.activeProjectId ? (
                    <button
                      type='button'
                      onClick={() => actions.setProjectWorkspaceOpen(true)}
                      aria-label='顯示 HTML Canvas'
                      title='顯示 HTML Canvas'
                      className='inline-flex items-center gap-1.5 rounded-md border border-cyan-500/40 bg-cyan-500/10 px-2 py-1.5 text-xs font-medium text-cyan-100 transition hover:border-cyan-400 hover:bg-cyan-500/20 hover:text-white md:px-3 md:text-sm'
                    >
                      <svg
                        className='h-3.5 w-3.5 md:h-4 md:w-4'
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
                  ) : undefined
                }
              />
            </div>
          </div>
          {state.isProjectWorkspaceOpen && state.activeProjectId && (
            <div className='min-h-0 overflow-hidden border-t border-gray-800 lg:h-full lg:w-[45%] lg:min-w-[360px] lg:max-w-[48%] lg:border-l lg:border-t-0'>
              <HtmlProjectWorkspace projectId={state.activeProjectId} />
            </div>
          )}
        </div>
      )}

      {state.viewMode === 'settings' && (
        <div className='h-full overflow-y-auto bg-gray-900'>
          <div className='max-w-3xl mx-auto p-6 md:p-8'>
            {/* Header */}
            <div className='mb-6'>
              <h2 className='text-2xl md:text-3xl font-bold text-white mb-1.5'>設定</h2>
              <p className='text-gray-400 text-sm'>管理您的 AI 服務商、模型與安全分享設定</p>
            </div>

            {/* 服務狀態 */}
            {(() => {
              const providerCount = providerManager.getAvailableProviders().length;
              const ready = providerCount > 0;
              return (
                <div className='mb-6 rounded-2xl border border-gray-700/40 bg-gray-800/40 p-5'>
                  <h3 className='text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3'>
                    服務狀態
                  </h3>
                  <div className='flex items-center gap-3'>
                    <span
                      className={`flex items-center justify-center w-10 h-10 rounded-xl text-lg ${
                        ready ? 'bg-green-500/15' : 'bg-yellow-500/15'
                      }`}
                    >
                      {ready ? '✅' : '⚠️'}
                    </span>
                    <div>
                      <p className='text-white font-medium'>
                        {ready ? `${providerCount} 個 AI 服務商可用` : '尚未配置 AI 服務商'}
                      </p>
                      <p className={`text-sm ${ready ? 'text-green-300' : 'text-yellow-300'}`}>
                        {ready ? 'AI 功能已就緒' : '請至下方完成 AI 服務商設定'}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* 設定入口 */}
            <h3 className='text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3 px-1'>
              設定項目
            </h3>
            <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
              <button
                onClick={() => actions.setViewMode('provider_settings')}
                className='group text-left p-5 rounded-2xl border border-gray-700/40 bg-gray-800/40 hover:border-cyan-500/50 hover:bg-gray-800/70 transition-all sm:col-span-2'
              >
                <div className='flex items-center gap-3 mb-2'>
                  <div className='flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500/30 to-fuchsia-500/20 text-xl'>
                    ⚙️
                  </div>
                  <h4 className='flex-1 text-white font-semibold group-hover:text-cyan-300 transition-colors'>
                    AI 服務商
                  </h4>
                  <svg
                    className='w-5 h-5 text-gray-500 group-hover:text-cyan-300 group-hover:translate-x-0.5 transition-all'
                    fill='none'
                    stroke='currentColor'
                    viewBox='0 0 24 24'
                  >
                    <path
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      strokeWidth={2}
                      d='M9 5l7 7-7 7'
                    />
                  </svg>
                </div>
                <p className='text-sm text-gray-400'>選擇並配置服務商、模型、端點與加密分享設定</p>
              </button>
            </div>
          </div>
        </div>
      )}

      {(state.viewMode === 'provider_settings' || state.viewMode === 'api_setup') && (
        <div className='absolute inset-0 overflow-y-auto bg-gray-900'>
          <ProviderSettings onClose={() => actions.setViewMode('settings')} />
        </div>
      )}

      {/* Loading Screen */}
      {state.isLoading && (
        <div className='flex flex-col items-center justify-center h-full text-gray-400 p-8'>
          <div className='relative mb-6'>
            <div className='w-16 h-16 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin'></div>
            <div className='absolute inset-0 w-16 h-16 border-4 border-cyan-300/20 rounded-full'></div>
          </div>
          <div className='text-center max-w-md'>
            <p className='text-lg font-medium text-white mb-2'>載入助理中...</p>
            <p className='text-sm text-gray-400 mb-4'>正在從資料庫讀取您的助理資料</p>
            <div className='flex justify-center items-center space-x-1 mb-4'>
              <div className='w-2 h-2 bg-cyan-500 rounded-full animate-bounce'></div>
              <div
                className='w-2 h-2 bg-cyan-500 rounded-full animate-bounce'
                style={{ animationDelay: '0.1s' }}
              ></div>
              <div
                className='w-2 h-2 bg-cyan-500 rounded-full animate-bounce'
                style={{ animationDelay: '0.2s' }}
              ></div>
            </div>
            <div className='text-xs text-gray-500'>
              <div>正在執行以下步驟：</div>
              <div className='mt-2 space-y-1'>
                <div className='flex items-center justify-center gap-2'>
                  <div className='w-1.5 h-1.5 bg-green-500 rounded-full'></div>
                  <span>連接資料庫</span>
                </div>
                <div className='flex items-center justify-center gap-2'>
                  <div className='w-1.5 h-1.5 bg-cyan-500 rounded-full animate-pulse'></div>
                  <span>載入助理資料</span>
                </div>
                <div className='flex items-center justify-center gap-2'>
                  <div className='w-1.5 h-1.5 bg-gray-500 rounded-full'></div>
                  <span>初始化介面</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!state.currentAssistant &&
        !state.isLoading &&
        state.viewMode !== 'new_assistant' &&
        state.viewMode !== 'settings' &&
        state.viewMode !== 'provider_settings' &&
        state.viewMode !== 'api_setup' && (
          <div className='flex flex-col items-center justify-center h-full text-gray-400 p-8'>
            <div className='w-20 h-20 bg-gray-700 rounded-full flex items-center justify-center mb-6'>
              <svg
                className='w-10 h-10 text-gray-500'
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth={2}
                  d='M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z'
                />
              </svg>
            </div>
            <h3 className='text-xl font-semibold text-white mb-2'>歡迎使用專業助理</h3>
            <p className='text-gray-400 mb-6 text-center max-w-md'>
              還沒有任何助理。創建您的第一個 AI 助理開始聊天吧！
            </p>
            <button
              onClick={() => actions.setViewMode('new_assistant')}
              className='px-6 py-3 bg-gradient-to-r from-cyan-600 to-cyan-500 hover:from-cyan-500 hover:to-cyan-400 text-white rounded-xl font-semibold shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-0.5'
            >
              新增您的第一個助理
            </button>
          </div>
        )}

      {/* Model Loading Overlay */}
      <ModelLoadingOverlay
        isVisible={state.isModelLoading}
        progress={state.modelLoadingProgress || undefined}
      />

      {/* Share Modal */}
      {state.assistantToShare && (
        <ShareModal
          isOpen={state.isShareModalOpen}
          onClose={actions.closeShareModal}
          assistant={state.assistantToShare}
        />
      )}

      <ProviderSettingsImportModal
        onApplied={() => {
          if (state.viewMode === 'settings') {
            actions.setViewMode('provider_settings');
            return;
          }

          if (!state.currentAssistant) {
            actions.setViewMode('provider_settings');
          }
        }}
      />
    </Layout>
  );
}

export function AppShell(): React.JSX.Element {
  return (
    <ErrorBoundary>
      <AppProvider>
        <AppContent />
      </AppProvider>
    </ErrorBoundary>
  );
}
