import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  APPEARANCE_STORAGE_KEY,
  applyAppearancePreferences,
  DEFAULT_APPEARANCE_PREFERENCES,
  getSystemTheme,
  loadAppearancePreferences,
  normalizeAppearancePreferences,
  resolveAppearanceTheme,
  saveAppearancePreferences,
  saveAppearancePreferencesAsync,
  type AppearancePreferences,
  type AppearanceStorage,
} from './appearancePreferences';
import {
  __resetWorkspaceOperationServiceForTesting,
  withWorkspaceOperation,
} from './workspaceOperationService';

const createStorage = (
  initialValue: string | null = null,
): AppearanceStorage & {
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

const createMediaQuery = (matches: boolean) => {
  const listeners = new Set<() => void>();
  return {
    get matches() {
      return matches;
    },
    addEventListener: vi.fn((_type: 'change', listener: () => void) => {
      listeners.add(listener);
    }),
    removeEventListener: vi.fn((_type: 'change', listener: () => void) => {
      listeners.delete(listener);
    }),
    setMatches(nextMatches: boolean) {
      matches = nextMatches;
      listeners.forEach(listener => listener());
    },
  };
};

describe('appearancePreferences', () => {
  afterEach(() => {
    __resetWorkspaceOperationServiceForTesting();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-theme-preference');
    document.documentElement.removeAttribute('data-reading-size');
    document.documentElement.removeAttribute('data-reduced-motion');
  });

  it('returns compatible defaults when storage is unavailable', () => {
    expect(loadAppearancePreferences(null)).toEqual(DEFAULT_APPEARANCE_PREFERENCES);
  });

  it('normalizes malformed stored values instead of applying arbitrary attributes', () => {
    expect(
      normalizeAppearancePreferences({
        theme: 'neon',
        fontSize: 'huge',
        reducedMotion: 'yes',
      }),
    ).toEqual(DEFAULT_APPEARANCE_PREFERENCES);
  });

  it('round-trips preferences through the versioned storage key', () => {
    const storage = createStorage();
    const preferences: AppearancePreferences = {
      theme: 'light',
      fontSize: 'large',
      reducedMotion: true,
    };

    expect(saveAppearancePreferences(preferences, storage)).toBe(true);
    expect(storage.setItem).toHaveBeenCalledWith(
      APPEARANCE_STORAGE_KEY,
      JSON.stringify(preferences),
    );
    expect(loadAppearancePreferences(storage)).toEqual(preferences);
  });

  it('falls back when storage contains invalid JSON', () => {
    const storage = createStorage('{invalid');
    expect(loadAppearancePreferences(storage)).toEqual(DEFAULT_APPEARANCE_PREFERENCES);
  });

  it('applies explicit theme, reading size, and reduced-motion attributes to the root', () => {
    const preferences: AppearancePreferences = {
      theme: 'light',
      fontSize: 'large',
      reducedMotion: true,
    };

    applyAppearancePreferences(preferences);

    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.dataset.themePreference).toBe('light');
    expect(document.documentElement.dataset.readingSize).toBe('large');
    expect(document.documentElement.dataset.reducedMotion).toBe('true');
  });

  it('applies the effective system theme while preserving the system preference', () => {
    const mediaQuery = createMediaQuery(false);
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => mediaQuery),
    );

    const storage = createStorage();
    const preferences = { ...DEFAULT_APPEARANCE_PREFERENCES, theme: 'system' as const };
    expect(saveAppearancePreferences(preferences, storage)).toBe(true);
    applyAppearancePreferences(preferences);

    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.dataset.themePreference).toBe('system');

    mediaQuery.setMatches(true);
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.dataset.themePreference).toBe('system');
    expect(loadAppearancePreferences(storage).theme).toBe('system');
    expect(mediaQuery.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('replaces the system listener when an explicit theme is selected', () => {
    const mediaQuery = createMediaQuery(false);
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => mediaQuery),
    );
    const systemPreferences = { ...DEFAULT_APPEARANCE_PREFERENCES, theme: 'system' as const };

    applyAppearancePreferences(systemPreferences);
    applyAppearancePreferences(systemPreferences);
    expect(mediaQuery.addEventListener).toHaveBeenCalledTimes(2);
    expect(mediaQuery.removeEventListener).toHaveBeenCalledTimes(1);

    applyAppearancePreferences({ ...systemPreferences, theme: 'dark' });
    expect(mediaQuery.removeEventListener).toHaveBeenCalledTimes(2);
    mediaQuery.setMatches(true);
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('resolves system themes from matchMedia and preserves explicit choices', () => {
    expect(getSystemTheme({ matches: true })).toBe('dark');
    expect(getSystemTheme({ matches: false })).toBe('light');
    expect(resolveAppearanceTheme('system', 'light')).toBe('light');
    expect(resolveAppearanceTheme('dark', 'light')).toBe('dark');
  });

  it('reports storage failures without preventing the preference from being applied', () => {
    const storage: AppearanceStorage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => {
        throw new Error('blocked');
      }),
    };

    expect(saveAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES, storage)).toBe(false);
    applyAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, reducedMotion: true });
    expect(document.documentElement.dataset.reducedMotion).toBe('true');
  });

  it('defers async preference writes until an exclusive workspace operation finishes', async () => {
    const storage = createStorage();
    let pendingWrite: Promise<boolean> | undefined;

    await withWorkspaceOperation('export', async () => {
      pendingWrite = saveAppearancePreferencesAsync(
        { ...DEFAULT_APPEARANCE_PREFERENCES, theme: 'light' },
        storage,
      );
      await Promise.resolve();
      expect(storage.setItem).not.toHaveBeenCalled();
    });

    await expect(pendingWrite).resolves.toBe(true);
    expect(storage.setItem).toHaveBeenCalledWith(
      APPEARANCE_STORAGE_KEY,
      JSON.stringify({ ...DEFAULT_APPEARANCE_PREFERENCES, theme: 'light' }),
    );
  });

  it('keeps the previous stored appearance value when an async write fails', async () => {
    const previousValue = JSON.stringify(DEFAULT_APPEARANCE_PREFERENCES);
    const storage = createStorage(previousValue);
    storage.setItem = vi.fn(() => {
      throw new Error('blocked');
    });

    await expect(
      saveAppearancePreferencesAsync(
        { ...DEFAULT_APPEARANCE_PREFERENCES, theme: 'light' },
        storage,
      ),
    ).resolves.toBe(false);
    expect(storage.value).toBe(previousValue);
  });
});
