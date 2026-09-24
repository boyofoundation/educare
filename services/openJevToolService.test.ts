import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockDecideOpenJevQuestions } = vi.hoisted(() => ({
  mockDecideOpenJevQuestions: vi.fn(),
}));

vi.mock('./openJevDecisionService', () => ({
  OPEN_JEV_MODEL: 'kev-0.6b',
  decideOpenJevQuestions: mockDecideOpenJevQuestions,
}));

describe('openJevToolService', () => {
  beforeEach(() => {
    mockDecideOpenJevQuestions.mockReset();
  });

  it('exposes one batched structured-decision tool with the open-jev question types', async () => {
    const { OPEN_JEV_DECISION_TOOL_DEFINITION } = await import('./openJevToolService');

    expect(OPEN_JEV_DECISION_TOOL_DEFINITION).toMatchObject({
      name: 'openJevDecide',
      parameters: expect.objectContaining({
        properties: expect.objectContaining({
          state: expect.any(Object),
          questions: expect.any(Object),
          confidenceThreshold: expect.any(Object),
        }),
        required: ['state', 'questions'],
      }),
    });
  });

  it('returns keyed answers and marks low-confidence results without generating prose', async () => {
    mockDecideOpenJevQuestions.mockResolvedValue({
      runtime: { model: 'kev-0.6b', family: 'kev', device: 'webgpu', dtype: 'q4f16' },
      stateTokenCount: 42,
      answers: {
        route: {
          type: 'choice',
          choice: 'edit',
          confidence: 0.84,
          probabilities: { inspect: 0.08, edit: 0.84, ask: 0.08 },
        },
        urgency: {
          type: 'score',
          score: 1.1,
          normalized: 0.55,
          level: 'medium',
          confidence: 0.61,
          probabilities: { low: 0.2, medium: 0.61, high: 0.19 },
        },
        safe: {
          type: 'noul',
          answer: true,
          probability: 0.9,
          confidence: 0.9,
        },
      },
    });

    const { executeOpenJevDecisionTool } = await import('./openJevToolService');
    const result = await executeOpenJevDecisionTool({
      state: 'The existing page needs a small focused edit.',
      confidenceThreshold: 0.7,
      questions: [
        {
          id: 'route',
          type: 'choice',
          instructions: 'Which workflow is needed?',
          options: ['inspect', 'edit', 'ask'],
        },
        {
          id: 'urgency',
          type: 'score',
          instructions: 'How urgent is it?',
          options: ['low', 'medium', 'high'],
        },
        {
          id: 'safe',
          type: 'noul',
          instructions: 'Is this a reversible local change?',
        },
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      model: 'kev-0.6b',
      stateTokenCount: 42,
      confidenceThreshold: 0.7,
      answers: {
        route: expect.objectContaining({ choice: 'edit', reliable: true }),
        urgency: expect.objectContaining({ level: 'medium', reliable: false }),
        safe: expect.objectContaining({ answer: true, reliable: true }),
      },
      unreliableQuestionIds: ['urgency'],
    });
    expect(mockDecideOpenJevQuestions).toHaveBeenCalledWith({
      state: 'The existing page needs a small focused edit.',
      questions: expect.arrayContaining([
        expect.objectContaining({ id: 'route', type: 'choice' }),
        expect.objectContaining({ id: 'urgency', type: 'score' }),
        expect.objectContaining({ id: 'safe', type: 'noul' }),
      ]),
    });
  });

  it('returns a recoverable validation result without loading the model for invalid input', async () => {
    const { executeOpenJevDecisionTool } = await import('./openJevToolService');
    const result = await executeOpenJevDecisionTool({
      state: 'Decide this.',
      questions: [
        { id: 'route', type: 'choice', instructions: 'Choose.', options: ['same', 'same'] },
      ],
    });

    expect(result).toMatchObject({
      ok: false,
      recoverable: true,
      code: 'open-jev-duplicate-option',
    });
    expect(mockDecideOpenJevQuestions).not.toHaveBeenCalled();
  });

  it('converts local model failures into a recoverable tool result', async () => {
    mockDecideOpenJevQuestions.mockRejectedValue(new Error('WebGPU unavailable'));
    const { executeOpenJevDecisionTool } = await import('./openJevToolService');
    const result = await executeOpenJevDecisionTool({
      state: 'Decide this.',
      questions: [{ id: 'route', type: 'choice', instructions: 'Choose.', options: ['a', 'b'] }],
    });

    expect(result).toMatchObject({
      ok: false,
      recoverable: true,
      code: 'open-jev-unavailable',
      guidance: expect.stringContaining('own judgment'),
    });
  });
});
