# 🤖 AI 模型比較測試指南

這個功能讓你能夠**自動測試多個免費 AI 模型**，並生成詳細的比較報告！

## 🚀 快速開始

### 1. 準備環境

確保你有 **OpenRouter API Key**：

```bash
# 在專案根目錄創建 .env.local 文件
echo "OPENROUTER_API_KEY=你的API密鑰" >> .env.local
```

> 💡 免費註冊：https://openrouter.ai/ (支援多種免費模型！)

### 2. 安裝依賴並運行

```bash
# 安裝 Playwright（如果還沒安裝）
pnpm exec playwright install

# 啟動開發服務器（在另一個終端）
pnpm run dev

# 運行多模型比較測試
pnpm run test:model-comparison
```

## 📊 測試內容

### 🧪 測試類別

我們會自動測試以下 5 個類別：

1. **🎨 創意寫作** - 短故事創作能力
2. **🔢 數學推理** - 計算和邏輯思維
3. **💻 程式碼生成** - JavaScript 函數撰寫
4. **📚 事實問答** - 基本知識問答
5. **🧠 複雜推理** - 多步驟邏輯分析

### 🎯 自動測試的免費模型

系統會自動識別並測試這些免費模型：

- **Gemma 系列** (Google)
- **Llama 8B** (Meta)
- **Qwen Free** (Alibaba)
- **Mistral 7B** (Mistral AI)
- **Phi 系列** (Microsoft)

## 📈 查看結果

測試完成後，你會得到兩種格式的報告：

### 📄 HTML 報告 (推薦)

- 位置：`test-reports/model-comparison-[時間戳].html`
- 包含：美觀的可視化比較、評分、響應時間分析
- 支持：在瀏覽器中直接查看

### 📋 JSON 報告 (數據分析)

- 位置：`test-reports/model-comparison-[時間戳].json`
- 包含：完整的結構化數據
- 適用：進一步的數據分析或整合

## 🔧 自定義測試

### 修改測試問題

編輯 `tests/e2e/model-comparison.spec.ts` 文件中的 `testPrompts` 數組：

```typescript
const testPrompts: ComparisonTest[] = [
  {
    testName: '我的自定義測試',
    prompt: '你的測試問題...',
    category: 'creative', // creative | factual | coding | reasoning
    expectedPatterns: ['期望的關鍵詞'], // 可選
  },
  // 添加更多測試...
];
```

### 調整模型選擇

在 `getAvailableFreeModels` 函數中自定義模型過濾邏輯：

```typescript
const freeModels = options.filter(option => {
  const lowerOption = option.toLowerCase();
  return (
    // 添加你想測試的模型關鍵詞
    lowerOption.includes('your-preferred-model')
  );
});
```

## 🎛️ 運行選項

### 基本測試

```bash
pnpm run test:model-comparison
```

### 生成 JSON 格式報告

```bash
pnpm run test:model-comparison:json
```

### 在有界面的瀏覽器中運行 (調試用)

```bash
pnpm exec playwright test tests/e2e/model-comparison.spec.ts --headed
```

### 指定特定瀏覽器

```bash
pnpm exec playwright test tests/e2e/model-comparison.spec.ts --project=chromium
```

## 📊 評分系統

每個回應都會根據以下標準自動評分（0-100分）：

- **基礎分數**: 50 分
- **回應長度**: 合理長度 +20 分
- **關鍵詞匹配**: 根據 `expectedPatterns` 匹配度 +0-30 分
- **錯誤處理**: 有錯誤 = 0 分

評分等級：

- 🟢 **優秀**: 80-100 分
- 🟡 **良好**: 60-79 分
- 🔴 **需改進**: 0-59 分

## 🔍 故障排除

### ❌ API 金鑰錯誤

```bash
# 檢查環境變數
echo $OPENROUTER_API_KEY

# 重新設定
export OPENROUTER_API_KEY="你的真實API密鑰"
```

### ⏱️ 超時錯誤

測試設定了 5 分鐘超時。如果經常超時：

1. 檢查網路連線
2. 確認 OpenRouter 服務狀態
3. 考慮減少測試的模型數量

### 🚫 模型不可用

某些模型可能暫時不可用，這是正常現象。系統會：

- 記錄錯誤但繼續測試其他模型
- 在報告中顯示錯誤詳情

## 💡 使用建議

### 🎯 最佳實踐

1. **第一次運行**：建議在網路狀況良好時進行
2. **定期測試**：模型會定期更新，建議每週運行一次
3. **比較分析**：保存歷史報告，追蹤模型性能變化

### 🚀 進階用法

- 建立自動化 CI/CD 流程定期運行
- 整合到模型選擇決策流程
- 結合實際使用場景定制測試問題

## 📚 相關資源

- [OpenRouter API 文檔](https://openrouter.ai/docs)
- [Playwright 測試文檔](https://playwright.dev/)
- [專案主要文檔](./CLAUDE.md)

---

🎉 **開始測試吧！** 發現最適合你需求的 AI 模型！
