import {
  ChatMessage,
  RagChunk,
  type FinishReason,
  type HtmlProjectAgentTelemetryEvent,
  type HtmlProjectIntentDecision,
  type HtmlProjectPreviewOutcome,
  type HtmlProjectSummary,
  type HtmlProjectToolPackName,
  type HtmlProjectWorkspaceUpdate,
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
  getHtmlProjectToolDefinitionsForPacks,
  getHtmlProjectToolNamesForPacks,
  isHtmlProjectToolName,
} from './htmlProjectToolService';
import { buildHtmlProjectSystemPrompt, classifyHtmlProjectIntent } from './htmlProjectPrompting';
import { recordHtmlProjectTelemetryEvent } from './htmlProjectAgentTelemetry';

export interface StreamChatParams {
  systemPrompt: string;
  ragContext?: string;
  history: ChatMessage[];
  message: string;
  assistantId: string;
  sessionId?: string | null;
  activeProjectId?: string | null;
  knowledgeChunks?: RagChunk[];
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

export const streamChat = async (params: StreamChatParams) => {
  const {
    systemPrompt,
    ragContext,
    history,
    message,
    assistantId,
    sessionId,
    activeProjectId,
    knowledgeChunks = [],
    signal,
    packSetOverride,
    onChunk,
    onProjectToolActivity,
    onComplete,
  } = params;

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
  let resolvedActiveProjectId = activeProjectId ?? null;
  let projectSummary: HtmlProjectSummary | null = null;
  let latestPreviewOutcome: HtmlProjectPreviewOutcome | undefined;
  let finishReason: FinishReason | undefined;

  const knowledgeToolEnabled = hasKnowledgeChunks(knowledgeChunks);

  // G2: packSetOverride bypasses intent classification for continuation turns.
  const hasPackSetOverride = !!packSetOverride && packSetOverride.length > 0;
  const initialIntentDecision: HtmlProjectIntentDecision = hasPackSetOverride
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
      ? getHtmlProjectToolDefinitionsForPacks(selectedPackSet)
      : [];
    const visibleHtmlProjectToolNames = new Set(
      htmlProjectToolEnabled ? getHtmlProjectToolNamesForPacks(selectedPackSet) : [],
    );
    const forcedHtmlProjectToolName = (() => {
      if (!htmlProjectToolEnabled) {
        return undefined;
      }

      if (!resolvedActiveProjectId && selectedPackSet.includes('bootstrap')) {
        return effectiveIntentDecision.intent === 'resume_project'
          ? 'listProjects'
          : 'createProject';
      }

      if (visibleHtmlProjectToolNames.has('getProjectSummary')) {
        return 'getProjectSummary';
      }

      return [...visibleHtmlProjectToolNames].find(
        toolName =>
          ![
            'reportTurnOutcome',
            'getPreviewRuntimeErrors',
            'listSnapshots',
            'revertToSnapshot',
          ].includes(toolName),
      );
    })();
    const htmlProjectToolChoice = forcedHtmlProjectToolName
      ? ({ mode: 'requireSpecific', name: forcedHtmlProjectToolName } as const)
      : undefined;

    const finalSystemPrompt = [
      systemPrompt,
      knowledgeToolEnabled ? KNOWLEDGE_SEARCH_SYSTEM_PROMPT : '',
      htmlProjectToolEnabled
        ? buildHtmlProjectSystemPrompt({
            activeProjectId: resolvedActiveProjectId,
            intentDecision: effectiveIntentDecision,
            projectSummary,
          })
        : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    const executeTool = async (call: ToolCall) => {
      telemetryEvent.toolSequence.push(call.name);

      if (call.name === KNOWLEDGE_SEARCH_TOOL_NAME) {
        return buildKnowledgeSearchResponse(
          knowledgeChunks,
          call.args as unknown as KnowledgeSearchArgs,
        );
      }

      if (
        htmlProjectToolEnabled &&
        visibleHtmlProjectToolNames.has(
          call.name as ReturnType<typeof getHtmlProjectToolNamesForPacks>[number],
        )
      ) {
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

        return {
          ...toolResult.result,
          summary: toolResult.summary,
        };
      }

      if (isHtmlProjectToolName(call.name)) {
        return createRoutingRecoverableToolError(
          'tool-not-visible-for-turn',
          `Tool ${call.name} is not visible for the current HTML project route.`,
          'Retry using only the currently visible HTML project tools for this turn.',
          {
            requestedTool: call.name,
            visibleToolNames: [...visibleHtmlProjectToolNames],
            selectedPackSet: [...selectedPackSet],
            intent: effectiveIntentDecision.intent,
          },
        );
      }

      return createRoutingRecoverableToolError(
        'tool-unsupported',
        `Unsupported tool: ${call.name}`,
        'Retry using only tools that are explicitly exposed for this turn.',
        {
          requestedTool: call.name,
          visibleToolNames: [
            ...(knowledgeToolEnabled ? [KNOWLEDGE_SEARCH_TOOL_NAME] : []),
            ...htmlProjectToolDefinitions.map(tool => tool.name),
          ],
          selectedPackSet: [...selectedPackSet],
          intent: effectiveIntentDecision.intent,
        },
      );
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
      ...htmlProjectToolDefinitions,
    ];

    const chatParams = {
      systemPrompt: finalSystemPrompt,
      ragContext,
      history,
      message,
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

    if (htmlProjectToolEnabled) {
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
      },
      fullResponseText,
    );
  } catch (error) {
    telemetryEvent.projectId = resolvedActiveProjectId;
    telemetryEvent.previewOutcome =
      latestPreviewOutcome ?? projectSummary?.previewDiagnostics.outcome;
    telemetryEvent.durationMs = Date.now() - startedAt;

    if (htmlProjectToolEnabled) {
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
