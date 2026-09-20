import { describe, expect, it } from 'vitest';
import { getProviderUsageAccounting, mergeProviderUsageMetadata } from './providerRequest';

describe('provider usage accounting', () => {
  it('keeps an unknown first request unknown when a later request is exact', () => {
    const merged = mergeProviderUsageMetadata(undefined, { source: 'unavailable' });
    const withLaterUsage = mergeProviderUsageMetadata(merged, {
      source: 'api',
      inputTokens: 12,
      outputTokens: 4,
      totalTokens: 16,
    });

    expect(withLaterUsage?.source).toBe('unavailable');
    expect(getProviderUsageAccounting(withLaterUsage)).toEqual({
      knownTokens: 16,
      unknownRequestCount: 1,
      complete: false,
    });
  });

  it('keeps a known first request partial when a later request is unknown', () => {
    const first = mergeProviderUsageMetadata(undefined, {
      source: 'api',
      inputTokens: 8,
      outputTokens: 2,
      totalTokens: 10,
    });
    const merged = mergeProviderUsageMetadata(first, undefined);

    expect(merged?.source).toBe('unavailable');
    expect(getProviderUsageAccounting(merged)).toEqual({
      knownTokens: 10,
      unknownRequestCount: 1,
      complete: false,
    });
  });

  it('retains an exact aggregate only when every request has exact usage', () => {
    const first = mergeProviderUsageMetadata(undefined, {
      source: 'api',
      totalTokens: 10,
    });
    const merged = mergeProviderUsageMetadata(first, {
      source: 'api',
      totalTokens: 6,
    });

    expect(merged?.source).toBe('api');
    expect(getProviderUsageAccounting(merged)).toEqual({
      knownTokens: 16,
      unknownRequestCount: 0,
      complete: true,
    });
  });
});
