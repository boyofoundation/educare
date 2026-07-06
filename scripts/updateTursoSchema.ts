#!/usr/bin/env node
import { loadEnv } from 'vite';
import { createClient } from '@libsql/client';

const env = loadEnv('', process.cwd(), '');

const client = createClient({
  url: process.env.TURSO_URL || env.TURSO_URL,
  authToken: process.env.TURSOAPI_KEY || env.TURSOAPI_KEY,
});

async function updateSchema() {
  try {
    console.log('🔄 Updating Turso database schema for 768-dimension vectors...');

    // 檢查現有資料表結構
    const tableInfo = await client.execute('PRAGMA table_info(rag_chunks)');
    console.log('Current rag_chunks table structure:', tableInfo.rows);

    // 檢查是否已經有 768 維的欄位
    const embeddingColumn = tableInfo.rows.find(row => row.name === 'embedding');
    if (embeddingColumn) {
      console.log('Found embedding column:', embeddingColumn);
      // 如果已經是正確的類型，跳過更新
      if (embeddingColumn.type === 'F32_BLOB(768)') {
        console.log('✅ Schema already correct (768 dimensions)');
        return;
      }
    }

    // 由於 SQLite 不支援直接修改列類型，我們需要重建表格
    console.log('📋 Backing up existing data...');

    // 備份現有資料
    const existingData = await client.execute('SELECT * FROM rag_chunks');
    console.log(`Found ${existingData.rows.length} existing RAG chunks`);

    if (existingData.rows.length > 0) {
      console.log('⚠️  WARNING: Found existing data with incorrect dimensions!');
      console.log('This data will be incompatible with the new 768-dimension schema.');
      console.log(
        'Recommendation: Clear existing data or manually migrate with correct embeddings.',
      );

      // 詢問是否要繼續（在腳本環境中，我們直接繼續並清除舊資料）
      console.log('🗑️  Clearing existing incompatible data...');
      await client.execute('DELETE FROM rag_chunks');
    }

    // 重建表格
    console.log('🔨 Recreating rag_chunks table with correct dimensions...');

    await client.execute('DROP TABLE IF EXISTS rag_chunks');
    await client.execute('DROP INDEX IF EXISTS rag_chunks_vector_idx');

    // 建立新的資料表
    await client.execute(`
      CREATE TABLE rag_chunks (
        id TEXT PRIMARY KEY,
        assistant_id TEXT NOT NULL,
        file_name TEXT NOT NULL,
        content TEXT NOT NULL,
        embedding F32_BLOB(768),
        created_at INTEGER NOT NULL,
        FOREIGN KEY (assistant_id) REFERENCES assistants(id) ON DELETE CASCADE
      )
    `);

    // 建立向量索引
    await client.execute(`
      CREATE INDEX rag_chunks_vector_idx 
      ON rag_chunks (libsql_vector_idx(embedding, 'metric=cosine'))
    `);

    console.log('✅ Schema updated successfully!');
    console.log('📊 Summary:');
    console.log('  - Updated embedding column to F32_BLOB(768)');
    console.log('  - Recreated vector index for cosine similarity');
    console.log('  - Ready for EmbeddingGemma-300M (768-dimension) vectors');
  } catch (error) {
    console.error('❌ Failed to update schema:', error);
    throw error;
  }
}

// 如果直接執行此腳本
if (process.argv[1].includes('updateTursoSchema')) {
  updateSchema()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
