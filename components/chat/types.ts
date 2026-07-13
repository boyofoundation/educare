import type { ReactNode } from 'react';
import {
  ChatMessage,
  ChatSession,
  MessageAttachment,
  RagChunk,
  RouteProposal,
  SubagentRunRecord,
  ToolCallRecord,
} from '../../types';
import type { ProviderUsageMetadata } from '../../services/llmAdapter';
import type { RoutableTarget } from '../../services/assistantRoutingService';

export interface ChatTokenInfo {
  promptTokenCount: number;
  candidatesTokenCount: number;
  usage?: ProviderUsageMetadata;
  provider?: string;
  model?: string;
}

export interface MessageBubbleProps {
  message: ChatMessage;
  index: number;
  assistantName?: string;
  citationContentsById?: Record<string, string>;
  onAcceptRouteProposal?: (proposal: RouteProposal) => Promise<void>;
  onDeclineRouteProposal?: (proposal: RouteProposal) => Promise<void>;
}

export interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  isLoading: boolean;
  disabled?: boolean;
  isWorkspaceOpen?: boolean;
  /** G5: 當 agent run 進行中為 true,顯示「停止」鈕並鎖定輸入。 */
  isRunning?: boolean;
  /** G5: 使用者按下「停止」鈕的回呼 (會 abort 進行中的 controller)。 */
  onStop?: () => void;
  /** 多模態:作用中模型支援圖片輸入時為 true,顯示上傳入口並啟用貼上圖片。 */
  imageInputEnabled?: boolean;
  /** 多模態:待送出的圖片附件(由父層持有 state)。 */
  attachments?: MessageAttachment[];
  /** 多模態:使用者選擇/貼上圖片檔時的回呼。 */
  onAddAttachmentFiles?: (files: File[]) => void;
  /** 多模態:移除待送出附件。 */
  onRemoveAttachment?: (index: number) => void;
}

export interface ChatContainerProps {
  session: ChatSession;
  assistantName: string;
  systemPrompt: string;
  assistantId: string;
  ragChunks: RagChunk[]; // Keep as any[] for now to maintain compatibility
  onNewMessage: (
    session: ChatSession,
    userMessage: string,
    modelResponse: string,
    tokenInfo: ChatTokenInfo,
  ) => Promise<void>;
  hideHeader?: boolean;
  sharedMode?: boolean;
  /** Bundle sandbox mode: uses shared-mode safeguards without shared-assistant routing. */
  sandboxMode?: boolean;
  assistantDescription?: string;
  starterPrompts?: string[];
  isWorkspaceOpen?: boolean;
  headerActions?: ReactNode;
  onCreateSession?: () => Promise<void>;
  /** 子代理人委派開關。由父層從 assistant.subagentDelegationEnabled 傳入。 */
  subagentDelegationEnabled?: boolean;
  /** 數學工具開關。由父層從 assistant.mathToolsEnabled 傳入。 */
  mathToolsEnabled?: boolean;
  /** 覆寫本地／分享模式的路由目標；空陣列會明確停用路由。 */
  routableTargetsOverride?: RoutableTarget[] | null;
  /** Optional host-owned route proposal decisions, used by the isolated bundle runner. */
  onAcceptRouteProposal?: (proposal: RouteProposal) => Promise<void>;
  onDeclineRouteProposal?: (proposal: RouteProposal) => Promise<void>;
}

export interface WelcomeMessageProps {
  assistantName: string;
  assistantDescription?: string;
  sharedMode?: boolean;
  starterPrompts?: string[];
  onPromptSelect?: (prompt: string) => void;
}

export interface ThinkingIndicatorProps {
  assistantName?: string;
  statusText?: string;
}

export interface StreamingResponseProps {
  content: string;
  assistantName?: string;
  subagentBatches?: Record<string, SubagentRunRecord[]>;
  toolCallLog?: ToolCallRecord[];
}
