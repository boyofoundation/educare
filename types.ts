export interface RagChunk {
  fileName: string;
  content: string;
  vector?: number[];
  relevanceScore?: number;
}

export interface QueryCacheEntry {
  id: string; // UUID
  queryText: string; // 原始查詢文字
  queryEmbedding: number[]; // 查詢的向量表示
  rerankedResults: RagChunk[]; // rerank 後的結果
  assistantId: string; // 所屬助手ID
  timestamp: number; // 創建時間戳
  hitCount: number; // 命中次數
  lastAccessTime: number; // 最後訪問時間
}

export interface Assistant {
  id: string;
  name: string;
  description: string; // 給使用者看的友善描述
  systemPrompt: string; // 給 AI 的內部指令
  ragChunks?: RagChunk[];
  starterPrompts?: string[];
  createdAt: number;
  isShared?: boolean;
  /**
   * 子代理人委派開關。預設 false: 僅在明確 opt-in 時暴露 delegateToSubagents。
   * shared mode 會在 controller/llmService 上游強制停用。
   *
   * 註: agentHarnessEnabled 與 htmlProjectEnabled 不再是助理層級設定,
   * 改由「聊天回合是否有開啟 HTML 專案 (session.activeProjectId)」於執行期自動推導。
   */
  subagentDelegationEnabled?: boolean;
}

export type SubagentRunStatus = 'running' | 'complete' | 'failed' | 'aborted';

export interface SubagentTaskSpec {
  name: string;
  systemPrompt: string;
  task: string;
  context?: string;
  includeHistoryLastN?: number;
  allowKnowledgeSearch?: boolean;
  includeProjectFiles?: string[];
  htmlPacks?: HtmlProjectToolPackName[];
  maxToolRounds?: number;
}

export interface SubagentRunRecord {
  id: string;
  batchId: string;
  name: string;
  task: string;
  status: SubagentRunStatus;
  output: string;
  toolSequence: string[];
  tokenUsage?: TokenUsageTotals;
  durationMs: number;
  truncated?: boolean;
  error?: string;
}

export interface SubagentActivityUpdate {
  batchId: string;
  runs: SubagentRunRecord[];
}

export interface ToolCallRecord {
  id: string;
  name: string;
  status: 'running' | 'ok' | 'recoverable_error' | 'failed';
  code?: string;
  summary?: string;
  durationMs?: number;
  startedAt: number;
}

export interface ChatMessage {
  role: 'user' | 'model';
  content: string;
  /**
   * 訊息建立時間 (epoch ms)。舊資料可能沒有此欄位，UI 需優雅退化。
   */
  timestamp?: number;
  /**
   * 代表這是一條可見給使用者、但不可回送給模型上下文的錯誤訊息。
   */
  isError?: boolean;
  /**
   * Agent 回合摘要軌跡 (G6)。序列化上限 200 字元,用於活動面板顯示與偵錯。
   * 由 conversationUtils 在每回合結束時填入。
   */
  agentTurnLog?: string;
  /**
   * 合成訊息標記 (G6)。續跑回合由 controller 產生的歷史銜接訊息標記為 true,
   * 在 UI 中摺疊顯示,且為 compaction 時最優先丟棄的對象。
   */
  synthetic?: boolean;
  /**
   * 子代理人批次執行紀錄。用於串流卡片與歷史訊息重建。
   */
  subagentRuns?: SubagentRunRecord[];
  /**
   * 工具呼叫活動紀錄。用於串流卡片與歷史訊息重建。
   */
  toolCallLog?: ToolCallRecord[];
}

/**
 * 壓縮上下文介面 - 儲存壓縮後的對話摘要
 */
export interface CompactContext {
  type: 'compact';
  content: string; // 壓縮後的摘要內容
  tokenCount: number; // 摘要的 token 數量
  compressedFromRounds: number; // 壓縮了多少輪對話
  compressedFromMessages: number; // 壓縮了多少條訊息
  createdAt: string; // 壓縮時間 (ISO string)
  version: string; // 壓縮版本（用於未來升級）
}

/**
 * 對話輪次介面 - 代表一輪完整的對話 (使用者訊息 + AI回覆)
 */
export interface ConversationRound {
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
  roundNumber: number;
}

export interface TokenUsageTotals {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  toolUseTokens?: number;
}

export interface SessionTokenUsage {
  source: 'api' | 'unavailable';
  totals?: TokenUsageTotals;
  lastProvider?: string;
  lastModel?: string;
  lastUpdatedAt?: number;
  unavailableTurns?: number;
}

export interface ChatSession {
  id: string;
  assistantId: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt?: number;
  tokenCount: number;
  tokenUsage?: SessionTokenUsage;
  activeProjectId?: string | null;
  // 壓縮相關欄位
  compactContext?: CompactContext; // 壓縮的對話上下文
  lastCompactionAt?: string; // 最後壓縮時間 (ISO string)
}

export type HtmlProjectStatus = 'draft' | 'ready' | 'error';
export type HtmlProjectFileKind = 'html' | 'css' | 'js' | 'json' | 'svg' | 'asset' | 'md';
export type HtmlProjectPreviewUrlType = 'blob' | 'data';

export interface HtmlProject {
  id: string;
  assistantId: string;
  sessionId?: string | null;
  name: string;
  description?: string;
  entryFile: string;
  status: HtmlProjectStatus;
  previewVersion: number;
  assetPaths: string[];
  createdAt: number;
  updatedAt: number;
  lastPrompt?: string;
  lastBuildError?: string | null;
  tags?: string[];
}

export type HtmlProjectTodoStatus = 'pending' | 'in_progress' | 'completed';

export interface HtmlProjectTodo {
  projectId: string;
  id: string;
  title: string;
  description?: string;
  status: HtmlProjectTodoStatus;
  order: number;
  createdAt: number;
  updatedAt: number;
  completedAt?: number | null;
}

export interface HtmlProjectTodoSummary {
  projectId: string;
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  allComplete: boolean;
}

export interface HtmlProjectFile {
  projectId: string;
  path: string;
  kind: HtmlProjectFileKind;
  content: string;
  encoding?: 'utf-8' | 'base64';
  dependencies?: string[];
  size: number;
  updatedAt: number;
}

export interface HtmlProjectSnapshot {
  projectId: string;
  version: number;
  files: string[];
  createdAt: number;
  note?: string;
  /** short SHA (git commit oid) — D3 由 git commit 實現的快照,供 UI/進階使用。 */
  oid?: string;
}

/**
 * 快照還原規格 (G11)。每專案保留最近 20 份,超出淘汰最舊。
 * revertToSnapshot 還原檔案後 previewVersion +1 (維持單調遞增) 並清空 runtime 診斷。
 */
export interface HtmlProjectListSnapshotsResult {
  projectId: string;
  snapshots: HtmlProjectSnapshot[];
  retainedLimit: number;
}

export interface HtmlProjectRevertToSnapshotResult {
  projectId: string;
  revertedToVersion: number;
  previewVersion: number;
  runtimeDiagnosticsCleared: boolean;
  filesRestored: number;
}

export interface HtmlProjectFileDescriptor {
  path: string;
  kind: HtmlProjectFileKind;
  size: number;
  updatedAt: number;
  dependencies?: string[];
}

export type HtmlProjectToolPackName =
  | 'bootstrap'
  | 'inspect'
  | 'edit'
  | 'todo_finalize'
  | 'preview_recheck';

export type HtmlProjectIntent =
  | 'new_build'
  | 'resume_project'
  | 'inspect_only'
  | 'targeted_edit'
  | 'finalize_or_complete'
  | 'uncertain';

export type HtmlProjectIntentConfidence = 'high' | 'medium' | 'low';

export type HtmlProjectPreviewDiagnosticCategory =
  | 'none'
  | 'missing_entrypoint'
  | 'missing_reference'
  | 'build_error'
  | 'external_dependency_warning'
  | 'runtime_error' // G1:iframe 內 JS 執行期錯誤 (onerror/unhandledrejection/console)
  | 'unknown';

export type HtmlProjectPreviewOutcome = 'ready' | 'repairable_error' | 'non_repairable_error';

/**
 * Runtime 診斷三態 (G1)。
 * - not_executed:尚未執行 (未收到 ready ack 或無法掛載 iframe)
 * - clean:已執行且無錯誤
 * - has_errors:已執行且捕獲 runtime 錯誤
 */
export type HtmlProjectRuntimeDiagnosticStatus = 'not_executed' | 'clean' | 'has_errors';

export interface HtmlProjectPreviewDiagnostics {
  category: HtmlProjectPreviewDiagnosticCategory;
  outcome: HtmlProjectPreviewOutcome;
  repairable: boolean;
  summary: string;
  missingPaths?: string[];
  warnings?: string[];
  details?: string[];
}

/**
 * Runtime 錯誤条目 (G1)。由預覽 iframe 內的 bridge 捕獲並經 postMessage 回傳。
 * bridge 會去重、上限 50 筆、訊息截斷。
 */
export interface HtmlProjectRuntimeErrorEntry {
  kind: 'error' | 'unhandledrejection' | 'console_error' | 'console_warn' | 'missing_reference';
  message: string;
  stack?: string;
  source?: string;
  lineno?: number;
  colno?: number;
  timestamp: number;
}

/**
 * 靜態語法驗證診斷 (Phase 1 MVP)。
 * 來源於寫入工具 handler 內 acorn/css-tree/parse5 的解析結果;
 * 行號與列號一律 1-based (acorn loc.column 0-based 需 +1)。
 * 與 HtmlProjectRuntimeErrorEntry (執行期) 並存,格式化器統一對 LLM 輸出。
 */
export type HtmlProjectStaticDiagnosticLang = 'html' | 'css' | 'js' | 'json';

export interface HtmlProjectStaticDiagnostic {
  /** 'syntax' = parser 解析失敗; 'lint' = csstree-validator 屬性值錯誤 */
  source: 'syntax' | 'lint';
  lang: HtmlProjectStaticDiagnosticLang;
  severity: 'error' | 'warning' | 'info';
  message: string;
  /** 專案內檔案路徑 (inline script/style 時為 HTML 檔路徑) */
  path: string;
  /** 1-based;inline 片段已加上 sourceCodeLocation.startLine - 1 平移 */
  line: number;
  /** 1-based;inline 片段第 1 行診斷額外加上 startCol - 1 平移 */
  column: number;
  /** parse5 錯誤碼 / csstree-validator 屬性名 / acorn 固定 'SyntaxError' */
  rule?: string;
  /** 出錯行前後各一行,錯誤行前綴 '>' */
  snippet?: string;
}

export interface HtmlProjectStaticValidationStats {
  /** 純解析耗時 (不含 parser 模組首次載入) */
  durationMs: number;
  /** MVP 固定 'lightweight-v1' (acorn + css-tree + parse5 + csstree-validator) */
  engine: string;
}

export interface HtmlProjectStaticValidationResult {
  /** severity === 'error' 數量為 0 時為 true */
  ok: boolean;
  diagnostics: HtmlProjectStaticDiagnostic[];
  stats: HtmlProjectStaticValidationStats;
}

/**
 * Runtime 診斷查詢結果 (G1/G8)。getPreviewRuntimeErrors 工具回傳值。
 * waitMs 預設 1500、上限 5000;在 ready ack 版本相符前查詢回傳 not_executed。
 */
export interface HtmlProjectRuntimeDiagnosticResult {
  projectId: string;
  previewVersion: number;
  status: HtmlProjectRuntimeDiagnosticStatus;
  errors: HtmlProjectRuntimeErrorEntry[];
  readyAckReceived: boolean;
  waitedForReadyAck: boolean;
  waitMs: number;
}

export interface HtmlProjectPreviewArtifact {
  projectId: string;
  previewVersion: number;
  entryFile: string;
  previewReady: boolean;
  previewUrlType: HtmlProjectPreviewUrlType;
  html: string;
  url?: string;
  warnings: string[];
  error?: string | null;
  diagnostics?: HtmlProjectPreviewDiagnostics;
  generatedAt: number;
  /**
   * VFS 沙盒:實際放入 manifest 的檔案計數(含 module/css/asset,
   * 不含 entry HTML 本身)。供 telemetry size warning 與診斷參考。
   */
  vfsFileCount?: number;
}

/**
 * VFS 沙盒 (選項 A) 預覽警告分類。warnings 維持 string[],
 * 但產生端應使用本集中常數避免拼寫漂移,測試端以常數鍵比對。
 */
export const PREVIEW_WARNING_KINDS = {
  baseTagRemoved: 'base_tag_removed',
  unresolvedModuleSpecifier: 'unresolved_module_specifier',
  externalStylesheetPreserved: 'external_stylesheet_preserved',
  externalScriptPreserved: 'external_script_preserved',
} as const;
export type HtmlProjectPreviewWarningKind =
  (typeof PREVIEW_WARNING_KINDS)[keyof typeof PREVIEW_WARNING_KINDS];

export interface HtmlProjectSummary {
  projectId: string;
  name: string;
  entryFile: string;
  previewVersion: number;
  previewReady: boolean;
  files: HtmlProjectFileDescriptor[];
  fileCount: number;
  todoSummary: HtmlProjectTodoSummary;
  lastBuildError?: string | null;
  warnings: string[];
  previewDiagnostics: HtmlProjectPreviewDiagnostics;
  suggestedNextActionCategory:
    | 'bootstrap'
    | 'inspect'
    | 'resume_todos'
    | 'repair_preview'
    | 'finalize'
    | 'edit';
}

export interface HtmlProjectIntentDecision {
  intent: HtmlProjectIntent;
  confidence: HtmlProjectIntentConfidence;
  selectedPackSet: HtmlProjectToolPackName[];
  reason: string;
  requiresSummaryPreflight: boolean;
}

export interface HtmlProjectAgentTelemetryEvent {
  sessionId?: string | null;
  assistantId?: string | null;
  projectId?: string | null;
  provider: 'anthropic' | 'gemini' | 'openai_compatible' | 'unknown';
  intent: string;
  selectedPackSet: string[];
  toolSequence: string[];
  repeatedRecoverableErrors: Array<{
    toolName: string;
    code: string;
    count: number;
  }>;
  previewOutcome?: HtmlProjectPreviewOutcome;
  toolRounds: number;
  durationMs?: number;
  /** Harness 欄位 (G14):寫入 IndexedDB ring buffer (200 筆) 供成功率評估。*/
  runId?: string;
  turnIndex?: number;
  finishReason?: FinishReason;
  autoContinued?: boolean;
  abortReason?: string;
  runtimeDiagnosticState?: HtmlProjectRuntimeDiagnosticStatus;
  subagentTaskCount?: number;
}

export interface HtmlProjectWorkspaceUpdate {
  activeProjectId: string | null;
  preview: HtmlProjectPreviewArtifact | null;
  activityMessage: string;
}

export interface HtmlProjectToolExecutionResult {
  toolName: string;
  summary: string;
  result: Record<string, unknown>;
  workspace: HtmlProjectWorkspaceUpdate;
}

// ============================================================================
// Agentic Harness Contracts (Wave 0 / T0)
// 跨回合自主續跑、runtime 驗證、完成覆核、AbortSignal、loop 偵測。
// 詳見 .omc/plans/web-agentic-harness-html-projects-plan.md
// ============================================================================

/**
 * 單一回合/串流的結束原因。
 * - complete:模型自然結束 (純文字路徑或工具迴圈正常完成)
 * - tool-budget-exhausted:達到單回合工具輪上限 (不再 throw,G13)
 * - stop-route:recoverable error 升級到 stop-route (loopAction)
 * - aborted:AbortSignal 觸發 (G17)
 */
export type FinishReason = 'complete' | 'tool-budget-exhausted' | 'stop-route' | 'aborted';

/**
 * Harness 常駐工具名稱 (G2)。不綁 pack,任一 HTML pack 曝光即自動附加。
 * 工具實作在 htmlProjectToolService.ts (T4);名稱在 types.ts 統一定義供匯入。
 */
export type HtmlProjectHarnessToolName =
  | 'reportTurnOutcome'
  | 'getPreviewRuntimeErrors'
  | 'listSnapshots'
  | 'revertToSnapshot'
  | 'lintProject';

/** reportTurnOutcome 工具的回報結果 (G2/G4)。*/
export type ReportTurnOutcome = 'complete' | 'continue_needed';

export interface ReportTurnOutcomeResult {
  outcome: ReportTurnOutcome;
  todoSummary?: HtmlProjectTodoSummary;
  previewDiagnosticState?: HtmlProjectRuntimeDiagnosticStatus;
  notes?: string;
}

/** Agent run 狀態機 (T6)。*/
export type AgentRunStatus = 'running' | 'complete' | 'stopped' | 'failed' | 'aborted';

export interface AgentRunState {
  runId: string;
  projectId: string;
  sessionId?: string | null;
  assistantId?: string | null;
  status: AgentRunStatus;
  /** 當前續跑回合索引 (0-based)。*/
  turnIndex: number;
  /** 續跑預算上限;預設 5,shared mode 預設 1 (G9)。*/
  maxTurns: number;
  finishReason?: FinishReason;
  /** run 起始快照 version (G11)。*/
  snapshotVersion?: number;
  todoSummary?: HtmlProjectTodoSummary;
  previewDiagnosticState: HtmlProjectRuntimeDiagnosticStatus;
  abortReason?: string;
  /** 是否曾發生自動續跑 (供 telemetry)。*/
  autoContinued: boolean;
  /** 跨回合工具軌跡 (最近 N 個工具名稱,供 loop 偵測 G12)。*/
  toolTrace: string[];
  /** 上一次 loop 偵測是否觸發。*/
  loopDetected?: boolean;
  startedAt: number;
  updatedAt: number;
}

export interface AgentRunCheckpoint {
  schemaVersion: 1;
  runId: string;
  sessionId: string;
  assistantId: string;
  projectId: string | null;
  status: AgentRunStatus;
  turnIndex: number;
  maxTurns: number;
  originalMessage: string;
  committedHistoryDelta: ChatMessage[];
  partialText?: string;
  toolTrace: string[];
  todoSummary?: HtmlProjectTodoSummary;
  snapshotVersion?: number;
  firstTurnPackSet?: HtmlProjectToolPackName[];
  tokenTotals: {
    promptTokenCount: number;
    candidatesTokenCount: number;
  };
  agentHarnessEnabled: boolean;
  subagentDelegationEnabled?: boolean;
  /** HTML 專案模式開關快照,確保 resume 時維持與原回合一致的工具暴露。 */
  htmlProjectEnabled?: boolean;
  sharedMode: boolean;
  createdAt: number;
  updatedAt: number;
  heartbeatAt: number;
}

/**
 * RAG 設定介面 - 使用者可配置的全域 RAG 設定
 */
export interface RagSettings {
  /** 向量搜尋結果數量 (預設: 20) */
  vectorSearchLimit: number;
  /** 是否啟用重新排序 (預設: true) */
  enableReranking: boolean;
  /** 重新排序後保留的結果數量 (預設: 5) */
  rerankLimit: number;
  /** 最低相似度閾值 (預設: 0.3) */
  minSimilarity: number;
}

export interface EmbeddingConfig {
  timeoutSeconds: number; // Timeout for browser embedding in seconds
  fallbackToSimple: boolean; // Whether to fallback to simple text similarity
  showMethodUsed: boolean; // Show which embedding method was used (dev mode)
}

export interface EmbeddingResult {
  vector: number[];
  method: 'browser-webgpu' | 'browser-cpu' | 'simple';
  processingTime: number;
}
