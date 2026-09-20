# 計畫二：功能改善，前端與本機資料優先

狀態：待實作。接續 [UI／UX 計畫](./2026-09-20-uiux-plan.md) U1–U4；現況、基準測試與整體排程見[改善分析](./2026-09-20-improvement-assessment.md)。

## 需求與技術取捨

讓現有助理成為可靠、可攜的教學工作區。核心新增能力在瀏覽器內執行，靜態 HTTPS 部署；使用現有 `idb`、`fflate`、本機 git、provider adapter。此計畫不要求新增 dependency。

採用既有 IndexedDB 加上版本化檔案交換，因為現有資料已在本機，改動可分階段驗證。備選「預設以 Turso 同步」可改善跨裝置，但增加外部服務／權限依賴，故維持選用；「強制安裝桌面版／本機 LLM」增加部署與硬體負擔，故不列前提。代價是使用者須自行備份／移轉，無可靠即時多人一致性。

所有項目均無新增自建後端。雲端 AI、舊 Turso 分享仍是外部服務；Ollama／LM Studio 仍是本機 server。只有已下載內容的閱讀、查找、編輯、練習紀錄與檔案交換納入完全離線驗收。

## F1｜完整工作區備份、草稿與資料健康（P1，6–8 日）

**現況：** `services/db.ts:4` 管助理／會話／協作包，`htmlProjectStore.ts:52`、`htmlProjectGitService.ts`、`agentRunCheckpointService.ts:4` 各有儲存；`assistantPackageService.ts:62` 與 `htmlProjectZipService.ts:55` 已有個別 ZIP。`ChatContainer.tsx:137` 輸入為 React state；`AppShell.tsx:97` 壓縮後以摘要與保留回合替換訊息，歷史保存需另明定。不得把助理包誤當全工作區備份。

**實作步驟：**

1. 盤點 store 與外鍵，定義版本化 workspace archive：助理、教材、會話／附件、協作包、作品檔案、快照、git 歷史、checkpoint、非敏感偏好。憑證（含協作包內加密憑證欄位）預設排除；UI 顯示各分類筆數、容量、是否有未包含資料。舊教材只保存解析文字／chunks 的情況須標示沒有原始 PDF／DOCX，不承諾重建原檔。既有個別 ZIP 格式仍可讀。
2. 沿用 ZIP 工具，新增整合服務。匯出前暫停寫入、等待 in-flight 儲存完成並建立一致性快照；恢復後再允許輸入。完整 git 歷史以既有 FS／git 接口匯出，還原測試包含分支、commit parent 與內容；不以工作樹重建一個新 commit 冒充歷史保留。
3. 匯入先驗 schema／檔案總數／解壓後大小／路徑／校驗碼，再預覽衝突。預設「匯入副本」並一致改寫所有外鍵；不默默覆寫。多資料庫不能假定單一 transaction：使用 staging＋匯入日誌，故障／重新載入可繼續或回復；確認完整才對主 UI 可見。
4. 助理編輯和聊天草稿以 session／assistant 分開，輸入後 500ms 防抖保存；成功送出後清除，分享的臨時模式尊重其生命週期。LLM context 壓縮與原始紀錄分離：未來壓縮保留可匯出的原文；已被舊版刪掉的回合標明不可復原。
5. 資料管理頁顯示容量估計、最近備份、持久化授權狀態；拒絕授權／配額滿時保留既有內容並引導匯出，不自動刪教學資料。第一次採用此能力時不移除舊 store。

**驗收：**

- 以 3 助理、100 會話、20 教材、5 作品、2 協作包，含附件、git 分支、快照、checkpoint 的 fixture 匯出，在全新 browser context 還原；納入備份的筆數、內容 hash、外鍵、git log 一致，秘密字串不出現在解壓內容中；被排除的憑證欄位另有清單和斷言。
- 50MiB 未壓縮、最多 5,000 個檔案作首版保守匯入上限，超限在寫入前拒絕並保留原檔；大小限制可後續依實測調整，不宣稱任意大小可匯入。
- 錯誤 schema、損毀 ZIP、path traversal、quota error、任一 store 寫入失敗、半途 reload，都不破壞現有工作區；跨 store 故障可恢復且有可見狀態。
- A／B 對話草稿互不覆蓋；防抖完成後 reload 可回復；切換／離開時 flush。最新未完成 500ms debounce 的意外斷電不保證保存，UI 不宣稱零遺失。
- 壓縮後仍可匯出全部原文，傳給模型的 context 仍符合現有壓縮限制；續跑 checkpoint 不重複執行已確認完成的工具。

**測試／風險：** 擴充 `services/db.test.ts`、`db-compression.test.ts`、`htmlProjectStore.snapshots.test.ts`、`agentRunCheckpointService.test.ts` 和新整合服務測試；瀏覽器做跨 context round-trip。多 store 一致性／git 備份為最大估時風險，第一天先做小型可還原 fixture；若不成立應重估並縮小單次 PR，不刪掉完整備份目標。

瀏覽器儲存預設為 best-effort，持久化申請可能未獲准，清除網站資料仍能刪除內容；容量檢查與離站備份必須並存。依據：[MDN Storage](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)。

## F2｜檔案交接與憑證生命週期（P1，3–5 日）

**現況：** `assistantPackageService.ts:62` 提供 ZIP，`agentBundleService.ts` 支援多助理協作包；`shortUrlService.ts:61` 需 Turso；`apiKeyManager.ts:100` 可讀 localStorage key；`bundleProviderCredentialsService.ts:121` 已有密碼加密流程。

**步驟：**

1. 統一匯出分類為助理包、協作包、作品、完整備份；預覽作者提供的內容與檔案版本、來源不可信提示。以檔案附件／使用者自行傳遞為標準路徑。
2. 預設排除聊天紀錄、個人資料與憑證；包含教材須明確列出。F1 完整備份包含私人資料時另有清單，不與供別人匯入的教學包混用。
3. 提供「僅此分頁／工作階段」憑證模式，持久保存須明確選擇；保留舊加密包讀取相容性，解鎖後先在記憶體使用，匯入不得默默存進全域 provider 設定。既有使用者 key 不因升級自動刪除。
4. 分享 QR 只作入口連結，容量不足回檔案傳遞；短網址顯示依賴雲端和失效處理，不把敏感 payload 放 query string 或任意第三方短網址。

**驗收：** 不設 Turso，在兩個隔離瀏覽器完成助理／教材／協作包檔案交換；錯密碼、舊版包、損壞包均可恢復操作。新預設匯出包、URL、console、localStorage 不含測試憑證；選擇持久保存者只在指定設定 store 出現，結束臨時分頁後 key 不可恢復。開啟作品預覽維持現有 sandbox 隔離；惡意教材／檔名不作 executable HTML 插入。

**風險與限制：** 加密檔案保護傳遞與靜態資料，不會讓接收者無法取得已解鎖 key；工作階段保存也不是 XSS 防護。BYOK 直連是否可用取決於各供應商的 CORS、支援與政策。保留既有相容路徑但不把部署者共用 key 放前端；若要求隱藏全班共用 key，此方案無法滿足，需獨立可信服務端設計。見 [OpenAI key safety](https://help.openai.com/en/articles/5112595-best-practices-for-api-key-safety)。

**測試：** 沿用 `assistantPackageService.test.ts`、`agentBundleService.test.ts`、`bundleProviderCredentialsService.test.ts`、`providerSettingsShareService.test.ts`，增加 secret-marker 掃描、模式切換與副作用驗證。

## F3｜真正可重開的離線網站（P1，4–6 日）

**現況：** `index.html:1`／`index.tsx:1` 無 app Service Worker 註冊；`vite.config.ts:38` 的部署 base 為 `/educare/`；README 的「離線優先」不能直接當作 PWA 已完成。

**步驟：**

1. 以瀏覽器原生 Service Worker 加 build 產物清單，加入 app manifest、應用程式 icon 與離線準備進度；必要新靜態資產確實納入 Git，注意 `.gitignore` 目前忽略 `public/`。
2. 僅快取版本化 app shell、指定本機功能所需 JS／CSS／字型／parser／worker；lazy chunk 也納入「離線已準備」判定。AI、Turso、授權請求及含敏感分享 query 的 navigation 不進通用快取。導航回傳不含使用者資料的固定 shell。
3. 以 `import.meta.env.BASE_URL` 管理 `/educare/` scope；準備完畢才宣告可離線。版本下載完成後提示更新，讓使用者先保存；串流、匯入、git 寫入期間不強制 reload。保留上一版快取至新版本可啟動，避免清掉舊分頁所需 lazy chunks。
4. 離線模式允許閱讀、教材本機查找、草稿、檔案匯出與自足作品預覽；雲端 AI 不自動重送排隊，網路恢復由使用者確認再送。外部 CDN、遠端圖片、瀏覽器語音引擎不保證離線可用，顯示退化狀態。

**驗收：** production build／preview 首次連線完成準備後，新分頁斷網冷重載 `/educare/` 仍開啟；在未曾造訪的本機功能頁載入所需 lazy chunk。連續版本 N→N+1 更新與兩分頁並存，不遺失 F1 資料、不出現資產 404；斷網或下載一半維持舊版。空快取第一次離線不宣稱可用。檢查 Cache Storage 沒有模型回應、Authorization 或敏感 URL。

**測試／風險：** 增加專用 preview E2E（不能拿 dev HMR 頁面代替），覆蓋 Chromium、WebKit 與 scope；iOS 安裝／儲存限制需實機補驗。新增腳本必須明確使用已 build 的 `dist`，不得只測 mock Service Worker。測試矩陣含更新時進行中的工作和 cache quota failure。

Service Worker 需 secure context，安裝／啟用與更新有生命週期，不是加 manifest 就保證離線。依據：[MDN Service Worker](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers)。

## F4｜本機搜尋、教材管理與可追溯引用（P2，4–6 日）

**現況：** `knowledgeSearchService.ts:135` 已有字詞評分、檔名篩選、chunk ID；`RAGFileUpload.tsx:49` 本機解析／分塊，`:90` 用檔名刪文件。保留既有搜尋，不要求 embedding 模型或 vector DB。

**步驟：** 為教材加入穩定 document ID、內容 hash、來源版本與可得的頁碼／段落；同檔名不視為同一文件。解析失敗保留逐檔結果，允許取消；大工作拆批或 Web Worker，避免凍結輸入。建立本機會話／教材查詢接口給 U5，新增前先定義可重建索引與更新／刪除失效規則。引用跳到確切 chunk，沒有來源時明示，不能替模型補假引文。

**驗收：** 20 份中英文教材、至少 50 題人工標註查詢，正確來源 Top-5 命中率目標 ≥85%，無答案題不顯示假來源；此為目標，先保存現有 baseline。重名、重複上傳、刪除後搜尋、舊 ZIP 匯入均有測試。無法從 parser 取得頁碼時顯示段落／chunk，不杜撰頁數。針對 10,000 chunks 與 100 場對話，在固定測試裝置記錄冷／熱查詢，熱查詢 p95 ≤300ms、取消 ≤1 秒；超標先修索引或拆批，不直接加後端。不同工作區／共享模式查詢不得外洩。

**依賴／風險：** 依 F1 可回復的 schema migration；U5 僅擁有查詢 UI。原圖掃描 PDF 沒文字時清楚報告，OCR 與大型瀏覽器 embedding 為另行評估項，不在本階段暗加重模型。

## F5｜備課、練習與複習閉環（P2，4–7 日）

**現況與假設：** `TemplateSelector.tsx:1`、`services/mathComputeService.ts`、`services/speechToolService.ts` 是可復用能力。結構化練習、複習清單為新增提案，教學價值尚未經課堂驗證。

**步驟：** 在現有模板新增年級／主題／學習目標欄位，產生可編輯的教案／題組；使用者先預覽再保存。題組以有版本的本機 schema 保存題目、答案、解說與來源；選擇／填空可離線核對，自由回答標為人工或連線 AI 回饋。練習結果與錯題／書籤用本機匿名 profile 保存，提供 Markdown／JSON／瀏覽器列印；複習排程只在打開 app 時計算，不承諾背景通知。

**驗收：** 3 種科目 fixture 均能生成（mock）、編輯、離線作答、重開查看紀錄、匯出後在第二個 context 還原；兩個本機 profile 不互相混入。AI 產生內容經 schema 驗證，錯誤內容不直接計分；來源無法驗證時可由教師改正。語音不可用時以文字完成練習。

**風險：** profile 是同裝置分類，不是身分驗證或防窺權限；不做可信成績上傳、排行與學生監控。題目與 AI 回饋需教師審查，先用 5 位教師試做一份教材並收集修正需求，再擴大模板。練習資料納入 F1 archive，除非使用者選擇分享，教學包不含作答紀錄。

## F6｜可理解的代理恢復與用量上限（P2，3–4 日）

**現況：** `sessionTokenUsage.ts`、`agentRunController.ts:41`、`agentRunCheckpointService.ts:125` 已提供用量與續跑基礎；`ChatContainer.tsx:1270` 已有 resume／discard 提示。

**步驟：** 把現有 run 狀態呈現為執行中／已停止／可續跑／已完成，補失敗階段與已保存成果；使用者可設每次執行回合／工具呼叫／token 軟預算。發出下一個請求前檢查預算，未知 token 數標為估計；提供去除憑證和私人內容的本機診斷匯出。

**驗收：** mock provider 觸發 429、斷線、工具錯誤、取消與 reload 後，能明確區分可重試與不應重放的操作；停止後不發下一輪模型請求，不刪已保存成果；超預算在下一請求前暫停，由使用者選擇續跑。診斷包 secret-marker 為零，不預設包含教材／聊天原文；無供應商實際帳單時不顯示精確費用。

**風險：** 本機限制可被繞過、不同分頁可能競爭，不能保證供應商硬性封頂；補同工作區 run 互斥／提示並測試雙分頁重入。沿用既有 controller 和 checkpoint，不另寫第二套 agent runtime。測試以 `agentRunController.test.ts` 和 `ChatContainer.resume.integration.test.tsx` 為起點。

## 排程、驗證與交付契約

功能主線：F1 → F2 → F3 → F4（接 U5）→ F5／F6。F2 可先整理匯出政策，但依賴 F1 備份分類；F3 更新測試依賴可靠草稿；F5 新資料必須納入備份。F6 可於 F1 穩定後獨立進行，仍須遵守 UI 優先順序。

每項採最小可驗證提交，擴充既有 service／元件；新增模組限真正的新責任。資料改動先寫 fixture／遷移與故障恢復測試，再編碼；每項附風險和退回舊讀取路徑的方式。執行 typecheck、lint、受影響測試、全套測試與 build；格式只驗改動檔。新 E2E 採固定 fixture＋mock AI／網路攔截，避免需真實 key 才能跑 CI；另列選用供應商 smoke，不將 mock 成功當作七家供應商都已驗證。

每一階段需證明「未設定 Turso 仍可完成核心流程」「無憑證混入一般輸出」「失敗可復原」。完全離線測試必須在 production preview、已準備資產後斷網重開，並記錄哪些第三方資源退化。資料遷移、金鑰暴露或預覽 sandbox 有未解失敗即停止該波放行。這些是後續實作驗收條件，並非本次文件 commit 已完成的功能。
