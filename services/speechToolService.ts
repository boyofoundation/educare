export const SPEAK_TEXT_TOOL_NAME = 'speak_text';

export const SPEAK_TEXT_TOOL_DESCRIPTION =
  'Create a browser Web Speech pronunciation card for language learning. Use it when the learner needs to hear a word, phrase, sentence, or short pronunciation contrast.';

export const SPEAK_TEXT_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    text: {
      type: 'string',
      description: 'The exact text to pronounce. Keep it short enough for repeated practice.',
    },
    language: {
      type: 'string',
      description:
        'BCP 47 language tag for speech synthesis, such as en-US, en-GB, ja-JP, ko-KR, zh-TW, fr-FR, or es-ES.',
    },
    title: {
      type: 'string',
      description: 'Short label displayed above the pronunciation card.',
    },
    rate: {
      type: 'number',
      description: 'Speech rate from 0.5 to 1.5. Use slower rates for learners.',
      minimum: 0.5,
      maximum: 1.5,
    },
    pitch: {
      type: 'number',
      description: 'Speech pitch from 0.5 to 2.0.',
      minimum: 0.5,
      maximum: 2,
    },
    note: {
      type: 'string',
      description: 'Optional short pronunciation hint, such as stress, mouth shape, or contrast.',
    },
  },
  required: ['text', 'language'],
  additionalProperties: false,
} as const;

export const WEB_SPEECH_TOOLS_SYSTEM_PROMPT = `
When Web Speech tools are available, use speak_text for pronunciation, listening, shadowing, and language-learning examples that benefit from audio playback. Keep each utterance short and repeatable. For English learning, prefer language tags such as en-US or en-GB and include a brief note for stress, vowel, or rhythm when helpful. Do not claim the browser has spoken until the user presses the playback control.
`.trim();

export interface SpeechUtteranceDoc {
  text: string;
  language: string;
  title: string;
  rate: number;
  pitch: number;
  note?: string;
}

export interface SpeakTextArgs {
  text?: unknown;
  language?: unknown;
  title?: unknown;
  rate?: unknown;
  pitch?: unknown;
  note?: unknown;
}

export type SpeakTextResult =
  | { ok: true; utterance: SpeechUtteranceDoc; summary: string }
  | {
      ok: false;
      recoverable: true;
      code: 'speak-text-invalid-input';
      error: string;
      summary: string;
    };

const MAX_SPEECH_TEXT_LENGTH = 500;
const MAX_TITLE_LENGTH = 80;
const MAX_NOTE_LENGTH = 160;
const LANGUAGE_TAG_PATTERN = /^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8}){0,3}$/;

const invalidInput = (error: string): Extract<SpeakTextResult, { ok: false }> => ({
  ok: false,
  recoverable: true,
  code: 'speak-text-invalid-input',
  error,
  summary: error,
});

const normalizeOptionalNumber = (
  value: unknown,
  defaultValue: number,
  min: number,
  max: number,
  fieldName: string,
): number | Extract<SpeakTextResult, { ok: false }> => {
  if (value === undefined) {
    return defaultValue;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return invalidInput(`${fieldName} must be a finite number.`);
  }
  if (value < min || value > max) {
    return invalidInput(`${fieldName} must be between ${min} and ${max}.`);
  }
  return value;
};

const isFailure = (
  value: number | Extract<SpeakTextResult, { ok: false }>,
): value is Extract<SpeakTextResult, { ok: false }> => typeof value === 'object';

export const executeSpeakText = (args: SpeakTextArgs): SpeakTextResult => {
  if (typeof args.text !== 'string' || args.text.trim().length === 0) {
    return invalidInput('text must be a non-empty string.');
  }

  const text = args.text.trim();
  if (text.length > MAX_SPEECH_TEXT_LENGTH) {
    return invalidInput(`text must be ${MAX_SPEECH_TEXT_LENGTH} characters or fewer.`);
  }

  if (typeof args.language !== 'string' || !LANGUAGE_TAG_PATTERN.test(args.language.trim())) {
    return invalidInput('language must be a valid BCP 47-style language tag, such as en-US.');
  }
  const language = args.language.trim();

  const rate = normalizeOptionalNumber(args.rate, 0.9, 0.5, 1.5, 'rate');
  if (isFailure(rate)) {
    return rate;
  }

  const pitch = normalizeOptionalNumber(args.pitch, 1, 0.5, 2, 'pitch');
  if (isFailure(pitch)) {
    return pitch;
  }

  const title =
    typeof args.title === 'string' && args.title.trim().length > 0
      ? args.title.trim().slice(0, MAX_TITLE_LENGTH)
      : `Pronunciation: ${text.slice(0, 40)}`;

  const note =
    typeof args.note === 'string' && args.note.trim().length > 0
      ? args.note.trim().slice(0, MAX_NOTE_LENGTH)
      : undefined;

  return {
    ok: true,
    utterance: {
      text,
      language,
      title,
      rate,
      pitch,
      note,
    },
    summary: `Prepared speech playback for ${language}: ${text.slice(0, 80)}`,
  };
};
