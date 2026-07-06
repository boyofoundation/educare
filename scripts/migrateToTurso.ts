#!/usr/bin/env node
import { getAllAssistants } from '../services/db.js';
import { saveAssistantToTurso, saveRagChunkToTurso } from '../services/tursoService.node.js';

export const migrateData = async () => {
  try {
    console.log('🚀 Starting migration from IndexedDB to Turso...');

    const assistants = await getAllAssistants();
    console.log(`📋 Found ${assistants.length} assistants to migrate`);

    let totalChunks = 0;
    let migratedChunks = 0;
    let migratedAssistants = 0;
    const assistantErrors = [];

    for (const assistant of assistants) {
      console.log(`\n👤 Migrating assistant: ${assistant.name}`);

      // 遷移助手基本資料
      try {
        await saveAssistantToTurso({
          id: assistant.id,
          name: assistant.name,
          description: assistant.description || '', // 提供預設值
          systemPrompt: assistant.systemPrompt,
          createdAt: assistant.createdAt,
        });
        console.log('  ✅ Assistant saved to Turso');
        migratedAssistants++;
      } catch (error) {
        console.error('  ❌ Failed to save assistant:', error);
        assistantErrors.push(
          `Failed to migrate assistant "${assistant.name}": ${error instanceof Error ? error.message : String(error)}`,
        );
        continue;
      }

      // 遷移 RAG chunks
      totalChunks += assistant.ragChunks?.length ?? 0;
      console.log(`  📝 Migrating ${assistant.ragChunks?.length ?? 0} RAG chunks...`);

      for (let i = 0; i < (assistant.ragChunks?.length ?? 0); i++) {
        const chunk = assistant.ragChunks![i];
        try {
          await saveRagChunkToTurso(
            {
              id: `migrated_${assistant.id}_${i}`,
              assistantId: assistant.id,
              fileName: chunk.fileName,
              content: chunk.content,
              createdAt: Date.now(),
            },
            chunk.vector,
          );

          migratedChunks++;
          process.stdout.write(`\r  📦 Progress: ${migratedChunks}/${totalChunks} chunks migrated`);
        } catch (error) {
          console.error(`\n    ❌ Failed to migrate chunk ${i}:`, error);
        }
      }

      console.log(`\n  ✅ Assistant "${assistant.name}" migration completed`);
    }

    console.log('\n🎉 Migration completed!');
    console.log('📊 Summary:');
    console.log(`  - Assistants: ${migratedAssistants}/${assistants.length}`);
    console.log(`  - RAG chunks: ${migratedChunks}/${totalChunks}`);
    console.log(
      `  - Success rate: ${totalChunks > 0 ? ((migratedChunks / totalChunks) * 100).toFixed(1) : '100.0'}%`,
    );
    console.log(`  - Errors: ${assistantErrors.length}`);

    if (assistantErrors.length > 0) {
      console.log('\n🔍 View Error Details');
      assistantErrors.forEach(error => console.log(`❌ ${error}`));
    }
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
};

// 如果直接執行此腳本
if (process.argv[1].includes('migrateToTurso')) {
  migrateData()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
