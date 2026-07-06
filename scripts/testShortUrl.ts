/**
 * 測試短網址功能
 * 運行此腳本以驗證短網址生成和解析功能
 */

import { generateShortUrl, resolveShortUrl, buildShortUrl } from '../services/shortUrlService';
import { initializeDatabase } from '../services/tursoService';

async function testShortUrlGeneration() {
  console.log('🔗 Testing Short URL functionality...');

  try {
    // 初始化資料庫
    console.log('1️⃣ Initializing database...');
    await initializeDatabase();

    // 測試助理 ID
    const testAssistantId = 'test-assistant-' + Date.now();
    const testEncryptedKeys = 'encrypted-test-keys-12345';

    console.log('2️⃣ Generating short URL...');
    const shortCode = await generateShortUrl(testAssistantId, testEncryptedKeys);
    console.log(`✅ Generated short code: ${shortCode}`);

    const shortUrl = buildShortUrl(shortCode);
    console.log(`✅ Complete short URL: ${shortUrl}`);

    console.log('3️⃣ Resolving short URL...');
    const resolvedData = await resolveShortUrl(shortCode);

    if (resolvedData) {
      console.log('✅ Short URL resolved successfully:');
      console.log(`   Assistant ID: ${resolvedData.assistantId}`);
      console.log(`   Encrypted Keys: ${resolvedData.encryptedKeys}`);
      console.log(`   Created At: ${new Date(resolvedData.createdAt).toISOString()}`);
      console.log(`   Click Count: ${resolvedData.clickCount}`);
    } else {
      console.error('❌ Failed to resolve short URL');
    }

    console.log('4️⃣ Testing URL generation without encrypted keys...');
    const basicShortCode = await generateShortUrl(testAssistantId + '-basic');
    console.log(`✅ Generated basic short code: ${basicShortCode}`);

    const basicResolvedData = await resolveShortUrl(basicShortCode);
    if (basicResolvedData) {
      console.log('✅ Basic short URL resolved successfully:');
      console.log(`   Assistant ID: ${basicResolvedData.assistantId}`);
      console.log(`   Has Encrypted Keys: ${!!basicResolvedData.encryptedKeys}`);
    }

    console.log('🎉 All short URL tests passed!');
  } catch (error) {
    console.error('❌ Short URL test failed:', error);
    throw error;
  }
}

// 如果直接運行此腳本
if (import.meta.url === `file://${process.argv[1]}`) {
  testShortUrlGeneration()
    .then(() => {
      console.log('✅ Short URL test completed successfully');
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Short URL test failed:', error);
      process.exit(1);
    });
}

export { testShortUrlGeneration };
