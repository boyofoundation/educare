import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BundleEditor from './BundleEditor';
import type { AgentBundle, Assistant } from '../../types';

const { validateBundle } = vi.hoisted(() => ({
  validateBundle: vi.fn(),
}));

vi.mock('../../services/agentBundleService', () => ({
  validateBundle,
}));

vi.mock('../assistant', () => ({
  AssistantEditor: ({
    assistant,
    onSave,
    onDraftChange,
  }: {
    assistant: Assistant;
    onSave: (assistant: Assistant) => void;
    onDraftChange?: (assistant: Assistant) => void;
  }) => (
    <div data-testid='assistant-editor-stub'>
      <span>{assistant.name}</span>
      <button type='button' onClick={() => onSave({ ...assistant, name: '更新後助理' })}>
        套用助理修改
      </button>
      <button
        type='button'
        onClick={() =>
          onDraftChange?.({ ...assistant, mathToolsEnabled: true, webSpeechToolsEnabled: true })
        }
      >
        套用工具修改
      </button>
    </div>
  ),
}));

const makeBundle = (): AgentBundle => ({
  manifest: {
    format: 'educare-agent-bundle',
    schemaVersion: 1,
    name: '原始協作包',
    description: '原始描述',
    version: '1.0.0',
    exportedAt: 10,
    entryAgentId: 'entry',
  },
  agents: [
    {
      id: 'entry',
      name: '入口助理',
      description: '入口描述',
      systemPrompt: '入口提示',
      starterPrompts: [],
      ragChunks: [],
    },
    {
      id: 'math',
      name: '數學助理',
      description: '數學描述',
      systemPrompt: '數學提示',
      starterPrompts: [],
      ragChunks: [],
    },
  ],
  routes: [{ fromAgentId: 'entry', toAgentId: 'math', condition: '原始條件' }],
});

describe('BundleEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validateBundle.mockReturnValue({ bundle: makeBundle(), errors: [], warnings: [] });
  });

  it('saves bundle metadata, agent edits, entry agent, and route conditions together', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const bundle = makeBundle();
    render(<BundleEditor bundle={bundle} onSave={onSave} onCancel={() => undefined} />);

    fireEvent.change(screen.getByLabelText('協作包名稱'), { target: { value: '更新後協作包' } });
    fireEvent.change(screen.getByLabelText('接待入口助理'), { target: { value: 'math' } });
    fireEvent.change(screen.getByPlaceholderText('觸發條件（選填）'), {
      target: { value: '新條件' },
    });
    fireEvent.click(screen.getByRole('button', { name: '套用助理修改' }));
    fireEvent.click(screen.getByRole('button', { name: '儲存協作包' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    const savedBundle = onSave.mock.calls[0][0] as AgentBundle;
    expect(savedBundle.manifest).toEqual(
      expect.objectContaining({ name: '更新後協作包', entryAgentId: 'math' }),
    );
    expect(savedBundle.agents[0]).toEqual(expect.objectContaining({ name: '更新後助理' }));
    expect(savedBundle.routes).toEqual([
      expect.objectContaining({
        fromAgentId: 'entry',
        toAgentId: 'math',
        condition: '新條件',
      }),
    ]);
  });

  it('blocks saving when the edited bundle fails validation', async () => {
    validateBundle.mockReturnValue({
      bundle: null,
      errors: [{ message: '入口助理不存在。' }],
      warnings: [],
    });
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(<BundleEditor bundle={makeBundle()} onSave={onSave} onCancel={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: '儲存協作包' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('入口助理不存在。'));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('persists tool toggles from the editor draft with the outer bundle save', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<BundleEditor bundle={makeBundle()} onSave={onSave} onCancel={() => undefined} />);

    fireEvent.click(screen.getByRole('button', { name: '套用工具修改' }));
    fireEvent.click(screen.getByRole('button', { name: '儲存協作包' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(onSave.mock.calls[0][0].agents[0]).toEqual(
      expect.objectContaining({ mathToolsEnabled: true, webSpeechToolsEnabled: true }),
    );
  });
});
