import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { AssistantEditor } from '../AssistantEditor';
import { TEST_ASSISTANTS, TEST_RAG_CHUNKS, setupAssistantTestEnvironment } from './test-utils';
import type { Assistant, RagChunk } from '../../../types';
import { useTursoAssistantStatus } from '../../../hooks/useTursoAssistantStatus';
import {
  waitForWorkspaceWrites,
  withWorkspaceOperation,
} from '../../../services/workspaceOperationService';
import {
  buildAssistantDraftOwnerId,
  readWorkspaceDraft,
  resetWorkspaceDraftMemory,
  WORKSPACE_DRAFT_STORAGE_KEY,
} from '../../../services/workspaceDraftService';

vi.mock('../../../hooks/useTursoAssistantStatus', () => ({
  useTursoAssistantStatus: vi.fn(),
}));

vi.mock('../RAGFileUpload', () => ({
  RAGFileUpload: ({
    ragChunks,
    onRagChunksChange,
    disabled,
  }: {
    ragChunks: RagChunk[];
    onRagChunksChange: (chunks: RagChunk[]) => void;
    disabled?: boolean;
  }) => {
    const React = require('react');
    return React.createElement('div', { 'data-testid': 'rag-file-upload' }, [
      React.createElement('div', { key: 'chunks' }, `Chunks: ${ragChunks.length}`),
      React.createElement(
        'button',
        {
          key: 'add-chunk',
          onClick: () => onRagChunksChange([...ragChunks, TEST_RAG_CHUNKS.pdf]),
          disabled,
          'data-testid': 'add-chunk-button',
        },
        'Add Chunk',
      ),
    ]);
  },
}));

describe('AssistantEditor', () => {
  let testEnvironment: ReturnType<typeof setupAssistantTestEnvironment>;
  let props: {
    assistant: Assistant | null;
    onSave: ReturnType<typeof vi.fn>;
    onCancel: ReturnType<typeof vi.fn>;
    onShare: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    await waitForWorkspaceWrites();
    vi.clearAllMocks();
    resetWorkspaceDraftMemory();
    vi.mocked(window.localStorage.getItem).mockReturnValue(null);
    vi.mocked(window.localStorage.setItem).mockImplementation(() => undefined);
    vi.mocked(window.localStorage.removeItem).mockImplementation(() => undefined);
    testEnvironment = setupAssistantTestEnvironment();
    vi.mocked(useTursoAssistantStatus).mockReturnValue({
      isInTurso: false,
      isChecking: false,
      canShare: false,
      recheckStatus: vi.fn(),
    });

    props = {
      assistant: null,
      onSave: vi.fn(),
      onCancel: vi.fn(),
      onShare: vi.fn(),
    };
  });

  it('renders empty-state defaults for a new assistant', () => {
    render(<AssistantEditor {...props} />);

    expect(screen.getByText('新增助理')).toBeInTheDocument();
    expect(screen.getByLabelText('助理名稱')).toHaveValue('');
    expect(screen.getByLabelText(/公開描述/)).toHaveValue('');
    expect(screen.getByLabelText('系統提示')).toHaveValue('您是一個有用且專業的 AI 助理。');
    expect(screen.getByTestId('rag-file-upload')).toBeInTheDocument();
  });

  it('hydrates form fields when editing an existing assistant', () => {
    render(<AssistantEditor {...props} assistant={TEST_ASSISTANTS.basic} />);

    expect(screen.getByText('編輯助理')).toBeInTheDocument();
    expect(screen.getByLabelText('助理名稱')).toHaveValue(TEST_ASSISTANTS.basic.name);
    expect(screen.getByLabelText(/公開描述/)).toHaveValue(TEST_ASSISTANTS.basic.description);
    expect(screen.getByLabelText('系統提示')).toHaveValue(TEST_ASSISTANTS.basic.systemPrompt);
  });

  it('alerts when saving without a name', () => {
    render(<AssistantEditor {...props} />);

    fireEvent.click(screen.getByRole('button', { name: '保存助理' }));

    expect(testEnvironment.alertSpy).toHaveBeenCalledWith('助理名稱為必填。');
    expect(props.onSave).not.toHaveBeenCalled();
  });

  it('trims fields and saves a new assistant locally', () => {
    render(<AssistantEditor {...props} />);

    fireEvent.change(screen.getByLabelText('助理名稱'), {
      target: { value: '  Test Assistant  ' },
    });
    fireEvent.change(screen.getByLabelText(/公開描述/), {
      target: { value: '  Test Description  ' },
    });
    fireEvent.change(screen.getByLabelText('系統提示'), { target: { value: '  Test Prompt  ' } });
    fireEvent.click(screen.getByTestId('add-chunk-button'));
    fireEvent.click(screen.getByRole('button', { name: '保存助理' }));

    expect(props.onSave).toHaveBeenCalledTimes(1);
    expect(props.onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.stringMatching(/^asst_\d+$/),
        name: 'Test Assistant',
        description: 'Test Description',
        systemPrompt: 'Test Prompt',
        ragChunks: [TEST_RAG_CHUNKS.pdf],
        createdAt: expect.any(Number),
      }),
    );
    expect(testEnvironment.alertSpy).not.toHaveBeenCalled();
  });

  it('preserves id and createdAt when saving an existing assistant', () => {
    render(<AssistantEditor {...props} assistant={TEST_ASSISTANTS.basic} />);

    fireEvent.change(screen.getByLabelText('助理名稱'), { target: { value: 'Updated Name' } });
    fireEvent.click(screen.getByRole('button', { name: '保存助理' }));

    expect(props.onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        id: TEST_ASSISTANTS.basic.id,
        createdAt: TEST_ASSISTANTS.basic.createdAt,
        name: 'Updated Name',
      }),
    );
  });

  it('preserves local assistant metadata when saving an existing assistant', () => {
    const assistantWithMetadata: Assistant = {
      ...TEST_ASSISTANTS.basic,
      isPinned: true,
      category: '教學',
      lastOpenedAt: 123456789,
      isShared: true,
    };
    render(<AssistantEditor {...props} assistant={assistantWithMetadata} />);

    fireEvent.change(screen.getByLabelText('助理名稱'), { target: { value: 'Updated Name' } });
    fireEvent.click(screen.getByRole('button', { name: '保存助理' }));

    expect(props.onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        isPinned: true,
        category: '教學',
        lastOpenedAt: 123456789,
        isShared: true,
      }),
    );
  });

  it('calls onCancel when cancel is clicked', () => {
    render(<AssistantEditor {...props} />);

    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it('keeps the share button disabled when the assistant is not in Turso', () => {
    render(<AssistantEditor {...props} assistant={TEST_ASSISTANTS.basic} />);

    const shareButton = screen.getByRole('button', { name: /分享助理/ });
    expect(shareButton).toBeDisabled();
    fireEvent.click(shareButton);
    expect(props.onShare).not.toHaveBeenCalled();
  });

  it('calls onShare when Turso status allows sharing', () => {
    vi.mocked(useTursoAssistantStatus).mockReturnValue({
      isInTurso: true,
      isChecking: false,
      canShare: true,
      recheckStatus: vi.fn(),
    });

    render(<AssistantEditor {...props} assistant={TEST_ASSISTANTS.basic} />);

    fireEvent.click(screen.getByRole('button', { name: /分享助理/ }));

    expect(props.onShare).toHaveBeenCalledWith(TEST_ASSISTANTS.basic);
  });

  it('updates rag chunks when the upload control changes', () => {
    render(<AssistantEditor {...props} />);

    expect(screen.getByText('Chunks: 0')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('add-chunk-button'));

    expect(screen.getByText('Chunks: 1')).toBeInTheDocument();
  });

  it('hydrates and saves the subagent delegation toggle', () => {
    render(
      <AssistantEditor
        {...props}
        assistant={{
          ...TEST_ASSISTANTS.basic,
          subagentDelegationEnabled: true,
        }}
      />,
    );

    const toggle = screen.getByLabelText(/Subagent delegation/);
    expect(toggle).toBeChecked();

    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('button', { name: '保存助理' }));

    expect(props.onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        subagentDelegationEnabled: false,
      }),
    );
  });

  it('emits tool changes through the draft callback before the outer save', () => {
    const onDraftChange = vi.fn();
    render(
      <AssistantEditor
        {...props}
        assistant={{
          ...TEST_ASSISTANTS.basic,
          mathToolsEnabled: false,
          webSpeechToolsEnabled: false,
        }}
        onDraftChange={onDraftChange}
      />,
    );
    onDraftChange.mockClear();

    fireEvent.click(screen.getByLabelText(/數學計算與幾何繪圖工具/));
    fireEvent.click(screen.getByLabelText(/語音發音與聽說練習工具/));

    expect(onDraftChange).toHaveBeenCalled();
    expect(onDraftChange.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ mathToolsEnabled: true, webSpeechToolsEnabled: true }),
    );
  });

  it('saves starter prompts added via the 新增 button', () => {
    render(<AssistantEditor {...props} />);

    fireEvent.change(screen.getByLabelText('助理名稱'), { target: { value: 'Test' } });
    fireEvent.change(screen.getByPlaceholderText('例如：幫我整理這份教材的重點'), {
      target: { value: '第一個建議提問' },
    });
    fireEvent.click(screen.getByRole('button', { name: '新增' }));
    fireEvent.click(screen.getByRole('button', { name: '保存助理' }));

    expect(props.onSave).toHaveBeenCalledWith(
      expect.objectContaining({ starterPrompts: ['第一個建議提問'] }),
    );
  });

  it('includes a pending starter prompt typed but not yet added when saving', () => {
    render(<AssistantEditor {...props} />);

    fireEvent.change(screen.getByLabelText('助理名稱'), { target: { value: 'Test' } });
    fireEvent.change(screen.getByPlaceholderText('例如：幫我整理這份教材的重點'), {
      target: { value: '還沒按新增的提問' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存助理' }));

    expect(props.onSave).toHaveBeenCalledWith(
      expect.objectContaining({ starterPrompts: ['還沒按新增的提問'] }),
    );
    expect(testEnvironment.alertSpy).not.toHaveBeenCalled();
  });

  it('adds a starter prompt when Enter is pressed in the input', () => {
    render(<AssistantEditor {...props} />);

    const input = screen.getByPlaceholderText('例如：幫我整理這份教材的重點');
    fireEvent.change(input, { target: { value: '按 Enter 新增' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.getByText('按 Enter 新增')).toBeInTheDocument();
    expect(input).toHaveValue('');
  });

  it('hydrates existing starter prompts when editing', () => {
    render(
      <AssistantEditor
        {...props}
        assistant={{ ...TEST_ASSISTANTS.basic, starterPrompts: ['既有提問'] }}
      />,
    );

    expect(screen.getByText('既有提問')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '保存助理' }));
    expect(props.onSave).toHaveBeenCalledWith(
      expect.objectContaining({ starterPrompts: ['既有提問'] }),
    );
  });

  it('restores an assistant draft without replacing the saved identity', () => {
    const ownerId = buildAssistantDraftOwnerId(TEST_ASSISTANTS.basic.id);
    const draft = {
      ...TEST_ASSISTANTS.basic,
      name: '恢復中的助理草稿',
      id: TEST_ASSISTANTS.basic.id,
      ragChunks: [],
      starterPrompts: [],
    };
    vi.mocked(window.localStorage.getItem).mockImplementation(key =>
      key === WORKSPACE_DRAFT_STORAGE_KEY
        ? JSON.stringify({
            schemaVersion: 1,
            entries: [
              {
                schemaVersion: 1,
                kind: 'assistant',
                ownerId,
                value: draft,
                updatedAt: 1,
              },
            ],
          })
        : null,
    );

    render(<AssistantEditor {...props} assistant={TEST_ASSISTANTS.basic} />);

    expect(screen.getByLabelText('助理名稱')).toHaveValue('恢復中的助理草稿');
    fireEvent.click(screen.getByRole('button', { name: '保存助理' }));
    expect(props.onSave).toHaveBeenCalledWith(
      expect.objectContaining({ id: TEST_ASSISTANTS.basic.id, name: '恢復中的助理草稿' }),
    );
  });

  it('does not rehydrate a stale memoized draft after the parent applies a successful save', async () => {
    const ownerId = buildAssistantDraftOwnerId(TEST_ASSISTANTS.basic.id);
    const draft = {
      ...TEST_ASSISTANTS.basic,
      name: '先前的草稿',
      id: TEST_ASSISTANTS.basic.id,
      ragChunks: [],
      starterPrompts: [],
    };
    vi.mocked(window.localStorage.getItem).mockImplementation(key =>
      key === WORKSPACE_DRAFT_STORAGE_KEY
        ? JSON.stringify({
            schemaVersion: 1,
            entries: [
              {
                schemaVersion: 1,
                kind: 'assistant',
                ownerId,
                value: draft,
                updatedAt: 1,
              },
            ],
          })
        : null,
    );

    const ParentHarness = () => {
      const [currentAssistant, setCurrentAssistant] = useState(TEST_ASSISTANTS.basic);
      return (
        <AssistantEditor
          {...props}
          assistant={currentAssistant}
          onSave={async savedAssistant => {
            setCurrentAssistant(savedAssistant);
          }}
        />
      );
    };

    render(<ParentHarness />);
    expect(screen.getByLabelText('助理名稱')).toHaveValue('先前的草稿');

    fireEvent.change(screen.getByLabelText('助理名稱'), { target: { value: '已保存的新名稱' } });
    fireEvent.click(screen.getByRole('button', { name: '保存助理' }));

    await waitFor(() => {
      expect(screen.getByLabelText('助理名稱')).toHaveValue('已保存的新名稱');
    });
    expect(screen.getByLabelText('助理名稱')).not.toHaveValue('先前的草稿');
  });

  it('debounces assistant draft persistence and flushes the structured entry', async () => {
    vi.useFakeTimers();
    try {
      render(<AssistantEditor {...props} assistant={TEST_ASSISTANTS.basic} />);
      vi.mocked(window.localStorage.setItem).mockClear();

      fireEvent.change(screen.getByLabelText('助理名稱'), { target: { value: '延遲保存草稿' } });
      await act(async () => vi.advanceTimersByTimeAsync(499));
      expect(window.localStorage.setItem).not.toHaveBeenCalled();

      await act(async () => vi.advanceTimersByTimeAsync(1));
      expect(window.localStorage.setItem).toHaveBeenCalledWith(
        WORKSPACE_DRAFT_STORAGE_KEY,
        expect.stringContaining('延遲保存草稿'),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('flushes the mounted form before the 500ms debounce during a workspace export', async () => {
    const storage = new Map<string, string>();
    vi.mocked(window.localStorage.getItem).mockImplementation(key => storage.get(key) ?? null);
    vi.mocked(window.localStorage.setItem).mockImplementation((key, value) =>
      storage.set(key, value),
    );
    render(<AssistantEditor {...props} assistant={TEST_ASSISTANTS.basic} />);
    fireEvent.change(screen.getByLabelText('助理名稱'), {
      target: { value: '捕捉保存前的草稿' },
    });

    await withWorkspaceOperation('export', async () => {
      expect(
        readWorkspaceDraft<Assistant>(
          'assistant',
          buildAssistantDraftOwnerId(TEST_ASSISTANTS.basic.id),
        ).value,
      ).toEqual(expect.objectContaining({ name: '捕捉保存前的草稿' }));
    });
  });

  it('shows delegation guidance about token cost and shared mode', () => {
    render(<AssistantEditor {...props} />);

    expect(screen.getByText(/增加 token 成本/)).toBeInTheDocument();
    expect(screen.getByText(/shared mode 會在執行時強制停用/)).toBeInTheDocument();
  });

  it('keeps basic fields visible while collapsing advanced settings for a new assistant', () => {
    render(<AssistantEditor {...props} />);

    expect(screen.getByLabelText('助理名稱')).toBeVisible();
    expect(screen.getByLabelText(/公開描述/)).toBeVisible();
    expect(screen.getByTestId('advanced-settings')).not.toHaveAttribute('open');
  });

  it('asks before leaving a dirty draft and preserves it when the user stays', async () => {
    render(<AssistantEditor {...props} />);

    fireEvent.change(screen.getByLabelText('助理名稱'), { target: { value: '未保存助理' } });
    testEnvironment.confirmSpy.mockReturnValue(false);
    fireEvent.click(screen.getByTestId('cancel-button'));

    await waitFor(() =>
      expect(testEnvironment.confirmSpy).toHaveBeenCalledWith('尚有未保存的變更，確定要離開嗎？'),
    );
    expect(props.onCancel).not.toHaveBeenCalled();
  });

  it('clears the dirty state when cancel successfully leaves a dirty draft', async () => {
    const onDirtyChange = vi.fn();
    render(<AssistantEditor {...props} onDirtyChange={onDirtyChange} />);
    onDirtyChange.mockClear();

    fireEvent.change(screen.getByLabelText('助理名稱'), { target: { value: '未保存助理' } });
    await waitFor(() => expect(onDirtyChange).toHaveBeenCalledWith(true));

    testEnvironment.confirmSpy.mockReturnValue(true);
    fireEvent.click(screen.getByTestId('cancel-button'));

    await waitFor(() => expect(props.onCancel).toHaveBeenCalledTimes(1));
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it('shows a retryable save error without dropping the draft', async () => {
    props.onSave.mockRejectedValueOnce(new Error('IndexedDB unavailable'));
    render(<AssistantEditor {...props} />);

    fireEvent.change(screen.getByLabelText('助理名稱'), { target: { value: '保留草稿' } });
    fireEvent.click(screen.getByTestId('save-button'));

    await waitFor(() =>
      expect(screen.getByTestId('assistant-save-status')).toHaveTextContent(
        /IndexedDB unavailable/,
      ),
    );
    expect(screen.getByLabelText('助理名稱')).toHaveValue('保留草稿');
  });

  it('keeps the saved status when the parent replaces the saved assistant object', async () => {
    const parentReplacement = vi.fn();
    let resolveSave: (() => void) | undefined;
    const ParentHarness = () => {
      const [currentAssistant, setCurrentAssistant] = useState<Assistant>({
        ...TEST_ASSISTANTS.basic,
        isPinned: true,
        category: '教學',
      });

      return (
        <AssistantEditor
          {...props}
          assistant={currentAssistant}
          onSave={savedAssistant =>
            new Promise<void>(resolve => {
              resolveSave = () => {
                resolve();
                window.setTimeout(() => {
                  setCurrentAssistant({ ...savedAssistant });
                  parentReplacement();
                }, 0);
              };
            })
          }
        />
      );
    };

    render(<ParentHarness />);

    fireEvent.change(screen.getByLabelText('助理名稱'), {
      target: { value: '更新後的助理' },
    });
    fireEvent.click(screen.getByTestId('save-button'));

    expect(await screen.findByTestId('assistant-save-status')).toHaveTextContent('正在保存助理…');
    resolveSave?.();
    await waitFor(() => expect(parentReplacement).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(screen.getByTestId('assistant-save-status')).toHaveTextContent('已保存於這台裝置。');
    });
    expect(screen.getByLabelText('助理名稱')).toHaveValue('更新後的助理');
  });

  it('resets the saved status when an external update changes the same assistant', async () => {
    const { rerender } = render(<AssistantEditor {...props} assistant={TEST_ASSISTANTS.basic} />);

    fireEvent.change(screen.getByLabelText('助理名稱'), { target: { value: '已保存名稱' } });
    fireEvent.click(screen.getByTestId('save-button'));
    await waitFor(() => {
      expect(screen.getByTestId('assistant-save-status')).toHaveTextContent('已保存於這台裝置。');
    });

    rerender(
      <AssistantEditor {...props} assistant={{ ...TEST_ASSISTANTS.basic, name: '外部更新名稱' }} />,
    );

    await waitFor(() => {
      expect(screen.queryByText('已保存於這台裝置。')).not.toBeInTheDocument();
    });
    expect(screen.getByLabelText('助理名稱')).toHaveValue('外部更新名稱');
  });

  it('resets the saved status when switching to a different assistant', async () => {
    const { rerender } = render(<AssistantEditor {...props} assistant={TEST_ASSISTANTS.basic} />);

    fireEvent.change(screen.getByLabelText('助理名稱'), { target: { value: '已保存名稱' } });
    fireEvent.click(screen.getByTestId('save-button'));
    await waitFor(() => {
      expect(screen.getByTestId('assistant-save-status')).toHaveTextContent('已保存於這台裝置。');
    });

    rerender(
      <AssistantEditor
        {...props}
        assistant={{ ...TEST_ASSISTANTS.basic, id: 'different-assistant', name: '另一個助理' }}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByText('已保存於這台裝置。')).not.toBeInTheDocument();
    });
    expect(screen.getByLabelText('助理名稱')).toHaveValue('另一個助理');
  });

  it('requires confirmation before a template replaces an edited draft', () => {
    render(<AssistantEditor {...props} />);

    fireEvent.change(screen.getByLabelText('助理名稱'), { target: { value: '我的草稿' } });
    fireEvent.click(screen.getByRole('button', { name: '英文教學樣板' }));
    fireEvent.click(screen.getByRole('button', { name: /套用此樣板/ }));

    expect(screen.getByTestId('template-overwrite-confirmation')).toBeInTheDocument();
    expect(screen.getByText(/目前的編輯內容會被樣板覆蓋/)).toBeInTheDocument();
    expect(screen.getByLabelText('助理名稱')).toHaveValue('我的草稿');
  });
});
