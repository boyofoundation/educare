import { describe, expect, it } from 'vitest';
import { executeSpeakText } from './speechToolService';

describe('speechToolService', () => {
  it('normalizes a valid pronunciation request', () => {
    const result = executeSpeakText({
      text: '  How are you?  ',
      language: 'en-US',
      title: 'Greeting practice',
      rate: 0.8,
      pitch: 1.1,
      note: 'Stress ARE lightly.',
    });

    expect(result).toEqual({
      ok: true,
      utterance: {
        text: 'How are you?',
        language: 'en-US',
        title: 'Greeting practice',
        rate: 0.8,
        pitch: 1.1,
        note: 'Stress ARE lightly.',
      },
      summary: 'Prepared speech playback for en-US: How are you?',
    });
  });

  it('rejects invalid language tags and out-of-range rates', () => {
    expect(executeSpeakText({ text: 'hello', language: '../en' })).toMatchObject({
      ok: false,
      code: 'speak-text-invalid-input',
    });

    expect(executeSpeakText({ text: 'hello', language: 'en-US', rate: 3 })).toMatchObject({
      ok: false,
      error: 'rate must be between 0.5 and 1.5.',
    });
  });
});
