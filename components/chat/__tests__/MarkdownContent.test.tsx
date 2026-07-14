import { fireEvent, render, screen } from '@testing-library/react';
import { act } from 'react';
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

describe('MarkdownContent rich content rendering', () => {
  it('renders a complete pronounce tag as an inline playback icon', () => {
    render(
      <MarkdownContent
        content={'Try <pronounce language="en-US">Good morning!</pronounce> today.'}
      />,
    );

    expect(screen.getByText('Good morning!')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '播放發音：Good morning!' })).toBeInTheDocument();
  });

  it('does not turn pronunciation-like text in code or math into playback controls', () => {
    render(
      <MarkdownContent content={'`<pronounce>code</pronounce>` $<pronounce>math</pronounce>$'} />,
    );

    expect(screen.queryByRole('button', { name: /播放發音/ })).not.toBeInTheDocument();
  });

  it('does not create a playback control for an invalid pronunciation tag', () => {
    render(<MarkdownContent content={'<pronounce language="../en">unsafe</pronounce>'} />);

    expect(screen.queryByRole('button', { name: /播放發音/ })).not.toBeInTheDocument();
    expect(screen.getByText('<pronounce language="../en">unsafe</pronounce>')).toBeInTheDocument();
  });

  it('renders inline and display LaTeX without exposing their delimiters', () => {
    // Arrange
    const { container } = render(
      <MarkdownContent content={'質能方程式是 $E = mc^2$。\n\n$$\\frac{a}{b}$$'} />,
    );

    // Assert
    expect(container.querySelectorAll('.katex')).toHaveLength(2);
    expect(screen.getByText('質能方程式是', { exact: false })).toBeInTheDocument();
    expect(container).not.toHaveTextContent('$E = mc^2$');
    expect(container).not.toHaveTextContent('$$\\frac{a}{b}$$');
  });

  it('renders mhchem formulae through KaTeX', () => {
    // Arrange
    const { container } = render(<MarkdownContent content={'水是 $\\ce{H2O}$。'} />);

    // Assert
    expect(container.querySelector('.katex')).toBeInTheDocument();
    expect(container.querySelector('annotation[encoding="application/x-tex"]')?.textContent).toBe(
      '\\ce{H2O}',
    );
  });

  it.each([
    ['c++', 'int main() { return 0; }'],
    ['objective-c', '@interface Greeter : NSObject'],
    ['f#', 'let answer = 42'],
  ])('preserves the %s language label and source for a fenced code block', (language, code) => {
    // Arrange
    render(<MarkdownContent content={`\`\`\`${language}\n${code}\n\`\`\``} />);

    // Assert
    expect(screen.getByText(language, { exact: true })).toBeInTheDocument();
    expect(screen.getByText(code, { exact: true })).toBeInTheDocument();
  });

  it('uses a readable fallback label and preserves source for an unknown code language', () => {
    // Arrange
    render(<MarkdownContent content={'```not-a-real-language\nopaque syntax\n```'} />);

    // Assert
    expect(screen.getByText('not-a-real-language', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('opaque syntax', { exact: true })).toBeInTheDocument();
  });

  it('does not parse math delimiters inside a fenced code block', () => {
    // Arrange
    const source = 'const formula = "$E = mc^2$";';
    const { container } = render(
      <MarkdownContent content={`\`\`\`typescript\n${source}\n\`\`\``} />,
    );

    // Assert
    expect(screen.getByText(source, { exact: true })).toBeInTheDocument();
    expect(container.querySelector('.katex')).not.toBeInTheDocument();
  });

  it('keeps citation-like markers in math and code literal while linking prose citations', () => {
    // Arrange
    const { container } = render(
      <MarkdownContent
        content={'公式 $x_{[1]}$；程式碼 `const ref = "[1]"`；請參考說明。[1]'}
        messageKey='msg-math'
        citations={[
          {
            marker: 1,
            chunkId: 'formula.md#0',
            fileName: 'formula.md',
            chunkIndex: 0,
            excerpt: '公式說明',
          },
        ]}
      />,
    );

    // Assert
    expect(screen.getByRole('link', { name: '1' })).toHaveAttribute('href', '#cite-msg-math-1');
    expect(screen.getByText('const ref = "[1]"')).toBeInTheDocument();
    expect(container.querySelector('.katex')).toBeInTheDocument();
    expect(container.querySelector('.katex')).not.toHaveTextContent('cite-msg-math-1');
  });

  it('copies the original fenced code text', async () => {
    // Arrange
    const source = 'const π = 3.14;';
    render(<MarkdownContent content={`\`\`\`typescript\n${source}\n\`\`\``} />);

    // Act
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '複製' }));
    });

    // Assert
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(`${source}\n`);
  });
});
