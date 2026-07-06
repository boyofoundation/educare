#!/usr/bin/env node
import {
  saveAssistantToTurso,
  saveRagChunkToTurso,
  getAssistantFromTurso,
} from '../services/tursoService.node.js';

async function testSharingFunctionality() {
  try {
    console.log('🔗 Testing Assistant sharing functionality...');

    const testAssistantId = 'share_test_' + Date.now();

    // 1. 創建一個測試助手
    console.log('1️⃣ Creating test assistant for sharing...');
    const testAssistant = {
      id: testAssistantId,
      name: 'Sharing Test Assistant',
      description:
        'A test assistant designed to help verify the sharing functionality works correctly.',
      systemPrompt:
        'I am a helpful assistant created for testing the sharing functionality. I can help with various questions and tasks.',
      createdAt: Date.now(),
    };

    await saveAssistantToTurso(testAssistant);
    console.log(`✅ Created assistant with ID: ${testAssistantId}`);

    // 2. 添加一些 RAG 資料
    console.log('2️⃣ Adding test RAG data...');
    const testRagChunk = {
      id: 'rag_share_test_' + Date.now(),
      assistantId: testAssistantId,
      fileName: 'sharing_info.txt',
      content:
        'This assistant specializes in helping users with sharing and collaboration features. It can explain how to share content, generate links, and manage permissions.',
      createdAt: Date.now(),
    };

    // 創建一個虛擬向量 (768維)
    const testVector = new Array(768).fill(0).map(() => Math.random() * 2 - 1);
    await saveRagChunkToTurso(testRagChunk, testVector);
    console.log('✅ Added test RAG chunk');

    // 3. 驗證能夠從 Turso 讀取助手資料
    console.log('3️⃣ Verifying assistant can be retrieved for sharing...');
    const retrievedAssistant = await getAssistantFromTurso(testAssistantId);

    if (!retrievedAssistant) {
      throw new Error('Failed to retrieve assistant from Turso');
    }

    console.log('✅ Assistant data retrieved successfully:');
    console.log(`   - ID: ${retrievedAssistant.id}`);
    console.log(`   - Name: ${retrievedAssistant.name}`);
    console.log(`   - System Prompt: ${retrievedAssistant.systemPrompt.substring(0, 50)}...`);

    // 4. 生成分享連結格式
    console.log('4️⃣ Generating share link format...');
    const baseUrl = 'http://localhost:5173'; // 開發伺服器 URL
    const shareUrl = `${baseUrl}?share=${testAssistantId}`;

    console.log('✅ Share link generated:');
    console.log(`🔗 ${shareUrl}`);

    console.log('\n🎉 Sharing functionality test completed successfully!');
    console.log('\n📋 How to test:');
    console.log('1. Copy the share link above');
    console.log('2. Open it in a new browser tab/window');
    console.log('3. You should see the shared assistant interface');
    console.log('4. Try chatting with the assistant');
    console.log('5. The RAG data should be available via Turso vector search');
  } catch (error) {
    console.error('❌ Sharing functionality test failed:', error);
    throw error;
  }
}

// 如果直接執行此腳本
if (process.argv[1].includes('testSharing')) {
  testSharingFunctionality()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
