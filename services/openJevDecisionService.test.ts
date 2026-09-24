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
  choice: (instructions: string, options: readonly string[]) => ({
    type: 'choice',
    instructions,
    options,
  }),
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
      intent: {
        type: 'choice',
        choice: 'targeted_edit',
        confidence: 0.86,
        probabilities: {
          new_build: 0.02,
          resume_project: 0.03,
          inspect_only: 0.02,
          targeted_edit: 0.86,
          finalize_or_complete: 0.04,
          uncertain: 0.03,
        },
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

  it('returns a typed project route while preserving existing pack safety', async () => {
    const { decideOpenJevIntent } = await import('./openJevDecisionService');
    const result = await decideOpenJevIntent({
      message: 'Please fix the header spacing in this webpage.',
      activeProjectId: 'project-123',
      history: [],
    });

    expect(result?.decision).toEqual(
      expect.objectContaining({
        intent: 'targeted_edit',
        confidence: 'high',
        selectedPackSet: ['inspect', 'edit', 'todo_finalize'],
        requiresSummaryPreflight: true,
      }),
    );
    expect(mockLoad).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'kev-0.6b', device: 'webgpu', dtype: 'auto' }),
    );
    expect(mockDecide).toHaveBeenCalledWith(
      expect.stringContaining('fix the header spacing'),
      expect.objectContaining({ intent: expect.objectContaining({ type: 'choice' }) }),
      expect.objectContaining({ truncation: 'error' }),
    );
  });

  it('does not load the model for an off-topic turn', async () => {
    const { decideOpenJevIntent } = await import('./openJevDecisionService');
    expect(
      await decideOpenJevIntent({ message: 'What is photosynthesis?', activeProjectId: null }),
    ).toBe(null);
    expect(mockLoad).not.toHaveBeenCalled();
  });

  it('fails closed when the adapter is unavailable', async () => {
    vi.stubGlobal('navigator', { gpu: { requestAdapter: vi.fn().mockResolvedValue(null) } });
    const { loadOpenJevModel, getOpenJevModelSnapshot } = await import('./openJevDecisionService');
    await expect(loadOpenJevModel()).rejects.toThrow('WebGPU');
    expect(getOpenJevModelSnapshot().status).toBe('unsupported');
  });
});
