export const CLARIFY_TOOL_NAME = 'askUser';

export const CLARIFY_TOOL_DESCRIPTION =
  'Ask the user one clarifying question with pre-built options rendered as a clickable picker in the chat UI (the user may also type a custom answer). Use it when the request is ambiguous or has materially different branches and a quick choice would unblock you. Do not use it for open-ended survey questions, and do not re-ask the same question after an answer or a skip.';

export const CLARIFY_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    question: {
      type: 'string',
      description:
        'The single question to ask. Keep it self-contained, in the user language, at most a few sentences.',
    },
    options: {
      type: 'array',
      minItems: 2,
      maxItems: 6,
      description: 'Two to six distinct answer options for the user to pick from.',
      items: {
        type: 'object',
        properties: {
          label: {
            type: 'string',
            description: 'Short option label shown on the button.',
          },
          description: {
            type: 'string',
            description: 'Optional one-line explanation of what this choice implies.',
          },
        },
        required: ['label'],
        additionalProperties: false,
      },
    },
    allowCustomAnswer: {
      type: 'boolean',
      description:
        'Whether the user may type a custom answer instead of picking an option. Defaults to true.',
    },
    header: {
      type: 'string',
      description: 'Optional short chip label for the question card (e.g. "版面配置").',
    },
  },
  required: ['question', 'options'],
  additionalProperties: false,
} as const;

export const CLARIFY_SYSTEM_PROMPT = `
When the askUser tool is available, prefer it over typing a plain-text question whenever you can offer concrete options: the chat renders a picker so the user can answer with one click. Ask at most one askUser question per run, only when the answer materially changes what you do next, and always continue from the returned answer (a "dismissed" answer means the user skipped — proceed with your best judgment instead of asking again).
`.trim();

export interface ClarifyOption {
  label: string;
  description?: string;
}

/** 使用者透過 UI 選單提交的回答。 */
export type ClarifyUserAnswer =
  | { kind: 'option'; label: string }
  | { kind: 'custom'; text: string };

/** 正規化後可直接交給 UI 的提問內容。 */
export interface ClarifyRequest {
  question: string;
  options: ClarifyOption[];
  allowCustomAnswer: boolean;
  header?: string;
}

export type NormalizeClarifyRequestResult =
  | { ok: true; request: ClarifyRequest }
  | {
      ok: false;
      recoverable: true;
      code: string;
      message: string;
      guidance: string;
    };

/** 使用者略過了問題 (模型會收到「已略過,請自行判斷」的結果)。 */
export type ClarifyAnswer = ClarifyUserAnswer | { kind: 'dismissed' };

const MAX_QUESTION_LENGTH = 500;
const MAX_OPTION_LABEL_LENGTH = 120;
const MAX_OPTION_DESCRIPTION_LENGTH = 240;
const MAX_HEADER_LENGTH = 40;
const MAX_CUSTOM_ANSWER_LENGTH = 1000;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;

const clampText = (value: unknown, maxLength: number): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, maxLength);
};

const invalidArgs = (
  code: string,
  message: string,
  guidance: string,
): Extract<NormalizeClarifyRequestResult, { ok: false }> => ({
  ok: false,
  recoverable: true,
  code,
  message,
  guidance,
});

/**
 * 把模型產生的 askUser 參數正規化為 UI 可用的 ClarifyRequest。
 * 僅做長度/數量上限截斷;結構錯誤回傳 recoverable 錯誤讓模型重試。
 */
export const normalizeClarifyRequest = (args: unknown): NormalizeClarifyRequestResult => {
  const source = (args ?? {}) as Record<string, unknown>;

  const question = clampText(source.question, MAX_QUESTION_LENGTH);
  if (!question) {
    return invalidArgs(
      'clarify-question-missing',
      'askUser requires a non-empty question string.',
      'Retry askUser with a clear question and 2-6 options.',
    );
  }

  const header = clampText(source.header, MAX_HEADER_LENGTH);

  if (!Array.isArray(source.options)) {
    return invalidArgs(
      'clarify-options-missing',
      'askUser requires an options array with 2-6 entries.',
      'Retry askUser with options: [{ label, description? }, ...].',
    );
  }

  const options: ClarifyOption[] = [];
  const seenLabels = new Set<string>();
  for (const entry of source.options) {
    if (options.length >= MAX_OPTIONS) {
      break;
    }
    const raw = (entry ?? {}) as Record<string, unknown>;
    const label = clampText(raw.label, MAX_OPTION_LABEL_LENGTH);
    if (!label) {
      return invalidArgs(
        'clarify-option-label-missing',
        'Every askUser option requires a non-empty label string.',
        'Retry askUser where each option has a short label; description is optional.',
      );
    }
    const normalizedLabel = label.toLowerCase();
    if (seenLabels.has(normalizedLabel)) {
      continue;
    }
    seenLabels.add(normalizedLabel);
    const description = clampText(raw.description, MAX_OPTION_DESCRIPTION_LENGTH);
    options.push(description ? { label, description } : { label });
  }

  if (options.length < MIN_OPTIONS) {
    return invalidArgs(
      'clarify-options-too-few',
      `askUser requires at least ${MIN_OPTIONS} distinct options (after deduplication).`,
      'Retry askUser with 2-6 distinct, meaningfully different options.',
    );
  }

  return {
    ok: true,
    request: {
      question,
      options,
      allowCustomAnswer: source.allowCustomAnswer !== false,
      header: header ?? undefined,
    },
  };
};

/** 把使用者自訂輸入收斂為 ClarifyUserAnswer 的自訂回答。 */
export const buildCustomClarifyAnswer = (text: string): ClarifyUserAnswer => ({
  kind: 'custom',
  text: text.trim().slice(0, MAX_CUSTOM_ANSWER_LENGTH),
});
