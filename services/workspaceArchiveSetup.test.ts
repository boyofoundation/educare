import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./workspaceArchiveService', () => ({
  WORKSPACE_ARCHIVE_PREFERENCE_KEYS: ['educare.appearance.v1', 'sidebarCollapsed'],
  registerWorkspaceArchiveProvider: vi.fn(() => vi.fn()),
  getWorkspaceArchiveMetadata: vi.fn().mockResolvedValue({ recoveryStatus: [] }),
}));

import { workspaceArchiveImportOptions as options } from './workspaceArchiveSetup';

describe('workspace preference journal callbacks', () => {
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(() => {
    vi.restoreAllMocks();
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => values.set(key, value)),
      removeItem: vi.fn((key: string) => values.delete(key)),
      clear: vi.fn(() => values.clear()),
    });
  });

  it('round-trips exact previous strings and removes newly introduced keys', async () => {
    localStorage.setItem('sidebarCollapsed', 'false');
    localStorage.setItem('providerSettings', 'SECRET-MARKER');
    const previous = await options.readPreferences!();
    expect(previous).toEqual({ sidebarCollapsed: 'false' });
    await options.applyPreferences!({
      sidebarCollapsed: true,
      'educare.appearance.v1': { theme: 'light' },
    });
    expect(localStorage.getItem('sidebarCollapsed')).toBe('true');
    await options.restorePreferences!(previous);
    expect(localStorage.getItem('sidebarCollapsed')).toBe('false');
    expect(localStorage.getItem('educare.appearance.v1')).toBeNull();
    expect(localStorage.getItem('providerSettings')).toBe('SECRET-MARKER');
  });

  it('rejects unknown preference keys before changing an allowed key', () => {
    localStorage.setItem('sidebarCollapsed', 'false');
    expect(() => options.applyPreferences!({ sidebarCollapsed: true, apiKey: 'SECRET' })).toThrow();
    expect(localStorage.getItem('sidebarCollapsed')).toBe('false');
    expect(localStorage.getItem('apiKey')).toBeNull();
  });

  it('surfaces quota failures instead of reporting successful rollback', () => {
    vi.mocked(localStorage.setItem).mockImplementation(() => {
      throw new globalThis.DOMException('full', 'QuotaExceededError');
    });
    expect(() => options.restorePreferences!({ sidebarCollapsed: 'false' })).toThrow('尚未回復');
  });
});
