import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, ConversationRound } from '../types';
import {
  analyzeOpenJevIntent,
  clearOpenJevHookCachesForTesting,
  filterConversationRoundsByOpenJev,
  filterRagMatchesByOpenJev,
  formatOpenJevIntentForAgent,
  type OpenJevHookDecisionEvaluator,
} from './openJevHookService';
import type {
  OpenJevStructuredDecision,
  OpenJevStructuredDecisionInput,
} from './openJevDecisionService';

const answer = (probability: number) => ({
  type: 'noul' as const,
  answer: probability >= 0.5,
  probability,
  confidence: Math.max(probability, 1 - probability),
});

const createMessage = (role: ChatMessage['role'], content: string): ChatMessage => ({
  role,
  content,
});

const createRound = (roundNumber: number, user: string, assistant: string): ConversationRound => ({
  roundNumber,
  userMessage: createMessage('user', user),
  assistantMessage: createMessage('model', assistant),
});

describe('openJevHookService', () => {
  beforeEach(() => {
    clearOpenJevHookCachesForTesting();
  });

  it('filters only clearly irrelevant candidates and batches one shared topic decision', async () => {
    const evaluatorMock = vi.fn(
      async (input: OpenJevStructuredDecisionInput) =>
        ({
          runtime: { model: 'kev-0.6b', family: 'kev', device: 'webgpu', dtype: 'q4f16' },
          stateTokenCount: 12,
          answers: Object.fromEntries(
            input.questions.map((question, index) => [
              question.id,
              answer(index === 0 ? 0.92 : index === 1 ? 0.12 : 0.5),
            ]),
          ),
        }) as OpenJevStructuredDecision,
    );
    const evaluator = evaluatorMock as unknown as OpenJevHookDecisionEvaluator;

    const result = await filterRagMatchesByOpenJev({
      enabled: true,
      query: 'leave policy',
      matches: [
        { id: 'leave', text: 'Annual leave policy', value: 'leave' },
        { id: 'tax', text: 'Unrelated tax policy', value: 'tax' },
        { id: 'uncertain', text: 'Possibly related policy', value: 'uncertain' },
      ],
      evaluator,
    });

    expect(result.values).toEqual(['leave', 'uncertain']);
    expect(result.filteredCount).toBe(1);
    expect(result.evaluatedCount).toBe(3);
    expect(evaluatorMock).toHaveBeenCalledTimes(1);
    expect(evaluatorMock.mock.calls[0]?.[0].questions).toHaveLength(3);
  });

  it('fails open when the local model fails', async () => {
    const evaluator: OpenJevHookDecisionEvaluator = vi
      .fn()
      .mockRejectedValue(new Error('WebGPU unavailable'));

    const result = await filterRagMatchesByOpenJev({
      enabled: true,
      query: 'topic',
      matches: [{ id: 'one', text: 'candidate', value: 'candidate' }],
      evaluator,
    });

    expect(result.values).toEqual(['candidate']);
    expect(result.fallback).toBe(true);
    expect(result.filteredCount).toBe(0);
  });

  it('keeps compaction input when every round is judged irrelevant', async () => {
    const rounds = [
      createRound(1, 'Old topic', 'Old answer'),
      createRound(2, 'Another old topic', 'Another answer'),
    ];
    const evaluator: OpenJevHookDecisionEvaluator = vi.fn(
      async (input: OpenJevStructuredDecisionInput) =>
        ({
          runtime: { model: 'kev-0.6b', family: 'kev', device: 'webgpu', dtype: 'q4f16' },
          stateTokenCount: 10,
          answers: Object.fromEntries(input.questions.map(question => [question.id, answer(0.05)])),
        }) as OpenJevStructuredDecision,
    );

    const result = await filterConversationRoundsByOpenJev({
      enabled: true,
      topic: 'current topic',
      rounds,
      evaluator,
    });

    expect(result.values).toEqual(rounds);
    expect(result.fallback).toBe(true);
    expect(result.filteredCount).toBe(0);
  });

  it('analyzes intent once and formats an advisory prompt block', async () => {
    const evaluator: OpenJevHookDecisionEvaluator = vi.fn(
      async () =>
        ({
          runtime: { model: 'kev-0.6b', family: 'kev', device: 'webgpu', dtype: 'q4f16' },
          stateTokenCount: 20,
          answers: {
            intent: {
              type: 'choice' as const,
              choice: 'troubleshoot',
              confidence: 0.82,
              probabilities: {
                answer_question: 0.03,
                explain_or_teach: 0.04,
                perform_task: 0.03,
                troubleshoot: 0.82,
                plan_or_decide: 0.04,
                other: 0.04,
              },
            },
            needs_knowledge: answer(0.88),
            needs_clarification: answer(0.18),
          },
        }) as OpenJevStructuredDecision,
    );

    const input = {
      enabled: true,
      message: 'Why does the uploaded lesson fail to render?',
      recentHistory: [createMessage('user', 'We discussed the lesson.')],
      evaluator,
    };
    const first = await analyzeOpenJevIntent(input);
    const second = await analyzeOpenJevIntent(input);

    expect(first).toMatchObject({
      intent: 'troubleshoot',
      intentConfidence: 0.82,
      needsKnowledge: true,
      needsClarification: false,
    });
    expect(second).toEqual(first);
    expect(evaluator).toHaveBeenCalledTimes(1);
    expect(formatOpenJevIntentForAgent(first!)).toContain('[LOCAL_INTENT_HINT]');
    expect(formatOpenJevIntentForAgent(first!)).toContain('troubleshoot');
  });
});
