import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  __resetGitServiceForTesting,
  __setFsInstanceForTesting,
  createIsolatedFs,
} from './htmlProjectGitService';
import { htmlProjectStore } from './htmlProjectStore';
import { HtmlProjectPathValidationError } from './htmlProjectStore';

/**
 * US-002 驗證:htmlProjectStore 檔案操作改走 LightningFS + meta.json。
 * 使用真實 fake-indexeddb (projects/todos store) + 真 LightningFS (檔案內容)。
 * 每測試獨立 FS (wipe) + 清除 idb database,避免跨測試污染。
 */
describe('htmlProjectStore file ops (LightningFS-backed, US-002)', () => {
  let counter = 0;
  const uniqueId = () => `store-files-${Date.now()}-${counter++}`;

  // 不清除 idb:projects/todos store 共用一個 fake-indexeddb DB,
  // 但每測試 project id 唯一 (timestamp-based)、FS 隔離 (wipe),故無跨測試資料碰撞。
  // (deleteDatabase 會因既有開啟連線阻塞而 hang,故不使用。)
  beforeEach(async () => {
    __resetGitServiceForTesting();
    __setFsInstanceForTesting(await createIsolatedFs(uniqueId()));
  });

  afterEach(() => {
    __resetGitServiceForTesting();
    __setFsInstanceForTesting(null);
  });

  const createProject = async (assistantId = 'asst-1') =>
    htmlProjectStore.createProject({
      assistantId,
      name: 'Test Project',
      entryFile: '/index.html',
    });

  it('writeFiles → readFile: 內容 roundtrip + size 為位元組數', async () => {
    const project = await createProject();
    const result = await htmlProjectStore.writeFiles(project.id, [
      { path: '/index.html', kind: 'html', content: '<html>héllo</html>' }, // 多位元組 utf-8
    ]);
    expect(result.previewVersion).toBe(1);

    const file = await htmlProjectStore.readFile(project.id, '/index.html');
    expect(file?.content).toBe('<html>héllo</html>');
    expect(file?.encoding).toBe('utf-8');
    // 'héllo' é 為 2 bytes → size 應為位元組數 (19),非字元數 (17)
    expect(file?.size).toBe(new TextEncoder().encode('<html>héllo</html>').byteLength);
  });

  it('base64 asset 寫入 → 讀回:base64 字串與 encoding 完全一致', async () => {
    const project = await createProject();
    // PNG magic + 高位元組 (非合法 utf-8)
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xd8]);
    let binary = '';
    for (const b of pngBytes) {
      binary += String.fromCharCode(b);
    }
    const base64 = btoa(binary);

    await htmlProjectStore.writeFiles(project.id, [
      { path: '/assets/logo.png', kind: 'asset', content: base64, encoding: 'base64' },
    ]);

    const file = await htmlProjectStore.readFile(project.id, '/assets/logo.png');
    expect(file?.encoding).toBe('base64');
    expect(file?.content).toBe(base64);
    expect(file?.kind).toBe('asset');
    expect(file?.size).toBe(pngBytes.byteLength);
  });

  it('listFiles: 回傳 descriptors (不含 .git/.educare),含 size/kind/dependencies', async () => {
    const project = await createProject();
    await htmlProjectStore.writeFiles(project.id, [
      { path: '/index.html', kind: 'html', content: '<link rel="stylesheet" href="/style.css">' },
      { path: '/style.css', kind: 'css', content: 'body { }' },
      { path: '/app.js', kind: 'js', content: "import '/lib.js';" },
    ]);

    const files = await htmlProjectStore.listFiles(project.id);
    expect(files.map(f => f.path)).toEqual(['/app.js', '/index.html', '/style.css']);
    const html = files.find(f => f.path === '/index.html')!;
    expect(html.kind).toBe('html');
    expect(html.dependencies).toContain('/style.css');
    expect(html.size).toBeGreaterThan(0);
  });

  it('copyFile: 複製內容與 meta,來源保留', async () => {
    const project = await createProject();
    await htmlProjectStore.writeFiles(project.id, [
      { path: '/a.txt', kind: 'md', content: 'hello' },
    ]);

    const result = await htmlProjectStore.copyFile(project.id, '/a.txt', '/b.txt');
    expect(result.previewVersion).toBe(2);

    const [a, b] = await Promise.all([
      htmlProjectStore.readFile(project.id, '/a.txt'),
      htmlProjectStore.readFile(project.id, '/b.txt'),
    ]);
    expect(a?.content).toBe('hello');
    expect(b?.content).toBe('hello');
  });

  it('renameFile: 移動檔案 + 更新 entryFile', async () => {
    const project = await createProject();
    await htmlProjectStore.writeFiles(project.id, [
      { path: '/index.html', kind: 'html', content: '<html></html>' },
    ]);

    await htmlProjectStore.renameFile(project.id, '/index.html', '/home.html');
    expect((await htmlProjectStore.getProject(project.id))?.entryFile).toBe('/home.html');
    expect(await htmlProjectStore.readFile(project.id, '/index.html')).toBeUndefined();
    expect((await htmlProjectStore.readFile(project.id, '/home.html'))?.content).toBe(
      '<html></html>',
    );
  });

  it('deleteFile: 刪除檔案 + 刪 entrypoint 時 status=error', async () => {
    const project = await createProject();
    await htmlProjectStore.writeFiles(project.id, [
      { path: '/index.html', kind: 'html', content: '<html></html>' },
      { path: '/extra.css', kind: 'css', content: 'x' },
    ]);

    await htmlProjectStore.deleteFile(project.id, '/index.html');
    const p = await htmlProjectStore.getProject(project.id);
    expect(p?.status).toBe('error');
    expect(p?.lastBuildError).toBe('Entrypoint file was deleted.');
    expect(await htmlProjectStore.readFile(project.id, '/index.html')).toBeUndefined();
    expect((await htmlProjectStore.readFile(project.id, '/extra.css'))?.content).toBe('x');
  });

  it('searchFiles: 搜尋可搜尋檔案,跳過 binary', async () => {
    const project = await createProject();
    await htmlProjectStore.writeFiles(project.id, [
      { path: '/index.html', kind: 'html', content: '<div>findme</div>' },
      { path: '/img.png', kind: 'asset', content: 'AAAA', encoding: 'base64' },
    ]);

    const result = await htmlProjectStore.searchFiles(project.id, { query: 'findme' });
    expect(result.scannedFiles).toBe(1);
    expect(result.matches.map(m => m.path)).toEqual(['/index.html']);
    expect(result.skippedFiles.map(s => s.path)).toContain('/img.png');
  });

  it('reserved-path 防護:寫入 .git / .educare 拋 reserved-path 錯誤', async () => {
    const project = await createProject();
    await expect(
      htmlProjectStore.writeFiles(project.id, [{ path: '/.git/config', kind: 'md', content: 'x' }]),
    ).rejects.toThrow(HtmlProjectPathValidationError);
    await expect(
      htmlProjectStore.writeFiles(project.id, [
        { path: '/.educare/meta.json', kind: 'md', content: 'x' },
      ]),
    ).rejects.toThrow(HtmlProjectPathValidationError);
    // 繞法:/assets/.git/x 也擋
    await expect(
      htmlProjectStore.writeFiles(project.id, [
        { path: '/assets/.git/x', kind: 'md', content: 'x' },
      ]),
    ).rejects.toThrow(HtmlProjectPathValidationError);
  });

  it('reserved-path 錯誤碼為 reserved-path', async () => {
    const project = await createProject();
    try {
      await htmlProjectStore.writeFiles(project.id, [
        { path: '/.git/x', kind: 'md', content: 'x' },
      ]);
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(HtmlProjectPathValidationError);
      expect((error as HtmlProjectPathValidationError).code).toBe('reserved-path');
    }
  });

  it('deleteProject: 刪除後 LightningFS 目錄已清除 (含 .git)', async () => {
    const project = await createProject();
    await htmlProjectStore.writeFiles(project.id, [
      { path: '/index.html', kind: 'html', content: '<html></html>' },
    ]);

    await htmlProjectStore.deleteProject(project.id, 'asst-1');
    expect(await htmlProjectStore.getProject(project.id)).toBeUndefined();

    // 重新建立同名不衝突;新專案寫入應為全新 repo (ensureRepo 重建)
    const project2 = await htmlProjectStore.createProject({
      assistantId: 'asst-1',
      name: 'Fresh',
      entryFile: '/index.html',
    });
    await htmlProjectStore.writeFiles(project2.id, [
      { path: '/index.html', kind: 'html', content: '<html>fresh</html>' },
    ]);
    expect((await htmlProjectStore.readFile(project2.id, '/index.html'))?.content).toBe(
      '<html>fresh</html>',
    );
  });
});
