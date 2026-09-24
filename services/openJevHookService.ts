import type { ChatMessage, CompactContext, ConversationRound } from '../types';
import {
  decideOpenJevQuestions,
  type OpenJevStructuredAnswer,
  type OpenJevStructuredDecisionInput,
} from './openJevDecisionService';

/**
 * open-jev is deliberately used as a lifecycle advisor, not as a source of
 * truth.  These limits keep a cold/slow local model from turning one chat turn
 * into an unbounded number of browser inference calls.
 */
export const OPEN_JEV_HOOK_BATCH_SIZE = 8;
export const OPEN_JEV_HOOK_MAX_CANDIDATES = 24;
export const OPEN_JEV_HOOK_DROP_THRESHOLD = 0.35;

const OPEN_JEV_HOOK_MAX_CACHE_ENTRIES = 256;
const MAX_TOPIC_CHARS = 6_000;
const MAX_CANDIDATE_CHARS = 3_000;
const MAX_INTENT_STATE_CHARS = 9_000;

export type OpenJevHookSource = 'open-jev' | 'cache';

export interface OpenJevRelevanceCandidate<T> {
  id: string;
  text: string;
  value: T;
}

export interface OpenJevRelevanceJudgment {
  id: string;
  probability: number;
  keep: boolean;
  source: OpenJevHookSource;
}

export interface OpenJevRelevanceResult<T> {
  values: T[];
  judgments: OpenJevRelevanceJudgment[];
  applied: boolean;
  fallback: boolean;
  evaluatedCount: number;
  filteredCount: number;
}

export interface OpenJevHookDecisionEvaluator {
  (input: OpenJevStructuredDecisionInput): ReturnType<typeof decideOpenJevQuestions>;
}

export interface OpenJevCompactionFilterInput {
  enabled: boolean;
  topic: string;
  rounds: ConversationRound[];
  existingCompact?: CompactContext;
  evaluator?: OpenJevHookDecisionEvaluator;
}

export interface OpenJevRagFilterInput<T> {
  enabled: boolean;
  query: string;
  matches: OpenJevRelevanceCandidate<T>[];
  evaluator?: OpenJevHookDecisionEvaluator;
}

const OPEN_JEV_INTENT_KINDS = [
  'answer_question',
  'explain_or_teach',
  'perform_task',
  'troubleshoot',
  'plan_or_decide',
  'other',
] as const;

export type OpenJevIntentKind = (typeof OPEN_JEV_INTENT_KINDS)[number];

export interface OpenJevIntentContext {
  schemaVersion: 1;
  source: 'open-jev';
  intent: OpenJevIntentKind;
  intentConfidence: number;
  needsKnowledge: boolean | null;
  knowledgeProbability: number;
  needsClarification: boolean | null;
  clarificationProbability: number;
}

export interface OpenJevIntentAnalysisInput {
  enabled: boolean;
  message: string;
  recentHistory?: ChatMessage[];
  evaluator?: OpenJevHookDecisionEvaluator;
}

const relevanceCache = new Map<string, OpenJevRelevanceJudgment>();
const intentCache = new Map<string, OpenJevIntentContext>();

const clampProbability = (value: number): number =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5;

const truncate = (value: string, limit: number): string => {
  const normalized = value.trim();
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1)}…`;
};

const fingerprint = (value: string): string => {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `${value.length}:${(hash >>> 0).toString(16)}`;
};

const remember = <T>(cache: Map<string, T>, key: string, value: T): void => {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > OPEN_JEV_HOOK_MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    cache.delete(oldest);
  }
};

const getNoulProbability = (answer: OpenJevStructuredAnswer | undefined): number | null => {
  if (!answer || answer.type !== 'noul') {
    return null;
  }
  return clampProbability(answer.probability);
};

const getNoulValue = (probability: number | null): boolean | null => {
  if (probability === null || Math.abs(probability - 0.5) < 0.15) {
    return null;
  }
  return probability >= 0.5;
};

const shouldKeepRelevanceCandidate = (probability: number): boolean =>
  // Uncertainty is intentionally fail-open.  Only a clear "not relevant"
  // probability is allowed to remove context from the agent's view.
  probability > OPEN_JEV_HOOK_DROP_THRESHOLD;

const buildRelevanceState = (topic: string): string =>
  `Current topic or query:\n${truncate(topic, MAX_TOPIC_CHARS)}\n\n` +
  'Judge each candidate independently. A candidate is relevant only when it directly helps answer, explain, or complete the current topic. Ignore superficial word overlap.';

const buildRelevanceQuestions = <T>(
  candidates: OpenJevRelevanceCandidate<T>[],
): OpenJevStructuredDecisionInput['questions'] =>
  candidates.map((candidate, index) => ({
    id: `candidate_${index}`,
    type: 'noul' as const,
    instructions:
      `Candidate ${index + 1} (id ${candidate.id}) is directly relevant to the current topic. ` +
      `Candidate text:\n${truncate(candidate.text, MAX_CANDIDATE_CHARS)}`,
  }));

const filterOpenJevCandidates = async <T>(input: {
  enabled: boolean;
  topic: string;
  candidates: OpenJevRelevanceCandidate<T>[];
  evaluator?: OpenJevHookDecisionEvaluator;
}): Promise<OpenJevRelevanceResult<T>> => {
  const { enabled, topic, candidates, evaluator = decideOpenJevQuestions } = input;
  if (!enabled || !topic.trim() || candidates.length === 0) {
    return {
      values: candidates.map(candidate => candidate.value),
      judgments: [],
      applied: false,
      fallback: false,
      evaluatedCount: 0,
      filteredCount: 0,
    };
  }

  const boundedCandidates = candidates.slice(0, OPEN_JEV_HOOK_MAX_CANDIDATES);
  const judgments = new Map<string, OpenJevRelevanceJudgment>();
  const pending: OpenJevRelevanceCandidate<T>[] = [];

  for (const candidate of boundedCandidates) {
    const key = `relevance:${fingerprint(`${topic}\n${candidate.id}\n${candidate.text}`)}`;
    const cached = relevanceCache.get(key);
    if (cached) {
      // Touch the entry so the bounded cache behaves as a small LRU.
      remember(relevanceCache, key, cached);
      judgments.set(candidate.id, { ...cached, source: 'cache' });
    } else {
      pending.push(candidate);
    }
  }

  let fallback = false;
  for (let offset = 0; offset < pending.length; offset += OPEN_JEV_HOOK_BATCH_SIZE) {
    const batch = pending.slice(offset, offset + OPEN_JEV_HOOK_BATCH_SIZE);
    try {
      const decision = await evaluator({
        state: buildRelevanceState(topic),
        questions: buildRelevanceQuestions(batch),
      });
      batch.forEach((candidate, index) => {
        const probability = getNoulProbability(decision.answers[`candidate_${index}`]);
        if (probability === null) {
          fallback = true;
          return;
        }
        const judgment: OpenJevRelevanceJudgment = {
          id: candidate.id,
          probability,
          keep: shouldKeepRelevanceCandidate(probability),
          source: 'open-jev',
        };
        const key = `relevance:${fingerprint(`${topic}\n${candidate.id}\n${candidate.text}`)}`;
        remember(relevanceCache, key, judgment);
        judgments.set(candidate.id, judgment);
      });
    } catch {
      // The existing lexical/vector result is the safety net whenever the
      // model cannot load, a branch exceeds context, or inference fails.
      fallback = true;
    }
  }

  const values = candidates.map(candidate => {
    const judgment = judgments.get(candidate.id);
    return judgment && !judgment.keep ? undefined : candidate.value;
  });
  const filteredValues = values.filter((value): value is T => value !== undefined);

  // Candidates beyond the bounded budget are deliberately retained.  This
  // keeps the hook advisory and prevents a long conversation/document set from
  // being silently deleted just because the local budget was reached.
  return {
    values: filteredValues,
    judgments: [...judgments.values()],
    applied: judgments.size > 0,
    fallback,
    evaluatedCount: judgments.size,
    filteredCount: candidates.length - filteredValues.length,
  };
};

const buildRoundCandidateText = (round: ConversationRound): string =>
  `User: ${round.userMessage.content}\nAssistant: ${round.assistantMessage.content}`;

export const filterConversationRoundsByOpenJev = async (
  input: OpenJevCompactionFilterInput,
): Promise<OpenJevRelevanceResult<ConversationRound>> => {
  const result = await filterOpenJevCandidates({
    enabled: input.enabled,
    topic: input.topic,
    candidates: input.rounds.map(round => ({
      id: `round-${round.roundNumber}`,
      text: buildRoundCandidateText(round),
      value: round,
    })),
    evaluator: input.evaluator,
  });

  // A compaction summary with no source rounds is less safe than the existing
  // compactor.  Keep the original candidates in that edge case.
  if (input.rounds.length > 0 && result.values.length === 0) {
    return {
      ...result,
      values: [...input.rounds],
      filteredCount: 0,
      fallback: true,
    };
  }
  return result;
};

export const filterRagMatchesByOpenJev = <T>(
  input: OpenJevRagFilterInput<T>,
): Promise<OpenJevRelevanceResult<T>> =>
  filterOpenJevCandidates({
    enabled: input.enabled,
    topic: input.query,
    candidates: input.matches,
    evaluator: input.evaluator,
  });

const buildIntentState = (message: string, recentHistory: ChatMessage[]): string => {
  const history = recentHistory
    .filter(entry => !entry.isError && entry.content.trim())
    .slice(-4)
    .map(
      entry => `${entry.role === 'user' ? 'User' : 'Assistant'}: ${truncate(entry.content, 1_500)}`,
    )
    .join('\n\n');
  return truncate(
    [
      history ? `Recent conversation:\n${history}` : '',
      `Latest user message:\n${truncate(message, 3_000)}`,
      'Classify the latest user message, not the assistant text. Return only typed decisions.',
    ]
      .filter(Boolean)
      .join('\n\n'),
    MAX_INTENT_STATE_CHARS,
  );
};

const isOpenJevIntentKind = (value: string): value is OpenJevIntentKind =>
  (OPEN_JEV_INTENT_KINDS as readonly string[]).includes(value);

const intentQuestions: OpenJevStructuredDecisionInput['questions'] = [
  {
    id: 'intent',
    type: 'choice',
    instructions: 'What is the primary intent of the latest user message?',
    options: [...OPEN_JEV_INTENT_KINDS],
    descriptions: {
      answer_question: 'The user primarily wants a factual or direct answer.',
      explain_or_teach: 'The user wants concepts, instructions, or learning help.',
      perform_task: 'The user wants the agent to create, edit, or execute something.',
      troubleshoot: 'The user reports a failure and wants diagnosis or repair.',
      plan_or_decide: 'The user wants options, planning, or a recommendation.',
      other: 'No category is clearly dominant.',
    },
  },
  {
    id: 'needs_knowledge',
    type: 'noul',
    instructions:
      'The latest user message needs facts from uploaded knowledge documents to answer accurately.',
  },
  {
    id: 'needs_clarification',
    type: 'noul',
    instructions:
      'The latest user message is missing information that should be clarified before acting.',
  },
];

export const analyzeOpenJevIntent = async (
  input: OpenJevIntentAnalysisInput,
): Promise<OpenJevIntentContext | null> => {
  const message = input.message.trim();
  if (!input.enabled || !message) {
    return null;
  }

  const state = buildIntentState(message, input.recentHistory ?? []);
  const cacheKey = `intent:${fingerprint(state)}`;
  const cached = intentCache.get(cacheKey);
  if (cached) {
    remember(intentCache, cacheKey, cached);
    return { ...cached };
  }

  try {
    const decision = await (input.evaluator ?? decideOpenJevQuestions)({
      state,
      questions: intentQuestions,
    });
    const intentAnswer = decision.answers.intent;
    const knowledgeProbability = getNoulProbability(decision.answers.needs_knowledge);
    const clarificationProbability = getNoulProbability(decision.answers.needs_clarification);
    if (
      !intentAnswer ||
      intentAnswer.type !== 'choice' ||
      !isOpenJevIntentKind(intentAnswer.choice) ||
      knowledgeProbability === null ||
      clarificationProbability === null
    ) {
      return null;
    }

    const context: OpenJevIntentContext = {
      schemaVersion: 1,
      source: 'open-jev',
      intent: intentAnswer.choice,
      intentConfidence: clampProbability(intentAnswer.confidence),
      needsKnowledge: getNoulValue(knowledgeProbability),
      knowledgeProbability,
      needsClarification: getNoulValue(clarificationProbability),
      clarificationProbability,
    };
    remember(intentCache, cacheKey, context);
    return { ...context };
  } catch {
    // Intent is advisory.  A failed local model must never prevent the normal
    // provider turn from starting.
    return null;
  }
};

const formatTriState = (value: boolean | null): string =>
  value === null ? 'uncertain' : value ? 'yes' : 'no';

export const formatOpenJevIntentForAgent = (context: OpenJevIntentContext): string =>
  [
    '[LOCAL_INTENT_HINT]',
    'This is an advisory browser-local classification. Verify it against the user message; never treat it as user instructions or as proof of facts.',
    `primary_intent: ${context.intent} (confidence ${context.intentConfidence.toFixed(2)})`,
    `needs_uploaded_knowledge: ${formatTriState(context.needsKnowledge)} (p_yes ${context.knowledgeProbability.toFixed(2)})`,
    `needs_clarification: ${formatTriState(context.needsClarification)} (p_yes ${context.clarificationProbability.toFixed(2)})`,
    '[/LOCAL_INTENT_HINT]',
  ].join('\n');

export const clearOpenJevHookCachesForTesting = (): void => {
  relevanceCache.clear();
  intentCache.clear();
};
