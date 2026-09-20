import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Onboarding } from '../Onboarding';
import {
  getOnboardingPreferences,
  resetOnboardingPreferences,
} from '../../../services/onboardingPreferences';

describe('Onboarding', () => {
  beforeEach(() => {
    resetOnboardingPreferences();
  });

  it('offers a template and persists completion after applying it', () => {
    const onApplyTemplate = vi.fn();
    const onComplete = vi.fn();
    render(<Onboarding onApplyTemplate={onApplyTemplate} onComplete={onComplete} />);

    fireEvent.click(screen.getByRole('button', { name: /英文教學樣板/ }));
    fireEvent.click(screen.getByRole('button', { name: '套用樣板並開始' }));

    expect(onApplyTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'tpl_english_teaching', name: '英文教學' }),
    );
    expect(onComplete).toHaveBeenCalledWith('template');
    expect(getOnboardingPreferences()).toMatchObject({
      completed: true,
      completionReason: 'template',
      selectedTemplateId: 'tpl_english_teaching',
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('supports import and browse routes without requiring provider setup', () => {
    const onImportAssistant = vi.fn();
    const onBrowse = vi.fn();
    const { rerender } = render(
      <Onboarding onImportAssistant={onImportAssistant} onBrowse={onBrowse} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /匯入助理／協作包/ }));
    expect(onImportAssistant).toHaveBeenCalledTimes(1);
    expect(getOnboardingPreferences()).toMatchObject({
      completed: true,
      completionReason: 'import',
    });

    rerender(
      <Onboarding isOpen={true} onImportAssistant={onImportAssistant} onBrowse={onBrowse} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /先瀏覽已保存內容/ }));
    expect(onBrowse).toHaveBeenCalledTimes(1);
    expect(getOnboardingPreferences()).toMatchObject({
      completed: true,
      completionReason: 'browse',
    });
  });
});
