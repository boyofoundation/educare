import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_OPEN_JEV_EXPERIMENT_PREFERENCES,
  loadOpenJevExperimentPreferences,
  normalizeOpenJevExperimentPreferences,
  OPEN_JEV_EXPERIMENT_STORAGE_KEY,
  saveOpenJevExperimentPreferences,
  type OpenJevExperimentStorage,
} from './openJevExperimentPreferences';
import { __resetWorkspaceOperationServiceForTesting } from './workspaceOperationService';

const createStorage = (
  initialValue: string | null = null,
): OpenJevExperimentStorage & {
  value: string | null;
} => {
  let value = initialValue;
  return {
    get value() {
      return value;
    },
    getItem: vi.fn(() => value),
    setItem: vi.fn((_key: string, nextValue: string) => {
      value = nextValue;
    }),
  };
};

describe('openJevExperimentPreferences', () => {
  afterEach(() => {
    __resetWorkspaceOperationServiceForTesting();
  });

  it('defaults the structured decision tool to disabled', () => {
    expect(loadOpenJevExperimentPreferences(null)).toEqual(DEFAULT_OPEN_JEV_EXPERIMENT_PREFERENCES);
  });

  it('normalizes malformed values instead of enabling the experiment', () => {
    expect(normalizeOpenJevExperimentPreferences({ enabled: 'yes' })).toEqual(
      DEFAULT_OPEN_JEV_EXPERIMENT_PREFERENCES,
    );
  });

  it('round-trips the versioned preference key', () => {
    const storage = createStorage();
    expect(saveOpenJevExperimentPreferences({ enabled: true }, storage)).toBe(true);
    expect(storage.setItem).toHaveBeenCalledWith(
      OPEN_JEV_EXPERIMENT_STORAGE_KEY,
      JSON.stringify({ enabled: true }),
    );
    expect(loadOpenJevExperimentPreferences(storage)).toEqual({ enabled: true });
  });

  it('falls back to disabled when stored JSON is invalid or storage fails', () => {
    expect(loadOpenJevExperimentPreferences(createStorage('{invalid'))).toEqual(
      DEFAULT_OPEN_JEV_EXPERIMENT_PREFERENCES,
    );

    const failingStorage: OpenJevExperimentStorage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => {
        throw new Error('blocked');
      }),
    };
    expect(saveOpenJevExperimentPreferences({ enabled: true }, failingStorage)).toBe(false);
  });
});
