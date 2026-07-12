import { describe, expect, it } from 'vitest';
import { classifyChatError } from './chatErrorService';

const errors = {
  key401: '金鑰無效。',
  key429: '用量上限。',
  network: '網路問題。',
  generic: '發生問題。',
};

describe('classifyChatError', () => {
  it('classifies 401 and invalid-key messages as auth errors that point to key settings', () => {
    const result = classifyChatError('Request failed with 401 Unauthorized', errors);
    expect(result.kind).toBe('auth');
    expect(result.message).toBe('金鑰無效。');
    expect(result.suggestsKeySettings).toBe(true);
    expect(result.retryable).toBe(false);
  });

  it('classifies 429 and rate-limit messages as retryable rate errors', () => {
    const result = classifyChatError('429 Too Many Requests / quota exceeded', errors);
    expect(result.kind).toBe('rate');
    expect(result.retryable).toBe(true);
    expect(result.suggestsKeySettings).toBe(false);
  });

  it('classifies fetch/network messages as retryable network errors', () => {
    const result = classifyChatError('TypeError: Failed to fetch', errors);
    expect(result.kind).toBe('network');
    expect(result.retryable).toBe(true);
    expect(result.suggestsKeySettings).toBe(false);
  });

  it('falls back to a generic retryable error for unknown messages', () => {
    const result = classifyChatError('Something unexpected happened', errors);
    expect(result.kind).toBe('generic');
    expect(result.retryable).toBe(true);
    expect(result.message).toBe('發生問題。');
  });
});
