import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetPracticeStoreForTesting,
  createPracticeProfile,
  listPracticeLessons,
} from '../../services/practiceWorkspaceService';
import PracticeWorkspace from './PracticeWorkspace';

describe('PracticeWorkspace', () => {
  beforeEach(async () => {
    await __resetPracticeStoreForTesting();
  });

  afterEach(async () => {
    await __resetPracticeStoreForTesting();
  });

  it('previews generated content before saving, then enters offline practice', async () => {
    const profile = await createPracticeProfile('UI profile');
    render(<PracticeWorkspace profileId={profile.id} />);

    await waitFor(() => expect(screen.getByRole('button', { name: '產生題組預覽' })).toBeEnabled());
    expect(screen.queryByText('預覽與編輯')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '產生題組預覽' }));
    expect(screen.getByText('預覽與編輯')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('教案標題'), { target: { value: '我的英文題組' } });
    fireEvent.click(screen.getByRole('button', { name: '保存教案' }));

    await waitFor(() =>
      expect(screen.getByText('教案已保存，可在題組區開始練習。')).toBeInTheDocument(),
    );
    expect(await listPracticeLessons(profile.id)).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '開始練習' }));
    expect(screen.getByText(/練習：我的英文題組/)).toBeInTheDocument();
  });

  it('does not print or download until the user explicitly clicks an action', async () => {
    const profile = await createPracticeProfile('UI profile');
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    render(<PracticeWorkspace profileId={profile.id} />);
    await waitFor(() => expect(screen.getByRole('button', { name: '產生題組預覽' })).toBeEnabled());

    expect(printSpy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '產生題組預覽' }));
    fireEvent.click(screen.getByRole('button', { name: '保存教案' }));
    await waitFor(() =>
      expect(screen.getByText('教案已保存，可在題組區開始練習。')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: '列印目前教案' }));
    expect(printSpy).toHaveBeenCalledOnce();
    printSpy.mockRestore();
  });
});
