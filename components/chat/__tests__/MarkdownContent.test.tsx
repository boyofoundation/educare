import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import MarkdownContent from '../MarkdownContent';

vi.mock('remark-gfm', () => ({ default: vi.fn() }));
vi.mock('rehype-highlight', () => ({ default: vi.fn() }));
vi.mock('rehype-highlight-code-lines', () => ({ default: vi.fn() }));
vi.mock('highlight.js/styles/github-dark.css', () => ({}));

describe('MarkdownContent citations', () => {
  it('rewrites valid [n] markers into in-message anchors', () => {
    render(
      <MarkdownContent
        content={'依據員工手冊，[1] 可以申請特休。'}
        messageKey='msg-0'
        citations={[
          {
            marker: 1,
            chunkId: '員工手冊.pdf#0',
            fileName: '員工手冊.pdf',
            chunkIndex: 0,
            excerpt: '特休假規定',
          },
        ]}
      />,
    );

    const anchor = screen.getByRole('link', { name: '1' });
    expect(anchor).toHaveAttribute('href', '#cite-msg-0-1');
    expect(anchor).toHaveTextContent('1');
  });

  it('does not rewrite [n] markers inside inline code', () => {
    render(
      <MarkdownContent
        content={'請保留 `const ref = "[1]"` 原樣。'}
        messageKey='msg-1'
        citations={[
          {
            marker: 1,
            chunkId: '員工手冊.pdf#0',
            fileName: '員工手冊.pdf',
            chunkIndex: 0,
            excerpt: '特休假規定',
          },
        ]}
      />,
    );

    expect(screen.queryByRole('link', { name: '1' })).not.toBeInTheDocument();
    expect(screen.getByText('const ref = "[1]"')).toBeInTheDocument();
  });
});
