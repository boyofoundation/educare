import { getAllAssistants } from './db';
import { saveAssistantToTurso, saveRagChunkToTurso, getRagChunkCount } from './tursoService';

export interface MigrationProgress {
  step: string;
  current: number;
  total: number;
  completed: boolean;
  error?: string;
}

export type MigrationProgressCallback = (progress: MigrationProgress) => void;

/**
 * 在瀏覽器中執行從 IndexedDB 到 Turso 的遷移
 * 注意：只遷移助手設定和 RAG 資料，聊天記錄保留在本地 IndexedDB 以保護隱私
 */
export const migrateIndexedDBToTurso = async (
  onProgress?: MigrationProgressCallback,
): Promise<{ success: boolean; error?: string; summary?: string }> => {
  try {
    onProgress?.({
      step: 'Loading assistants from IndexedDB...',
      current: 0,
      total: 0,
      completed: false,
    });

    // 取得所有助手
    const assistants = await getAllAssistants();

    if (assistants.length === 0) {
      return {
        success: true,
        summary: 'No assistants found to migrate.',
      };
    }

    const totalChunks = assistants.reduce(
      (sum, assistant) => sum + (assistant.ragChunks?.length ?? 0),
      0,
    );
    let processedAssistants = 0;
    let processedChunks = 0;
    let migratedAssistants = 0;
    let migratedChunks = 0;
    const errors: string[] = [];

    onProgress?.({
      step: `Found ${assistants.length} assistants with ${totalChunks} RAG chunks`,
      current: 0,
      total: assistants.length,
      completed: false,
    });

    for (const assistant of assistants) {
      try {
        processedAssistants++;

        onProgress?.({
          step: `Migrating assistant: ${assistant.name}`,
          current: processedAssistants,
          total: assistants.length,
          completed: false,
        });

        // 檢查助手是否已存在於 Turso
        const existingChunkCount = await getRagChunkCount(assistant.id);
        const shouldMigrateAssistant = true;
        let shouldMigrateChunks = true;

        if (existingChunkCount > 0) {
          onProgress?.({
            step: `Assistant "${assistant.name}" already has ${existingChunkCount} chunks in Turso. Skipping...`,
            current: processedAssistants,
            total: assistants.length,
            completed: false,
          });
          shouldMigrateChunks = false;
          processedChunks += assistant.ragChunks?.length ?? 0;
          migratedChunks += assistant.ragChunks?.length ?? 0; // 視為已遷移
        }

        // 遷移助手基本資料
        if (shouldMigrateAssistant) {
          try {
            await saveAssistantToTurso({
              id: assistant.id,
              name: assistant.name,
              description: assistant.description || '', // 提供預設值
              systemPrompt: assistant.systemPrompt,
              createdAt: assistant.createdAt,
              routableAssistantIds: assistant.routableAssistantIds,
              starterPrompts: assistant.starterPrompts,
              subagentDelegationEnabled: assistant.subagentDelegationEnabled,
            });
            migratedAssistants++;
          } catch (error) {
            const errorMsg = `Failed to migrate assistant "${assistant.name}": ${error}`;
            errors.push(errorMsg);
            console.error(errorMsg);
          }
        } else {
          migratedAssistants++;
        }

        // 遷移 RAG chunks
        if (shouldMigrateChunks && (assistant.ragChunks?.length ?? 0) > 0) {
          for (let i = 0; i < (assistant.ragChunks?.length ?? 0); i++) {
            const chunk = assistant.ragChunks![i];
            processedChunks++;

            onProgress?.({
              step: `Migrating chunk ${i + 1}/${assistant.ragChunks?.length ?? 0} for "${assistant.name}"`,
              current: processedChunks,
              total: totalChunks,
              completed: false,
            });

            try {
              await saveRagChunkToTurso(
                {
                  id: `migrated_${assistant.id}_${i}_${Date.now()}`,
                  assistantId: assistant.id,
                  fileName: chunk.fileName,
                  content: chunk.content,
                  createdAt: Date.now(),
                },
                chunk.vector || [],
              );

              migratedChunks++;
            } catch (error) {
              const errorMsg = `Failed to migrate chunk ${i + 1} for "${assistant.name}": ${error}`;
              errors.push(errorMsg);
              console.error(errorMsg);
            }
          }
        }
      } catch (error) {
        const errorMsg = `Failed to process assistant "${assistant.name}": ${error}`;
        errors.push(errorMsg);
        console.error(errorMsg);
      }
    }

    const summary =
      'Migration completed!\n' +
      `• Assistants: ${migratedAssistants}/${assistants.length}\n` +
      `• RAG chunks: ${migratedChunks}/${totalChunks}\n` +
      `• Success rate: ${((migratedChunks / totalChunks) * 100).toFixed(1)}%` +
      (errors.length > 0 ? `\n• Errors: ${errors.length}` : '');

    onProgress?.({
      step: 'Migration completed!',
      current: assistants.length,
      total: assistants.length,
      completed: true,
    });

    return {
      success: errors.length < assistants.length, // 至少成功一半才算成功
      summary,
      error: errors.length > 0 ? errors.join('\n') : undefined,
    };
  } catch (error) {
    const errorMessage = `Migration failed: ${error}`;
    console.error(errorMessage);

    onProgress?.({
      step: 'Migration failed',
      current: 0,
      total: 0,
      completed: true,
      error: errorMessage,
    });

    return {
      success: false,
      error: errorMessage,
    };
  }
};

/**
 * 檢查是否有資料需要遷移
 */
export const checkMigrationStatus = async (): Promise<{
  hasIndexedDBData: boolean;
  assistantCount: number;
  totalChunks: number;
}> => {
  try {
    const assistants = await getAllAssistants();
    const totalChunks = assistants.reduce(
      (sum, assistant) => sum + (assistant.ragChunks?.length ?? 0),
      0,
    );

    return {
      hasIndexedDBData: assistants.length > 0,
      assistantCount: assistants.length,
      totalChunks,
    };
  } catch (error) {
    console.error('Failed to check migration status:', error);
    return {
      hasIndexedDBData: false,
      assistantCount: 0,
      totalChunks: 0,
    };
  }
};
