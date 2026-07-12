import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BundleBuilder from './BundleBuilder';
import type { AgentBundle, Assistant } from '../../types';

const { bundleService } = vi.hoisted(() => ({
  bundleService: {
    buildAgentBundle: vi.fn(),
    validateBundle: vi.fn(),
    estimateBundleSize: vi.fn(() => 1024),
    downloadBundleJson: vi.fn(() => 'name.educare-bundle.json'),
    AGENT_BUNDLE_LARGE_FILE_BYTES: 2 * 1024 * 1024,
  },
}));

vi.mock('../../services/agentBundleService', () => bundleService);

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

  it('downloads the bundle when export is ready', async () => {
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

    expect(bundleService.downloadBundleJson).toHaveBeenCalledWith(bundleFixture());
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
