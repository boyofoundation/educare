export interface BundleMetrics {
  importSuccesses: number;
  byokCompletions: number;
  firstChatCompletions: number;
  completedSessionIds: string[];
}

const STORAGE_KEY = 'educare_bundle_metrics_v1';

const EMPTY_METRICS: BundleMetrics = {
  importSuccesses: 0,
  byokCompletions: 0,
  firstChatCompletions: 0,
  completedSessionIds: [],
};

const normalizeMetrics = (raw: unknown): BundleMetrics => {
  if (!raw || typeof raw !== 'object') {
    return { ...EMPTY_METRICS };
  }
  const candidate = raw as Partial<BundleMetrics>;
  return {
    importSuccesses: Number.isFinite(candidate.importSuccesses)
      ? Math.max(0, candidate.importSuccesses!)
      : 0,
    byokCompletions: Number.isFinite(candidate.byokCompletions)
      ? Math.max(0, candidate.byokCompletions!)
      : 0,
    firstChatCompletions: Number.isFinite(candidate.firstChatCompletions)
      ? Math.max(0, candidate.firstChatCompletions!)
      : 0,
    completedSessionIds: Array.isArray(candidate.completedSessionIds)
      ? candidate.completedSessionIds
          .filter((id): id is string => typeof id === 'string')
          .slice(-500)
      : [],
  };
};

export const getBundleMetrics = (): BundleMetrics => {
  if (typeof localStorage === 'undefined') {
    return { ...EMPTY_METRICS };
  }
  try {
    return normalizeMetrics(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'));
  } catch {
    return { ...EMPTY_METRICS };
  }
};

const saveBundleMetrics = (metrics: BundleMetrics): void => {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(metrics));
  }
};

export const recordBundleImportSuccess = (): void => {
  const metrics = getBundleMetrics();
  saveBundleMetrics({ ...metrics, importSuccesses: metrics.importSuccesses + 1 });
};

export const recordBundleByokCompletion = (): void => {
  const metrics = getBundleMetrics();
  saveBundleMetrics({ ...metrics, byokCompletions: metrics.byokCompletions + 1 });
};

/** Count a completed first chat only once for each persisted bundle session. */
export const recordBundleFirstChatCompletion = (sessionId: string): void => {
  const metrics = getBundleMetrics();
  if (metrics.completedSessionIds.includes(sessionId)) {
    return;
  }
  saveBundleMetrics({
    ...metrics,
    firstChatCompletions: metrics.firstChatCompletions + 1,
    completedSessionIds: [...metrics.completedSessionIds, sessionId].slice(-500),
  });
};
