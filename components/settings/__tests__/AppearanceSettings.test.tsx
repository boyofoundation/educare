import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AppearanceSettings from '../AppearanceSettings';
import {
  DEFAULT_APPEARANCE_PREFERENCES,
  type AppearancePreferences,
  type AppearanceStorage,
} from '../../../services/appearancePreferences';

const createStorage = (): AppearanceStorage => ({
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
});

const initialPreferences: AppearancePreferences = {
  theme: 'dark',
  fontSize: 'medium',
  reducedMotion: false,
};

describe('AppearanceSettings', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-theme-preference');
    document.documentElement.removeAttribute('data-reading-size');
    document.documentElement.removeAttribute('data-reduced-motion');
  });

  it('renders accessible controls for theme, reading size, and motion', () => {
    render(
      <AppearanceSettings initialPreferences={initialPreferences} storage={createStorage()} />,
    );

    expect(screen.getByRole('heading', { name: '外觀與閱讀' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /跟隨系統/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /淺色/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /深色/ })).toBeChecked();
    expect(screen.getByRole('combobox', { name: /^閱讀字級/ })).toHaveValue('medium');
    expect(screen.getByRole('checkbox', { name: /減少動態效果/ })).not.toBeChecked();
  });

  it('applies and persists changes from the uncontrolled settings surface', async () => {
    const storage = createStorage();
    render(<AppearanceSettings initialPreferences={initialPreferences} storage={storage} />);

    fireEvent.click(screen.getByTestId('appearance-theme-light'));
    fireEvent.change(screen.getByTestId('appearance-font-size'), { target: { value: 'large' } });
    fireEvent.click(screen.getByTestId('appearance-reduced-motion'));

    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.dataset.readingSize).toBe('large');
    expect(document.documentElement.dataset.reducedMotion).toBe('true');
    await waitFor(() => expect(storage.setItem).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('外觀設定已儲存'));
  });

  it('supports controlled values and reports the complete next preference object', () => {
    const onChange = vi.fn();
    const value: AppearancePreferences = {
      theme: 'dark',
      fontSize: 'small',
      reducedMotion: true,
    };

    render(<AppearanceSettings value={value} onChange={onChange} storage={createStorage()} />);
    fireEvent.click(screen.getByTestId('appearance-theme-system'));

    expect(onChange).toHaveBeenCalledWith({
      theme: 'system',
      fontSize: 'small',
      reducedMotion: true,
    });
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('restores defaults with one explicit action', () => {
    const storage = createStorage();
    render(
      <AppearanceSettings
        initialPreferences={{ theme: 'light', fontSize: 'large', reducedMotion: true }}
        storage={storage}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '恢復預設' }));

    expect(screen.getByRole('radio', { name: /深色/ })).toBeChecked();
    expect(screen.getByRole('combobox', { name: /^閱讀字級/ })).toHaveValue(
      DEFAULT_APPEARANCE_PREFERENCES.fontSize,
    );
    expect(screen.getByRole('checkbox', { name: /減少動態效果/ })).not.toBeChecked();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.dataset.reducedMotion).toBeUndefined();
  });
});
