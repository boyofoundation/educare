import { executeSpeakText, type SpeechUtteranceDoc } from './speechToolService';

export const INLINE_PRONUNCIATION_TAG = 'pronounce';
export const INLINE_PRONUNCIATION_HREF_PREFIX = 'pronounce:';

const DEFAULT_LANGUAGE = 'en-US';
const PRONUNCIATION_TAG_PATTERN = /<pronounce(?:\s+([^<>]*?))?\s*>([\s\S]*?)<\/pronounce\s*>/gi;
const ATTRIBUTE_PATTERN = /^([a-z][a-z0-9_-]*)\s*=\s*(["'])(.*?)\2/i;
const ALLOWED_ATTRIBUTES = new Set(['lang', 'language', 'rate', 'pitch']);

type PronunciationAttributes = Record<string, string>;

const parseAttributes = (source: string): PronunciationAttributes | null => {
  const attributes: PronunciationAttributes = {};
  let remaining = source.trim();

  while (remaining) {
    const match = ATTRIBUTE_PATTERN.exec(remaining);
    if (!match) {
      return null;
    }

    const [, name, , value] = match;
    const normalizedName = name.toLowerCase();
    if (!ALLOWED_ATTRIBUTES.has(normalizedName) || attributes[normalizedName] !== undefined) {
      return null;
    }

    attributes[normalizedName] = value;
    remaining = remaining.slice(match[0].length);
    if (remaining.length > 0 && !/^\s+/.test(remaining)) {
      return null;
    }
    remaining = remaining.trimStart();
  }

  return attributes;
};

const escapeMarkdownLabel = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\\`*_[\]{}()#+.!|~-]/g, '\\$&');

const escapeLiteralMarkup = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const parseAttributeNumber = (value: string | undefined): number | undefined | null => {
  if (value === undefined) {
    return undefined;
  }

  if (value.trim() === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const buildUtterance = (
  attributesSource: string | undefined,
  rawText: string,
): SpeechUtteranceDoc | null => {
  const attributes = parseAttributes(attributesSource ?? '');
  const text = rawText.trim();
  if (!attributes || text.length === 0 || /<\/?pronounce\b/i.test(text)) {
    return null;
  }

  if (
    attributes.lang !== undefined &&
    attributes.language !== undefined &&
    attributes.lang.trim() !== attributes.language.trim()
  ) {
    return null;
  }

  const rate = parseAttributeNumber(attributes.rate);
  const pitch = parseAttributeNumber(attributes.pitch);
  if (rate === null || pitch === null) {
    return null;
  }

  const result = executeSpeakText({
    text,
    language: attributes.language ?? attributes.lang ?? DEFAULT_LANGUAGE,
    rate,
    pitch,
  });

  return result.ok ? result.utterance : null;
};

export const buildInlinePronunciationHref = (utterance: SpeechUtteranceDoc): string =>
  `${INLINE_PRONUNCIATION_HREF_PREFIX}${encodeURIComponent(
    JSON.stringify({
      text: utterance.text,
      language: utterance.language,
      rate: utterance.rate,
      pitch: utterance.pitch,
    }),
  )}`;

export const parseInlinePronunciationHref = (
  href: string | undefined,
): SpeechUtteranceDoc | null => {
  if (!href?.startsWith(INLINE_PRONUNCIATION_HREF_PREFIX)) {
    return null;
  }

  try {
    const payload = JSON.parse(
      decodeURIComponent(href.slice(INLINE_PRONUNCIATION_HREF_PREFIX.length)),
    ) as Record<string, unknown>;
    const result = executeSpeakText(payload);
    return result.ok ? result.utterance : null;
  } catch {
    return null;
  }
};

const isProtectedMarkdownSegment = (segment: string): boolean =>
  segment.startsWith('```') ||
  (segment.startsWith('`') && segment.endsWith('`')) ||
  segment.startsWith('$');

export const annotateInlinePronunciationMarkup = (content: string): string => {
  const protectedContentPattern =
    /(```[\s\S]*?```|`[^`\n]+`|\$\$[\s\S]*?\$\$|\$(?:\\.|[^$\\\n])+\$)/g;

  return content
    .split(protectedContentPattern)
    .map(segment => {
      if (isProtectedMarkdownSegment(segment)) {
        return segment;
      }

      return segment.replace(PRONUNCIATION_TAG_PATTERN, (fullMatch, attributes, rawText) => {
        const utterance = buildUtterance(attributes, rawText);
        if (!utterance) {
          return escapeLiteralMarkup(fullMatch);
        }

        return `[${escapeMarkdownLabel(utterance.text)}](${buildInlinePronunciationHref(utterance)})`;
      });
    })
    .join('');
};
