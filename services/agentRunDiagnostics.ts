import type { AgentRunCheckpoint, AgentRunState } from '../types';

/** Failure stages intentionally contain no provider payloads or user content. */
export type AgentRunFailureStage =
  | 'provider'
  | 'rate_limit'
  | 'network'
  | 'tool'
  | 'cancel'
  | 'budget'
  | 'unknown';

export interface AgentRunFailureClassification {
  stage: AgentRunFailureStage;
  code: string;
  retryable: boolean;
}

export interface AgentRunDiagnosticEvent {
  kind: 'tool' | 'failure' | 'state';
  status?:
    | 'running'
    | 'ok'
    | 'recoverable_error'
    | 'failed'
    | 'paused'
    | 'stopped'
    | 'complete'
    | 'aborted';
  code?: string;
  at?: number;
  durationMs?: number;
}

export interface AgentRunDiagnosticsInput {
  state: AgentRunState;
  checkpoint?: AgentRunCheckpoint | null;
  events?: readonly AgentRunDiagnosticEvent[];
}

export interface AgentRunDiagnostics {
  schemaVersion: 1;
  source: 'local';
  redacted: true;
  generatedAt: number;
  run: {
    runId: string;
    sessionId?: string;
    projectId?: string;
    assistantId?: string;
    status: AgentRunState['status'];
    turnIndex: number;
    maxTurns: number;
    startedAt: number;
    updatedAt: number;
    pauseReason?: AgentRunState['pauseReason'];
    failure?: {
      stage: AgentRunFailureStage;
      code?: string;
      retryable: boolean;
    };
  };
  budget: {
    maxTurns?: number;
    maxToolCalls?: number;
    maxTokens?: number;
  } | null;
  usage: {
    turns: number;
    toolCalls: number;
    toolCallsKnown?: boolean;
    tokens: number;
    estimatedTokens: boolean;
    resumeBudgetAcknowledgementRequired?: boolean;
  };
  events: Array<{
    kind: AgentRunDiagnosticEvent['kind'];
    status?: AgentRunDiagnosticEvent['status'];
    code?: string;
    at?: number;
    durationMs?: number;
  }>;
  cost: {
    available: false;
    reason: 'provider-billing-unavailable';
  };
  omissions: readonly [
    'messages',
    'materials',
    'toolArguments',
    'providerPayloads',
    'credentials',
    'urls',
  ];
}

const RATE_LIMIT_PATTERNS = [
  /\b429\b/i,
  /rate[ _-]?limit/i,
  /quota/i,
  /resource[_ -]?exhausted/i,
  /請求過於頻繁|请求过于频繁|速率限制|頻率限制|頻率過高|频率过高/i,
];

const BUDGET_PATTERNS = [/budget[ _-]?(?:reached|exceeded|exhausted)/i];

const CANCEL_PATTERNS = [/cancel(?:led|lation)?/i, /abort(?:ed|ing)?/i, /取消|已取消|中止/i];

const NETWORK_PATTERNS = [
  /failed to fetch/i,
  /network ?error/i,
  /network request failed/i,
  /err[_ -]?connection/i,
  /fetch error/i,
  /load failed/i,
  /offline/i,
  /econn/i,
  /err[_ -]?(?:network|connection)/i,
  /timeout/i,
  /網路|网络/i,
  /連線失敗|连接失败|連接超時|连接超时|連線中斷|连接中断/i,
];

const AUTH_PATTERNS = [
  /\b401\b/i,
  /\b403\b/i,
  /unauthori[sz]ed/i,
  /forbidden/i,
  /api[ _-]?key/i,
  /credential/i,
  /未授權|未授权|憑證|凭证|無權限|无权限|拒絕|拒绝|認證|认证|金鑰|密鑰/i,
  /權限不足|权限不足|身份驗證|身份验证|訪問被拒絕|访问被拒绝|存取被拒/i,
];

const TOOL_PATTERNS = [
  /\btool\b/i,
  /function call/i,
  /execute(?:d|ing)? tool/i,
  /tool[_ -]?error/i,
  /工具(?:執行|执行|呼叫|调用)?(?:失敗|失败|錯誤|错误)/i,
];

const matches = (value: string, patterns: RegExp[]): boolean =>
  patterns.some(pattern => pattern.test(value));

const SECRET_LIKE_PATTERN =
  /(?:secret|token|api[_-]?key|bearer|sk-[a-z0-9]|gsk_[a-z0-9]|AIzaSy[a-z0-9]|xai-[a-z0-9])/i;

const errorText = (error: unknown): string => {
  if (error instanceof Error) {
    const status = (error as Error & { status?: unknown; statusCode?: unknown }).status;
    const statusCode = (error as Error & { statusCode?: unknown }).statusCode;
    return [error.name, status, statusCode, error.message]
      .filter(
        (value): value is string | number => typeof value === 'string' || typeof value === 'number',
      )
      .join(' ');
  }
  if (typeof error === 'string') {
    return error;
  }
  if (typeof error === 'object' && error !== null) {
    const record = error as {
      name?: unknown;
      message?: unknown;
      status?: unknown;
      statusCode?: unknown;
      code?: unknown;
    };
    return [record.name, record.status, record.statusCode, record.code, record.message]
      .filter(
        (value): value is string | number => typeof value === 'string' || typeof value === 'number',
      )
      .join(' ');
  }
  return '';
};

const structuredStatus = (error: unknown): number | undefined => {
  if (!error || typeof error !== 'object') {
    return undefined;
  }
  const record = error as { status?: unknown; statusCode?: unknown };
  const value = record.status ?? record.statusCode;
  const status = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined;
};

const structuredRetryable = (error: unknown): boolean | undefined => {
  if (!error || typeof error !== 'object') {
    return undefined;
  }
  const value = (error as { retryable?: unknown }).retryable;
  return typeof value === 'boolean' ? value : undefined;
};

/**
 * Classify failures for state/UI purposes without retaining the original error.
 * Network and rate-limit failures are retryable; tool/auth/cancel failures are
 * conservative by default because a completed local side effect must not be
 * replayed implicitly. Callers may pass `toolFailure` when the provider wraps a
 * tool exception in a generic message.
 */
export const classifyAgentRunFailure = (
  error: unknown,
  options: {
    toolFailure?: boolean;
    toolFailureRetryable?: boolean;
    cancelled?: boolean;
  } = {},
): AgentRunFailureClassification => {
  const text = errorText(error);
  const status = structuredStatus(error);
  const retryable = structuredRetryable(error);

  if (options.cancelled || matches(text, CANCEL_PATTERNS)) {
    return { stage: 'cancel', code: 'cancelled', retryable: false };
  }
  if (status === 401 || status === 403) {
    return { stage: 'provider', code: 'credentials', retryable: false };
  }
  if (status === 429) {
    return { stage: 'rate_limit', code: 'rate-limit', retryable: retryable ?? true };
  }
  if (status === 408) {
    return { stage: 'network', code: 'network', retryable: true };
  }
  if (status !== undefined && status >= 500) {
    return { stage: 'provider', code: `provider-http-${status}`, retryable: retryable ?? true };
  }
  if (status !== undefined && status >= 400) {
    return { stage: 'provider', code: `provider-http-${status}`, retryable: false };
  }
  if (matches(text, BUDGET_PATTERNS)) {
    return { stage: 'budget', code: 'budget-exceeded', retryable: false };
  }
  if (matches(text, RATE_LIMIT_PATTERNS)) {
    return { stage: 'rate_limit', code: 'rate-limit', retryable: true };
  }
  if (matches(text, AUTH_PATTERNS)) {
    return { stage: 'provider', code: 'credentials', retryable: false };
  }
  if (matches(text, NETWORK_PATTERNS)) {
    return { stage: 'network', code: 'network', retryable: true };
  }
  if (options.toolFailure || matches(text, TOOL_PATTERNS)) {
    return {
      stage: 'tool',
      code: 'tool-error',
      retryable: options.toolFailureRetryable ?? /recoverable|retry/i.test(text),
    };
  }
  if (retryable !== undefined) {
    return { stage: 'provider', code: 'provider-error', retryable };
  }

  return { stage: 'unknown', code: 'unknown-failure', retryable: false };
};

const safeOpaqueId = (value: string | null | undefined): string | undefined => {
  if (
    !value ||
    value.length > 128 ||
    /https?:\/\//i.test(value) ||
    SECRET_LIKE_PATTERN.test(value)
  ) {
    return undefined;
  }
  return /^[a-z0-9._:-]+$/i.test(value) ? value : undefined;
};

const safeFailureCode = (value: string | undefined): string | undefined => {
  switch (value) {
    case 'rate-limit':
    case 'network':
    case 'tool-error':
    case 'cancelled':
    case 'budget-exceeded':
    case 'credentials':
    case 'provider-error':
    case 'unknown-failure':
    case 'loop-detected':
    case 'budget-usage-unknown':
    case 'in-flight-tool-ack-required':
    case 'checkpoint-persistence-failed':
      return value;
    default:
      return /^provider-http-[45]\d\d$/.test(value ?? '') ? value : undefined;
  }
};

const safeEventCode = (value: string | undefined): string | undefined => {
  if (
    !value ||
    value.length > 64 ||
    /https?:\/\//i.test(value) ||
    SECRET_LIKE_PATTERN.test(value) ||
    /credential/i.test(value)
  ) {
    return undefined;
  }
  return safeFailureCode(value) ?? (/^[a-z0-9_-]+$/i.test(value) ? value : undefined);
};

const checkpointUsage = (
  state: AgentRunState,
  checkpoint?: AgentRunCheckpoint | null,
): AgentRunDiagnostics['usage'] => {
  const usage = state.budgetUsage ?? checkpoint?.budgetUsage;
  const traceLength = checkpoint?.toolTrace.length ?? state.toolTrace.length;
  if (usage) {
    return {
      ...usage,
      toolCallsKnown: usage.toolCallsKnown ?? traceLength < 32,
      resumeBudgetAcknowledgementRequired:
        state.resumeBudgetAcknowledgementRequired ??
        checkpoint?.resumeBudgetAcknowledgementRequired ??
        false,
    };
  }

  const promptTokens = checkpoint?.tokenTotals.promptTokenCount ?? 0;
  const candidateTokens = checkpoint?.tokenTotals.candidatesTokenCount ?? 0;
  return {
    turns: state.turnIndex,
    toolCalls: checkpoint?.toolTrace.length ?? state.toolTrace.length,
    toolCallsKnown: (checkpoint?.toolTrace.length ?? state.toolTrace.length) < 32,
    tokens: promptTokens + candidateTokens,
    estimatedTokens: promptTokens + candidateTokens === 0,
    resumeBudgetAcknowledgementRequired:
      state.resumeBudgetAcknowledgementRequired ??
      checkpoint?.resumeBudgetAcknowledgementRequired ??
      false,
  };
};

/** Build an allowlist-only diagnostic object. Raw histories and provider data are never copied. */
export const buildAgentRunDiagnostics = ({
  state,
  checkpoint,
  events = [],
}: AgentRunDiagnosticsInput): AgentRunDiagnostics => {
  const checkpointFailure =
    checkpoint?.failure ??
    (checkpoint?.failureStage && typeof checkpoint.failureRetryable === 'boolean'
      ? {
          stage: checkpoint.failureStage,
          code: checkpoint.failureCode,
          retryable: checkpoint.failureRetryable,
        }
      : undefined);
  const stateFailure =
    state.failure ??
    (state.failureStage && typeof state.failureRetryable === 'boolean'
      ? {
          stage: state.failureStage,
          code: state.failureCode,
          retryable: state.failureRetryable,
        }
      : undefined);
  const failure = stateFailure ?? checkpointFailure;
  const safeRun: AgentRunDiagnostics['run'] = {
    runId: safeOpaqueId(state.runId) ?? 'redacted',
    status: state.status,
    turnIndex: state.turnIndex,
    maxTurns: state.maxTurns,
    startedAt: state.startedAt,
    updatedAt: state.updatedAt,
  };

  const sessionId = safeOpaqueId(state.sessionId ?? checkpoint?.sessionId);
  const projectId = safeOpaqueId(state.projectId || checkpoint?.projectId || undefined);
  const assistantId = safeOpaqueId(state.assistantId ?? checkpoint?.assistantId);
  if (sessionId) {
    safeRun.sessionId = sessionId;
  }
  if (projectId) {
    safeRun.projectId = projectId;
  }
  if (assistantId) {
    safeRun.assistantId = assistantId;
  }

  if (state.pauseReason ?? checkpoint?.pauseReason) {
    safeRun.pauseReason = state.pauseReason ?? checkpoint?.pauseReason;
  }
  if (failure) {
    safeRun.failure = {
      stage: failure.stage,
      code: safeFailureCode(failure.code),
      retryable: failure.retryable,
    };
  }

  return {
    schemaVersion: 1,
    source: 'local',
    redacted: true,
    generatedAt: Date.now(),
    run: safeRun,
    budget: state.budget ?? checkpoint?.budget ?? null,
    usage: checkpointUsage(state, checkpoint),
    events: events.map(event => ({
      kind: event.kind,
      status: event.status,
      code: safeEventCode(event.code),
      at: typeof event.at === 'number' ? event.at : undefined,
      durationMs: typeof event.durationMs === 'number' ? event.durationMs : undefined,
    })),
    cost: {
      available: false,
      reason: 'provider-billing-unavailable',
    },
    omissions: [
      'messages',
      'materials',
      'toolArguments',
      'providerPayloads',
      'credentials',
      'urls',
    ],
  };
};

export const createAgentRunDiagnostics = buildAgentRunDiagnostics;

/** Serialize diagnostics for a local download/copy action. */
export const serializeAgentRunDiagnostics = (input: AgentRunDiagnosticsInput): string =>
  JSON.stringify(buildAgentRunDiagnostics(input), null, 2);

export const exportAgentRunDiagnostics = serializeAgentRunDiagnostics;
