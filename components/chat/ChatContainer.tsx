import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ChatContainerProps } from './types';
import { AppContext } from '../core/useAppContext';
import MessageBubble from './MessageBubble';
import ChatInput from './ChatInput';
import WelcomeMessage from './WelcomeMessage';
import ThinkingIndicator from './ThinkingIndicator';
import StreamingResponse from './StreamingResponse';
import { Virtuoso } from 'react-virtuoso';
import { AgentRunController } from '../../services/agentRunController';
import { buildIndexedKnowledgeChunks } from '../../services/knowledgeSearchService';
import {
  claimCheckpoint,
  deleteCheckpoint,
  getCheckpoint,
  getInterruptedForSession,
} from '../../services/agentRunCheckpointService';
import { htmlProjectStore } from '../../services/htmlProjectStore';
import { applyTokenUsageToSession } from '../../services/sessionTokenUsage';
import { isErrorMessage, isSyntheticMessage } from '../../services/conversationUtils';
import { useStickToBottom } from '../../hooks/useStickToBottom';
import type {
  AgentRunCheckpoint,
  AgentRunState,
  ChatMessage,
  SubagentRunRecord,
  ToolCallRecord,
  RouteProposal,
} from '../../types';
import { HtmlProjectWorkspaceUpdate } from '../../types';
import {
  getCachedSharedRoutableTargets,
  resolveRoutableTargets,
} from '../../services/assistantRoutingService';

const INTERRUPTION_NOTICE = '⚠️ 上次工作已中斷';
const EMPTY_RESPONSE_NOTICE = '（本次回覆沒有內容）';
const STICKY_SCROLL_THRESHOLD_PX = 100;

const buildInterruptedNotice = (checkpoint: AgentRunCheckpoint): ChatMessage => ({
  role: 'model',
  content: `${INTERRUPTION_NOTICE}（第 ${Math.min(checkpoint.turnIndex + 1, checkpoint.maxTurns)}/${checkpoint.maxTurns} 回合）。`,
  synthetic: true,
  timestamp: checkpoint.updatedAt,
});

const sameMessage = (left?: ChatMessage, right?: ChatMessage): boolean =>
  left?.role === right?.role && left?.content === right?.content;

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
  assistantDescription,
  starterPrompts = [],
  isWorkspaceOpen: _isWorkspaceOpen = false,
  headerActions,
  subagentDelegationEnabled = false,
}) => {
  const appContext = useContext(AppContext);
  const actions = appContext?.actions ?? null;
  const [input, setInput] = useState('');
  const [streamingResponse, setStreamingResponse] = useState('');
  const [pendingEmptyResponseNotice, setPendingEmptyResponseNotice] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [currentSession, setCurrentSession] = useState(session);
  const [runState, setRunState] = useState<AgentRunState | null>(null);
  const [subagentBatches, setSubagentBatches] = useState<Record<string, SubagentRunRecord[]>>({});
  const [toolCallRecords, setToolCallRecords] = useState<ToolCallRecord[]>([]);
  const [interruptedCheckpoint, setInterruptedCheckpoint] = useState<AgentRunCheckpoint | null>(
    null,
  );
  const [resumeUnavailableReason, setResumeUnavailableReason] = useState<string | null>(null);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const sessionRef = useRef(session);
  const controllerRef = useRef<AgentRunController | null>(null);
  const isThinkingRef = useRef(isThinking);
  const subagentBatchesRef = useRef<Record<string, SubagentRunRecord[]>>({});
  const toolCallRecordsRef = useRef<ToolCallRecord[]>([]);
  const latestErrorMessageRef = useRef<string | null>(null);
  const streamingBufferRef = useRef('');
  const streamingFlushFrameRef = useRef<number | null>(null);
  const routeProposalRef = useRef<RouteProposal | undefined>(undefined);
  const { containerRef, isAtBottom, handleScroll, scrollToBottom, updatePinnedState } =
    useStickToBottom(STICKY_SCROLL_THRESHOLD_PX);

  useEffect(() => {
    isThinkingRef.current = isThinking;
  }, [isThinking]);

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
    setCurrentSession(session);
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    sessionRef.current = currentSession;
  }, [currentSession]);

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
    updatePinnedState();
  }, [
    currentSession.messages,
    streamingResponse,
    isThinking,
    subagentBatches,
    toolCallRecords,
    pendingEmptyResponseNotice,
    updatePinnedState,
  ]);

  useEffect(() => {
    if (isAtBottom) {
      scrollToBottom(streamingResponse ? 'auto' : 'smooth');
    }
  }, [
    currentSession.messages,
    isAtBottom,
    isThinking,
    pendingEmptyResponseNotice,
    scrollToBottom,
    streamingResponse,
    subagentBatches,
    toolCallRecords,
  ]);

  useEffect(() => {
    let active = true;

    const loadInterruptedCheckpoint = async () => {
      if (!session.id) {
        if (active) {
          setInterruptedCheckpoint(null);
          setResumeUnavailableReason(null);
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
        setResumeUnavailableReason(null);
        setResumeError(null);
        return;
      }

      const lastCommitted = checkpoint.committedHistoryDelta.at(-1);
      if (lastCommitted && sameMessage(session.messages.at(-1), lastCommitted)) {
        await deleteCheckpoint(checkpoint.runId);
        if (active) {
          setInterruptedCheckpoint(null);
          setResumeUnavailableReason(null);
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
          setResumeUnavailableReason('原本的 HTML 專案已不存在，只能捨棄並封存這次中斷紀錄。');
          setResumeError(null);
          return;
        }
      }

      setInterruptedCheckpoint(checkpoint);
      setResumeUnavailableReason(
        checkpoint.turnIndex >= checkpoint.maxTurns
          ? '這次工作已達最大回合數，只能捨棄並封存中斷前的紀錄。'
          : null,
      );
      setResumeError(null);
    };

    void loadInterruptedCheckpoint();

    return () => {
      active = false;
    };
  }, [session.id, session.messages]);

  useEffect(() => {
    const flushCheckpoint = () => {
      void controllerRef.current?.flushCheckpoint(true);
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
    setSubagentBatches(prev => {
      const next = {
        ...prev,
        [update.batchId]: update.runs,
      };
      subagentBatchesRef.current = next;
      return next;
    });
  };

  const handleToolCallActivity = (record: ToolCallRecord) => {
    setToolCallRecords(prev => {
      const existingIndex = prev.findIndex(item => item.id === record.id);
      if (existingIndex === -1) {
        const next = [...prev, record].slice(-50);
        toolCallRecordsRef.current = next;
        return next;
      }

      const next = [...prev];
      next[existingIndex] = record;
      toolCallRecordsRef.current = next;
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
    setResumeUnavailableReason(
      checkpoint && checkpoint.turnIndex >= checkpoint.maxTurns
        ? '這次工作已達最大回合數，只能捨棄並封存中斷前的紀錄。'
        : null,
    );
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
    setResumeUnavailableReason(null);
    setResumeError(null);
  };

  const executeRun = async ({
    message,
    displaySession,
    historyMessages,
    resumeCheckpoint,
  }: {
    message: string;
    displaySession: typeof currentSession;
    historyMessages: ChatMessage[];
    resumeCheckpoint?: AgentRunCheckpoint;
  }) => {
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
    setResumeError(null);
    actions?.setAgentRunState?.(null);

    sessionRef.current = displaySession;
    setCurrentSession(displaySession);

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

      // 「開啟 HTML 專案」= 此聊天回合綁定了 activeProjectId。
      // HTML 專案工具與 agentic harness 皆據此自動推導,使用者無需在助理設定手動開關;
      // resume 時則沿用 checkpoint 快照,維持與原回合一致的行為。
      const effectiveProjectId =
        resumeCheckpoint?.projectId ?? displaySession.activeProjectId ?? null;
      const projectEditingActive = Boolean(effectiveProjectId);

      const currentAssistant = appContext?.state?.currentAssistant;
      const routableTargets = currentAssistant
        ? sharedMode
          ? getCachedSharedRoutableTargets(currentAssistant)
          : resolveRoutableTargets(currentAssistant, appContext.state.assistants)
        : [];

      const controller = new AgentRunController({
        assistantId,
        sessionId: displaySession.id,
        activeProjectId: effectiveProjectId,
        systemPrompt: enhancedSystemPrompt,
        history: chatHistory,
        message,
        knowledgeChunks: ragChunks,
        agentHarnessEnabled: resumeCheckpoint?.agentHarnessEnabled ?? projectEditingActive,
        subagentDelegationEnabled:
          resumeCheckpoint?.subagentDelegationEnabled ?? subagentDelegationEnabled,
        routableTargets: resumeCheckpoint?.routableTargets ?? routableTargets,
        htmlProjectEnabled: resumeCheckpoint?.htmlProjectEnabled ?? projectEditingActive,
        sharedMode: resumeCheckpoint?.sharedMode ?? sharedMode,
        resumeFrom: resumeCheckpoint,
        callbacks: {
          onChunk: chunk => {
            if (isThinkingRef.current) {
              setIsThinking(false);
            }
            streamingBufferRef.current += chunk;
            scheduleStreamingFlush();
          },
          onProjectToolActivity: handleProjectToolActivity,
          onSubagentActivity: handleSubagentActivity,
          onToolCallActivity: handleToolCallActivity,
          onRouteProposal: proposal => {
            routeProposalRef.current = proposal;
          },
          onStateChange: nextState => {
            setRunState(nextState);
            actions?.setAgentRunState?.(nextState);
          },
          onError: error => {
            console.error('AgentRunController error:', error);
            latestErrorMessageRef.current = error.message;
          },
        },
      });
      controllerRef.current = controller;

      const commitRunResult = async () => {
        const result = await controller.run();
        controllerRef.current = null;
        flushStreamingBuffer();

        setRunState(result.state);
        actions?.setAgentRunState?.(result.state);
        setIsLoading(false);
        setIsThinking(false);
        setStatusText('');
        setStreamingResponse('');

        const baseSession = sessionRef.current;
        const fullModelResponse = result.fullText.trim();
        const latestErrorMessage = latestErrorMessageRef.current;
        const shouldPersistError = Boolean(latestErrorMessage) || result.state.status === 'failed';

        if (shouldPersistError) {
          const errorMessage = buildAssistantMessage(
            latestErrorMessage ?? '執行過程發生錯誤，請稍後再試。',
            { isError: true },
          );
          const finalSession = applyTokenUsageToSession(
            {
              ...baseSession,
              messages: [...baseSession.messages, errorMessage],
            },
            result.tokenInfo,
          );
          sessionRef.current = finalSession;
          setCurrentSession(finalSession);
          setSubagentBatches({});
          setToolCallRecords([]);
          await onNewMessage(finalSession, message, errorMessage.content, result.tokenInfo);
          await loadRetainedCheckpoint(result.state.runId);
          return;
        }

        if (fullModelResponse === '') {
          const finalSession = applyTokenUsageToSession(baseSession, result.tokenInfo);
          sessionRef.current = finalSession;
          setCurrentSession(finalSession);
          setPendingEmptyResponseNotice(EMPTY_RESPONSE_NOTICE);
          setSubagentBatches({});
          setToolCallRecords([]);
          await onNewMessage(finalSession, message, '', result.tokenInfo);
          await deleteCheckpoint(result.state.runId);
          setInterruptedCheckpoint(null);
          setResumeUnavailableReason(null);
          return;
        }

        const newAiMessage = buildAssistantMessage(fullModelResponse, {
          citations: result.citations,
          routeProposal: routeProposalRef.current,
        });
        const finalSession = applyTokenUsageToSession(
          {
            ...baseSession,
            messages: [...baseSession.messages, newAiMessage],
          },
          result.tokenInfo,
        );

        sessionRef.current = finalSession;
        setCurrentSession(finalSession);
        setSubagentBatches({});
        setToolCallRecords([]);
        try {
          await onNewMessage(finalSession, message, fullModelResponse, result.tokenInfo);
        } catch (persistError) {
          latestErrorMessageRef.current = (persistError as Error).message;
          throw persistError;
        }

        if (result.state.status === 'complete') {
          await deleteCheckpoint(result.state.runId);
          setInterruptedCheckpoint(null);
          setResumeUnavailableReason(null);
        } else {
          await loadRetainedCheckpoint(result.state.runId);
        }
      };

      const lockKey = `agent-run-${displaySession.id}`;
      const lockManager =
        typeof navigator !== 'undefined' && 'locks' in navigator ? navigator.locks : undefined;

      if (lockManager) {
        const lockResult = await lockManager.request(
          lockKey,
          resumeCheckpoint ? { mode: 'exclusive', ifAvailable: true } : { mode: 'exclusive' },
          async lock => {
            if (resumeCheckpoint && !lock) {
              return false;
            }

            await commitRunResult();
            return true;
          },
        );

        if (resumeCheckpoint && lockResult === false) {
          setIsLoading(false);
          setIsThinking(false);
          setStatusText('');
          setRunState(null);
          actions?.setAgentRunState?.(null);
          setResumeError('工作仍在其他分頁進行中。');
        }
        return;
      }

      if (resumeCheckpoint) {
        const claimed = await claimCheckpoint(resumeCheckpoint.runId);
        if (!claimed) {
          setIsLoading(false);
          setIsThinking(false);
          setStatusText('');
          setRunState(null);
          actions?.setAgentRunState?.(null);
          setResumeError('無法取得續跑權限，可能已有其他分頁接手此工作。');
          return;
        }
      }

      await commitRunResult();
    } catch (error) {
      controllerRef.current = null;
      flushStreamingBuffer();
      const errorMessageText = (error as Error).message;
      console.error('Error during chat stream:', error);
      latestErrorMessageRef.current = errorMessageText;
      setIsLoading(false);
      setIsThinking(false);
      setStatusText('');
      setRunState(null);
      actions?.setAgentRunState?.(null);
      setStreamingResponse('');
      setSubagentBatches({});
      setToolCallRecords([]);

      const baseSession = sessionRef.current;
      const errorMessage = buildAssistantMessage(
        `${errorMessageText}\n\n請檢查您的 API 密鑰和控制檯以取得更多細節。`,
        { isError: true },
      );
      const finalSession = {
        ...baseSession,
        messages: [...baseSession.messages, errorMessage],
      };
      sessionRef.current = finalSession;
      setCurrentSession(finalSession);
      await onNewMessage(finalSession, message, errorMessage.content, {
        promptTokenCount: 0,
        candidatesTokenCount: 0,
      });
    }
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) {
      return;
    }

    const userMessage = input.trim();
    setInput('');
    setPendingEmptyResponseNotice(null);

    if (interruptedCheckpoint) {
      await persistCheckpointArchive(interruptedCheckpoint, {
        clearProject: resumeUnavailableReason !== null && Boolean(interruptedCheckpoint.projectId),
      });
    }

    const baseSession = sessionRef.current;
    const newUserMessage: ChatMessage = {
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
    };
    const updatedSession = {
      ...baseSession,
      messages: [...baseSession.messages, newUserMessage],
    };

    await executeRun({
      message: userMessage,
      displaySession: updatedSession,
      historyMessages: baseSession.messages.filter(messageItem => !isSyntheticMessage(messageItem)),
    });
  };

  const handleResume = async () => {
    if (!interruptedCheckpoint || resumeUnavailableReason) {
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

    await executeRun({
      message: interruptedCheckpoint.originalMessage,
      displaySession: mergedSession,
      historyMessages:
        interruptedCheckpoint.turnIndex === 0
          ? baseSession.messages.filter(messageItem => !isSyntheticMessage(messageItem))
          : mergedSession.messages,
      resumeCheckpoint: interruptedCheckpoint,
    });
  };

  const handleDiscardInterruptedRun = async () => {
    if (!interruptedCheckpoint) {
      return;
    }

    await persistCheckpointArchive(interruptedCheckpoint, {
      clearProject: resumeUnavailableReason !== null && Boolean(interruptedCheckpoint.projectId),
    });
  };

  const handleStop = () => {
    controllerRef.current?.stop('user-stop');
  };

  const handlePromptSelect = async (prompt: string) => {
    if (isLoading) {
      return;
    }

    setInput(prompt);
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

    await executeRun({
      message: prompt,
      displaySession: updatedSession,
      historyMessages: baseSession.messages.filter(messageItem => !isSyntheticMessage(messageItem)),
    });
    setInput('');
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
    toolCallRecords.length > 0 || Object.values(subagentBatches).some(runs => runs.length > 0);
  const showStreamingResponse = streamingResponse !== '' || (isLoading && hasLiveActivity);
  const interruptedTurnLabel = interruptedCheckpoint
    ? `${Math.min(interruptedCheckpoint.turnIndex + 1, interruptedCheckpoint.maxTurns)}/${interruptedCheckpoint.maxTurns}`
    : null;
  const showJumpToLatest =
    !isAtBottom && (isThinking || streamingResponse !== '' || currentSession.messages.length > 0);

  return (
    <div className='relative flex h-full flex-col bg-gray-900'>
      {!hideHeader && (
        <div className='flex-shrink-0 border-b border-gray-700 bg-gray-800 px-4 py-3 md:px-6 md:py-4'>
          <div className='flex items-center justify-between'>
            <h2 className='mr-2 truncate text-lg font-semibold text-white md:text-xl'>
              {assistantName}
            </h2>
            <div className='flex items-center space-x-3'>
              {headerActions}
              {sharedMode && (
                <button
                  onClick={async () => {
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
                    setPendingEmptyResponseNotice(null);
                    setIsThinking(false);
                    setStatusText('');
                    setInput('');
                    setInterruptedCheckpoint(null);
                    setResumeUnavailableReason(null);
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
        onScroll={handleScroll}
        className='chat-scroll flex-1 overflow-y-auto'
        role='main'
        aria-label='聊天對話'
      >
        <div className='mx-auto max-w-4xl px-4 py-5 md:px-6 md:py-8'>
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
                  {resumeError && <p className='mt-2 text-rose-200'>{resumeError}</p>}
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
                    disabled={Boolean(resumeUnavailableReason) || isLoading}
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
                sharedMode={sharedMode}
                starterPrompts={starterPrompts}
                onPromptSelect={prompt => {
                  void handlePromptSelect(prompt);
                }}
              />
            )}

          <div role='log' aria-label='訊息列表'>
            <Virtuoso
              key={`${currentSession.id}:${currentSession.messages.length}`}
              data={currentSession.messages}
              customScrollParent={containerRef.current ?? undefined}
              followOutput={isAtBottom ? 'auto' : false}
              atBottomStateChange={() => {
                updatePinnedState();
              }}
              initialItemCount={currentSession.messages.length}
              itemContent={(index: number, msg: ChatMessage) => {
                if (!msg) {
                  return null;
                }
                return (
                  <div className='mb-6'>
                    <MessageBubble
                      message={msg}
                      index={index}
                      assistantName={assistantName}
                      citationContentsById={citationContentsById}
                    />
                  </div>
                );
              }}
            />

            {isThinking && !streamingResponse && !hasLiveActivity && (
              <ThinkingIndicator assistantName={assistantName} statusText={statusText} />
            )}

            {showStreamingResponse && (
              <StreamingResponse
                content={streamingResponse}
                assistantName={assistantName}
                subagentBatches={subagentBatches}
                toolCallLog={toolCallRecords}
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

      <ChatInput
        value={input}
        onChange={setInput}
        onSend={handleSend}
        isLoading={isLoading}
        disabled={false}
        isWorkspaceOpen={_isWorkspaceOpen}
        isRunning={isRunning}
        onStop={handleStop}
      />
    </div>
  );
};

export default ChatContainer;
