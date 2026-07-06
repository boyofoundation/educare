#!/usr/bin/env node
import { createClient } from '@libsql/client';
import { loadEnv } from 'vite';

// 添加 description 欄位到現有的 assistants 表
const env = loadEnv('', process.cwd(), '');

const client = createClient({
  url: process.env.TURSO_URL || env.TURSO_URL,
  authToken: process.env.TURSOAPI_KEY || env.TURSOAPI_KEY,
});

async function addDescriptionField() {
  try {
    console.log('🔧 Adding description field to assistants table...');

    // 檢查是否已經有 description 欄位
    const tableInfo = await client.execute('PRAGMA table_info(assistants)');
    const hasDescriptionField = tableInfo.rows.some(row => row.name === 'description');

    if (hasDescriptionField) {
      console.log('✅ Description field already exists in assistants table');
      return;
    }

    // 添加 description 欄位
    await client.execute(`
      ALTER TABLE assistants 
      ADD COLUMN description TEXT DEFAULT ''
    `);

    console.log('✅ Description field added successfully');

    // 檢查現有資料並為缺少描述的助手設置預設描述
    const assistants = await client.execute('SELECT * FROM assistants');

    if (assistants.rows.length > 0) {
      console.log(
        `📝 Found ${assistants.rows.length} existing assistants, setting default descriptions...`,
      );

      for (const row of assistants.rows) {
        const assistantName = row.name as string;
        const defaultDescription = `I'm ${assistantName}, ready to help you with various tasks and questions.`;

        await client.execute({
          sql: 'UPDATE assistants SET description = ? WHERE id = ? AND (description IS NULL OR description = "")',
          args: [defaultDescription, row.id],
        });
      }

      console.log('✅ Default descriptions set for existing assistants');
    }

    // 顯示更新後的資料表結構
    console.log('\n📊 Updated assistants table structure:');
    const updatedTableInfo = await client.execute('PRAGMA table_info(assistants)');

    updatedTableInfo.rows.forEach(row => {
      const name = row.name as string;
      const type = row.type as string;
      const defaultValue = row.dflt_value || 'NULL';
      console.log(`  - ${name}: ${type} (default: ${defaultValue})`);
    });

    console.log('\n🎉 Description field migration completed successfully!');
  } catch (error) {
    console.error('❌ Failed to add description field:', error);
    throw error;
  }
}

// 如果直接執行此腳本
if (process.argv[1].includes('addDescriptionField')) {
  addDescriptionField()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
