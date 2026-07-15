import { createClient } from '@libsql/client';
import { loadEnv } from 'vite';

// Node.js 環境專用的 Turso 服務
const env = loadEnv('', process.cwd(), '');

const client = createClient({
  url: process.env.TURSO_URL || env.TURSO_URL,
  authToken: process.env.TURSOAPI_KEY || env.TURSOAPI_KEY,
});

export interface TursoAssistant {
  id: string;
  name: string;
  description: string; // 給使用者看的友善描述
  systemPrompt: string; // 給 AI 的內部指令
  createdAt: number;
}

export interface TursoRagChunk {
  id: string;
  assistantId: string;
  fileName: string;
  content: string;
  createdAt: number;
}

// 初始化資料庫結構
export const initializeDatabase = async (): Promise<void> => {
  try {
    // 建立助手資料表
    await client.execute(`
      CREATE TABLE IF NOT EXISTS assistants (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        system_prompt TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);

    // 建立 RAG chunks 資料表，包含向量欄位
    await client.execute(`
      CREATE TABLE IF NOT EXISTS rag_chunks (
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
      CREATE INDEX IF NOT EXISTS rag_chunks_vector_idx 
      ON rag_chunks (libsql_vector_idx(embedding, 'metric=cosine'))
    `);

    console.log('Turso database initialized successfully');
  } catch (error) {
    console.error('Failed to initialize Turso database:', error);
    throw error;
  }
};

// 儲存助手到 Turso - 避免使用 INSERT OR REPLACE 防止觸發 CASCADE 刪除 RAG chunks
export const saveAssistantToTurso = async (assistant: TursoAssistant): Promise<void> => {
  try {
    // 首先檢查助手是否已存在
    const existingResult = await client.execute({
      sql: 'SELECT id FROM assistants WHERE id = ?',
      args: [assistant.id],
    });

    if (existingResult.rows.length > 0) {
      // 如果已存在，只更新名稱、描述和系統提示，保持 created_at 不變
      await client.execute({
        sql: `UPDATE assistants 
              SET name = ?, description = ?, system_prompt = ?
              WHERE id = ?`,
        args: [assistant.name, assistant.description, assistant.systemPrompt, assistant.id],
      });
    } else {
      // 如果不存在，插入新記錄
      await client.execute({
        sql: `INSERT INTO assistants (id, name, description, system_prompt, created_at) 
              VALUES (?, ?, ?, ?, ?)`,
        args: [
          assistant.id,
          assistant.name,
          assistant.description,
          assistant.systemPrompt,
          assistant.createdAt,
        ],
      });
    }
  } catch (error) {
    console.error('Failed to save assistant to Turso:', error);
    throw error;
  }
};

// 儲存 RAG chunk 含向量到 Turso
export const saveRagChunkToTurso = async (
  chunk: TursoRagChunk,
  embedding: number[],
): Promise<void> => {
  try {
    const vectorString = `[${embedding.join(',')}]`;

    await client.execute({
      sql: `INSERT OR REPLACE INTO rag_chunks (id, assistant_id, file_name, content, embedding, created_at) 
            VALUES (?, ?, ?, ?, vector(?), ?)`,
      args: [
        chunk.id,
        chunk.assistantId,
        chunk.fileName,
        chunk.content,
        vectorString,
        chunk.createdAt,
      ],
    });
  } catch (error) {
    console.error('Failed to save RAG chunk to Turso:', error);
    throw error;
  }
};

// 取得助手資料
export const getAssistantFromTurso = async (id: string): Promise<TursoAssistant | null> => {
  try {
    const result = await client.execute({
      sql: 'SELECT * FROM assistants WHERE id = ?',
      args: [id],
    });

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id as string,
      name: row.name as string,
      description: (row.description as string) || '', // 提供預設值以防舊資料
      systemPrompt: row.system_prompt as string,
      createdAt: row.created_at as number,
    };
  } catch (error) {
    console.error('Failed to get assistant from Turso:', error);
    return null;
  }
};

// 取得所有助手
export const getAllAssistantsFromTurso = async (): Promise<TursoAssistant[]> => {
  try {
    const result = await client.execute('SELECT * FROM assistants ORDER BY created_at DESC');

    return result.rows.map(row => ({
      id: row.id as string,
      name: row.name as string,
      description: (row.description as string) || '', // 提供預設值以防舊資料
      systemPrompt: row.system_prompt as string,
      createdAt: row.created_at as number,
    }));
  } catch (error) {
    console.error('Failed to get all assistants from Turso:', error);
    return [];
  }
};

// 刪除助手及其相關資料
export const deleteAssistantFromTurso = async (id: string): Promise<void> => {
  try {
    // 由於設定了 FOREIGN KEY ON DELETE CASCADE，刪除助手會自動刪除相關的 RAG chunks
    await client.execute({
      sql: 'DELETE FROM assistants WHERE id = ?',
      args: [id],
    });
  } catch (error) {
    console.error('Failed to delete assistant from Turso:', error);
    throw error;
  }
};

// 取得助手的 RAG chunks 數量
export const getRagChunkCount = async (assistantId: string): Promise<number> => {
  try {
    const result = await client.execute({
      sql: 'SELECT COUNT(*) as count FROM rag_chunks WHERE assistant_id = ?',
      args: [assistantId],
    });

    return result.rows[0].count as number;
  } catch (error) {
    console.error('Failed to get RAG chunk count:', error);
    return 0;
  }
};

// 清除助手的所有 RAG chunks
export const clearAssistantRagChunks = async (assistantId: string): Promise<void> => {
  try {
    await client.execute({
      sql: 'DELETE FROM rag_chunks WHERE assistant_id = ?',
      args: [assistantId],
    });
  } catch (error) {
    console.error('Failed to clear assistant RAG chunks:', error);
    throw error;
  }
};
