import React, { useReducer, useCallback, useEffect } from 'react';
import { AgentRunState, Assistant, ChatSession, EmbeddingConfig, RouteProposal } from '../../types';
import * as db from '../../services/db';
import { initializeProviders } from '../../services/providerRegistry';
import {
  getAssistantFromTurso,
  initializeDatabase,
  canWriteToTurso,
} from '../../services/tursoService';
import { resolveShortUrl, recordShortUrlClick } from '../../services/shortUrlService';
import { htmlPreviewService } from '../../services/htmlPreviewService';
import {
  deleteForSession as deleteRunCheckpointsForSession,
  sweepStale as sweepStaleRunCheckpoints,
} from '../../services/agentRunCheckpointService';
import { htmlProjectStore } from '../../services/htmlProjectStore';
import { htmlProjectImportService } from '../../services/htmlProjectImportService';
import { importAssistantPackageFile } from '../../services/assistantPackageService';
import { getTemplateFiles } from '../../services/htmlProjectTemplates';
import { AppContext } from './useAppContext';
import type { ViewMode, AppState, AppAction, AppContextValue } from './AppContext.types';

// Load embedding config from localStorage
const loadEmbeddingConfig = (): EmbeddingConfig => {
  try {
    const saved = localStorage.getItem('embeddingConfig');
    if (saved) {
      return {
        ...{ timeoutSeconds: 5, fallbackToSimple: true, showMethodUsed: false },
        ...JSON.parse(saved),
      };
    }
  } catch (error) {
    console.warn('Failed to load embedding config from localStorage:', error);
  }
  return {
    timeoutSeconds: 5,
    fallbackToSimple: true,
    showMethodUsed: false,
  };
};

// Load desktop sidebar collapse preference from localStorage (default: expanded)
const loadSidebarCollapsed = (): boolean => {
  try {
    return localStorage.getItem('sidebarCollapsed') === 'true';
  } catch (error) {
    console.warn('Failed to load sidebarCollapsed from localStorage:', error);
    return false;
  }
};

const initialState: AppState = {
  assistants: [],
  currentAssistant: null,
  sessions: [],
  currentSession: null,
  viewMode: 'chat',
  isLoading: true, // Keep loading until we determine shared mode
  error: null,
  isShared: null, // Changed to null to indicate "not yet determined"
  sharedAssistantId: null,
  bundleMode: null,
  isSidebarOpen: true,
  isSidebarCollapsed: loadSidebarCollapsed(),
  isMobile: false,
  isTablet: false,
  isModelLoading: false,
  modelLoadingProgress: null,
  isShareModalOpen: false,
  assistantToShare: null,
  embeddingConfig: loadEmbeddingConfig(),
  activeProjectId: null,
  isProjectWorkspaceOpen: false,
  projectPreview: null,
  projectToolActivity: [],
  agentRunState: null,
  pendingHandoffSession: null,
};

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_ACTIVE_PROVIDER':
      return { ...state, currentProvider: action.payload };
    case 'SET_ASSISTANTS':
      return { ...state, assistants: action.payload };
    case 'SET_CURRENT_ASSISTANT':
      return { ...state, currentAssistant: action.payload };
    case 'SET_SESSIONS':
      return { ...state, sessions: action.payload };
    case 'SET_CURRENT_SESSION':
      return { ...state, currentSession: action.payload };
    case 'SET_VIEW_MODE':
      return { ...state, viewMode: action.payload };
    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };
    case 'SET_ERROR':
      return { ...state, error: action.payload };
    case 'SET_SHARED_MODE':
      return {
        ...state,
        isShared: action.payload.isShared,
        sharedAssistantId: action.payload.assistantId,
      };
    case 'SET_BUNDLE_MODE':
      return { ...state, bundleMode: action.payload };
    case 'SET_SIDEBAR_OPEN':
      return { ...state, isSidebarOpen: action.payload };
    case 'SET_SIDEBAR_COLLAPSED':
      return { ...state, isSidebarCollapsed: action.payload };
    case 'SET_SCREEN_SIZE':
      return {
        ...state,
        isMobile: action.payload.isMobile,
        isTablet: action.payload.isTablet,
      };
    case 'SET_MODEL_LOADING':
      return {
        ...state,
        isModelLoading: action.payload.isLoading,
        modelLoadingProgress: action.payload.progress || null,
      };
    case 'SET_SHARE_MODAL':
      return {
        ...state,
        isShareModalOpen: action.payload.isOpen,
        assistantToShare: action.payload.assistant || null,
      };
    case 'ADD_SESSION':
      return {
        ...state,
        sessions: [action.payload, ...state.sessions],
        currentSession: action.payload,
      };
    case 'UPDATE_SESSION':
      return {
        ...state,
        sessions: state.sessions.map(s => (s.id === action.payload.id ? action.payload : s)),
        currentSession:
          state.currentSession?.id === action.payload.id ? action.payload : state.currentSession,
      };
    case 'DELETE_SESSION': {
      const remainingSessions = state.sessions.filter(s => s.id !== action.payload);
      return {
        ...state,
        sessions: remainingSessions,
        currentSession:
          state.currentSession?.id === action.payload
            ? remainingSessions.length > 0
              ? remainingSessions[0]
              : null
            : state.currentSession,
      };
    }
    case 'DELETE_ASSISTANT': {
      const remainingAssistants = state.assistants.filter(a => a.id !== action.payload);
      return {
        ...state,
        assistants: remainingAssistants,
        currentAssistant:
          state.currentAssistant?.id === action.payload ? null : state.currentAssistant,
        sessions: state.currentAssistant?.id === action.payload ? [] : state.sessions,
        currentSession: state.currentAssistant?.id === action.payload ? null : state.currentSession,
      };
    }
    case 'SET_EMBEDDING_CONFIG':
      return {
        ...state,
        embeddingConfig: action.payload,
      };
    case 'SET_ACTIVE_PROJECT':
      return {
        ...state,
        activeProjectId: action.payload,
      };
    case 'SET_PROJECT_WORKSPACE_OPEN':
      return {
        ...state,
        isProjectWorkspaceOpen: action.payload,
      };
    case 'SET_PROJECT_PREVIEW':
      return {
        ...state,
        projectPreview: action.payload,
      };
    case 'APPEND_PROJECT_ACTIVITY':
      return {
        ...state,
        projectToolActivity: [...state.projectToolActivity, action.payload].slice(-20),
      };
    case 'CLEAR_PROJECT_ACTIVITY':
      return {
        ...state,
        projectToolActivity: [],
      };
    case 'RESET_PROJECT_WORKSPACE':
      return {
        ...state,
        activeProjectId: null,
        isProjectWorkspaceOpen: false,
        projectPreview: null,
        projectToolActivity: [],
        agentRunState: null,
      };
    case 'SET_AGENT_RUN_STATE':
      return {
        ...state,
        agentRunState: action.payload,
      };
    case 'SET_PENDING_HANDOFF_SESSION':
      return { ...state, pendingHandoffSession: action.payload };
    default:
      return state;
  }
}

interface AppProviderProps {
  children: React.ReactNode;
}

export function AppProvider({ children }: AppProviderProps): React.JSX.Element {
  const [state, dispatch] = useReducer(appReducer, initialState);

  // Create new session
  const createNewSession = useCallback(
    async (assistantId: string, handoffContext?: ChatSession['handoffContext']) => {
      const newSession: ChatSession = {
        id: `session-${Date.now()}`,
        assistantId,
        title: 'New Chat',
        messages: [],
        createdAt: Date.now(),
        tokenCount: 0,
        tokenUsage: undefined,
        handoffContext,
      };
      await db.saveSession(newSession);
      dispatch({ type: 'ADD_SESSION', payload: newSession });
      // 自動設置為當前會話
      dispatch({ type: 'SET_CURRENT_SESSION', payload: newSession });
      return newSession;
    },
    [],
  );

  // Select an assistant
  const selectAssistant = useCallback(
    async (assistantId: string, changeView = true) => {
      const assistant = await db.getAssistant(assistantId);
      if (assistant) {
        dispatch({ type: 'SET_CURRENT_ASSISTANT', payload: { ...assistant } });
        const assistantSessions = await db.getSessionsForAssistant(assistant.id);
        const sortedSessions = assistantSessions.sort((a, b) => b.createdAt - a.createdAt);
        dispatch({ type: 'SET_SESSIONS', payload: sortedSessions });

        if (sortedSessions.length > 0) {
          dispatch({ type: 'SET_CURRENT_SESSION', payload: sortedSessions[0] });
        } else {
          await createNewSession(assistant.id);
        }

        if (changeView) {
          dispatch({ type: 'SET_VIEW_MODE', payload: 'chat' });
        }
      }
    },
    [createNewSession],
  );

  // Load data from database
  const loadData = useCallback(async () => {
    // Only load data if we're definitely not in shared mode
    if (state.isShared === null || state.isShared === true || state.bundleMode) {
      return;
    }

    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      // Initialize Turso database if we have write access
      if (canWriteToTurso()) {
        try {
          await initializeDatabase();
          console.log('✅ Turso database initialized successfully');
        } catch (error) {
          console.warn('⚠️ Failed to initialize Turso database:', error);
          // Continue without Turso functionality
        }
      }

      await sweepStaleRunCheckpoints();
      const storedAssistants = await db.getAllAssistants();
      dispatch({
        type: 'SET_ASSISTANTS',
        payload: storedAssistants.sort((a, b) => b.createdAt - a.createdAt),
      });

      // Initialize providers asynchronously
      initializeProviders().catch(error => {
        console.error('Failed to initialize providers:', error);
      });

      if (storedAssistants.length > 0) {
        await selectAssistant(storedAssistants[0].id);
      } else {
        dispatch({ type: 'SET_VIEW_MODE', payload: 'new_assistant' });
      }
    } catch (e) {
      dispatch({ type: 'SET_ERROR', payload: '無法從資料庫載入資料。' });
      console.error(e);
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, [selectAssistant, state.bundleMode, state.isShared]);

  const loadSharedAssistant = useCallback(
    async (assistantId: string) => {
      // Initialize providers first to establish a baseline
      await initializeProviders();

      dispatch({ type: 'SET_LOADING', payload: true });
      try {
        const assistant = await getAssistantFromTurso(assistantId);
        if (assistant) {
          await db.saveAssistant(assistant);
          dispatch({ type: 'SET_CURRENT_ASSISTANT', payload: { ...assistant } });
          dispatch({
            type: 'SET_ASSISTANTS',
            payload: [assistant],
          });
          const assistantSessions = await db.getSessionsForAssistant(assistant.id);
          const sortedSessions = assistantSessions.sort((a, b) => b.createdAt - a.createdAt);
          dispatch({ type: 'SET_SESSIONS', payload: sortedSessions });

          if (sortedSessions.length > 0) {
            dispatch({ type: 'SET_CURRENT_SESSION', payload: sortedSessions[0] });
          } else {
            await createNewSession(assistant.id);
          }

          dispatch({ type: 'SET_VIEW_MODE', payload: 'chat' });
        } else {
          dispatch({ type: 'SET_ERROR', payload: '找不到分享的助理。' });
        }
      } catch (e) {
        dispatch({ type: 'SET_ERROR', payload: '載入分享的助理時發生錯誤。' });
        console.error(e);
      } finally {
        dispatch({ type: 'SET_LOADING', payload: false });
      }
    },
    [createNewSession],
  );

  // Save assistant
  const saveAssistant = useCallback(
    async (assistant: Assistant) => {
      await db.saveAssistant(assistant);
      const storedAssistants = await db.getAllAssistants();
      dispatch({
        type: 'SET_ASSISTANTS',
        payload: storedAssistants.sort((a, b) => b.createdAt - a.createdAt),
      });

      // If we are creating a new assistant, select it and switch to chat.
      if (state.viewMode === 'new_assistant') {
        await selectAssistant(assistant.id);
      } else {
        // If we are editing, just update the current assistant's data
        // and stay in the current view mode (e.g., 'edit_assistant').
        dispatch({ type: 'SET_CURRENT_ASSISTANT', payload: { ...assistant } });
      }
    },
    [selectAssistant, state.viewMode],
  );

  // Import assistant from an exported package zip (offline sharing without Turso)
  const importAssistantPackage = useCallback(
    async (file: File) => {
      const existingIds = state.assistants.map(assistant => assistant.id);
      const imported = await importAssistantPackageFile(file, existingIds);

      await db.saveAssistant(imported);
      const storedAssistants = await db.getAllAssistants();
      dispatch({
        type: 'SET_ASSISTANTS',
        payload: storedAssistants.sort((a, b) => b.createdAt - a.createdAt),
      });
      await selectAssistant(imported.id, true);
      return imported;
    },
    [selectAssistant, state.assistants],
  );

  // Delete assistant
  const deleteAssistant = useCallback(
    async (assistantId: string) => {
      if (window.confirm('確定要刪除此助理和所有聊天記錄嗎？')) {
        const deletedSessions = await db.getSessionsForAssistant(assistantId);
        await db.deleteAssistant(assistantId);
        await Promise.all(
          deletedSessions.map(session => deleteRunCheckpointsForSession(session.id)),
        );
        await htmlProjectStore.deleteProjectsByAssistant(assistantId);
        dispatch({ type: 'DELETE_ASSISTANT', payload: assistantId });

        if (state.currentAssistant?.id === assistantId) {
          if (state.activeProjectId) {
            htmlPreviewService.revokePreviewUrl(state.activeProjectId);
          }
          dispatch({ type: 'RESET_PROJECT_WORKSPACE' });
        }

        const remainingAssistants = state.assistants.filter(a => a.id !== assistantId);
        if (remainingAssistants.length > 0) {
          await selectAssistant(remainingAssistants[0].id);
        } else {
          dispatch({ type: 'SET_VIEW_MODE', payload: 'new_assistant' });
        }
      }
    },
    [selectAssistant, state.activeProjectId, state.assistants, state.currentAssistant?.id],
  );

  // Delete session
  const deleteSession = useCallback(
    async (sessionId: string) => {
      if (!state.currentAssistant) {
        return;
      }

      if (window.confirm('確定要刪除此聊天會話嗎？')) {
        await db.deleteSession(sessionId);
        await deleteRunCheckpointsForSession(sessionId);
        const assistantSessions = await db.getSessionsForAssistant(state.currentAssistant.id);
        const sortedSessions = assistantSessions.sort((a, b) => b.createdAt - a.createdAt);
        dispatch({ type: 'SET_SESSIONS', payload: sortedSessions });

        if (state.currentSession?.id === sessionId) {
          if (sortedSessions.length > 0) {
            dispatch({ type: 'SET_CURRENT_SESSION', payload: sortedSessions[0] });
          } else {
            await createNewSession(state.currentAssistant.id);
          }
        }
      }
    },
    [state.currentAssistant, state.currentSession, createNewSession],
  );

  // Update session
  const updateSession = useCallback(async (session: ChatSession) => {
    await db.saveSession(session);
    dispatch({ type: 'UPDATE_SESSION', payload: session });
  }, []);

  // Set view mode
  const setViewMode = useCallback((mode: ViewMode) => {
    dispatch({ type: 'SET_VIEW_MODE', payload: mode });
  }, []);

  // Toggle sidebar (open/close — used for mobile/tablet drawer and desktop visibility)
  const toggleSidebar = useCallback(() => {
    dispatch({ type: 'SET_SIDEBAR_OPEN', payload: !state.isSidebarOpen });
  }, [state.isSidebarOpen]);

  // Set sidebar open state explicitly
  const setSidebarOpen = useCallback((open: boolean) => {
    dispatch({ type: 'SET_SIDEBAR_OPEN', payload: open });
  }, []);

  // Toggle desktop sidebar collapse (expanded ↔ icon rail). Persisted to localStorage.
  const toggleSidebarCollapse = useCallback(() => {
    const next = !state.isSidebarCollapsed;
    dispatch({ type: 'SET_SIDEBAR_COLLAPSED', payload: next });
    try {
      localStorage.setItem('sidebarCollapsed', String(next));
    } catch (error) {
      console.warn('Failed to persist sidebarCollapsed to localStorage:', error);
    }
  }, [state.isSidebarCollapsed]);

  // Open share modal
  const openShareModal = useCallback((assistant: Assistant) => {
    dispatch({ type: 'SET_SHARE_MODAL', payload: { isOpen: true, assistant } });
  }, []);

  // Close share modal
  const closeShareModal = useCallback(() => {
    dispatch({ type: 'SET_SHARE_MODAL', payload: { isOpen: false, assistant: null } });
  }, []);

  // Check screen size
  const checkScreenSize = useCallback(() => {
    const mobile = window.innerWidth < 768;
    const tablet = window.innerWidth >= 768 && window.innerWidth < 1024;
    dispatch({ type: 'SET_SCREEN_SIZE', payload: { isMobile: mobile, isTablet: tablet } });

    if (mobile || tablet) {
      dispatch({ type: 'SET_SIDEBAR_OPEN', payload: false });
    } else {
      dispatch({ type: 'SET_SIDEBAR_OPEN', payload: true });
    }
  }, []);

  // Check for shared mode first, then check screen size
  useEffect(() => {
    const handleSharedMode = async () => {
      const urlParams = new URLSearchParams(window.location.search);
      const bundleId = urlParams.get('bundle');
      const importBundle = urlParams.get('import') === 'bundle';

      if (bundleId || importBundle) {
        dispatch({ type: 'SET_SHARED_MODE', payload: { isShared: false, assistantId: null } });
        dispatch({ type: 'SET_BUNDLE_MODE', payload: bundleId ? { bundleId } : null });
        if (importBundle) {
          dispatch({ type: 'SET_VIEW_MODE', payload: 'bundle_import' });
          dispatch({ type: 'SET_LOADING', payload: false });
        }
        checkScreenSize();
        return;
      }

      dispatch({ type: 'SET_BUNDLE_MODE', payload: null });

      // Check for short URL parameter format (?s=shortCode)
      const shortCode = urlParams.get('s');

      if (shortCode) {
        console.log('🔗 [AppContext] Detected short URL parameter:', shortCode);

        try {
          const shortUrlData = await resolveShortUrl(shortCode);
          if (shortUrlData) {
            // Record the click
            await recordShortUrlClick(shortCode);

            // Build regular share URL
            const shareUrl = new URL(window.location.href);
            shareUrl.searchParams.delete('s'); // Remove short URL parameter
            shareUrl.searchParams.set('share', shortUrlData.assistantId);
            if (shortUrlData.encryptedKeys) {
              shareUrl.searchParams.set('keys', shortUrlData.encryptedKeys);
            }

            // Redirect to the regular share URL
            console.log('🔄 [AppContext] Redirecting to:', shareUrl.toString());
            window.history.replaceState({}, '', shareUrl.toString());

            // Set shared mode with the resolved data
            dispatch({
              type: 'SET_SHARED_MODE',
              payload: { isShared: true, assistantId: shortUrlData.assistantId },
            });
            return;
          } else {
            console.error('❌ [AppContext] Short URL not found or expired:', shortCode);
            // TODO: Show error page or redirect to home
          }
        } catch (error) {
          console.error('❌ [AppContext] Failed to resolve short URL:', error);
          // TODO: Show error page or redirect to home
        }
      }

      // Check for regular ?share=ID format
      const params = new URLSearchParams(window.location.search);
      const shared = params.has('share');
      const assistantId = params.get('share');

      dispatch({ type: 'SET_SHARED_MODE', payload: { isShared: shared, assistantId } });

      // After determining shared mode, check screen size
      checkScreenSize();
    };

    handleSharedMode();
    window.addEventListener('resize', checkScreenSize);
    return () => window.removeEventListener('resize', checkScreenSize);
  }, [checkScreenSize]);

  // Load data only after shared mode has been determined
  useEffect(() => {
    console.log('🔍 [AppContext] Data loading useEffect, isShared:', state.isShared);

    // Don't load if shared mode has not been determined, or while a bundle route owns the shell.
    if (
      state.isShared === null ||
      state.isShared === true ||
      state.bundleMode ||
      new URLSearchParams(window.location.search).get('import') === 'bundle'
    ) {
      if (state.isShared === null) {
        console.log('⏳ [AppContext] Waiting for shared mode determination');
      } else {
        console.log('🚫 [AppContext] Skipping loadData in shared mode');
      }
      return;
    }

    console.log('🔄 [AppContext] Starting normal loadData');
    loadData();
  }, [loadData, state.bundleMode, state.isShared]);

  // Separate effect for shared mode to prevent any interference
  useEffect(() => {
    if (state.isShared) {
      // Ensure model loading is cleared if any
      dispatch({ type: 'SET_MODEL_LOADING', payload: { isLoading: false, progress: null } });
      // Prevent viewMode reset in shared mode
      if (state.viewMode === 'new_assistant') {
        dispatch({ type: 'SET_VIEW_MODE', payload: 'chat' });
      }
    }
  }, [state.isShared, state.viewMode, dispatch]);

  // Set embedding configuration
  const setEmbeddingConfig = useCallback((config: EmbeddingConfig) => {
    dispatch({ type: 'SET_EMBEDDING_CONFIG', payload: config });
    // Save to localStorage for persistence
    localStorage.setItem('embeddingConfig', JSON.stringify(config));
  }, []);

  const setActiveProject = useCallback((projectId: string | null) => {
    dispatch({ type: 'SET_ACTIVE_PROJECT', payload: projectId });
  }, []);

  const setProjectWorkspaceOpen = useCallback((open: boolean) => {
    dispatch({ type: 'SET_PROJECT_WORKSPACE_OPEN', payload: open });
  }, []);

  const setProjectPreview = useCallback((preview: AppState['projectPreview']) => {
    dispatch({ type: 'SET_PROJECT_PREVIEW', payload: preview });
  }, []);

  const appendProjectActivity = useCallback((message: string) => {
    dispatch({ type: 'APPEND_PROJECT_ACTIVITY', payload: message });
  }, []);

  const setAgentRunState = useCallback((nextState: AgentRunState | null) => {
    dispatch({ type: 'SET_AGENT_RUN_STATE', payload: nextState });
  }, []);

  const updateRouteProposalStatus = useCallback(
    async (proposal: RouteProposal, status: RouteProposal['status']) => {
      const session = state.currentSession;
      if (!session || session.id !== proposal.sourceSessionId) {
        return;
      }
      const nextSession: ChatSession = {
        ...session,
        messages: session.messages.map(message =>
          message.routeProposal?.createdAt === proposal.createdAt &&
          message.routeProposal.sourceSessionId === proposal.sourceSessionId
            ? { ...message, routeProposal: { ...message.routeProposal, status } }
            : message,
        ),
        updatedAt: Date.now(),
      };
      await db.saveSession(nextSession);
      dispatch({ type: 'UPDATE_SESSION', payload: nextSession });
    },
    [state.currentSession],
  );

  const declineRouteProposal = useCallback(
    async (proposal: RouteProposal) => updateRouteProposalStatus(proposal, 'declined'),
    [updateRouteProposalStatus],
  );

  const acceptRouteProposal = useCallback(
    async (proposal: RouteProposal) => {
      const handoffContext: NonNullable<ChatSession['handoffContext']> = {
        fromAssistantId: proposal.sourceAssistantId,
        fromAssistantName: state.currentAssistant?.name ?? '原助理',
        reason: proposal.reason,
        summary: proposal.handoffSummary,
        sourceSessionId: proposal.sourceSessionId,
        createdAt: Date.now(),
      };
      if (state.isShared) {
        const pendingSession: ChatSession = {
          id: `shared_${Date.now()}`,
          assistantId: proposal.targetAssistantId,
          title: `與 ${proposal.targetAssistantName} 聊天`,
          messages: [],
          createdAt: Date.now(),
          tokenCount: 0,
          tokenUsage: undefined,
          handoffContext,
        };
        await updateRouteProposalStatus(proposal, 'accepted');
        dispatch({ type: 'SET_PENDING_HANDOFF_SESSION', payload: pendingSession });
        const url = new URL(window.location.href);
        url.searchParams.set('share', proposal.targetAssistantId);
        window.history.replaceState({}, '', url.toString());
        dispatch({
          type: 'SET_SHARED_MODE',
          payload: { isShared: true, assistantId: proposal.targetAssistantId },
        });
        return;
      }
      const target = state.assistants.find(
        assistant => assistant.id === proposal.targetAssistantId,
      );
      if (!target) {
        await updateRouteProposalStatus(proposal, 'failed');
        dispatch({ type: 'SET_ERROR', payload: '轉接目標已不存在，無法完成轉接。' });
        return;
      }
      await updateRouteProposalStatus(proposal, 'accepted');
      await selectAssistant(target.id);
      await createNewSession(target.id, handoffContext);
    },
    [
      createNewSession,
      selectAssistant,
      state.assistants,
      state.currentAssistant?.name,
      state.isShared,
      updateRouteProposalStatus,
    ],
  );

  const clearProjectWorkspace = useCallback(() => {
    if (state.activeProjectId) {
      htmlPreviewService.revokePreviewUrl(state.activeProjectId);
    }
    dispatch({ type: 'RESET_PROJECT_WORKSPACE' });
  }, [state.activeProjectId]);

  const attachProjectToCurrentSession = useCallback(
    async (
      session: ChatSession,
      projectId: string,
      projectName: string,
      activityPrefix: string,
    ) => {
      const preview = await htmlPreviewService.resolveProjectForPreview(projectId);
      const nextSession: ChatSession = {
        ...session,
        activeProjectId: projectId,
        updatedAt: Date.now(),
      };

      await db.saveSession(nextSession);
      dispatch({ type: 'UPDATE_SESSION', payload: nextSession });
      dispatch({ type: 'SET_ACTIVE_PROJECT', payload: projectId });
      dispatch({ type: 'SET_PROJECT_WORKSPACE_OPEN', payload: true });
      dispatch({ type: 'SET_PROJECT_PREVIEW', payload: preview });
      dispatch({
        type: 'APPEND_PROJECT_ACTIVITY',
        payload: `${activityPrefix}「${projectName}」。`,
      });
    },
    [dispatch],
  );

  const clearCurrentSessionProject = useCallback(
    async (session: ChatSession, activityMessage?: string) => {
      const nextSession: ChatSession = {
        ...session,
        activeProjectId: null,
        updatedAt: Date.now(),
      };

      await db.saveSession(nextSession);
      dispatch({ type: 'UPDATE_SESSION', payload: nextSession });
      clearProjectWorkspace();

      if (activityMessage) {
        dispatch({
          type: 'APPEND_PROJECT_ACTIVITY',
          payload: activityMessage,
        });
      }
    },
    [clearProjectWorkspace, dispatch],
  );

  const clearProjectForCurrentSession = useCallback(async () => {
    if (!state.currentSession) {
      clearProjectWorkspace();
      return;
    }

    await clearCurrentSessionProject(state.currentSession);
  }, [clearCurrentSessionProject, clearProjectWorkspace, state.currentSession]);

  const createProjectForCurrentSession = useCallback(async () => {
    if (!state.currentSession) {
      return;
    }

    const createdAt = Date.now();
    const project = await htmlProjectStore.createProject({
      assistantId: state.currentSession.assistantId,
      sessionId: state.currentSession.id,
      name: `HTML Project ${new Date(createdAt).toLocaleString('zh-TW')}`,
    });

    const templateFiles = getTemplateFiles();
    await htmlProjectStore.writeFiles(project.id, templateFiles);
    await attachProjectToCurrentSession(
      state.currentSession,
      project.id,
      project.name,
      '已建立新的 HTML 專案',
    );
  }, [attachProjectToCurrentSession, state.currentSession]);

  const openProjectForCurrentSession = useCallback(
    async (projectId: string) => {
      if (!state.currentSession) {
        return;
      }

      const project = await htmlProjectStore.assertProjectOwnership(
        projectId,
        state.currentSession.assistantId,
      );
      await attachProjectToCurrentSession(
        state.currentSession,
        project.id,
        project.name,
        '已開啟既有 HTML 專案',
      );
    },
    [attachProjectToCurrentSession, state.currentSession],
  );

  const renameProjectForCurrentSession = useCallback(
    async (projectId: string, name: string) => {
      if (!state.currentSession) {
        return;
      }

      const project = await htmlProjectStore.renameProject(
        projectId,
        state.currentSession.assistantId,
        name,
      );

      dispatch({
        type: 'APPEND_PROJECT_ACTIVITY',
        payload: `已重新命名 HTML 專案為「${project.name}」。`,
      });
    },
    [state.currentSession],
  );

  const uploadFilesToProjectForCurrentSession = useCallback(
    async (projectId: string, files: File[]) => {
      if (!state.currentSession) {
        return;
      }

      const project = await htmlProjectStore.assertProjectOwnership(
        projectId,
        state.currentSession.assistantId,
      );
      const importedFiles = await htmlProjectImportService.prepareFilesForProjectUpload(files);
      const writeResult = await htmlProjectStore.writeFiles(project.id, importedFiles);
      const activityMessage = `已上傳 ${importedFiles.length} 個檔案到 HTML 專案「${project.name}」。`;

      if (state.currentSession.activeProjectId === project.id) {
        const preview = await htmlPreviewService.resolveProjectForPreview(project.id);
        dispatch({ type: 'SET_PROJECT_PREVIEW', payload: preview });
        dispatch({
          type: 'APPEND_PROJECT_ACTIVITY',
          payload: `${activityMessage} version ${writeResult.previewVersion}`,
        });
        return;
      }

      dispatch({
        type: 'APPEND_PROJECT_ACTIVITY',
        payload: activityMessage,
      });
    },
    [state.currentSession],
  );

  const importProjectZipForCurrentSession = useCallback(
    async (file: File) => {
      if (!state.currentSession) {
        return;
      }

      const importedProject = await htmlProjectImportService.importZipProject(file);
      const project = await htmlProjectStore.createProject({
        assistantId: state.currentSession.assistantId,
        sessionId: state.currentSession.id,
        name: importedProject.projectName,
        entryFile: importedProject.entryFile,
      });

      await htmlProjectStore.writeFiles(project.id, importedProject.files);
      await attachProjectToCurrentSession(
        state.currentSession,
        project.id,
        project.name,
        '已匯入 ZIP HTML 專案',
      );
    },
    [attachProjectToCurrentSession, state.currentSession],
  );

  const deleteProjectForCurrentSession = useCallback(
    async (projectId: string) => {
      if (!state.currentSession) {
        return;
      }

      const project = await htmlProjectStore.deleteProject(
        projectId,
        state.currentSession.assistantId,
      );

      if (state.currentSession.activeProjectId === project.id) {
        await clearCurrentSessionProject(
          state.currentSession,
          `已刪除 HTML 專案「${project.name}」。`,
        );
        return;
      }

      dispatch({
        type: 'APPEND_PROJECT_ACTIVITY',
        payload: `已刪除 HTML 專案「${project.name}」。`,
      });
    },
    [clearCurrentSessionProject, state.currentSession],
  );

  const syncProjectWorkspaceForSession = useCallback(
    async (session: ChatSession | null) => {
      const projectId = session?.activeProjectId ?? null;

      if (!projectId || !session) {
        clearProjectWorkspace();
        return;
      }

      try {
        const project = await htmlProjectStore.assertProjectOwnership(
          projectId,
          session.assistantId,
        );
        dispatch({ type: 'SET_ACTIVE_PROJECT', payload: project.id });
        dispatch({ type: 'SET_PROJECT_WORKSPACE_OPEN', payload: true });

        const preview = await htmlPreviewService.resolveProjectForPreview(project.id);
        dispatch({ type: 'SET_PROJECT_PREVIEW', payload: preview });
      } catch (error) {
        console.error('Failed to sync HTML project workspace:', error);

        await clearCurrentSessionProject(
          session,
          `無法載入 HTML project 預覽：${(error as Error).message}`,
        );
      }
    },
    [clearCurrentSessionProject, clearProjectWorkspace],
  );

  useEffect(() => {
    syncProjectWorkspaceForSession(state.currentSession).catch(error => {
      console.error('Failed to update project workspace from session:', error);
    });
  }, [state.currentSession, syncProjectWorkspaceForSession]);

  const contextValue: AppContextValue = {
    state,
    dispatch,
    actions: {
      loadData,
      selectAssistant,
      saveAssistant,
      importAssistantPackage,
      deleteAssistant,
      createNewSession,
      deleteSession,
      updateSession,
      setViewMode,
      toggleSidebar,
      setSidebarOpen,
      toggleSidebarCollapse,
      openShareModal,
      closeShareModal,
      checkScreenSize,
      loadSharedAssistant,
      setEmbeddingConfig,
      setActiveProject,
      setProjectWorkspaceOpen,
      setProjectPreview,
      appendProjectActivity,
      setAgentRunState,
      acceptRouteProposal,
      declineRouteProposal,
      createProjectForCurrentSession,
      openProjectForCurrentSession,
      renameProjectForCurrentSession,
      uploadFilesToProjectForCurrentSession,
      importProjectZipForCurrentSession,
      deleteProjectForCurrentSession,
      clearProjectForCurrentSession,
      clearProjectWorkspace,
      syncProjectWorkspaceForSession,
    },
  };

  return <AppContext.Provider value={contextValue}>{children}</AppContext.Provider>;
}

export default AppProvider;
