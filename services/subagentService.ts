import type {
  ChatMessage,
  HtmlProjectToolPackName,
  HtmlProjectWorkspaceUpdate,
  RagChunk,
  SubagentActivityUpdate,
  SubagentRunRecord,
  SubagentTaskSpec,
  TokenUsageTotals,
} from '../types';
import type { ProviderUsageMetadata, ToolCall, ToolDefinition } from './llmAdapter';
import {
  executeHtmlProjectToolCall,
  getHtmlProjectToolDefinitionsForPacks,
  HTML_PROJECT_WRITE_PACK_NAMES,
} from './htmlProjectToolService';
import {
  buildKnowledgeSearchResponse,
  hasKnowledgeChunks,
  KNOWLEDGE_SEARCH_SYSTEM_PROMPT,
  KNOWLEDGE_SEARCH_TOOL_DESCRIPTION,
  KNOWLEDGE_SEARCH_TOOL_NAME,
  KNOWLEDGE_SEARCH_TOOL_SCHEMA,
} from './knowledgeSearchService';
import { buildHtmlProjectSystemPrompt } from './htmlProjectPrompting';
import { htmlProjectStore } from './htmlProjectStore';
import { initializeProviders, providerManager } from './providerRegistry';

const MAX_SUBAGENT_BATCH_SIZE = 4;
const DEFAULT_SUBAGENT_MAX_TOOL_ROUNDS = 8;
const MIN_SUBAGENT_MAX_TOOL_ROUNDS = 1;
const MAX_SUBAGENT_MAX_TOOL_ROUNDS = 20;
const MAX_SUBAGENT_OUTPUT_CHARS = 8_000;
const MAX_PROJECT_FILE_INJECTION_CHARS = 24_000;
const SUBAGENT_HTML_TOOL_EXCLUSIONS = new Set([
  'reportTurnOutcome',
  'getPreviewRuntimeErrors',
  'listSnapshots',
  'revertToSnapshot',
]);

export interface RecoverableToolErrorResult {
  ok: false;
  recoverable: true;
  code: string;
  message: string;
  guidance: string;
  details?: Record<string, unknown>;
}

export interface SubagentBatchResult {
  ok: true;
  batchId: string;
  results: Array<{
    name: string;
    status: SubagentRunRecord['status'];
    output: string;
    toolSequence: string[];
    truncated?: boolean;
    error?: string;
  }>;
  usageTotals?: TokenUsageTotals;
}

interface SubagentExecutionEnv {
  assistantId: string;
  sessionId?: string | null;
  activeProjectId?: string | null;
  history: ChatMessage[];
  knowledgeChunks?: RagChunk[];
  signal?: AbortSignal;
}

interface SubagentExecutionCallbacks {
  onActivity?: (update: SubagentActivityUpdate) => void;
  onProjectToolActivity?: (update: HtmlProjectWorkspaceUpdate) => void;
}

interface BuiltSubagentTools {
  tools: ToolDefinition[];
  executeTool?: (call: ToolCall) => Promise<unknown>;
  extraSystemPrompt?: string;
}

const createRecoverableToolError = (
  code: string,
  message: string,
  guidance: string,
  details?: Record<string, unknown>,
): RecoverableToolErrorResult => ({
  ok: false,
  recoverable: true,
  code,
  message,
  guidance,
  details,
});

const clampToolRounds = (value?: number): number => {
  const rounded = Math.round(Number(value ?? DEFAULT_SUBAGENT_MAX_TOOL_ROUNDS));
  if (!Number.isFinite(rounded)) {
    return DEFAULT_SUBAGENT_MAX_TOOL_ROUNDS;
  }
  return Math.min(MAX_SUBAGENT_MAX_TOOL_ROUNDS, Math.max(MIN_SUBAGENT_MAX_TOOL_ROUNDS, rounded));
};

const createBatchId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `subagent-batch-${Date.now()}`;
};

const createRunId = (batchId: string, index: number): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${batchId}-run-${index + 1}`;
};

const serializeHistoryMessages = (history: ChatMessage[]): string => {
  return history
    .map((message, index) => `${index + 1}. [${message.role}] ${message.content}`)
    .join('\n');
};

const truncateOutput = (
  output: string,
): {
  output: string;
  truncated: boolean;
} => {
  if (output.length <= MAX_SUBAGENT_OUTPUT_CHARS) {
    return { output, truncated: false };
  }

  return {
    output: `${output.slice(0, MAX_SUBAGENT_OUTPUT_CHARS)}\n\n[truncated after ${MAX_SUBAGENT_OUTPUT_CHARS} characters]`,
    truncated: true,
  };
};

const addOptional = (current?: number, delta?: number): number | undefined => {
  if (typeof current === 'undefined' && typeof delta === 'undefined') {
    return undefined;
  }
  return (current ?? 0) + (delta ?? 0);
};

const mergeTokenUsageTotals = (
  current: TokenUsageTotals | undefined,
  delta: TokenUsageTotals | undefined,
): TokenUsageTotals | undefined => {
  if (!delta) {
    return current;
  }

  return {
    inputTokens: (current?.inputTokens ?? 0) + delta.inputTokens,
    outputTokens: (current?.outputTokens ?? 0) + delta.outputTokens,
    totalTokens: (current?.totalTokens ?? 0) + delta.totalTokens,
    cacheCreationInputTokens: addOptional(
      current?.cacheCreationInputTokens,
      delta.cacheCreationInputTokens,
    ),
    cacheReadInputTokens: addOptional(current?.cacheReadInputTokens, delta.cacheReadInputTokens),
    cachedInputTokens: addOptional(current?.cachedInputTokens, delta.cachedInputTokens),
    reasoningTokens: addOptional(current?.reasoningTokens, delta.reasoningTokens),
    toolUseTokens: addOptional(current?.toolUseTokens, delta.toolUseTokens),
  };
};

const normalizeSubagentSpec = (spec: SubagentTaskSpec): SubagentTaskSpec => ({
  ...spec,
  includeHistoryLastN:
    typeof spec.includeHistoryLastN === 'number' && spec.includeHistoryLastN > 0
      ? Math.max(0, Math.floor(spec.includeHistoryLastN))
      : undefined,
  htmlPacks: spec.htmlPacks ? [...spec.htmlPacks] : undefined,
  includeProjectFiles: spec.includeProjectFiles ? [...spec.includeProjectFiles] : undefined,
  maxToolRounds: clampToolRounds(spec.maxToolRounds),
});

export const validateSubagentBatch = (
  specs: SubagentTaskSpec[],
  env: { activeProjectId?: string | null },
): RecoverableToolErrorResult | null => {
  if (!Array.isArray(specs) || specs.length === 0) {
    return createRecoverableToolError(
      'subagent-batch-empty',
      'delegateToSubagents requires at least one task.',
      'Retry with 1 to 4 well-scoped subagent tasks.',
    );
  }

  if (specs.length > MAX_SUBAGENT_BATCH_SIZE) {
    return createRecoverableToolError(
      'subagent-batch-too-large',
      `delegateToSubagents accepts at most ${MAX_SUBAGENT_BATCH_SIZE} tasks per batch.`,
      'Retry with 1 to 4 tasks, or split the work into multiple sequential delegate calls.',
      { requestedTaskCount: specs.length },
    );
  }

  let writerCount = 0;
  const writerPackNames = new Set<HtmlProjectToolPackName>(
    HTML_PROJECT_WRITE_PACK_NAMES.filter(pack => pack !== 'bootstrap'),
  );

  for (const spec of specs) {
    const htmlPacks = spec.htmlPacks ?? [];

    if (htmlPacks.includes('bootstrap')) {
      return createRecoverableToolError(
        'subagent-bootstrap-forbidden',
        'Subagents cannot use the bootstrap HTML pack.',
        'Retry without bootstrap; subagents may only inspect or modify the already active project.',
        { taskName: spec.name, htmlPacks },
      );
    }

    if ((spec.includeProjectFiles?.length ?? 0) > 0 && !env.activeProjectId) {
      return createRecoverableToolError(
        'subagent-project-files-requires-active-project',
        'includeProjectFiles requires an active HTML project.',
        'Retry without includeProjectFiles, or first ensure the main assistant has an active project open.',
        { taskName: spec.name, requestedFiles: spec.includeProjectFiles },
      );
    }

    if (htmlPacks.some(pack => writerPackNames.has(pack))) {
      writerCount += 1;
    }
  }

  if (writerCount > 1) {
    return createRecoverableToolError(
      'subagent-multiple-writers',
      'Only one subagent task in a batch may request HTML write-capable packs.',
      'Retry with a single writer task and keep the remaining tasks read-only, or split the work into multiple delegate calls.',
      {
        writePackNames: [...writerPackNames],
        writerTaskCount: writerCount,
      },
    );
  }

  return null;
};

export const buildSubagentMessage = async (
  spec: SubagentTaskSpec,
  env: {
    history: ChatMessage[];
    assistantId: string;
    activeProjectId?: string | null;
  },
): Promise<string> => {
  const sections: string[] = [`# Task\n${spec.task}`];

  if (spec.context?.trim()) {
    sections.push(`# Additional context\n${spec.context.trim()}`);
  }

  if ((spec.includeHistoryLastN ?? 0) > 0) {
    const history = env.history
      .filter(message => !message.synthetic)
      .slice(-1 * (spec.includeHistoryLastN ?? 0));
    if (history.length > 0) {
      sections.push(`# Recent conversation history\n${serializeHistoryMessages(history)}`);
    }
  }

  if ((spec.includeProjectFiles?.length ?? 0) > 0 && env.activeProjectId) {
    await htmlProjectStore.assertProjectOwnership(env.activeProjectId, env.assistantId);

    const fileBlocks: string[] = [];
    let remainingChars = MAX_PROJECT_FILE_INJECTION_CHARS;

    for (const path of spec.includeProjectFiles ?? []) {
      if (remainingChars <= 0) {
        fileBlocks.push(
          '[additional requested files omitted after reaching the project-file context limit]',
        );
        break;
      }

      const file = await htmlProjectStore.readFile(env.activeProjectId, path);
      if (!file) {
        fileBlocks.push(`## ${path}\n[file not found in active project]`);
        continue;
      }

      const header = `## ${file.path}`;
      const body =
        file.content.length > remainingChars ? file.content.slice(0, remainingChars) : file.content;
      const wasTruncated = body.length < file.content.length;
      fileBlocks.push(
        `${header}\n\n\`\`\`${file.kind}\n${body}\n\`\`\`${wasTruncated ? '\n[truncated to fit context window]' : ''}`,
      );
      remainingChars -= body.length;
    }

    if (fileBlocks.length > 0) {
      sections.push(`# Project files\n${fileBlocks.join('\n\n')}`);
    }
  }

  return sections.join('\n\n');
};

export const buildSubagentTools = (
  spec: SubagentTaskSpec,
  env: {
    assistantId: string;
    sessionId?: string | null;
    activeProjectId?: string | null;
    knowledgeChunks?: RagChunk[];
  },
  callbacks?: {
    onProjectToolActivity?: (update: HtmlProjectWorkspaceUpdate) => void;
    onToolCall?: (toolName: string) => void;
  },
): BuiltSubagentTools => {
  const tools: ToolDefinition[] = [];
  const extraPrompts: string[] = [];
  const executors: Array<(call: ToolCall) => Promise<unknown | typeof NO_TOOL_RESULT>> = [];

  if (spec.allowKnowledgeSearch && hasKnowledgeChunks(env.knowledgeChunks)) {
    tools.push({
      name: KNOWLEDGE_SEARCH_TOOL_NAME,
      description: KNOWLEDGE_SEARCH_TOOL_DESCRIPTION,
      parameters: KNOWLEDGE_SEARCH_TOOL_SCHEMA,
    });
    extraPrompts.push(KNOWLEDGE_SEARCH_SYSTEM_PROMPT);
    executors.push(async call => {
      if (call.name !== KNOWLEDGE_SEARCH_TOOL_NAME) {
        return NO_TOOL_RESULT;
      }
      callbacks?.onToolCall?.(call.name);
      return buildKnowledgeSearchResponse(
        env.knowledgeChunks ?? [],
        call.args as { query: string },
      );
    });
  }

  if ((spec.htmlPacks?.length ?? 0) > 0) {
    const htmlDefinitions = getHtmlProjectToolDefinitionsForPacks(spec.htmlPacks ?? []).filter(
      tool => !SUBAGENT_HTML_TOOL_EXCLUSIONS.has(tool.name),
    );
    tools.push(...htmlDefinitions);
    extraPrompts.push(
      buildHtmlProjectSystemPrompt({
        activeProjectId: env.activeProjectId ?? null,
        intentDecision: {
          intent: 'uncertain',
          confidence: 'high',
          selectedPackSet: spec.htmlPacks ?? [],
          reason: 'Subagent requested a restricted HTML project tool subset.',
          requiresSummaryPreflight: false,
        },
        projectSummary: null,
      }),
    );
    extraPrompts.push(
      `Only the following HTML project tools are actually available to you in this subagent: ${htmlDefinitions
        .map(tool => tool.name)
        .join(
          ', ',
        )}. Harness-resident tools such as reportTurnOutcome, getPreviewRuntimeErrors, listSnapshots, and revertToSnapshot are not available inside subagents.`,
    );
    const visibleHtmlToolNames = new Set(htmlDefinitions.map(tool => tool.name));
    executors.push(async call => {
      if (!visibleHtmlToolNames.has(call.name)) {
        return NO_TOOL_RESULT;
      }
      callbacks?.onToolCall?.(call.name);
      const toolResult = await executeHtmlProjectToolCall(call, {
        assistantId: env.assistantId,
        sessionId: env.sessionId,
        activeProjectId: env.activeProjectId ?? null,
      });
      callbacks?.onProjectToolActivity?.(toolResult.workspace);
      return {
        ...toolResult.result,
        summary: toolResult.summary,
      };
    });
  }

  const executeTool =
    executors.length > 0
      ? async (call: ToolCall): Promise<unknown> => {
          for (const executor of executors) {
            const result = await executor(call);
            if (result !== NO_TOOL_RESULT) {
              return result;
            }
          }

          return createRecoverableToolError(
            'subagent-tool-not-visible',
            `Tool ${call.name} is not visible to this subagent.`,
            'Retry using only the tools assigned to this subagent task.',
            {
              toolName: call.name,
              visibleToolNames: tools.map(tool => tool.name),
            },
          );
        }
      : undefined;

  return {
    tools,
    executeTool,
    extraSystemPrompt: extraPrompts.filter(Boolean).join('\n\n') || undefined,
  };
};

const NO_TOOL_RESULT = Symbol('no-subagent-tool-result');

export const toTokenUsageTotals = (usage?: ProviderUsageMetadata): TokenUsageTotals | undefined => {
  if (!usage || usage.source !== 'api') {
    return undefined;
  }

  return {
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    totalTokens: usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
    cacheCreationInputTokens: usage.cacheCreationInputTokens,
    cacheReadInputTokens: usage.cacheReadInputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    reasoningTokens: usage.reasoningTokens,
    toolUseTokens: usage.toolUseTokens,
  };
};

const emitActivity = (
  batchId: string,
  runs: SubagentRunRecord[],
  callback?: (update: SubagentActivityUpdate) => void,
): void => {
  callback?.({
    batchId,
    runs: runs.map(run => ({
      ...run,
      toolSequence: [...run.toolSequence],
      tokenUsage: run.tokenUsage ? { ...run.tokenUsage } : undefined,
    })),
  });
};

export const buildSubagentDelegationToolDefinition = (): ToolDefinition => ({
  name: SUBAGENT_DELEGATE_TOOL_NAME,
  description:
    'Delegate 1 to 4 well-scoped tasks to parallel subagents. Each task may be text-only, knowledge-search-enabled, or assigned a restricted HTML project pack subset. bootstrap is forbidden, and at most one task per batch may request write-capable HTML packs.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      tasks: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_SUBAGENT_BATCH_SIZE,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string' },
            systemPrompt: { type: 'string' },
            task: { type: 'string' },
            context: { type: 'string' },
            includeHistoryLastN: { type: 'number' },
            allowKnowledgeSearch: { type: 'boolean' },
            includeProjectFiles: {
              type: 'array',
              items: { type: 'string' },
            },
            htmlPacks: {
              type: 'array',
              items: {
                type: 'string',
                enum: ['bootstrap', 'inspect', 'edit', 'todo_finalize', 'preview_recheck'],
              },
            },
            maxToolRounds: { type: 'number' },
          },
          required: ['name', 'systemPrompt', 'task'],
        },
      },
    },
    required: ['tasks'],
  },
});

export const SUBAGENT_DELEGATE_TOOL_NAME = 'delegateToSubagents';

export const SUBAGENT_DELEGATION_SYSTEM_PROMPT = [
  'You may call delegateToSubagents when the user request naturally decomposes into multiple parallel investigations or one focused sub-task that benefits from isolated tools/context.',
  'Give each task a short descriptive name, a self-contained systemPrompt, and a concrete task instruction.',
  'Use includeHistoryLastN sparingly; only include the minimum recent context the subagent needs.',
  'Use allowKnowledgeSearch when the answer likely depends on uploaded knowledge documents.',
  'Use includeProjectFiles and htmlPacks only for the currently active HTML project. bootstrap is forbidden for subagents.',
  'At most one task per batch may request write-capable HTML packs. Keep the remaining tasks read-only.',
  `Each subagent defaults to ${DEFAULT_SUBAGENT_MAX_TOOL_ROUNDS} tool rounds and is clamped to ${MIN_SUBAGENT_MAX_TOOL_ROUNDS}-${MAX_SUBAGENT_MAX_TOOL_ROUNDS}.`,
  'Subagents never receive delegateToSubagents recursively; summarize their outputs in your final response.',
].join(' ');

export const runSubagentBatch = async (
  specs: SubagentTaskSpec[],
  env: SubagentExecutionEnv,
  callbacks?: SubagentExecutionCallbacks,
): Promise<SubagentBatchResult | RecoverableToolErrorResult> => {
  const validationError = validateSubagentBatch(specs, {
    activeProjectId: env.activeProjectId,
  });
  if (validationError) {
    return validationError;
  }

  await initializeProviders();
  const activeProvider = providerManager.getActiveProvider();

  if (!activeProvider || !activeProvider.isAvailable()) {
    return createRecoverableToolError(
      'subagent-provider-unavailable',
      'No active provider is available for subagent delegation.',
      'Retry after configuring an available provider, or answer without delegation.',
    );
  }

  const normalizedSpecs = specs.map(normalizeSubagentSpec);
  const batchId = createBatchId();
  const runs: SubagentRunRecord[] = normalizedSpecs.map((spec, index) => ({
    id: createRunId(batchId, index),
    batchId,
    name: spec.name,
    task: spec.task,
    status: 'running',
    output: '',
    toolSequence: [],
    durationMs: 0,
  }));

  emitActivity(batchId, runs, callbacks?.onActivity);

  let usageTotals: TokenUsageTotals | undefined;

  await Promise.all(
    normalizedSpecs.map(async (spec, index) => {
      const run = runs[index];
      const startedAt = Date.now();
      let output = '';
      let usage: ProviderUsageMetadata | undefined;

      try {
        const message = await buildSubagentMessage(spec, {
          history: env.history,
          assistantId: env.assistantId,
          activeProjectId: env.activeProjectId,
        });
        const builtTools = buildSubagentTools(
          spec,
          {
            assistantId: env.assistantId,
            sessionId: env.sessionId,
            activeProjectId: env.activeProjectId,
            knowledgeChunks: env.knowledgeChunks,
          },
          {
            onProjectToolActivity: callbacks?.onProjectToolActivity,
            onToolCall: toolName => {
              run.toolSequence = [...run.toolSequence, toolName];
              emitActivity(batchId, runs, callbacks?.onActivity);
            },
          },
        );

        const systemPrompt = [spec.systemPrompt, builtTools.extraSystemPrompt]
          .filter(Boolean)
          .join('\n\n');

        for await (const chunk of activeProvider.streamChat({
          systemPrompt,
          history: [],
          message,
          tools: builtTools.tools.length > 0 ? builtTools.tools : undefined,
          executeTool: builtTools.executeTool,
          maxToolRounds: spec.maxToolRounds,
          signal: env.signal,
        })) {
          if (chunk.text) {
            output += chunk.text;
          }
          if (chunk.isComplete) {
            usage = chunk.metadata?.usage;
          }
        }

        const truncated = truncateOutput(output);
        run.output = truncated.output;
        run.truncated = truncated.truncated;
        run.status = env.signal?.aborted ? 'aborted' : 'complete';
        run.durationMs = Date.now() - startedAt;
        run.tokenUsage = toTokenUsageTotals(usage);
        usageTotals = mergeTokenUsageTotals(usageTotals, run.tokenUsage);
      } catch (error) {
        const truncated = truncateOutput(output);
        run.output = truncated.output;
        run.truncated = truncated.truncated;
        run.status = env.signal?.aborted ? 'aborted' : 'failed';
        run.error = error instanceof Error ? error.message : 'Unknown subagent failure';
        run.durationMs = Date.now() - startedAt;
      }

      emitActivity(batchId, runs, callbacks?.onActivity);
    }),
  );

  if (env.signal?.aborted) {
    for (const run of runs) {
      if (run.status === 'running') {
        run.status = 'aborted';
      }
    }
    emitActivity(batchId, runs, callbacks?.onActivity);
  }

  return {
    ok: true,
    batchId,
    results: runs.map(run => ({
      name: run.name,
      status: run.status,
      output: run.output,
      toolSequence: [...run.toolSequence],
      truncated: run.truncated,
      error: run.error,
    })),
    usageTotals,
  };
};
