import type { ChatMessage, HtmlProjectIntent, HtmlProjectIntentDecision } from '../types';
import {
  classifyHtmlProjectIntent,
  getHtmlProjectToolPacksForIntent,
} from './htmlProjectPrompting';

const OPEN_JEV_MODEL = 'kev-0.6b' as const;
const OPEN_JEV_MIN_CONFIDENCE = 0.65;
const OPEN_JEV_MAX_STATE_TOKENS = 7_000;

const OPEN_JEV_INTENTS = [
  'new_build',
  'resume_project',
  'inspect_only',
  'targeted_edit',
  'finalize_or_complete',
  'uncertain',
] as const satisfies readonly HtmlProjectIntent[];

type OpenJevIntentChoice = (typeof OPEN_JEV_INTENTS)[number];

export const OPEN_JEV_WEBGPU_UNSUPPORTED_MESSAGE =
  '此瀏覽器沒有可用的 WebGPU adapter；open-jev 實驗功能需要 WebGPU。';
export const OPEN_JEV_LOW_CONFIDENCE_MESSAGE = 'open-jev 的意圖信心不足，已保留既有路由。';

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

export interface OpenJevIntentInput {
  message: string;
  activeProjectId?: string | null;
  history?: ChatMessage[];
}

export interface OpenJevIntentDecision {
  decision: HtmlProjectIntentDecision;
  confidence: number;
  probabilities: Record<OpenJevIntentChoice, number>;
  runtime: import('open-jev').OpenJevRuntime;
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

const buildState = ({ message, activeProjectId, history }: OpenJevIntentInput): string => {
  const recentHistory = (history ?? [])
    .slice(-4)
    .map(item => `${item.role}: ${item.content}`)
    .join('\n')
    .slice(-5_000);

  return [
    'You are a local, read-only router for an educational AI assistant.',
    `An HTML project is currently active: ${activeProjectId ? 'yes' : 'no'}.`,
    'Classify the user request for the HTML project tool route only.',
    `User request:\n${message}`,
    `Recent conversation:\n${recentHistory || '(none)'}`,
  ].join('\n\n');
};

const isOpenJevIntentChoice = (value: string): value is OpenJevIntentChoice =>
  (OPEN_JEV_INTENTS as readonly string[]).includes(value);

const isIntentCompatibleWithProjectState = (
  intent: OpenJevIntentChoice,
  activeProjectId: string | null | undefined,
): boolean => {
  if (intent === 'uncertain') {
    return false;
  }
  if (
    !activeProjectId &&
    ['inspect_only', 'targeted_edit', 'finalize_or_complete'].includes(intent)
  ) {
    return false;
  }
  return !(activeProjectId && intent === 'new_build');
};

const buildExperimentalDecision = (
  intent: OpenJevIntentChoice,
  confidence: number,
  probabilities: Record<OpenJevIntentChoice, number>,
  input: OpenJevIntentInput,
): HtmlProjectIntentDecision => {
  const fallback = classifyHtmlProjectIntent(input.message, input.activeProjectId);
  const selectedPackSet = getHtmlProjectToolPacksForIntent(intent);

  if (intent === 'resume_project' && !input.activeProjectId) {
    selectedPackSet.unshift('bootstrap');
  }
  for (const pack of fallback.selectedPackSet) {
    if (pack === 'preview_recheck' && !selectedPackSet.includes(pack)) {
      selectedPackSet.push(pack);
    }
  }

  const confidenceLabel = confidence >= 0.8 ? 'high' : 'medium';
  const probabilitySummary = Object.entries(probabilities)
    .sort(([, left], [, right]) => right - left)
    .slice(0, 3)
    .map(([label, probability]) => `${label} ${Math.round(probability * 100)}%`)
    .join(', ');

  return {
    intent,
    confidence: confidenceLabel,
    selectedPackSet,
    reason: `open-jev experimental router selected ${intent} (${Math.round(confidence * 100)}% confidence; ${probabilitySummary}).`,
    requiresSummaryPreflight: Boolean(input.activeProjectId) && intent !== 'new_build',
  };
};

/**
 * Classify only the project route. The caller owns the explicit experiment
 * flag; every rejected result is represented by the existing deterministic
 * classifier so the provider/tool loop never depends on this model.
 */
export const decideOpenJevIntent = async (
  input: OpenJevIntentInput,
): Promise<OpenJevIntentDecision | null> => {
  const fallback = classifyHtmlProjectIntent(input.message, input.activeProjectId);
  if (fallback.selectedPackSet.length === 0 && !input.activeProjectId) {
    return null;
  }

  const instance = await loadOpenJevModel();
  const state = buildState(input);
  if (instance.countTokens(state) > OPEN_JEV_MAX_STATE_TOKENS) {
    updateSnapshot({ status: 'ready', error: '路由內容過長，已保留既有路由。' });
    return null;
  }

  const { choice } = await getOpenJevModule();
  const questions = {
    intent: choice(
      'Which single HTML project workflow best matches the user request? Choose only a workflow that is supported by the current project state.',
      OPEN_JEV_INTENTS,
      {
        new_build: 'Create a brand-new HTML project.',
        resume_project: 'Open or continue an existing project.',
        inspect_only: 'Inspect or summarize without changing files.',
        targeted_edit: 'Make a focused change to project files.',
        finalize_or_complete: 'Verify, finish, or finalize the project.',
        uncertain: 'The request is not clear enough for a project route.',
      },
    ),
  };

  updateSnapshot({ status: 'deciding', error: undefined });
  try {
    const answers = await instance.decide(state, questions, {
      maxStateTokens: OPEN_JEV_MAX_STATE_TOKENS,
      truncation: 'error',
    });
    const answer = answers.intent;
    if (
      answer.type !== 'choice' ||
      !isOpenJevIntentChoice(answer.choice) ||
      answer.confidence < OPEN_JEV_MIN_CONFIDENCE ||
      !isIntentCompatibleWithProjectState(answer.choice, input.activeProjectId)
    ) {
      updateSnapshot({ status: 'ready', error: OPEN_JEV_LOW_CONFIDENCE_MESSAGE });
      return null;
    }

    const decision = buildExperimentalDecision(
      answer.choice,
      answer.confidence,
      answer.probabilities,
      input,
    );
    updateSnapshot({ status: 'ready', runtime: instance.runtime, error: undefined });
    return {
      decision,
      confidence: answer.confidence,
      probabilities: answer.probabilities,
      runtime: instance.runtime,
    };
  } catch (error) {
    updateSnapshot({
      status: 'error',
      error: error instanceof Error ? error.message : 'open-jev 意圖判斷失敗。',
    });
    throw error;
  }
};
