import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  APPEARANCE_STORAGE_KEY,
  applyAppearancePreferences,
  DEFAULT_APPEARANCE_PREFERENCES,
  getSystemTheme,
  loadAppearancePreferences,
  normalizeAppearancePreferences,
  resolveAppearanceTheme,
  saveAppearancePreferences,
  type AppearancePreferences,
  type AppearanceStorage,
} from './appearancePreferences';

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

describe('appearancePreferences', () => {
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

  it('leaves the live system media query in charge for the system theme', () => {
    applyAppearancePreferences({ ...DEFAULT_APPEARANCE_PREFERENCES, theme: 'system' });

    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(document.documentElement.dataset.themePreference).toBe('system');
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
});
