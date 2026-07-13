# EduCare - 教育 AI 助理

**為財團法人博幼社會福利基金會設計的客製化教學聊天與 HTML 專案助理**

EduCare 是專為財團法人博幼社會福利基金會及其服務的偏鄉兒童打造的 AI 教育平台。除了個人化教學輔導與教材的 Retrieval-Augmented Generation (RAG) 之外，EduCare 現在還內建 **瀏覽器內 HTML 專案助理** —— 學生與老師只要描述需求，代理就會自動規劃、編輯檔案、執行靜態驗證、用瀏覽器內 git 留下快照、即時預覽成品。支援 7 家原生 LLM 供應商 (Gemini、OpenAI、Anthropic、OpenRouter、LM Studio、Ollama、Groq），使用 Turso DB 雲端持久化，並透過安全連結、QR 碼與離線匯出包三種方式分享。

## 🎯 專案使命

財團法人博幼社會福利基金會自 2002 年起致力於偏鄉弱勢兒童教育，透過課後輔導與教育資源分享，縮短城鄉教育差距。EduCare 運用 AI 技術提供：

- 📚 **個人化學習輔導** - 針對 PDF/DOCX/MD 教材的 RAG 檢索
- 🤖 **24/7 跨 7 家 LLM 供應商的輔導** - Gemini、OpenAI、Anthropic、OpenRouter、LM Studio、Ollama、Groq
- 🛠️ **HTML 專案助理** - 描述一個頁面，代理會寫檔、驗證、快照、預覽
- 📄 **多元教材支援** - PDF、DOCX、MD，智慧分塊與向量嵌入
- 🌐 **跨裝置同步** - Turso DB 雲端儲存 + IndexedDB 離線後備
- 🔗 **分享與交接** - QR 碼、安全連結、離線匯出、助理路由
- 📦 **離線優先** - 無需帳號也能使用；可將助理匯出為可攜式套件帶到任何裝置

## 🚀 快速開始

**系統需求：** Node.js 18+ 與 pnpm 11+

1. **安裝相依套件：**

   ```bash
   pnpm install
   ```

2. **設定環境變數：**
   複製 `.env.local` 並設定 Turso DB 憑證 (以及你想預設使用的 LLM API 金鑰）：

   ```bash
   TURSO_DATABASE_URL=...
   TURSO_AUTH_TOKEN=...
   ```

   各家 AI 供應商的金鑰 (Gemini、OpenAI、Anthropic、OpenRouter、LM Studio、Ollama、Groq) 也可以在 app 的「設定」面板中個別設定—— 不需要在環境變數中設定。

3. **初始化資料庫（選用）：**

   ```bash
   pnpm run init-turso
   ```

4. **啟動開發伺服器：**

   ```bash
   pnpm run dev
   ```

   應用程式會在 http://localhost:5173 執行。若需要測試瀏覽器加密與 secure-context API（HTML 專案沙盒需要這些），請使用 self-signed HTTPS 開發伺服器：

   ```bash
   pnpm run dev:https
   ```

   第一次開啟時瀏覽器會顯示自簽憑證警告；接受一次即可繼續本機測試。

## ✨ 主要功能

### 🎓 教學輔導

- **智慧問答與 RAG** - 上傳 PDF/DOCX/MD 教材；AI 從中檢索並以可展開的知識引文作答
- **背景知識蒐集器** - 串流回應時背景預先抓取引文，不阻塞 UI
- **個人化系統提示** - 為每位助理調整教學風格；對話歷史自動壓縮
- **串流回應** - 即時 token 串流，含思考指示器與中止控制
- **會話 token 追蹤** - 跨供應商記錄每場對話的 input/output/reasoning/cache token

### 🛠️ HTML 專案助理 _(全新)_

以 **LightningFS + isomorphic-git** 為基礎的完整瀏覽器內 IDE 工作流程：

- **瀏覽器原生 git** - 在 IndexedDB-backed 虛擬檔案系統裡跑真正的 git，支援 commit、branch、diff
- **檔案樹 + 即時預覽** - 編輯 `html` / `css` / `js` / `json` / `svg` / `asset`；在沙盒化 iframe 中即時預覽
- **代理工具包** - bootstrap (`createProject`)、inspect (`listFiles`/`readFile`)、edit (`writeFiles`/`replaceInFile`/`modifyLinesInFile`/`copyFile`/`renameFile`)、todo (`addTodo`/`updateTodo`/...)、git (`gitStatus`/`gitLog`/`gitDiff`/`gitCommit`/...)、harness-resident (`reportTurnOutcome`/`getPreviewRuntimeErrors`/`listSnapshots`/`revertToSnapshot`/`lintProject`)
- **靜態驗證** - 寫入時透過 acorn + css-tree + parse5 + csstree-validator 解析 HTML/CSS/JS/JSON;在同回合回報行/欄/片段給代理
- **VFS 沙盒預覽** - manifest 嵌入模組、單管道 `buildArtifact`、runtime 錯誤擷取 (50 筆環狀緩衝區）、ready-ack 交握
- **快照與還原** - 每個專案最多 20 個快照；還原時檔案復原並遞增 `previewVersion`
- **ZIP 匯出** - `pnpm run create-test-data` 與側邊欄專案管理員可匯出完整 ZIP
- **助理層級開關** - 在需要此功能的助理範本上啟用 HTML 專案模式 (例如新加入的 HTML Dev Agent 範本)

### 🤖 Agentic Harness _(全新)_

多回合代理編排與檢查點還原：

- **AgentRunController** - 先規劃、收尾再覆核、可從可恢復的工具錯誤中復原、判定「還需要再做」時自動續跑
- **檢查點與還原** - 將回合狀態寫入 IndexedDB；在頁面重新載入或回合失敗時接續
- **迴圈偵測 (G12)** - 收緊為「真正連續」的多回合，避免誤判
- **子代理委派** - 批次派出子代理平行執行任務；活動會顯示在 `AgentActivityTimeline` 中
- **意圖式工具策略** - 根據 `new_build` / `resume_project` / `inspect_only` / `targeted_edit` / `finalize` 意圖動態產生提示與工具集合
- **中止訊號** - 從 UI → controller → LLM adapter → 上游供應商一路傳遞

### 💬 Chat UI 五階段重構

- **P1 正確性** - 版面穩定、canvas 收合後聊天寬度不再跑掉
- **P2 無障礙** - 鍵盤導覽、觸控狀態、ARIA、色對比修正
- **P3 視覺語言** - 統一的間距、字級、深色模式細節
- **P4 虛擬化** - 對話歷史使用 `react-virtuoso` 處理長對話
- **P5 starter prompts** - 空狀態顯示預設提示，儲存時一併寫入 Turso

### 👩‍🏫 教師工具

- **助理管理** - 建立/編輯助理 (名稱、描述、系統提示、RAG 塊、starter prompts、可選的子代理委派開關)
- **教材整合** - `RAGFileUpload` 將檔案處理為帶有向量嵌入的塊，寫入 Turso
- **分享協作** - `ShareModal` 產生 QR 碼與連結，支援公開/私人模式
- **加密供應商設定分享** - 把完整 LLM 供應商設定 (含金鑰，加密) 分享給其他老師
- **離線匯入/匯出** - `assistantPackageService` 產生可攜式 `.json` 套件—— 不用 Turso 也能帶到另一台裝置
- **路由與交接** - 助理 A 在主題切換時可提議把對話交給助理 B；使用者同意後，對話與摘要一起移轉

### 🛡️ 安全與效能

- **加密儲存** - API 金鑰與供應商設定在寫入 Turso 之前由 `cryptoService` 加密
- **安全 RNG** - 所有安全相關的隨機數使用 `crypto.getRandomValues()` (不再用 `Math.random()`)
- **Turso 憑證** - 透過 `import.meta.env` 注入，絕不寫進 bundle
- **HTML 專案隔離** - 工具層拒絕 path traversal，handler 派送前先驗證輸入
- **效能** - 嵌入模型在背景下預載，`html-git` 拆出獨立 chunk 維持主 bundle 大小，聊天清單虛擬化

## 🏗️ 技術架構

- **前端** - React 19.1 + TypeScript + Vite 6
- **狀態** - React Context (`AppContext`) + hooks；無外部狀態庫
- **資料庫** - Turso DB (雲端 SQLite) + IndexedDB 後備
- **AI** - 7 家原生配接器；全部支援工具呼叫與多回合對話
- **HTML 專案儲存** - IndexedDB (`htmlProjectStore`) + LightningFS + isomorphic-git
- **靜態驗證** - acorn (JS) + css-tree + csstree-validator (CSS) + parse5 (HTML) —拆出獨立 chunk
- **代理迴圈** - `AgentRunController` → `llmService` → 供應商 adapter → 工具執行器 → `htmlProjectStore`
- **RAG 管線** - `documentParserService` → `textChunkingService` → `embeddingService` (HuggingFace) → `tursoService` (向量) → `knowledgeSearchService` (LLM 工具式檢索)
- **預覽** - VFS 沙盒 bridge，`PreviewFrame` iframe 以 `postMessage` 擷取 runtime 錯誤
- **路徑別名** - `@/*` → 專案根目錄

### 資料模型 (`types.ts` 摘要)

- **Assistant** —id, name, description, systemPrompt, ragChunks, starterPrompts, subagentDelegationEnabled?, routableAssistantIds?
- **ChatSession** —id, assistantId, messages, tokenUsage, activeProjectId?, compactContext?, handoffContext?
- **ChatMessage** —role, content, timestamp?, isError?, agentTurnLog?, toolCallLog?, subagentRuns?, citations?, routeProposal?
- **HtmlProject** —id, assistantId, sessionId?, name, entryFile, status, previewVersion, files, todos, snapshots, runtimeDiagnostics
- **AgentRunCheckpoint** —跨重新載入儲存；schemaVersion 1
- **RouteProposal** —pending / accepted / declined / failed 助理交接
- **TokenUsageTotals** —input / output / cache-creation / cache-read / reasoning / tool tokens

## 🛠️ 開發指令

| 指令                             | 說明                                               |
| -------------------------------- | -------------------------------------------------- |
| `pnpm run dev`                   | 啟動 HTTP 開發伺服器                               |
| `pnpm run dev:https`             | 啟動 self-signed HTTPS 開發伺服器 (沙盒需要)       |
| `pnpm run build`                 | 建置正式版本                                       |
| `pnpm run build:analyze`         | 建置並開啟 bundle 視覺化報告                       |
| `pnpm run preview`               | 預覽正式版本                                       |
| `pnpm run typecheck`             | TypeScript 嚴格型別檢查                            |
| `pnpm run lint`                  | ESLint                                             |
| `pnpm run lint:fix`              | 自動修復 lint 問題                                 |
| `pnpm run format`                | Prettier 寫入                                      |
| `pnpm run format:check`          | Prettier 檢查 (不寫入)                             |
| `pnpm run test`                  | 執行 Vitest 單元與整合測試                         |
| `pnpm run test:watch`            | Vitest watch 模式                                  |
| `pnpm run test:ui`               | Vitest UI                                          |
| `pnpm run test:coverage`         | Vitest 覆蓋率報告                                  |
| `pnpm run test:e2e`              | Playwright E2E (JSON reporter)                     |
| `pnpm run test:e2e:ui`           | Playwright UI                                      |
| `pnpm run test:model-comparison` | 模型比較 Playwright 規格                           |
| `pnpm run quality`               | typecheck + lint + format:check + test             |
| `pnpm run init-turso`            | 初始化 Turso 資料庫                                |
| `pnpm run migrate-to-turso`      | 遷移資料到 Turso                                   |
| `pnpm run update-turso-schema`   | 更新 Turso schema                                  |
| `pnpm run cleanup-turso-schema`  | 清理 Turso 舊欄位                                  |
| `pnpm run create-test-data`      | 植入測試資料                                       |
| `pnpm run test-vector-search`    | 手動測試向量搜尋                                   |
| `pnpm run test-sharing`          | 手動測試分享                                       |
| `pnpm run deploy`                | 建置並部署到 GitHub Pages (boyofoundation/educare) |

## 📁 專案結構

```
educare/
├── App.tsx                       # 主應用 shell
├── index.tsx                     # 進入點
├── types.ts                      # 核心 TS 契約
├── components/
│   ├── assistant/                # AssistantCard / Editor / List / ShareModal / TemplateSelector / RAGFileUpload
│   ├── canvas/                   # HtmlProjectWorkspace / FileTree / PreviewFrame / AgentRunPanel / ProjectPicker
│   ├── chat/                     # ChatContainer / ChatInput / MessageBubble / StreamingResponse / AgentActivityTimeline / MarkdownContent / WelcomeMessage
│   ├── core/                     # AppShell / AppContext / Layout / ErrorBoundary / ModelLoadingOverlay
│   ├── settings/                 # ProviderSettings / ProviderSettingsShareModal / ApiKeySetup / CacheManagement / RagSettingsModal
│   ├── ui/                       # Button / Modal / Sidebar / CustomSelect / Icons
│   └── features/                 # SharedAssistant (公開分享入口頁)
├── services/
│   ├── agentRunController.ts     # 多回合代理編排 + 檢查點
│   ├── agentRunCheckpointService.ts  # IndexedDB 檢查點持久化
│   ├── llmService.ts             # 供應商中性的 chat + 工具迴圈 + 子代理派送
│   ├── llmAdapter.ts             # 供應商介面
│   ├── providers/                # 原生配接器:gemini / openai / anthropic / openrouter / lmstudio / ollama / groq
│   ├── providerRegistry.ts       # Singleton registry + 懶載入
│   ├── htmlProjectStore.ts       # IndexedDB + LightningFS + git 快照
│   ├── htmlProjectGitService.ts  # isomorphic-git 包裝
│   ├── htmlProjectToolService.ts # 所有 HTML 專案工具實作
│   ├── htmlProjectPrompting.ts   # 工具包 + 意圖分類 + 沙盒提示
│   ├── staticValidationService.ts# acorn/css-tree/parse5 驗證器
│   ├── htmlPreviewService.ts     # VFS 沙盒建置 + manifest
│   ├── previewRuntimeDiagnostics.ts  # iframe postMessage 擷取
│   ├── embeddingService.ts       # HuggingFace transformers
│   ├── knowledgeSearchService.ts # LLM 工具式知識搜尋
│   ├── knowledgeGatherService.ts # 背景下引文預取
│   ├── assistantRoutingService.ts# 路由提案 + 交接上下文
│   ├── assistantPackageService.ts# 離線匯入/匯出
│   ├── tursoService.ts           # 雲端 SQLite
│   ├── queryCacheService.ts      # RAG 查詢快取
│   ├── cryptoService.ts          # 金鑰與分享 payload 的 AES 加密
│   ├── chatCompactorService.ts   # 對話壓縮
│   └── ... (60+ 個 services)
├── scripts/                      # Turso 設定、遷移、模型比較、驗證
├── tests/e2e/                    # Playwright (chat、model-comparison、vfs-preview)
├── public/                       # 靜態資產
├── docs/                         # 內部文件
├── hooks/                        # 自訂 React hooks
├── CLAUDE.md                     # Claude Code 開發指南 (專案慣例)
├── AGENTS.md                     # 代理指示
└── package.json
```

## 🔧 品質保證

- **ESLint + Prettier** - flat config、react-hooks 規則、prettier 整合
- **TypeScript** - strict mode
- **Vitest + React Testing Library** - 1100+ 個單元與整合測試；`tests/e2e/` 為 Playwright
- **Husky + lint-staged** - 預提交 format + lint
- **品質關卡** - `pnpm run quality` 在合併前跑 typecheck + lint + format:check + test

## 🌟 近期更新 (2025-09-12 之後)

### HTML 專案助理

- 瀏覽器內 git (LightningFS + isomorphic-git)，支援 branch、diff、snapshot
- 6 個 git 代理工具、5 個 harness-resident 工具，加上 bootstrap/inspect/edit/todo/preview_recheck 工具包
- VFS 沙盒預覽，含 runtime 錯誤擷取 (50 筆環狀緩衝區)
- 透過 acorn + css-tree + parse5 + csstree-validator 做靜態驗證
- 每專案 ZIP 匯出
- starter 範本新增 HTML Dev Agent

### Agentic Harness

- AgentRunController 採「先規劃 / 收尾覆核 / 意圖韌性」
- 透過 IndexedDB 做檢查點與還原 (跨頁面重載與回合失敗皆可接續)
- 子代理委派，UI 用 `AgentActivityTimeline` 取代舊的 `SubagentActivityCard` / `ToolCallCard`
- 迴圈偵測收緊為真正連續的多回合
- 中止訊號一路傳到 LLM 供應商
- 200 筆 telemetry 環狀緩衝區供成功率分析

### Chat UI

- 五階段重構：正確性、無障礙、視覺、虛擬化 (react-virtuoso)、starter prompts
- canvas ↔ chat 版面穩定
- Markdown 渲染含語法醒目標示與行號 (rehype-highlight)

### RAG

- 背景知識蒐集器 (抓引文時不擋 UI)
- 可展開的知識引文，帶 chunk ID 指紋
- LLM 工具式知識搜尋取代直接向量檢索
- 查詢快取服務
- 引文快取與 abort-signal 傳遞

### 多供應商支援

### 路由與分享

#### Agent 協作包：本機 JSON 分享

需要由接待助理分流給多位專業助理時，可把它們打包成單一 `.educare-bundle.json`。預設協作包會帶入所選助理的 system prompt、純文字知識片段、starter prompts 與允許的路由關係，**不會帶入服務商憑證**。只有匯出者在匯出時明確選擇，才會建立隨附一組密碼加密服務商設定的 schema-v2 協作包。

**60 秒匯入圖解**

1. 在側邊欄按 **匯入協作包**，拖放 JSON、選擇檔案或直接貼上 JSON。
2. 檢查預覽卡：可看名稱、角色說明、入口、知識庫大小；system prompt 與服務商金鑰都不會顯示。
3. 按 **啟用協作包**。資料只存在目前瀏覽器的 IndexedDB，開啟的 `?bundle=` 是本機識別碼，不是可轉傳的分享網址。
4. 預設協作包請設定自己的 AI 金鑰。預設 **僅本次**（sessionStorage、關閉分頁即清除）；只有主動選擇才會記住在此瀏覽器。
5. 若是含加密服務商設定的 schema-v2 協作包，請從匯出者以另一條安全管道取得密碼，解鎖後再明確確認使用。解密後設定只留在記憶體，不會寫入瀏覽器儲存空間；重新開啟或重新載入協作包時，必須再次輸入密碼。也可以改用自己的服務商。
6. 與接待助理對話；符合包內允許路由時會自動轉接，訊息列可展開查看轉接依據與摘要。

**建立與安全界線**

- 在助理清單按 **打包協作包**，選至少兩位助理、指定單一接待入口、設定路由與條件，通過自檢後下載 JSON。
- 預設匯出使用不含憑證的協作包 schema。若要隨附一組已設定服務商，匯出者必須在匯出時主動勾選、選擇該服務商並設定保護密碼；此選擇會產生 schema version 2。設定會加密，JSON 不會寫入明文金鑰。
- 保護密碼必須與協作包分開，以另一條安全管道傳送。不要把密碼放在檔名、協作包中繼資料、`?bundle=` 網址，或與 JSON 相同的訊息或儲存位置。
- 匯入不會覆寫既有助理；刪除協作包只會清理該包命名空間下的對話紀錄。
- 知識庫是 `{ fileName, content }` 純文字 chunk，匯入後由既有 agent 自主文字搜尋與引用機制使用，無模型下載或重嵌入流程。任何協作包都不會帶入伺服器憑證，包括 Turso 憑證。
- 外來協作包含可影響模型行為的 prompt，請先看預覽。含憑證的協作包屬於敏感資料：同時取得 JSON 與密碼的人即可使用隨附服務商設定；無法遠端撤銷或收回。若發生外洩，請輪替受影響服務商的憑證。需要時請使用自己可控的金鑰，並不要把 `?bundle=` 網址當成跨裝置分享方式。

### 平台

### 安全

## 🤝 貢獻指南

請參考 [CLAUDE.md](./CLAUDE.md) 中的專案慣例。送 PR 前請執行：

```bash
pnpm run quality
```

## 📄 授權

MIT 授權 ～ 詳見 [LICENSE](LICENSE)。

---

**財團法人博幼社會福利基金會 × 教育科技創新**  
讓每個孩子都有平等的學習機會 🌟
