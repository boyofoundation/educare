import React from 'react';
import {
  AgentRunState,
  RouteProposal,
  Assistant,
  ChatSession,
  EmbeddingConfig,
  HtmlProjectPreviewArtifact,
} from '../../types';

export type ViewMode =
  | 'chat'
  | 'new_assistant'
  | 'edit_assistant'
  | 'settings'
  | 'api_setup'
  | 'provider_settings';

export interface ModelLoadingProgress {
  status: string;
  progress: number;
  name?: string;
}

export interface AppState {
  assistants: Assistant[];
  currentAssistant: Assistant | null;
  sessions: ChatSession[];
  currentSession: ChatSession | null;
  viewMode: ViewMode;
  isLoading: boolean;
  error: string | null;
  isShared: boolean | null;
  sharedAssistantId: string | null;
  isSidebarOpen: boolean;
  isSidebarCollapsed: boolean;
  isMobile: boolean;
  isTablet: boolean;
  isModelLoading: boolean;
  modelLoadingProgress: ModelLoadingProgress | null;
  isShareModalOpen: boolean;
  assistantToShare: Assistant | null;
  currentProvider?: string;
  embeddingConfig: EmbeddingConfig;
  activeProjectId: string | null;
  isProjectWorkspaceOpen: boolean;
  projectPreview: HtmlProjectPreviewArtifact | null;
  projectToolActivity: string[];
  /**
   * 目前的 Agent run 狀態 (T7 活動面板來源)。null 表示沒有進行中/最近結束的 run。
   * 由 ChatContainer 在 AgentRunController callbacks 中透過 setAgentRunState 更新。
   */
  agentRunState: AgentRunState | null;
  /** Temporary shared-mode session consumed by SharedAssistant after a handoff. */
  pendingHandoffSession?: ChatSession | null;
}

export type AppAction =
  | { type: 'SET_ASSISTANTS'; payload: Assistant[] }
  | { type: 'SET_CURRENT_ASSISTANT'; payload: Assistant | null }
  | { type: 'SET_SESSIONS'; payload: ChatSession[] }
  | { type: 'SET_CURRENT_SESSION'; payload: ChatSession | null }
  | { type: 'SET_VIEW_MODE'; payload: ViewMode }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'SET_SHARED_MODE'; payload: { isShared: boolean; assistantId: string | null } }
  | { type: 'SET_SIDEBAR_OPEN'; payload: boolean }
  | { type: 'SET_SIDEBAR_COLLAPSED'; payload: boolean }
  | { type: 'SET_SCREEN_SIZE'; payload: { isMobile: boolean; isTablet: boolean } }
  | {
      type: 'SET_MODEL_LOADING';
      payload: { isLoading: boolean; progress?: ModelLoadingProgress | null };
    }
  | { type: 'SET_SHARE_MODAL'; payload: { isOpen: boolean; assistant?: Assistant | null } }
  | { type: 'ADD_SESSION'; payload: ChatSession }
  | { type: 'UPDATE_SESSION'; payload: ChatSession }
  | { type: 'DELETE_SESSION'; payload: string }
  | { type: 'DELETE_ASSISTANT'; payload: string }
  | { type: 'SET_ACTIVE_PROVIDER'; payload: string }
  | { type: 'SET_EMBEDDING_CONFIG'; payload: EmbeddingConfig }
  | { type: 'SET_ACTIVE_PROJECT'; payload: string | null }
  | { type: 'SET_PROJECT_WORKSPACE_OPEN'; payload: boolean }
  | { type: 'SET_PROJECT_PREVIEW'; payload: HtmlProjectPreviewArtifact | null }
  | { type: 'APPEND_PROJECT_ACTIVITY'; payload: string }
  | { type: 'CLEAR_PROJECT_ACTIVITY' }
  | { type: 'RESET_PROJECT_WORKSPACE' }
  | { type: 'SET_AGENT_RUN_STATE'; payload: AgentRunState | null }
  | { type: 'SET_PENDING_HANDOFF_SESSION'; payload: ChatSession | null };

export interface AppContextValue {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
  actions: {
    loadData: () => Promise<void>;
    selectAssistant: (assistantId: string, changeView?: boolean) => Promise<void>;
    saveAssistant: (assistant: Assistant) => Promise<void>;
    deleteAssistant: (assistantId: string) => Promise<void>;
    createNewSession: (
      assistantId: string,
      handoffContext?: ChatSession['handoffContext'],
    ) => Promise<ChatSession>;
    deleteSession: (sessionId: string) => Promise<void>;
    updateSession: (session: ChatSession) => Promise<void>;
    setViewMode: (mode: ViewMode) => void;
    toggleSidebar: () => void;
    setSidebarOpen: (open: boolean) => void;
    toggleSidebarCollapse: () => void;
    openShareModal: (assistant: Assistant) => void;
    closeShareModal: () => void;
    checkScreenSize: () => void;
    loadSharedAssistant: (assistantId: string) => Promise<void>;
    setEmbeddingConfig: (config: EmbeddingConfig) => void;
    setActiveProject: (projectId: string | null) => void;
    setProjectWorkspaceOpen: (open: boolean) => void;
    setProjectPreview: (preview: HtmlProjectPreviewArtifact | null) => void;
    appendProjectActivity: (message: string) => void;
    setAgentRunState: (state: AgentRunState | null) => void;
    acceptRouteProposal: (proposal: RouteProposal) => Promise<void>;
    declineRouteProposal: (proposal: RouteProposal) => Promise<void>;
    createProjectForCurrentSession: () => Promise<void>;
    openProjectForCurrentSession: (projectId: string) => Promise<void>;
    renameProjectForCurrentSession: (projectId: string, name: string) => Promise<void>;
    uploadFilesToProjectForCurrentSession: (projectId: string, files: File[]) => Promise<void>;
    importProjectZipForCurrentSession: (file: File) => Promise<void>;
    deleteProjectForCurrentSession: (projectId: string) => Promise<void>;
    clearProjectForCurrentSession: () => Promise<void>;
    clearProjectWorkspace: () => void;
    syncProjectWorkspaceForSession: (session: ChatSession | null) => Promise<void>;
  };
}
