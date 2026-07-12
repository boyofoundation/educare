/**
 * Classifies chat-stream errors into actionable categories so the UI can show
 * recovery guidance (retry, open key settings) instead of a raw stack message.
 *
 * Used by the chat path in every mode (normal, shared, bundle). The bundle
 * sandbox relies on this for criterion: "actionable 401, 429, and network-error
 * recovery".
 */

export type ChatErrorKind = 'auth' | 'rate' | 'network' | 'generic';

export interface ChatErrorClassification {
  kind: ChatErrorKind;
  message: string;
  /** Whether retrying the same request is likely to help. */
  retryable: boolean;
  /** Whether the error points to an invalid/expired key (open key settings). */
  suggestsKeySettings: boolean;
}

const AUTH_PATTERNS = [
  /\b401\b/,
  /\b403\b/,
  /unauthor/i,
  /forbidden/i,
  /invalid api key/i,
  /incorrect api key/i,
  /api_key_invalid/i,
  /permission denied/i,
];

const RATE_PATTERNS = [
  /\b429\b/,
  /rate limit/i,
  /quota/i,
  /too many requests/i,
  /resource_exhausted/i,
];

const NETWORK_PATTERNS = [
  /failed to fetch/i,
  /networkerror/i,
  /network request failed/i,
  /err_connection/i,
  /fetch error/i,
  /load failed/i,
  /offline/i,
  /econn/i,
];

const matches = (text: string, patterns: RegExp[]): boolean => patterns.some(p => p.test(text));

/**
 * Classify a chat error from its message. Order matters: auth and rate are
 * checked before network because some providers wrap HTTP status codes inside
 * network-style fetch rejections.
 */
export const classifyChatError = (
  rawMessage: string,
  bundleStringsErrors: { key401: string; key429: string; network: string; generic: string },
): ChatErrorClassification => {
  const text = rawMessage ?? '';

  if (matches(text, AUTH_PATTERNS)) {
    return {
      kind: 'auth',
      message: bundleStringsErrors.key401,
      retryable: false,
      suggestsKeySettings: true,
    };
  }
  if (matches(text, RATE_PATTERNS)) {
    return {
      kind: 'rate',
      message: bundleStringsErrors.key429,
      retryable: true,
      suggestsKeySettings: false,
    };
  }
  if (matches(text, NETWORK_PATTERNS)) {
    return {
      kind: 'network',
      message: bundleStringsErrors.network,
      retryable: true,
      suggestsKeySettings: false,
    };
  }
  return {
    kind: 'generic',
    message: bundleStringsErrors.generic,
    retryable: true,
    suggestsKeySettings: false,
  };
};
