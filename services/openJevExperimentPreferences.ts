import { withWorkspaceWrite } from './workspaceOperationService';

export const OPEN_JEV_EXPERIMENT_STORAGE_KEY = 'educare.openJevExperiment.v1';
export const OPEN_JEV_EXPERIMENT_PREFERENCES_CHANGED_EVENT =
  'educare:open-jev-experiment-preferences-changed';

export interface OpenJevExperimentPreferences {
  enabled: boolean;
}

export interface OpenJevExperimentStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export const DEFAULT_OPEN_JEV_EXPERIMENT_PREFERENCES: Readonly<OpenJevExperimentPreferences> = {
  enabled: false,
};

const getStorage = (): OpenJevExperimentStorage | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const storage = window.localStorage;
    if (storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function') {
      return storage;
    }
  } catch {
    // Private browsing and blocked storage can throw while reading localStorage.
  }

  return null;
};

export const normalizeOpenJevExperimentPreferences = (
  value: unknown,
): OpenJevExperimentPreferences => {
  const candidate = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

  return {
    enabled:
      typeof candidate.enabled === 'boolean'
        ? candidate.enabled
        : DEFAULT_OPEN_JEV_EXPERIMENT_PREFERENCES.enabled,
  };
};

export const loadOpenJevExperimentPreferences = (
  storage: OpenJevExperimentStorage | null = getStorage(),
): OpenJevExperimentPreferences => {
  if (!storage) {
    return { ...DEFAULT_OPEN_JEV_EXPERIMENT_PREFERENCES };
  }

  try {
    const raw = storage.getItem(OPEN_JEV_EXPERIMENT_STORAGE_KEY);
    return raw
      ? normalizeOpenJevExperimentPreferences(JSON.parse(raw))
      : { ...DEFAULT_OPEN_JEV_EXPERIMENT_PREFERENCES };
  } catch {
    return { ...DEFAULT_OPEN_JEV_EXPERIMENT_PREFERENCES };
  }
};

export const getOpenJevExperimentEnabled = (): boolean =>
  loadOpenJevExperimentPreferences().enabled;

export const saveOpenJevExperimentPreferences = (
  preferences: OpenJevExperimentPreferences,
  storage: OpenJevExperimentStorage | null = getStorage(),
): boolean => {
  if (!storage) {
    return false;
  }

  try {
    storage.setItem(
      OPEN_JEV_EXPERIMENT_STORAGE_KEY,
      JSON.stringify(normalizeOpenJevExperimentPreferences(preferences)),
    );
    return true;
  } catch {
    return false;
  }
};

export const saveOpenJevExperimentPreferencesAsync = (
  preferences: OpenJevExperimentPreferences,
  storage?: OpenJevExperimentStorage | null,
): Promise<boolean> =>
  withWorkspaceWrite(async () =>
    saveOpenJevExperimentPreferences(preferences, storage === undefined ? undefined : storage),
  );

export const setOpenJevExperimentEnabled = (
  enabled: boolean,
  storage?: OpenJevExperimentStorage | null,
): boolean => {
  const persisted = saveOpenJevExperimentPreferences(
    { enabled },
    storage === undefined ? undefined : storage,
  );

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(OPEN_JEV_EXPERIMENT_PREFERENCES_CHANGED_EVENT));
  }

  return persisted;
};
