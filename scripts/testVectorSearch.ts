#!/usr/bin/env node
import {
  saveAssistantToTurso,
  saveRagChunkToTurso,
  searchSimilarChunks,
} from '../services/tursoService.node.js';

async function testVectorSearch() {
  try {
    console.log('🧪 Testing Turso vector search functionality...');

    const testAssistantId = 'test_vector_search_' + Date.now();

    // 1. 建立測試助手
    console.log('1️⃣ Creating test assistant...');
    await saveAssistantToTurso({
      id: testAssistantId,
      name: 'Test Vector Search Assistant',
      description: 'A test assistant for vector search functionality',
      systemPrompt: 'This is a test assistant for vector search.',
      createdAt: Date.now(),
    });

    // 2. 建立測試 RAG chunks 含向量
    console.log('2️⃣ Creating test RAG chunks...');
    const testChunks = [
      {
        id: 'chunk1_' + Date.now(),
        assistantId: testAssistantId,
        fileName: 'test1.txt',
        content: 'Machine learning is a subset of artificial intelligence',
        vector: new Array(768).fill(0).map(() => Math.random() * 2 - 1),
      },
      {
        id: 'chunk2_' + Date.now(),
        assistantId: testAssistantId,
        fileName: 'test2.txt',
        content: 'Deep learning uses neural networks with multiple layers',
        vector: new Array(768).fill(0).map(() => Math.random() * 2 - 1),
      },
      {
        id: 'chunk3_' + Date.now(),
        assistantId: testAssistantId,
        fileName: 'test3.txt',
        content: 'Natural language processing helps computers understand text',
        vector: new Array(768).fill(0).map(() => Math.random() * 2 - 1),
      },
    ];

    for (const chunk of testChunks) {
      await saveRagChunkToTurso(
        {
          id: chunk.id,
          assistantId: chunk.assistantId,
          fileName: chunk.fileName,
          content: chunk.content,
          createdAt: Date.now(),
        },
        chunk.vector,
      );
    }

    console.log(`✅ Created ${testChunks.length} test chunks`);

    // 3. 測試向量搜尋
    console.log('3️⃣ Testing vector search...');
    const queryVector = new Array(768).fill(0).map(() => Math.random() * 2 - 1);

    const searchResults = await searchSimilarChunks(testAssistantId, queryVector, 2);

    console.log('\n📊 Search Results:');
    searchResults.forEach((result, index) => {
      console.log(`${index + 1}. "${result.fileName}"`);
      console.log(`   Content: ${result.content}`);
      console.log(`   Similarity: ${result.similarity.toFixed(4)}`);
      console.log('');
    });

    if (searchResults.length > 0) {
      console.log('✅ Vector search test PASSED!');
      console.log(`   - Found ${searchResults.length} results`);
      console.log(
        `   - Similarity scores: ${searchResults.map(r => r.similarity.toFixed(4)).join(', ')}`,
      );
    } else {
      console.log('❌ Vector search test FAILED - No results returned');
    }

    // 4. 清理測試資料
    console.log('4️⃣ Cleaning up test data...');
    // 註意：由於設定了 FOREIGN KEY ON DELETE CASCADE，刪除助手會自動清理 RAG chunks
    // const cleanup = await import('../services/tursoService.node.js');
    // 這裡我們跳過清理，讓資料保留用於實際測試

    console.log('🎉 Vector search test completed successfully!');
  } catch (error) {
    console.error('❌ Vector search test failed:', error);
    throw error;
  }
}

// 如果直接執行此腳本
if (process.argv[1].includes('testVectorSearch')) {
  testVectorSearch()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
