import type { ReactNode } from 'react';
import { ChatMessage, ChatSession, RagChunk, SubagentRunRecord, ToolCallRecord } from '../../types';
import type { ProviderUsageMetadata } from '../../services/llmAdapter';

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
  assistantDescription?: string;
  starterPrompts?: string[];
  isWorkspaceOpen?: boolean;
  headerActions?: ReactNode;
  /** 子代理人委派開關。由父層從 assistant.subagentDelegationEnabled 傳入。 */
  subagentDelegationEnabled?: boolean;
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
