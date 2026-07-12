import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChatContainer } from '../chat';
import { useAppContext } from '../core/useAppContext';
import { downloadBundleJson } from '../../services/agentBundleService';
import * as db from '../../services/db';
import { initializeProviders, isLLMAvailable } from '../../services/providerRegistry';
import type { AgentBundle, AgentBundleAgent, Assistant, ChatSession } from '../../types';

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
  const [loadedBundle, setLoadedBundle] = useState<AgentBundle | null>(previewBundle ?? null);

  const loadBundle = useCallback(async () => {
    if (loadedBundleIdRef.current === bundleId) {
      return;
    }

    loadedBundleIdRef.current = bundleId;
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
        if (previewBundle) {
          dispatch({ type: 'UPDATE_SESSION', payload: session });
          return;
        }
        await actions.updateSession(session);
      }}
      sandboxMode
      assistantDescription={state.currentAssistant.description}
      starterPrompts={state.currentAssistant.starterPrompts ?? []}
      subagentDelegationEnabled={false}
      onCreateSession={createSession}
      headerActions={headerActions}
    />
  );
};

export default BundleRunner;
