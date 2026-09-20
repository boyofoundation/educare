import React from 'react';
import { AppProvider, useAppContext, ErrorBoundary, Layout, ModelLoadingOverlay } from './index';
import { AssistantEditor, ShareModal } from '../assistant';
import { ChatContainer } from '../chat';
import { HtmlProjectWorkspace } from '../canvas';
import { ChatSession } from '../../types';
import type { ChatTokenInfo } from '../chat/types';
import BundleRunner from '../features/BundleRunner';
import SharedAssistant from '../features/SharedAssistant';
import BundleImportPage from '../bundle/BundleImportPage';
import BundleBuilder from '../bundle/BundleBuilder';
import BundleProviderSetup from '../bundle/BundleProviderSetup';
import ProviderSettings from '../settings/ProviderSettings';
import AppearanceSettings from '../settings/AppearanceSettings';
import ProviderSettingsImportModal from '../settings/ProviderSettingsImportModal';
import { Onboarding } from './Onboarding';
import Modal from '../ui/Modal';
import { getOnboardingPreferences } from '../../services/onboardingPreferences';
import { providerManager } from '../../services/providerRegistry';
import { ChatCompactorService } from '../../services/chatCompactorService';
import { countConversationRounds, groupMessagesByRounds } from '../../services/conversationUtils';
import { getBundleMetrics } from '../../services/bundleMetricsService';

function AppContent(): React.JSX.Element {
  const { state, actions } = useAppContext();
  const [mobilePane, setMobilePane] = React.useState<'chat' | 'canvas'>('chat');
  const paneId = React.useId();
  const chatTabRef = React.useRef<React.ComponentRef<'button'>>(null);
  const canvasTabRef = React.useRef<React.ComponentRef<'button'>>(null);
  const previousWorkspaceRef = React.useRef<string | null>(null);
  const [onboardingMode, setOnboardingMode] = React.useState<'initial' | 'open' | 'closed'>(() =>
    getOnboardingPreferences().completed ? 'closed' : 'initial',
  );
  const [initialTemplateId, setInitialTemplateId] = React.useState<string>();
  const [importChoiceOpen, setImportChoiceOpen] = React.useState(false);
  const [isImporting, setIsImporting] = React.useState(false);
  const [importError, setImportError] = React.useState<string | null>(null);
  const importFileRef = React.useRef<React.ComponentRef<'input'>>(null);
  const [isOnline, setIsOnline] = React.useState(() => navigator.onLine);
  const onboardingOpen =
    onboardingMode === 'open' ||
    (onboardingMode === 'initial' &&
      !state.isLoading &&
      state.isShared === false &&
      !state.bundleMode &&
      !state.isBundleImportRoute &&
      state.assistants.length === 0);
  const bundleMetrics = getBundleMetrics();
  const htmlProjectAccessEnabled =
    !state.currentAssistant?.mathToolsEnabled && !state.currentAssistant?.webSpeechToolsEnabled;
  const compactLayout = state.isMobile || state.isTablet;
  const hasWorkspace = htmlProjectAccessEnabled && Boolean(state.activeProjectId);
  const workspaceVisible = hasWorkspace && state.isProjectWorkspaceOpen;
  const showPaneTabs = compactLayout && hasWorkspace;

  React.useEffect(() => {
    if (
      onboardingMode === 'initial' &&
      !state.isLoading &&
      (state.isShared ||
        state.bundleMode ||
        state.isBundleImportRoute ||
        state.assistants.length > 0)
    ) {
      setOnboardingMode('closed');
    }
  }, [
    onboardingMode,
    state.isLoading,
    state.isShared,
    state.bundleMode,
    state.isBundleImportRoute,
    state.assistants.length,
  ]);

  React.useEffect(() => {
    const updateNetwork = () => setIsOnline(navigator.onLine);
    window.addEventListener('online', updateNetwork);
    window.addEventListener('offline', updateNetwork);
    return () => {
      window.removeEventListener('online', updateNetwork);
      window.removeEventListener('offline', updateNetwork);
    };
  }, []);

  const importAssistant = async (file: File) => {
    setIsImporting(true);
    setImportError(null);
    try {
      await actions.importAssistantPackage(file);
      setImportChoiceOpen(false);
    } catch (error) {
      setImportError(
        error instanceof Error ? error.message : '匯入失敗，請確認助理檔案後再試一次。',
      );
    } finally {
      setIsImporting(false);
    }
  };

  React.useEffect(() => {
    const nextProject = workspaceVisible ? state.activeProjectId : null;
    if (nextProject !== previousWorkspaceRef.current) {
      setMobilePane(nextProject ? 'canvas' : 'chat');
      if (!nextProject && compactLayout) {
        chatTabRef.current?.focus();
      }
    }
    previousWorkspaceRef.current = nextProject;
  }, [workspaceVisible, state.activeProjectId, compactLayout]);

  const selectPane = (pane: 'chat' | 'canvas') => {
    setMobilePane(pane);
    if (pane === 'canvas' && !state.isProjectWorkspaceOpen) {
      actions.setProjectWorkspaceOpen(true);
    }
  };

  const handlePaneKey = (event: React.KeyboardEvent<React.ComponentRef<'button'>>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const nextPane =
      event.key === 'Home'
        ? 'chat'
        : event.key === 'End'
          ? 'canvas'
          : mobilePane === 'chat'
            ? 'canvas'
            : 'chat';
    selectPane(nextPane);
    (nextPane === 'chat' ? chatTabRef : canvasTabRef).current?.focus();
  };

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

  if (state.bundleMode) {
    return (
      <Layout>
        <BundleRunner bundleId={state.bundleMode.bundleId} bundle={state.bundleMode.bundle} />
        {state.viewMode === 'provider_settings' && (
          <div className='absolute inset-0 overflow-y-auto bg-gray-900 p-4 md:p-8'>
            <BundleProviderSetup onReady={() => actions.setViewMode('chat')} />
          </div>
        )}
        <ProviderSettingsImportModal onApplied={() => actions.setViewMode('chat')} />
      </Layout>
    );
  }

  // Standalone bundle import/management route (?import=bundle): no sidebar, no provider menus.
  if (state.isBundleImportRoute) {
    return (
      <Layout>
        <BundleImportPage
          onClose={() => {
            const url = new URL(window.location.href);
            url.searchParams.delete('import');
            window.location.href = url.toString();
          }}
          onOpenBundle={() => undefined}
        />
      </Layout>
    );
  }

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
            mathToolsEnabled={state.currentAssistant.mathToolsEnabled ?? false}
            webSpeechToolsEnabled={state.currentAssistant.webSpeechToolsEnabled ?? false}
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
      <Onboarding
        isOpen={onboardingOpen}
        onOpenChange={open => setOnboardingMode(open ? 'open' : 'closed')}
        onApplyTemplate={template => {
          setInitialTemplateId(template.id);
          actions.setViewMode('new_assistant');
        }}
        onImportAssistant={() => {
          setImportError(null);
          setImportChoiceOpen(true);
        }}
        onBrowse={() => actions.setViewMode('chat')}
        onSkip={() => actions.setViewMode('chat')}
      />
      <Modal
        isOpen={importChoiceOpen}
        onClose={() => !isImporting && setImportChoiceOpen(false)}
        title='匯入助理或協作包'
      >
        <p className='mb-4 text-sm text-gray-300'>
          選擇你已有的檔案種類。資料會儲存在這台裝置，不需要設定 Turso 或 API 金鑰。
        </p>
        <input
          ref={importFileRef}
          type='file'
          accept='.zip,application/zip'
          aria-label='選擇助理壓縮檔'
          className='hidden'
          onChange={event => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) {
              void importAssistant(file);
            }
          }}
        />
        {importError && (
          <p role='alert' className='mb-4 text-red-300'>
            {importError}
          </p>
        )}
        {isImporting && (
          <p role='status' className='mb-4 text-gray-300'>
            正在匯入並儲存到這台裝置…
          </p>
        )}
        <div className='flex flex-wrap gap-3'>
          <button
            type='button'
            disabled={isImporting}
            onClick={() => importFileRef.current?.click()}
            className='min-h-11 rounded-lg bg-cyan-700 px-4 py-2 font-semibold text-white disabled:opacity-50'
          >
            {importError ? '重新選擇助理檔案' : '選擇助理檔案'}
          </button>
          <button
            type='button'
            disabled={isImporting}
            onClick={() => {
              setImportChoiceOpen(false);
              actions.setViewMode('bundle_import');
            }}
            className='min-h-11 rounded-lg border border-gray-500 px-4 py-2 text-gray-200 disabled:opacity-50'
          >
            匯入協作包檔案
          </button>
        </div>
      </Modal>
      <Modal
        isOpen={Boolean(state.pendingNavigation)}
        onClose={actions.cancelPendingNavigation}
        title='離開尚未儲存的編輯？'
      >
        <p className='mb-4 text-gray-300'>
          這次修改尚未儲存。離開會捨棄修改，已儲存的助理不受影響。
        </p>
        <div className='flex flex-wrap gap-3'>
          <button
            type='button'
            className='min-h-11 rounded-lg bg-cyan-700 px-4 py-2 text-white'
            onClick={actions.cancelPendingNavigation}
          >
            繼續編輯
          </button>
          <button
            type='button'
            className='min-h-11 rounded-lg border border-gray-500 px-4 py-2 text-gray-200'
            onClick={actions.confirmPendingNavigation}
          >
            捨棄修改並離開
          </button>
        </div>
      </Modal>
      {/* View Mode Content */}
      {state.viewMode === 'new_assistant' && !onboardingOpen && (
        <AssistantEditor
          assistant={null}
          initialTemplateId={initialTemplateId}
          onDirtyChange={actions.setEditorDirty}
          onSave={async assistant => {
            await actions.saveAssistant(assistant);
            setInitialTemplateId(undefined);
          }}
          onCancel={() => {
            setInitialTemplateId(undefined);
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
          onDirtyChange={actions.setEditorDirty}
          onCancel={() => actions.setViewMode('chat')}
          onShare={actions.openShareModal}
        />
      )}

      {state.viewMode === 'chat' && state.currentAssistant && state.currentSession && (
        <div className='flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden lg:flex-row'>
          {showPaneTabs && (
            <div
              role='tablist'
              aria-label='聊天與作品'
              className='flex shrink-0 border-b border-gray-700 bg-gray-900 p-1'
            >
              {(['chat', 'canvas'] as const).map(pane => (
                <button
                  key={pane}
                  ref={pane === 'chat' ? chatTabRef : canvasTabRef}
                  type='button'
                  role='tab'
                  id={`${paneId}-${pane}-tab`}
                  aria-controls={`${paneId}-${pane}-panel`}
                  aria-selected={mobilePane === pane}
                  tabIndex={mobilePane === pane ? 0 : -1}
                  onClick={() => selectPane(pane)}
                  onKeyDown={handlePaneKey}
                  className={`min-h-11 min-w-11 flex-1 rounded-lg px-4 py-2 text-sm font-semibold ${mobilePane === pane ? 'bg-cyan-700 text-white' : 'text-gray-300 hover:bg-gray-800'}`}
                >
                  {pane === 'chat' ? '聊天' : '作品'}
                </button>
              ))}
            </div>
          )}
          <div
            id={`${paneId}-chat-panel`}
            role={showPaneTabs ? 'tabpanel' : undefined}
            aria-labelledby={showPaneTabs ? `${paneId}-chat-tab` : undefined}
            style={
              showPaneTabs && workspaceVisible && mobilePane === 'canvas'
                ? { display: 'none' }
                : undefined
            }
            className={`relative flex min-h-0 min-w-0 flex-1 flex-col ${htmlProjectAccessEnabled && state.isProjectWorkspaceOpen && state.activeProjectId ? 'lg:w-[55%]' : 'w-full'}`}
          >
            <div className='min-h-0 flex-1'>
              <ChatContainer
                session={state.currentSession}
                assistantName={state.currentAssistant.name}
                systemPrompt={state.currentAssistant.systemPrompt}
                assistantId={state.currentAssistant.id}
                ragChunks={state.currentAssistant.ragChunks ?? []}
                onNewMessage={handleNewMessage}
                onRequestProviderSetup={() => actions.openProviderSettings('chat')}
                sharedMode={!!state.isShared}
                assistantDescription={state.currentAssistant.description}
                starterPrompts={state.currentAssistant.starterPrompts ?? []}
                subagentDelegationEnabled={
                  state.currentAssistant.subagentDelegationEnabled ?? false
                }
                mathToolsEnabled={state.currentAssistant.mathToolsEnabled ?? false}
                webSpeechToolsEnabled={state.currentAssistant.webSpeechToolsEnabled ?? false}
                hideHeader={state.isMobile || state.isTablet}
                isWorkspaceOpen={Boolean(
                  htmlProjectAccessEnabled && state.isProjectWorkspaceOpen && state.activeProjectId,
                )}
                headerActions={
                  state.isMobile || state.isTablet ? undefined : htmlProjectAccessEnabled &&
                    !state.isProjectWorkspaceOpen &&
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
          {hasWorkspace && state.activeProjectId && (
            <div
              id={`${paneId}-canvas-panel`}
              role={showPaneTabs ? 'tabpanel' : undefined}
              aria-labelledby={showPaneTabs ? `${paneId}-canvas-tab` : undefined}
              style={
                !workspaceVisible || (showPaneTabs && mobilePane !== 'canvas')
                  ? { display: 'none' }
                  : undefined
              }
              className='min-h-0 min-w-0 flex-1 overflow-hidden border-t border-gray-800 lg:h-full lg:flex-none lg:w-[45%] lg:min-w-[360px] lg:max-w-[48%] lg:border-l lg:border-t-0'
            >
              {workspaceVisible && <HtmlProjectWorkspace projectId={state.activeProjectId} />}
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
                        {ready ? `已設定 ${providerCount} 個 AI 服務商` : '尚未配置 AI 服務商'}
                      </p>
                      <p className={`text-sm ${ready ? 'text-green-300' : 'text-yellow-300'}`}>
                        {ready
                          ? '設定已保存；這不代表已通過即時連線測試。'
                          : '請至下方完成 AI 服務商設定'}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })()}
            <p role='status' className='mb-6 text-sm text-gray-300'>
              {isOnline
                ? '裝置目前有網路連線；實際 AI 服務連線狀態請在服務商設定中測試。'
                : '目前沒有網路連線。仍可讀取這台裝置的資料；雲端 AI 需要恢復連線。'}{' '}
              瀏覽器資料不會自動同步到其他裝置，請匯出檔案另存備份。
            </p>
            <AppearanceSettings className='mb-6' />
            <button
              type='button'
              onClick={() => setOnboardingMode('open')}
              className='mb-6 min-h-11 rounded-lg border border-gray-500 px-4 py-2 text-gray-200'
            >
              重新開啟開始引導
            </button>

            <section
              className='mb-6 rounded-2xl border border-fuchsia-500/20 bg-fuchsia-500/5 p-5'
              aria-label='協作包本機統計'
            >
              <h3 className='text-xs font-semibold uppercase tracking-wide text-fuchsia-200'>
                協作包本機統計
              </h3>
              <p className='mt-1 text-xs text-gray-400'>只儲存在此瀏覽器，不會傳送到伺服器。</p>
              <dl className='mt-3 grid grid-cols-3 gap-3 text-center'>
                <div>
                  <dt className='text-xs text-gray-500'>成功匯入</dt>
                  <dd className='text-lg font-semibold text-white'>
                    {bundleMetrics.importSuccesses}
                  </dd>
                </div>
                <div>
                  <dt className='text-xs text-gray-500'>完成金鑰設定</dt>
                  <dd className='text-lg font-semibold text-white'>
                    {bundleMetrics.byokCompletions}
                  </dd>
                </div>
                <div>
                  <dt className='text-xs text-gray-500'>首次完成對話</dt>
                  <dd className='text-lg font-semibold text-white'>
                    {bundleMetrics.firstChatCompletions}
                  </dd>
                </div>
              </dl>
            </section>

            {/* 設定入口 */}
            <h3 className='text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3 px-1'>
              設定項目
            </h3>
            <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
              <button
                onClick={() => actions.openProviderSettings('settings')}
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
          <ProviderSettings onClose={actions.closeProviderSettings} />
        </div>
      )}

      {state.viewMode === 'bundle_import' && (
        <BundleImportPage
          onClose={() => actions.setViewMode(state.currentAssistant ? 'chat' : 'new_assistant')}
          onOpenBundle={() => undefined}
        />
      )}

      {state.viewMode === 'bundle_builder' && (
        <BundleBuilder
          assistants={state.assistants}
          onClose={() => actions.setViewMode(state.currentAssistant ? 'chat' : 'new_assistant')}
          onPreviewBundle={bundle => {
            actions.setBundleMode({ bundleId: `preview-${Date.now()}`, bundle });
          }}
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
        state.viewMode !== 'api_setup' &&
        state.viewMode !== 'bundle_import' &&
        state.viewMode !== 'bundle_builder' && (
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
