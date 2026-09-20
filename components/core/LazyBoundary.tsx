import React from 'react';
import { ErrorBoundary } from './ErrorBoundary';

/** Keep a failed route chunk inside its pane, leaving navigation usable. */
export const LazyBoundary: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ErrorBoundary
    fallback={
      <div role='alert' className='ui-panel m-4 rounded-xl p-4'>
        <p className='ui-text font-semibold'>介面載入失敗</p>
        <p className='ui-muted mt-2 text-sm'>
          請確認網路後重新載入頁面。已儲存的本機資料不受影響，未儲存的修改可能遺失。
        </p>
        <button
          type='button'
          className='ui-control mt-3 min-h-11 rounded-lg px-4 py-2'
          onClick={() => window.location.reload()}
        >
          重新載入頁面
        </button>
      </div>
    }
  >
    <React.Suspense
      fallback={
        <div
          role='status'
          className='ui-muted flex min-h-16 items-center justify-center p-4 text-sm'
        >
          載入介面中…
        </div>
      }
    >
      {children}
    </React.Suspense>
  </ErrorBoundary>
);
