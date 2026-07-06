#!/usr/bin/env node
import { loadEnv } from 'vite';
import { createClient } from '@libsql/client';

const env = loadEnv('', process.cwd(), '');

const client = createClient({
  url: process.env.TURSO_URL || env.TURSO_URL,
  authToken: process.env.TURSOAPI_KEY || env.TURSOAPI_KEY,
});

async function cleanupChatTables() {
  try {
    console.log('🧹 Cleaning up chat session tables from Turso...');
    console.log('💡 Chat sessions will remain in local IndexedDB for privacy');

    // 檢查是否存在聊天記錄表格
    const tables = await client.execute(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name IN ('chat_sessions', 'chat_messages')
    `);

    if (tables.rows.length > 0) {
      console.log(`Found ${tables.rows.length} chat-related tables to remove:`);
      tables.rows.forEach(row => {
        console.log(`  - ${row.name}`);
      });

      // 刪除聊天記錄表格
      await client.execute('DROP TABLE IF EXISTS chat_messages');
      await client.execute('DROP TABLE IF EXISTS chat_sessions');

      console.log('✅ Chat session tables removed from Turso');
    } else {
      console.log('✅ No chat session tables found in Turso');
    }

    // 顯示剩餘的表格
    const remainingTables = await client.execute(`
      SELECT name FROM sqlite_master WHERE type='table'
    `);

    console.log('\n📊 Remaining tables in Turso:');
    remainingTables.rows.forEach(row => {
      console.log(`  - ${row.name}`);
    });

    console.log('\n🎯 Data storage architecture:');
    console.log('  📁 Local IndexedDB: Chat sessions & messages (private)');
    console.log('  ☁️  Turso Cloud: Assistant settings & RAG data (shareable)');
  } catch (error) {
    console.error('❌ Failed to cleanup chat tables:', error);
    throw error;
  }
}

// 如果直接執行此腳本
if (process.argv[1].includes('cleanupTursoSchema')) {
  cleanupChatTables()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
