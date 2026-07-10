import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssistantEditor } from '../AssistantEditor';
import { TEST_ASSISTANTS, TEST_RAG_CHUNKS, setupAssistantTestEnvironment } from './test-utils';
import type { Assistant, RagChunk } from '../../../types';
import { useTursoAssistantStatus } from '../../../hooks/useTursoAssistantStatus';

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

  beforeEach(() => {
    vi.clearAllMocks();
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

  it('shows delegation guidance about token cost and shared mode', () => {
    render(<AssistantEditor {...props} />);

    expect(screen.getByText(/增加 token 成本/)).toBeInTheDocument();
    expect(screen.getByText(/shared mode 會在執行時強制停用/)).toBeInTheDocument();
  });
});
