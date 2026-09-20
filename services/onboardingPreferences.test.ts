import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  completeOnboarding,
  saveOnboardingPreferencesAsync,
  getOnboardingPreferences,
  ONBOARDING_PREFERENCES_KEY,
  resetOnboardingPreferences,
} from './onboardingPreferences';
import {
  __resetWorkspaceOperationServiceForTesting,
  withWorkspaceOperation,
} from './workspaceOperationService';

describe('onboardingPreferences', () => {
  beforeEach(() => {
    resetOnboardingPreferences();
    vi.clearAllMocks();
  });

  afterEach(() => {
    __resetWorkspaceOperationServiceForTesting();
    vi.mocked(localStorage.getItem).mockReturnValue(null);
    vi.mocked(localStorage.setItem).mockImplementation(() => undefined);
  });

  it('starts incomplete and persists the completion route locally', () => {
    expect(getOnboardingPreferences()).toEqual({ completed: false, dismissed: false });

    const result = completeOnboarding('template', 'tpl_english_teaching');

    expect(result).toMatchObject({
      persisted: true,
      completed: true,
      preferences: {
        completed: true,
        dismissed: false,
        completionReason: 'template',
        selectedTemplateId: 'tpl_english_teaching',
      },
    });

    expect(getOnboardingPreferences()).toMatchObject({
      completed: true,
      dismissed: false,
      completionReason: 'template',
      selectedTemplateId: 'tpl_english_teaching',
    });
    expect(localStorage.setItem).toHaveBeenCalledWith(
      ONBOARDING_PREFERENCES_KEY,
      expect.stringContaining('tpl_english_teaching'),
    );
  });

  it('reports session-only completion when browser storage rejects the update', () => {
    vi.mocked(localStorage.setItem).mockImplementation(() => {
      throw new Error('storage blocked');
    });

    const result = completeOnboarding('browse');

    expect(result).toMatchObject({
      persisted: false,
      completed: true,
      preferences: {
        completed: true,
        dismissed: false,
        completionReason: 'browse',
      },
    });
    expect(getOnboardingPreferences()).toMatchObject({
      completed: true,
      completionReason: 'browse',
    });
    vi.mocked(localStorage.setItem).mockImplementation(() => undefined);
  });

  it('can be reset so Settings can reopen the guide', () => {
    completeOnboarding('skip');

    expect(resetOnboardingPreferences()).toEqual({ completed: false, dismissed: false });
    expect(getOnboardingPreferences()).toEqual({ completed: false, dismissed: false });
  });

  it('defers async onboarding writes until an exclusive workspace operation finishes', async () => {
    let pendingWrite: ReturnType<typeof saveOnboardingPreferencesAsync> | undefined;

    await withWorkspaceOperation('export', async () => {
      vi.mocked(localStorage.setItem).mockClear();
      pendingWrite = saveOnboardingPreferencesAsync({ completed: true, dismissed: false });
      await Promise.resolve();
      expect(localStorage.setItem).not.toHaveBeenCalled();
    });

    await expect(pendingWrite).resolves.toMatchObject({ persisted: true, completed: true });
    expect(localStorage.setItem).toHaveBeenCalledWith(
      ONBOARDING_PREFERENCES_KEY,
      expect.stringContaining('"completed":true'),
    );
  });

  it('keeps the previous stored onboarding value when an async write fails', async () => {
    const previousValue = JSON.stringify({ completed: false, dismissed: false });
    vi.mocked(localStorage.getItem).mockReturnValue(previousValue);
    vi.mocked(localStorage.setItem).mockImplementation(() => {
      throw new Error('storage blocked');
    });

    await expect(saveOnboardingPreferencesAsync({ completed: true })).resolves.toMatchObject({
      persisted: false,
      completed: true,
    });
    expect(localStorage.getItem(ONBOARDING_PREFERENCES_KEY)).toBe(previousValue);
  });
});
