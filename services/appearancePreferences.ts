export const APPEARANCE_STORAGE_KEY = 'educare.appearance.v1';

export const APPEARANCE_THEMES = ['system', 'light', 'dark'] as const;
export type AppearanceTheme = (typeof APPEARANCE_THEMES)[number];

export const READING_FONT_SIZES = ['small', 'medium', 'large'] as const;
export type ReadingFontSize = (typeof READING_FONT_SIZES)[number];

export type ResolvedAppearanceTheme = Exclude<AppearanceTheme, 'system'>;

export interface AppearancePreferences {
  theme: AppearanceTheme;
  fontSize: ReadingFontSize;
  reducedMotion: boolean;
}

export interface AppearanceStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export interface AppearanceMediaQuery {
  matches: boolean;
  addEventListener?: (type: 'change', listener: () => void) => void;
  removeEventListener?: (type: 'change', listener: () => void) => void;
  addListener?: (listener: () => void) => void;
  removeListener?: (listener: () => void) => void;
}

export const DEFAULT_APPEARANCE_PREFERENCES: Readonly<AppearancePreferences> = {
  // Keep the existing dark working environment for current users. System and light remain
  // explicit opt-in choices and are applied without changing the embedded preview document.
  theme: 'dark',
  fontSize: 'medium',
  reducedMotion: false,
};

const isAppearanceTheme = (value: unknown): value is AppearanceTheme =>
  typeof value === 'string' && APPEARANCE_THEMES.includes(value as AppearanceTheme);

const isReadingFontSize = (value: unknown): value is ReadingFontSize =>
  typeof value === 'string' && READING_FONT_SIZES.includes(value as ReadingFontSize);

const getStorage = (): AppearanceStorage | null => {
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

const getSystemThemeQuery = (): AppearanceMediaQuery | null => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return null;
  }

  try {
    return window.matchMedia('(prefers-color-scheme: dark)');
  } catch {
    return null;
  }
};

let systemThemeSubscription: (() => void) | null = null;

const clearSystemThemeSubscription = (): void => {
  systemThemeSubscription?.();
  systemThemeSubscription = null;
};

const subscribeToSystemTheme = (
  mediaQuery: AppearanceMediaQuery,
  listener: () => void,
): (() => void) => {
  if (mediaQuery.addEventListener && mediaQuery.removeEventListener) {
    mediaQuery.addEventListener('change', listener);
    return () => mediaQuery.removeEventListener?.('change', listener);
  }

  if (mediaQuery.addListener && mediaQuery.removeListener) {
    mediaQuery.addListener(listener);
    return () => mediaQuery.removeListener?.(listener);
  }

  return () => undefined;
};

export function normalizeAppearancePreferences(value: unknown): AppearancePreferences {
  const candidate = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

  return {
    theme: isAppearanceTheme(candidate.theme)
      ? candidate.theme
      : DEFAULT_APPEARANCE_PREFERENCES.theme,
    fontSize: isReadingFontSize(candidate.fontSize)
      ? candidate.fontSize
      : DEFAULT_APPEARANCE_PREFERENCES.fontSize,
    reducedMotion:
      typeof candidate.reducedMotion === 'boolean'
        ? candidate.reducedMotion
        : DEFAULT_APPEARANCE_PREFERENCES.reducedMotion,
  };
}

export function loadAppearancePreferences(
  storage: AppearanceStorage | null = getStorage(),
): AppearancePreferences {
  if (!storage) {
    return { ...DEFAULT_APPEARANCE_PREFERENCES };
  }

  try {
    const raw = storage.getItem(APPEARANCE_STORAGE_KEY);
    return raw
      ? normalizeAppearancePreferences(JSON.parse(raw))
      : { ...DEFAULT_APPEARANCE_PREFERENCES };
  } catch {
    return { ...DEFAULT_APPEARANCE_PREFERENCES };
  }
}

export function saveAppearancePreferences(
  preferences: AppearancePreferences,
  storage: AppearanceStorage | null = getStorage(),
): boolean {
  if (!storage) {
    return false;
  }

  try {
    storage.setItem(
      APPEARANCE_STORAGE_KEY,
      JSON.stringify(normalizeAppearancePreferences(preferences)),
    );
    return true;
  } catch {
    return false;
  }
}

export function resolveAppearanceTheme(
  theme: AppearanceTheme,
  systemTheme: ResolvedAppearanceTheme = getSystemTheme(),
): ResolvedAppearanceTheme {
  return theme === 'system' ? systemTheme : theme;
}

export function getSystemTheme(
  mediaQuery: AppearanceMediaQuery | null = getSystemThemeQuery(),
): ResolvedAppearanceTheme {
  // Dark is the compatibility fallback because EduCare historically shipped a dark canvas.
  return mediaQuery ? (mediaQuery.matches ? 'dark' : 'light') : 'dark';
}

export function applyAppearancePreferences(
  preferences: AppearancePreferences,
  root: HTMLElement | null = typeof document === 'undefined' ? null : document.documentElement,
): void {
  if (!root) {
    return;
  }

  clearSystemThemeSubscription();

  const normalized = normalizeAppearancePreferences(preferences);
  root.dataset.themePreference = normalized.theme;
  root.dataset.readingSize = normalized.fontSize;

  const systemThemeQuery = normalized.theme === 'system' ? getSystemThemeQuery() : null;
  if (normalized.theme !== 'system' || systemThemeQuery) {
    root.dataset.theme = resolveAppearanceTheme(normalized.theme, getSystemTheme(systemThemeQuery));
  } else {
    // Keep the historical fallback when matchMedia is unavailable (for example, SSR or a
    // non-browser test environment); the media query CSS can still provide a best effort.
    delete root.dataset.theme;
  }

  if (systemThemeQuery) {
    const updateEffectiveTheme = () => {
      root.dataset.theme = getSystemTheme(systemThemeQuery);
    };
    systemThemeSubscription = subscribeToSystemTheme(systemThemeQuery, updateEffectiveTheme);
  }

  if (normalized.reducedMotion) {
    root.dataset.reducedMotion = 'true';
  } else {
    delete root.dataset.reducedMotion;
  }
}
