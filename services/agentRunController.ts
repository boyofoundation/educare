import {
  type AgentRunCheckpoint,
  type AgentRunState,
  type AgentRunStatus,
  type ChatMessage,
  type FinishReason,
  type HtmlProjectAgentTelemetryEvent,
  type HtmlProjectRuntimeDiagnosticStatus,
  type HtmlProjectSummary,
  type HtmlProjectTodoSummary,
  type HtmlProjectToolPackName,
  type HtmlProjectWorkspaceUpdate,
  type RagChunk,
  type SubagentActivityUpdate,
  type SubagentRunRecord,
  type TokenUsageTotals,
} from '../types';
import type { ProviderUsageMetadata } from './llmAdapter';
import { buildSyntheticMessage, serializeAgentTurnLog } from './conversationUtils';
import { saveCheckpoint, updateCheckpoint } from './agentRunCheckpointService';
import { previewRuntimeDiagnostics } from './previewRuntimeDiagnostics';
import { htmlProjectStore } from './htmlProjectStore';
import { executeHtmlProjectToolCall } from './htmlProjectToolService';
import { getProjectSummaryFromToolResult, streamChat } from './llmService';

/**
 * Continuation prompt injected (as a synthetic user message) before each
 * continuation turn (turnIndex > 0) so the model resumes work on open todos.
 */
export const CONTINUATION_PROMPT =
  'Continue working on the open todos until all are complete and the preview has no runtime errors, then call reportTurnOutcome(outcome:"complete").';

/**
 * Short wait window for G4 runtime-diagnostics verification.
 * Kept small so the controller resumes quickly even when no preview is mounted.
 */
const G4_RUNTIME_DIAGNOSTICS_WAIT_MS = 500;
const CHECKPOINT_PARTIAL_FLUSH_MS = 2_000;
const CHECKPOINT_HEARTBEAT_MS = 5_000;
const SUBAGENT_DELEGATE_TOOL_NAME = 'delegateToSubagents';

const addOptionalTokenCount = (
  current: number | undefined,
  delta: number | undefined,
): number | undefined => {
  if (typeof current === 'undefined' && typeof delta === 'undefined') {
    return undefined;
  }

  return (current ?? 0) + (delta ?? 0);
};

const mergeTokenUsageTotals = (
  current: TokenUsageTotals | undefined,
  delta: TokenUsageTotals | undefined,
): TokenUsageTotals | undefined => {
  if (!delta) {
    return current;
  }

  return {
    inputTokens: (current?.inputTokens ?? 0) + delta.inputTokens,
    outputTokens: (current?.outputTokens ?? 0) + delta.outputTokens,
    totalTokens: (current?.totalTokens ?? 0) + delta.totalTokens,
    cacheCreationInputTokens: addOptionalTokenCount(
      current?.cacheCreationInputTokens,
      delta.cacheCreationInputTokens,
    ),
    cacheReadInputTokens: addOptionalTokenCount(
      current?.cacheReadInputTokens,
      delta.cacheReadInputTokens,
    ),
    cachedInputTokens: addOptionalTokenCount(current?.cachedInputTokens, delta.cachedInputTokens),
    reasoningTokens: addOptionalTokenCount(current?.reasoningTokens, delta.reasoningTokens),
    toolUseTokens: addOptionalTokenCount(current?.toolUseTokens, delta.toolUseTokens),
  };
};

/**
 * Snapshot note recorded at run start (G11).
 */
const RUN_START_SNAPSHOT_NOTE = 'run-start';

const generateRunId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `run-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

export interface AgentRunTurnSummary {
  turnIndex: number;
  finishReason: FinishReason;
  text: string;
  toolSequence: string[];
  todoSummary?: HtmlProjectTodoSummary;
  previewDiagnosticState: HtmlProjectRuntimeDiagnosticStatus;
  autoContinued: boolean;
  subagentRuns?: SubagentRunRecord[];
}

export interface AgentRunControllerCallbacks {
  onChunk: (text: string, turnIndex: number) => void;
  onProjectToolActivity?: (update: HtmlProjectWorkspaceUpdate) => void;
  onSubagentActivity?: (update: SubagentActivityUpdate) => void;
  onTurnStart?: (turnIndex: number, maxTurns: number) => void;
  onTurnComplete?: (turnIndex: number, summary: AgentRunTurnSummary) => void;
  onStateChange?: (state: AgentRunState) => void;
  onError?: (error: Error) => void;
}

export interface AgentRunControllerOptions {
  assistantId: string;
  sessionId?: string | null;
  activeProjectId?: string | null;
  systemPrompt: string;
  history: ChatMessage[];
  message: string;
  ragContext?: string;
  knowledgeChunks?: RagChunk[];
  /** G9 feature flag — when false, run EXACTLY ONE turn (legacy single-turn behavior). */
  agentHarnessEnabled: boolean;
  subagentDelegationEnabled?: boolean;
  /** shared mode → default budget 1 (auto-continue effectively off). */
  sharedMode?: boolean;
  /** override run budget; default 5 (sharedMode default 1). */
  maxTurns?: number;
  /** caller-provided AbortSignal (stop button). Controller also owns an internal AbortController. */
  signal?: AbortSignal;
  /** interrupted-run checkpoint used to resume the existing run state. */
  resumeFrom?: AgentRunCheckpoint;
  callbacks: AgentRunControllerCallbacks;
}

export interface AgentRunResult {
  state: AgentRunState;
  fullText: string;
  finalHistory: ChatMessage[];
  historyDelta: ChatMessage[];
  tokenInfo: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    usage?: ProviderUsageMetadata;
    provider?: string;
    model?: string;
    subagentUsageTotals?: TokenUsageTotals;
  };
  telemetry: HtmlProjectAgentTelemetryEvent;
}

const mapProviderForTelemetry = (
  providerName: string | undefined,
): HtmlProjectAgentTelemetryEvent['provider'] => {
  switch (providerName) {
    case 'anthropic':
      return 'anthropic';
    case 'gemini':
      return 'gemini';
    case 'openai':
    case 'openrouter':
    case 'lmstudio':
    case 'ollama':
    case 'groq':
      return 'openai_compatible';
    default:
      return 'unknown';
  }
};

/**
 * AgentRunController (T6) — multi-turn orchestrator.
 *
 * Calls `streamChat` once per turn and decides continuation per the G4 priority
 * (controller-verify > reportTurnOutcome > finishReason > todoSummary). Owns an
 * internal AbortController linked to the caller's signal (G17). Emits lifecycle
 * callbacks (onStateChange, onTurnStart, onTurnComplete, onChunk) for UI consumption.
 *
 * See `.omc/plans/web-agentic-harness-html-projects-plan.md` for the full spec.
 */
export class AgentRunController {
  private readonly options: AgentRunControllerOptions;
  private readonly internalAbort: AbortController;
  private state: AgentRunState;
  private userStopped = false;
  private callerSignalLinked = false;
  private latestPartialText = '';
  private checkpointFlush: ((force?: boolean) => Promise<void>) | null = null;

  constructor(options: AgentRunControllerOptions) {
    this.options = options;
    this.internalAbort = new AbortController();

    const resumeFrom = options.resumeFrom;
    const maxTurns = options.agentHarnessEnabled
      ? (resumeFrom?.maxTurns ?? options.maxTurns ?? (options.sharedMode ? 1 : 5))
      : 1;

    const now = Date.now();
    this.state = {
      runId: resumeFrom?.runId ?? generateRunId(),
      projectId: resumeFrom?.projectId ?? options.activeProjectId ?? '',
      sessionId: resumeFrom?.sessionId ?? options.sessionId ?? null,
      assistantId: resumeFrom?.assistantId ?? options.assistantId,
      status: 'running',
      turnIndex: resumeFrom?.turnIndex ?? 0,
      maxTurns,
      snapshotVersion: resumeFrom?.snapshotVersion,
      todoSummary: resumeFrom?.todoSummary,
      previewDiagnosticState: 'not_executed',
      autoContinued: (resumeFrom?.turnIndex ?? 0) > 0,
      toolTrace: resumeFrom?.toolTrace ? [...resumeFrom.toolTrace] : [],
      startedAt: resumeFrom?.createdAt ?? now,
      updatedAt: now,
    };
    this.latestPartialText = resumeFrom?.partialText ?? '';
  }

  /**
   * Run the full multi-turn loop. Resolves when terminal
   * (complete/stopped/failed/aborted).
   */
  async run(): Promise<AgentRunResult> {
    const { options, state } = this;
    const callbacks = options.callbacks;
    const resumeFrom = options.resumeFrom;
    const sessionId = state.sessionId;
    const originalMessage = resumeFrom?.originalMessage ?? options.message;
    const effectiveDelegation =
      (resumeFrom?.subagentDelegationEnabled ?? options.subagentDelegationEnabled ?? false) &&
      !(options.sharedMode ?? false);
    const checkpointHistory = resumeFrom?.committedHistoryDelta
      ? [...resumeFrom.committedHistoryDelta]
      : [];
    const historyDelta: ChatMessage[] = [];

    // Link caller signal → internal abort (one-time).
    this.linkCallerSignal();

    // G11: best-effort run-start snapshot.
    if (!resumeFrom && options.activeProjectId) {
      try {
        const snapshot = await htmlProjectStore.createSnapshot(
          options.activeProjectId,
          RUN_START_SNAPSHOT_NOTE,
        );
        this.state.snapshotVersion = snapshot.version;
      } catch {
        // best-effort — swallow.
      }
    }

    const history = [...options.history];
    let fullText = '';
    let totalPromptTokens = resumeFrom?.tokenTotals.promptTokenCount ?? 0;
    let totalCandidatesTokens = resumeFrom?.tokenTotals.candidatesTokenCount ?? 0;
    let finalUsage: ProviderUsageMetadata | undefined;
    let finalProvider: string | undefined;
    let finalModel: string | undefined;
    let finalSubagentUsageTotals: TokenUsageTotals | undefined;
    let firstTurnPackSet = resumeFrom?.firstTurnPackSet
      ? [...resumeFrom.firstTurnPackSet]
      : undefined;

    // Loop-detection trackers.
    let lastFourToolsPrev: string[] | null = null;
    let lastTodoCompletedCount: number | null = null;

    // Aggregated tool trace across turns (for state.toolTrace).
    const aggregatedToolTrace: string[] = resumeFrom?.toolTrace ? [...resumeFrom.toolTrace] : [];

    let lastPartialFlushAt = 0;

    const buildCheckpointRecord = (
      status: AgentRunStatus,
      partialText?: string,
    ): AgentRunCheckpoint => ({
      schemaVersion: 1,
      runId: state.runId,
      sessionId: sessionId ?? '',
      assistantId: options.assistantId,
      projectId: options.activeProjectId ?? null,
      status,
      turnIndex: state.turnIndex,
      maxTurns: state.maxTurns,
      originalMessage,
      committedHistoryDelta: [...checkpointHistory],
      partialText,
      toolTrace: [...state.toolTrace],
      todoSummary: state.todoSummary,
      snapshotVersion: state.snapshotVersion,
      firstTurnPackSet: firstTurnPackSet ? [...firstTurnPackSet] : undefined,
      tokenTotals: {
        promptTokenCount: totalPromptTokens,
        candidatesTokenCount: totalCandidatesTokens,
      },
      agentHarnessEnabled: options.agentHarnessEnabled,
      subagentDelegationEnabled: effectiveDelegation,
      sharedMode: options.sharedMode ?? false,
      createdAt: resumeFrom?.createdAt ?? state.startedAt,
      updatedAt: Date.now(),
      heartbeatAt: Date.now(),
    });

    const flushCheckpointProgress = async (force = false): Promise<void> => {
      if (!sessionId) {
        return;
      }

      const now = Date.now();
      if (!force && now - lastPartialFlushAt < CHECKPOINT_PARTIAL_FLUSH_MS) {
        return;
      }

      lastPartialFlushAt = now;
      await updateCheckpoint(state.runId, {
        status: 'running',
        turnIndex: state.turnIndex,
        committedHistoryDelta: [...checkpointHistory],
        partialText: this.latestPartialText || undefined,
        toolTrace: [...state.toolTrace],
        todoSummary: state.todoSummary,
        snapshotVersion: state.snapshotVersion,
        firstTurnPackSet: firstTurnPackSet ? [...firstTurnPackSet] : undefined,
        tokenTotals: {
          promptTokenCount: totalPromptTokens,
          candidatesTokenCount: totalCandidatesTokens,
        },
        subagentDelegationEnabled: effectiveDelegation,
        heartbeatAt: now,
        updatedAt: now,
      });
    };

    const markTerminalCheckpoint = async (status: AgentRunStatus): Promise<void> => {
      if (!sessionId) {
        return;
      }

      await updateCheckpoint(state.runId, {
        status,
        turnIndex: state.turnIndex,
        committedHistoryDelta: [...checkpointHistory],
        partialText: this.latestPartialText || undefined,
        toolTrace: [...state.toolTrace],
        todoSummary: state.todoSummary,
        snapshotVersion: state.snapshotVersion,
        firstTurnPackSet: firstTurnPackSet ? [...firstTurnPackSet] : undefined,
        tokenTotals: {
          promptTokenCount: totalPromptTokens,
          candidatesTokenCount: totalCandidatesTokens,
        },
        subagentDelegationEnabled: effectiveDelegation,
        heartbeatAt: Date.now(),
        updatedAt: Date.now(),
      });
    };

    this.checkpointFlush = flushCheckpointProgress;

    if (sessionId) {
      await saveCheckpoint(buildCheckpointRecord('running', this.latestPartialText || undefined));
    }

    const heartbeatInterval =
      sessionId !== null && sessionId !== undefined
        ? window.setInterval(() => {
            void flushCheckpointProgress();
          }, CHECKPOINT_HEARTBEAT_MS)
        : null;

    this.emitStateChange();

    try {
      while (state.turnIndex < state.maxTurns) {
        // Per-round abort check (in case caller signal aborted between turns).
        if (this.internalAbort.signal.aborted) {
          this.handleAbortTermination();
          await markTerminalCheckpoint(this.state.status);
          break;
        }

        callbacks.onTurnStart?.(state.turnIndex, state.maxTurns);

        const isContinuation = state.turnIndex > 0;
        const messageForTurn = isContinuation ? CONTINUATION_PROMPT : options.message;
        const synthetic = isContinuation
          ? buildSyntheticMessage('user', CONTINUATION_PROMPT, 'continuation prompt')
          : null;

        // G6: inject synthetic user message before continuation turns.
        if (synthetic !== null) {
          history.push(synthetic);
          state.autoContinued = true;
        }

        // Holder object — TS uses DECLARED property types at read sites, which
        // sidesteps the local-variable narrowing that occurs when assignments
        // happen inside the onComplete closure.
        const turn: {
          finishReason: FinishReason;
          text: string;
          toolSequence: string[];
          projectSummary: HtmlProjectSummary | null;
          selectedPackSet?: HtmlProjectToolPackName[];
          subagentRuns?: SubagentRunRecord[];
          subagentUsageTotals?: TokenUsageTotals;
        } = {
          finishReason: 'complete',
          text: '',
          toolSequence: [],
          projectSummary: null,
        };
        let streamError: Error | undefined;
        this.latestPartialText = '';

        try {
          await streamChat({
            systemPrompt: options.systemPrompt,
            ragContext: options.ragContext,
            history,
            message: messageForTurn,
            assistantId: options.assistantId,
            sessionId: options.sessionId,
            activeProjectId: options.activeProjectId,
            knowledgeChunks: options.knowledgeChunks,
            signal: this.internalAbort.signal,
            packSetOverride: isContinuation ? firstTurnPackSet : undefined,
            subagentDelegationEnabled: effectiveDelegation,
            onChunk: text => {
              this.latestPartialText += text;
              callbacks.onChunk(text, state.turnIndex);
              void flushCheckpointProgress();
            },
            onProjectToolActivity: callbacks.onProjectToolActivity,
            onSubagentActivity: callbacks.onSubagentActivity,
            onComplete: (meta, text) => {
              turn.text = text;
              turn.finishReason = meta.finishReason ?? 'complete';
              turn.toolSequence = meta.toolSequence ?? [];
              turn.projectSummary = meta.projectSummary ?? null;
              turn.selectedPackSet = meta.selectedPackSet;
              turn.subagentRuns = meta.subagentRuns;
              turn.subagentUsageTotals = meta.subagentUsageTotals;
              totalPromptTokens += meta.promptTokenCount;
              totalCandidatesTokens += meta.candidatesTokenCount;
              if (meta.usage) {
                finalUsage = meta.usage;
              }
              if (meta.provider) {
                finalProvider = meta.provider;
              }
              if (meta.model) {
                finalModel = meta.model;
              }
              if (meta.subagentUsageTotals) {
                finalSubagentUsageTotals = mergeTokenUsageTotals(
                  finalSubagentUsageTotals,
                  meta.subagentUsageTotals,
                );
              }
            },
          });
        } catch (error) {
          streamError = error as Error;
        }

        // G17 (5a): abort priority — abort always wins.
        if (this.internalAbort.signal.aborted || turn.finishReason === 'aborted') {
          // No half-turn write: do NOT append the model message or synthetic
          // continuation prompt for the next turn (we're terminating).
          this.handleAbortTermination();
          await markTerminalCheckpoint(this.state.status);
          // Emit a turn summary reflecting the abort for any UI listeners.
          const abortSummary: AgentRunTurnSummary = {
            turnIndex: state.turnIndex,
            finishReason: 'aborted',
            text: turn.text,
            toolSequence: turn.toolSequence,
            todoSummary: turn.projectSummary?.todoSummary,
            previewDiagnosticState: state.previewDiagnosticState,
            autoContinued: state.turnIndex > 0,
          };
          callbacks.onTurnComplete?.(state.turnIndex, abortSummary);
          break;
        }

        if (streamError) {
          state.status = 'failed';
          state.finishReason = turn.finishReason;
          this.emitStateChange();
          await markTerminalCheckpoint(state.status);
          callbacks.onError?.(streamError);
          // Emit a turn summary even on failure (best-effort).
          const failSummary = this.buildTurnSummary(
            state.turnIndex,
            turn.finishReason,
            turn.text,
            turn.toolSequence,
            turn.projectSummary,
            turn.subagentRuns,
          );
          callbacks.onTurnComplete?.(state.turnIndex, failSummary);
          break;
        }

        // Capture first-turn pack set for continuation override (G2).
        if (state.turnIndex === 0 && turn.selectedPackSet && turn.selectedPackSet.length > 0) {
          firstTurnPackSet = [...turn.selectedPackSet];
        }

        // G1/G4: wait briefly for runtime diagnostics if there is an active project.
        let turnPreviewDiagnosticState: HtmlProjectRuntimeDiagnosticStatus = 'not_executed';
        if (options.activeProjectId && turn.projectSummary) {
          try {
            const diag = await previewRuntimeDiagnostics.waitForRuntimeDiagnostics(
              options.activeProjectId,
              turn.projectSummary.previewVersion,
              G4_RUNTIME_DIAGNOSTICS_WAIT_MS,
            );
            turnPreviewDiagnosticState = diag.status;
          } catch {
            turnPreviewDiagnosticState = 'not_executed';
          }
        }
        state.previewDiagnosticState = turnPreviewDiagnosticState;
        if (turn.projectSummary?.todoSummary) {
          state.todoSummary = turn.projectSummary.todoSummary;
        }

        // Update aggregated tool trace + state.toolTrace (last N for loop detection).
        for (const toolName of turn.toolSequence) {
          aggregatedToolTrace.push(toolName);
        }
        state.toolTrace = aggregatedToolTrace.slice(-32);

        // G12 (AC#7): loop detection — TWO consecutive turns with identical
        // last-4 tool sequences AND 0 todo `completed` delta → 'failed'.
        const lastFour = turn.toolSequence.slice(-4);
        const currentTodoCompleted = turn.projectSummary?.todoSummary.completed ?? 0;
        const delegateOnlyLoopCandidate =
          lastFour.length === 4 &&
          lastFour.every(tool => tool === SUBAGENT_DELEGATE_TOOL_NAME) &&
          lastFourToolsPrev?.length === 4 &&
          lastFourToolsPrev.every(tool => tool === SUBAGENT_DELEGATE_TOOL_NAME);

        if (
          lastFourToolsPrev !== null &&
          lastFour.length === 4 &&
          lastFourToolsPrev.length === 4 &&
          lastFourToolsPrev.every((tool, idx) => tool === lastFour[idx]) &&
          currentTodoCompleted === lastTodoCompletedCount &&
          !delegateOnlyLoopCandidate
        ) {
          state.status = 'failed';
          state.finishReason = 'stop-route';
          state.loopDetected = true;
          this.emitStateChange();
          await markTerminalCheckpoint(state.status);

          const loopSummary = this.buildTurnSummary(
            state.turnIndex,
            'stop-route',
            turn.text,
            turn.toolSequence,
            turn.projectSummary,
            turn.subagentRuns,
          );
          callbacks.onTurnComplete?.(state.turnIndex, loopSummary);
          break;
        }
        // Update unconditionally so only TRULY consecutive turns are compared (G12).
        // A zero/short-tool turn resets the chain — otherwise two matching 4-tool
        // turns separated by a no-op turn could false-positive as a loop.
        lastFourToolsPrev = lastFour;
        lastTodoCompletedCount = currentTodoCompleted;

        // G4: continuation decision — controller-verify has top priority.
        const modelReportedComplete = turn.toolSequence.includes('reportTurnOutcome');
        const finishIndicatesComplete =
          turn.finishReason === 'complete' && !!options.activeProjectId;
        const todoAllComplete = turn.projectSummary?.todoSummary.allComplete === true;

        const needsG4Verify =
          options.activeProjectId &&
          (modelReportedComplete || finishIndicatesComplete || todoAllComplete);

        let terminalComplete = false;
        if (needsG4Verify && options.activeProjectId) {
          const verified = await this.verifyCompletionAuthoritative();
          if (verified.passes) {
            terminalComplete = true;
            if (verified.summary) {
              turn.projectSummary = verified.summary;
              state.todoSummary = verified.summary.todoSummary;
            }
            state.previewDiagnosticState = verified.diagnosticState;
          }
          // else: false-complete (AC#8) → fall through to continuation logic.
        }

        // Commit this turn to history (G6) — model message with agentTurnLog.
        const agentTurnLog = serializeAgentTurnLog(
          turn.toolSequence.length > 0
            ? `tools: ${turn.toolSequence.join(', ')}`
            : turn.text.slice(0, 200),
        );
        const modelMessage: ChatMessage = {
          role: 'model',
          content: turn.text,
          agentTurnLog,
          subagentRuns: turn.subagentRuns,
        };
        const committedMessages = synthetic ? [synthetic, modelMessage] : [modelMessage];
        checkpointHistory.push(...committedMessages);
        historyDelta.push(...committedMessages);
        history.push(modelMessage);
        this.latestPartialText = '';
        fullText = turn.text;

        // Emit per-turn summary.
        const turnSummary = this.buildTurnSummary(
          state.turnIndex,
          turn.finishReason,
          turn.text,
          turn.toolSequence,
          turn.projectSummary,
          turn.subagentRuns,
        );
        callbacks.onTurnComplete?.(state.turnIndex, turnSummary);

        if (terminalComplete) {
          state.status = 'complete';
          state.finishReason = 'complete';
          this.emitStateChange();
          await markTerminalCheckpoint(state.status);
          break;
        }

        // Non-terminal completion signals that failed verify, or continuation
        // finish reasons (tool-budget-exhausted / stop-route) → continue_needed.
        // Advance to next turn if budget remains.
        state.turnIndex += 1;
        await flushCheckpointProgress(true);
        if (state.turnIndex >= state.maxTurns) {
          // Budget reached → run-level 'complete'.
          state.status = 'complete';
          state.finishReason = turn.finishReason;
          this.emitStateChange();
          await markTerminalCheckpoint(state.status);
          break;
        }
      }
    } finally {
      if (heartbeatInterval !== null) {
        window.clearInterval(heartbeatInterval);
      }
      this.checkpointFlush = null;
    }

    const telemetry = this.buildRunLevelTelemetry(
      finalProvider,
      firstTurnPackSet,
      aggregatedToolTrace,
    );

    return {
      state: this.state,
      fullText,
      finalHistory: history,
      historyDelta,
      tokenInfo: {
        promptTokenCount: totalPromptTokens,
        candidatesTokenCount: totalCandidatesTokens,
        usage: finalUsage,
        provider: finalProvider,
        model: finalModel,
        subagentUsageTotals: finalSubagentUsageTotals,
      },
      telemetry,
    };
  }

  /** Request stop — aborts the in-flight turn within ~1 round (G17). */
  stop(reason?: string): void {
    if (this.state.status !== 'running') {
      return;
    }
    this.userStopped = true;
    if (reason) {
      this.state.abortReason = reason;
    }
    this.internalAbort.abort(reason);
  }

  async flushCheckpoint(force = true): Promise<void> {
    await this.checkpointFlush?.(force);
  }

  /** Current state snapshot (for UI activity panel). */
  getState(): AgentRunState {
    return this.state;
  }

  // ---- internal helpers --------------------------------------------------

  private linkCallerSignal(): void {
    if (this.callerSignalLinked) {
      return;
    }
    this.callerSignalLinked = true;
    const callerSignal = this.options.signal;
    if (!callerSignal) {
      return;
    }
    if (callerSignal.aborted) {
      this.internalAbort.abort(callerSignal.reason);
      return;
    }
    callerSignal.addEventListener(
      'abort',
      () => {
        this.internalAbort.abort(callerSignal.reason);
      },
      { once: true },
    );
  }

  private handleAbortTermination(): void {
    const wasUserStop = this.userStopped;
    const status: AgentRunStatus = wasUserStop ? 'stopped' : 'aborted';
    this.state.status = status;
    this.state.finishReason = 'aborted';
    if (!this.state.abortReason) {
      this.state.abortReason = wasUserStop ? 'user-stop' : 'external-signal';
    }
    this.emitStateChange();
  }

  /**
   * G4 authoritative completion verify — calls getProjectSummary directly
   * (NOT via the model) and waits briefly for runtime diagnostics.
   */
  private async verifyCompletionAuthoritative(): Promise<{
    passes: boolean;
    summary: HtmlProjectSummary | null;
    diagnosticState: HtmlProjectRuntimeDiagnosticStatus;
  }> {
    const projectId = this.options.activeProjectId;
    if (!projectId) {
      return { passes: false, summary: null, diagnosticState: 'not_executed' };
    }

    let summary: HtmlProjectSummary | null = null;
    let diagnosticState: HtmlProjectRuntimeDiagnosticStatus = 'not_executed';

    try {
      const toolResult = await executeHtmlProjectToolCall(
        { name: 'getProjectSummary', args: { projectId } },
        {
          assistantId: this.options.assistantId,
          sessionId: this.options.sessionId,
          activeProjectId: projectId,
        },
      );
      summary = getProjectSummaryFromToolResult(toolResult.result);

      if (summary) {
        try {
          const diag = await previewRuntimeDiagnostics.waitForRuntimeDiagnostics(
            projectId,
            summary.previewVersion,
            G4_RUNTIME_DIAGNOSTICS_WAIT_MS,
          );
          diagnosticState = diag.status;
        } catch {
          diagnosticState = 'not_executed';
        }
      }
    } catch {
      return { passes: false, summary: null, diagnosticState: 'not_executed' };
    }

    const outcome = summary?.previewDiagnostics.outcome;
    const todoOk = summary?.todoSummary.allComplete === true;
    const previewOk = outcome !== 'repairable_error' && outcome !== 'non_repairable_error';
    const runtimeOk = diagnosticState === 'clean' || diagnosticState === 'not_executed';
    const passes = todoOk && previewOk && runtimeOk;
    return { passes, summary, diagnosticState };
  }

  private buildTurnSummary(
    turnIndex: number,
    finishReason: FinishReason,
    text: string,
    toolSequence: string[],
    projectSummary: HtmlProjectSummary | null,
    subagentRuns?: SubagentRunRecord[],
  ): AgentRunTurnSummary {
    return {
      turnIndex,
      finishReason,
      text,
      toolSequence,
      todoSummary: projectSummary?.todoSummary,
      previewDiagnosticState: this.state.previewDiagnosticState,
      autoContinued: turnIndex > 0,
      subagentRuns,
    };
  }

  private buildRunLevelTelemetry(
    provider: string | undefined,
    packSet: HtmlProjectToolPackName[] | undefined,
    toolTrace: string[],
  ): HtmlProjectAgentTelemetryEvent {
    return {
      sessionId: this.options.sessionId,
      assistantId: this.options.assistantId,
      projectId: this.options.activeProjectId ?? null,
      provider: mapProviderForTelemetry(provider),
      intent: 'uncertain',
      selectedPackSet: packSet?.map(p => p) ?? [],
      toolSequence: toolTrace,
      repeatedRecoverableErrors: [],
      toolRounds: toolTrace.length,
      runId: this.state.runId,
      turnIndex: this.state.turnIndex,
      finishReason: this.state.finishReason,
      autoContinued: this.state.autoContinued,
      abortReason: this.state.abortReason,
      runtimeDiagnosticState: this.state.previewDiagnosticState,
    };
  }

  private emitStateChange(): void {
    this.state.updatedAt = Date.now();
    this.options.callbacks.onStateChange?.({ ...this.state });
  }
}
