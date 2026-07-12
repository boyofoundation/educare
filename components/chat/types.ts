import type { ReactNode } from 'react';
import {
  ChatMessage,
  ChatSession,
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
