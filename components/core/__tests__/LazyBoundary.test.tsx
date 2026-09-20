import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LazyBoundary } from '../LazyBoundary';

describe('LazyBoundary', () => {
  it('shows loading until the route chunk resolves', async () => {
    let resolve!: (value: { default: React.FC }) => void;
    const Route = React.lazy(
      () =>
        new Promise<{ default: React.FC }>(done => {
          resolve = done;
        }),
    );
    render(
      <LazyBoundary>
        <Route />
      </LazyBoundary>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('載入介面中');
    await act(async () => {
      resolve({ default: () => <p>Route ready</p> });
    });
    expect(await screen.findByText('Route ready')).toBeVisible();
  });

  it('contains a failed chunk and offers an honest full-page reload', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const Route = React.lazy(async () => {
        throw new Error('Chunk unavailable');
      });
      render(
        <>
          <nav>Navigation remains available</nav>
          <LazyBoundary>
            <Route />
          </LazyBoundary>
        </>,
      );
      expect(await screen.findByRole('alert')).toHaveTextContent('介面載入失敗');
      expect(screen.getByRole('navigation')).toHaveTextContent('Navigation remains available');
      expect(screen.getByRole('button', { name: '重新載入頁面' })).toBeVisible();
      expect(screen.getByRole('alert')).toHaveTextContent('未儲存的修改可能遺失');
      expect(screen.queryByRole('button', { name: /^重試$/ })).not.toBeInTheDocument();
    } finally {
      errors.mockRestore();
    }
  });
});
