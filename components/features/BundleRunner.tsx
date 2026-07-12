import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChatContainer } from '../chat';
import { useAppContext } from '../core/useAppContext';
import { downloadBundleJson } from '../../services/agentBundleService';
import * as db from '../../services/db';
import { initializeProviders, isLLMAvailable } from '../../services/providerRegistry';
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
      const entryAgent = record.bundle.agents.find(
        agent => agent.id === record.bundle.manifest.entryAgentId,
      );
      if (!entryAgent) {
        dispatch({ type: 'SET_ERROR', payload: '協作包缺少接待入口助理。' });
        return;
      }

      const assistant = toAssistant(entryAgent, record.bundle, record.importedAt);
      const storedSessions = previewBundle ? [] : await db.getSessionsForAssistant(assistant.id);
      const sessions = storedSessions.sort((left, right) => right.createdAt - left.createdAt);
      const session =
        sessions[0] ??
        ({
          id: `bundle_${bundleId}_${Date.now()}`,
          assistantId: assistant.id,
          title: `與 ${assistant.name} 聊天`,
          messages: [],
          createdAt: Date.now(),
          tokenCount: 0,
          tokenUsage: undefined,
        } satisfies ChatSession);

      if (!previewBundle && sessions.length === 0) {
        await db.saveSession(session);
      }
      if (!previewBundle) {
        await db.saveBundle({ ...record, lastOpenedAt: Date.now() });
      }

      dispatch({ type: 'SET_CURRENT_ASSISTANT', payload: assistant });
      dispatch({ type: 'SET_SESSIONS', payload: sessions.length > 0 ? sessions : [session] });
      dispatch({ type: 'SET_CURRENT_SESSION', payload: session });

      await initializeProviders();
      dispatch({ type: 'SET_VIEW_MODE', payload: isLLMAvailable() ? 'chat' : 'provider_settings' });
    } catch (error) {
      console.error('Failed to load agent bundle:', error);
      dispatch({ type: 'SET_ERROR', payload: '無法載入協作包，請稍後再試。' });
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, [bundleId, dispatch, previewBundle]);

  useEffect(() => {
    void loadBundle();
  }, [loadBundle]);

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
    const assistant = state.currentAssistant;
    if (!assistant) {
      return;
    }

    const session: ChatSession = {
      id: `bundle_${bundleId}_${Date.now()}`,
      assistantId: assistant.id,
      title: `與 ${assistant.name} 聊天`,
      messages: [],
      createdAt: Date.now(),
      tokenCount: 0,
      tokenUsage: undefined,
    };
    if (!previewBundle) {
      await db.saveSession(session);
    }
    dispatch({ type: 'ADD_SESSION', payload: session });
  }, [bundleId, dispatch, previewBundle, state.currentAssistant]);

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
    if (!previewBundle) {
      await actions.updateSession(clearedSession);
    } else {
      dispatch({ type: 'UPDATE_SESSION', payload: clearedSession });
    }
    dispatch({ type: 'RESET_PROJECT_WORKSPACE' });
  }, [actions, dispatch, previewBundle, state.currentSession]);

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

  if (state.viewMode === 'provider_settings') {
    return null;
  }

  if (!state.currentAssistant || !state.currentSession) {
    return null;
  }

  const bundle = loadedBundle;
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
          返回精靈
        </button>
      )}
      <button
        type='button'
        onClick={() => void clearConversation()}
        className='rounded-lg border border-gray-600 px-3 py-2 text-sm text-gray-200 transition hover:bg-gray-700'
      >
        清除對話
      </button>
      <details className='relative'>
        <summary className='cursor-pointer rounded-lg border border-gray-600 px-3 py-2 text-sm text-gray-200'>
          包內容
        </summary>
        <div className='absolute right-0 z-20 mt-2 w-72 rounded-lg border border-gray-700 bg-gray-800 p-3 text-sm text-gray-300 shadow-xl'>
          <p className='font-medium text-white'>{bundle?.manifest.name ?? '協作包'}</p>
          <p className='mt-1'>{bundle?.manifest.description}</p>
          <p className='mt-2 text-xs text-gray-400'>接待入口：{state.currentAssistant.name}</p>
        </div>
      </details>
      {bundle && (
        <button
          type='button'
          onClick={() => downloadBundleJson(bundle)}
          className='rounded-lg border border-cyan-500/50 px-3 py-2 text-sm text-cyan-100 transition hover:bg-cyan-500/10'
        >
          重新匯出
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
        bundle
          ? bundle.routes
              .filter(route => route.fromAgentId === state.currentAssistant?.id)
              .map(route => bundle.agents.find(agent => agent.id === route.toAgentId))
              .filter((agent): agent is AgentBundleAgent => Boolean(agent))
              .map(({ id, name, description }) => ({ id, name, description }))
          : null
      }
      onAcceptRouteProposal={proposal =>
        completeBundleHandoff(state.currentSession as ChatSession, proposal, false).then(
          () => undefined,
        )
      }
      onDeclineRouteProposal={declineBundleProposal}
      onCreateSession={createSession}
      headerActions={headerActions}
    />
  );
};

export default BundleRunner;
