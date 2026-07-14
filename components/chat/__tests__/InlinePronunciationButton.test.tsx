import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import InlinePronunciationButton from '../InlinePronunciationButton';

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

const utterance = {
  text: 'Good morning!',
  language: 'en-US',
  title: 'Greeting',
  rate: 0.8,
  pitch: 1.1,
};

describe('InlinePronunciationButton', () => {
  beforeEach(() => {
    speechSynthesis.cancel.mockClear();
    speechSynthesis.speak.mockClear();
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
    Reflect.deleteProperty(window, 'speechSynthesis');
    Reflect.deleteProperty(window, 'SpeechSynthesisUtterance');
  });

  it('plays the marked text with its language, rate, and pitch', () => {
    render(
      <InlinePronunciationButton utterance={utterance}>Good morning!</InlinePronunciationButton>,
    );

    fireEvent.click(screen.getByRole('button', { name: '播放發音：Good morning!' }));

    const speech = speechSynthesis.speak.mock.calls[0]?.[0] as MockSpeechSynthesisUtterance;
    expect(speechSynthesis.cancel).toHaveBeenCalledTimes(1);
    expect(speechSynthesis.speak).toHaveBeenCalledTimes(1);
    expect(speech).toMatchObject({
      text: 'Good morning!',
      lang: 'en-US',
      rate: 0.8,
      pitch: 1.1,
    });
    expect(screen.getByRole('button', { name: '停止播放：Good morning!' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('stops playback and resets after the utterance ends', () => {
    render(
      <InlinePronunciationButton utterance={utterance}>Good morning!</InlinePronunciationButton>,
    );

    fireEvent.click(screen.getByRole('button', { name: '播放發音：Good morning!' }));
    fireEvent.click(screen.getByRole('button', { name: '停止播放：Good morning!' }));

    expect(speechSynthesis.cancel).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: '播放發音：Good morning!' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('disables the icon when Web Speech is unavailable', () => {
    Reflect.deleteProperty(window, 'speechSynthesis');
    Reflect.deleteProperty(window, 'SpeechSynthesisUtterance');

    render(
      <InlinePronunciationButton utterance={utterance}>Good morning!</InlinePronunciationButton>,
    );

    expect(screen.getByRole('button', { name: '播放發音：Good morning!' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '播放發音：Good morning!' })).toHaveAttribute(
      'title',
      '此瀏覽器不支援語音播放',
    );
  });
});
