#!/usr/bin/env tsx

/**
 * AI 模型比較測試運行腳本
 *
 * 這個腳本提供了一個友好的命令行界面來運行模型比較測試
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';

const execAsync = promisify(exec);

interface TestOptions {
  models?: string[];
  tests?: string[];
  outputFormat: 'html' | 'json' | 'both';
  verbose: boolean;
}

class ModelComparisonRunner {
  private options: TestOptions;

  constructor(options: TestOptions) {
    this.options = options;
  }

  async run() {
    console.log('🤖 AI 模型比較測試啟動器');
    console.log('=====================================\n');

    // 檢查環境
    await this.checkEnvironment();

    // 啟動開發服務器（如果需要）
    await this.ensureDevServerRunning();

    // 運行測試
    await this.runTests();

    // 顯示結果
    await this.showResults();
  }

  private async checkEnvironment() {
    console.log('🔍 檢查環境設定...');

    // 檢查 API Key
    if (!process.env.OPENROUTER_API_KEY) {
      console.error('❌ 缺少 OPENROUTER_API_KEY 環境變數');
      console.log('💡 請創建 .env.local 文件並添加：');
      console.log('   OPENROUTER_API_KEY=你的API密鑰');
      console.log('   免費註冊：https://openrouter.ai/\n');
      process.exit(1);
    }

    // 檢查 Playwright
    try {
      await execAsync('npx playwright --version');
      console.log('✅ Playwright 已安裝');
    } catch {
      console.log('📦 安裝 Playwright...');
      await execAsync('npx playwright install');
      console.log('✅ Playwright 安裝完成');
    }

    console.log('✅ 環境檢查完成\n');
  }

  private async ensureDevServerRunning() {
    console.log('🚀 檢查開發服務器...');

    try {
      const response = await fetch('http://localhost:5173');
      if (response.ok) {
        console.log('✅ 開發服務器運行中\n');
        return;
      }
    } catch {
      // Server not running
    }

    console.log('🔄 啟動開發服務器...');
    console.log('💡 請在另一個終端運行: pnpm run dev');
    console.log('⏱️  等待服務器啟動...\n');

    // 等待服務器啟動
    for (let i = 0; i < 30; i++) {
      try {
        const response = await fetch('http://localhost:5173');
        if (response.ok) {
          console.log('✅ 服務器已就緒\n');
          return;
        }
      } catch {
        // Continue waiting
      }

      await new Promise(resolve => setTimeout(resolve, 2000));
      process.stdout.write('.');
    }

    console.error('\n❌ 服務器啟動超時，請手動啟動 pnpm run dev');
    process.exit(1);
  }

  private async runTests() {
    console.log('🧪 開始運行模型比較測試...');
    console.log('⏱️  預計運行時間: 3-5 分鐘\n');

    const reporterFlag =
      this.options.outputFormat === 'json' ? '--reporter=json' : '--reporter=html';
    const command = `npx playwright test tests/e2e/model-comparison.spec.ts ${reporterFlag}`;

    try {
      const { stdout } = await execAsync(command, {
        env: { ...process.env, OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY },
      });

      if (this.options.verbose) {
        console.log('測試輸出:', stdout);
      }

      console.log('✅ 測試完成！\n');
    } catch (error: unknown) {
      console.log('⚠️  測試完成（可能有部分失敗）');
      if (this.options.verbose) {
        console.log('錯誤詳情:', error.message);
      }
      console.log('📊 結果報告已生成\n');
    }
  }

  private async showResults() {
    console.log('📈 測試結果');
    console.log('=====================================');

    const reportsDir = path.join(process.cwd(), 'test-reports');

    if (!fs.existsSync(reportsDir)) {
      console.log('❌ 未找到測試報告目錄');
      return;
    }

    const files = fs
      .readdirSync(reportsDir)
      .filter(file => file.includes('model-comparison'))
      .sort((a, b) => {
        const aTime = fs.statSync(path.join(reportsDir, a)).mtime;
        const bTime = fs.statSync(path.join(reportsDir, b)).mtime;
        return bTime.getTime() - aTime.getTime();
      });

    if (files.length === 0) {
      console.log('❌ 未找到比較報告');
      return;
    }

    console.log('📄 最新報告:');
    files.slice(0, 3).forEach((file, index) => {
      const filePath = path.join(reportsDir, file);
      const stats = fs.statSync(filePath);
      const isHTML = file.endsWith('.html');

      console.log(`${index === 0 ? '🔴' : '  '} ${file}`);
      console.log(`   📅 ${stats.mtime.toLocaleString('zh-TW')}`);
      console.log(`   📊 ${isHTML ? 'HTML報告 (推薦)' : 'JSON數據'}`);

      if (isHTML) {
        console.log(`   🌐 在瀏覽器中查看: file://${filePath}`);
      }
      console.log();
    });

    // 自動打開最新的 HTML 報告
    const latestHTML = files.find(f => f.endsWith('.html'));
    if (latestHTML) {
      const filePath = path.join(reportsDir, latestHTML);
      console.log('🚀 正在打開最新報告...');

      try {
        // 嘗試在默認瀏覽器中打開
        if (process.platform === 'darwin') {
          await execAsync(`open "${filePath}"`);
        } else if (process.platform === 'win32') {
          await execAsync(`start "${filePath}"`);
        } else {
          await execAsync(`xdg-open "${filePath}"`);
        }
        console.log('✅ 報告已在瀏覽器中打開');
      } catch {
        console.log('💡 請手動打開報告文件查看結果');
      }
    }
  }
}

// 命令行參數處理
function parseArgs(): TestOptions {
  const args = process.argv.slice(2);
  const options: TestOptions = {
    outputFormat: 'html',
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--format':
      case '-f': {
        const format = args[++i];
        if (['html', 'json', 'both'].includes(format)) {
          options.outputFormat = format as 'html' | 'json' | 'both';
        }
        break;
      }

      case '--verbose':
      case '-v':
        options.verbose = true;
        break;

      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
    }
  }

  return options;
}

function printHelp() {
  console.log(`
🤖 AI 模型比較測試工具

用法:
  tsx scripts/runModelComparison.ts [選項]
  
  或者直接運行:
  pnpm run test:model-comparison

選項:
  -f, --format <type>    輸出格式: html, json, both (預設: html)
  -v, --verbose          顯示詳細輸出
  -h, --help             顯示此幫助信息

範例:
  tsx scripts/runModelComparison.ts
  tsx scripts/runModelComparison.ts --format json --verbose

注意:
  - 需要設定 OPENROUTER_API_KEY 環境變數
  - 需要開發服務器運行在 http://localhost:5173
  - 測試大約需要 3-5 分鐘完成
`);
}

// 主程序
async function main() {
  const options = parseArgs();
  const runner = new ModelComparisonRunner(options);

  try {
    await runner.run();
  } catch (error) {
    console.error('❌ 運行失敗:', error);
    process.exit(1);
  }
}

// 運行腳本
main().catch(console.error);

export { ModelComparisonRunner };
