# F3 離線網站：第一階段驗證

日期：2026-09-20。這是 F3 app shell／更新生命週期的階段證據，不是 F1–F6 完成宣告。

## 已驗證範圍

- production build 產生內容雜湊版本、靜態資產清單與原生 Service Worker；包含未造訪功能的 lazy chunks、字型及 PDF worker。
- 準備完整才顯示可離線；只快取清單中的靜態資料，不保存模型回應、Authorization 或私人 query。
- Chromium／WebKit headless：14 項 E2E 通過，涵蓋新分頁冷開、未造訪設定頁、資產完整性、空快取首次離線、兩分頁 N→N+1、下載中斷、配額故障及進行中工作的更新阻擋。
- 更新不自動 reload；新版本下載失敗保留舊版快取和本機助理／草稿；舊分頁的內容雜湊 chunks 保留。
- Service Worker 行為單元測試：6 項通過；F3 變更檔案執行獨立 lint。

E2E 使用實際 `dist`，不是 dev/HMR 頁面。更新 fixture 僅修改 release 標記及額外 probe asset；配額案例是在新 worker 的第三次 Cache.put 注入 QuotaExceededError，不冒稱為實機磁碟容量量測。

## 重現

先執行 `pnpm run build`，再執行 `pnpm exec playwright test -c playwright.offline.config.ts`。設定固定 headless、單 worker、零重試，不自動開啟 report／trace。

本次環境為 macOS、Playwright 1.55、WebKit build 2203。安裝／執行 Playwright 使用已安裝的 Node 24.18.0；Node 26 的舊版 Playwright 解壓程序有相容性問題，沒有為此修改 dependency 或系統授權。

### WebKit 斷線驗證方式

在同一個已準備 context，`setOffline(true)` 導致快取導覽回報「WebKit encountered an internal error」。交叉診斷實際關閉 HTTP origin 並終止連線後：

1. 未快取 fetch 確實失敗。
2. 新分頁仍能開啟已快取的 production 網站，且由 Service Worker 控制。
3. 再使用 `setOffline(true)` 則重現 internal error。

正式 fixture 因此對兩引擎都停止自己的 origin 並檢查未快取請求失敗；Chromium 另加離線模擬。這證明 app origin 不可達時仍可開啟，不代表已完成 iOS 實機或作業系統飛航模式測試。

## 整合與限制

- 套用更新 API 預設拒絕缺少儲存 guard 的操作；已接入草稿 flush、匯入／git barrier 及同工作區 active-run lock。新增 production E2E 持有真正的 Web Lock，證明執行中不能套用更新；釋放後立即輸入的草稿先保存，再更新及 reload，內容仍保留。
- 完整 F1 跨 context 備份／恢復不是本批離線測試的涵蓋範圍；目前保存的測試資料為本機助理和聊天草稿。
- 舊版快取採保留策略，會增加儲存用量；不自動刪除教學資料。儲存仍受瀏覽器清除／回收限制。
- 雲端 AI、Turso、遠端圖片／CDN 與語音引擎不保證離線；不自動重送雲端請求。
- iOS／Android 實機、VoiceOver、首次使用者及教師試用由使用者後續補驗。回報可記錄：裝置／OS、操作路徑、預期與實際結果、重現步驟、截圖或錄影、改善優先度與回歸結果。
