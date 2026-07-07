/// <reference types="vitest/globals" />
import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PreviewFrame } from '../PreviewFrame';
import type { HtmlProjectPreviewArtifact } from '../../../types';

const readyArtifact = (
  overrides: Partial<HtmlProjectPreviewArtifact> = {},
): HtmlProjectPreviewArtifact => ({
  projectId: 'p-1',
  previewVersion: 3,
  entryFile: '/index.html',
  previewReady: true,
  previewUrlType: 'blob',
  html: '<!doctype html><html></html>',
  url: 'blob:preview-1',
  warnings: [],
  error: null,
  diagnostics: { category: 'none', outcome: 'ready', repairable: false, summary: 'ok' },
  generatedAt: 1700000000000,
  ...overrides,
});

describe('PreviewFrame sandbox (AC6)', () => {
  it('renders the iframe with allow-scripts allow-forms allow-modals and NO allow-same-origin', () => {
    const { container } = render(<PreviewFrame preview={readyArtifact()} />);
    const iframe = container.querySelector('iframe');
    expect(iframe).not.toBeNull();
    const sandbox = iframe?.getAttribute('sandbox') ?? '';
    expect(sandbox).toContain('allow-scripts');
    expect(sandbox).toContain('allow-forms');
    expect(sandbox).toContain('allow-modals');
    // Critical security invariant: opaque origin MUST be preserved (V FS plan principle ①).
    expect(sandbox).not.toContain('allow-same-origin');
  });

  it('shows the preview-error state when previewReady is false', () => {
    const { container, getByText } = render(
      <PreviewFrame
        preview={readyArtifact({ previewReady: false, url: undefined, error: 'boom' })}
      />,
    );
    expect(container.querySelector('iframe')).toBeNull();
    expect(getByText('Preview error')).toBeTruthy();
  });

  it('shows the empty state when no preview is provided', () => {
    const { container } = render(<PreviewFrame preview={null} />);
    expect(container.querySelector('iframe')).toBeNull();
  });
});

describe('PreviewFrame viewport toggle', () => {
  it('defaults to full-width desktop and switches the frame container width for tablet/mobile', () => {
    const { getByRole, getByTestId } = render(<PreviewFrame preview={readyArtifact()} />);
    const viewportContainer = getByTestId('preview-frame-viewport');

    expect(viewportContainer.style.width).toBe('100%');

    fireEvent.click(getByRole('button', { name: 'Tablet' }));
    expect(viewportContainer.style.width).toBe('768px');

    fireEvent.click(getByRole('button', { name: 'Mobile' }));
    expect(viewportContainer.style.width).toBe('390px');

    fireEvent.click(getByRole('button', { name: 'Desktop' }));
    expect(viewportContainer.style.width).toBe('100%');
  });
});

describe('PreviewFrame loading overlay', () => {
  it('shows a loading overlay until the iframe fires onLoad', () => {
    const { container, queryByText } = render(<PreviewFrame preview={readyArtifact()} />);
    expect(queryByText('載入預覽中…')).not.toBeNull();

    const iframe = container.querySelector('iframe');
    expect(iframe).not.toBeNull();
    fireEvent.load(iframe as HTMLIFrameElement);

    expect(queryByText('載入預覽中…')).toBeNull();
  });
});

describe('PreviewFrame warnings', () => {
  it('shows a single warning without an expand toggle', () => {
    const { getByText, queryByRole } = render(
      <PreviewFrame preview={readyArtifact({ warnings: ['warning-1'] })} />,
    );
    expect(getByText('warning-1')).toBeTruthy();
    expect(queryByRole('button', { name: '還有 1 則警告' })).toBeNull();
  });

  it('collapses multiple warnings behind a toggle showing the hidden count', () => {
    const { getByRole, getByText, queryByText } = render(
      <PreviewFrame
        preview={readyArtifact({ warnings: ['warning-1', 'warning-2', 'warning-3'] })}
      />,
    );

    expect(getByText('warning-1')).toBeTruthy();
    expect(queryByText('warning-2')).toBeNull();

    fireEvent.click(getByRole('button', { name: '還有 2 則警告' }));

    expect(getByText('warning-2')).toBeTruthy();
    expect(getByText('warning-3')).toBeTruthy();

    fireEvent.click(getByRole('button', { name: '收合警告' }));
    expect(queryByText('warning-2')).toBeNull();
  });
});
