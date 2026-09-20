import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClarifyRecord } from '../../../types';
import ClarifyQuestionCard from '../ClarifyQuestionCard';

const REQUEST = {
  question: '要使用哪種主題？',
  options: [
    { label: '亮色', description: '適合白天閱讀' },
    { label: '暗色', description: undefined },
  ],
  allowCustomAnswer: true,
  header: '主題',
};

afterEach(() => {
  cleanup();
});

describe('ClarifyQuestionCard (interactive)', () => {
  it('renders the question with option buttons and submits the picked option', () => {
    const onAnswer = vi.fn();
    render(
      <ClarifyQuestionCard request={REQUEST} onAnswer={onAnswer} onDismiss={() => undefined} />,
    );

    expect(screen.getByTestId('clarify-question-card')).toHaveAttribute('data-pending', 'true');
    expect(screen.getByText('要使用哪種主題？')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /亮色/ })).toBeInTheDocument();
    expect(screen.getByText('適合白天閱讀')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /暗色/ }));
    expect(onAnswer).toHaveBeenCalledWith({ kind: 'option', label: '暗色' });
  });

  it('collects a custom answer through the custom input flow', () => {
    const onAnswer = vi.fn();
    render(
      <ClarifyQuestionCard request={REQUEST} onAnswer={onAnswer} onDismiss={() => undefined} />,
    );

    fireEvent.click(screen.getByTestId('clarify-custom-toggle'));
    const input = screen.getByTestId('clarify-custom-input');
    fireEvent.change(input, { target: { value: '  跟隨系統  ' } });
    fireEvent.click(screen.getByTestId('clarify-custom-submit'));

    expect(onAnswer).toHaveBeenCalledWith({ kind: 'custom', text: '跟隨系統' });
  });

  it('blocks custom submission while the input is blank', () => {
    const onAnswer = vi.fn();
    render(
      <ClarifyQuestionCard request={REQUEST} onAnswer={onAnswer} onDismiss={() => undefined} />,
    );

    fireEvent.click(screen.getByTestId('clarify-custom-toggle'));
    expect(screen.getByTestId('clarify-custom-submit')).toBeDisabled();
  });

  it('hides the custom answer entry when allowCustomAnswer is false', () => {
    render(
      <ClarifyQuestionCard
        request={{ ...REQUEST, allowCustomAnswer: false }}
        onAnswer={() => undefined}
        onDismiss={() => undefined}
      />,
    );

    expect(screen.queryByTestId('clarify-custom-toggle')).not.toBeInTheDocument();
  });

  it('signals dismissal when the user skips the question', () => {
    const onDismiss = vi.fn();
    render(
      <ClarifyQuestionCard request={REQUEST} onAnswer={() => undefined} onDismiss={onDismiss} />,
    );

    fireEvent.click(screen.getByTestId('clarify-dismiss'));
    expect(onDismiss).toHaveBeenCalledWith();
  });
});

describe('ClarifyQuestionCard (record)', () => {
  it('highlights the chosen option in the static record', () => {
    const record: ClarifyRecord = {
      id: 'clarify-0-0',
      request: REQUEST,
      answer: { kind: 'option', label: '亮色' },
    };
    render(<ClarifyQuestionCard record={record} />);

    const card = screen.getByTestId('clarify-question-card');
    expect(card).not.toHaveAttribute('data-pending');
    const chosenButton = screen.getByText('亮色').closest('div');
    expect(chosenButton?.className).toContain('border-cyan-400/70');
    expect(screen.queryByTestId('clarify-custom-toggle')).not.toBeInTheDocument();
  });

  it('shows the custom answer text', () => {
    const record: ClarifyRecord = {
      id: 'clarify-0-0',
      request: REQUEST,
      answer: { kind: 'custom', text: '跟隨系統設定' },
    };
    render(<ClarifyQuestionCard record={record} />);

    expect(screen.getByTestId('clarify-custom-answer')).toHaveTextContent('跟隨系統設定');
  });

  it('shows a dismissed note without interactive controls', () => {
    const record: ClarifyRecord = {
      id: 'clarify-0-0',
      request: REQUEST,
      answer: { kind: 'dismissed' },
    };
    render(<ClarifyQuestionCard record={record} />);

    expect(screen.getByText('使用者略過了此問題')).toBeInTheDocument();
    expect(screen.queryByTestId('clarify-dismiss')).not.toBeInTheDocument();
  });
});
