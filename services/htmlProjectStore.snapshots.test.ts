import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDB } from 'idb';
import {
  __resetGitServiceForTesting,
  __setFsInstanceForTesting,
  commitAll as gitCommitAll,
  createIsolatedFs,
  log as gitLog,
} from './htmlProjectGitService';
import { htmlProjectStore } from './htmlProjectStore';
import type { HtmlProjectFile } from '../types';

/**
 * US-003 驗證:snapshot 相容轉接 (git commit) + 一次性懶遷移。
 * 使用真實 fake-indexeddb + 真 LightningFS。每測試獨立 FS + 專屬 idb DB name。
 */
describe('htmlProjectStore snapshots + migration (US-003)', () => {
  let counter = 0;
  const uniqueId = () => `snap-${Date.now()}-${counter++}`;
  // store 固定使用 'educare-html-projects' DB;seedLegacy 寫入同一 DB。
  // 隔離靠:每測試獨立 FS (wipe) + project id 唯一 + 遷移清理自身 idb 記錄。
  const DB_NAME = 'educare-html-projects';

  beforeEach(async () => {
    __resetGitServiceForTesting();
    __setFsInstanceForTesting(await createIsolatedFs(uniqueId()));
  });

  afterEach(() => {
    __resetGitServiceForTesting();
    __setFsInstanceForTesting(null);
  });

  // 直接以 idb 寫入 legacy 記錄 (繞過 store 新邏輯),模擬遷移前資料。
  // 須在 store 首次 getDb (createProject) 之後呼叫,確保 stores 已建立。
  const seedLegacy = async (
    projectId: string,
    files: Array<Partial<HtmlProjectFile> & { path: string; kind: HtmlProjectFile['kind'] }>,
    snapshots: Array<{
      version: number;
      createdAt: number;
      note?: string;
      fileEntries?: Array<{
        path: string;
        kind: HtmlProjectFile['kind'];
        content: string;
        encoding: 'utf-8' | 'base64';
      }>;
    }>,
  ) => {
    const db = await openDB(DB_NAME, 2);
    for (const file of files) {
      await db.put('htmlProjectFiles', {
        projectId,
        path: file.path,
        kind: file.kind,
        content: file.content ?? '',
        encoding: file.encoding ?? 'utf-8',
        dependencies: file.dependencies,
        size: (file.content ?? '').length,
        updatedAt: file.updatedAt ?? 1000,
      });
    }
    for (const snap of snapshots) {
      await db.put('htmlProjectSnapshots', {
        projectId,
        version: snap.version,
        files: (snap.fileEntries ?? []).map(e => e.path),
        createdAt: snap.createdAt,
        note: snap.note,
        fileEntries: snap.fileEntries,
      });
    }
    db.close();
  };

  const readLegacyCounts = async (projectId: string) => {
    const db = await openDB(DB_NAME, 2);
    const files = await db.getAllFromIndex('htmlProjectFiles', 'by-project', projectId);
    const snaps = await db.getAllFromIndex('htmlProjectSnapshots', 'by-project', projectId);
    db.close();
    return { files: files.length, snapshots: snaps.length };
  };

  const createProject = async (assistantId = 'asst-snap') =>
    htmlProjectStore.createProject({
      assistantId,
      name: 'Snap Project',
      entryFile: '/index.html',
    });

  it('createSnapshot → listSnapshots:含 oid/version;initial commit 不漏入', async () => {
    const project = await createProject();
    await htmlProjectStore.writeFiles(project.id, [
      { path: '/index.html', kind: 'html', content: '<html>v1</html>' },
    ]);
    const pvBeforeSnap = (await htmlProjectStore.getProject(project.id))!.previewVersion;

    const snap = await htmlProjectStore.createSnapshot(project.id, 'first');
    expect(snap.version).toBe(pvBeforeSnap);
    expect(snap.oid).toBeTruthy();

    const list = await htmlProjectStore.listSnapshots(project.id);
    expect(list.snapshots).toHaveLength(1);
    expect(list.snapshots[0].version).toBe(snap.version);
    expect(list.snapshots[0].oid).toBe(snap.oid);
    expect(list.snapshots[0].note).toBe('first');
    expect(list.retainedLimit).toBe(20);
  });

  it('listSnapshots 只回 snapshot commits (auto/gitCommit/revert 不漏入)', async () => {
    const project = await createProject();
    await htmlProjectStore.writeFiles(project.id, [
      { path: '/index.html', kind: 'html', content: '<html>v1</html>' },
    ]);

    await htmlProjectStore.createSnapshot(project.id, 'snap1');
    // 之後修改 + 再 snapshot
    await htmlProjectStore.writeFiles(project.id, [
      { path: '/index.html', kind: 'html', content: '<html>v2</html>' },
    ]);
    await htmlProjectStore.createSnapshot(project.id, 'snap2');

    // 額外建立一個「非 snapshot」commit (模擬 agent gitCommit / 自動 commit)
    await htmlProjectStore.writeFiles(project.id, [
      { path: '/index.html', kind: 'html', content: '<html>v3</html>' },
    ]);
    await gitCommitAll(project.id, 'Manual edit', { previewVersion: 99 });

    const list = await htmlProjectStore.listSnapshots(project.id);
    expect(list.snapshots).toHaveLength(2); // 只回 2 個 snapshot,不含 manual edit commit
    // git log 應 > listSnapshots (manual edit commit 存在於歷史但不漏入 snapshots)
    const fullLog = await gitLog(project.id);
    expect(fullLog.length).toBeGreaterThan(list.snapshots.length);
    expect(fullLog.some(c => c.note === 'Manual edit')).toBe(true);
    expect(list.snapshots.every(s => s.note !== 'Manual edit')).toBe(true);
  });

  it('revertToSnapshot:檔案還原 byte-exact + previewVersion+1 + listSnapshots 不變 + 新增 revert commit', async () => {
    const project = await createProject();
    await htmlProjectStore.writeFiles(project.id, [
      { path: '/index.html', kind: 'html', content: '<html>ORIGINAL</html>' },
      { path: '/style.css', kind: 'css', content: 'a{}' },
    ]);
    const beforeVersion = (await htmlProjectStore.getProject(project.id))!.previewVersion;
    await htmlProjectStore.createSnapshot(project.id, 'v1');

    // 修改 + 刪除一檔
    await htmlProjectStore.writeFiles(project.id, [
      { path: '/index.html', kind: 'html', content: '<html>CHANGED</html>' },
    ]);
    await htmlProjectStore.deleteFile(project.id, '/style.css');

    const beforeSnapCount = (await htmlProjectStore.listSnapshots(project.id)).snapshots.length;
    const beforeLogCount = (await gitLog(project.id)).length;
    const pvBeforeRevert = (await htmlProjectStore.getProject(project.id))!.previewVersion;

    const result = await htmlProjectStore.revertToSnapshot(project.id, beforeVersion);
    expect(result.revertedToVersion).toBe(beforeVersion);
    expect(result.previewVersion).toBe(pvBeforeRevert + 1);
    expect(result.filesRestored).toBe(2);

    // 檔案還原 byte-exact
    const index = await htmlProjectStore.readFile(project.id, '/index.html');
    expect(index?.content).toBe('<html>ORIGINAL</html>');
    const style = await htmlProjectStore.readFile(project.id, '/style.css');
    expect(style?.content).toBe('a{}');

    // listSnapshots 筆數不變;git log 淨增 1 (revert commit)
    const afterSnapCount = (await htmlProjectStore.listSnapshots(project.id)).snapshots.length;
    expect(afterSnapCount).toBe(beforeSnapCount);
    const afterLogCount = (await gitLog(project.id)).length;
    expect(afterLogCount).toBe(beforeLogCount + 1);
  });

  it('revertToSnapshot:version 不存在時錯誤訊息字串完全一致', async () => {
    const project = await createProject();
    await htmlProjectStore.writeFiles(project.id, [
      { path: '/index.html', kind: 'html', content: '<html></html>' },
    ]);
    await expect(htmlProjectStore.revertToSnapshot(project.id, 999)).rejects.toThrow(
      'Project snapshot version 999 not found.',
    );
  });

  it('遷移:legacy idb (files + N snapshots) 首次操作後 git log=N+1,idb 清空', async () => {
    const project = await createProject();
    // 清掉 createProject 剛 init 的空 repo,模擬純 legacy 狀態 (repo 未真正有資料)
    await seedLegacy(
      project.id,
      [{ path: '/index.html', kind: 'html', content: '<html>current</html>', updatedAt: 5000 }],
      [
        {
          version: 1,
          createdAt: 2000,
          note: 'old1',
          fileEntries: [
            { path: '/index.html', kind: 'html', content: '<html>v1</html>', encoding: 'utf-8' },
          ],
        },
        {
          version: 2,
          createdAt: 3000,
          note: 'old2',
          fileEntries: [
            { path: '/index.html', kind: 'html', content: '<html>v2</html>', encoding: 'utf-8' },
            { path: '/app.js', kind: 'js', content: 'console.log(1)', encoding: 'utf-8' },
          ],
        },
      ],
    );

    // listSnapshots 為首個操作 → 觸發遷移
    const list = await htmlProjectStore.listSnapshots(project.id);
    expect(list.snapshots).toHaveLength(2); // 2 個 legacy snapshot replay 成 snapshot commits
    expect(list.snapshots.map(s => s.version).sort((a, b) => a - b)).toEqual([1, 2]);

    // git log = 2 snapshot + 1 migration = 3
    const fullLog = await gitLog(project.id);
    expect(fullLog.length).toBe(3);
    expect(fullLog.some(c => c.note === 'Migrated to git storage')).toBe(true);

    // 工作目錄 = 當前檔案 (legacyFiles 最新狀態)
    const index = await htmlProjectStore.readFile(project.id, '/index.html');
    expect(index?.content).toBe('<html>current</html>');

    // idb legacy 記錄已清空
    const counts = await readLegacyCounts(project.id);
    expect(counts.files).toBe(0);
    expect(counts.snapshots).toBe(0);
  });

  it('遷移冪等:中斷重試 (.git 已存在 idb 未清空) 不產生重複 commits', async () => {
    const project = await createProject();
    await seedLegacy(
      project.id,
      [{ path: '/index.html', kind: 'html', content: '<html>x</html>', updatedAt: 5000 }],
      [
        {
          version: 1,
          createdAt: 2000,
          note: 'only',
          fileEntries: [
            { path: '/index.html', kind: 'html', content: '<html>x</html>', encoding: 'utf-8' },
          ],
        },
      ],
    );

    // 第一次操作觸發遷移
    await htmlProjectStore.listSnapshots(project.id);
    const logAfter1 = await gitLog(project.id);
    expect(logAfter1.length).toBe(2); // 1 snapshot + 1 migration

    // 模擬中斷:重新注入 legacy idb 記錄 (idb 未清空情境)
    await seedLegacy(
      project.id,
      [{ path: '/index.html', kind: 'html', content: '<html>x</html>', updatedAt: 5000 }],
      [
        {
          version: 1,
          createdAt: 2000,
          note: 'only',
          fileEntries: [
            { path: '/index.html', kind: 'html', content: '<html>x</html>', encoding: 'utf-8' },
          ],
        },
      ],
    );

    // 第二次操作:replay 冪等 (先清目錄重建) → commits 不重複
    await htmlProjectStore.listSnapshots(project.id);
    const logAfter2 = await gitLog(project.id);
    expect(logAfter2.length).toBe(2); // 仍為 2,無重複

    const list = await htmlProjectStore.listSnapshots(project.id);
    expect(list.snapshots).toHaveLength(1);
  });

  it('遷移:snapshot-only legacy (file 記錄已刪光) 仍完成', async () => {
    const project = await createProject();
    // 只剩 snapshot 記錄,無 file 記錄
    await seedLegacy(
      project.id,
      [],
      [
        {
          version: 3,
          createdAt: 4000,
          note: 'orphan',
          fileEntries: [
            {
              path: '/index.html',
              kind: 'html',
              content: '<html>orphan</html>',
              encoding: 'utf-8',
            },
          ],
        },
      ],
    );

    const list = await htmlProjectStore.listSnapshots(project.id);
    expect(list.snapshots).toHaveLength(1);
    expect(list.snapshots[0].version).toBe(3);

    const counts = await readLegacyCounts(project.id);
    expect(counts.snapshots).toBe(0);
  });

  it('遷移:fileEntries undefined 的舊記錄 replay 成空 tree commit', async () => {
    const project = await createProject();
    await seedLegacy(
      project.id,
      [],
      [{ version: 1, createdAt: 2000, note: 'empty', fileEntries: undefined }],
    );

    const list = await htmlProjectStore.listSnapshots(project.id);
    expect(list.snapshots).toHaveLength(1);
    expect(list.snapshots[0].files).toEqual([]);
  });
});
