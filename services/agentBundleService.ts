import {
  AgentBundle,
  AgentBundleAgent,
  AgentBundleModelParams,
  AgentBundleRoute,
  Assistant,
  BundleIssue,
  BundleRecord,
  BundleValidationResult,
  EncryptedProviderSettingsEnvelope,
  VersionedAgentBundle,
} from '../types';

export const AGENT_BUNDLE_FORMAT = 'educare-agent-bundle';
export const AGENT_BUNDLE_SCHEMA_VERSION = 1;
export const AGENT_BUNDLE_ENCRYPTED_SCHEMA_VERSION = 2;
export const AGENT_BUNDLE_MAX_AGENTS = 20;
export const AGENT_BUNDLE_MAX_SIZE_BYTES = 15 * 1024 * 1024;
export const AGENT_BUNDLE_LARGE_FILE_BYTES = 2 * 1024 * 1024;

const MAX_NAME_LENGTH = 200;
const MAX_SYSTEM_PROMPT_LENGTH = 100_000;
const MAX_CHUNK_CONTENT_LENGTH = 50_000;
const MAX_ICON_LENGTH = 8;

export interface AgentBundleMetadata {
  name: string;
  description: string;
  version: string;
}

const issue = (code: BundleIssue['code'], message: string, nextStep: string): BundleIssue => ({
  code,
  message,
  nextStep,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).every(key => keys.includes(key)) && keys.every(key => key in value);

const isBase64Url = (value: unknown, maxLength: number, minLength = 1): value is string =>
  typeof value === 'string' &&
  value.length >= minLength &&
  value.length <= maxLength &&
  /^[A-Za-z0-9_-]+$/.test(value);

const parseEncryptedProviderSettings = (
  raw: unknown,
  errors: BundleIssue[],
): EncryptedProviderSettingsEnvelope | undefined => {
  if (
    !isRecord(raw) ||
    !hasExactKeys(raw, ['v', 'algorithm', 'kdf', 'salt', 'iv', 'ciphertext']) ||
    raw.v !== 1 ||
    raw.algorithm !== 'AES-GCM' ||
    !isRecord(raw.kdf) ||
    !hasExactKeys(raw.kdf, ['name', 'hash', 'iterations']) ||
    raw.kdf.name !== 'PBKDF2' ||
    raw.kdf.hash !== 'SHA-256' ||
    raw.kdf.iterations !== 100_000 ||
    !isBase64Url(raw.salt, 22, 22) ||
    !isBase64Url(raw.iv, 16, 16) ||
    !isBase64Url(raw.ciphertext, 16_384, 16)
  ) {
    errors.push(
      issue(
        'missing-field',
        'encryptedProviderSettings 格式錯誤。',
        '請重新向創作者索取有效的協作包。',
      ),
    );
    return undefined;
  }

  return {
    v: 1,
    algorithm: 'AES-GCM',
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 100_000 },
    salt: raw.salt,
    iv: raw.iv,
    ciphertext: raw.ciphertext,
  };
};

const sanitizeFileName = (name: string): string => {
  const cleaned = Array.from(name.trim())
    .map(char => {
      const code = char.charCodeAt(0);
      return /[<>:"/\\|?*]/.test(char) || (code >= 0 && code <= 31) ? '-' : char;
    })
    .join('')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return cleaned || 'agent-bundle';
};

const bytesFor = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).length;

const removeImportedBundleNamespace = (id: string, importedBundleId?: string): string => {
  const prefix = importedBundleId ? `${importedBundleId}:` : '';
  return prefix && id.startsWith(prefix) ? id.slice(prefix.length) : id;
};

export const getBundleContentFingerprint = async (
  bundle: VersionedAgentBundle,
  importedBundleId?: string,
): Promise<string> => {
  const publicContent = {
    manifest: {
      format: bundle.manifest.format,
      schemaVersion: bundle.manifest.schemaVersion,
      name: bundle.manifest.name,
      description: bundle.manifest.description,
      version: bundle.manifest.version,
      exportedAt: bundle.manifest.exportedAt,
      entryAgentId: removeImportedBundleNamespace(bundle.manifest.entryAgentId, importedBundleId),
    },
    agents: bundle.agents.map(agent => ({
      id: removeImportedBundleNamespace(agent.id, importedBundleId),
      name: agent.name,
      description: agent.description,
      systemPrompt: agent.systemPrompt,
      starterPrompts: agent.starterPrompts,
      ragChunks: agent.ragChunks.map(({ fileName, content }) => ({ fileName, content })),
      ...(agent.icon === undefined ? {} : { icon: agent.icon }),
      ...(agent.modelParams === undefined ? {} : { modelParams: agent.modelParams }),
    })),
    routes: bundle.routes.map(route => ({
      fromAgentId: removeImportedBundleNamespace(route.fromAgentId, importedBundleId),
      toAgentId: removeImportedBundleNamespace(route.toAgentId, importedBundleId),
      ...(route.condition === undefined ? {} : { condition: route.condition }),
    })),
  };
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(publicContent)),
  );
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
};

export const estimateBundleSize = (bundle: VersionedAgentBundle): number => bytesFor(bundle);

const validateString = (
  value: unknown,
  field: string,
  maxLength: number | undefined,
  errors: BundleIssue[],
): value is string => {
  if (typeof value !== 'string') {
    errors.push(
      issue('missing-field', `${field} 必須是文字。`, '請重新向創作者索取有效的協作包。'),
    );
    return false;
  }
  if (maxLength !== undefined && value.length > maxLength) {
    errors.push(issue('oversize', `${field} 超過允許的長度。`, '請請創作者縮短內容後重新匯出。'));
    return false;
  }
  return true;
};

const validateModelParams = (
  raw: unknown,
  errors: BundleIssue[],
): AgentBundleModelParams | undefined => {
  if (raw === undefined) {
    return undefined;
  }
  if (!isRecord(raw)) {
    errors.push(
      issue('missing-field', 'modelParams 格式錯誤。', '請重新向創作者索取有效的協作包。'),
    );
    return undefined;
  }

  const params: AgentBundleModelParams = {};
  if (raw.temperature !== undefined) {
    if (typeof raw.temperature !== 'number' || !Number.isFinite(raw.temperature)) {
      errors.push(
        issue('missing-field', 'modelParams.temperature 必須是數字。', '請修正協作包後重新匯出。'),
      );
    } else {
      params.temperature = raw.temperature;
    }
  }
  if (raw.maxOutputTokens !== undefined) {
    if (typeof raw.maxOutputTokens !== 'number' || !Number.isFinite(raw.maxOutputTokens)) {
      errors.push(
        issue(
          'missing-field',
          'modelParams.maxOutputTokens 必須是數字。',
          '請修正協作包後重新匯出。',
        ),
      );
    } else {
      params.maxOutputTokens = raw.maxOutputTokens;
    }
  }

  return params;
};

const parseAgent = (
  raw: unknown,
  index: number,
  errors: BundleIssue[],
): AgentBundleAgent | null => {
  const label = `agents[${index}]`;
  if (!isRecord(raw)) {
    errors.push(
      issue('missing-field', `${label} 必須是物件。`, '請重新向創作者索取有效的協作包。'),
    );
    return null;
  }

  const validId = validateString(raw.id, `${label}.id`, undefined, errors);
  const validName = validateString(raw.name, `${label}.name`, MAX_NAME_LENGTH, errors);
  const validDescription = validateString(
    raw.description,
    `${label}.description`,
    undefined,
    errors,
  );
  const validPrompt = validateString(
    raw.systemPrompt,
    `${label}.systemPrompt`,
    MAX_SYSTEM_PROMPT_LENGTH,
    errors,
  );
  if (
    !Array.isArray(raw.starterPrompts) ||
    !raw.starterPrompts.every(prompt => typeof prompt === 'string')
  ) {
    errors.push(
      issue(
        'missing-field',
        `${label}.starterPrompts 必須是文字陣列。`,
        '請修正協作包後重新匯出。',
      ),
    );
  }
  if (!Array.isArray(raw.ragChunks)) {
    errors.push(
      issue('missing-field', `${label}.ragChunks 必須是陣列。`, '請修正協作包後重新匯出。'),
    );
  }

  const chunks = Array.isArray(raw.ragChunks)
    ? raw.ragChunks.map((chunk, chunkIndex) => {
        if (!isRecord(chunk)) {
          errors.push(
            issue(
              'missing-field',
              `${label}.ragChunks[${chunkIndex}] 必須是物件。`,
              '請修正協作包後重新匯出。',
            ),
          );
          return null;
        }
        const validFileName = validateString(
          chunk.fileName,
          `${label}.ragChunks[${chunkIndex}].fileName`,
          undefined,
          errors,
        );
        const validContent = validateString(
          chunk.content,
          `${label}.ragChunks[${chunkIndex}].content`,
          MAX_CHUNK_CONTENT_LENGTH,
          errors,
        );
        return validFileName && validContent
          ? { fileName: chunk.fileName, content: chunk.content }
          : null;
      })
    : [];

  let icon: string | undefined;
  if (raw.icon !== undefined) {
    if (validateString(raw.icon, `${label}.icon`, MAX_ICON_LENGTH, errors)) {
      icon = raw.icon;
    }
  }
  const modelParams = validateModelParams(raw.modelParams, errors);

  if (
    !validId ||
    !validName ||
    !validDescription ||
    !validPrompt ||
    !Array.isArray(raw.starterPrompts) ||
    !raw.starterPrompts.every(prompt => typeof prompt === 'string') ||
    !Array.isArray(raw.ragChunks) ||
    chunks.some(chunk => chunk === null)
  ) {
    return null;
  }

  return {
    id: raw.id as string,
    name: raw.name as string,
    description: raw.description as string,
    systemPrompt: raw.systemPrompt as string,
    starterPrompts: raw.starterPrompts as string[],
    ragChunks: chunks.filter(
      (chunk): chunk is { fileName: string; content: string } => chunk !== null,
    ),
    ...(icon === undefined ? {} : { icon }),
    ...(modelParams === undefined ? {} : { modelParams }),
  };
};

const parseRoute = (
  raw: unknown,
  index: number,
  errors: BundleIssue[],
): AgentBundleRoute | null => {
  const label = `routes[${index}]`;
  if (!isRecord(raw)) {
    errors.push(issue('missing-field', `${label} 必須是物件。`, '請修正協作包後重新匯出。'));
    return null;
  }

  const validFrom = validateString(raw.fromAgentId, `${label}.fromAgentId`, undefined, errors);
  const validTo = validateString(raw.toAgentId, `${label}.toAgentId`, undefined, errors);
  let condition: string | undefined;
  if (raw.condition !== undefined) {
    if (validateString(raw.condition, `${label}.condition`, undefined, errors)) {
      condition = raw.condition;
    }
  }

  return validFrom && validTo && (raw.condition === undefined || condition !== undefined)
    ? {
        fromAgentId: raw.fromAgentId as string,
        toAgentId: raw.toAgentId as string,
        ...(condition === undefined ? {} : { condition }),
      }
    : null;
};

export const validateBundle = (raw: unknown): BundleValidationResult => {
  const errors: BundleIssue[] = [];
  const warnings: BundleIssue[] = [];

  if (!isRecord(raw)) {
    return {
      bundle: null,
      errors: [
        issue('not-a-bundle', '這不是有效的 EduCare 協作包。', '請重新向創作者索取協作包檔案。'),
      ],
      warnings,
    };
  }

  if (bytesFor(raw) > AGENT_BUNDLE_MAX_SIZE_BYTES) {
    errors.push(
      issue('oversize', '協作包超過 15MB 上限。', '請請創作者移除部分知識庫內容後重新匯出。'),
    );
  }

  if (!isRecord(raw.manifest) || raw.manifest.format !== AGENT_BUNDLE_FORMAT) {
    errors.push(issue('not-a-bundle', '這不是 EduCare 協作包。', '請重新向創作者索取協作包檔案。'));
    return { bundle: null, errors, warnings };
  }

  const manifestRaw = raw.manifest;
  const schemaVersion = manifestRaw.schemaVersion;
  if (
    schemaVersion !== AGENT_BUNDLE_SCHEMA_VERSION &&
    schemaVersion !== AGENT_BUNDLE_ENCRYPTED_SCHEMA_VERSION
  ) {
    errors.push(
      typeof schemaVersion === 'number' && schemaVersion > AGENT_BUNDLE_ENCRYPTED_SCHEMA_VERSION
        ? issue('schema-too-new', '此協作包版本較新。', '請更新 EduCare 後再匯入。')
        : issue('not-a-bundle', '此協作包版本不受支援。', '請向創作者索取有效的協作包。'),
    );
  }

  const validName = validateString(manifestRaw.name, 'manifest.name', MAX_NAME_LENGTH, errors);
  const validDescription = validateString(
    manifestRaw.description,
    'manifest.description',
    undefined,
    errors,
  );
  const validVersion = validateString(manifestRaw.version, 'manifest.version', undefined, errors);
  const validEntryAgentId = validateString(
    manifestRaw.entryAgentId,
    'manifest.entryAgentId',
    undefined,
    errors,
  );
  const validExportedAt =
    typeof manifestRaw.exportedAt === 'number' && Number.isFinite(manifestRaw.exportedAt);
  if (!validExportedAt) {
    errors.push(
      issue('missing-field', 'manifest.exportedAt 必須是數字。', '請修正協作包後重新匯出。'),
    );
  }

  const encryptedProviderSettings =
    schemaVersion === AGENT_BUNDLE_ENCRYPTED_SCHEMA_VERSION &&
    raw.encryptedProviderSettings !== undefined
      ? parseEncryptedProviderSettings(raw.encryptedProviderSettings, errors)
      : undefined;

  if (!Array.isArray(raw.agents)) {
    errors.push(issue('missing-field', 'agents 必須是陣列。', '請修正協作包後重新匯出。'));
  } else if (raw.agents.length === 0) {
    errors.push(issue('missing-field', '協作包至少需要一位助理。', '請重新選取助理後匯出。'));
  } else if (raw.agents.length > AGENT_BUNDLE_MAX_AGENTS) {
    errors.push(issue('oversize', '協作包最多可包含 20 位助理。', '請減少助理數量後重新匯出。'));
  }

  const agents = Array.isArray(raw.agents)
    ? raw.agents
        .map((agent, index) => parseAgent(agent, index, errors))
        .filter((agent): agent is AgentBundleAgent => agent !== null)
    : [];

  const ids = new Set<string>();
  for (const agent of agents) {
    if (ids.has(agent.id)) {
      errors.push(
        issue('missing-field', `助理 id「${agent.id}」重複。`, '請為每位助理設定不同的 id。'),
      );
    }
    ids.add(agent.id);
    if (!agent.systemPrompt.trim()) {
      warnings.push(
        issue(
          'empty-prompt',
          `助理「${agent.name}」沒有 system prompt。`,
          '建議補上角色與回應規則。',
        ),
      );
    }
  }

  if (!Array.isArray(raw.routes)) {
    errors.push(issue('missing-field', 'routes 必須是陣列。', '請修正協作包後重新匯出。'));
  }
  const routes = Array.isArray(raw.routes)
    ? raw.routes
        .map((route, index) => parseRoute(route, index, errors))
        .filter((route): route is AgentBundleRoute => route !== null)
    : [];

  if (validEntryAgentId && !ids.has(manifestRaw.entryAgentId as string)) {
    errors.push(issue('dangling-route', '入口助理不存在於 agents。', '請選擇協作包中的入口助理。'));
  }
  for (const route of routes) {
    if (!ids.has(route.fromAgentId) || !ids.has(route.toAgentId)) {
      errors.push(
        issue('dangling-route', '路由指向不存在的助理。', '請移除無效路由或加入目標助理。'),
      );
    }
  }
  if (agents.length > 1) {
    for (const agent of agents) {
      if (!routes.some(route => route.fromAgentId === agent.id || route.toAgentId === agent.id)) {
        warnings.push(
          issue(
            'dangling-route',
            `助理「${agent.name}」沒有任何路由。`,
            '建議設定路由，或確認此助理應獨立存在。',
          ),
        );
      }
    }
  }

  if (
    errors.length > 0 ||
    (schemaVersion !== AGENT_BUNDLE_SCHEMA_VERSION &&
      schemaVersion !== AGENT_BUNDLE_ENCRYPTED_SCHEMA_VERSION) ||
    !validName ||
    !validDescription ||
    !validVersion ||
    !validEntryAgentId ||
    !validExportedAt ||
    agents.length !== (Array.isArray(raw.agents) ? raw.agents.length : 0) ||
    routes.length !== (Array.isArray(raw.routes) ? raw.routes.length : 0)
  ) {
    return { bundle: null, errors, warnings };
  }

  const manifestBase = {
    format: AGENT_BUNDLE_FORMAT as 'educare-agent-bundle',
    name: manifestRaw.name as string,
    description: manifestRaw.description as string,
    version: manifestRaw.version as string,
    exportedAt: manifestRaw.exportedAt as number,
    entryAgentId: manifestRaw.entryAgentId as string,
  };

  const bundle: VersionedAgentBundle =
    schemaVersion === AGENT_BUNDLE_SCHEMA_VERSION
      ? {
          manifest: { ...manifestBase, schemaVersion: AGENT_BUNDLE_SCHEMA_VERSION },
          agents,
          routes,
        }
      : {
          manifest: {
            ...manifestBase,
            schemaVersion: AGENT_BUNDLE_ENCRYPTED_SCHEMA_VERSION,
          },
          agents,
          routes,
          ...(encryptedProviderSettings === undefined ? {} : { encryptedProviderSettings }),
        };

  return { bundle, errors, warnings };
};

export const buildAgentBundle = (
  assistants: Assistant[],
  entryAgentId: string,
  routes: AgentBundleRoute[],
  metadata: AgentBundleMetadata,
): AgentBundle => ({
  manifest: {
    format: AGENT_BUNDLE_FORMAT as 'educare-agent-bundle',
    schemaVersion: AGENT_BUNDLE_SCHEMA_VERSION,
    name: metadata.name,
    description: metadata.description,
    version: metadata.version,
    exportedAt: Date.now(),
    entryAgentId,
  },
  agents: assistants.map(assistant => ({
    id: assistant.id,
    name: assistant.name,
    description: assistant.description ?? '',
    systemPrompt: assistant.systemPrompt ?? '',
    starterPrompts: assistant.starterPrompts ?? [],
    ragChunks: (assistant.ragChunks ?? []).map(({ fileName, content }) => ({ fileName, content })),
  })),
  routes: routes.map(({ fromAgentId, toAgentId, condition }) => ({
    fromAgentId,
    toAgentId,
    ...(condition === undefined ? {} : { condition }),
  })),
});

export const serializeBundle = (bundle: VersionedAgentBundle): string =>
  JSON.stringify(bundle, null, 2);

export const downloadBundleJson = (bundle: VersionedAgentBundle): string => {
  const fileName = `${sanitizeFileName(bundle.manifest.name)}.educare-bundle.json`;
  const blob = new globalThis.Blob([serializeBundle(bundle)], { type: 'application/json' });
  const objectUrl = URL.createObjectURL(blob);

  try {
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = fileName;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }

  return fileName;
};

export const parseBundleText = (text: string): BundleValidationResult => {
  if (new TextEncoder().encode(text).length > AGENT_BUNDLE_MAX_SIZE_BYTES) {
    return {
      bundle: null,
      errors: [issue('oversize', '協作包超過 15MB 上限。', '請以較小的協作包重新匯入。')],
      warnings: [],
    };
  }

  try {
    return validateBundle(JSON.parse(text));
  } catch {
    return {
      bundle: null,
      errors: [
        issue(
          'corrupted-json',
          'JSON 無法解析，檔案可能已損毀。',
          '請重新向創作者索取檔案，或確認貼上內容完整。',
        ),
      ],
      warnings: [],
    };
  }
};

export const parseBundleFile = async (file: File): Promise<BundleValidationResult> => {
  if (file.size > AGENT_BUNDLE_MAX_SIZE_BYTES) {
    return {
      bundle: null,
      errors: [issue('oversize', '協作包超過 15MB 上限。', '請以較小的協作包重新匯入。')],
      warnings: [],
    };
  }
  return parseBundleText(await file.text());
};

export const buildImportedBundle = (bundle: VersionedAgentBundle): BundleRecord => {
  const id = crypto.randomUUID();
  const namespacedIds = new Map(bundle.agents.map(agent => [agent.id, `${id}:${agent.id}`]));
  const importedBase = {
    agents: bundle.agents.map(agent => ({
      id: namespacedIds.get(agent.id)!,
      name: agent.name,
      description: agent.description,
      systemPrompt: agent.systemPrompt,
      starterPrompts: [...agent.starterPrompts],
      ragChunks: agent.ragChunks.map(({ fileName, content }) => ({ fileName, content })),
      ...(agent.icon === undefined ? {} : { icon: agent.icon }),
      ...(agent.modelParams === undefined ? {} : { modelParams: { ...agent.modelParams } }),
    })),
    routes: bundle.routes.map(route => ({
      fromAgentId: namespacedIds.get(route.fromAgentId)!,
      toAgentId: namespacedIds.get(route.toAgentId)!,
      ...(route.condition === undefined ? {} : { condition: route.condition }),
    })),
  };
  const manifestBase = {
    format: AGENT_BUNDLE_FORMAT as 'educare-agent-bundle',
    name: bundle.manifest.name,
    description: bundle.manifest.description,
    version: bundle.manifest.version,
    exportedAt: bundle.manifest.exportedAt,
    entryAgentId: namespacedIds.get(bundle.manifest.entryAgentId)!,
  };
  const importedBundle: VersionedAgentBundle =
    bundle.manifest.schemaVersion === AGENT_BUNDLE_SCHEMA_VERSION
      ? {
          manifest: { ...manifestBase, schemaVersion: AGENT_BUNDLE_SCHEMA_VERSION },
          ...importedBase,
        }
      : {
          manifest: {
            ...manifestBase,
            schemaVersion: AGENT_BUNDLE_ENCRYPTED_SCHEMA_VERSION,
          },
          ...importedBase,
          ...(bundle.encryptedProviderSettings === undefined
            ? {}
            : {
                encryptedProviderSettings: {
                  ...bundle.encryptedProviderSettings,
                  kdf: { ...bundle.encryptedProviderSettings.kdf },
                },
              }),
        };

  return {
    id,
    bundle: importedBundle,
    importedAt: Date.now(),
    sizeBytes: estimateBundleSize(importedBundle),
  };
};
