import type { ToolDefinition } from './llmAdapter';
import {
  decideOpenJevQuestions,
  OPEN_JEV_MODEL,
  type OpenJevStructuredAnswer,
  type OpenJevStructuredDecisionInput,
  type OpenJevStructuredQuestion,
} from './openJevDecisionService';

export const OPEN_JEV_DECISION_TOOL_NAME = 'openJevDecide';
export const OPEN_JEV_DECISION_TOOL_DESCRIPTION =
  'Use the browser-local kev-0.6b model for compact structured judgments. Batch related choice, score, and yes/no questions into one call; it returns typed answers and calibrated confidence without generating prose.';
export const OPEN_JEV_MAX_TOOL_CALLS_PER_RUN = 2;

export const OPEN_JEV_DECISION_SYSTEM_PROMPT = `
The optional openJevDecide tool is a browser-local structured judgment tool. Use it when a decision can be expressed as one to six compact questions rather than a free-form answer: choice selects one option, score rates an ordered scale, and noul checks a yes/no statement. Batch related questions in one call to reduce provider-side deliberation and tool rounds. Write the state and question instructions in concise English because the local model is trained primarily on English. The result is advisory only: use answers with reliable=true, treat lower-confidence answers as uncertain, and keep using your own judgment or ask the user when reliability is low. openJevDecide cannot inspect files, retrieve facts, or mutate project state; do not call it for generation, long explanations, or irreversible authorization.
`.trim();

export const OPEN_JEV_DECISION_TOOL_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    state: {
      type: 'string',
      minLength: 1,
      description:
        'Compact English context for the judgment. Include only facts needed for the questions; do not paste the full conversation or large files.',
    },
    questions: {
      type: 'array',
      minItems: 1,
      maxItems: 6,
      description:
        'Batch one to six related typed questions. Each item uses type choice, score, or noul. choice/score require options; noul does not.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: {
            type: 'string',
            description:
              'Stable short identifier returned in the answers map, such as route or urgency.',
          },
          type: {
            type: 'string',
            enum: ['choice', 'score', 'noul'],
          },
          instructions: {
            type: 'string',
            description: 'One concise English question or yes/no statement.',
          },
          options: {
            type: 'array',
            minItems: 2,
            maxItems: 12,
            items: { type: 'string' },
            description:
              'Required for choice and score; choice options are unordered, score options are ordered low to high.',
          },
          descriptions: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description: 'Optional short English descriptions keyed by choice option.',
          },
        },
        required: ['id', 'type', 'instructions'],
      },
    },
    confidenceThreshold: {
      type: 'number',
      minimum: 0.5,
      maximum: 0.99,
      description:
        'Optional reliability cutoff between 0.5 and 0.99. Defaults to 0.65; answers below it are returned but marked reliable=false.',
    },
  },
  required: ['state', 'questions'],
};

export const OPEN_JEV_DECISION_TOOL_DEFINITION: ToolDefinition = {
  name: OPEN_JEV_DECISION_TOOL_NAME,
  description: OPEN_JEV_DECISION_TOOL_DESCRIPTION,
  parameters: OPEN_JEV_DECISION_TOOL_SCHEMA,
};

const DEFAULT_CONFIDENCE_THRESHOLD = 0.65;
const MAX_STATE_CHARACTERS = 24_000;
const MAX_QUESTION_CHARACTERS = 16_000;
const MAX_IDENTIFIER_LENGTH = 64;
const MAX_INSTRUCTION_LENGTH = 600;
const MAX_OPTION_LENGTH = 160;
const MAX_DESCRIPTION_LENGTH = 240;

interface OpenJevDecisionToolArgs {
  state: string;
  questions: OpenJevStructuredQuestion[];
  confidenceThreshold: number;
}

interface OpenJevToolRecoverableError {
  ok: false;
  recoverable: true;
  code: string;
  message: string;
  guidance: string;
  details?: Record<string, unknown>;
}

export type OpenJevDecisionToolAnswer = OpenJevStructuredAnswer & {
  reliable: boolean;
};

export interface OpenJevDecisionToolSuccess {
  ok: true;
  model: typeof OPEN_JEV_MODEL;
  runtime: import('open-jev').OpenJevRuntime;
  stateTokenCount: number;
  confidenceThreshold: number;
  answers: Record<string, OpenJevDecisionToolAnswer>;
  unreliableQuestionIds: string[];
  summary: string;
}

export type OpenJevDecisionToolResult = OpenJevDecisionToolSuccess | OpenJevToolRecoverableError;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const readString = (
  value: unknown,
  field: string,
  maxLength: number,
): { value: string } | { error: OpenJevToolRecoverableError } => {
  if (typeof value !== 'string' || !value.trim()) {
    return {
      error: {
        ok: false,
        recoverable: true,
        code: 'open-jev-invalid-arguments',
        message: `${field} must be a non-empty string.`,
        guidance: 'Retry openJevDecide with concise string values.',
      },
    };
  }

  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    return {
      error: {
        ok: false,
        recoverable: true,
        code: 'open-jev-arguments-too-large',
        message: `${field} is too long (${trimmed.length} characters; maximum ${maxLength}).`,
        guidance:
          'Shorten the state or question text and retry with only decision-relevant context.',
      },
    };
  }

  return { value: trimmed };
};

const normalizeQuestion = (
  value: unknown,
  index: number,
): { question: OpenJevStructuredQuestion } | { error: OpenJevToolRecoverableError } => {
  if (!isRecord(value)) {
    return {
      error: {
        ok: false,
        recoverable: true,
        code: 'open-jev-invalid-arguments',
        message: `questions[${index}] must be an object.`,
        guidance: 'Provide each question with id, type, instructions, and options where required.',
      },
    };
  }

  const idResult = readString(value.id, `questions[${index}].id`, MAX_IDENTIFIER_LENGTH);
  if ('error' in idResult) {
    return idResult;
  }
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(idResult.value)) {
    return {
      error: {
        ok: false,
        recoverable: true,
        code: 'open-jev-invalid-question-id',
        message: `questions[${index}].id must start with a letter and contain only letters, numbers, _ or -.`,
        guidance: 'Use short ASCII identifiers such as route, urgency, or needs_edit.',
      },
    };
  }

  const instructionsResult = readString(
    value.instructions,
    `questions[${index}].instructions`,
    MAX_INSTRUCTION_LENGTH,
  );
  if ('error' in instructionsResult) {
    return instructionsResult;
  }

  if (value.type !== 'choice' && value.type !== 'score' && value.type !== 'noul') {
    return {
      error: {
        ok: false,
        recoverable: true,
        code: 'open-jev-invalid-question-type',
        message: `questions[${index}].type must be choice, score, or noul.`,
        guidance: 'Retry with one of the three supported structured question types.',
      },
    };
  }

  if (value.type === 'noul') {
    return {
      question: {
        id: idResult.value,
        type: 'noul',
        instructions: instructionsResult.value,
      },
    };
  }

  if (!Array.isArray(value.options) || value.options.length < 2 || value.options.length > 12) {
    return {
      error: {
        ok: false,
        recoverable: true,
        code: 'open-jev-invalid-options',
        message: `questions[${index}].options must contain 2 to 12 strings for ${value.type}.`,
        guidance: 'Keep the option set small and mutually exclusive, then retry.',
      },
    };
  }

  if (value.type === 'score' && value.descriptions !== undefined) {
    return {
      error: {
        ok: false,
        recoverable: true,
        code: 'open-jev-invalid-descriptions',
        message: `questions[${index}].descriptions is supported only for choice questions.`,
        guidance: 'Remove descriptions from score questions or use short ordered option labels.',
      },
    };
  }

  const options: string[] = [];
  for (const [optionIndex, option] of value.options.entries()) {
    const optionResult = readString(
      option,
      `questions[${index}].options[${optionIndex}]`,
      MAX_OPTION_LENGTH,
    );
    if ('error' in optionResult) {
      return optionResult;
    }
    if (options.includes(optionResult.value)) {
      return {
        error: {
          ok: false,
          recoverable: true,
          code: 'open-jev-duplicate-option',
          message: `questions[${index}] contains a duplicate option.`,
          guidance:
            'Use unique option strings so the local probability distribution is meaningful.',
        },
      };
    }
    options.push(optionResult.value);
  }

  let descriptions: Partial<Record<string, string>> | undefined;
  if (value.descriptions !== undefined) {
    if (!isRecord(value.descriptions)) {
      return {
        error: {
          ok: false,
          recoverable: true,
          code: 'open-jev-invalid-descriptions',
          message: `questions[${index}].descriptions must be an object.`,
          guidance: 'Map option strings to short descriptions or omit descriptions.',
        },
      };
    }

    descriptions = {};
    for (const option of options) {
      if (value.descriptions[option] === undefined) {
        continue;
      }
      const descriptionResult = readString(
        value.descriptions[option],
        `questions[${index}].descriptions.${option}`,
        MAX_DESCRIPTION_LENGTH,
      );
      if ('error' in descriptionResult) {
        return descriptionResult;
      }
      descriptions[option] = descriptionResult.value;
    }
  }

  return {
    question: {
      id: idResult.value,
      type: value.type,
      instructions: instructionsResult.value,
      options,
      ...(descriptions && Object.keys(descriptions).length > 0 ? { descriptions } : {}),
    } as OpenJevStructuredQuestion,
  };
};

const normalizeArguments = (
  args: Record<string, unknown>,
): { input: OpenJevDecisionToolArgs } | { error: OpenJevToolRecoverableError } => {
  const stateResult = readString(args.state, 'state', MAX_STATE_CHARACTERS);
  if ('error' in stateResult) {
    return stateResult;
  }

  if (!Array.isArray(args.questions) || args.questions.length < 1 || args.questions.length > 6) {
    return {
      error: {
        ok: false,
        recoverable: true,
        code: 'open-jev-invalid-questions',
        message: 'questions must contain between 1 and 6 question objects.',
        guidance: 'Batch only the related decisions needed for the next action.',
      },
    };
  }

  const questions: OpenJevStructuredQuestion[] = [];
  const ids = new Set<string>();
  let questionCharacters = 0;
  for (const [index, rawQuestion] of args.questions.entries()) {
    const normalized = normalizeQuestion(rawQuestion, index);
    if ('error' in normalized) {
      return normalized;
    }
    if (ids.has(normalized.question.id)) {
      return {
        error: {
          ok: false,
          recoverable: true,
          code: 'open-jev-duplicate-question-id',
          message: `questions contains duplicate id "${normalized.question.id}".`,
          guidance: 'Give every question a unique short id and retry.',
        },
      };
    }
    ids.add(normalized.question.id);
    questionCharacters += JSON.stringify(normalized.question).length;
    questions.push(normalized.question);
  }

  if (questionCharacters > MAX_QUESTION_CHARACTERS) {
    return {
      error: {
        ok: false,
        recoverable: true,
        code: 'open-jev-arguments-too-large',
        message: `question definitions are too large (${questionCharacters} characters; maximum ${MAX_QUESTION_CHARACTERS}).`,
        guidance: 'Use shorter instructions, descriptions, and option labels.',
      },
    };
  }

  const threshold = args.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
  if (
    typeof threshold !== 'number' ||
    !Number.isFinite(threshold) ||
    threshold < 0.5 ||
    threshold > 0.99
  ) {
    return {
      error: {
        ok: false,
        recoverable: true,
        code: 'open-jev-invalid-confidence-threshold',
        message: 'confidenceThreshold must be a number between 0.5 and 0.99.',
        guidance: 'Omit confidenceThreshold to use 0.65 or provide a value in the supported range.',
      },
    };
  }

  return {
    input: {
      state: stateResult.value,
      questions,
      confidenceThreshold: threshold,
    },
  };
};

export const executeOpenJevDecisionTool = async (
  args: Record<string, unknown>,
): Promise<OpenJevDecisionToolResult> => {
  const normalized = normalizeArguments(args);
  if ('error' in normalized) {
    return normalized.error;
  }

  try {
    const decisionInput: OpenJevStructuredDecisionInput = {
      state: normalized.input.state,
      questions: normalized.input.questions,
    };
    const decision = await decideOpenJevQuestions(decisionInput);
    const answers = Object.fromEntries(
      normalized.input.questions.map(question => {
        const answer = decision.answers[question.id];
        const reliable = answer.confidence >= normalized.input.confidenceThreshold;
        return [question.id, { ...answer, reliable }];
      }),
    ) as Record<string, OpenJevDecisionToolAnswer>;
    const unreliableQuestionIds = Object.entries(answers)
      .filter(([, answer]) => !answer.reliable)
      .map(([id]) => id);

    return {
      ok: true,
      model: OPEN_JEV_MODEL,
      runtime: decision.runtime,
      stateTokenCount: decision.stateTokenCount,
      confidenceThreshold: normalized.input.confidenceThreshold,
      answers,
      unreliableQuestionIds,
      summary:
        unreliableQuestionIds.length > 0
          ? `Local structured judgment completed; low-confidence answers: ${unreliableQuestionIds.join(', ')}. Treat those answers as uncertain.`
          : 'Local structured judgment completed; all answers passed the requested confidence threshold.',
    };
  } catch (error) {
    return {
      ok: false,
      recoverable: true,
      code: 'open-jev-unavailable',
      message: error instanceof Error ? error.message : 'The local open-jev decision failed.',
      guidance:
        'Continue with your own judgment without calling openJevDecide again for the same decision. The local tool is advisory and cannot block the response.',
    };
  }
};
