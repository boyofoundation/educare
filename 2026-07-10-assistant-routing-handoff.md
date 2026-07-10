# Assistant Routing / Handoff（助理轉接）實作計畫

- **狀態**: pending approval（Critic 兩輪審查通過：REVISE → 修訂 → gap review **ACCEPT**）
- **日期**: 2026-07-10（v3）
- **審查記錄**: 見文末 Changelog

## Context

EduCare 的每個 AI 助理各有專長（systemPrompt + RAG 知識庫）。使用者常問錯助理，尤其分享模式的訪客（如基金會學生）不知道該找哪個助理。本功能新增 `routeToAssistant` 工具：助理判斷自己不適合當前問題時提出轉接建議，使用者確認後帶著 handoff 摘要切換到目標助理的新 session。

## 需求摘要（已與使用者訪談確認）

| 決策點   | 定案                                                                   |
| -------- | ---------------------------------------------------------------------- |
| 脈絡銜接 | **Handoff 摘要**：在目標助理下開新 session，注入轉接摘要；不搬完整歷史 |
| 路由範圍 | **手動白名單**：AssistantEditor 勾選 `routableAssistantIds`            |
| 切換 UX  | **使用者確認制**：聊天中卡片，確認才切換，可拒絕                       |
| 分享模式 | **納入第一期**：目標未分享則靜默降級（不暴露該目標）                   |

## 現況事實（codebase 佐證，經 Critic 逐項查核 ~95% 準確）

1. **工具註冊前例**：`delegateToSubagents` — 宣告與 guardrails 在 `services/subagentService.ts:505-517`；enum 參數前例 `:492`；recoverable error 模式 `:534`；per-assistant opt-in `types.ts:43`。
2. **主回合工具組裝**：`services/llmService.ts` — `StreamChatParams`（:42-51）、系統提示注入（:394）、tool 分派（:439，`executeTool` closure 支援資訊性 tool result）、工具清單（:551）。
3. **Controller 層（v1 遺漏，Critic 補正）**：`ChatContainer.tsx:455-489` 建構 `AgentRunController`（`agentRunController.ts:465` 才呼叫 streamChat）；controller 在 `:236-237` 對 subagentDelegation 於 sharedMode 強制停用；checkpoint 快照 feature flags（`:315-317,348`；resume 還原 `ChatContainer.tsx:463-467`）；分享模式 `maxTurns` 預設 1（`:202`）。
4. **助理切換與 session**：`AppContext.tsx:235`（selectAssistant，`:237-238` 對不存在 id 靜默 no-op）、`:218`（createNewSession）。
5. **分享模式雙路徑（v1 遺漏，Critic 補正）**：實際載入元件是 `components/features/SharedAssistant.tsx`——`AppShell.tsx:128-132` 渲染（無 key prop）；`loadedRef`/`loadingRef` 去重（`SharedAssistant.tsx:14-15,26-29,83`）使 assistantId prop 變更後**不會重新載入**；每次載入無條件建全新空 session（`:57-70`，`shared_${Date.now()}`），從不回讀舊 session。`AppContext.loadSharedAssistant`（:303-340）疑似平行/遺留路徑。URL `?share=`+`keys`（加密金鑰）流程在 `AppContext.tsx:496-524`。
6. **持久化分歧**：本地 IndexedDB 存整個 Assistant 物件（`services/db.ts:51-54`）→ 新欄位免遷移；Turso `assistants` 表僅五欄（`tursoService.ts:83-92`），`saveAssistantToTurso`（:144，INSERT/UPDATE 兩分支）不帶擴充欄位 → 分享模式路由**必須擴充 Turso schema**。`getAssistantFromTurso`（:255-296）會 Promise.all 抓全部 rag_chunks（:263-272）。既有遷移模式：`scripts/addDescriptionField.ts:17-30` 用 PRAGMA table_info 檢查後 ALTER。`scripts/migrateToTurso.ts:22` 會無條件上推助理（不看 shared 旗標）。
7. **訊息級卡片與合成訊息前例**：`ChatMessage.subagentRuns`（types.ts:113）、`synthetic`（:109）；compactContext 後綴注入在 `ChatContainer.tsx:442-446`。

## 核心設計

```
Assistant A 對話中
  └─ LLM 呼叫 routeToAssistant({ targetAssistantId, reason, handoffSummary })
       └─ 工具執行器「不切換」，只驗證並記錄 RouteProposal
            ├─ tool result 告知模型：「建議已呈現，請收尾，本 run 勿再呼叫」
            └─ onRouteProposal callback 穿過 AgentRunController 上拋
                 └─ ChatContainer 掛到 model 訊息（ChatMessage.routeProposal）
                      └─ MessageBubble 渲染卡片：〔轉接至 B〕〔留在原助理〕
                           ├─ 拒絕 → status='declined'，對話照舊
                           └─ 確認 → AppContext.acceptRouteProposal()
                                ├─ 本地：selectAssistant + createNewSession + handoffContext
                                └─ 分享：pendingHandoffSession + SET_SHARED_MODE(B) + 保留 keys
```

關鍵決策：`targetAssistantId` 在 tool schema 用 **enum 鎖白名單**（比 prompt 約束可靠）。**每個 agent run（每則使用者訊息）最多一次 proposal**——同 run 內再呼叫回傳 recoverable error，避免多 turn run 出現多張矛盾卡片。

## 資料模型（types.ts）

```ts
// Assistant（:27-44）
routableAssistantIds?: string[];   // 空/未定義 = 不暴露工具

interface RouteProposal {
  targetAssistantId: string;
  targetAssistantName: string;     // 快照，目標事後被刪仍可顯示
  reason: string;                  // 給使用者（clamp 200 字元）
  handoffSummary: string;          // 給目標助理（clamp 2000 字元）
  sourceAssistantId: string;
  sourceSessionId: string;
  status: 'pending' | 'accepted' | 'declined' | 'failed';
  createdAt: number;
}

// ChatMessage（:89，比照 subagentRuns :113）
routeProposal?: RouteProposal;

// ChatSession（:166）
handoffContext?: {
  fromAssistantId: string; fromAssistantName: string;
  reason: string; summary: string;
  sourceSessionId: string; createdAt: number;
};
```

## 實作步驟

### Phase A — 核心路由（本地模式）

1. **types.ts**：上述欄位與型別。
2. **新檔 `services/assistantRoutingService.ts`**（比照 subagentService 結構）：
   - `ROUTE_TOOL_NAME = 'routeToAssistant'`；`buildRouteToAssistantTool(targets)`（enum 白名單）；`buildRoutingSystemPrompt(targets)`（清單 + 指引：僅在明顯超出專長時建議、摘要只含使用者問題與已嘗試事項、被拒後本 session 勿再提議同一目標）；`validateRouteCall`（白名單 + 長度 clamp，錯誤沿用 `createRecoverableToolError`）。
   - `resolveRoutableTargets(assistant, mode)`：本地從 `state.assistants` 過濾；分享模式見 Phase B。
3. **services/llmService.ts**：
   - `StreamChatParams`（:42）加 `routableTargets?: Array<{id; name; description}>` 與 `onRouteProposal?: (p: RouteProposal) => void`。
   - 系統提示注入（:394 同段）、tool 分派（:439 同段）、工具清單（:551 同段）。
   - 同 run 第二次呼叫 → recoverable error。工具**不**傳入 subagent（`buildSubagentTools` 不動）。
4. **services/agentRunController.ts**：
   - options 加 `routableTargets`、callbacks 加 `onRouteProposal`，透傳至 streamChat。
   - **注意**：:236-237 對 `subagentDelegation` 的 sharedMode 強制停用邏輯**不**套用到路由（分享模式是本功能的第一期目標）。
   - **checkpoint**：`routableTargets` 比照 `subagentDelegationEnabled`（ChatContainer.tsx:463-467 resume 還原模式；controller :315-317,348 快照寫入）進 checkpoint payload 與 resume 還原。中斷時已上拋但未存檔的 pending proposal 不進 checkpoint（resume 後重新提議即可）。
5. **components/chat/ChatContainer.tsx**：解析 targets 傳入 controller options（:455-489 建構處）；`onRouteProposal` 把 proposal 掛到本回合 model 訊息並存 session。
   - **handoff 注入位置**：systemPrompt 組裝順序 = assistant systemPrompt → handoff 區塊 → compactContext 後綴（:442-446 既有邏輯之前插入）。
6. **components/chat/MessageBubble.tsx**：`RouteProposalCard`——`pending` 顯示〔轉接〕〔留在原助理〕；`accepted`/`declined`/`failed` 顯示結果標記。本地模式 reload 後 `pending` 卡片仍可操作。
7. **components/core/AppContext.tsx**：`acceptRouteProposal` / `declineRouteProposal`：
   - accept（本地）：目標仍存在 → `selectAssistant`（:235）+ `createNewSession`（:218）+ 寫入 `handoffContext`；目標已被刪（:237-238 會靜默 no-op）→ 顯示錯誤提示、proposal 標記 `failed`。
   - decline：更新 status 並存 session。
8. **轉接橫幅**：ChatWindow 頂部顯示可摺疊的「由 X 轉接而來」橫幅（`handoffContext` 存在時），列入驗收與測試。
9. **components/assistant/AssistantEditor.tsx**：「可轉接助理」checkbox 清單（排除自己），提示分享模式需目標也被分享。

### Phase B — 分享模式

10. **services/tursoService.ts**：
    - `assistants` 表（:83）加 `config_json TEXT` 欄。遷移沿用 `scripts/addDescriptionField.ts:17-30` 的 **PRAGMA table_info 檢查後 ALTER** 模式，掛在 `initializeDatabase`（owner 開新版 app 時執行，AppContext.tsx:268-270）。
    - `saveAssistantToTurso`（:144，INSERT 與 UPDATE 兩分支都要）：序列化 `{ routableAssistantIds, starterPrompts, subagentDelegationEnabled }` 進 `config_json`（順手修復既有欄位不隨分享的缺口）。
    - `getAssistantFromTurso`（:255-296）：反序列化；`config_json` NULL 優雅退化。
    - **新增輕量查詢** `getAssistantMetaFromTurso(id)`：只取 `id/name/description/config_json`，**不**載 rag_chunks（既有函式會抓全部知識庫，只為建 enum 太重）。
11. **分享模式目標解析**（assistantRoutingService）：逐一 `getAssistantMetaFromTurso`；成功才列入，失敗靜默排除。以 session 為單位快取；解析未完成或失敗時該回合先不暴露工具（不阻塞聊天）。
    - **語意註記**：「存在於 Turso」是「可被訪客路由」的**近似判準**——`migrateToTurso.ts:22` 會無條件上推助理，若曾執行，判準會寬於 owner 的實際分享意圖。可接受：目標仍須具備 `config_json` 路由配置且在來源白名單內才會出現。
12. **分享模式切換**（v1 Blocker 的具體修法）：
    - **`components/features/SharedAssistant.tsx`**：
      - `loadedRef`/`loadingRef` 去重（:14-15,26-29,83）改為 **assistantId 變更時重置**，且重置須在 load effect 之前生效——於 `loadSharedAssistant` 進入點以 `assistantId` 比對前值後重置，或宣告在 load effect **之前**的獨立 effect（誤放在守衛檢查之後會重新引入「Skipping duplicate load」，B 不會載入）。備案：AppShell.tsx:128-132 加 `key={assistantId}` 強制 remount（會整棵閃爍，次選）。
      - context 解構由 `{ dispatch }`（:13）擴為含 state；`pendingHandoffSession` 於**消費點即時**從 context state 讀取（或經 ref），**不**透過 `loadSharedAssistant` 的 useCallback 閉包捕捉（deps `[assistantId, checkApiKey, dispatch]` 不含它，閉包引用會 stale）。
    - **AppContext 加 `pendingHandoffSession` state**：`acceptRouteProposal`（分享分支）先建好含 `handoffContext` 的 session 存入此 state，再 dispatch `SET_SHARED_MODE(B)` + `history.replaceState` 更新 `?share=`（**保留 `keys` 參數**，:496-506 流程）。`SharedAssistant` 載入完成時（:57-70 原本無條件建空 session）改為：`pendingHandoffSession` 存在則採用它並清空 state，否則維持原行為。（時序已驗證：React 19 auto-batching 下兩個 dispatch 同 commit；`SET_SHARED_MODE` reducer（:96-101）不清 currentSession，無競態。）
    - 順手確認 `AppContext.loadSharedAssistant`（:303-340）是否為與 SharedAssistant.tsx 重複的遺留路徑；若是，加註解標明以 SharedAssistant.tsx 為準（本計畫不動它）。
13. **components/assistant/ShareModal.tsx**：分享含 `routableAssistantIds` 的助理時提示「目標未分享則訪客端不會出現轉接選項」。（「一鍵連同目標分享」列 backlog——多目標含 RAG chunks/embeddings 上傳的耗時與失敗處理需另行設計。）

### Phase C — 測試（依 CLAUDE.md 委派 test-automator agent）

14. `services/assistantRoutingService.test.ts`：enum 宣告、白名單驗證、clamp、prompt 組裝、本地/分享目標解析（Turso mock）、降級排除、session 快取。
15. `services/llmService.test.ts` 增補：targets 空不暴露工具、同 run 重複呼叫 recoverable error、`onRouteProposal` 上拋。
16. `services/agentRunController.test.ts` 增補：routableTargets 透傳、checkpoint 快照/resume 還原、sharedMode 下路由不被停用。
17. `components/chat/__tests__/MessageBubble.test.tsx` 增補：四種 status 卡片渲染與按鈕行為。
18. AppContext / SharedAssistant 測試：accept 切換 + handoffContext 寫入、目標已刪 → failed、decline 不切換、pendingHandoffSession 被 SharedAssistant 採用、**assistantId 變更後 loadedRef 已重置且 B 確實重新載入**（直接守住步驟 12 的回歸風險）。
19. tursoService 測試：config_json round-trip、NULL 退化、getAssistantMetaFromTurso 不觸發 rag_chunks 查詢。

## 驗收標準（可測）

1. `routableAssistantIds=[B]` 的助理 A，其回合工具清單含 `routeToAssistant` 且 enum 僅含 B；名單空的助理完全不暴露。
2. 工具呼叫後出現含目標名與原因的卡片；模型當回合正常收尾（不切換、不中斷串流）。
3. 〔轉接〕後：currentAssistant 變 B、新 session 首回合 systemPrompt 含 handoff 區塊（assistant prompt 之後、compact 後綴之前）、ChatWindow 顯示轉接橫幅、來源卡片標「已轉接」。
4. 〔留在原助理〕後不切換，卡片標「已婉拒」，原對話可續。
5. **（本地模式）** reload 後卡片依 persisted status 重現；pending 仍可操作。分享模式 handoffContext 僅存活於當前瀏覽階段（與既有訪客 session 行為一致，SharedAssistant 每次載入建新 session）。
6. 白名單外的目標 id → recoverable error，模型續答不 crash；目標已刪時按〔轉接〕→ 錯誤提示 + 卡片標 failed。
7. 分享模式：A、B 均已分享 → 訪客可完成轉接、`?share=` 更新、`keys` 保留、新 session 含 handoffContext；B 未分享 → targets 不含 B（全空則不暴露工具），無錯誤洩漏 B 的存在。
8. 同一 agent run 內第二次呼叫 → recoverable error，UI 只有一張卡片。
9. subagent 永不取得 `routeToAssistant`；checkpoint resume 回合的工具集與中斷前一致。
10. `pnpm run quality` 全綠。

## 風險與緩解

| 風險                                                     | 緩解                                                                                                     |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 乒乓轉接 / 過度熱心                                      | 確認制主閘門 + prompt 指引 + 每 run 限一次                                                               |
| SharedAssistant 載入競態（切換時舊載入未完成）           | pendingHandoffSession 由載入完成端消費，天然序列化；loadingRef 重置涵蓋                                  |
| pendingHandoffSession stale-closure                      | 消費點即時讀 context state / ref，不進 useCallback 閉包（步驟 12 明訂）                                  |
| Turso ALTER 相容性                                       | PRAGMA 檢查模式；NULL 退化；遷移依賴 owner 開新版 app——舊 owner 分享的助理在訪客端等同無路由配置，可接受 |
| 分享切換遺失 `keys`                                      | acceptRouteProposal 明確搬運；驗收 7 覆蓋                                                                |
| 目標事後刪除/改名                                        | 解析時過濾 + 卡片存名稱快照 + failed 狀態                                                                |
| handoffSummary 洩漏來源 systemPrompt                     | prompt 指引限定摘要內容 + clamp 2000                                                                     |
| 分享模式逐一查 Turso 延遲                                | 輕量 meta 查詢 + session 快取 + 不阻塞聊天                                                               |
| 分享模式 maxTurns=1（agentRunController.ts:202）截斷收尾 | 測試明確驗證訪客端工具呼叫後收尾文字完整                                                                 |
| compaction 吃掉 routeProposal 卡片                       | 與 subagentRuns 同命運（隨訊息移出），明文可接受                                                         |

## 驗證步驟

1. `pnpm exec vitest run services/assistantRoutingService.test.ts` + 既有套件全綠；`pnpm run quality`。
2. 手動 E2E（本地）：A/B 兩助理 → A 白名單勾 B → 問 B 專長問題 → 卡片 → 確認 → 落在 B 新 session、見橫幅、B 回答引用摘要。
3. 手動 E2E（分享）：分享 A、B → `?share=A` 訪客視窗 → 轉接 → URL 變 `?share=B` 且 keys 保留、對話正常；只分享 A → 無轉接選項。
4. 回歸：無配置的既有助理、既有分享連結、subagent 委派、checkpoint resume 行為皆不變。

## Backlog（不在本期）

- 自動切換模式（autoRoute 開關）、轉回上一個助理、摘要+最近 N 則混合、路由分析、ShareModal 一鍵連同目標分享（含進度 UI）

## Changelog

- **v1**（2026-07-10）：初版，經訪談定案四項產品決策。
- **v2**（同日）：Critic 審查裁定 REVISE（1 Blocker + 3 Major + 6 Minor + 2 Ambiguity）。全數併入：SharedAssistant.tsx 切換修法（Blocker）、AgentRunController 接縫與 checkpoint、AC5 範圍註記、PRAGMA 遷移模式、getAssistantFromTurso 正名、輕量 meta 查詢、failed 狀態、每 run 限一次、handoff 注入位置、一鍵分享降 backlog。
- **v3**（同日）：Critic gap review 裁定 **ACCEPT**（12/12 已解決，pendingHandoffSession 時序驗證相容）。併入 3 個 non-blocking 補丁：stale-closure 防護（步驟 12）、loadedRef 重置位置（步驟 12）、presence-in-Turso 語意註記（步驟 11）、loadedRef 重置回歸測試（測試 18）。
