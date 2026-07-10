import React, { useCallback, useEffect, useRef } from 'react';
import { AppContext } from '../core/useAppContext';
import { initializeProviders, isLLMAvailable } from '../../services/providerRegistry';
import { getAssistantFromTurso } from '../../services/tursoService';
import { AppContextValue } from '../core/AppContext.types';
import { Assistant } from '../../types';

interface SharedAssistantProps {
  assistantId: string;
}

const SharedAssistant: React.FC<SharedAssistantProps> = ({ assistantId }) => {
  const { state, dispatch } = React.useContext(AppContext) as AppContextValue;
  const assistantIdRef = useRef<string | null>(null);
  const loadingRef = useRef(false);
  const loadedRef = useRef(false);

  const checkApiKey = useCallback(async () => {
    await initializeProviders();
    const needed = !isLLMAvailable();
    // Don't dispatch here - let the caller handle the viewMode setting
    return !needed;
  }, []);

  const loadSharedAssistant = useCallback(async () => {
    // A route changes assistantId without remounting this view; reset guards before checking them.
    if (assistantIdRef.current !== assistantId) {
      assistantIdRef.current = assistantId;
      loadingRef.current = false;
      loadedRef.current = false;
    }
    if (loadingRef.current || loadedRef.current) {
      console.log('⚠️ [SHARED ASSISTANT] Skipping duplicate load request');
      return;
    }

    loadingRef.current = true;
    dispatch({ type: 'SET_LOADING', payload: true });
    dispatch({ type: 'SET_ERROR', payload: null });

    try {
      if (!assistantId) {
        dispatch({ type: 'SET_ERROR', payload: '無效的助理 ID。' });
        return;
      }

      console.log('🔄 [SHARED ASSISTANT] Loading assistant:', assistantId);
      const tursoAssistant = await getAssistantFromTurso(assistantId);

      if (!tursoAssistant) {
        dispatch({ type: 'SET_ERROR', payload: '找不到助理或無法分享。' });
        return;
      }

      const assistant: Assistant = {
        ...tursoAssistant,
        ragChunks: tursoAssistant.ragChunks || [],
      };

      dispatch({ type: 'SET_CURRENT_ASSISTANT', payload: assistant });
      console.log('📋 [SHARED ASSISTANT] Assistant set:', assistant);

      const pendingSession = state.pendingHandoffSession;
      const newSession =
        pendingSession?.assistantId === tursoAssistant.id
          ? pendingSession
          : {
              id: `shared_${Date.now()}`,
              assistantId: tursoAssistant.id,
              title: `與 ${tursoAssistant.name} 聊天`,
              messages: [],
              createdAt: Date.now(),
              tokenCount: 0,
              tokenUsage: undefined,
            };

      dispatch({ type: 'SET_CURRENT_SESSION', payload: newSession });
      if (pendingSession?.assistantId === tursoAssistant.id) {
        dispatch({ type: 'SET_PENDING_HANDOFF_SESSION', payload: null });
      }
      console.log('💬 [SHARED ASSISTANT] Session set:', newSession);

      const hasValidKeys = await checkApiKey();

      if (hasValidKeys) {
        console.log('🎯 [SHARED ASSISTANT] Valid API keys available, setting chat mode');
        dispatch({ type: 'SET_VIEW_MODE', payload: 'chat' });
      } else {
        console.log('⚠️ [SHARED ASSISTANT] No valid API keys, setting provider_settings mode');
        dispatch({ type: 'SET_VIEW_MODE', payload: 'provider_settings' });
      }

      loadedRef.current = true;
      console.log('✅ [SHARED ASSISTANT] Successfully loaded assistant');
    } catch (err) {
      console.error('❌ [SHARED ASSISTANT] Failed to load assistant:', err);
      dispatch({ type: 'SET_ERROR', payload: '無法載入分享的助理。請檢查連結或稍後重試。' });
    } finally {
      loadingRef.current = false;
      dispatch({ type: 'SET_LOADING', payload: false });
      console.log('🔄 [SHARED ASSISTANT] Loading state cleared');
    }
  }, [assistantId, checkApiKey, dispatch, state.pendingHandoffSession]);

  useEffect(() => {
    if (assistantId) {
      loadSharedAssistant();
    }
  }, [assistantId, loadSharedAssistant]);

  // This is a view component, so it doesn't render anything itself
  return null;
};

export default SharedAssistant;
