import {
  ChatMessage,
  MessageAttachment,
  RagChunk,
  type FinishReason,
  type HtmlProjectAgentTelemetryEvent,
  type HtmlProjectIntentDecision,
  type HtmlProjectPreviewOutcome,
  type HtmlProjectSummary,
  type HtmlProjectToolPackName,
  type HtmlProjectWorkspaceUpdate,
  type SubagentActivityUpdate,
  type SubagentRunRecord,
  type ToolCallRecord,
  type SubagentTaskSpec,
  type TokenUsageTotals,
  type RouteProposal,
} from '../types';
import { ToolCall, type ProviderUsageMetadata } from './llmAdapter';
import { providerManager, initializeProviders } from './providerRegistry';
import {
  buildKnowledgeSearchResponse,
  hasKnowledgeChunks,
  type KnowledgeSearchArgs,
  KNOWLEDGE_SEARCH_SYSTEM_PROMPT,
  KNOWLEDGE_SEARCH_TOOL_DESCRIPTION,
  KNOWLEDGE_SEARCH_TOOL_NAME,
  KNOWLEDGE_SEARCH_TOOL_SCHEMA,
} from './knowledgeSearchService';
import {
  executeHtmlProjectToolCall,
  getAllHtmlProjectToolDefinitions,
  getHtmlProjectToolNamesForPacks,
} from './htmlProjectToolService';
import {
  buildHtmlProjectSystemPrompt,
  classifyHtmlProjectIntent,
  PROJECT_BOOTSTRAP_SYSTEM_PROMPT,
} from './htmlProjectPrompting';
import { recordHtmlProjectTelemetryEvent } from './htmlProjectAgentTelemetry';
import {
  buildSubagentDelegationToolDefinition,
  runSubagentBatch,
  SUBAGENT_DELEGATE_TOOL_NAME,
  SUBAGENT_DELEGATION_SYSTEM_PROMPT,
} from './subagentService';
import {
  buildRouteToAssistantTool,
  buildRoutingSystemPrompt,
  ROUTE_TOOL_NAME,
  validateRouteCall,
  type RoutableTarget,
} from './assistantRoutingService';
import {
  executeCompute,
  MATH_COMPUTE_TOOL_DESCRIPTION,
  MATH_COMPUTE_TOOL_NAME,
  MATH_COMPUTE_TOOL_SCHEMA,
  MATH_TOOLS_SYSTEM_PROMPT,
  type ComputeArgs,
} from './mathComputeService';
import { MARKDOWN_MATH_SYSTEM_PROMPT } from './markdownPrompting';
import {
  DRAW_GEOMETRY_TOOL_DESCRIPTION,
  DRAW_GEOMETRY_TOOL_NAME,
  DRAW_GEOMETRY_TOOL_SCHEMA,
  executeDrawGeometry,
  normalizeGeometryDoc,
  type DrawGeometryResult,
  type GeometryDoc,
} from './geometryToolService';

export interface StreamChatParams {
  systemPrompt: string;
  ragContext?: string;
  history: ChatMessage[];
  message: string;
  /** 本回合使用者訊息附加的圖片(僅多模態模型)。 */
  attachments?: MessageAttachment[];
  assistantId: string;
  sessionId?: string | null;
  activeProjectId?: string | null;
  knowledgeChunks?: RagChunk[];
  subagentDelegationEnabled?: boolean;
  mathToolsEnabled?: boolean;
  routableTargets?: RoutableTarget[];
  onRouteProposal?: (proposal: RouteProposal) => void;
  /**
   * HTML 專案模式開關。預設 false（opt-in）。為 false 時完全略過意圖分類、
   * 不進行 summary preflight、不暴露任何 HTML 專案工具、不注入專案系統提示,
   * 也忽略 packSetOverride——確保未開啟專案的一般聊天回合不會誤觸專案工具。
   */
  htmlProjectEnabled?: boolean;
  /**
   * 專案 bootstrap 開關。預設 false。僅在 `htmlProjectEnabled === false` 且
   * 沒有 activeProjectId 時生效:只暴露 `createProject` 一個工具(不走關鍵字
   * 意圖分類、不強制呼叫),由模型自行判斷使用者是否需要建立 HTML 專案。
   * 一旦已有 active project(使用者已開啟專案),此開關無效——以現有專案為準。
   */
  projectBootstrapEnabled?: boolean;
  /**
   * AbortSignal (G4/G17). Threaded into the provider's chatParams; providers
   * check `signal.aborted` per round and yield finishReason='aborted' within
   * ~1 round. No half-turn writes.
   */
  signal?: AbortSignal;
  /**
   * Pack set override (G2). When present and non-empty, BYPASSES intent
   * classification — the override pack is used directly as `selectedPackSet`,
   * htmlProjectToolEnabled is forced true, and `effectiveIntentDecision` is
   * built with intent='uncertain', confidence='high', requiresSummaryPreflight=false.
   * Used by AgentRunController for continuation turns.
   */
  packSetOverride?: HtmlProjectToolPackName[];
  onChunk: (text: string) => void;
  onProjectToolActivity?: (update: HtmlProjectWorkspaceUpdate) => void;
  onSubagentActivity?: (update: SubagentActivityUpdate) => void;
  onToolCallActivity?: (record: ToolCallRecord) => void;
  /** 已解析但尚未完成驗證的圖形，僅供串流 UI 暫態預覽。 */
  onGeometryBoardPreview?: (preview: { toolCallId: string; document: GeometryDoc }) => void;
  onComplete: (
    metadata: {
      promptTokenCount: number;
      candidatesTokenCount: number;
      usage?: ProviderUsageMetadata;
      provider?: string;
      model?: string;
      /** Harness finish reason (G13/T1). 'complete' default when unspecified. */
      finishReason?: FinishReason;
      /** Most recent project summary observed during the turn (G4). */
      projectSummary?: HtmlProjectSummary | null;
      /** Per-turn tool sequence (mirrored from telemetry for controller use). */
      toolSequence?: string[];
      /** Effective selected pack set (mirrored from telemetry for controller use). */
      selectedPackSet?: HtmlProjectToolPackName[];
      /** 回合結束時的 active project id(bootstrap createProject 後由 controller 接手升級)。 */
      activeProjectId?: string | null;
      subagentRuns?: SubagentRunRecord[];
      subagentUsageTotals?: TokenUsageTotals;
      geometryBoards?: Array<{
        document: GeometryDoc;
        result: Extract<DrawGeometryResult, { ok: true }>;
      }>;
    },
    fullText: string,
  ) => void;
}

const mapProviderForTelemetry = (
  providerName: string | undefined,
): HtmlProjectAgentTelemetryEvent['provider'] => {
  switch (providerName) {
    case 'anthropic':
      return 'anthropic';
    case 'gemini':
      return 'gemini';
    case 'openai':
    case 'openrouter':
    case 'lmstudio':
    case 'ollama':
    case 'groq':
      return 'openai_compatible';
    default:
      return 'unknown';
  }
};

export const getProjectSummaryFromToolResult = (value: unknown): HtmlProjectSummary | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const projectSummary = (value as { projectSummary?: unknown }).projectSummary;
  if (!projectSummary || typeof projectSummary !== 'object' || Array.isArray(projectSummary)) {
    return null;
  }

  return projectSummary as HtmlProjectSummary;
};

const getPreviewOutcomeFromWorkspace = (
  workspace?: HtmlProjectWorkspaceUpdate | null,
): HtmlProjectPreviewOutcome | undefined => {
  return workspace?.preview?.diagnostics?.outcome;
};

const shouldPromoteFinalizeRouteToEdit = (projectSummary: HtmlProjectSummary | null): boolean => {
  if (!projectSummary) {
    return false;
  }

  return (
    (projectSummary.todoSummary.total > 0 && !projectSummary.todoSummary.allComplete) ||
    projectSummary.previewDiagnostics.repairable
  );
};

const appendUniquePack = (
  packSet: HtmlProjectIntentDecision['selectedPackSet'],
  packName: HtmlProjectIntentDecision['selectedPackSet'][number],
): HtmlProjectIntentDecision['selectedPackSet'] => {
  return packSet.includes(packName) ? packSet : [...packSet, packName];
};

interface RecoverableToolErrorResult {
  ok: false;
  recoverable: true;
  code: string;
  message: string;
  guidance: string;
  details?: Record<string, unknown>;
}

const createRoutingRecoverableToolError = (
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

const addOptionalTokenCount = (
  current: number | undefined,
  delta: number | undefined,
): number | undefined => {
  if (typeof current === 'undefined' && typeof delta === 'undefined') {
    return undefined;
  }

  return (current ?? 0) + (delta ?? 0);
};

const mergeSubagentUsageTotals = (
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
    cacheCreationInputTokens: addOptionalTokenCount(
      current?.cacheCreationInputTokens,
      delta.cacheCreationInputTokens,
    ),
    cacheReadInputTokens: addOptionalTokenCount(
      current?.cacheReadInputTokens,
      delta.cacheReadInputTokens,
    ),
    cachedInputTokens: addOptionalTokenCount(current?.cachedInputTokens, delta.cachedInputTokens),
    reasoningTokens: addOptionalTokenCount(current?.reasoningTokens, delta.reasoningTokens),
    toolUseTokens: addOptionalTokenCount(current?.toolUseTokens, delta.toolUseTokens),
  };
};

export const streamChat = async (params: StreamChatParams) => {
  const {
    systemPrompt,
    ragContext,
    history,
    message,
    attachments,
    assistantId,
    sessionId,
    activeProjectId,
    knowledgeChunks = [],
    signal,
    packSetOverride,
    subagentDelegationEnabled = false,
    mathToolsEnabled = false,
    routableTargets = [],
    htmlProjectEnabled = false,
    projectBootstrapEnabled = false,
    onChunk,
    onProjectToolActivity,
    onSubagentActivity,
    onToolCallActivity,
    onGeometryBoardPreview,
    onRouteProposal,
    onComplete,
  } = params;

  const htmlProjectAccessEnabled = !mathToolsEnabled;
  const effectiveHtmlProjectEnabled = htmlProjectAccessEnabled && htmlProjectEnabled;
  const effectiveProjectBootstrapEnabled = htmlProjectAccessEnabled && projectBootstrapEnabled;

  await initializeProviders();

  const activeProvider = providerManager.getActiveProvider();
  if (!activeProvider) {
    throw new Error('沒有可用的 AI 服務商。請在設定中配置至少一個服務商。');
  }

  if (!activeProvider.isAvailable()) {
    throw new Error(`${activeProvider.displayName} 服務不可用。請檢查您的配置。`);
  }

  const startedAt = Date.now();
  let fullResponseText = '';
  let promptTokenCount = 0;
  let candidatesTokenCount = 0;
  let usage: ProviderUsageMetadata | undefined;
  let responseProvider = activeProvider.name;
  let responseModel = activeProvider.supportedModels[0];
  let resolvedActiveProjectId = htmlProjectAccessEnabled ? (activeProjectId ?? null) : null;
  let projectSummary: HtmlProjectSummary | null = null;
  let latestPreviewOutcome: HtmlProjectPreviewOutcome | undefined;
  let finishReason: FinishReason | undefined;
  const subagentRunsByBatch = new Map<string, SubagentRunRecord[]>();
  let subagentRuns: SubagentRunRecord[] | undefined;
  let subagentUsageTotals: TokenUsageTotals | undefined;
  const geometryBoards: Array<{
    document: GeometryDoc;
    result: Extract<DrawGeometryResult, { ok: true }>;
  }> = [];
  let computeFailureCount = 0;
  let drawGeometryFailureCount = 0;

  const knowledgeToolEnabled = hasKnowledgeChunks(knowledgeChunks);

  // HTML 專案模式未開啟時,完全略過意圖分類與工具暴露(即使有 packSetOverride)。
  // 這確保一般聊天助理不會因訊息關鍵字而誤觸專案工具,避免執行期錯誤。
  const htmlProjectModeDisabledDecision: HtmlProjectIntentDecision = {
    intent: 'uncertain',
    confidence: 'low',
    selectedPackSet: [],
    reason: 'HTML project mode is disabled for this assistant; no project tools exposed.',
    requiresSummaryPreflight: false,
  };

  // G2: packSetOverride bypasses intent classification for continuation turns.
  const hasPackSetOverride =
    effectiveHtmlProjectEnabled && !!packSetOverride && packSetOverride.length > 0;
  const initialIntentDecision: HtmlProjectIntentDecision = !effectiveHtmlProjectEnabled
    ? htmlProjectModeDisabledDecision
    : hasPackSetOverride
      ? {
          intent: 'uncertain',
          confidence: 'high',
          selectedPackSet: [...(packSetOverride as HtmlProjectToolPackName[])],
          reason: 'packSetOverride supplied — bypassing intent classification (continuation turn).',
          requiresSummaryPreflight: false,
        }
      : classifyHtmlProjectIntent(message, resolvedActiveProjectId);
  let selectedPackSet = [...initialIntentDecision.selectedPackSet];
  let htmlProjectToolEnabled = hasPackSetOverride || selectedPackSet.length > 0;

  // 專案 bootstrap 模式:HTML 專案模式未開啟且沒有 active project 時,
  // 只暴露 createProject 讓模型自行決定是否建立專案(不走關鍵字分類)。
  // 使用者已開啟專案(activeProjectId 存在)時此模式不生效。
  const projectBootstrapToolEnabled =
    !effectiveHtmlProjectEnabled && effectiveProjectBootstrapEnabled && !resolvedActiveProjectId;
  let bootstrapProjectCreated = false;

  const telemetryEvent: HtmlProjectAgentTelemetryEvent = {
    sessionId,
    assistantId,
    projectId: resolvedActiveProjectId,
    provider: mapProviderForTelemetry(activeProvider.name),
    intent: initialIntentDecision.intent,
    selectedPackSet: selectedPackSet.map(pack => pack),
    toolSequence: [],
    repeatedRecoverableErrors: [],
    toolRounds: 0,
  };

  const delegationToolDefinition = buildSubagentDelegationToolDefinition();

  try {
    if (
      htmlProjectToolEnabled &&
      initialIntentDecision.requiresSummaryPreflight &&
      resolvedActiveProjectId
    ) {
      const preflightSummary = await executeHtmlProjectToolCall(
        {
          name: 'getProjectSummary',
          args: {
            projectId: resolvedActiveProjectId,
          },
        },
        {
          assistantId,
          sessionId,
          activeProjectId: resolvedActiveProjectId,
        },
      );

      telemetryEvent.toolSequence.push('getProjectSummary');
      resolvedActiveProjectId = preflightSummary.workspace.activeProjectId;
      telemetryEvent.projectId = resolvedActiveProjectId;
      projectSummary = getProjectSummaryFromToolResult(preflightSummary.result);
      latestPreviewOutcome =
        getPreviewOutcomeFromWorkspace(preflightSummary.workspace) ??
        projectSummary?.previewDiagnostics.outcome;
      onProjectToolActivity?.(preflightSummary.workspace);

      if (
        initialIntentDecision.intent === 'finalize_or_complete' &&
        shouldPromoteFinalizeRouteToEdit(projectSummary)
      ) {
        selectedPackSet = appendUniquePack(selectedPackSet, 'edit');
      }
    }

    htmlProjectToolEnabled = selectedPackSet.length > 0;

    const effectiveIntentDecision: HtmlProjectIntentDecision = {
      ...initialIntentDecision,
      selectedPackSet,
    };
    telemetryEvent.selectedPackSet = [...selectedPackSet];

    const htmlProjectToolDefinitions = htmlProjectToolEnabled
      ? getAllHtmlProjectToolDefinitions()
      : [];
    const bootstrapToolDefinitions = projectBootstrapToolEnabled
      ? getAllHtmlProjectToolDefinitions().filter(tool => tool.name === 'createProject')
      : [];
    const visibleHtmlProjectToolNames = new Set(htmlProjectToolDefinitions.map(tool => tool.name));
    const forcedHtmlProjectToolName = (() => {
      const packToolNames = getHtmlProjectToolNamesForPacks(selectedPackSet);
      if (!htmlProjectToolEnabled) {
        return undefined;
      }

      if (!resolvedActiveProjectId && selectedPackSet.includes('bootstrap')) {
        return effectiveIntentDecision.intent === 'resume_project'
          ? 'listProjects'
          : 'createProject';
      }

      if (packToolNames.includes('getProjectSummary')) {
        return 'getProjectSummary';
      }

      return [...packToolNames].find(
        toolName =>
          ![
            'reportTurnOutcome',
            'getPreviewRuntimeErrors',
            'listSnapshots',
            'revertToSnapshot',
            'lintProject',
          ].includes(toolName),
      );
    })();
    const htmlProjectToolChoice = forcedHtmlProjectToolName
      ? ({ mode: 'requireSpecific', name: forcedHtmlProjectToolName } as const)
      : undefined;

    const finalSystemPrompt = [
      systemPrompt,
      MARKDOWN_MATH_SYSTEM_PROMPT,
      knowledgeToolEnabled ? KNOWLEDGE_SEARCH_SYSTEM_PROMPT : '',
      mathToolsEnabled ? MATH_TOOLS_SYSTEM_PROMPT : '',
      htmlProjectToolEnabled
        ? buildHtmlProjectSystemPrompt({
            activeProjectId: resolvedActiveProjectId,
            intentDecision: effectiveIntentDecision,
            projectSummary,
            gatingMode: 'soft',
          })
        : '',
      projectBootstrapToolEnabled ? PROJECT_BOOTSTRAP_SYSTEM_PROMPT : '',
      subagentDelegationEnabled ? SUBAGENT_DELEGATION_SYSTEM_PROMPT : '',
      routableTargets.length > 0 ? buildRoutingSystemPrompt(routableTargets) : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    const truncateToolSummary = (value: string | undefined): string | undefined => {
      if (!value) {
        return undefined;
      }
      return value.length <= 200 ? value : `${value.slice(0, 197)}...`;
    };

    let routeProposalCreated = false;
    const executeTool = async (call: ToolCall) => {
      telemetryEvent.toolSequence.push(call.name);
      const toolStartedAt = Date.now();
      const toolCallId = `${call.name}-${telemetryEvent.toolSequence.length}-${toolStartedAt}`;

      const emitToolRecord = (
        status: ToolCallRecord['status'],
        options?: {
          code?: string;
          summary?: string;
        },
      ) => {
        onToolCallActivity?.({
          id: toolCallId,
          name: call.name,
          startedAt: toolStartedAt,
          status,
          code: options?.code,
          summary: truncateToolSummary(options?.summary),
          durationMs: Date.now() - toolStartedAt,
        });
      };

      emitToolRecord('running');

      try {
        let result: unknown;

        if (call.name === KNOWLEDGE_SEARCH_TOOL_NAME) {
          result = buildKnowledgeSearchResponse(
            knowledgeChunks,
            call.args as unknown as KnowledgeSearchArgs,
          );
        } else if (mathToolsEnabled && call.name === MATH_COMPUTE_TOOL_NAME) {
          const computeResult = await executeCompute(call.args as ComputeArgs);
          if (computeResult.ok) {
            result = computeResult;
          } else {
            computeFailureCount += 1;
            result =
              computeFailureCount > 20
                ? {
                    ok: false,
                    recoverable: false,
                    code: 'compute-failure-limit-reached',
                    message: 'compute reached its limit of 20 recoverable failures for this run.',
                    guidance:
                      'Stop calling compute for this run and explain that the requested calculation could not be completed.',
                  }
                : {
                    ...computeResult,
                    // Provider loops escalate repeated recoverable codes after three attempts.
                    // Keep each allowed failure independently recoverable until this tool's limit.
                    code: `${computeResult.code}-${computeFailureCount}`,
                  };
          }
        } else if (mathToolsEnabled && call.name === DRAW_GEOMETRY_TOOL_NAME) {
          const geometryDocument = normalizeGeometryDoc(call.args);
          onGeometryBoardPreview?.({
            toolCallId,
            document: geometryDocument as GeometryDoc,
          });
          const drawGeometryResult = await executeDrawGeometry(geometryDocument);
          if (drawGeometryResult.ok) {
            geometryBoards.push({
              document: geometryDocument as GeometryDoc,
              result: drawGeometryResult,
            });
            result = drawGeometryResult;
          } else {
            drawGeometryFailureCount += 1;
            result =
              drawGeometryFailureCount > 6
                ? {
                    ok: false,
                    recoverable: false,
                    code: 'draw-geometry-failure-limit-reached',
                    message:
                      'draw_geometry reached its limit of 6 recoverable failures for this run.',
                    guidance:
                      'Stop calling draw_geometry for this run and explain that the requested diagram could not be completed.',
                  }
                : {
                    ...drawGeometryResult,
                    // Keep each allowed failure independently recoverable until this tool's limit.
                    code: `${drawGeometryResult.code}-${drawGeometryFailureCount}`,
                  };
          }
        } else if (routableTargets.length > 0 && call.name === ROUTE_TOOL_NAME) {
          if (routeProposalCreated) {
            result = createRoutingRecoverableToolError(
              'route-already-proposed',
              'A routing proposal was already created for this run.',
              'Finish the response without proposing another route.',
            );
          } else {
            const validation = validateRouteCall(
              call.args,
              routableTargets,
              assistantId,
              sessionId,
            );
            if (validation.ok) {
              routeProposalCreated = true;
              onRouteProposal?.(validation.proposal);
              result = {
                ok: true,
                summary:
                  'Routing proposal shown to the user. Finish your response without switching assistants.',
              };
            } else {
              result = validation;
            }
          }
        } else if (subagentDelegationEnabled && call.name === SUBAGENT_DELEGATE_TOOL_NAME) {
          result = await runSubagentBatch(
            ((call.args as { tasks?: SubagentTaskSpec[] }).tasks ?? []) as SubagentTaskSpec[],
            {
              assistantId,
              sessionId,
              activeProjectId: resolvedActiveProjectId,
              history,
              knowledgeChunks,
              signal,
            },
            {
              onActivity: update => {
                subagentRunsByBatch.set(update.batchId, update.runs);
                subagentRuns = undefined;
                onSubagentActivity?.(update);
              },
              onProjectToolActivity,
            },
          );

          if ((result as { ok?: boolean }).ok) {
            const subagentResult = result as {
              ok: true;
              results: Array<{ name: string; status: SubagentRunRecord['status'] }>;
              usageTotals?: TokenUsageTotals;
            };
            telemetryEvent.subagentTaskCount =
              (telemetryEvent.subagentTaskCount ?? 0) + subagentResult.results.length;
            subagentUsageTotals = mergeSubagentUsageTotals(
              subagentUsageTotals,
              subagentResult.usageTotals,
            );
            subagentRuns = [...subagentRunsByBatch.values()].flatMap(runs => runs);
          }
        } else if (htmlProjectToolEnabled && visibleHtmlProjectToolNames.has(call.name)) {
          const toolResult = await executeHtmlProjectToolCall(call, {
            assistantId,
            sessionId,
            activeProjectId: resolvedActiveProjectId,
          });

          resolvedActiveProjectId = toolResult.workspace.activeProjectId;
          telemetryEvent.projectId = resolvedActiveProjectId;
          latestPreviewOutcome =
            getPreviewOutcomeFromWorkspace(toolResult.workspace) ?? latestPreviewOutcome;
          onProjectToolActivity?.(toolResult.workspace);

          result = {
            ...toolResult.result,
            summary: toolResult.summary,
          };
        } else if (projectBootstrapToolEnabled && call.name === 'createProject') {
          if (resolvedActiveProjectId) {
            result = createRoutingRecoverableToolError(
              'project-already-active',
              'A project was already created for this turn.',
              'Do not create another project. Tell the user the project is ready; the full project toolset arrives on the next turn.',
            );
          } else {
            const toolResult = await executeHtmlProjectToolCall(call, {
              assistantId,
              sessionId,
              activeProjectId: resolvedActiveProjectId,
            });

            resolvedActiveProjectId = toolResult.workspace.activeProjectId;
            bootstrapProjectCreated = true;
            telemetryEvent.projectId = resolvedActiveProjectId;
            latestPreviewOutcome =
              getPreviewOutcomeFromWorkspace(toolResult.workspace) ?? latestPreviewOutcome;
            onProjectToolActivity?.(toolResult.workspace);

            result = {
              ...toolResult.result,
              summary: toolResult.summary,
            };
          }
        } else {
          result = createRoutingRecoverableToolError(
            'tool-unsupported',
            `Unsupported tool: ${call.name}`,
            'Retry using only tools that are explicitly exposed for this turn.',
            {
              requestedTool: call.name,
              visibleToolNames: [
                ...(knowledgeToolEnabled ? [KNOWLEDGE_SEARCH_TOOL_NAME] : []),
                ...(mathToolsEnabled ? [MATH_COMPUTE_TOOL_NAME, DRAW_GEOMETRY_TOOL_NAME] : []),
                ...htmlProjectToolDefinitions.map(tool => tool.name),
                ...bootstrapToolDefinitions.map(tool => tool.name),
                ...(subagentDelegationEnabled ? [SUBAGENT_DELEGATE_TOOL_NAME] : []),
                ...(routableTargets.length > 0 ? [ROUTE_TOOL_NAME] : []),
              ],
              selectedPackSet: [...selectedPackSet],
              intent: effectiveIntentDecision.intent,
            },
          );
        }

        const resultRecord = result as Record<string, unknown> | undefined;
        if (resultRecord?.ok === false && resultRecord.recoverable === true) {
          emitToolRecord('recoverable_error', {
            code: typeof resultRecord.code === 'string' ? resultRecord.code : undefined,
            summary:
              typeof resultRecord.message === 'string'
                ? resultRecord.message
                : typeof resultRecord.summary === 'string'
                  ? resultRecord.summary
                  : undefined,
          });
        } else if (resultRecord?.ok === false) {
          emitToolRecord('failed', {
            code: typeof resultRecord.code === 'string' ? resultRecord.code : undefined,
            summary:
              typeof resultRecord.message === 'string'
                ? resultRecord.message
                : typeof resultRecord.summary === 'string'
                  ? resultRecord.summary
                  : undefined,
          });
        } else {
          emitToolRecord('ok', {
            summary:
              typeof resultRecord?.summary === 'string'
                ? resultRecord.summary
                : typeof resultRecord?.message === 'string'
                  ? resultRecord.message
                  : undefined,
          });
        }

        return result;
      } catch (error) {
        emitToolRecord('failed', {
          summary: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    };

    const tools = [
      ...(knowledgeToolEnabled
        ? [
            {
              name: KNOWLEDGE_SEARCH_TOOL_NAME,
              description: KNOWLEDGE_SEARCH_TOOL_DESCRIPTION,
              parameters: KNOWLEDGE_SEARCH_TOOL_SCHEMA,
            },
          ]
        : []),
      ...(mathToolsEnabled
        ? [
            {
              name: MATH_COMPUTE_TOOL_NAME,
              description: MATH_COMPUTE_TOOL_DESCRIPTION,
              parameters: MATH_COMPUTE_TOOL_SCHEMA,
            },
            {
              name: DRAW_GEOMETRY_TOOL_NAME,
              description: DRAW_GEOMETRY_TOOL_DESCRIPTION,
              parameters: DRAW_GEOMETRY_TOOL_SCHEMA,
            },
          ]
        : []),
      ...htmlProjectToolDefinitions,
      ...bootstrapToolDefinitions,
      ...(subagentDelegationEnabled ? [delegationToolDefinition] : []),
      ...(routableTargets.length > 0 ? [buildRouteToAssistantTool(routableTargets)] : []),
    ];

    const chatParams = {
      systemPrompt: finalSystemPrompt,
      ragContext,
      history,
      message,
      attachments,
      tools: tools.length > 0 ? tools : undefined,
      executeTool: tools.length > 0 ? executeTool : undefined,
      signal,
      toolChoice: htmlProjectToolChoice,
    };

    for await (const response of activeProvider.streamChat(chatParams)) {
      if (response.text && !response.isComplete) {
        onChunk(response.text);
        fullResponseText += response.text;
      }

      if (response.isComplete && response.metadata) {
        promptTokenCount = response.metadata.promptTokenCount || 0;
        candidatesTokenCount = response.metadata.candidatesTokenCount || 0;
        usage = response.metadata.usage;
        responseProvider = response.metadata.provider || responseProvider;
        responseModel = response.metadata.model || responseModel;
        telemetryEvent.toolRounds = response.metadata.toolRoundCount || 0;
        telemetryEvent.repeatedRecoverableErrors =
          response.metadata.repeatedRecoverableErrors || [];
        finishReason = response.metadata.finishReason;
        break;
      }
    }

    telemetryEvent.projectId = resolvedActiveProjectId;
    telemetryEvent.previewOutcome =
      latestPreviewOutcome ?? projectSummary?.previewDiagnostics.outcome;
    telemetryEvent.durationMs = Date.now() - startedAt;
    telemetryEvent.finishReason = finishReason;

    if (htmlProjectToolEnabled || bootstrapProjectCreated) {
      recordHtmlProjectTelemetryEvent(telemetryEvent);
    }

    onComplete(
      {
        promptTokenCount,
        candidatesTokenCount,
        usage,
        provider: responseProvider,
        model: responseModel,
        finishReason,
        projectSummary,
        toolSequence: telemetryEvent.toolSequence,
        selectedPackSet: selectedPackSet,
        activeProjectId: resolvedActiveProjectId,
        subagentRuns,
        subagentUsageTotals,
        geometryBoards: geometryBoards.length > 0 ? geometryBoards : undefined,
      },
      fullResponseText,
    );
  } catch (error) {
    telemetryEvent.projectId = resolvedActiveProjectId;
    telemetryEvent.previewOutcome =
      latestPreviewOutcome ?? projectSummary?.previewDiagnostics.outcome;
    telemetryEvent.durationMs = Date.now() - startedAt;

    if (htmlProjectToolEnabled || bootstrapProjectCreated) {
      recordHtmlProjectTelemetryEvent(telemetryEvent);
    }

    console.error('LLM streaming error:', error);

    if (error instanceof Error) {
      if (error.message.includes('API key') || error.message.includes('unauthorized')) {
        throw new Error(`API 金鑰錯誤：請檢查 ${activeProvider.displayName} 的 API 金鑰是否正確。`);
      }
      if (error.message.includes('rate limit') || error.message.includes('quota')) {
        throw new Error(`API 配額不足：${activeProvider.displayName} 的使用配額已達上限。`);
      }
      if (error.message.includes('network') || error.message.includes('fetch')) {
        throw new Error(`網路連接錯誤：無法連接到 ${activeProvider.displayName} 服務。`);
      }
    }

    throw error;
  }
};
