import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChatContainer } from '../chat';
import { useAppContext } from '../core/useAppContext';
import { downloadBundleJson } from '../../services/agentBundleService';
import { bundleStrings } from '../bundle/bundleStrings';
import { resolveBundleRoutableTargets } from '../../services/assistantRoutingService';
import { recordBundleFirstChatCompletion } from '../../services/bundleMetricsService';
import * as db from '../../services/db';
import {
  initializeProviders,
  isLLMAvailable,
  providerManager,
} from '../../services/providerRegistry';
import {
  BUNDLE_PROVIDER_CREDENTIALS_ERROR,
  decryptBundleProviderCredentials,
  type BundleProviderCredentials,
} from '../../services/bundleProviderCredentialsService';
import type { BundleProviderOverrideSource } from '../../services/llmAdapter';
import type {
  AgentBundle,
  AgentBundleAgent,
  Assistant,
  ChatSession,
  RouteProposal,
} from '../../types';

interface BundleRunnerProps {
  bundleId: string;
  /** An unsaved bundle may be supplied by the builder preview. */
  bundle?: AgentBundle;
}

const toAssistant = (
  agent: AgentBundleAgent,
  bundle: AgentBundle,
  createdAt: number,
): Assistant => ({
  id: agent.id,
  name: agent.name,
  description: agent.description,
  systemPrompt: agent.systemPrompt,
  starterPrompts: agent.starterPrompts,
  ragChunks: agent.ragChunks,
  createdAt,
  subagentDelegationEnabled: false,
  routableAssistantIds: bundle.routes
    .filter(route => route.fromAgentId === agent.id)
    .map(route => route.toAgentId),
});

const BundleRunner: React.FC<BundleRunnerProps> = ({ bundleId, bundle: previewBundle }) => {
  const { state, dispatch, actions } = useAppContext();
  const loadedBundleIdRef = useRef<string | null>(null);
  const processedAutoHandoffsRef = useRef(new Set<string>());
  const [loadedBundle, setLoadedBundle] = useState<AgentBundle | null>(previewBundle ?? null);
  const [credentialAccess, setCredentialAccess] = useState<'pending' | 'bundle' | 'own'>('pending');
  const [unlockStage, setUnlockStage] = useState<'locked' | 'preview'>('locked');
  const [unlockPassword, setUnlockPassword] = useState('');
  const [decryptedCredentials, setDecryptedCredentials] =
    useState<BundleProviderCredentials | null>(null);
  const [credentialError, setCredentialError] = useState<string | null>(null);
  const bundleOverrideSourceRef = useRef<BundleProviderOverrideSource | null>(null);

  const clearCredentialState = useCallback(() => {
    setUnlockPassword('');
    setDecryptedCredentials(null);
    setCredentialError(null);
    setUnlockStage('locked');
  }, []);

  const clearBundleOverride = useCallback(async () => {
    const source = bundleOverrideSourceRef.current;
    if (!source) {
      return;
    }

    bundleOverrideSourceRef.current = null;
    await providerManager.clearBundleProviderConfig(source);
  }, []);

  useEffect(() => {
    loadedBundleIdRef.current = null;
    setCredentialAccess('pending');
    clearCredentialState();
  }, [bundleId, clearCredentialState]);

  useEffect(() => {
    return () => {
      clearCredentialState();
      void clearBundleOverride();
    };
  }, [bundleId, clearBundleOverride, clearCredentialState]);

  const loadBundle = useCallback(async () => {
    if (loadedBundleIdRef.current === bundleId) {
      return;
    }

    loadedBundleIdRef.current = bundleId;
    processedAutoHandoffsRef.current.clear();
    dispatch({ type: 'SET_LOADING', payload: true });
    dispatch({ type: 'SET_ERROR', payload: null });
    dispatch({ type: 'RESET_PROJECT_WORKSPACE' });

    try {
      const record = previewBundle
        ? { id: bundleId, bundle: previewBundle, importedAt: Date.now(), sizeBytes: 0 }
        : await db.getBundle(bundleId);
      if (!record) {
        dispatch({ type: 'SET_ERROR', payload: '找不到協作包，請重新匯入後再開啟。' });
        return;
      }

      setLoadedBundle(record.bundle);
      if (
        record.bundle.manifest.schemaVersion === 2 &&
        record.bundle.encryptedProviderSettings &&
        credentialAccess === 'pending'
      ) {
        return;
      }

      const entryAgent = record.bundle.agents.find(
        agent => agent.id === record.bundle.manifest.entryAgentId,
      );
      if (!entryAgent) {
        dispatch({ type: 'SET_ERROR', payload: '協作包缺少接待入口助理。' });
        return;
      }

      const storedSessions = previewBundle
        ? []
        : (
            await Promise.all(
              record.bundle.agents.map(agent => db.getSessionsForAssistant(agent.id)),
            )
          ).flat();
      const sessions = [
        ...new Map(storedSessions.map(session => [session.id, session])).values(),
      ].sort(
        (left, right) => (right.updatedAt ?? right.createdAt) - (left.updatedAt ?? left.createdAt),
      );
      const restoredEntrySession = sessions.find(session => session.assistantId === entryAgent.id);
      const assistant = toAssistant(entryAgent, record.bundle, record.importedAt);
      const session =
        restoredEntrySession ??
        ({
          id: `bundle_${bundleId}_${Date.now()}`,
          assistantId: assistant.id,
          title: `與 ${assistant.name} 聊天`,
          messages: [],
          createdAt: Date.now(),
          tokenCount: 0,
          tokenUsage: undefined,
        } satisfies ChatSession);

      if (!previewBundle && !restoredEntrySession) {
        await db.saveSession(session);
      }
      if (!previewBundle) {
        await db.saveBundle({ ...record, lastOpenedAt: Date.now() });
      }

      dispatch({ type: 'SET_CURRENT_ASSISTANT', payload: assistant });
      dispatch({
        type: 'SET_SESSIONS',
        payload: restoredEntrySession ? sessions : [session, ...sessions],
      });
      dispatch({ type: 'SET_CURRENT_SESSION', payload: session });

      if (credentialAccess !== 'bundle') {
        await initializeProviders();
      }
      dispatch({ type: 'SET_VIEW_MODE', payload: isLLMAvailable() ? 'chat' : 'provider_settings' });
    } catch (error) {
      console.error('Failed to load agent bundle:', error);
      dispatch({ type: 'SET_ERROR', payload: '無法載入協作包，請稍後再試。' });
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, [bundleId, credentialAccess, dispatch, previewBundle]);

  useEffect(() => {
    void loadBundle();
  }, [loadBundle]);

  const handleUnlock = useCallback(async () => {
    if (!loadedBundle || !unlockPassword) {
      setCredentialError('請輸入協作包密碼。');
      return;
    }

    setCredentialError(null);
    try {
      const credentials = await decryptBundleProviderCredentials(
        loadedBundle,
        unlockPassword,
        previewBundle ? undefined : bundleId,
      );
      setUnlockPassword('');
      setDecryptedCredentials(credentials);
      setUnlockStage('preview');
    } catch {
      setUnlockPassword('');
      setDecryptedCredentials(null);
      setCredentialError(BUNDLE_PROVIDER_CREDENTIALS_ERROR);
    }
  }, [bundleId, loadedBundle, previewBundle, unlockPassword]);

  const handleConfirmBundleCredentials = useCallback(async () => {
    if (!decryptedCredentials) {
      return;
    }

    setCredentialError(null);
    try {
      await initializeProviders();
      const source: BundleProviderOverrideSource = {
        kind: 'bundle',
        bundleId,
        credentialFingerprint: decryptedCredentials.credentialFingerprint,
      };
      await providerManager.setBundleProviderConfig(
        source,
        decryptedCredentials.provider,
        decryptedCredentials.config,
      );
      bundleOverrideSourceRef.current = source;
      clearCredentialState();
      loadedBundleIdRef.current = null;
      setCredentialAccess('bundle');
    } catch {
      clearCredentialState();
      setCredentialError('無法啟用隨附服務商設定。請改用自己的 AI 服務商。');
    }
  }, [bundleId, clearCredentialState, decryptedCredentials]);

  const handleUseOwnProvider = useCallback(async () => {
    clearCredentialState();
    await clearBundleOverride();
    loadedBundleIdRef.current = null;
    setCredentialAccess('own');
  }, [clearBundleOverride, clearCredentialState]);

  const persistBundleSession = useCallback(
    async (session: ChatSession) => {
      if (previewBundle) {
        dispatch({ type: 'UPDATE_SESSION', payload: session });
        return;
      }
      await actions.updateSession(session);
    },
    [actions, dispatch, previewBundle],
  );

  const completeBundleHandoff = useCallback(
    async (
      sourceSession: ChatSession,
      proposal: RouteProposal,
      automatic: boolean,
    ): Promise<boolean> => {
      const bundle = loadedBundle;
      const targetAgent = bundle?.agents.find(agent => agent.id === proposal.targetAssistantId);
      const validRoute = bundle?.routes.some(
        route =>
          route.fromAgentId === sourceSession.assistantId &&
          route.toAgentId === proposal.targetAssistantId,
      );
      if (
        !bundle ||
        !targetAgent ||
        !validRoute ||
        proposal.sourceAssistantId !== sourceSession.assistantId ||
        proposal.sourceSessionId !== sourceSession.id ||
        proposal.status !== 'pending'
      ) {
        return false;
      }

      const expectedKickoffMessages = sourceSession.handoffContext ? 1 : 0;
      const hasInterveningUserMessage =
        sourceSession.messages.filter(message => message.role === 'user').length >
        expectedKickoffMessages;
      const automaticHandoffCount = hasInterveningUserMessage
        ? 0
        : (sourceSession.handoffContext?.automaticHandoffCount ?? 0);
      if (automatic && automaticHandoffCount >= 3) {
        return false;
      }

      const acceptedSourceSession: ChatSession = {
        ...sourceSession,
        messages: sourceSession.messages.map(message =>
          message.routeProposal?.createdAt === proposal.createdAt &&
          message.routeProposal.sourceSessionId === proposal.sourceSessionId
            ? {
                ...message,
                routeProposal: { ...message.routeProposal, status: 'accepted', automatic },
              }
            : message,
        ),
        updatedAt: Date.now(),
      };
      await persistBundleSession(acceptedSourceSession);

      const createdAt = Date.now();
      const targetSession: ChatSession = {
        id: `bundle_${bundleId}_${targetAgent.id}_${createdAt}`,
        assistantId: targetAgent.id,
        title: `與 ${targetAgent.name} 聊天`,
        messages: [],
        createdAt,
        tokenCount: 0,
        tokenUsage: undefined,
        handoffContext: {
          fromAssistantId: proposal.sourceAssistantId,
          fromAssistantName:
            bundle.agents.find(agent => agent.id === sourceSession.assistantId)?.name ??
            proposal.sourceAssistantId,
          reason: proposal.reason,
          summary: proposal.handoffSummary,
          sourceSessionId: sourceSession.id,
          automaticHandoffCount: automatic ? automaticHandoffCount + 1 : undefined,
          createdAt,
        },
      };
      if (!previewBundle) {
        await db.saveSession(targetSession);
      }
      dispatch({
        type: 'SET_CURRENT_ASSISTANT',
        payload: toAssistant(targetAgent, bundle, createdAt),
      });
      dispatch({ type: 'ADD_SESSION', payload: targetSession });
      return true;
    },
    [bundleId, dispatch, loadedBundle, persistBundleSession, previewBundle],
  );

  const declineBundleProposal = useCallback(
    async (proposal: RouteProposal) => {
      const sourceSession = state.currentSession;
      if (!sourceSession || proposal.sourceSessionId !== sourceSession.id) {
        return;
      }
      await persistBundleSession({
        ...sourceSession,
        messages: sourceSession.messages.map(message =>
          message.routeProposal?.createdAt === proposal.createdAt &&
          message.routeProposal.sourceSessionId === proposal.sourceSessionId
            ? { ...message, routeProposal: { ...message.routeProposal, status: 'declined' } }
            : message,
        ),
        updatedAt: Date.now(),
      });
    },
    [persistBundleSession, state.currentSession],
  );

  const createSession = useCallback(async () => {
    const bundle = loadedBundle;
    const entryAgent = bundle?.agents.find(agent => agent.id === bundle.manifest.entryAgentId);
    if (!bundle || !entryAgent) {
      return;
    }

    const createdAt = Date.now();
    const assistant = toAssistant(entryAgent, bundle, createdAt);
    const session: ChatSession = {
      id: `bundle_${bundleId}_${createdAt}`,
      assistantId: assistant.id,
      title: `與 ${assistant.name} 聊天`,
      messages: [],
      createdAt,
      tokenCount: 0,
      tokenUsage: undefined,
    };
    if (!previewBundle) {
      await db.saveSession(session);
    }
    dispatch({ type: 'SET_CURRENT_ASSISTANT', payload: assistant });
    dispatch({ type: 'ADD_SESSION', payload: session });
  }, [bundleId, dispatch, loadedBundle, previewBundle]);

  const clearConversation = useCallback(async () => {
    const session = state.currentSession;
    if (!session || !window.confirm('確定要清除目前的對話內容嗎？')) {
      return;
    }

    const clearedSession: ChatSession = {
      ...session,
      messages: [],
      tokenCount: 0,
      tokenUsage: undefined,
      activeProjectId: null,
      updatedAt: Date.now(),
    };
    await persistBundleSession(clearedSession);
    dispatch({ type: 'RESET_PROJECT_WORKSPACE' });
  }, [dispatch, persistBundleSession, state.currentSession]);

  const bundleSessions = useMemo(() => {
    if (previewBundle) {
      return state.sessions;
    }
    const prefix = `${bundleId}:`;
    return state.sessions
      .filter(session => session.assistantId.startsWith(prefix))
      .sort(
        (left, right) => (right.updatedAt ?? right.createdAt) - (left.updatedAt ?? left.createdAt),
      );
  }, [bundleId, previewBundle, state.sessions]);

  const resumeSession = useCallback(
    (session: ChatSession) => {
      const agent = loadedBundle?.agents.find(a => a.id === session.assistantId);
      if (agent) {
        dispatch({
          type: 'SET_CURRENT_ASSISTANT',
          payload: toAssistant(
            agent,
            loadedBundle!,
            loadedBundle?.manifest.exportedAt ?? Date.now(),
          ),
        });
      }
      dispatch({ type: 'SET_CURRENT_SESSION', payload: session });
    },
    [dispatch, loadedBundle],
  );

  const deleteSessionById = useCallback(
    async (sessionId: string) => {
      if (!window.confirm(bundleStrings.sandbox.confirmDeleteSession)) {
        return;
      }

      const remainingSessions = bundleSessions.filter(session => session.id !== sessionId);
      if (!previewBundle) {
        await actions.deleteSession(sessionId, { externallyManaged: true });
      }
      dispatch({ type: 'SET_SESSIONS', payload: remainingSessions });

      if (state.currentSession?.id !== sessionId) {
        return;
      }

      const nextSession = remainingSessions[0];
      if (nextSession) {
        resumeSession(nextSession);
      } else {
        await createSession();
      }
    },
    [
      actions,
      bundleSessions,
      createSession,
      dispatch,
      previewBundle,
      resumeSession,
      state.currentSession?.id,
    ],
  );

  if (state.isLoading) {
    return (
      <div className='flex h-full items-center justify-center text-gray-400'>載入協作包中...</div>
    );
  }

  if (state.error) {
    return (
      <div className='flex h-full items-center justify-center p-8 text-center text-red-300'>
        {state.error}
      </div>
    );
  }

  const protectedBundle =
    loadedBundle?.manifest.schemaVersion === 2 && Boolean(loadedBundle.encryptedProviderSettings);
  if (protectedBundle && credentialAccess === 'pending') {
    return (
      <div className='mx-auto flex h-full max-w-xl items-center p-6'>
        <section
          aria-label='受保護協作包解鎖'
          className='w-full rounded-2xl border border-fuchsia-700/50 bg-gray-800/70 p-6 shadow-xl'
        >
          <h2 className='text-xl font-bold text-white'>此協作包包含受保護的服務商設定</h2>
          <p className='mt-2 text-sm text-gray-400'>
            請輸入創作者另行提供的密碼以預覽設定，確認後才會在本次執行期間使用。也可明確改用自己的
            AI 服務商。
          </p>
          {unlockStage === 'locked' ? (
            <>
              <label
                className='mt-5 block text-sm font-medium text-gray-300'
                htmlFor='bundle-unlock-password'
              >
                協作包密碼
              </label>
              <input
                id='bundle-unlock-password'
                type='password'
                value={unlockPassword}
                onChange={event => setUnlockPassword(event.target.value)}
                className='mt-2 w-full rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-fuchsia-400 focus:outline-none'
              />
              {credentialError && (
                <p role='alert' className='mt-3 text-sm text-red-200'>
                  {credentialError}
                </p>
              )}
              <div className='mt-5 flex flex-col gap-2 sm:flex-row'>
                <button
                  type='button'
                  onClick={() => void handleUnlock()}
                  disabled={!unlockPassword}
                  className='min-h-11 flex-1 rounded-lg bg-fuchsia-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-fuchsia-500 disabled:cursor-not-allowed disabled:opacity-50'
                >
                  解鎖並預覽
                </button>
                <button
                  type='button'
                  onClick={() => void handleUseOwnProvider()}
                  className='min-h-11 flex-1 rounded-lg border border-gray-600 px-4 py-2 text-sm text-gray-100 transition hover:bg-gray-700'
                >
                  改用自己的 AI 服務商
                </button>
              </div>
            </>
          ) : (
            <div className='mt-5 rounded-xl border border-fuchsia-700/40 bg-fuchsia-900/20 p-4'>
              <p className='text-sm text-fuchsia-100'>
                已解鎖服務商：{decryptedCredentials?.provider ?? '—'}
              </p>
              <p className='mt-1 text-xs text-gray-300'>
                模型：{decryptedCredentials?.config.model ?? '—'}
              </p>
              {decryptedCredentials?.config.baseUrl && (
                <p className='mt-1 break-all text-xs text-gray-300'>
                  端點：{decryptedCredentials.config.baseUrl}
                </p>
              )}
              <p className='mt-2 text-xs text-gray-300'>金鑰不會顯示，也不會寫入瀏覽器儲存空間。</p>
              {credentialError && (
                <p role='alert' className='mt-3 text-sm text-red-200'>
                  {credentialError}
                </p>
              )}
              <div className='mt-4 flex flex-col gap-2 sm:flex-row'>
                <button
                  type='button'
                  onClick={() => void handleConfirmBundleCredentials()}
                  className='min-h-11 flex-1 rounded-lg bg-fuchsia-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-fuchsia-500'
                >
                  確認使用隨附設定
                </button>
                <button
                  type='button'
                  onClick={clearCredentialState}
                  className='min-h-11 flex-1 rounded-lg border border-gray-600 px-4 py-2 text-sm text-gray-100 transition hover:bg-gray-700'
                >
                  取消
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    );
  }

  if (state.viewMode === 'provider_settings') {
    return null;
  }

  if (!state.currentAssistant || !state.currentSession) {
    return null;
  }

  const bundle = loadedBundle;
  const entryAssistant = bundle?.agents.find(agent => agent.id === bundle.manifest.entryAgentId);
  const headerActions = (
    <div className='flex items-center gap-2'>
      {previewBundle && (
        <button
          type='button'
          onClick={() => {
            dispatch({ type: 'SET_BUNDLE_MODE', payload: null });
            dispatch({ type: 'SET_VIEW_MODE', payload: 'bundle_builder' });
          }}
          className='rounded-lg border border-fuchsia-500/50 px-3 py-2 text-sm text-fuchsia-100 transition hover:bg-fuchsia-500/10'
        >
          {bundleStrings.sandbox.backToWizard}
        </button>
      )}
      <button
        type='button'
        onClick={() => void clearConversation()}
        className='rounded-lg border border-gray-600 px-3 py-2 text-sm text-gray-200 transition hover:bg-gray-700'
      >
        {bundleStrings.sandbox.clearConversation}
      </button>
      <details className='relative'>
        <summary className='cursor-pointer rounded-lg border border-gray-600 px-3 py-2 text-sm text-gray-200'>
          {bundleStrings.sandbox.sessionList}
        </summary>
        <div className='absolute right-0 z-20 mt-2 w-80 rounded-lg border border-gray-700 bg-gray-800 p-3 text-sm text-gray-300 shadow-xl'>
          {bundleSessions.length === 0 ? (
            <p className='text-gray-500'>目前沒有其他對話紀錄。</p>
          ) : (
            <ul className='max-h-72 space-y-1 overflow-y-auto'>
              {bundleSessions.map(session => (
                <li
                  key={session.id}
                  className='flex items-center justify-between gap-2 rounded-md p-1 hover:bg-gray-700/40'
                >
                  <button
                    type='button'
                    onClick={() => resumeSession(session)}
                    className='min-w-0 flex-1 truncate text-left text-gray-200 hover:text-cyan-200'
                    aria-label={bundleStrings.sandbox.resumeSession(session.title)}
                  >
                    {session.title}
                  </button>
                  <button
                    type='button'
                    onClick={() => void deleteSessionById(session.id)}
                    aria-label={bundleStrings.sandbox.deleteSession}
                    className='rounded border border-red-700/50 px-2 py-0.5 text-xs text-red-200 hover:bg-red-900/30'
                  >
                    刪除
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>
      <details className='relative'>
        <summary className='cursor-pointer rounded-lg border border-gray-600 px-3 py-2 text-sm text-gray-200'>
          {bundleStrings.sandbox.bundleDetails}
        </summary>
        <div className='absolute right-0 z-20 mt-2 w-72 rounded-lg border border-gray-700 bg-gray-800 p-3 text-sm text-gray-300 shadow-xl'>
          <p className='font-medium text-white'>{bundle?.manifest.name ?? '協作包'}</p>
          <p className='mt-1'>{bundle?.manifest.description}</p>
          <p className='mt-2 text-xs text-gray-400'>接待入口：{entryAssistant?.name ?? '—'}</p>
        </div>
      </details>
      {bundle && (
        <button
          type='button'
          onClick={() => downloadBundleJson(bundle)}
          className='rounded-lg border border-cyan-500/50 px-3 py-2 text-sm text-cyan-100 transition hover:bg-cyan-500/10'
        >
          {bundleStrings.sandbox.reExport}
        </button>
      )}
    </div>
  );

  return (
    <ChatContainer
      session={state.currentSession}
      assistantName={state.currentAssistant.name}
      systemPrompt={state.currentAssistant.systemPrompt}
      assistantId={state.currentAssistant.id}
      ragChunks={state.currentAssistant.ragChunks ?? []}
      onNewMessage={async session => {
        await persistBundleSession(session);

        const latestMessage = session.messages.at(-1);
        if (
          !previewBundle &&
          latestMessage?.role === 'model' &&
          session.messages.some(message => message.role === 'user')
        ) {
          recordBundleFirstChatCompletion(session.id);
        }
        const proposal = latestMessage?.routeProposal;
        if (latestMessage?.role !== 'model' || !proposal || proposal.status !== 'pending') {
          return;
        }
        const proposalKey = `${proposal.sourceSessionId}:${proposal.createdAt}`;
        if (processedAutoHandoffsRef.current.has(proposalKey)) {
          return;
        }
        processedAutoHandoffsRef.current.add(proposalKey);
        await completeBundleHandoff(session, proposal, true);
      }}
      sandboxMode
      assistantDescription={state.currentAssistant.description}
      starterPrompts={state.currentAssistant.starterPrompts ?? []}
      subagentDelegationEnabled={false}
      routableTargetsOverride={
        bundle ? resolveBundleRoutableTargets(bundle, state.currentAssistant.id) : null
      }
      onAcceptRouteProposal={async proposal => {
        await completeBundleHandoff(state.currentSession as ChatSession, proposal, false);
      }}
      onDeclineRouteProposal={declineBundleProposal}
      onCreateSession={createSession}
      headerActions={headerActions}
    />
  );
};

export default BundleRunner;
