import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  completeOnboarding,
  getOnboardingPreferences,
  ONBOARDING_PREFERENCES_KEY,
  resetOnboardingPreferences,
} from './onboardingPreferences';

describe('onboardingPreferences', () => {
  beforeEach(() => {
    resetOnboardingPreferences();
    vi.clearAllMocks();
  });

  it('starts incomplete and persists the completion route locally', () => {
    expect(getOnboardingPreferences()).toEqual({ completed: false, dismissed: false });

    completeOnboarding('template', 'tpl_english_teaching');

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

  it('can be reset so Settings can reopen the guide', () => {
    completeOnboarding('skip');

    expect(resetOnboardingPreferences()).toEqual({ completed: false, dismissed: false });
    expect(getOnboardingPreferences()).toEqual({ completed: false, dismissed: false });
  });
});
