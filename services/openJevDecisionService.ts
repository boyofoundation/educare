export const OPEN_JEV_MODEL = 'kev-0.6b' as const;
export const OPEN_JEV_MAX_STATE_TOKENS = 6_000;

export const OPEN_JEV_WEBGPU_UNSUPPORTED_MESSAGE =
  '此瀏覽器沒有可用的 WebGPU adapter；open-jev 實驗功能需要 WebGPU。';

export type OpenJevModelStatus =
  | 'idle'
  | 'checking'
  | 'loading'
  | 'ready'
  | 'deciding'
  | 'unsupported'
  | 'error';

export interface OpenJevModelSnapshot {
  status: OpenJevModelStatus;
  progress: number | null;
  loadedBytes: number | null;
  totalBytes: number | null;
  info?: import('open-jev').OpenJevInfo;
  runtime?: import('open-jev').OpenJevRuntime;
  error?: string;
}

export type OpenJevStructuredQuestion =
  | {
      id: string;
      type: 'choice';
      instructions: string;
      options: readonly string[];
      descriptions?: Partial<Record<string, string>>;
    }
  | {
      id: string;
      type: 'score';
      instructions: string;
      options: readonly string[];
    }
  | {
      id: string;
      type: 'noul';
      instructions: string;
    };

export type OpenJevStructuredAnswer =
  | import('open-jev').ChoiceAnswer<string>
  | import('open-jev').ScoreAnswer<string>
  | import('open-jev').NoulAnswer;

export interface OpenJevStructuredDecisionInput {
  state: string;
  questions: readonly OpenJevStructuredQuestion[];
}

export interface OpenJevStructuredDecision {
  answers: Record<string, OpenJevStructuredAnswer>;
  runtime: import('open-jev').OpenJevRuntime;
  stateTokenCount: number;
}

type OpenJevInstance = import('open-jev').OpenJev;

let openJevInstance: OpenJevInstance | null = null;
let loadPromise: Promise<OpenJevInstance> | null = null;
let modulePromise: Promise<typeof import('open-jev')> | null = null;
let snapshot: OpenJevModelSnapshot = {
  status: 'idle',
  progress: null,
  loadedBytes: null,
  totalBytes: null,
};
const listeners = new Set<(nextSnapshot: OpenJevModelSnapshot) => void>();

const updateSnapshot = (updates: Partial<OpenJevModelSnapshot>): void => {
  snapshot = { ...snapshot, ...updates };
  for (const listener of listeners) {
    listener(snapshot);
  }
};

export const getOpenJevModelSnapshot = (): OpenJevModelSnapshot => ({
  ...snapshot,
  info: snapshot.info ? { ...snapshot.info, files: [...snapshot.info.files] } : undefined,
  runtime: snapshot.runtime ? { ...snapshot.runtime } : undefined,
});

export const subscribeOpenJevModelStatus = (
  listener: (nextSnapshot: OpenJevModelSnapshot) => void,
): (() => void) => {
  listeners.add(listener);
  listener(getOpenJevModelSnapshot());
  return () => listeners.delete(listener);
};

const getOpenJevModule = (): Promise<typeof import('open-jev')> => {
  modulePromise ??= import('open-jev');
  return modulePromise;
};

/** Capability check intentionally requests an adapter; navigator.gpu alone is insufficient. */
export const hasWebGpuAdapter = async (): Promise<boolean> => {
  if (typeof navigator === 'undefined') {
    return false;
  }

  const gpu = (navigator as unknown as { gpu?: { requestAdapter: () => Promise<unknown | null> } })
    .gpu;
  if (!gpu || typeof gpu.requestAdapter !== 'function') {
    return false;
  }

  try {
    return (await gpu.requestAdapter()) !== null;
  } catch {
    return false;
  }
};

const ensureWebGpuAdapter = async (): Promise<void> => {
  updateSnapshot({ status: 'checking', error: undefined });
  if (!(await hasWebGpuAdapter())) {
    updateSnapshot({ status: 'unsupported', error: OPEN_JEV_WEBGPU_UNSUPPORTED_MESSAGE });
    throw new Error(OPEN_JEV_WEBGPU_UNSUPPORTED_MESSAGE);
  }
};

export const getOpenJevModelInfo = async (): Promise<import('open-jev').OpenJevInfo> => {
  try {
    await ensureWebGpuAdapter();
    const { OpenJev } = await getOpenJevModule();
    const info = await OpenJev.info({ model: OPEN_JEV_MODEL, device: 'webgpu', dtype: 'auto' });
    updateSnapshot({ info, runtime: info, status: openJevInstance ? 'ready' : 'idle' });
    return info;
  } catch (error) {
    updateSnapshot({
      status: snapshot.status === 'unsupported' ? 'unsupported' : 'error',
      error: error instanceof Error ? error.message : 'open-jev 模型資訊讀取失敗。',
    });
    throw error;
  }
};

export const loadOpenJevModel = async (): Promise<OpenJevInstance> => {
  if (openJevInstance) {
    return openJevInstance;
  }
  if (loadPromise) {
    return loadPromise;
  }

  const pendingLoad = (async () => {
    await ensureWebGpuAdapter();
    const { OpenJev } = await getOpenJevModule();
    updateSnapshot({
      status: 'loading',
      progress: 0,
      loadedBytes: 0,
      totalBytes: null,
      error: undefined,
    });
    const instance = await OpenJev.load({
      model: OPEN_JEV_MODEL,
      device: 'webgpu',
      dtype: 'auto',
      onProgress: ({ progress, loaded, total }) =>
        updateSnapshot({
          status: 'loading',
          progress,
          loadedBytes: loaded,
          totalBytes: total,
        }),
    });
    openJevInstance = instance;
    updateSnapshot({ status: 'ready', progress: 1, runtime: instance.runtime, error: undefined });
    return instance;
  })();

  loadPromise = pendingLoad;
  try {
    return await pendingLoad;
  } catch (error) {
    updateSnapshot({
      status: snapshot.status === 'unsupported' ? 'unsupported' : 'error',
      error: error instanceof Error ? error.message : 'open-jev 模型載入失敗。',
    });
    throw error;
  } finally {
    if (loadPromise === pendingLoad) {
      loadPromise = null;
    }
  }
};

export const disposeOpenJevModel = async (): Promise<void> => {
  const pendingLoad = loadPromise;
  if (pendingLoad) {
    try {
      await pendingLoad;
    } catch {
      // A failed load has no session to release.
    }
  }

  const instance = openJevInstance;
  openJevInstance = null;
  if (instance) {
    await instance.dispose();
  }

  updateSnapshot({
    status: 'idle',
    progress: null,
    loadedBytes: null,
    totalBytes: null,
    runtime: undefined,
    error: undefined,
  });
};

const buildOpenJevQuestions = (
  questions: readonly OpenJevStructuredQuestion[],
  builders: Pick<Awaited<ReturnType<typeof getOpenJevModule>>, 'choice' | 'score' | 'noul'>,
): Record<string, import('open-jev').Question> => {
  const { choice, score, noul } = builders;
  return Object.fromEntries(
    questions.map(question => {
      switch (question.type) {
        case 'choice':
          return [
            question.id,
            choice(question.instructions, question.options, question.descriptions),
          ];
        case 'score':
          return [question.id, score(question.instructions, question.options)];
        case 'noul':
          return [question.id, noul(question.instructions)];
      }
    }),
  );
};

export const decideOpenJevQuestions = async (
  input: OpenJevStructuredDecisionInput,
): Promise<OpenJevStructuredDecision> => {
  const state = input.state.trim();
  if (!state) {
    throw new Error('open-jev state cannot be empty.');
  }
  if (input.questions.length === 0) {
    throw new Error('open-jev requires at least one structured question.');
  }

  const instance = await loadOpenJevModel();
  const stateTokenCount = instance.countTokens(state);
  if (stateTokenCount > OPEN_JEV_MAX_STATE_TOKENS) {
    const message = `open-jev state is too long (${stateTokenCount} tokens; maximum ${OPEN_JEV_MAX_STATE_TOKENS}).`;
    updateSnapshot({ status: 'ready', error: message });
    throw new Error(message);
  }

  updateSnapshot({ status: 'deciding', error: undefined });
  try {
    const module = await getOpenJevModule();
    const questions = buildOpenJevQuestions(input.questions, module);
    const rawAnswers = (await instance.decide(state, questions, {
      maxStateTokens: OPEN_JEV_MAX_STATE_TOKENS,
      truncation: 'error',
    })) as Record<string, import('open-jev').Answer>;

    const answers = Object.fromEntries(
      input.questions.map(question => [question.id, rawAnswers[question.id]]),
    ) as Record<string, OpenJevStructuredAnswer>;
    updateSnapshot({ status: 'ready', runtime: instance.runtime, error: undefined });
    return {
      answers,
      runtime: instance.runtime,
      stateTokenCount,
    };
  } catch (error) {
    updateSnapshot({
      status: 'error',
      error: error instanceof Error ? error.message : 'open-jev structured decision failed.',
    });
    throw error;
  }
};
