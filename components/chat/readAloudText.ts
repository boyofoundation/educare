const CJK_TEXT_PATTERN = /[぀-ヿ㐀-鿿가-힯豈-﫿]/;
const TRAILING_URI_PUNCTUATION_PATTERN = /[.,;:!?，。；：！？]+$/;

const getTrailingUriPunctuation = (uri: string): string =>
  uri.match(TRAILING_URI_PUNCTUATION_PATTERN)?.[0] ?? '';

const normalizeReferenceLabel = (label: string): string =>
  label.trim().replace(/\s+/g, ' ').toLowerCase();

const getReferenceLabels = (content: string): Set<string> =>
  new Set(
    Array.from(content.matchAll(/^\s*\[([^\]]+)\]:\s+\S+.*$/gm), match =>
      normalizeReferenceLabel(match[1]),
    ),
  );

export const getReadAloudText = (content: string): string => {
  const referenceLabels = getReferenceLabels(content);

  return content
    .replace(/<pronounce\b[^>]*>([\s\S]*?)<\/pronounce\s*>/gi, '$1')
    .replace(/<\/?pronounce\b[^>]*>/gi, '')
    .replace(/^\s*(?:```|~~~)[^\n]*$/gm, '')
    .replace(/^\s*\[[^\]]+\]:\s+\S+.*$/gm, '')
    .replace(/!\[([^\]]*)\]\((?:\\.|[^)])*\)/g, '$1')
    .replace(/!\[([^\]]*)\]\[[^\]]*\]/g, '$1')
    .replace(/\[\s*\d+(?:\s*[-–,]\s*\d+)*\s*\]\((?:\\.|[^)])*\)/g, '')
    .replace(/\[\^[^\]]+\]/g, '')
    .replace(/\[\s*\d+(?:\s*[-–,]\s*\d+)*\s*\](?:\[[^\]]*\])?/g, '')
    .replace(/【\s*\d+(?:\s*[-–,]\s*\d+)*\s*】/g, '')
    .replace(/\[([^\]]+)\]\((?:\\.|[^)])*\)/g, '$1')
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
    .replace(/(^|[^!\\])\[([^\]\n]+)\]/g, (match: string, prefix: string, label: string) =>
      referenceLabels.has(normalizeReferenceLabel(label)) ? `${prefix}${label}` : match,
    )
    .replace(/<(?:\/\/|[a-z][a-z\d+.-]*:)[^>]+>/gi, '')
    .replace(
      /\b(?:[a-z][a-z\d+.-]*:\/\/|(?:mailto|tel|sms|data):)[^\s<>"')\]]+/gi,
      getTrailingUriPunctuation,
    )
    .replace(
      /(^|[^:/\w])(\/\/[^\s<>"')\]]+)/gi,
      (_match: string, prefix: string, uri: string) => `${prefix}${getTrailingUriPunctuation(uri)}`,
    )
    .replace(/\bwww\.[^\s<>"')\]]+/gi, getTrailingUriPunctuation)
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*(?:[-+*]|\d+[.)])\s+/gm, '')
    .replace(/^\s*(?:[-*_]\s*){3,}$/gm, '')
    .replace(/^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*$/gm, '')
    .replace(/[`*_~]/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\\([\\`*{}[\]()#+\-.!_>~|])/g, '$1')
    .replace(/\|/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, ' ')
    .trim();
};

export const getReadAloudLanguage = (text: string): 'zh-TW' | 'en-US' =>
  CJK_TEXT_PATTERN.test(text) ? 'zh-TW' : 'en-US';
