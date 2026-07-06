#!/usr/bin/env tsx

/**
 * AI 模型比較演示腳本
 * 展示如何使用模型比較功能的簡單示例
 */

console.log(`
🎉 AI 模型比較演示
====================

這個演示會向你展示如何使用 AI 模型比較功能！

🚀 功能特色：
✅ 自動測試多個免費 AI 模型
✅ 5 個不同類別的測試（創意、數學、程式碼、事實、推理）
✅ 生成美觀的 HTML 比較報告
✅ 自動評分和性能分析
✅ 完整的測試日誌和錯誤處理

📋 測試流程：
1. 自動設定 OpenRouter API
2. 獲取所有可用的免費模型
3. 為每個模型創建測試助理
4. 執行 5 個不同的測試問題
5. 收集回應並計算評分
6. 生成詳細的比較報告

⏱️  預計運行時間：3-5 分鐘
📊 輸出：HTML + JSON 格式報告

🔧 使用方法：

方法 1 - 使用便捷腳本：
  pnpm run run-model-comparison

方法 2 - 直接運行 Playwright：  
  pnpm run test:model-comparison

方法 3 - 僅生成 JSON 報告：
  pnpm run test:model-comparison:json

📋 前置需求：
1. 設定環境變數：
   echo "OPENROUTER_API_KEY=你的API密鑰" >> .env.local
   
2. 啟動開發服務器：
   pnpm run dev
   
3. 安裝 Playwright（如需要）：
   pnpm exec playwright install

🎯 測試問題範例：

📝 創意寫作：
「寫一個關於貓咪探險的短故事，大約50字。」

🧮 數學推理：
「如果一個蘋果3元，買5個蘋果需要多少錢？請解釋計算過程。」

💻 程式碼生成：
「用JavaScript寫一個函數來計算兩個數字的和。」

📚 事實問答：
「台灣的首都是哪裡？」

🧠 複雜推理：
「如果今天是星期三，那麼10天後是星期幾？請說明推理過程。」

📊 評分標準：
- 基礎分數：50 分
- 回應品質：+20 分（長度適中）
- 關鍵詞匹配：+30 分（根據預期答案）
- 錯誤處理：0 分（如有錯誤）

🎨 報告包含：
✓ 各模型性能對比
✓ 回應時間分析  
✓ 成功率統計
✓ 詳細的回應內容
✓ 自動評分結果
✓ 美觀的可視化圖表

🚀 準備好開始了嗎？

運行以下命令開始測試：
pnpm run run-model-comparison

或查看完整使用指南：
cat MODEL_COMPARISON_GUIDE.md
`);
