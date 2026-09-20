# EduCare 改善分析與執行順序

日期：2026-09-20。分析基準：`52d92b5`。本次交付為分析及兩份可執行計畫；計畫內的功能尚未實作。

- 第一優先：[UI／UX 改善計畫](./2026-09-20-uiux-plan.md)。
- 第二優先：[功能改善計畫：前端與本機資料優先](./2026-09-20-functionality-plan.md)。

## 需求與結論

先降低老師與學生的操作負擔，再補齊資料可靠性與教學工作流程。核心使用路徑維持 React 靜態網站＋瀏覽器儲存，**不新增自建後端、雲端資料庫或帳號系統為必備依賴**。既有 Turso 分享保留為選用功能。

現況已經具備助理模板、starter prompts、串流聊天、圖片輸入、語音、數學工具、教材搜尋、協作包、HTML 專案與中斷續跑。改善應沿用這些能力，避免重做既有功能。依據：`components/chat/ChatInput.tsx:43`、`components/chat/WelcomeMessage.tsx:34`、`components/assistant/TemplateSelector.tsx:1`、`services/agentRunCheckpointService.ts:125`、`services/htmlProjectStore.ts:453`。

使用者假設：主要是備課／製作教材的教師，以及使用助理的學生，來自 `README_zhtw.md:3`。尚未訪談真實使用者；以下優先序是程式與操作檢查所得的產品判斷，不代表已測得使用者流失率。

## 證據與排序

「事實」指程式或本次瀏覽器直接觀察；「推論」指待驗證的使用影響。P0 為第一批，P1 為接續交付，P2 為增強項目。信心評級針對發現本身，不等於效益已被量測。

| 優先 | 發現與影響                                                                                                  | 證據／信心                                                                                                                                        | 對應計畫 |
| ---- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| P0   | 首次使用直接進完整助理表單；系統提示、子代理等進階設定與基本設定並列。推論：新手難判斷下一步                | 事實／高：`components/core/AppContext.tsx:315`、`components/assistant/AssistantEditor.tsx:220`、`:330`；瀏覽器 B1                                 | U1       |
| P0   | 行動側欄以位移收起，仍保留可聚焦按鈕；共用 Modal 有 ARIA、Escape，但未見焦點圈限／返回處理                  | 事實／高：`components/core/Layout.tsx:338`、`components/ui/Modal.tsx:13`；B2                                                                      | U2       |
| P0   | 頁面 `lang="en"` 與繁中內容不符；表單與連線測試使用 alert，提示和欄位分離                                   | 事實／高：`index.html:2`、`components/assistant/AssistantEditor.tsx:147`、`components/settings/ProviderSettings.tsx:167`                          | U2       |
| P1   | 手機建立助理要捲過長表單才可保存。推論：完成率與錯誤恢復可能受影響，不能據此宣稱聊天輸入被鍵盤遮住          | 事實／高：`components/assistant/AssistantEditor.tsx:479`；B1。軟鍵盤影響未知                                                                      | U3       |
| P1   | 「已本地保存」在上傳元件只是回傳父層 state；另提示到設定遷移，但現有設定頁沒有對應入口                      | 事實／高：`components/assistant/RAGFileUpload.tsx:74`、`:81`、`components/core/AppShell.tsx:342`。推論：使用者可能誤以為教材已耐久儲存            | U4、F1   |
| P1   | 助理、會話、協作包與 HTML 專案／git／checkpoint 分散儲存；助理 ZIP、專案 ZIP 已存在，尚需整合工作區備份流程 | 事實／高：`services/db.ts:4`、`services/htmlProjectStore.ts:52`、`services/assistantPackageService.ts:62`、`services/htmlProjectZipService.ts:55` | F1       |
| P1   | 網頁入口未註冊 Service Worker，未宣告 PWA manifest；本機資料可保存不代表斷網後可重新開啟 app                | 事實／高：`index.tsx:1`、`index.html:1`、`vite.config.ts:10`；B3。既有 VFS manifest 是預覽檔案清單，不是 PWA manifest                             | F3       |
| P1   | 檔案分享可本機完成，短網址依賴 Turso；部分憑證存於 localStorage，另有加密分享功能                           | 事實／高：`services/shortUrlService.ts:61`、`services/apiKeyManager.ts:11`、`:100`、`services/bundleProviderCredentialsService.ts:121`            | U4、F2   |
| P2   | 聊天清單直接列出目前助理會話；教材搜尋已有本機字詞評分，可增強導覽與引用定位                                | 事實／高：`components/core/Layout.tsx:622`、`services/knowledgeSearchService.ts:135`。大資料效能未知                                              | U5、F4   |
| P2   | 備課到練習／複習的結構化紀錄可沿用聊天、教材、數學與語音；是否符合課堂需求尚待試用                          | 提案／中：既有基礎 `components/chat/MessageBubble.tsx`、`services/mathComputeService.ts`、`services/speechToolService.ts`；非已存在的學習管理功能 | F5       |
| P2   | 已有 token 用量、checkpoint、停止與續跑，不必另造代理框架；可補上預算提醒、明確恢復狀態                     | 事實／高：`services/sessionTokenUsage.ts`、`services/agentRunController.ts:41`、`components/chat/ChatContainer.tsx:1270`                          | F6       |
| P2   | 主入口靜態載入多個功能，建置仍有較大 chunk；需要實測初載圖譜才能判定瓶頸                                    | 事實／高：`components/core/AppShell.tsx:1`、`services/providerRegistry.ts:1`、`vite.config.ts:62`；效能影響為推論                                 | U6       |

文件也需校正：`README_zhtw.md:127` 仍描述 embedding／向量 RAG；目前上傳與搜尋路徑是本機分塊＋字詞搜尋（`components/assistant/RAGFileUpload.tsx:49`、`services/knowledgeSearchService.ts:135`），不可照舊文件規劃新的 embedding 後端。

## 本次驗證紀錄

隔離瀏覽器 context，開啟本機 Vite `/educare/`；未輸入真實 API key、未送出付費 AI 請求、未操作既有使用者資料。

| 編號 | 操作與觀察                                                                                                                          | 能證明與限制                                                                   |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| B1   | 空儲存首頁呈現「新增助理」與六張模板卡；以 `390×844` viewport 重查，文件寬度 390，保存按鈕初始 y 約 3022.5px                        | 表單長、保存不在首屏；未觀察此頁水平溢出。桌面也檢視過畫面，但未做完整視覺稽核 |
| B2   | 同一手機 viewport，關閉側欄 x=-320；無 `inert`／`aria-hidden`，7 個未停用可 tab 按鈕；對關閉選單按鈕呼叫 focus 後成為 activeElement | 隱藏內容仍可取得焦點，無障礙樹仍列出它；真實螢幕閱讀器尚未測試                 |
| B3   | `document.documentElement.lang` 為 `en`；`navigator.serviceWorker.getRegistrations()` 為空                                          | 該隔離環境沒有 app 離線殼；未以此宣稱所有正式部署皆無快取                      |

本次基準檢查：

- `pnpm run typecheck`：通過。
- `pnpm run lint`：通過。
- `pnpm run test --reporter=dot`：95 個測試檔、1,443 個測試通過；含既有 React `act(...)` 警告及刻意錯誤案例輸出。
- `pnpm run build`：通過；jsxgraph 有 eval 警告，llmAdapter／geometryRenderer 有混合動靜態 import 警告。
- 建置輸出：index JS 約 629.71 kB、gzip 178.26 kB；vendor 約 1,402.63 kB、gzip 417.26 kB。這是 chunk 大小，**不是**完整首屏傳輸量或使用者等待時間。
- 尚未執行真實 AI／Turso E2E、Safari／Android／iOS 實機、螢幕閱讀器、課堂試用或弱網效能量測。基準通過不表示下列改善已完成。

文件驗證：獨立 critic 審查通過；已檢查三份文件的來源檔案／行號範圍、相對連結與 Prettier 格式。審查要求校正的 README／Vite 引用行號已修正。

## 無自建後端的邊界

| 能力                           | 優先方案                                 | 網路／server 邊界                                           |
| ------------------------------ | ---------------------------------------- | ----------------------------------------------------------- |
| UI、搜尋、草稿、備份、練習紀錄 | React、IndexedDB、既有 ZIP 工具          | 不新增 API server；資料以同源同瀏覽器為單位                 |
| 再次離線開啟 app               | 靜態 HTTPS 網站＋Service Worker          | 第一次下載仍需網路；不能承諾用 `file://` 開啟完整 app       |
| AI 產生內容                    | 延用供應商配接器，使用者自行設定可用連線 | 雲端推論仍需外部 AI server；純前端不能保護部署者共用金鑰    |
| Ollama／LM Studio              | 保留現有選項                             | 它們本身是本機推論服務，不能稱作零 server；不列核心驗收前提 |
| 分享教材／助理                 | ZIP 檔傳遞、匯入預覽、去除憑證           | 不需雲端資料庫；檔案更新由使用者再次傳遞，沒有即時同步      |
| 分享短網址／QR 連結            | 現有 Turso 功能選用                      | QR 只編碼連結，不會消除連結內容的遠端儲存依賴               |

純前端不規劃保密的全班共用 API key、可信的跨裝置權限／成績、全班即時協作、背景雲端工作或可靠的全校硬性額度。若日後必須支援，需另立有可信服務端的方案，不以 serverless function／BaaS 偷換「無後端」。

外部依據（2026-09-20 查閱）：瀏覽器儲存有配額與逐出機制，`persist()` 不能取代備份，見 [MDN 儲存配額](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)。離線殼依靠 HTTPS 與 Service Worker 安裝／更新流程，見 [MDN Service Worker](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers)。OpenAI 明確不建議將 key 部署於瀏覽器；既有 BYOK 僅是相容路徑，不宣稱符合所有供應商安全建議，見 [API key safety](https://help.openai.com/en/articles/5112595-best-practices-for-api-key-safety)。

## 建議排程與停止條件

以下為單一熟悉專案工程師的人工作日估算，含針對性測試；不是交付承諾。依序交付 UI／UX，再展開功能，避免一次全面重寫。

| 波次          | 項目           | 估算     | 放行條件                                                      |
| ------------- | -------------- | -------- | ------------------------------------------------------------- |
| 1：使用順暢   | U1、U2、U3、U4 | 10–15 日 | 無 key 能建立／匯入助理；鍵盤／手機主要流程通過；儲存狀態誠實 |
| 2：本機可靠   | F1、F2、F3     | 13–19 日 | 備份可還原、分享不洩露 key、離線冷重載可讀資料                |
| 3：查找與閱讀 | F4＋U5、U6     | 9–13 日  | 本機查找與引用可定位；大對話、低速網路有量測結果              |
| 4：教學增強   | F5、F6         | 7–11 日  | 練習／複習可離線續用；代理預算與中斷恢復可驗收                |

完整候選路線約 39–58 人工作日；先完成波次 1，再以試用回饋調整後續排序。U5 的搜尋服務由 F4 擁有，F1 的容量／備份狀態提供給 U4，避免重複實作與估時。

每項採獨立小 PR／commit，新增驗收案例後才變更行為；涉及既有程式整理時，先列清理範圍並鎖定回歸測試。不因本計畫而新增第三方依賴，沿用 React、idb、fflate、Vitest、Playwright。每波須保存驗收證據，有資料遺失、key 外洩、無障礙阻斷或版本升級失敗即不放行。雲端功能保留相容性，資料遷移不得默默覆寫。

本次任務的停止條件：分析有可追溯證據、兩份計畫各有範圍／步驟／驗收／風險／依賴、後端限制清楚、文件檢查通過並完成 docs commit。功能實作屬後續工作。
