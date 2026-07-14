import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpeechUtteranceDoc } from '../../../services/speechToolService';
import { useSpeechPlayback } from '../useSpeechPlayback';

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

const utterances: Record<'first' | 'second', SpeechUtteranceDoc> = {
  first: {
    text: 'First sentence.',
    language: 'en-US',
    title: 'First',
    rate: 0.8,
    pitch: 1,
  },
  second: {
    text: '第二句。',
    language: 'zh-TW',
    title: 'Second',
    rate: 0.7,
    pitch: 1.1,
  },
};

const restoreWindowProperty = (name: PropertyKey, descriptor?: PropertyDescriptor) => {
  if (descriptor) {
    Object.defineProperty(window, name, descriptor);
  } else {
    Reflect.deleteProperty(window, name);
  }
};

const SpeechControl = ({ id }: { id: 'first' | 'second' }) => {
  const { speaking, speak, stop } = useSpeechPlayback(utterances[id]);

  return (
    <button type='button' onClick={speaking ? stop : speak}>
      {speaking ? `Stop ${id}` : `Speak ${id}`}
    </button>
  );
};

const SpeechPair = ({
  showFirst = true,
  showSecond = true,
}: {
  showFirst?: boolean;
  showSecond?: boolean;
}) => (
  <>
    {showFirst && <SpeechControl key='first' id='first' />}
    {showSecond && <SpeechControl key='second' id='second' />}
  </>
);

describe('useSpeechPlayback coordination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: speechSynthesis,
    });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      configurable: true,
      value: MockSpeechSynthesisUtterance,
    });
  });

  afterEach(() => {
    cleanup();
    restoreWindowProperty('speechSynthesis', originalSpeechSynthesis);
    restoreWindowProperty('SpeechSynthesisUtterance', originalUtterance);
  });

  it.each(['onend', 'onerror'] as const)('resets speaking when %s fires manually', eventName => {
    // Arrange
    render(<SpeechControl id='first' />);
    fireEvent.click(screen.getByRole('button', { name: 'Speak first' }));
    const speech = speechSynthesis.speak.mock.calls[0]?.[0] as MockSpeechSynthesisUtterance;
    expect(screen.getByRole('button', { name: 'Stop first' })).toBeInTheDocument();

    // Act
    act(() => speech[eventName]?.());

    // Assert
    expect(screen.getByRole('button', { name: 'Speak first' })).toBeInTheDocument();
  });

  it('resets the first control when a second playback starts', () => {
    // Arrange
    render(<SpeechPair />);
    fireEvent.click(screen.getByRole('button', { name: 'Speak first' }));

    // Act
    fireEvent.click(screen.getByRole('button', { name: 'Speak second' }));

    // Assert
    expect(speechSynthesis.cancel).toHaveBeenCalledTimes(2);
    expect(speechSynthesis.speak).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'Speak first' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop second' })).toBeInTheDocument();
  });

  it.each(['onend', 'onerror'] as const)(
    "keeps the second playback speaking when the first playback's stale %s fires",
    eventName => {
      // Arrange
      render(<SpeechPair />);
      fireEvent.click(screen.getByRole('button', { name: 'Speak first' }));
      const firstSpeech = speechSynthesis.speak.mock.calls[0]?.[0] as MockSpeechSynthesisUtterance;
      fireEvent.click(screen.getByRole('button', { name: 'Speak second' }));
      const secondSpeech = speechSynthesis.speak.mock.calls[1]?.[0] as MockSpeechSynthesisUtterance;

      // Act
      act(() => firstSpeech[eventName]?.());

      // Assert
      expect(screen.getByRole('button', { name: 'Speak first' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Stop second' })).toBeInTheDocument();

      // Act
      act(() => secondSpeech.onend?.());

      // Assert
      expect(screen.getByRole('button', { name: 'Speak second' })).toBeInTheDocument();
    },
  );

  it('does not cancel active playback when an inactive hook unmounts', () => {
    // Arrange
    const { rerender } = render(<SpeechPair />);
    fireEvent.click(screen.getByRole('button', { name: 'Speak first' }));
    fireEvent.click(screen.getByRole('button', { name: 'Speak second' }));
    expect(speechSynthesis.cancel).toHaveBeenCalledTimes(2);

    // Act
    rerender(<SpeechPair showFirst={false} />);

    // Assert
    expect(speechSynthesis.cancel).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'Stop second' })).toBeInTheDocument();
  });

  it('cancels playback when the active owner unmounts', () => {
    // Arrange
    const { rerender } = render(<SpeechPair />);
    fireEvent.click(screen.getByRole('button', { name: 'Speak second' }));
    expect(speechSynthesis.cancel).toHaveBeenCalledTimes(1);

    // Act
    rerender(<SpeechPair showSecond={false} />);

    // Assert
    expect(speechSynthesis.cancel).toHaveBeenCalledTimes(2);
  });
});
