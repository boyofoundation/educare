import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getBundleMetrics,
  recordBundleByokCompletion,
  recordBundleFirstChatCompletion,
  recordBundleImportSuccess,
} from './bundleMetricsService';

const STORAGE_KEY = 'educare_bundle_metrics_v1';

describe('bundleMetricsService', () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    vi.clearAllMocks();
    storage.clear();
    vi.mocked(localStorage.getItem).mockImplementation(key => storage.get(key) ?? null);
    vi.mocked(localStorage.setItem).mockImplementation((key, value) => {
      storage.set(key, String(value));
    });
    vi.mocked(localStorage.clear).mockImplementation(() => storage.clear());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('persists successful imports and BYOK completions locally without network calls', () => {
    recordBundleImportSuccess();
    recordBundleImportSuccess();
    recordBundleByokCompletion();

    expect(JSON.parse(storage.get(STORAGE_KEY) ?? '')).toMatchObject({
      importSuccesses: 2,
      byokCompletions: 1,
      firstChatCompletions: 0,
      completedSessionIds: [],
    });
    expect(getBundleMetrics()).toMatchObject({ importSuccesses: 2, byokCompletions: 1 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('counts a completed first chat once per session id without network calls', () => {
    recordBundleFirstChatCompletion('bundle-session-1');
    recordBundleFirstChatCompletion('bundle-session-1');
    recordBundleFirstChatCompletion('bundle-session-2');

    expect(getBundleMetrics()).toEqual({
      importSuccesses: 0,
      byokCompletions: 0,
      firstChatCompletions: 2,
      completedSessionIds: ['bundle-session-1', 'bundle-session-2'],
    });
    expect(localStorage.setItem).toHaveBeenCalledTimes(2);
    expect(fetch).not.toHaveBeenCalled();
  });
});
