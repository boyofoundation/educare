import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

  it('offers a template and persists completion after applying it', async () => {
    const onApplyTemplate = vi.fn();
    const onComplete = vi.fn();
    render(<Onboarding onApplyTemplate={onApplyTemplate} onComplete={onComplete} />);

    fireEvent.click(screen.getByRole('button', { name: /英文教學樣板/ }));
    fireEvent.click(screen.getByRole('button', { name: '套用樣板並開始' }));

    expect(onApplyTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'tpl_english_teaching', name: '英文教學' }),
    );
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith('template'));
    await waitFor(() =>
      expect(getOnboardingPreferences()).toMatchObject({
        completed: true,
        completionReason: 'template',
        selectedTemplateId: 'tpl_english_teaching',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('supports import and browse routes without requiring provider setup', async () => {
    const onImportAssistant = vi.fn();
    const onBrowse = vi.fn();
    const { rerender } = render(
      <Onboarding onImportAssistant={onImportAssistant} onBrowse={onBrowse} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /匯入助理／協作包/ }));
    expect(onImportAssistant).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(getOnboardingPreferences()).toMatchObject({
        completed: true,
        completionReason: 'import',
      }),
    );

    rerender(
      <Onboarding isOpen={true} onImportAssistant={onImportAssistant} onBrowse={onBrowse} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /先瀏覽已保存內容/ }));
    expect(onBrowse).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(getOnboardingPreferences()).toMatchObject({
        completed: true,
        completionReason: 'browse',
      }),
    );
  });

  it('completes the guide and shows a session-only warning when storage fails', async () => {
    vi.mocked(localStorage.setItem).mockImplementation(() => {
      throw new Error('storage blocked');
    });
    const onBrowse = vi.fn();

    render(<Onboarding onBrowse={onBrowse} />);
    fireEvent.click(screen.getByRole('button', { name: /先瀏覽已保存內容/ }));

    expect(onBrowse).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() =>
      expect(screen.getByTestId('onboarding-persistence-warning')).toHaveTextContent('本分頁'),
    );

    vi.mocked(localStorage.setItem).mockImplementation(() => undefined);
  });
});
