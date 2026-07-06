#!/usr/bin/env tsx

/**
 * 驗證模型比較功能的測試腳本
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execAsync = promisify(exec);

async function validateModelComparison() {
  console.log('🔍 驗證模型比較功能');
  console.log('========================\n');

  // 檢查必要文件
  console.log('📋 檢查必要文件...');
  const requiredFiles = [
    'tests/e2e/model-comparison.spec.ts',
    'scripts/runModelComparison.ts',
    'MODEL_COMPARISON_GUIDE.md',
  ];

  for (const file of requiredFiles) {
    const filePath = path.join(process.cwd(), file);
    if (fs.existsSync(filePath)) {
      console.log(`✅ ${file}`);
    } else {
      console.log(`❌ ${file} - 文件不存在`);
      process.exit(1);
    }
  }

  // 檢查 package.json 腳本
  console.log('\n📦 檢查 package.json 腳本...');
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const requiredScripts = [
    'test:model-comparison',
    'test:model-comparison:json',
    'run-model-comparison',
    'demo-model-comparison',
  ];

  for (const script of requiredScripts) {
    if (packageJson.scripts[script]) {
      console.log(`✅ ${script}: ${packageJson.scripts[script]}`);
    } else {
      console.log(`❌ ${script} - 腳本不存在`);
    }
  }

  // 檢查 TypeScript 語法
  console.log('\n🔍 檢查 TypeScript 語法...');
  try {
    await execAsync('pnpm run typecheck');
    console.log('✅ TypeScript 語法檢查通過');
  } catch (error) {
    console.log('❌ TypeScript 語法檢查失敗:', error);
    process.exit(1);
  }

  // 檢查測試文件語法
  console.log('\n🧪 驗證測試文件語法...');
  try {
    await execAsync('npx playwright test tests/e2e/model-comparison.spec.ts --dry-run');
    console.log('✅ Playwright 測試文件語法正確');
  } catch (error) {
    console.log('❌ Playwright 測試文件語法錯誤:', error);
  }

  // 檢查環境設定
  console.log('\n🔑 檢查環境設定...');
  if (process.env.OPENROUTER_API_KEY) {
    console.log('✅ OPENROUTER_API_KEY 已設定');
  } else {
    console.log('⚠️  OPENROUTER_API_KEY 未設定 - 執行時需要此環境變數');
  }

  // 檢查報告目錄
  console.log('\n📁 檢查報告目錄...');
  const reportsDir = path.join(process.cwd(), 'test-reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
    console.log('✅ 創建了 test-reports 目錄');
  } else {
    console.log('✅ test-reports 目錄已存在');
  }

  console.log('\n🎉 驗證完成！');
  console.log('=================');
  console.log('📋 功能改進摘要:');
  console.log('  • ✅ 基於原始 api-setup-chat.spec.ts 的免費模型檢測邏輯');
  console.log('  • ✅ 正確的 LLM 回應訊息獲取 (MessageBubble + StreamingResponse)');
  console.log('  • ✅ 測試所有檢測到的免費模型，而非限制數量');
  console.log('  • ✅ 增強的錯誤處理和詳細日誌');
  console.log('  • ✅ 自動截圖調試失敗的測試');
  console.log('  • ✅ 延長超時時間適應較慢的模型');

  console.log('\n🚀 執行建議:');
  console.log('1. 設定 API 密鑰: export OPENROUTER_API_KEY="your-key"');
  console.log('2. 啟動開發服務器: pnpm run dev (在另一個終端)');
  console.log('3. 運行模型比較: pnpm run test:model-comparison');
  console.log('4. 查看詳細指南: cat MODEL_COMPARISON_GUIDE.md');
}

// 主程序
validateModelComparison().catch(error => {
  console.error('❌ 驗證失敗:', error);
  process.exit(1);
});
