import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpeechUtteranceRecord } from '../../../types';
import SpeechUtteranceCard from '../SpeechUtteranceCard';

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

const utterance: SpeechUtteranceRecord = {
  id: 'speech-1',
  title: 'Morning practice',
  doc: {
    text: 'Good morning, everyone!',
    language: 'en-GB',
    title: 'Morning practice',
    rate: 0.75,
    pitch: 1.2,
    note: 'Read clearly.',
  },
};

const restoreWindowProperty = (name: PropertyKey, descriptor?: PropertyDescriptor) => {
  if (descriptor) {
    Object.defineProperty(window, name, descriptor);
  } else {
    Reflect.deleteProperty(window, name);
  }
};

describe('SpeechUtteranceCard', () => {
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

  it('passes text, language, rate, and pitch to SpeechSynthesisUtterance', () => {
    // Arrange
    render(<SpeechUtteranceCard utterance={utterance} />);

    // Act
    fireEvent.click(screen.getByRole('button', { name: '播放發音' }));

    // Assert
    const speech = speechSynthesis.speak.mock.calls[0]?.[0] as MockSpeechSynthesisUtterance;
    expect(speechSynthesis.cancel).toHaveBeenCalledTimes(1);
    expect(speechSynthesis.speak).toHaveBeenCalledTimes(1);
    expect(speech).toMatchObject({
      text: 'Good morning, everyone!',
      lang: 'en-GB',
      rate: 0.75,
      pitch: 1.2,
    });
  });

  it('uses one accessible toggle for start and stop state', () => {
    // Arrange
    render(<SpeechUtteranceCard utterance={utterance} />);
    fireEvent.click(screen.getByRole('button', { name: '播放發音' }));

    // Act and Assert
    const stopButtons = screen.getAllByRole('button', { name: '停止播放' });
    expect(stopButtons).toHaveLength(1);
    expect(stopButtons[0]).toHaveTextContent('播放中');

    fireEvent.click(stopButtons[0]);

    expect(speechSynthesis.cancel).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: '播放發音' })).toHaveTextContent('播放');
    expect(screen.queryByRole('button', { name: '停止播放' })).not.toBeInTheDocument();
  });

  it('shows a disabled fallback when Web Speech is unavailable', () => {
    // Arrange
    Reflect.deleteProperty(window, 'speechSynthesis');
    Reflect.deleteProperty(window, 'SpeechSynthesisUtterance');

    // Act
    render(<SpeechUtteranceCard utterance={utterance} />);

    // Assert
    const button = screen.getByRole('button', { name: '播放發音' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', '此瀏覽器不支援語音播放');
    expect(speechSynthesis.speak).not.toHaveBeenCalled();
  });
});
