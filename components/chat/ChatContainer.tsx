import React, {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ChatContainerProps } from './types';
import { AppContext } from '../core/useAppContext';
import MessageBubble from './MessageBubble';
import ChatInput from './ChatInput';
import WelcomeMessage from './WelcomeMessage';
import ThinkingIndicator from './ThinkingIndicator';
import StreamingResponse from './StreamingResponse';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import {
  AgentRunController,
  getAgentRunReplayPolicy,
  type AgentRunBudget,
  type AgentRunResult,
} from '../../services/agentRunController';
import { buildIndexedKnowledgeChunks } from '../../services/knowledgeSearchService';
import {
  deleteCheckpoint,
  getCheckpoint,
  getInterruptedForSession,
} from '../../services/agentRunCheckpointService';
import { htmlProjectStore } from '../../services/htmlProjectStore';
import { applyTokenUsageToSession } from '../../services/sessionTokenUsage';
import { isErrorMessage, isSyntheticMessage } from '../../services/conversationUtils';
import { classifyChatError } from '../../services/chatErrorService';
import {
  activeModelSupportsImageInput,
  resolveActiveModelImageSupport,
} from '../../services/modelCapabilities';
import {
  fileToImageAttachment,
  ImageAttachmentError,
  MAX_ATTACHMENTS_PER_MESSAGE,
} from '../../services/imageAttachmentService';
import { PROVIDER_SETTINGS_CHANGED_EVENT } from '../../services/llmAdapter';
import { providerManager } from '../../services/providerRegistry';
import { bundleStrings } from '../bundle/bundleStrings';
import { useStickToBottom } from '../../hooks/useStickToBottom';
import type {
  AgentRunCheckpoint,
  AgentRunState,
  ChatMessage,
  ChatSession,
  GeometryBoardRecord,
  MessageAttachment,
  MessageImage,
  SpeechUtteranceRecord,
  SubagentRunRecord,
  ToolCallRecord,
  RouteProposal,
} from '../../types';
import { HtmlProjectWorkspaceUpdate } from '../../types';
import { DRAW_GEOMETRY_TOOL_NAME, type GeometryDoc } from '../../services/geometryToolService';
import { SPEAK_TEXT_TOOL_NAME, type SpeechUtteranceDoc } from '../../services/speechToolService';
import {
  getCachedSharedRoutableTargets,
  resolveRoutableTargets,
} from '../../services/assistantRoutingService';
import { registerWorkspaceOperationFlusher } from '../../services/workspaceOperationService';
import {
  buildChatDraftOwnerId,
  clearWorkspaceDraftWithOperationToken,
  clearWorkspaceDraftAsync,
  readWorkspaceDraft,
  type DraftPersistenceMode,
  WORKSPACE_DRAFT_SAVE_DELAY_MS,
  writeWorkspaceDraftWithOperationToken,
  writeWorkspaceDraftAsync,
} from '../../services/workspaceDraftService';
import { LOCAL_WORKSPACE_RUN_ID } from '../../services/workspaceOfflineGuard';
import { acquireWorkspaceRunLock } from '../../services/workspaceRunLock';
import AgentRunControls from './AgentRunControls';

const INTERRUPTION_NOTICE = '⚠️ 上次工作已中斷';
const EMPTY_RESPONSE_NOTICE = '（本次回覆沒有內容）';
const STICKY_SCROLL_THRESHOLD_PX = 100;
const DEFAULT_AGENT_RUN_BUDGET: AgentRunBudget = {
  maxTurns: 5,
  maxToolCalls: 30,
  maxTokens: 50_000,
};
const MISSING_PROJECT_RESUME_REASON = '原本的 HTML 專案已不存在，只能捨棄並封存這次中斷紀錄。';
const EXHAUSTED_RESUME_REASON = '這次工作已達目前的軟預算；請提高相應上限後再續跑。';
const UNSAFE_RESUME_REASON =
  '這次工作有尚未確認的工具操作，為避免重複副作用，只能捨棄並封存中斷紀錄。';

interface ProviderReadiness {
  ready: boolean;
  displayName: string | null;
  supportsLocalMode: boolean;
}

interface SubmittedDraft {
  ownerId: string;
  sessionId: string;
  text: string;
}

interface ActiveRunSession {
  session: ChatSession;
  token: object;
}

const buildChatDraftKey = (assistantId: string, sessionId: string): string =>
  buildChatDraftOwnerId(assistantId, sessionId);

const persistChatDraftAsync = (ownerId: string, value: string): Promise<DraftPersistenceMode> =>
  value.trim()
    ? writeWorkspaceDraftAsync('chat', ownerId, value)
    : clearWorkspaceDraftAsync('chat', ownerId);

const readChatDraft = (ownerId: string): { value: string; mode: DraftPersistenceMode } => {
  const result = readWorkspaceDraft<string>('chat', ownerId);
  return { value: result.value ?? '', mode: result.mode };
};

const readProviderReadiness = (): ProviderReadiness => {
  const activeProvider = providerManager.getActiveProvider();
  if (!activeProvider) {
    return { ready: false, displayName: null, supportsLocalMode: false };
  }

  let ready = false;
  try {
    ready = activeProvider.isAvailable();
  } catch {
    ready = false;
  }

  return {
    ready,
    displayName: activeProvider.displayName,
    supportsLocalMode: activeProvider.supportsLocalMode,
  };
};

const buildInterruptedNotice = (checkpoint: AgentRunCheckpoint): ChatMessage => ({
  role: 'model',
  content: `${INTERRUPTION_NOTICE}（第 ${Math.min(checkpoint.turnIndex + 1, checkpoint.maxTurns)}/${checkpoint.maxTurns} 回合）。`,
  synthetic: true,
  timestamp: checkpoint.updatedAt,
});

const sameMessage = (left?: ChatMessage, right?: ChatMessage): boolean =>
  left?.role === right?.role &&
  left?.content === right?.content &&
  (left?.images ?? []).map(image => image.url).join('\n') ===
    (right?.images ?? []).map(image => image.url).join('\n');

const appendWithoutDuplicateTail = (
  existingMessages: ChatMessage[],
  additions: ChatMessage[],
): ChatMessage[] => {
  const nextMessages = [...existingMessages];

  for (const message of additions) {
    if (!sameMessage(nextMessages.at(-1), message)) {
      nextMessages.push(message);
    }
  }

  return nextMessages;
};

const updateSessionTitle = (title: string, userMessage: string): string =>
  title === 'New Chat' && userMessage ? userMessage.substring(0, 40) : title;

const mergeCheckpointMessages = (
  sessionMessages: ChatMessage[],
  checkpoint: AgentRunCheckpoint,
  includeInterruptedNotice: boolean,
): ChatMessage[] => {
  const additions: ChatMessage[] = [
    {
      role: 'user',
      content: checkpoint.originalMessage,
      timestamp: checkpoint.createdAt,
    },
    ...checkpoint.committedHistoryDelta,
  ];

  if (includeInterruptedNotice) {
    additions.push(buildInterruptedNotice(checkpoint));
  }

  return appendWithoutDuplicateTail(sessionMessages, additions);
};

const ChatContainer: React.FC<ChatContainerProps> = ({
  session,
  assistantName,
  systemPrompt,
  assistantId,
  ragChunks,
  onNewMessage,
  hideHeader = false,
  sharedMode = false,
  sandboxMode = false,
  assistantDescription,
  starterPrompts = [],
  isWorkspaceOpen: _isWorkspaceOpen = false,
  headerActions,
  onCreateSession,
  subagentDelegationEnabled = false,
  mathToolsEnabled = false,
  webSpeechToolsEnabled = false,
  routableTargetsOverride,
  onRequestProviderSetup,
  onFlushDrafts,
  onAcceptRouteProposal,
  onDeclineRouteProposal,
}) => {
  const appContext = useContext(AppContext);
  const isSandboxMode = sharedMode || sandboxMode;
  const actions = appContext?.actions ?? null;
  const draftPersistenceEnabled = !isSandboxMode;
  const draftKey = useMemo(
    () => buildChatDraftKey(assistantId, session.id),
    [assistantId, session.id],
  );
  const initialDraftResult = draftPersistenceEnabled
    ? readChatDraft(draftKey)
    : { value: '', mode: 'persistent' as DraftPersistenceMode };
  const initialDraft = initialDraftResult.value;
  const setAgentRunState = actions?.setAgentRunState;
  const [input, setInput] = useState(initialDraft);
  const [draftPersistenceMode, setDraftPersistenceMode] = useState<DraftPersistenceMode>(
    initialDraftResult.mode,
  );
  const [pendingAttachments, setPendingAttachments] = useState<MessageAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [imageInputSupported, setImageInputSupported] = useState(() =>
    activeModelSupportsImageInput(),
  );
  const [streamingResponse, setStreamingResponse] = useState('');
  const [pendingEmptyResponseNotice, setPendingEmptyResponseNotice] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [currentSession, setCurrentSession] = useState(session);
  const [runState, setRunState] = useState<AgentRunState | null>(null);
  const [subagentBatches, setSubagentBatches] = useState<Record<string, SubagentRunRecord[]>>({});
  const [toolCallRecords, setToolCallRecords] = useState<ToolCallRecord[]>([]);
  const [streamingGeometryBoards, setStreamingGeometryBoards] = useState<GeometryBoardRecord[]>([]);
  const [streamingSpeechUtterances, setStreamingSpeechUtterances] = useState<
    SpeechUtteranceRecord[]
  >([]);
  const [streamingImages, setStreamingImages] = useState<MessageImage[]>([]);
  const [interruptedCheckpoint, setInterruptedCheckpoint] = useState<AgentRunCheckpoint | null>(
    null,
  );
  const [runBudget, setRunBudget] = useState<AgentRunBudget>(DEFAULT_AGENT_RUN_BUDGET);
  const [agentRunControlsOpen, setAgentRunControlsOpen] = useState(false);
  const [resumeProjectMissing, setResumeProjectMissing] = useState(false);
  const [acknowledgeResumeBudget, setAcknowledgeResumeBudget] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [activeRunRevision, setActiveRunRevision] = useState(0);
  const sessionRef = useRef(session);
  const initialScrollSessionRef = useRef<string | null>(null);
  const userScrolledRef = useRef(false);
  const pendingNewSessionScrollResetRef = useRef<string | null>(null);
  const controllerRef = useRef<AgentRunController | null>(null);
  const isThinkingRef = useRef(isThinking);
  const subagentBatchesRef = useRef<Record<string, SubagentRunRecord[]>>({});
  const toolCallRecordsRef = useRef<ToolCallRecord[]>([]);
  const latestErrorMessageRef = useRef<string | null>(null);
  const inputRef = useRef(initialDraft);
  const draftKeyRef = useRef(draftKey);
  const pendingSubmittedDraftRef = useRef<SubmittedDraft | null>(null);
  const virtuosoRef = useRef<VirtuosoHandle | null>(null);
  const streamingBufferRef = useRef('');
  const streamingFlushFrameRef = useRef<number | null>(null);
  const routeProposalRef = useRef<RouteProposal | undefined>(undefined);
  const handoffKickoffSessionIdRef = useRef<string | null>(null);
  const activeRunSessionsRef = useRef(new Map<string, ActiveRunSession>());
  const runOwnershipSessionIdRef = useRef<string | null>(null);
  const [chatScrollParent, setChatScrollParent] = useState<HTMLDivElement | null>(null);

  const resumeReplayPolicy = useMemo(
    () => (interruptedCheckpoint ? getAgentRunReplayPolicy(interruptedCheckpoint) : null),
    [interruptedCheckpoint],
  );
  const resumeBudgetAcknowledgementRequired =
    resumeReplayPolicy?.requiresBudgetAcknowledgement === true;
  const resumeHasUnconfirmedToolCalls =
    resumeReplayPolicy?.requiresInFlightToolAcknowledgement === true;
  const resumeBudgetExhausted = Boolean(
    interruptedCheckpoint &&
      ((interruptedCheckpoint.turnIndex >= interruptedCheckpoint.maxTurns &&
        (runBudget.maxTurns ?? interruptedCheckpoint.maxTurns) <=
          interruptedCheckpoint.turnIndex) ||
        (runBudget.maxToolCalls !== undefined &&
          interruptedCheckpoint.budgetUsage?.toolCallsKnown !== false &&
          (interruptedCheckpoint.budgetUsage?.toolCalls ??
            interruptedCheckpoint.toolTrace.length) >= runBudget.maxToolCalls) ||
        (runBudget.maxTokens !== undefined &&
          interruptedCheckpoint.budgetUsage?.estimatedTokens !== true &&
          (interruptedCheckpoint.budgetUsage?.tokens ??
            interruptedCheckpoint.tokenTotals.promptTokenCount +
              interruptedCheckpoint.tokenTotals.candidatesTokenCount) >= runBudget.maxTokens)),
  );
  const resumeUnavailableReason = resumeProjectMissing
    ? MISSING_PROJECT_RESUME_REASON
    : resumeHasUnconfirmedToolCalls
      ? UNSAFE_RESUME_REASON
      : resumeBudgetExhausted
        ? EXHAUSTED_RESUME_REASON
        : null;
  const controlsState =
    interruptedCheckpoint && runState?.runId !== interruptedCheckpoint.runId ? null : runState;

  useEffect(() => {
    if (!draftPersistenceEnabled) {
      return;
    }

    // Archive operations drain gated writes, then invoke flushers while their
    // opaque token is active. Read the mounted editor refs here so an input
    // changed less than 500ms ago is included in the snapshot; never enqueue
    // another gated write from inside the exclusive operation.
    return registerWorkspaceOperationFlusher(operationToken => {
      const ownerId = draftKeyRef.current;
      const value = inputRef.current;
      if (pendingSubmittedDraftRef.current?.ownerId === ownerId && !value.trim()) {
        return;
      }
      if (value.trim()) {
        writeWorkspaceDraftWithOperationToken(operationToken, 'chat', ownerId, value);
      } else {
        clearWorkspaceDraftWithOperationToken(operationToken, 'chat', ownerId);
      }
    });
  }, [draftPersistenceEnabled]);

  const {
    containerRef,
    isAtBottom,
    handleScroll,
    scrollToBottom,
    resetScrollToTop,
    updatePinnedState,
  } = useStickToBottom(STICKY_SCROLL_THRESHOLD_PX);

  const handleChatScroll = useCallback(() => {
    userScrolledRef.current = true;
    handleScroll();
  }, [handleScroll]);

  useLayoutEffect(() => {
    if (containerRef.current !== chatScrollParent) {
      setChatScrollParent(containerRef.current);
    }
  }, [chatScrollParent, containerRef]);

  const setInputValue = useCallback((value: string) => {
    inputRef.current = value;
    setInput(value);
  }, []);

  // Lightweight harnesses (bundle runners/tests) provide only run state and must retain
  // their existing send behavior; provider/network gating belongs to the full AppProvider.
  const hasRuntimeContext = Boolean(
    appContext?.state && Array.isArray(appContext.state.assistants),
  );
  const [isOnline, setIsOnline] = useState(
    () => typeof navigator === 'undefined' || navigator.onLine !== false,
  );
  const [providerReadiness, setProviderReadiness] = useState<ProviderReadiness>(() =>
    readProviderReadiness(),
  );

  useEffect(() => {
    if (draftKeyRef.current === draftKey) {
      return;
    }

    if (draftPersistenceEnabled) {
      if (
        !(
          pendingSubmittedDraftRef.current?.ownerId === draftKeyRef.current &&
          !inputRef.current.trim()
        )
      ) {
        const previousOwnerId = draftKeyRef.current;
        void persistChatDraftAsync(previousOwnerId, inputRef.current).then(mode => {
          if (draftKeyRef.current === previousOwnerId) {
            setDraftPersistenceMode(mode);
          }
        });
      }
    } else {
      setDraftPersistenceMode('persistent');
    }

    void onFlushDrafts?.();

    draftKeyRef.current = draftKey;
    const restoredDraftResult = draftPersistenceEnabled
      ? readChatDraft(draftKey)
      : { value: '', mode: 'persistent' as DraftPersistenceMode };
    const restoredDraft = restoredDraftResult.value;
    setDraftPersistenceMode(restoredDraftResult.mode);
    inputRef.current = restoredDraft;
    setInputValue(restoredDraft);
  }, [draftKey, draftPersistenceEnabled, onFlushDrafts, setInputValue]);

  useEffect(() => {
    if (!draftPersistenceEnabled) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      if (
        pendingSubmittedDraftRef.current?.ownerId === draftKeyRef.current &&
        !inputRef.current.trim()
      ) {
        return;
      }
      const ownerId = draftKeyRef.current;
      void persistChatDraftAsync(ownerId, inputRef.current).then(mode => {
        if (draftKeyRef.current === ownerId) {
          setDraftPersistenceMode(mode);
        }
      });
    }, WORKSPACE_DRAFT_SAVE_DELAY_MS);

    return () => window.clearTimeout(timeoutId);
  }, [draftKey, draftPersistenceEnabled, input]);

  useEffect(() => {
    return () => {
      if (draftPersistenceEnabled) {
        if (
          !(
            pendingSubmittedDraftRef.current?.ownerId === draftKeyRef.current &&
            !inputRef.current.trim()
          )
        ) {
          void persistChatDraftAsync(draftKeyRef.current, inputRef.current);
        }
      }
      void onFlushDrafts?.();
    };
  }, [draftPersistenceEnabled, onFlushDrafts]);

  useEffect(() => {
    if (!hasRuntimeContext) {
      return;
    }

    let disposed = false;
    let refreshTimer: number | null = null;

    const refreshProviderReadiness = () => {
      const next = readProviderReadiness();
      setProviderReadiness(previous =>
        previous.ready === next.ready &&
        previous.displayName === next.displayName &&
        previous.supportsLocalMode === next.supportsLocalMode
          ? previous
          : next,
      );

      if (!disposed && !next.ready) {
        refreshTimer = window.setTimeout(refreshProviderReadiness, 500);
      }
    };

    const handleProviderSettingsChanged = () => {
      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer);
        refreshTimer = null;
      }
      refreshProviderReadiness();
    };

    refreshProviderReadiness();
    window.addEventListener(PROVIDER_SETTINGS_CHANGED_EVENT, handleProviderSettingsChanged);

    return () => {
      disposed = true;
      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer);
      }
      window.removeEventListener(PROVIDER_SETTINGS_CHANGED_EVENT, handleProviderSettingsChanged);
    };
  }, [hasRuntimeContext]);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const providerUnavailable = hasRuntimeContext && !providerReadiness.ready;
  const networkUnavailable =
    hasRuntimeContext &&
    providerReadiness.ready &&
    !isOnline &&
    !providerReadiness.supportsLocalMode;
  const inputUnavailable = providerUnavailable || networkUnavailable;
  const inputGuidance = providerUnavailable
    ? {
        message: '尚未設定可用的 AI 服務商。請先完成設定；目前輸入內容會保留。',
        actionLabel: '設定 AI 服務商',
        reason: '請先設定可用的 AI 服務商。',
      }
    : networkUnavailable
      ? {
          message: '目前沒有網路連線，雲端 AI 暫時無法使用；輸入內容會保留，恢復連線後即可傳送。',
          actionLabel: null,
          reason: '目前離線，恢復網路後才能傳送。',
        }
      : null;

  const handleRequestProviderSetup = () => {
    if (draftPersistenceEnabled) {
      const ownerId = draftKeyRef.current;
      void persistChatDraftAsync(ownerId, inputRef.current).then(mode => {
        if (draftKeyRef.current === ownerId) {
          setDraftPersistenceMode(mode);
        }
      });
    }
    void onFlushDrafts?.();

    if (onRequestProviderSetup) {
      onRequestProviderSetup();
      return;
    }

    if (actions?.openProviderSettings) {
      actions.openProviderSettings('chat');
    } else {
      actions?.setViewMode?.('provider_settings');
    }
  };

  useEffect(() => {
    isThinkingRef.current = isThinking;
  }, [isThinking]);

  // 多模態:作用中 provider/model 支援圖片輸入時,自動開啟上傳入口;
  // 設定變更(切換 provider 或 model)後即時重新偵測。先以同步 pattern
  // 近似值立即更新,再以 provider API 實查結果覆寫(OpenRouter/Ollama/
  // LM Studio 可實查;其餘 provider 官方端點無能力欄位,維持 pattern)。
  useEffect(() => {
    let disposed = false;
    let refreshSeq = 0;
    const refreshImageInputSupport = () => {
      const seq = ++refreshSeq;
      setImageInputSupported(activeModelSupportsImageInput());
      void resolveActiveModelImageSupport().then(supported => {
        // 只採納最新一次 refresh 的結果,避免快慢查詢交錯覆寫。
        if (!disposed && seq === refreshSeq) {
          setImageInputSupported(supported);
        }
      });
    };
    refreshImageInputSupport();
    window.addEventListener(PROVIDER_SETTINGS_CHANGED_EVENT, refreshImageInputSupport);
    return () => {
      disposed = true;
      window.removeEventListener(PROVIDER_SETTINGS_CHANGED_EVENT, refreshImageInputSupport);
    };
  }, []);

  const handleAddAttachmentFiles = async (files: File[]) => {
    setAttachmentError(null);
    const availableSlots = MAX_ATTACHMENTS_PER_MESSAGE - pendingAttachments.length;
    if (availableSlots <= 0) {
      setAttachmentError(`一則訊息最多附加 ${MAX_ATTACHMENTS_PER_MESSAGE} 張圖片。`);
      return;
    }

    const selectedFiles = files.slice(0, availableSlots);
    const converted: MessageAttachment[] = [];
    let conversionError: string | null =
      files.length > availableSlots
        ? `一則訊息最多附加 ${MAX_ATTACHMENTS_PER_MESSAGE} 張圖片，已略過多餘的檔案。`
        : null;

    for (const file of selectedFiles) {
      try {
        converted.push(await fileToImageAttachment(file));
      } catch (error) {
        conversionError =
          error instanceof ImageAttachmentError ? error.message : '圖片處理失敗，請改用其他圖片。';
      }
    }

    if (converted.length > 0) {
      setPendingAttachments(prev => [...prev, ...converted].slice(0, MAX_ATTACHMENTS_PER_MESSAGE));
    }
    setAttachmentError(conversionError);
  };

  const handleRemoveAttachment = (index: number) => {
    setPendingAttachments(prev => prev.filter((_, itemIndex) => itemIndex !== index));
    setAttachmentError(null);
  };

  const flushStreamingBuffer = useCallback(() => {
    if (streamingFlushFrameRef.current !== null) {
      window.cancelAnimationFrame(streamingFlushFrameRef.current);
      streamingFlushFrameRef.current = null;
    }

    if (streamingBufferRef.current === streamingResponse) {
      return;
    }

    setStreamingResponse(streamingBufferRef.current);
  }, [streamingResponse]);

  const scheduleStreamingFlush = useCallback(() => {
    if (streamingFlushFrameRef.current !== null) {
      return;
    }

    streamingFlushFrameRef.current = window.requestAnimationFrame(() => {
      flushStreamingBuffer();
    });
  }, [flushStreamingBuffer]);

  useEffect(() => {
    const previousSessionId = sessionRef.current.id;
    const sessionChanged = session.id !== previousSessionId;

    // Bundle run 期間由本地 session 擁有最新訊息；父層更新仍可能帶著 run 前快照。
    if (!sessionChanged && sandboxMode && runOwnershipSessionIdRef.current === session.id) {
      return;
    }

    setCurrentSession(session);
    sessionRef.current = session;

    if (sessionChanged) {
      userScrolledRef.current = false;
      if (session.messages.length === 0) {
        pendingNewSessionScrollResetRef.current = session.id;
        resetScrollToTop();
      } else {
        pendingNewSessionScrollResetRef.current = null;
      }
    }

    if (!sessionChanged || !controllerRef.current) {
      return;
    }
    // Run 進行中切換 session(例如接受轉接):中斷舊 run 並清除它的即時 UI。
    // 舊 run 會 commit 回自己的 session,不會寫進新 session;
    // 未完成的部分由既有 checkpoint 機制保留,回到原 session 時可續跑。
    controllerRef.current.stop('session-switch');
    controllerRef.current = null;
    setIsLoading(false);
    streamingBufferRef.current = '';
    setStreamingResponse('');
    setIsThinking(false);
    setStatusText('');
    setSubagentBatches({});
    setToolCallRecords([]);
    setStreamingGeometryBoards([]);
    setStreamingSpeechUtterances([]);
    setStreamingImages([]);
    setPendingEmptyResponseNotice(null);
    setRunState(null);
    setAgentRunState?.(null);
  }, [session, sandboxMode, setAgentRunState, resetScrollToTop]);

  useEffect(() => {
    sessionRef.current = currentSession;
    const activeRun = activeRunSessionsRef.current.get(currentSession.id);
    if (activeRun) {
      activeRun.session = currentSession;
    }
  }, [currentSession]);

  // Search navigation publishes an exact message index through AppContext. Prefer
  // Virtuoso's imperative handle; the DOM fallback also works while the virtual list mounts.
  useEffect(() => {
    const target = appContext?.state?.focusedMessageTarget;
    if (
      !target ||
      target.sessionId !== currentSession.id ||
      target.messageIndex < 0 ||
      target.messageIndex >= currentSession.messages.length
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      if (virtuosoRef.current) {
        virtuosoRef.current.scrollToIndex({
          index: target.messageIndex,
          align: 'center',
          behavior: 'smooth',
        });
      } else {
        document
          .querySelector(`[data-message-index="${target.messageIndex}"]`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      actions?.clearFocusedMessage?.();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [
    actions,
    appContext?.state?.focusedMessageTarget,
    currentSession.id,
    currentSession.messages.length,
  ]);

  useEffect(() => {
    subagentBatchesRef.current = subagentBatches;
  }, [subagentBatches]);

  useEffect(() => {
    toolCallRecordsRef.current = toolCallRecords;
  }, [toolCallRecords]);

  useEffect(() => {
    return () => {
      if (streamingFlushFrameRef.current !== null) {
        window.cancelAnimationFrame(streamingFlushFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const pendingResetSessionId = pendingNewSessionScrollResetRef.current;
    if (pendingResetSessionId) {
      if (pendingResetSessionId === currentSession.id && currentSession.messages.length > 0) {
        pendingNewSessionScrollResetRef.current = null;
        scrollToBottom('smooth');
      }
      return;
    }

    // `isAtBottom` is captured before a message update. Re-measuring after the
    // update can incorrectly mark a pinned user as unpinned, while smooth
    // scrolling on every render causes visible bottom-end bouncing.
    if (isAtBottom) {
      scrollToBottom('auto');
    }
  }, [
    currentSession.id,
    currentSession.messages,
    isAtBottom,
    isThinking,
    pendingEmptyResponseNotice,
    scrollToBottom,
    streamingResponse,
    subagentBatches,
    toolCallRecords,
  ]);

  // A remount after reload can race Virtuoso's first measurement. Re-apply the
  // initial bottom position after two animation frames, but never steal the
  // viewport from a user who has already scrolled away.
  useEffect(() => {
    if (
      !chatScrollParent ||
      currentSession.messages.length === 0 ||
      initialScrollSessionRef.current === currentSession.id
    ) {
      return;
    }

    initialScrollSessionRef.current = currentSession.id;
    let secondFrame: number | null = null;
    const firstFrame = window.requestAnimationFrame(() => {
      if (userScrolledRef.current) {
        return;
      }
      scrollToBottom('auto');
      secondFrame = window.requestAnimationFrame(() => {
        if (!userScrolledRef.current) {
          scrollToBottom('auto');
        }
      });
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame !== null) {
        window.cancelAnimationFrame(secondFrame);
      }
    };
  }, [chatScrollParent, currentSession.id, currentSession.messages.length, scrollToBottom]);

  useEffect(() => {
    let active = true;

    const loadInterruptedCheckpoint = async () => {
      if (!session.id) {
        if (active) {
          setInterruptedCheckpoint(null);
          setResumeProjectMissing(false);
          setAcknowledgeResumeBudget(false);
          setResumeError(null);
        }
        return;
      }

      const checkpoint = await getInterruptedForSession(session.id);
      if (!active) {
        return;
      }

      if (!checkpoint) {
        setInterruptedCheckpoint(null);
        setResumeProjectMissing(false);
        setAcknowledgeResumeBudget(false);
        setResumeError(null);
        return;
      }

      const lastCommitted = checkpoint.committedHistoryDelta.at(-1);
      if (
        checkpoint.status === 'complete' &&
        lastCommitted &&
        sameMessage(session.messages.at(-1), lastCommitted)
      ) {
        await deleteCheckpoint(checkpoint.runId);
        if (active) {
          setInterruptedCheckpoint(null);
          setResumeProjectMissing(false);
          setAcknowledgeResumeBudget(false);
          setResumeError(null);
        }
        return;
      }

      if (checkpoint.projectId) {
        const project = await htmlProjectStore.getProject(checkpoint.projectId);
        if (!active) {
          return;
        }

        if (!project) {
          setInterruptedCheckpoint(checkpoint);
          setResumeProjectMissing(true);
          setAcknowledgeResumeBudget(false);
          setResumeError(null);
          return;
        }
      }

      setInterruptedCheckpoint(checkpoint);
      setResumeProjectMissing(false);
      setAcknowledgeResumeBudget(false);
      if (checkpoint.budget) {
        setRunBudget({ ...DEFAULT_AGENT_RUN_BUDGET, ...checkpoint.budget });
      }
      setResumeError(null);
    };

    void loadInterruptedCheckpoint();

    return () => {
      active = false;
    };
  }, [session.id, session.messages]);

  useEffect(() => {
    const flushCheckpoint = () => {
      const flush = controllerRef.current?.flushCheckpoint(true);
      if (flush) {
        void flush.catch(error => {
          console.warn('Failed to flush agent run checkpoint:', error);
        });
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushCheckpoint();
      }
    };

    const handleBeforeUnload = (event: Event) => {
      if (controllerRef.current?.getState().status === 'running') {
        const beforeUnloadEvent = event as unknown as {
          preventDefault: () => void;
          returnValue: string;
        };
        flushCheckpoint();
        beforeUnloadEvent.preventDefault();
        beforeUnloadEvent.returnValue = '';
      }
    };

    window.addEventListener('pagehide', flushCheckpoint);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('pagehide', flushCheckpoint);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  const handleProjectToolActivity = (update: HtmlProjectWorkspaceUpdate) => {
    const currentProjectId = sessionRef.current.activeProjectId;
    const nextProjectId = update.activeProjectId ?? currentProjectId ?? null;

    setCurrentSession(prev => {
      const nextSession = {
        ...prev,
        activeProjectId: nextProjectId,
      };
      sessionRef.current = nextSession;
      return nextSession;
    });

    actions?.setActiveProject?.(nextProjectId);

    // A render update for the current project must not override a user's choice to hide
    // the Canvas. Only opening a different (including first) project may reveal it.
    if (nextProjectId !== currentProjectId) {
      actions?.setProjectWorkspaceOpen?.(Boolean(nextProjectId));
    }

    if (update.preview) {
      actions?.setProjectPreview?.(update.preview);
    }

    if (update.activityMessage) {
      actions?.appendProjectActivity?.(update.activityMessage);
    }
  };

  const handleSubagentActivity = (update: { batchId: string; runs: SubagentRunRecord[] }) => {
    const next = {
      ...subagentBatchesRef.current,
      [update.batchId]: update.runs,
    };
    subagentBatchesRef.current = next;
    setSubagentBatches(prev => {
      return {
        ...prev,
        [update.batchId]: update.runs,
      };
    });
  };

  const handleToolCallActivity = (record: ToolCallRecord) => {
    const existingIndex = toolCallRecordsRef.current.findIndex(item => item.id === record.id);
    const next =
      existingIndex === -1
        ? [...toolCallRecordsRef.current, record].slice(-50)
        : toolCallRecordsRef.current.map((item, index) =>
            index === existingIndex ? record : item,
          );
    toolCallRecordsRef.current = next;
    setToolCallRecords(next);

    if (
      record.name === DRAW_GEOMETRY_TOOL_NAME &&
      (record.status === 'failed' || record.status === 'recoverable_error')
    ) {
      setStreamingGeometryBoards(previous => previous.filter(board => board.id !== record.id));
    }

    if (
      record.name === SPEAK_TEXT_TOOL_NAME &&
      (record.status === 'failed' || record.status === 'recoverable_error')
    ) {
      setStreamingSpeechUtterances(previous =>
        previous.filter(utterance => utterance.id !== record.id),
      );
    }
  };

  const handleGeometryBoardPreview = ({
    toolCallId,
    document,
  }: {
    toolCallId: string;
    document: GeometryDoc;
  }) => {
    const board: GeometryBoardRecord = {
      id: toolCallId,
      title: document.title,
      doc: document,
      computedPoints: [],
    };

    setStreamingGeometryBoards(previous => {
      const existingIndex = previous.findIndex(item => item.id === toolCallId);
      if (existingIndex === -1) {
        return [...previous, board];
      }

      const next = [...previous];
      next[existingIndex] = board;
      return next;
    });
  };

  const handleSpeechUtterancePreview = ({
    toolCallId,
    document,
  }: {
    toolCallId: string;
    document: SpeechUtteranceDoc;
  }) => {
    const utterance: SpeechUtteranceRecord = {
      id: toolCallId,
      title: document.title,
      doc: document,
    };

    setStreamingSpeechUtterances(previous => {
      const existingIndex = previous.findIndex(item => item.id === toolCallId);
      if (existingIndex === -1) {
        return [...previous, utterance];
      }

      const next = [...previous];
      next[existingIndex] = utterance;
      return next;
    });
  };

  const buildAssistantMessage = (content: string, extras?: Partial<ChatMessage>): ChatMessage => ({
    role: 'model',
    content,
    timestamp: Date.now(),
    subagentRuns: Object.values(subagentBatchesRef.current).flatMap(runs => runs),
    toolCallLog: toolCallRecordsRef.current.slice(-50),
    ...extras,
  });

  const loadRetainedCheckpoint = async (runId: string) => {
    const checkpoint = await getCheckpoint(runId);
    setInterruptedCheckpoint(checkpoint ?? null);
    setAcknowledgeResumeBudget(false);
    if (!checkpoint) {
      setResumeProjectMissing(false);
      setResumeError(null);
      return;
    }

    if (checkpoint.projectId) {
      const project = await htmlProjectStore.getProject(checkpoint.projectId);
      setResumeProjectMissing(!project);
    } else {
      setResumeProjectMissing(false);
    }
    if (checkpoint.budget) {
      setRunBudget({ ...DEFAULT_AGENT_RUN_BUDGET, ...checkpoint.budget });
    }
    setResumeError(null);
  };

  const persistCheckpointArchive = async (
    checkpoint: AgentRunCheckpoint,
    options?: { clearProject?: boolean },
  ): Promise<void> => {
    const mergedMessages = mergeCheckpointMessages(sessionRef.current.messages, checkpoint, true);
    const nextSession = {
      ...sessionRef.current,
      activeProjectId: options?.clearProject
        ? null
        : (sessionRef.current.activeProjectId ?? checkpoint.projectId),
      messages: mergedMessages,
      title: updateSessionTitle(sessionRef.current.title, checkpoint.originalMessage),
      updatedAt: Date.now(),
    };

    await actions?.updateSession?.(nextSession);
    sessionRef.current = nextSession;
    setCurrentSession(nextSession);

    if (options?.clearProject) {
      actions?.setActiveProject?.(null);
      actions?.setProjectWorkspaceOpen?.(false);
      actions?.clearProjectWorkspace?.();
    }

    await deleteCheckpoint(checkpoint.runId);
    setInterruptedCheckpoint(null);
    setResumeProjectMissing(false);
    setAcknowledgeResumeBudget(false);
    setResumeError(null);
  };

  const executeRun = async ({
    message,
    attachments,
    displaySession,
    historyMessages,
    resumeCheckpoint,
    submittedDraft,
  }: {
    message: string;
    attachments?: MessageAttachment[];
    displaySession: typeof currentSession;
    historyMessages: ChatMessage[];
    resumeCheckpoint?: AgentRunCheckpoint;
    submittedDraft?: SubmittedDraft;
  }): Promise<boolean> => {
    setIsLoading(true);
    setIsThinking(true);
    streamingBufferRef.current = '';
    setStreamingResponse('');
    setPendingEmptyResponseNotice(null);
    latestErrorMessageRef.current = null;
    routeProposalRef.current = undefined;
    setRunState(null);
    setSubagentBatches({});
    setToolCallRecords([]);
    setStreamingGeometryBoards([]);
    setStreamingSpeechUtterances([]);
    setStreamingImages([]);
    setResumeError(null);
    actions?.setAgentRunState?.(null);

    sessionRef.current = displaySession;
    setCurrentSession(displaySession);
    // Run 綁定它啟動時的 session:commit 與即時 callback 都以此判斷是否仍顯示中,
    // 避免使用者中途切換 session 時把結果或串流寫進別的 session。
    const runToken = {};
    activeRunSessionsRef.current.set(displaySession.id, {
      session: displaySession,
      token: runToken,
    });
    setActiveRunRevision(revision => revision + 1);
    const isRunSessionDisplayed = () => sessionRef.current.id === displaySession.id;
    let runController: AgentRunController | null = null;

    try {
      setStatusText(ragChunks.length > 0 ? '🔎 搜尋知識庫中...' : '🤖 生成回答...');

      const sanitizedHistoryMessages = historyMessages.filter(
        messageItem => !isErrorMessage(messageItem),
      );
      const chatHistory: ChatMessage[] = sanitizedHistoryMessages;
      let enhancedSystemPrompt = systemPrompt;

      if (displaySession.handoffContext) {
        const handoff = displaySession.handoffContext;
        enhancedSystemPrompt += `\n\n[HANDOFF FROM ${handoff.fromAssistantName}]\nReason: ${handoff.reason}\nSummary: ${handoff.summary}`;
      }

      if (displaySession.compactContext) {
        const compactedContextPrompt = `\n\n[PREVIOUS CONVERSATION SUMMARY]\n${displaySession.compactContext.content}\n\nThe above is a summary of our previous conversation. Please refer to this context when responding to continue our conversation naturally.\n\n[CURRENT CONVERSATION]`;

        enhancedSystemPrompt = `${enhancedSystemPrompt}${compactedContextPrompt}`;
      }

      // 專用工具模式完全停用 HTML 專案，避免多套 function calling 工具互相干擾。
      // resume checkpoint 的 flag 代表原 run 的權威設定。
      const effectiveMathToolsEnabled = resumeCheckpoint?.mathToolsEnabled ?? mathToolsEnabled;
      const effectiveWebSpeechToolsEnabled =
        resumeCheckpoint?.webSpeechToolsEnabled ?? webSpeechToolsEnabled;
      const htmlProjectAccessEnabled =
        !effectiveMathToolsEnabled && !effectiveWebSpeechToolsEnabled;
      const effectiveProjectId = htmlProjectAccessEnabled
        ? (resumeCheckpoint?.projectId ?? displaySession.activeProjectId ?? null)
        : null;
      const projectEditingActive = Boolean(effectiveProjectId);

      const currentAssistant = appContext?.state?.currentAssistant;
      const routableTargets =
        routableTargetsOverride ??
        (currentAssistant
          ? sharedMode
            ? getCachedSharedRoutableTargets(currentAssistant)
            : resolveRoutableTargets(currentAssistant, appContext.state.assistants)
          : []);

      const controller = new AgentRunController({
        assistantId,
        sessionId: displaySession.id,
        activeProjectId: effectiveProjectId,
        systemPrompt: enhancedSystemPrompt,
        history: chatHistory,
        message,
        attachments,
        knowledgeChunks: ragChunks,
        agentHarnessEnabled:
          htmlProjectAccessEnabled &&
          (resumeCheckpoint?.agentHarnessEnabled ?? projectEditingActive),
        subagentDelegationEnabled:
          resumeCheckpoint?.subagentDelegationEnabled ?? subagentDelegationEnabled,
        mathToolsEnabled: effectiveMathToolsEnabled,
        webSpeechToolsEnabled: effectiveWebSpeechToolsEnabled,
        routableTargets: resumeCheckpoint?.routableTargets ?? routableTargets,
        htmlProjectEnabled:
          htmlProjectAccessEnabled &&
          (resumeCheckpoint?.htmlProjectEnabled ?? projectEditingActive),
        // 未開啟專案時,提供 createProject bootstrap 工具讓模型自行建立專案;
        // 數學模式、已綁定專案或 shared 模式(無 canvas workspace)時皆停用。
        projectBootstrapEnabled:
          htmlProjectAccessEnabled &&
          (resumeCheckpoint?.projectBootstrapEnabled ?? (!projectEditingActive && !isSandboxMode)),
        sharedMode: resumeCheckpoint?.sharedMode ?? isSandboxMode,
        budget: runBudget,
        resumeFrom: resumeCheckpoint,
        acknowledgeResumeBudget: resumeCheckpoint ? acknowledgeResumeBudget : undefined,
        callbacks: {
          // 即時 callback 只在 run 的 session 仍顯示中時更新 UI;
          // 切換 session 後這些串流/活動屬於背景 run,不得渲染進新 session 的畫面。
          onChunk: chunk => {
            if (!isRunSessionDisplayed()) {
              return;
            }
            if (isThinkingRef.current) {
              setIsThinking(false);
            }
            streamingBufferRef.current += chunk;
            scheduleStreamingFlush();
          },
          onImages: images => {
            if (!isRunSessionDisplayed()) {
              return;
            }
            setStreamingImages(previous => {
              const next = [...previous];
              for (const image of images) {
                if (!next.some(existing => existing.url === image.url)) {
                  next.push(image);
                }
              }
              return next;
            });
          },
          onProjectToolActivity: update => {
            if (!isRunSessionDisplayed()) {
              return;
            }
            handleProjectToolActivity(update);
          },
          onSubagentActivity: update => {
            if (!isRunSessionDisplayed()) {
              return;
            }
            handleSubagentActivity(update);
          },
          onGeometryBoardPreview: preview => {
            if (!isRunSessionDisplayed()) {
              return;
            }
            handleGeometryBoardPreview(preview);
          },
          onSpeechUtterancePreview: preview => {
            if (!isRunSessionDisplayed()) {
              return;
            }
            handleSpeechUtterancePreview(preview);
          },
          onToolCallActivity: record => {
            if (!isRunSessionDisplayed()) {
              return;
            }
            handleToolCallActivity(record);
          },
          onRouteProposal: proposal => {
            routeProposalRef.current = proposal;
          },
          onStateChange: nextState => {
            if (!isRunSessionDisplayed()) {
              return;
            }
            setRunState(nextState);
            actions?.setAgentRunState?.(nextState);
          },
          onError: error => {
            console.error('AgentRunController error:', error);
            latestErrorMessageRef.current = error.message;
          },
        },
      });
      runController = controller;
      controllerRef.current = controller;

      const tokenInfoForPersistence = (result: AgentRunResult): AgentRunResult['tokenInfo'] => {
        const previousPromptTokens = resumeCheckpoint?.tokenTotals.promptTokenCount ?? 0;
        const previousCandidateTokens = resumeCheckpoint?.tokenTotals.candidatesTokenCount ?? 0;
        const promptTokenCount =
          resumeCheckpoint && result.tokenInfo.promptTokenCount >= previousPromptTokens
            ? result.tokenInfo.promptTokenCount - previousPromptTokens
            : result.tokenInfo.promptTokenCount;
        const candidatesTokenCount =
          resumeCheckpoint && result.tokenInfo.candidatesTokenCount >= previousCandidateTokens
            ? result.tokenInfo.candidatesTokenCount - previousCandidateTokens
            : result.tokenInfo.candidatesTokenCount;
        return {
          ...result.tokenInfo,
          promptTokenCount,
          candidatesTokenCount,
        };
      };

      const commitRunResult = async (): Promise<boolean> => {
        runOwnershipSessionIdRef.current = displaySession.id;
        const result = await controller.run();
        const persistenceTokenInfo = tokenInfoForPersistence(result);
        const persistedToolCallLog = toolCallRecordsRef.current.slice(-50);
        const persistedSubagentRuns = Object.values(subagentBatchesRef.current).flatMap(
          runs => runs,
        );
        const persistedActivity = {
          toolCallLog: persistedToolCallLog,
          subagentRuns: persistedSubagentRuns,
        };
        const checkpointPersistenceFailed =
          result.state.failureCode === 'checkpoint-persistence-failed' ||
          result.state.failure?.code === 'checkpoint-persistence-failed';
        const runDisplayed = isRunSessionDisplayed();
        const clearNonResumableCheckpoint = () => {
          if (!runDisplayed) {
            return;
          }
          setInterruptedCheckpoint(null);
          setResumeProjectMissing(false);
          setAcknowledgeResumeBudget(false);
          setResumeError('這次工作無法安全保存續跑紀錄，因此不提供續跑。請重新送出訊息。');
        };
        const ownsController = controllerRef.current === controller;
        if (ownsController) {
          controllerRef.current = null;
        }

        // Run 期間使用者可能已切到別的 session:結果仍持久化回 run 自己的 session,
        // 但顯示中 session 的 UI state 不得被舊 run 覆寫。
        const runOwnsUi = ownsController || runDisplayed;
        if (runOwnsUi) {
          flushStreamingBuffer();
        }
        const baseSession =
          activeRunSessionsRef.current.get(displaySession.id)?.session ?? displaySession;

        if (runDisplayed) {
          setRunState(result.state);
          actions?.setAgentRunState?.(result.state);
        }
        if (runOwnsUi) {
          setIsLoading(false);
          setIsThinking(false);
          setStatusText('');
          setStreamingResponse('');
          setStreamingGeometryBoards([]);
          setStreamingSpeechUtterances([]);
          setStreamingImages([]);
        }
        const fullModelResponse = result.fullText.trim();
        const completedRunId = resumeCheckpoint?.runId ?? result.state.runId;
        const latestErrorMessage = latestErrorMessageRef.current;
        const shouldPersistError = Boolean(latestErrorMessage) || result.state.status === 'failed';

        if (shouldPersistError) {
          const errorMessage = buildAssistantMessage(
            latestErrorMessage ?? '執行過程發生錯誤，請稍後再試。',
            { ...persistedActivity, isError: true },
          );
          const finalSession = applyTokenUsageToSession(
            {
              ...baseSession,
              messages: [...baseSession.messages, errorMessage],
            },
            persistenceTokenInfo,
          );
          if (runDisplayed) {
            sessionRef.current = finalSession;
            setCurrentSession(finalSession);
          }
          if (runOwnsUi) {
            setSubagentBatches({});
            setToolCallRecords([]);
          }
          await onNewMessage(finalSession, message, errorMessage.content, persistenceTokenInfo);
          if (runDisplayed) {
            if (checkpointPersistenceFailed) {
              clearNonResumableCheckpoint();
            } else {
              await loadRetainedCheckpoint(result.state.runId);
            }
          }
          return false;
        }

        if (fullModelResponse === '') {
          const hasArtifacts =
            (result.geometryBoards?.length ?? 0) > 0 ||
            (result.speechUtterances?.length ?? 0) > 0 ||
            (result.images?.length ?? 0) > 0 ||
            persistedToolCallLog.length > 0 ||
            persistedSubagentRuns.length > 0;
          const artifactMessage =
            hasArtifacts || (result.citations?.length ?? 0) > 0
              ? buildAssistantMessage('', {
                  ...persistedActivity,
                  citations: result.citations,
                  geometryBoards: result.geometryBoards,
                  speechUtterances: result.speechUtterances,
                  images: result.images,
                  routeProposal: routeProposalRef.current,
                })
              : undefined;
          const completedHistory = appendWithoutDuplicateTail(
            baseSession.messages,
            result.historyDelta,
          );
          const lastCompletedMessage = completedHistory.at(-1);
          const persistedMessages =
            artifactMessage && lastCompletedMessage?.role === 'model'
              ? [...completedHistory.slice(0, -1), { ...lastCompletedMessage, ...artifactMessage }]
              : artifactMessage
                ? [...completedHistory, artifactMessage]
                : completedHistory;
          const finalSession = applyTokenUsageToSession(
            {
              ...baseSession,
              messages: persistedMessages,
            },
            persistenceTokenInfo,
          );
          if (runDisplayed) {
            sessionRef.current = finalSession;
            setCurrentSession(finalSession);
            setPendingEmptyResponseNotice(artifactMessage ? null : EMPTY_RESPONSE_NOTICE);
          }
          if (runOwnsUi) {
            setSubagentBatches({});
            setToolCallRecords([]);
          }
          await onNewMessage(finalSession, message, '', persistenceTokenInfo);
          if (result.state.status === 'complete') {
            await deleteCheckpoint(completedRunId);
            if (runDisplayed) {
              setInterruptedCheckpoint(null);
              setResumeProjectMissing(false);
              setAcknowledgeResumeBudget(false);
            }
          } else if (runDisplayed) {
            if (checkpointPersistenceFailed) {
              clearNonResumableCheckpoint();
            } else {
              await loadRetainedCheckpoint(result.state.runId);
            }
          }
          return result.state.status === 'complete';
        }

        const newAiMessage = buildAssistantMessage(fullModelResponse, {
          ...persistedActivity,
          citations: result.citations,
          geometryBoards: result.geometryBoards,
          speechUtterances: result.speechUtterances,
          images: result.images,
          routeProposal: routeProposalRef.current,
        });
        const finalSession = applyTokenUsageToSession(
          {
            ...baseSession,
            messages: [...baseSession.messages, newAiMessage],
          },
          persistenceTokenInfo,
        );

        if (runDisplayed) {
          sessionRef.current = finalSession;
          setCurrentSession(finalSession);
        }
        if (runOwnsUi) {
          setSubagentBatches({});
          setToolCallRecords([]);
        }
        try {
          await onNewMessage(finalSession, message, fullModelResponse, persistenceTokenInfo);
        } catch (persistError) {
          latestErrorMessageRef.current = (persistError as Error).message;
          throw persistError;
        }

        if (result.state.status === 'complete') {
          await deleteCheckpoint(completedRunId);
          if (runDisplayed) {
            setInterruptedCheckpoint(null);
            setResumeProjectMissing(false);
            setAcknowledgeResumeBudget(false);
          }
        } else if (runDisplayed) {
          // 未顯示中時不動 resume 橫幅;回到原 session 時由 loadInterruptedCheckpoint 效果載入。
          if (checkpointPersistenceFailed) {
            clearNonResumableCheckpoint();
          } else {
            await loadRetainedCheckpoint(result.state.runId);
          }
        }
        return result.state.status === 'complete';
      };

      const lockLease = await acquireWorkspaceRunLock(LOCAL_WORKSPACE_RUN_ID, {
        ifAvailable: true,
      });
      if (!lockLease.acquired) {
        if (controllerRef.current === controller) {
          controllerRef.current = null;
        }
        setIsLoading(false);
        setIsThinking(false);
        setStatusText('');
        setRunState(null);
        actions?.setAgentRunState?.(null);
        setResumeError(
          resumeCheckpoint
            ? '工作仍在其他分頁進行中，或目前瀏覽器不支援安全的工作鎖；未送出模型請求。'
            : '目前無法取得工作鎖（可能已有其他分頁執行，或瀏覽器不支援安全鎖）；未送出模型請求。',
        );
        return false;
      }

      try {
        // Keep the workspace lease through provider execution and the final
        // session/checkpoint persistence so another tab cannot race the commit.
        return await commitRunResult();
      } finally {
        lockLease.release();
      }
    } catch (error) {
      const ownsController = runController !== null && controllerRef.current === runController;
      if (ownsController) {
        controllerRef.current = null;
      }
      const runDisplayed = isRunSessionDisplayed();
      const runOwnsUi = ownsController || runDisplayed;
      if (runOwnsUi) {
        flushStreamingBuffer();
      }
      const errorMessageText = (error as Error).message;
      console.error('Error during chat stream:', error);
      latestErrorMessageRef.current = errorMessageText;
      if (runOwnsUi) {
        setIsLoading(false);
        setIsThinking(false);
        setStatusText('');
        setRunState(null);
        actions?.setAgentRunState?.(null);
        setStreamingResponse('');
        setStreamingGeometryBoards([]);
        setStreamingSpeechUtterances([]);
        setSubagentBatches({});
        setToolCallRecords([]);
      }

      const baseSession =
        activeRunSessionsRef.current.get(displaySession.id)?.session ?? displaySession;
      const classification = classifyChatError(errorMessageText, bundleStrings.errors);
      const errorMessage = buildAssistantMessage(
        `${classification.message}\n\n（${errorMessageText}）`,
        { isError: true },
      );
      // Retain unsent input only for the run owner still shown in this editor;
      // a late run from session A must never restore its text into session B.
      const canRestoreSubmittedInput =
        runDisplayed &&
        (!submittedDraft ||
          (submittedDraft.sessionId === sessionRef.current.id &&
            submittedDraft.ownerId === draftKeyRef.current));
      if (canRestoreSubmittedInput) {
        setInputValue(message);
        if (attachments?.length) {
          setPendingAttachments(attachments);
        }
      }
      const finalSession = {
        ...baseSession,
        messages: [...baseSession.messages, errorMessage],
      };
      if (runDisplayed) {
        sessionRef.current = finalSession;
        setCurrentSession(finalSession);
      }
      await onNewMessage(finalSession, message, errorMessage.content, {
        promptTokenCount: 0,
        candidatesTokenCount: 0,
      });
      return false;
    } finally {
      if (runOwnershipSessionIdRef.current === displaySession.id) {
        runOwnershipSessionIdRef.current = null;
      }
      const activeRun = activeRunSessionsRef.current.get(displaySession.id);
      if (activeRun?.token === runToken) {
        activeRunSessionsRef.current.delete(displaySession.id);
      }
      setActiveRunRevision(revision => revision + 1);
    }
  };

  const isCurrentDraftOwner = (submission: SubmittedDraft): boolean =>
    sessionRef.current.id === submission.sessionId && draftKeyRef.current === submission.ownerId;

  const clearCapturedDraft = async (submission: SubmittedDraft): Promise<void> => {
    const mode = await clearWorkspaceDraftAsync('chat', submission.ownerId);
    if (draftKeyRef.current === submission.ownerId) {
      setDraftPersistenceMode(mode);
    }
  };

  const clearPendingSubmission = (submission: SubmittedDraft): void => {
    const pending = pendingSubmittedDraftRef.current;
    if (
      pending?.ownerId === submission.ownerId &&
      pending.sessionId === submission.sessionId &&
      pending.text === submission.text
    ) {
      pendingSubmittedDraftRef.current = null;
    }
  };

  const handleSend = async () => {
    const attachments = imageInputSupported ? pendingAttachments : [];
    if ((!input.trim() && attachments.length === 0) || isLoading || inputUnavailable) {
      return;
    }

    const userMessage = input.trim();
    const submittedDraft: SubmittedDraft = {
      ownerId: draftKeyRef.current,
      sessionId: sessionRef.current.id,
      text: userMessage,
    };
    pendingSubmittedDraftRef.current = submittedDraft;
    setInputValue('');
    setPendingAttachments([]);
    setAttachmentError(null);
    setPendingEmptyResponseNotice(null);

    try {
      if (interruptedCheckpoint) {
        await persistCheckpointArchive(interruptedCheckpoint, {
          clearProject: resumeProjectMissing && Boolean(interruptedCheckpoint.projectId),
        });
      }

      const baseSession = sessionRef.current;
      const newUserMessage: ChatMessage = {
        role: 'user',
        content: userMessage,
        timestamp: Date.now(),
        ...(attachments.length > 0 ? { attachments } : {}),
      };
      const updatedSession = {
        ...baseSession,
        messages: [...baseSession.messages, newUserMessage],
      };

      const sent = await executeRun({
        message: userMessage,
        attachments: attachments.length > 0 ? attachments : undefined,
        displaySession: updatedSession,
        historyMessages: baseSession.messages.filter(
          messageItem => !isSyntheticMessage(messageItem),
        ),
        submittedDraft,
      });
      clearPendingSubmission(submittedDraft);
      if (draftPersistenceEnabled) {
        if (sent) {
          await clearCapturedDraft(submittedDraft);
        } else if (isCurrentDraftOwner(submittedDraft) && !inputRef.current.trim()) {
          setInputValue(userMessage);
        }
      } else if (!sent && isCurrentDraftOwner(submittedDraft) && !inputRef.current.trim()) {
        setInputValue(userMessage);
      }
    } catch (error) {
      clearPendingSubmission(submittedDraft);
      if (isCurrentDraftOwner(submittedDraft) && !inputRef.current.trim()) {
        setInputValue(userMessage);
      }
      throw error;
    }
  };

  const handleResume = async () => {
    if (
      !interruptedCheckpoint ||
      resumeUnavailableReason ||
      (resumeBudgetAcknowledgementRequired && !acknowledgeResumeBudget)
    ) {
      return;
    }

    setPendingEmptyResponseNotice(null);

    const baseSession = sessionRef.current;
    const mergedSession = {
      ...baseSession,
      messages: mergeCheckpointMessages(baseSession.messages, interruptedCheckpoint, false),
      title: updateSessionTitle(baseSession.title, interruptedCheckpoint.originalMessage),
      updatedAt: Date.now(),
    };

    const submittedDraft: SubmittedDraft = {
      ownerId: draftKeyRef.current,
      sessionId: sessionRef.current.id,
      text: interruptedCheckpoint.originalMessage,
    };
    const sent = await executeRun({
      message: interruptedCheckpoint.originalMessage,
      displaySession: mergedSession,
      historyMessages:
        interruptedCheckpoint.turnIndex === 0
          ? baseSession.messages.filter(messageItem => !isSyntheticMessage(messageItem))
          : mergedSession.messages,
      resumeCheckpoint: interruptedCheckpoint,
      submittedDraft,
    });
    if (sent && draftPersistenceEnabled) {
      await clearCapturedDraft(submittedDraft);
    }
  };

  const handleDiscardInterruptedRun = async () => {
    if (!interruptedCheckpoint) {
      return;
    }

    await persistCheckpointArchive(interruptedCheckpoint, {
      clearProject: resumeProjectMissing && Boolean(interruptedCheckpoint.projectId),
    });
  };

  const handleStop = () => {
    controllerRef.current?.stop('user-stop');
  };

  const executeRunRef = useRef(executeRun);
  useEffect(() => {
    executeRunRef.current = executeRun;
  });

  // 轉接被接受後,自動以 handoff summary 送出第一則訊息:使用者不必重打問題,
  // 且第一回合的知識檢索 (gatherKnowledge 以首則訊息為 query) 能取得原始需求背景。
  useEffect(() => {
    const handoff = currentSession.handoffContext;
    if (
      !handoff?.summary ||
      currentSession.messages.length > 0 ||
      isLoading ||
      activeRunSessionsRef.current.size > 0 ||
      handoffKickoffSessionIdRef.current === currentSession.id
    ) {
      return;
    }
    handoffKickoffSessionIdRef.current = currentSession.id;

    const kickoffMessage: ChatMessage = {
      role: 'user',
      content: handoff.summary,
      timestamp: Date.now(),
    };
    void executeRunRef.current({
      message: handoff.summary,
      displaySession: { ...currentSession, messages: [kickoffMessage] },
      historyMessages: [],
    });
  }, [activeRunRevision, currentSession, isLoading]);

  const handlePromptSelect = async (prompt: string) => {
    if (isLoading || inputUnavailable) {
      return;
    }

    const submittedDraft: SubmittedDraft = {
      ownerId: draftKeyRef.current,
      sessionId: sessionRef.current.id,
      text: prompt,
    };
    pendingSubmittedDraftRef.current = submittedDraft;
    setInputValue(prompt);
    try {
      const baseSession = sessionRef.current;
      const newUserMessage: ChatMessage = {
        role: 'user',
        content: prompt,
        timestamp: Date.now(),
      };
      const updatedSession = {
        ...baseSession,
        messages: [...baseSession.messages, newUserMessage],
      };

      const sent = await executeRun({
        message: prompt,
        displaySession: updatedSession,
        historyMessages: baseSession.messages.filter(
          messageItem => !isSyntheticMessage(messageItem),
        ),
        submittedDraft,
      });
      clearPendingSubmission(submittedDraft);
      if (sent) {
        if (isCurrentDraftOwner(submittedDraft)) {
          setInputValue('');
        }
        if (draftPersistenceEnabled) {
          await clearCapturedDraft(submittedDraft);
        }
      }
    } catch (error) {
      clearPendingSubmission(submittedDraft);
      throw error;
    }
  };

  const citationContentsById = useMemo(
    () =>
      Object.fromEntries(
        buildIndexedKnowledgeChunks(ragChunks).map(chunk => [chunk.chunkId, chunk.content]),
      ),
    [ragChunks],
  );

  const isRunning = runState?.status === 'running';
  const hasLiveActivity =
    toolCallRecords.length > 0 ||
    streamingGeometryBoards.length > 0 ||
    streamingSpeechUtterances.length > 0 ||
    streamingImages.length > 0 ||
    Object.values(subagentBatches).some(runs => runs.length > 0);
  const showStreamingResponse =
    streamingResponse !== '' || streamingImages.length > 0 || (isLoading && hasLiveActivity);
  const interruptedTurnLabel = interruptedCheckpoint
    ? `${Math.min(interruptedCheckpoint.turnIndex + 1, interruptedCheckpoint.maxTurns)}/${interruptedCheckpoint.maxTurns}`
    : null;
  const showJumpToLatest =
    !isAtBottom && (isThinking || streamingResponse !== '' || currentSession.messages.length > 0);

  return (
    <div className='relative flex h-full min-h-0 flex-1 flex-col bg-gray-900'>
      {!hideHeader && (
        <div className='flex-shrink-0 border-b border-gray-700 bg-gray-800 px-4 py-3 md:px-6 md:py-4'>
          <div className='flex items-center justify-between'>
            <h2 className='mr-2 truncate text-lg font-semibold text-white md:text-xl'>
              {assistantName}
            </h2>
            <div className='flex items-center space-x-3'>
              {headerActions}
              {isSandboxMode && (
                <button
                  onClick={async () => {
                    if (onCreateSession) {
                      await onCreateSession();
                      return;
                    }
                    await actions?.createNewSession?.(assistantId);
                    const resetSession = {
                      ...currentSession,
                      messages: [],
                      tokenCount: 0,
                      tokenUsage: undefined,
                      activeProjectId: null,
                    };
                    setCurrentSession(resetSession);
                    sessionRef.current = resetSession;
                    actions?.clearProjectWorkspace?.();
                    actions?.setAgentRunState?.(null);
                    setRunState(null);
                    setStreamingResponse('');
                    setStreamingSpeechUtterances([]);
                    setPendingEmptyResponseNotice(null);
                    setIsThinking(false);
                    setStatusText('');
                    setInputValue('');
                    setInterruptedCheckpoint(null);
                    setResumeProjectMissing(false);
                    setAcknowledgeResumeBudget(false);
                    setResumeError(null);
                  }}
                  className='flex min-h-11 items-center space-x-1 rounded-lg bg-purple-700 px-3 py-2 text-sm font-medium text-purple-100 transition-colors hover:bg-purple-600 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300 md:space-x-2 md:px-4'
                  title='開啟新對話'
                >
                  <svg
                    className='h-3 w-3 md:h-4 md:w-4'
                    fill='none'
                    stroke='currentColor'
                    viewBox='0 0 24 24'
                  >
                    <path
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      strokeWidth={2}
                      d='M12 4v16m8-8H4'
                    />
                  </svg>
                  <span className='hidden sm:inline'>新對話</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <main
        ref={containerRef}
        onScroll={handleChatScroll}
        className='chat-scroll flex-1 overflow-y-auto'
        role='main'
        aria-label='聊天對話'
      >
        <div className='mx-auto max-w-4xl px-4 py-5 md:px-6 md:py-8'>
          {!hideHeader && (
            <details
              open={agentRunControlsOpen || Boolean(interruptedCheckpoint)}
              onToggle={event => setAgentRunControlsOpen(event.currentTarget.open)}
              className='agent-run-controls-shell mb-4 rounded-2xl border border-gray-800 bg-gray-900/60 p-3 text-sm text-gray-100 md:p-4'
              data-testid='agent-run-controls-details'
            >
              <summary className='agent-run-controls-shell__summary cursor-pointer list-none rounded-lg px-1 py-1 text-sm font-semibold text-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 [&::-webkit-details-marker]:hidden'>
                Agent 執行設定/用量
              </summary>
              <AgentRunControls
                budget={runBudget}
                onBudgetChange={setRunBudget}
                state={controlsState}
                checkpoint={interruptedCheckpoint}
                disabled={isLoading}
                className='mt-3'
              />
            </details>
          )}
          {resumeError && !interruptedCheckpoint && (
            <div
              className='mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100'
              role='alert'
              data-testid='agent-run-error'
            >
              {resumeError}
            </div>
          )}
          {interruptedCheckpoint && (
            <div
              className='mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100'
              data-testid='resume-run-banner'
            >
              <div className='flex flex-col gap-3 md:flex-row md:items-center md:justify-between'>
                <div>
                  <p className='font-semibold'>偵測到中斷的 Agent 工作</p>
                  <p className='mt-1 text-amber-100/90'>
                    上次工作在第 {interruptedTurnLabel}{' '}
                    回合中斷。您可以繼續執行，或先將中斷前紀錄封存到對話中後捨棄這次工作。
                  </p>
                  {resumeUnavailableReason && (
                    <p className='mt-2 text-amber-200'>{resumeUnavailableReason}</p>
                  )}
                  {resumeError && (
                    <p className='mt-2 text-rose-200' role='alert'>
                      {resumeError}
                    </p>
                  )}
                  {resumeBudgetAcknowledgementRequired && (
                    <label className='mt-3 flex items-start gap-2 text-xs text-amber-50'>
                      <input
                        type='checkbox'
                        checked={acknowledgeResumeBudget}
                        onChange={event => setAcknowledgeResumeBudget(event.target.checked)}
                        disabled={isLoading}
                        className='mt-0.5 h-4 w-4 rounded border-amber-200/50 bg-gray-900 text-cyan-500 focus:ring-cyan-400'
                      />
                      <span>
                        我了解這筆舊紀錄的工具用量可能不完整，並明確允許在目前軟預算下續跑。
                      </span>
                    </label>
                  )}
                  {interruptedCheckpoint.partialText && (
                    <details className='mt-2'>
                      <summary className='cursor-pointer text-amber-50'>
                        查看中斷時的部分輸出
                      </summary>
                      <pre className='mt-2 whitespace-pre-wrap rounded-lg bg-gray-900/40 p-3 text-xs text-amber-50'>
                        {interruptedCheckpoint.partialText}
                      </pre>
                    </details>
                  )}
                </div>
                <div className='flex flex-wrap gap-2'>
                  <button
                    type='button'
                    onClick={() => void handleResume()}
                    disabled={
                      Boolean(resumeUnavailableReason) ||
                      (resumeBudgetAcknowledgementRequired && !acknowledgeResumeBudget) ||
                      isLoading
                    }
                    className='rounded-lg bg-cyan-600 px-4 py-2 font-medium text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50'
                  >
                    繼續
                  </button>
                  <button
                    type='button'
                    onClick={() => void handleDiscardInterruptedRun()}
                    className='rounded-lg border border-amber-200/40 px-4 py-2 font-medium text-amber-50 transition hover:bg-amber-100/10'
                  >
                    捨棄並封存
                  </button>
                </div>
              </div>
            </div>
          )}

          {currentSession.handoffContext && (
            <details className='mb-4 rounded-xl border border-cyan-500/25 bg-cyan-950/20 px-4 py-3 text-sm text-cyan-100'>
              <summary className='cursor-pointer font-medium'>
                由 {currentSession.handoffContext.fromAssistantName} 轉接而來
              </summary>
              <p className='mt-2 text-gray-300'>{currentSession.handoffContext.reason}</p>
            </details>
          )}

          {currentSession.messages.length === 0 &&
            !streamingResponse &&
            !isThinking &&
            !pendingEmptyResponseNotice && (
              <WelcomeMessage
                assistantName={assistantName}
                assistantDescription={assistantDescription}
                sharedMode={isSandboxMode}
                starterPrompts={starterPrompts}
                onPromptSelect={prompt => {
                  void handlePromptSelect(prompt);
                }}
              />
            )}

          <div role='log' aria-label='訊息列表' aria-live='polite' aria-relevant='additions text'>
            {chatScrollParent && (
              <Virtuoso
                ref={virtuosoRef}
                data={currentSession.messages}
                customScrollParent={chatScrollParent}
                computeItemKey={(index: number) => `${currentSession.id}:${index}`}
                followOutput={isAtBottom ? 'auto' : false}
                atBottomStateChange={() => {
                  updatePinnedState();
                }}
                itemContent={(index: number, msg: ChatMessage) => {
                  if (!msg) {
                    return null;
                  }
                  return (
                    <div className='mb-6' data-message-index={index}>
                      <MessageBubble
                        message={msg}
                        index={index}
                        assistantName={assistantName}
                        citationContentsById={citationContentsById}
                        onAcceptRouteProposal={onAcceptRouteProposal}
                        onDeclineRouteProposal={onDeclineRouteProposal}
                      />
                    </div>
                  );
                }}
              />
            )}

            {isThinking && !streamingResponse && !hasLiveActivity && (
              <ThinkingIndicator assistantName={assistantName} statusText={statusText} />
            )}

            {showStreamingResponse && (
              <StreamingResponse
                content={streamingResponse}
                images={streamingImages}
                assistantName={assistantName}
                subagentBatches={subagentBatches}
                toolCallLog={toolCallRecords}
                geometryBoards={streamingGeometryBoards}
                speechUtterances={streamingSpeechUtterances}
              />
            )}

            {pendingEmptyResponseNotice && (
              <div className='flex justify-start'>
                <div className='w-full max-w-3xl'>
                  <div className='ml-13 rounded-lg border border-dashed border-gray-700/60 bg-gray-900/40 px-4 py-3 text-base leading-7 text-gray-300'>
                    {pendingEmptyResponseNotice}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      {showJumpToLatest && (
        <button
          type='button'
          onClick={() => scrollToBottom('smooth')}
          className='absolute bottom-28 right-4 z-10 min-h-11 rounded-full border border-cyan-500/40 bg-gray-900/90 px-4 py-2 text-base font-medium text-cyan-100 shadow-lg backdrop-blur transition hover:border-cyan-400 hover:bg-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 md:bottom-32 md:right-8'
          aria-label='捲動至最新訊息'
        >
          ⬇ 跳至最新
        </button>
      )}

      {attachmentError && (
        <div
          className='border-t border-amber-500/20 bg-amber-500/10 px-4 py-2 text-sm text-amber-200 md:px-6'
          role='alert'
        >
          {attachmentError}
        </div>
      )}

      {draftPersistenceEnabled && draftPersistenceMode === 'session' && (
        <div
          className='border-t border-amber-500/20 bg-amber-500/10 px-4 py-2 text-sm text-amber-100 md:px-6'
          role='status'
          data-testid='chat-draft-persistence-warning'
        >
          瀏覽器儲存空間目前無法使用；草稿只會保留在本分頁，關閉分頁後可能遺失。
        </div>
      )}

      {inputGuidance && (
        <div
          id='chat-input-guidance'
          className='flex items-center justify-between gap-3 border-t border-amber-500/20 bg-amber-500/10 px-4 py-2 text-sm text-amber-100 md:px-6'
          role='status'
          data-testid='chat-input-guidance'
        >
          <span>{inputGuidance.message}</span>
          {inputGuidance.actionLabel && (
            <button
              type='button'
              onClick={handleRequestProviderSetup}
              className='flex-shrink-0 rounded-md border border-amber-200/40 px-2.5 py-1.5 text-xs font-medium text-amber-50 transition hover:bg-amber-100/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70'
            >
              {inputGuidance.actionLabel}
            </button>
          )}
        </div>
      )}

      <ChatInput
        value={input}
        onChange={setInputValue}
        onSend={handleSend}
        isLoading={isLoading}
        disabled={false}
        sendDisabled={inputUnavailable}
        sendDisabledReason={inputGuidance?.reason}
        ariaDescribedBy={inputGuidance ? 'chat-input-guidance' : undefined}
        isWorkspaceOpen={_isWorkspaceOpen}
        isRunning={isRunning}
        onStop={handleStop}
        imageInputEnabled={imageInputSupported}
        attachments={pendingAttachments}
        onAddAttachmentFiles={files => void handleAddAttachmentFiles(files)}
        onRemoveAttachment={handleRemoveAttachment}
      />
    </div>
  );
};

export default ChatContainer;
