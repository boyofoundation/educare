import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const { mockLoadPreferences, mockSavePreferencesAsync } = vi.hoisted(() => ({
  mockLoadPreferences: vi.fn(),
  mockSavePreferencesAsync: vi.fn(),
}));

vi.mock('../../services/openJevExperimentPreferences', () => ({
  OPEN_JEV_EXPERIMENT_PREFERENCES_CHANGED_EVENT: 'educare:open-jev-experiment-preferences-changed',
  loadOpenJevExperimentPreferences: mockLoadPreferences,
  saveOpenJevExperimentPreferences: vi.fn(() => true),
  saveOpenJevExperimentPreferencesAsync: mockSavePreferencesAsync,
}));

vi.mock('../../services/openJevDecisionService', () => ({
  disposeOpenJevModel: vi.fn().mockResolvedValue(undefined),
  getOpenJevModelInfo: vi.fn().mockResolvedValue(undefined),
  getOpenJevModelSnapshot: vi.fn(() => ({
    status: 'idle',
    progress: null,
    loadedBytes: null,
    totalBytes: null,
  })),
  loadOpenJevModel: vi.fn().mockResolvedValue(undefined),
  subscribeOpenJevModelStatus: vi.fn(() => () => undefined),
}));

import OpenJevExperimentSettings from './OpenJevExperimentSettings';

describe('OpenJevExperimentSettings', () => {
  beforeEach(() => {
    mockLoadPreferences.mockReset();
    mockLoadPreferences.mockReturnValue({ enabled: false });
    mockSavePreferencesAsync.mockReset();
    mockSavePreferencesAsync.mockResolvedValue(true);
  });

  it('is disabled by default and persists an explicit opt-in', async () => {
    render(<OpenJevExperimentSettings />);

    const toggle = screen.getByTestId('open-jev-experiment-enabled') as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    expect(screen.queryByTestId('open-jev-load-model')).not.toBeInTheDocument();

    mockLoadPreferences.mockReturnValue({ enabled: true });
    fireEvent.click(toggle);

    await waitFor(() => expect(mockSavePreferencesAsync).toHaveBeenCalledWith({ enabled: true }));
    expect(toggle.checked).toBe(true);
    expect(screen.getByTestId('open-jev-load-model')).toBeInTheDocument();
  });
});
