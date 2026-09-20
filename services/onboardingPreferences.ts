/**
 * Small, local-only persistence boundary for the first-run assistant flow.
 *
 * The onboarding state deliberately does not contain assistants, credentials,
 * or provider connectivity.  It only records whether the local guide was
 * completed and which route the user chose so the shell can safely reopen it.
 */

export const ONBOARDING_PREFERENCES_KEY = 'educare:onboarding-preferences';

export type OnboardingCompletionReason = 'template' | 'import' | 'browse' | 'skip';

export interface OnboardingPreferences {
  completed: boolean;
  dismissed: boolean;
  completionReason?: OnboardingCompletionReason;
  selectedTemplateId?: string;
  completedAt?: number;
}

export interface OnboardingPersistenceResult extends OnboardingPreferences {
  preferences: OnboardingPreferences;
  /** True only when the latest update reached browser storage. */
  persisted: boolean;
}

const DEFAULT_PREFERENCES: OnboardingPreferences = {
  completed: false,
  dismissed: false,
};

// Tests and some privacy modes expose a storage-shaped object whose getItem
// always returns null. Keep a tab-local fallback so a completion action still
// has deterministic behavior in that environment; real localStorage remains
// the durable source across reloads.
let memoryPreferences: OnboardingPreferences = { ...DEFAULT_PREFERENCES };

interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

const getStorage = (): StorageLike | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const normalize = (value: unknown): OnboardingPreferences => {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_PREFERENCES };
  }

  const candidate = value as Partial<OnboardingPreferences>;
  const completionReason = candidate.completionReason;
  const validReason: OnboardingCompletionReason | undefined =
    completionReason === 'template' ||
    completionReason === 'import' ||
    completionReason === 'browse' ||
    completionReason === 'skip'
      ? completionReason
      : undefined;

  return {
    completed: candidate.completed === true,
    dismissed: candidate.dismissed === true,
    ...(validReason ? { completionReason: validReason } : {}),
    ...(typeof candidate.selectedTemplateId === 'string'
      ? { selectedTemplateId: candidate.selectedTemplateId }
      : {}),
    ...(typeof candidate.completedAt === 'number' ? { completedAt: candidate.completedAt } : {}),
  };
};

/** Read onboarding preferences without throwing when storage is unavailable. */
export const getOnboardingPreferences = (): OnboardingPreferences => {
  const storage = getStorage();
  if (!storage) {
    return { ...memoryPreferences };
  }

  try {
    const raw = storage.getItem(ONBOARDING_PREFERENCES_KEY);
    return raw ? normalize(JSON.parse(raw)) : { ...memoryPreferences };
  } catch {
    return { ...memoryPreferences };
  }
};

/** Alias kept for callers that prefer a load-oriented name. */
export const loadOnboardingPreferences = getOnboardingPreferences;

/**
 * Persist a partial update and return both the resulting in-memory value and
 * whether browser storage accepted it. Storage errors remain non-blocking so
 * the caller can still continue in the current tab, but are no longer hidden
 * from the UI.
 */
export const saveOnboardingPreferences = (
  update: Partial<OnboardingPreferences>,
): OnboardingPersistenceResult => {
  const next = normalize({ ...getOnboardingPreferences(), ...update });
  memoryPreferences = next;
  const storage = getStorage();
  let persisted = false;

  if (storage) {
    try {
      storage.setItem(ONBOARDING_PREFERENCES_KEY, JSON.stringify(next));
      persisted = true;
    } catch {
      // Private browsing and quota restrictions should not make onboarding unusable.
    }
  }

  return { ...next, preferences: { ...next }, persisted };
};

/** Alias kept for callers that prefer a setter-oriented name. */
export const setOnboardingPreferences = saveOnboardingPreferences;

export const completeOnboarding = (
  reason: OnboardingCompletionReason,
  selectedTemplateId?: string,
): OnboardingPersistenceResult =>
  saveOnboardingPreferences({
    completed: true,
    dismissed: reason === 'skip',
    completionReason: reason,
    ...(selectedTemplateId ? { selectedTemplateId } : {}),
    completedAt: Date.now(),
  });

export const markOnboardingCompleted = completeOnboarding;

/** Clear the completion marker so Settings can offer a true “reopen guide”. */
export const resetOnboardingPreferences = (): OnboardingPreferences => {
  memoryPreferences = { ...DEFAULT_PREFERENCES };
  const storage = getStorage();
  if (storage) {
    try {
      storage.removeItem(ONBOARDING_PREFERENCES_KEY);
    } catch {
      // Keep reset best-effort; the next render still starts from a clean value.
    }
  }
  return { ...DEFAULT_PREFERENCES };
};

export const reopenOnboarding = resetOnboardingPreferences;

export const isOnboardingCompleted = (): boolean => getOnboardingPreferences().completed;
