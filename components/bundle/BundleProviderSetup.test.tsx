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

    expect(providerManager.setSessionProviderConfig).toHaveBeenCalledWith(
      'gemini',
      expect.objectContaining({
        apiKey: 'session-key',
        model: 'gemini-2.5-flash',
        temperature: 0.7,
        maxTokens: 4096,
        maxToolRounds: 50,
      }),
    );
    expect(providerManager.enableProvider).not.toHaveBeenCalled();
    expect(providerManager.updateProviderConfig).not.toHaveBeenCalled();
    expect(providerManager.setActiveProvider).not.toHaveBeenCalled();
    expect(provider.streamChat).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: 'You are a connection test.',
        history: [],
        message: 'Reply with OK.',
        model: 'gemini-2.5-flash',
        temperature: 0.7,
        maxTokens: 4096,
        maxToolRounds: 50,
      }),
    );
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
    expect(providerManager.updateProviderConfig).toHaveBeenCalledWith(
      'gemini',
      expect.objectContaining({
        apiKey: 'persistent-key',
        model: 'gemini-2.5-flash',
        temperature: 0.7,
        maxTokens: 4096,
        maxToolRounds: 50,
      }),
    );
    expect(providerManager.setActiveProvider).toHaveBeenCalledWith('gemini');
    expect(provider.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'persistent-key',
        model: 'gemini-2.5-flash',
        temperature: 0.7,
        maxTokens: 4096,
        maxToolRounds: 50,
      }),
    );
    expect(providerManager.setSessionProviderConfig).not.toHaveBeenCalled();
  });

  it('keeps model and advanced settings editable after switching providers', async () => {
    const onReady = vi.fn();
    render(<BundleProviderSetup onReady={onReady} />);

    fireEvent.change(screen.getByLabelText('AI 服務商'), { target: { value: 'openrouter' } });
    fireEvent.change(screen.getByLabelText('API 金鑰'), { target: { value: 'openrouter-key' } });
    fireEvent.change(screen.getByLabelText('MODEL'), {
      target: { value: 'anthropic/claude-3.7-sonnet' },
    });
    fireEvent.change(screen.getByLabelText(/創造性 \(Temperature\)/), {
      target: { value: '1.2' },
    });
    fireEvent.change(screen.getByLabelText('最大回應長度 (Tokens)'), {
      target: { value: '8192' },
    });
    fireEvent.change(screen.getByLabelText('工具呼叫次數上限'), {
      target: { value: '80' },
    });
    fireEvent.click(screen.getByRole('button', { name: '儲存並開始對話' }));

    await waitFor(() => expect(onReady).toHaveBeenCalledOnce());

    expect(providerManager.setSessionProviderConfig).toHaveBeenCalledWith(
      'openrouter',
      expect.objectContaining({
        apiKey: 'openrouter-key',
        model: 'anthropic/claude-3.7-sonnet',
        temperature: 1.2,
        maxTokens: 8192,
        maxToolRounds: 80,
      }),
    );
    expect(provider.streamChat).not.toHaveBeenCalled();
  });
});
