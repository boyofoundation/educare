import type { ChatParams, ProviderUsageMetadata } from '../llmAdapter';

/**
 * Called immediately before a provider transport request is started.
 *
 * The controller uses this hook to enforce run budgets at the actual provider
 * request boundary.  A callback with no parameters is intentionally valid;
 * callers that need budget accounting can use the request ordinal and the
 * actual cumulative usage from completed nested requests.
 */
export type BeforeProviderRequest = (context: ProviderRequestContext) => void | Promise<void>;

export interface ProviderRequestContext {
  provider: string;
  model?: string;
  requestType: 'initial' | 'tool-round' | 'stream';
  /** Zero-based request ordinal within one provider stream. */
  requestIndex: number;
  /** Actual usage accumulated by completed requests before this request. */
  cumulativeUsage?: ProviderUsageMetadata;
}

/** Extra stream parameters carried structurally without widening llmAdapter's legacy ChatParams. */
export type ProviderChatParams = ChatParams & {
  beforeProviderRequest?: BeforeProviderRequest;
};

export const getBeforeProviderRequest = (params: ChatParams): BeforeProviderRequest | undefined =>
  (params as ProviderChatParams).beforeProviderRequest;

export const runBeforeProviderRequest = async (
  params: ChatParams,
  context: ProviderRequestContext,
): Promise<void> => {
  await getBeforeProviderRequest(params)?.(context);
};

const sumOptionalUsageField = (
  current: number | undefined,
  delta: number | undefined,
): number | undefined => {
  if (current === undefined && delta === undefined) {
    return undefined;
  }
  return (current ?? 0) + (delta ?? 0);
};

/**
 * Provider usage can be a mixture of exact request totals and requests for
 * which the provider emitted no usage metadata. Keep that distinction outside
 * the legacy llmAdapter contract so callers never mistake a partial aggregate
 * for an exact bill.
 */
export interface ProviderUsageAccounting {
  knownTokens?: number;
  unknownRequestCount: number;
  complete: boolean;
}

type ProviderUsageWithAccounting = ProviderUsageMetadata & {
  unknownRequestCount?: number;
  complete?: boolean;
};

const hasKnownTokenFields = (usage: ProviderUsageMetadata | undefined): boolean =>
  typeof usage?.totalTokens === 'number' ||
  typeof usage?.inputTokens === 'number' ||
  typeof usage?.outputTokens === 'number';

const readKnownTokens = (usage: ProviderUsageMetadata | undefined): number | undefined => {
  if (!usage) {
    return undefined;
  }
  if (typeof usage.totalTokens === 'number' && Number.isFinite(usage.totalTokens)) {
    return Math.max(0, usage.totalTokens);
  }
  if (
    (typeof usage.inputTokens === 'number' && Number.isFinite(usage.inputTokens)) ||
    (typeof usage.outputTokens === 'number' && Number.isFinite(usage.outputTokens))
  ) {
    return Math.max(0, (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0));
  }
  return undefined;
};

const readUnknownRequestCount = (usage: ProviderUsageMetadata | undefined): number => {
  if (!usage) {
    return 0;
  }
  const explicit = (usage as ProviderUsageWithAccounting).unknownRequestCount;
  if (typeof explicit === 'number' && Number.isFinite(explicit)) {
    return Math.max(0, Math.floor(explicit));
  }
  return usage.source === 'unavailable' ? 1 : 0;
};

const withUsageAccounting = (
  usage: ProviderUsageMetadata,
  accounting: ProviderUsageAccounting,
): ProviderUsageMetadata => {
  const result = { ...usage } as ProviderUsageWithAccounting;
  Object.defineProperties(result, {
    unknownRequestCount: {
      configurable: true,
      enumerable: false,
      value: accounting.unknownRequestCount,
      writable: true,
    },
    complete: {
      configurable: true,
      enumerable: false,
      value: accounting.complete,
      writable: true,
    },
  });
  return result;
};

export const getProviderUsageAccounting = (
  usage: ProviderUsageMetadata | undefined,
): ProviderUsageAccounting => {
  const knownTokens = readKnownTokens(usage);
  const unknownRequestCount = readUnknownRequestCount(usage);
  const complete =
    usage?.source === 'api' && unknownRequestCount === 0 && hasKnownTokenFields(usage);
  return { knownTokens, unknownRequestCount, complete };
};

/** Merge usage from one completed provider request into the stream total. */
export const mergeProviderUsageMetadata = (
  current: ProviderUsageMetadata | undefined,
  delta: ProviderUsageMetadata | undefined,
): ProviderUsageMetadata | undefined => {
  if (!current && !delta) {
    return withUsageAccounting(
      { source: 'unavailable' },
      { unknownRequestCount: 1, complete: false },
    );
  }

  const currentAccounting = getProviderUsageAccounting(current);
  const deltaAccounting = getProviderUsageAccounting(delta);
  const unknownRequestCount =
    currentAccounting.unknownRequestCount + (delta ? deltaAccounting.unknownRequestCount : 1);
  const allPresentUsageIsApi =
    (!current || current.source === 'api') && (!delta || delta.source === 'api');
  const source = allPresentUsageIsApi && unknownRequestCount === 0 ? 'api' : 'unavailable';
  const merged: ProviderUsageMetadata = {
    source,
    inputTokens: sumOptionalUsageField(current?.inputTokens, delta?.inputTokens),
    outputTokens: sumOptionalUsageField(current?.outputTokens, delta?.outputTokens),
    totalTokens: sumOptionalUsageField(current?.totalTokens, delta?.totalTokens),
    cacheCreationInputTokens: sumOptionalUsageField(
      current?.cacheCreationInputTokens,
      delta?.cacheCreationInputTokens,
    ),
    cacheReadInputTokens: sumOptionalUsageField(
      current?.cacheReadInputTokens,
      delta?.cacheReadInputTokens,
    ),
    cachedInputTokens: sumOptionalUsageField(current?.cachedInputTokens, delta?.cachedInputTokens),
    reasoningTokens: sumOptionalUsageField(current?.reasoningTokens, delta?.reasoningTokens),
    toolUseTokens: sumOptionalUsageField(current?.toolUseTokens, delta?.toolUseTokens),
  };
  return withUsageAccounting(merged, {
    knownTokens: readKnownTokens(merged),
    unknownRequestCount,
    complete: source === 'api' && unknownRequestCount === 0 && hasKnownTokenFields(merged),
  });
};

export interface ProviderErrorMetadata {
  status?: number;
  statusCode?: number;
  code?: string;
  retryable?: boolean;
}

export type ProviderErrorLike = Error & ProviderErrorMetadata;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const asFiniteStatus = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.round(value);
};

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const isAuthenticationCode = (value: string | undefined): boolean =>
  !!value &&
  /api[_ -]?key|auth|credential|forbidden|unauthori[sz]ed|invalid[_ -]?token/i.test(value);

const isNetworkMessage = (value: string): boolean =>
  /failed to fetch|network|timeout|timed out|connection|offline|load failed/i.test(value);

const inferRetryable = (metadata: ProviderErrorMetadata, message: string): boolean => {
  if (typeof metadata.retryable === 'boolean') {
    return metadata.retryable;
  }
  if (metadata.status === 401 || metadata.status === 403 || isAuthenticationCode(metadata.code)) {
    return false;
  }
  if (metadata.status === 429 || (metadata.status !== undefined && metadata.status >= 500)) {
    return true;
  }
  if (isNetworkMessage(message)) {
    return true;
  }
  // Unknown provider failures fail closed.  A caller may opt into retrying by
  // explicitly setting retryable on the original error.
  return false;
};

export class ProviderRequestError extends Error implements ProviderErrorMetadata {
  readonly status?: number;
  readonly statusCode?: number;
  readonly code?: string;
  readonly retryable?: boolean;

  constructor(message: string, metadata: ProviderErrorMetadata = {}) {
    super(message);
    this.name = 'ProviderRequestError';
    this.status = metadata.status;
    this.statusCode = metadata.statusCode ?? metadata.status;
    this.code = metadata.code;
    this.retryable = metadata.retryable ?? inferRetryable(metadata, message);
  }
}

export const getProviderErrorMetadata = (error: unknown): ProviderErrorMetadata => {
  if (!isRecord(error)) {
    return {};
  }

  const status = asFiniteStatus(error.status);
  const statusCode = asFiniteStatus(error.statusCode);
  const code = asString(error.code);
  const retryable = typeof error.retryable === 'boolean' ? error.retryable : undefined;

  return {
    ...(status !== undefined ? { status } : {}),
    ...(statusCode !== undefined ? { statusCode } : {}),
    ...(code !== undefined ? { code } : {}),
    ...(retryable !== undefined ? { retryable } : {}),
  };
};

export const wrapProviderError = (error: unknown, prefix: string): ProviderRequestError => {
  const message = error instanceof Error ? error.message : String(error);
  const metadata = getProviderErrorMetadata(error);
  return new ProviderRequestError(`${prefix}: ${message || '未知錯誤'}`, {
    ...metadata,
    retryable: inferRetryable(metadata, message),
  });
};

const readResponseErrorFields = (parsed: unknown): { code?: string; message?: string } => {
  if (!isRecord(parsed)) {
    return {};
  }

  const nestedError = isRecord(parsed.error) ? parsed.error : undefined;
  return {
    code:
      asString(nestedError?.code) ??
      asString(nestedError?.type) ??
      asString(parsed.code) ??
      asString(parsed.type),
    message: asString(nestedError?.message) ?? asString(parsed.message),
  };
};

export const createProviderResponseError = async (
  response: Response,
  providerName: string,
): Promise<ProviderRequestError> => {
  const body = await response.text();
  let parsed: unknown;
  try {
    parsed = body ? (JSON.parse(body) as unknown) : undefined;
  } catch {
    parsed = undefined;
  }

  const fields = readResponseErrorFields(parsed);
  const detail = fields.message ?? body;
  const statusText = response.statusText ? ` ${response.statusText}` : '';
  const message = `${providerName} API error: ${response.status}${statusText}${detail ? ` - ${detail}` : ''}`;
  const metadata: ProviderErrorMetadata = {
    status: response.status,
    statusCode: response.status,
    ...(fields.code ? { code: fields.code } : {}),
  };

  return new ProviderRequestError(message, {
    ...metadata,
    retryable: inferRetryable(metadata, message),
  });
};
