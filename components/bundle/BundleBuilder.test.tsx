import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BundleBuilder from './BundleBuilder';
import type { AgentBundle, Assistant } from '../../types';

const { bundleService, credentials, providerManager } = vi.hoisted(() => ({
  bundleService: {
    buildAgentBundle: vi.fn(),
    validateBundle: vi.fn(),
    estimateBundleSize: vi.fn(() => 1024),
    downloadBundleJson: vi.fn<(bundle: AgentBundle) => string>(() => 'name.educare-bundle.json'),
    AGENT_BUNDLE_LARGE_FILE_BYTES: 2 * 1024 * 1024,
  },
  credentials: { encryptBundleProviderCredentials: vi.fn() },
  providerManager: { getAvailableProviders: vi.fn(), getSettings: vi.fn() },
}));

vi.mock('../../services/agentBundleService', () => bundleService);
vi.mock('../../services/bundleProviderCredentialsService', () => credentials);
vi.mock('../../services/providerRegistry', () => ({ providerManager }));

const makeAssistant = (overrides: Partial<Assistant> = {}): Assistant => ({
  id: overrides.id ?? 'a1',
  name: overrides.name ?? '助理一',
  description: overrides.description ?? '說明',
  systemPrompt: overrides.systemPrompt ?? '你是助理。',
  starterPrompts: overrides.starterPrompts ?? [],
  ragChunks: overrides.ragChunks ?? [],
  routableAssistantIds: overrides.routableAssistantIds,
  createdAt: overrides.createdAt ?? 1,
});

const bundleFixture = (): AgentBundle => ({
  manifest: {
    format: 'educare-agent-bundle',
    schemaVersion: 1,
    name: '我的協作包',
    description: '',
    version: '1.0.0',
    exportedAt: 1,
    entryAgentId: 'a1',
  },
  agents: [],
  routes: [],
});

const reachStep3 = async (assistants: Assistant[]) => {
  bundleService.buildAgentBundle.mockReturnValue(bundleFixture());

  render(
    <BundleBuilder
      assistants={assistants}
      onClose={() => undefined}
      onPreviewBundle={() => undefined}
    />,
  );

  // Step 1: select two assistants.
  for (const assistant of assistants.slice(0, 2)) {
    await act(async () => {
      fireEvent.click(screen.getByLabelText(new RegExp(assistant.name)));
    });
  }
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
  });

  // Step 2: choose receptionist.
  await act(async () => {
    fireEvent.click(screen.getByLabelText(`設為接待入口：${assistants[0].name}`));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
  });
};

describe('BundleBuilder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bundleService.estimateBundleSize.mockReturnValue(1024);
    bundleService.buildAgentBundle.mockReturnValue(bundleFixture());
    providerManager.getAvailableProviders.mockReturnValue([{ type: 'gemini' }]);
    providerManager.getSettings.mockReturnValue({ providers: {} });
    credentials.encryptBundleProviderCredentials.mockResolvedValue({
      v: 1,
      algorithm: 'AES-GCM',
      kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 100000 },
      salt: 'abcdefghijklmnopqrstuv',
      iv: 'abcdefghijklmnop',
      ciphertext: 'encrypted-settings',
    });
  });

  it('requires at least two assistants before leaving the selection step', () => {
    const assistants = [makeAssistant({ id: 'a1', name: '甲' })];
    render(
      <BundleBuilder
        assistants={assistants}
        onClose={() => undefined}
        onPreviewBundle={() => undefined}
      />,
    );

    expect(screen.getByRole('button', { name: '下一步' })).toBeDisabled();
  });

  it('blocks export when validation reports errors', async () => {
    bundleService.validateBundle.mockReturnValue({
      bundle: bundleFixture(),
      errors: [
        { code: 'dangling-route', message: '路由指向不存在的助理。', nextStep: '請移除該路由。' },
      ],
      warnings: [],
    });
    const assistants = [
      makeAssistant({ id: 'a1', name: '甲' }),
      makeAssistant({ id: 'a2', name: '乙' }),
    ];

    await reachStep3(assistants);

    await act(async () => {
      fireEvent.change(screen.getByLabelText('協作包名稱'), { target: { value: '我的協作包' } });
    });

    expect(screen.getByText('路由指向不存在的助理。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '匯出 JSON' })).toBeDisabled();
    expect(bundleService.downloadBundleJson).not.toHaveBeenCalled();
  });

  it('shows warnings without blocking export', async () => {
    bundleService.validateBundle.mockReturnValue({
      bundle: bundleFixture(),
      errors: [],
      warnings: [
        { code: 'empty-prompt', message: '有助理缺少 system prompt。', nextStep: '建議補上。' },
      ],
    });
    const assistants = [
      makeAssistant({ id: 'a1', name: '甲' }),
      makeAssistant({ id: 'a2', name: '乙' }),
    ];

    await reachStep3(assistants);

    await act(async () => {
      fireEvent.change(screen.getByLabelText('協作包名稱'), { target: { value: '我的協作包' } });
    });

    expect(screen.getByText('有助理缺少 system prompt。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '匯出 JSON' })).toBeEnabled();
  });

  it('keeps the default export at v1 without provider credentials', async () => {
    bundleService.validateBundle.mockReturnValue({
      bundle: bundleFixture(),
      errors: [],
      warnings: [],
    });
    const assistants = [
      makeAssistant({ id: 'a1', name: '甲' }),
      makeAssistant({ id: 'a2', name: '乙' }),
    ];

    await reachStep3(assistants);

    await act(async () => {
      fireEvent.change(screen.getByLabelText('協作包名稱'), { target: { value: '我的協作包' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '匯出 JSON' }));
    });

    expect(credentials.encryptBundleProviderCredentials).not.toHaveBeenCalled();
    const [exportedBundle] = bundleService.downloadBundleJson.mock.calls[0];
    expect(exportedBundle.manifest.schemaVersion).toBe(1);
    expect(exportedBundle).not.toHaveProperty('encryptedProviderSettings');
  });

  it('keeps v1 as the default export and emits only encrypted provider settings when opted in', async () => {
    bundleService.validateBundle.mockReturnValue({
      bundle: bundleFixture(),
      errors: [],
      warnings: [],
    });
    const assistants = [
      makeAssistant({ id: 'a1', name: '甲' }),
      makeAssistant({ id: 'a2', name: '乙' }),
    ];

    await reachStep3(assistants);
    fireEvent.change(screen.getByLabelText('協作包名稱'), { target: { value: '我的協作包' } });
    fireEvent.click(screen.getByLabelText('隨附目前已設定 AI 服務商的加密設定'));
    fireEvent.change(screen.getByLabelText('要隨附的已設定 AI 服務商'), {
      target: { value: 'gemini' },
    });
    fireEvent.change(screen.getByLabelText('保護密碼'), { target: { value: 'a-shared-password' } });
    fireEvent.change(screen.getByLabelText('確認密碼'), { target: { value: 'a-shared-password' } });
    fireEvent.click(
      screen.getByLabelText('我知道密碼必須另行安全傳送，且收件者可改用自己的 AI 服務商。'),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '匯出 JSON' }));
    });

    await waitFor(() =>
      expect(credentials.encryptBundleProviderCredentials).toHaveBeenCalledOnce(),
    );
    expect(bundleService.downloadBundleJson).toHaveBeenCalledWith(
      expect.objectContaining({
        manifest: expect.objectContaining({ schemaVersion: 2 }),
        encryptedProviderSettings: expect.objectContaining({ ciphertext: 'encrypted-settings' }),
      }),
    );
  });

  it('passes the in-memory bundle to preview without invoking download', async () => {
    bundleService.validateBundle.mockReturnValue({
      bundle: bundleFixture(),
      errors: [],
      warnings: [],
    });
    const onPreviewBundle = vi.fn();
    const assistants = [
      makeAssistant({ id: 'a1', name: '甲' }),
      makeAssistant({ id: 'a2', name: '乙' }),
    ];

    bundleService.buildAgentBundle.mockReturnValue(bundleFixture());
    render(
      <BundleBuilder
        assistants={assistants}
        onClose={() => undefined}
        onPreviewBundle={onPreviewBundle}
      />,
    );

    for (const assistant of assistants.slice(0, 2)) {
      await act(async () => {
        fireEvent.click(screen.getByLabelText(new RegExp(assistant.name)));
      });
    }
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText(`設為接待入口：${assistants[0].name}`));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '預覽' }));
    });

    expect(onPreviewBundle).toHaveBeenCalledWith(bundleFixture());
    expect(bundleService.downloadBundleJson).not.toHaveBeenCalled();
  });

  it('warns above the large-file threshold', async () => {
    bundleService.estimateBundleSize.mockReturnValue(3 * 1024 * 1024);
    bundleService.validateBundle.mockReturnValue({
      bundle: bundleFixture(),
      errors: [],
      warnings: [],
    });
    const assistants = [
      makeAssistant({ id: 'a1', name: '甲' }),
      makeAssistant({ id: 'a2', name: '乙' }),
    ];

    await reachStep3(assistants);

    expect(screen.getByText(/體積較大/)).toBeInTheDocument();
  });

  it('pre-fills route edges from routableAssistantIds', async () => {
    const assistants = [
      makeAssistant({ id: 'a1', name: '甲', routableAssistantIds: ['a2'] }),
      makeAssistant({ id: 'a2', name: '乙' }),
    ];
    bundleService.buildAgentBundle.mockReturnValue(bundleFixture());

    render(
      <BundleBuilder
        assistants={assistants}
        onClose={() => undefined}
        onPreviewBundle={() => undefined}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByLabelText(/甲/));
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText(/乙/));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText('設為接待入口：甲'));
    });

    expect(bundleService.buildAgentBundle).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: 'a1' }),
        expect.objectContaining({ id: 'a2' }),
      ]),
      'a1',
      expect.arrayContaining([expect.objectContaining({ fromAgentId: 'a1', toAgentId: 'a2' })]),
      expect.any(Object),
    );
  });
});
