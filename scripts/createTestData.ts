#!/usr/bin/env node
import { saveAssistant } from '../services/db.js';
import { Assistant } from '../types.js';

// 建立測試用的助手資料
const createTestAssistants = async () => {
  try {
    console.log('Creating test assistants with RAG data...');

    const testAssistant: Assistant = {
      id: 'test_assistant_1',
      name: 'Test Marketing Assistant',
      description: 'A marketing assistant specialized in content creation and strategy',
      systemPrompt:
        'You are a helpful marketing assistant specializing in content creation and strategy.',
      ragChunks: [
        {
          fileName: 'marketing_guide.txt',
          content:
            'Content marketing is essential for building brand awareness. Focus on creating valuable content that resonates with your target audience.',
          vector: new Array(384).fill(0).map(() => Math.random() * 2 - 1), // 模擬向量
        },
        {
          fileName: 'seo_tips.txt',
          content:
            'Search engine optimization requires keyword research, quality content, and proper meta tags. Always focus on user experience first.',
          vector: new Array(384).fill(0).map(() => Math.random() * 2 - 1), // 模擬向量
        },
      ],
      createdAt: Date.now() - 86400000, // 1天前
    };

    const testAssistant2: Assistant = {
      id: 'test_assistant_2',
      name: 'Code Review Assistant',
      description:
        'A code review assistant specialized in analyzing code quality and best practices',
      systemPrompt:
        'You are a senior software engineer who helps with code reviews and best practices.',
      ragChunks: [
        {
          fileName: 'coding_standards.txt',
          content:
            'Always use meaningful variable names, add comments for complex logic, and follow consistent formatting.',
          vector: new Array(384).fill(0).map(() => Math.random() * 2 - 1), // 模擬向量
        },
      ],
      createdAt: Date.now() - 3600000, // 1小時前
    };

    await saveAssistant(testAssistant);
    await saveAssistant(testAssistant2);

    console.log('✅ Test assistants created successfully!');
    console.log(`- ${testAssistant.name}: ${testAssistant.ragChunks?.length ?? 0} RAG chunks`);
    console.log(`- ${testAssistant2.name}: ${testAssistant2.ragChunks?.length ?? 0} RAG chunks`);
  } catch (error) {
    console.error('❌ Failed to create test assistants:', error);
    throw error;
  }
};

// 如果直接執行此腳本
if (process.argv[1].includes('createTestData')) {
  createTestAssistants()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
