import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MessageBubble from '../MessageBubble';
import { createMockChatMessage } from './test-utils';

vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => (
    <div data-testid='markdown-content'>{children}</div>
  ),
  defaultUrlTransform: (url: string) => url,
}));
vi.mock('remark-gfm', () => ({ default: vi.fn() }));
vi.mock('rehype-highlight', () => ({ default: vi.fn() }));
vi.mock('highlight.js/styles/github-dark.css', () => ({}));

class MockSpeechSynthesisUtterance {
  lang = '';
  rate = 1;
  pitch = 1;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public text: string) {}
}

const speechSynthesis = {
  cancel: vi.fn(),
  speak: vi.fn(),
};

const originalSpeechSynthesis = Object.getOwnPropertyDescriptor(window, 'speechSynthesis');
const originalUtterance = Object.getOwnPropertyDescriptor(window, 'SpeechSynthesisUtterance');

const installSpeechSynthesis = () => {
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    value: speechSynthesis,
  });
  Object.defineProperty(window, 'SpeechSynthesisUtterance', {
    configurable: true,
    value: MockSpeechSynthesisUtterance,
  });
};

const restoreWindowProperty = (name: PropertyKey, descriptor?: PropertyDescriptor) => {
  if (descriptor) {
    Object.defineProperty(window, name, descriptor);
  } else {
    Reflect.deleteProperty(window, name);
  }
};

describe('MessageBubble read-aloud control', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installSpeechSynthesis();
  });

  afterEach(() => {
    restoreWindowProperty('speechSynthesis', originalSpeechSynthesis);
    restoreWindowProperty('SpeechSynthesisUtterance', originalUtterance);
  });

  it('renders for non-empty assistant replies only', () => {
    const { rerender } = render(
      <MessageBubble
        message={createMockChatMessage({ role: 'model', content: '助理回答' })}
        index={0}
      />,
    );

    expect(screen.getByRole('button', { name: '朗讀回應' })).toBeEnabled();

    rerender(
      <MessageBubble
        message={createMockChatMessage({ role: 'user', content: '學生問題' })}
        index={0}
      />,
    );
    expect(screen.queryByRole('button', { name: /朗讀/ })).not.toBeInTheDocument();

    rerender(
      <MessageBubble
        message={createMockChatMessage({
          role: 'model',
          content: '隱藏的續跑訊息',
          synthetic: true,
        })}
        index={0}
      />,
    );
    expect(screen.queryByRole('button', { name: /朗讀/ })).not.toBeInTheDocument();

    rerender(
      <MessageBubble
        message={createMockChatMessage({
          role: 'model',
          content: '',
          images: [{ url: 'data:image/png;base64,ZmFrZQ==', mimeType: 'image/png' }],
        })}
        index={0}
      />,
    );
    expect(screen.queryByRole('button', { name: /朗讀/ })).not.toBeInTheDocument();
  });

  it('speaks readable plain text without Markdown, citation links, or pronounce markup', () => {
    const message = createMockChatMessage({
      role: 'model',
      content: [
        '## 課程重點',
        '',
        '**早安**，請看[更多資料](https://school.example/lesson)。',
        '',
        '<pronounce language="zh-TW">一起慢慢念</pronounce>',
        '',
        '[1](https://school.example/citation)',
        '',
        '```ts',
        "const greeting = '早安';",
        '```',
      ].join('\n'),
    });
    render(<MessageBubble message={message} index={0} />);

    fireEvent.click(screen.getByRole('button', { name: '朗讀回應' }));

    const speech = speechSynthesis.speak.mock.calls[0]?.[0] as MockSpeechSynthesisUtterance;
    expect(speech.text).toContain('課程重點');
    expect(speech.text).toContain('早安');
    expect(speech.text).toContain('更多資料');
    expect(speech.text).toContain('一起慢慢念');
    expect(speech.text).not.toContain('##');
    expect(speech.text).not.toContain('**');
    expect(speech.text).not.toContain('```');
    expect(speech.text).not.toContain('https://');
    expect(speech.text).not.toContain('<pronounce');
    expect(speech.text).not.toContain('</pronounce>');
    expect(speech.text).not.toContain('[1]');
    expect(speech.text).not.toContain('1');
  });

  it('defaults CJK replies to zh-TW at a learner-friendly rate', () => {
    render(
      <MessageBubble
        message={createMockChatMessage({ role: 'model', content: '我們一起慢慢讀這一句。' })}
        index={0}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '朗讀回應' }));

    const speech = speechSynthesis.speak.mock.calls[0]?.[0] as MockSpeechSynthesisUtterance;
    expect(speech.lang).toBe('zh-TW');
    expect(speech.rate).toBeGreaterThanOrEqual(0.5);
    expect(speech.rate).toBeLessThan(1);
  });

  it('defaults non-CJK replies to en-US and exposes start and stop states', () => {
    render(
      <MessageBubble
        message={createMockChatMessage({ role: 'model', content: 'Read this sentence slowly.' })}
        index={0}
      />,
    );

    const startButton = screen.getByRole('button', { name: '朗讀回應' });
    expect(startButton).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(startButton);

    const speech = speechSynthesis.speak.mock.calls[0]?.[0] as MockSpeechSynthesisUtterance;
    expect(speech.lang).toBe('en-US');
    expect(speech.rate).toBeLessThan(1);
    expect(speechSynthesis.cancel).toHaveBeenCalledTimes(1);
    expect(speechSynthesis.speak).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /停止朗讀/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    fireEvent.click(screen.getByRole('button', { name: /停止朗讀/ }));

    expect(speechSynthesis.cancel).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: '朗讀回應' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('disables playback with a clear explanation when Web Speech is unavailable', () => {
    Reflect.deleteProperty(window, 'speechSynthesis');
    Reflect.deleteProperty(window, 'SpeechSynthesisUtterance');

    render(
      <MessageBubble
        message={createMockChatMessage({ role: 'model', content: '請朗讀這段回應。' })}
        index={0}
      />,
    );

    const button = screen.getByRole('button', { name: '朗讀回應' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', '此瀏覽器不支援語音播放');
    expect(speechSynthesis.speak).not.toHaveBeenCalled();
  });
});
