/**
 * 模型多模態(圖片輸入)能力偵測 — 混合策略。
 *
 * 已查證各 provider 官方 API(2026-07):
 * - OpenRouter `GET /api/v1/models` 有 `architecture.input_modalities` ✓
 * - Ollama `POST /api/show` 有 `capabilities: ["vision", ...]` ✓
 * - LM Studio `GET /api/v0/models` 有 `type: "vlm" | "llm" | "embeddings"` ✓
 * - Gemini `models.get` 無 modality 欄位 ✗(僅 supportedGenerationMethods 等)
 * - OpenAI `/v1/models` 僅 id/object/created/owned_by ✗
 * - Anthropic `/v1/models`、Groq `/models` 亦無能力欄位 ✗
 *
 * 因此:查得到的 provider 以 API 實查(24h 快取),其餘退回模型 id
 * pattern(偏保守:未知模型視為不支援)。
 */
import type { ProviderConfig } from './llmAdapter';
import { providerManager } from './providerRegistry';

/** 明確不支援圖片輸入的模型(即使名稱符合 vision pattern 也排除)。 */
const NON_VISION_PATTERNS: RegExp[] = [
  /embed/i,
  /whisper/i,
  /\btts\b/i,
  /audio/i,
  /guard/i,
  /rerank/i,
];

/**
 * Pattern fallback(API 無能力欄位的 provider 使用)。
 * 寫法盡量向前相容:同世代之後的新版本自動涵蓋。
 */
const GEMINI_VISION_PATTERNS: RegExp[] = [
  // Gemini 1.5 起所有 generateContent 聊天模型皆收圖片;涵蓋 2.x、3.x 之後版本。
  /^gemini-(1\.5|[2-9])/i,
  /^gemini-exp/i,
  // 無版本號的通用別名(gemini-flash-latest、gemini-pro-latest、
  // gemini-flash-lite-latest 等),皆指向最新的多模態模型。
  /^gemini-(flash|pro)/i,
];

const ANTHROPIC_VISION_PATTERNS: RegExp[] = [
  // Claude 3 起全系列支援 vision(claude-3-*、claude-{opus,sonnet,haiku}-4+、claude-fable-5 等)。
  /^claude-(?!2)(?!instant)/i,
];

const OPENAI_VISION_PATTERNS: RegExp[] = [
  /^gpt-4o/i,
  /^gpt-4\.\d/i,
  /^gpt-4-turbo/i,
  /^gpt-4-vision/i,
  /^gpt-[5-9]/i,
  /^chatgpt-4o/i,
  /^o[1-9](-|$)/i,
];

/** 本地/開源 vision 模型常見命名(Groq、OpenRouter 與離線 fallback 通用)。 */
const OPEN_MODEL_VISION_PATTERNS: RegExp[] = [
  /llava/i,
  /bakllava/i,
  /moondream/i,
  /minicpm-?v/i,
  /qwen[-.]?\d(\.\d)?[-.]?vl/i,
  /qwen[-.]?vl/i,
  /pixtral/i,
  /gemma-?3/i,
  /internvl/i,
  /llama-?3\.2.*vision/i,
  /llama-?4/i,
  /-vl\b/i,
  /vision/i,
];

const matchesAny = (model: string, patterns: RegExp[]): boolean =>
  patterns.some(pattern => pattern.test(model));

/** 剝除 openrouter 式 `vendor/` 前綴後的裸模型名。 */
const stripVendorPrefix = (model: string): string => model.replace(/^[^/]+\//, '');

/**
 * Pattern fallback:依 provider + 模型 id 判斷是否支援圖片輸入。
 * 未知組合回傳 false(保守)。可同步呼叫,供初始 render 與 API 查詢失敗時使用。
 */
export const supportsImageInput = (provider: string, model: string): boolean => {
  const normalizedModel = model.trim();
  if (!normalizedModel || matchesAny(normalizedModel, NON_VISION_PATTERNS)) {
    return false;
  }

  switch (provider) {
    case 'gemini':
      return matchesAny(normalizedModel, GEMINI_VISION_PATTERNS);
    case 'anthropic':
      return matchesAny(normalizedModel, ANTHROPIC_VISION_PATTERNS);
    case 'openai':
      return matchesAny(normalizedModel, OPENAI_VISION_PATTERNS);
    case 'openrouter': {
      const bareModel = stripVendorPrefix(normalizedModel);
      return (
        matchesAny(bareModel, GEMINI_VISION_PATTERNS) ||
        matchesAny(bareModel, ANTHROPIC_VISION_PATTERNS) ||
        matchesAny(bareModel, OPENAI_VISION_PATTERNS) ||
        matchesAny(bareModel, OPEN_MODEL_VISION_PATTERNS)
      );
    }
    case 'groq':
    case 'ollama':
    case 'lmstudio':
      return (
        matchesAny(normalizedModel, GEMINI_VISION_PATTERNS) ||
        matchesAny(normalizedModel, ANTHROPIC_VISION_PATTERNS) ||
        matchesAny(normalizedModel, OPENAI_VISION_PATTERNS) ||
        matchesAny(normalizedModel, OPEN_MODEL_VISION_PATTERNS)
      );
    default:
      return false;
  }
};

// ---------------------------------------------------------------------------
// API 實查(OpenRouter / Ollama / LM Studio)+ 快取
// ---------------------------------------------------------------------------

const CAPABILITY_CACHE_STORAGE_KEY = 'educare_model_vision_capability';
const CAPABILITY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CAPABILITY_QUERY_TIMEOUT_MS = 8000;

interface CachedCapabilityEntry {
  supported: boolean;
  checkedAt: number;
}

type CapabilityCache = Record<string, CachedCapabilityEntry>;

const cacheKeyFor = (provider: string, model: string, baseUrl?: string): string =>
  [provider, baseUrl ?? '', model].join('::');

/** 記憶體層快取:同一 session 內避免重複 JSON parse 與網路查詢。 */
const memoryCapabilityCache = new Map<string, CachedCapabilityEntry>();

/** 清空能力快取(測試用;未來可供「重新偵測」設定按鈕使用)。 */
export const clearModelCapabilityCache = (): void => {
  memoryCapabilityCache.clear();
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(CAPABILITY_CACHE_STORAGE_KEY);
    } catch {
      // ignore
    }
  }
};

const readCapabilityCache = (): CapabilityCache => {
  if (typeof localStorage === 'undefined') {
    return {};
  }
  try {
    const raw = localStorage.getItem(CAPABILITY_CACHE_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as CapabilityCache) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const isFreshEntry = (entry: CachedCapabilityEntry | undefined): entry is CachedCapabilityEntry =>
  !!entry &&
  typeof entry.supported === 'boolean' &&
  Date.now() - entry.checkedAt <= CAPABILITY_CACHE_TTL_MS;

const readCachedCapability = (key: string): boolean | null => {
  const memoryEntry = memoryCapabilityCache.get(key);
  if (isFreshEntry(memoryEntry)) {
    return memoryEntry.supported;
  }

  const storedEntry = readCapabilityCache()[key];
  if (isFreshEntry(storedEntry)) {
    memoryCapabilityCache.set(key, storedEntry);
    return storedEntry.supported;
  }

  return null;
};

const writeCachedCapability = (key: string, supported: boolean): void => {
  memoryCapabilityCache.set(key, { supported, checkedAt: Date.now() });
  if (typeof localStorage === 'undefined') {
    return;
  }
  try {
    const cache = readCapabilityCache();
    const now = Date.now();
    // 順手汰換過期項目,避免快取無限成長。
    const pruned = Object.fromEntries(
      Object.entries(cache).filter(([, entry]) => now - entry.checkedAt <= CAPABILITY_CACHE_TTL_MS),
    );
    pruned[key] = { supported, checkedAt: now };
    localStorage.setItem(CAPABILITY_CACHE_STORAGE_KEY, JSON.stringify(pruned));
  } catch {
    // 快取寫入失敗不影響功能。
  }
};

const buildQuerySignal = (): AbortSignal | undefined =>
  typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal
    ? AbortSignal.timeout(CAPABILITY_QUERY_TIMEOUT_MS)
    : undefined;

/**
 * OpenRouter:公開端點,`architecture.input_modalities` 含 'image' 即支援。
 * 回傳 null 代表查不到(網路錯誤或未列出該模型),由呼叫端退回 pattern。
 */
const queryOpenRouterImageSupport = async (model: string): Promise<boolean | null> => {
  const response = await fetch('https://openrouter.ai/api/v1/models', {
    signal: buildQuerySignal(),
  });
  if (!response.ok) {
    return null;
  }
  const json = (await response.json()) as {
    data?: Array<{ id?: string; architecture?: { input_modalities?: string[] } }>;
  };
  const entry = json.data?.find(item => item.id === model);
  const modalities = entry?.architecture?.input_modalities;
  return Array.isArray(modalities) ? modalities.includes('image') : null;
};

/** Ollama:`POST {baseUrl}/api/show` 的 `capabilities` 陣列含 'vision' 即支援。 */
const queryOllamaImageSupport = async (model: string, baseUrl: string): Promise<boolean | null> => {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/show`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model }),
    signal: buildQuerySignal(),
  });
  if (!response.ok) {
    return null;
  }
  const json = (await response.json()) as { capabilities?: string[] };
  return Array.isArray(json.capabilities) ? json.capabilities.includes('vision') : null;
};

/**
 * LM Studio:`GET {root}/api/v0/models` 的模型 `type === 'vlm'` 即支援。
 * 設定中的 baseUrl 形如 `http://localhost:1234/v1`,REST API 掛在根路徑下。
 */
const queryLmStudioImageSupport = async (
  model: string,
  baseUrl: string,
): Promise<boolean | null> => {
  const root = baseUrl.replace(/\/v1\/?$/, '').replace(/\/$/, '');
  const response = await fetch(`${root}/api/v0/models`, { signal: buildQuerySignal() });
  if (!response.ok) {
    return null;
  }
  const json = (await response.json()) as { data?: Array<{ id?: string; type?: string }> };
  const entry = json.data?.find(item => item.id === model);
  return entry?.type ? entry.type === 'vlm' : null;
};

/**
 * 判斷指定 provider 的模型是否支援圖片輸入。
 * OpenRouter/Ollama/LM Studio 走 API 實查(結果快取 24h),
 * 其餘 provider 或查詢失敗時退回 pattern fallback。
 */
export const resolveModelImageSupport = async (
  provider: string,
  model: string,
  config?: Pick<ProviderConfig, 'baseUrl'>,
): Promise<boolean> => {
  const normalizedModel = model.trim();
  if (!normalizedModel) {
    return false;
  }

  const baseUrl = typeof config?.baseUrl === 'string' ? config.baseUrl : undefined;
  const cacheKey = cacheKeyFor(provider, normalizedModel, baseUrl);
  const cached = readCachedCapability(cacheKey);
  if (cached !== null) {
    return cached;
  }

  let queried: boolean | null = null;
  try {
    switch (provider) {
      case 'openrouter':
        queried = await queryOpenRouterImageSupport(normalizedModel);
        break;
      case 'ollama':
        queried = baseUrl ? await queryOllamaImageSupport(normalizedModel, baseUrl) : null;
        break;
      case 'lmstudio':
        queried = baseUrl ? await queryLmStudioImageSupport(normalizedModel, baseUrl) : null;
        break;
      default:
        queried = null;
    }
  } catch {
    queried = null;
  }

  if (queried !== null) {
    writeCachedCapability(cacheKey, queried);
    return queried;
  }

  return supportsImageInput(provider, normalizedModel);
};

/**
 * 目前作用中模型的圖片輸入支援(同步 pattern 近似值,供初始 render 立即使用;
 * 精確結果請用 resolveActiveModelImageSupport)。
 */
export const activeModelSupportsImageInput = (): boolean => {
  const activeModel = providerManager.getActiveModelInfo();
  if (!activeModel) {
    return false;
  }
  return supportsImageInput(activeModel.provider, activeModel.model);
};

/**
 * 目前作用中模型的圖片輸入支援(API 實查優先)。
 * 設定變更後由 `PROVIDER_SETTINGS_CHANGED_EVENT` 通知 UI 重新解析。
 */
export const resolveActiveModelImageSupport = async (): Promise<boolean> => {
  const activeModel = providerManager.getActiveModelInfo();
  if (!activeModel) {
    return false;
  }
  return resolveModelImageSupport(activeModel.provider, activeModel.model, activeModel.config);
};
