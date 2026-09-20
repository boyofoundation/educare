import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Assistant } from '../../../types';
import { AssistantPackageImportDialog } from '../AssistantPackageImportDialog';

const assistant: Assistant = {
  id: 'untrusted',
  name: '<img src=x onerror=alert(1)>',
  description: 'Untrusted test package',
  systemPrompt: '<script>UNTRUSTED_INSTRUCTION</script>',
  createdAt: 1,
  ragChunks: [{ fileName: '<svg onload=alert(1)>.txt', content: 'material' }],
};

describe('AssistantPackageImportDialog', () => {
  it('shows untrusted metadata and author text without executing it or accepting automatically', () => {
    const onDecision = vi.fn();
    const { baseElement } = render(
      <AssistantPackageImportDialog assistant={assistant} onDecision={onDecision} />,
    );
    expect(screen.getByRole('dialog', { name: '確認助理包內容' })).toBeVisible();
    expect(screen.getByText(assistant.name)).toBeInTheDocument();
    expect(screen.getByText(assistant.systemPrompt)).toBeInTheDocument();
    expect(baseElement.querySelector('script')).toBeNull();
    expect(baseElement.querySelector('img')).toBeNull();
    expect(onDecision).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '確認並匯入助理' }));
    expect(onDecision).toHaveBeenCalledWith(true);
  });

  it('cancels without accepting the package', () => {
    const onDecision = vi.fn();
    render(<AssistantPackageImportDialog assistant={assistant} onDecision={onDecision} />);
    fireEvent.click(screen.getByRole('button', { name: '取消匯入' }));
    expect(onDecision).toHaveBeenCalledOnce();
    expect(onDecision).toHaveBeenCalledWith(false);
  });
});
