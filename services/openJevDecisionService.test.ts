import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockLoad, mockInfo, mockDecide, mockDispose } = vi.hoisted(() => ({
  mockLoad: vi.fn(),
  mockInfo: vi.fn(),
  mockDecide: vi.fn(),
  mockDispose: vi.fn(),
}));

vi.mock('open-jev', () => ({
  OpenJev: {
    load: mockLoad,
    info: mockInfo,
  },
  choice: (instructions: string, options: readonly string[], descriptions?: unknown) => ({
    type: 'choice',
    instructions,
    options,
    descriptions,
  }),
  score: (instructions: string, options: readonly string[]) => ({
    type: 'score',
    instructions,
    options,
  }),
  noul: (instructions: string) => ({ type: 'noul', instructions }),
}));

describe('openJevDecisionService', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', {
      gpu: {
        requestAdapter: vi.fn().mockResolvedValue({}),
      },
    });
    mockLoad.mockResolvedValue({
      runtime: {
        model: 'onnx-community/kev-0.6b-ONNX',
        family: 'kev',
        device: 'webgpu',
        dtype: 'q4f16',
      },
      countTokens: vi.fn(() => 100),
      decide: mockDecide,
      dispose: mockDispose,
    });
    mockInfo.mockResolvedValue({
      model: 'onnx-community/kev-0.6b-ONNX',
      family: 'kev',
      device: 'webgpu',
      dtype: 'q4f16',
      isCached: false,
      downloadSize: 123,
      files: ['config.json'],
    });
    mockDecide.mockResolvedValue({
      route: {
        type: 'choice',
        choice: 'inspect',
        confidence: 0.86,
        probabilities: { inspect: 0.86, edit: 0.1, ask: 0.04 },
      },
      urgency: {
        type: 'score',
        score: 1.4,
        normalized: 0.7,
        level: 'medium',
        confidence: 0.62,
        probabilities: { low: 0.08, medium: 0.62, high: 0.3 },
      },
      needs_edit: {
        type: 'noul',
        answer: false,
        probability: 0.32,
        confidence: 0.68,
      },
    });
  });

  afterEach(async () => {
    const { disposeOpenJevModel } = await import('./openJevDecisionService');
    await disposeOpenJevModel();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('requires an actual WebGPU adapter', async () => {
    const { hasWebGpuAdapter } = await import('./openJevDecisionService');
    expect(await hasWebGpuAdapter()).toBe(true);

    vi.stubGlobal('navigator', { gpu: { requestAdapter: vi.fn().mockResolvedValue(null) } });
    expect(await hasWebGpuAdapter()).toBe(false);
  });

  it('batches choice, score, and noul functions into one typed local decision', async () => {
    const { decideOpenJevQuestions } = await import('./openJevDecisionService');
    const result = await decideOpenJevQuestions({
      state: 'The user asks whether the current project needs a focused edit and how urgent it is.',
      questions: [
        {
          id: 'route',
          type: 'choice',
          instructions: 'Which next workflow is best?',
          options: ['inspect', 'edit', 'ask'],
          descriptions: { edit: 'Change an existing project file.' },
        },
        {
          id: 'urgency',
          type: 'score',
          instructions: 'How urgent is the request?',
          options: ['low', 'medium', 'high'],
        },
        {
          id: 'needs_edit',
          type: 'noul',
          instructions: 'The request requires editing an existing file.',
        },
      ],
    });

    expect(result).toMatchObject({
      stateTokenCount: 100,
      runtime: expect.objectContaining({ device: 'webgpu' }),
      answers: {
        route: expect.objectContaining({ choice: 'inspect', confidence: 0.86 }),
        urgency: expect.objectContaining({ level: 'medium', confidence: 0.62 }),
        needs_edit: expect.objectContaining({ answer: false, probability: 0.32 }),
      },
    });
    expect(mockLoad).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'kev-0.6b', device: 'webgpu', dtype: 'auto' }),
    );
    expect(mockDecide).toHaveBeenCalledWith(
      expect.stringContaining('current project'),
      expect.objectContaining({
        route: expect.objectContaining({ type: 'choice', options: ['inspect', 'edit', 'ask'] }),
        urgency: expect.objectContaining({ type: 'score' }),
        needs_edit: expect.objectContaining({ type: 'noul' }),
      }),
      expect.objectContaining({ maxStateTokens: 6000, truncation: 'error' }),
    );
  });

  it('rejects a state that exceeds the local token budget', async () => {
    mockLoad.mockResolvedValueOnce({
      runtime: { model: 'kev-0.6b', family: 'kev', device: 'webgpu', dtype: 'q4f16' },
      countTokens: vi.fn(() => 6001),
      decide: mockDecide,
      dispose: mockDispose,
    });
    const { decideOpenJevQuestions } = await import('./openJevDecisionService');

    await expect(
      decideOpenJevQuestions({
        state: 'Too much context',
        questions: [
          { id: 'route', type: 'choice', instructions: 'Choose one.', options: ['a', 'b'] },
        ],
      }),
    ).rejects.toThrow('too long');
    expect(mockDecide).not.toHaveBeenCalled();
  });

  it('fails closed when the adapter is unavailable', async () => {
    vi.stubGlobal('navigator', { gpu: { requestAdapter: vi.fn().mockResolvedValue(null) } });
    const { loadOpenJevModel, getOpenJevModelSnapshot } = await import('./openJevDecisionService');
    await expect(loadOpenJevModel()).rejects.toThrow('WebGPU');
    expect(getOpenJevModelSnapshot().status).toBe('unsupported');
  });
});
