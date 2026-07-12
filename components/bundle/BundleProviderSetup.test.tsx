import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BundleProviderSetup from './BundleProviderSetup';

const { providerManager, provider } = vi.hoisted(() => {
  const provider = {
    initialize: vi.fn().mockResolvedValue(undefined),
    streamChat: vi.fn(),
  };

  return {
    provider,
    providerManager: {
      getProvider: vi.fn(),
      setSessionProviderConfig: vi.fn().mockResolvedValue(undefined),
      enableProvider: vi.fn(),
      updateProviderConfig: vi.fn(),
      setActiveProvider: vi.fn(),
    },
  };
});

vi.mock('../../services/providerRegistry', () => ({ providerManager }));

describe('BundleProviderSetup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    providerManager.getProvider.mockReturnValue(provider);
    provider.streamChat.mockImplementation(async function* () {
      yield { text: 'OK', isComplete: true };
    });
  });

  it('validates provider input and exposes session and browser scope controls', () => {
    render(<BundleProviderSetup onReady={vi.fn()} />);

    expect(screen.getByRole('button', { name: '測試連線' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '儲存並開始對話' })).toBeDisabled();
    expect(screen.getByLabelText('僅本次（預設，關閉分頁即清除）')).toBeChecked();
    expect(screen.getByLabelText('記住在此瀏覽器')).not.toBeChecked();

    fireEvent.change(screen.getByLabelText('API 金鑰'), { target: { value: 'short' } });
    expect(screen.getByText('金鑰至少需要 8 個字元；將以密碼欄位遮蔽。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '測試連線' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('AI 服務商'), { target: { value: 'ollama' } });
    expect(screen.getByLabelText('服務網址')).toHaveAttribute('type', 'url');
    fireEvent.change(screen.getByLabelText('服務網址'), { target: { value: 'localhost:11434' } });
    expect(screen.getByRole('button', { name: '儲存並開始對話' })).toBeDisabled();
  });

  it('tests a session-only configuration with a minimal request and calls onReady after success', async () => {
    const onReady = vi.fn();
    render(<BundleProviderSetup onReady={onReady} />);

    fireEvent.change(screen.getByLabelText('API 金鑰'), { target: { value: 'session-key' } });
    fireEvent.click(screen.getByRole('button', { name: '測試連線' }));

    await waitFor(() => expect(onReady).toHaveBeenCalledOnce());

    expect(providerManager.setSessionProviderConfig).toHaveBeenCalledWith('gemini', {
      apiKey: 'session-key',
    });
    expect(providerManager.enableProvider).not.toHaveBeenCalled();
    expect(providerManager.updateProviderConfig).not.toHaveBeenCalled();
    expect(providerManager.setActiveProvider).not.toHaveBeenCalled();
    expect(provider.streamChat).toHaveBeenCalledWith({
      systemPrompt: 'You are a connection test.',
      history: [],
      message: 'Reply with OK.',
    });
    expect(screen.getByRole('status')).toHaveTextContent('連線測試成功，可以開始對話。');
  });

  it('uses the persistent provider manager path when browser scope is selected', async () => {
    const onReady = vi.fn();
    render(<BundleProviderSetup onReady={onReady} />);

    fireEvent.click(screen.getByLabelText('記住在此瀏覽器'));
    fireEvent.change(screen.getByLabelText('API 金鑰'), { target: { value: 'persistent-key' } });
    fireEvent.click(screen.getByRole('button', { name: '儲存並開始對話' }));

    await waitFor(() => expect(onReady).toHaveBeenCalledOnce());

    expect(providerManager.enableProvider).toHaveBeenCalledWith('gemini', true);
    expect(providerManager.updateProviderConfig).toHaveBeenCalledWith('gemini', {
      apiKey: 'persistent-key',
    });
    expect(providerManager.setActiveProvider).toHaveBeenCalledWith('gemini');
    expect(provider.initialize).toHaveBeenCalledWith({ apiKey: 'persistent-key' });
    expect(providerManager.setSessionProviderConfig).not.toHaveBeenCalled();
  });
});
