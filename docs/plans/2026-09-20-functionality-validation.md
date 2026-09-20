# F1–F6 功能整合驗證

日期：2026-09-20。對應[功能計畫](./2026-09-20-functionality-plan.md)。本紀錄只宣稱實際執行的 Agent 檢查；真人試用、教師標註、iOS／Android 實機與 VoiceOver 留在[改善回報](./2026-09-20-uiux-feedback.md)。

狀態：F1–F6 的 Agent 可執行實作與自動驗證已完成，可進行本機 main 合併。真人與實機驗收仍待後續補充，不視為已通過。

## 驗證環境與範圍

- macOS Darwin 25.6.0、arm64、Apple M1；production Vite build，Playwright 1.55 Chromium／WebKit，headless、單 worker、零重試。
- Playwright 使用已安裝 Node 24.18.0；其他指令使用本機 Node 26.4.0。沒有新增 dependency、真實 API key、Turso、雲端部署或遠端 push。
- Vitest 同時只跑一個 pool。E2E 使用固定資料、mock provider 及非本機網路阻擋；mock 成功不代表所有真實供應商已通過 smoke。
- 功能與 UI/UX E2E 明確阻擋 Service Worker，確保 provider mock 不被繞過；離線專用 E2E 則啟用真實 Service Worker，獨立驗證 production cache／更新生命週期。

## 已收集的直接證據

| 項目    | 可驗證行為                                                                                                                          | 證據                                                                                                                                                                   |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1      | 3 助理、100 會話、20 教材、5 真正 git 作品、2 協作包、附件、checkpoint、草稿及練習資料；跨 context 還原後逐一檢查 hash／外鍵／新 ID | `functionality-workspace.spec.ts`；Chromium／WebKit 6 項通過                                                                                                           |
| F1 故障 | project quota 錯誤及回復失敗保持 staged 資料隱藏；reload 後回復或明確續匯，既有資料不變                                             | 同上；包括未開始 practice staging、因而沒有子日誌的復原案例                                                                                                            |
| F2      | 檔案預覽、舊包相容、secret-marker 掃描、工作階段／持久憑證分離與副作用                                                              | package／bundle／key manager／provider share 單元測試；`functionality-sharing.spec.ts` 在兩引擎完成協作包／教材跨 context 交接、損壞檔案拒絕及預覽前無寫入（2 項通過） |
| F3      | production app shell 冷開、lazy assets、更新中斷／quota、兩頁並存、active run 阻擋更新與草稿 flush                                  | `playwright.offline.config.ts`：14 項通過；[離線細節](../reports/2026-09-20-offline-shell-verification.md)                                                             |
| F4      | document ID／hash、同名教材分離、索引失效、確切引用、固定查詢集                                                                     | material／knowledge／local search／parser 測試；benchmark 見下                                                                                                         |
| F5      | 三科題組、兩 profile 隔離、斷網作答與核對、作答紀錄、reload、完整 JSON 跨 context 還原                                              | `functionality-practice.spec.ts`：Chromium／WebKit 2 項通過；service／provider 安全回歸 20 項通過                                                                      |
| F6      | 429 後 reload 續跑、預算暫停與延長、用量保留、診斷去敏、同工作區跨分頁互斥                                                          | `functionality-agent.spec.ts`：Chromium／WebKit 6 項通過；controller／checkpoint／lock／guard／diagnostics／controls 114 項定向測試通過                                |
| UI/UX   | 既有導覽、表單、搜尋、閱讀、作品及分享流程                                                                                          | `playwright.uiux.config.ts`：29 項通過                                                                                                                                 |

F6 最終修正已通過獨立審查：可重試性依 typed failure 判定；工具副作用前先等待 durable in-flight checkpoint；混合已知／未知用量不冒稱精確值；checkpoint 序列化、空回傳或寫入失敗均明確標為不可續跑，不能被最後的完成／取消狀態覆蓋。瀏覽器測試使用模擬 provider，不宣稱真實供應商計費已驗證。

完整回歸曾攔下舊版 git 遷移的真實錯誤：重播完整快照時未移除上一版已刪除的檔案。修正後每一版與最後工作樹均比對完整 tree／metadata；驗證成功前保留 legacy IndexedDB，最後以單一 transaction 原子移除舊檔案與快照。刪檔失敗或清理 transaction 中止仍保留可重試資料；新增故障回歸並通過獨立審查。相關快照／儲存／git／archive provider 共 59 項測試納入最終全套通過結果。

## F4 固定基準

`services/f4RetrievalFixtures.ts` 保存 Agent 建立的 20 份中英文教材／50 題查詢：49 題有答案、42 題 Top-5 命中（85.714%）；1 題無答案，誤報來源 0。此為可重現回歸基準，**不是 50 題教師人工標註完成**。

Node microbenchmark 同時建立 10,000 chunks 與 100 場對話（2,000 則訊息），量測教材與會話索引及查詢：冷 p95 148.034ms、熱 p95 32.797ms。取消 p95 0.049ms 是 deferred parser 的 abort 傳遞，不是所有 PDF parser 實際中斷的保證。這些不是瀏覽器輸入到繪製的 UI 延遲，也不保證所有裝置相同。

另以 `functionality-search.spec.ts` 對 production UI 直接注入同規模的 10,000 chunks／100 場對話，量測輸入到預期搜尋結果可見（含 Playwright 往返成本），並開啟確切教材段落及第 73 場對話的指定訊息。最終全套兩引擎通過：Chromium 冷 p95 202.3ms、熱 p95 181.9ms；WebKit 冷 p95 227ms、熱 p95 204ms。每引擎 5 次 reload 後首次查詢、10 次連續查詢，熱查詢均符合 ≤300ms。本機導覽搜尋沒有取消控制，因此此 E2E 不宣稱量測取消；parser 的限制如上。

## 重現

```sh
pnpm run typecheck
pnpm run lint
pnpm exec vitest run --maxWorkers=1
pnpm run build
pnpm exec playwright test -c playwright.functionality.config.ts
pnpm exec playwright test -c playwright.offline.config.ts
pnpm exec playwright test -c playwright.uiux.config.ts
```

先完成 build 再測 E2E；執行期間不要替換 dist。所有瀏覽器使用 headless，不自動開啟 HTML report／trace。

## Team、AGY 與清理

`educare-functionality-78f2747a` 的 19 項 task 已終止；18 completed，歷史 task 7 的失敗由 task 8 接替並明確保留。四位 worker 的內容先整合，再封存 source／Team 狀態及 Git stash，才正常 shutdown；沒有由 shutdown 自動產生或合併 commit。四個 worker worktrees／panes 已移除，主分支原有未提交檔案未覆蓋。

AGY 嚴格使用 Gemini 3.8 Flash。F1 review 因 Git／Xcode 環境 exit 2 未完成；F3 review 因缺少規定結果／detached sentinel 而 exit 90。均未當成通過、未重試；改由 Codex 獨立審查及本機測試補足。Team／AGY 執行成功與產品驗收是不同證據。

## 最終自動驗證與交付

- Typecheck、lint、production build 通過；改動檔以 Prettier 檢查，正常執行 commit hooks，未跳過驗證。
- Vitest：126 個 test files、1,722 個 tests 全部通過。
- Production headless E2E：功能 18、真實 Service Worker 離線 14、UI/UX 29，共 61 項通過，沒有 skipped、flaky 或 failed。
- 提交依共享持久化、教材搜尋、檔案／供應商邊界、練習、代理恢復、備份、UI、驗收分組；另保留前置離線網站及助理匯入預覽提交。不含 Team runtime 或原始測試 JSON。
- 本機合併與清理只處理本次 feature／AGY worktrees；主分支原有 `.gitignore`、`AGENTS.md` 及兩份開發報告另行備份，不納入功能提交。備份位於主工作區 `.omx/backups/`，恢復方式見各目錄 `RECOVERY.md`；實際合併版本以 Git history 為準。

後續只保留真人／實機驗收、教師標註與選用真實 provider smoke；請使用[改善回報](./2026-09-20-uiux-feedback.md)記錄版本、步驟、預期／實際結果與附件。上述 parser 取消／裝置效能限制仍適用，不以自動化結果替代真人證據。
