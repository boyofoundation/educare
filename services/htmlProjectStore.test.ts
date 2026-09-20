import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetGitServiceForTesting,
  __setFsInstanceForTesting,
  createIsolatedFs,
} from './htmlProjectGitService';
import { htmlProjectStore, HtmlProjectPathValidationError } from './htmlProjectStore';
import * as gitService from './htmlProjectGitService';
import {
  __resetWorkspaceOperationServiceForTesting,
  withWorkspaceOperation,
} from './workspaceOperationService';

/**
 * htmlProjectStore 核心測試 (US-002/003):專案 CRUD、normalizePath 驗證、
 * dependency 推導、todos、snapshot retention。使用真實 fake-indexeddb + 隔離 LightningFS。
 * 檔案操作 roundtrip 見 htmlProjectStore.files.test.ts;snapshot/revert/遷移見 .snapshots.test.ts。
 */
describe('htmlProjectStore (project CRUD + path validation + todos)', () => {
  let counter = 0;
  const uniqueId = () => `core-${Date.now()}-${counter++}`;

  beforeEach(async () => {
    __resetGitServiceForTesting();
    __setFsInstanceForTesting(await createIsolatedFs(uniqueId()));
  });

  afterEach(() => {
    __resetGitServiceForTesting();
    __setFsInstanceForTesting(null);
    __resetWorkspaceOperationServiceForTesting();
  });

  it('rejects forged and stale archive tokens before reading or mutating project storage', async () => {
    const forgedToken = Symbol('forged-workspace-operation');
    await expect(
      htmlProjectStore.exportProjectArchive('project-forged-token', {
        operationToken: forgedToken,
      }),
    ).rejects.toThrow('Workspace operation token is no longer active.');

    let staleToken!: symbol;
    await withWorkspaceOperation('export', async operationToken => {
      staleToken = operationToken;
      await expect(
        htmlProjectStore.exportProjectArchive('project-missing-during-active-operation', {
          operationToken,
        }),
      ).rejects.toThrow('HTML project project-missing-during-active-operation not found.');
    });

    await expect(
      htmlProjectStore.exportProjectArchive('project-stale-token', {
        operationToken: staleToken,
      }),
    ).rejects.toThrow('Workspace operation token is no longer active.');
  });

  describe('createProject + project metadata', () => {
    it('建立專案:正規化 entry file,previewVersion 0', async () => {
      const project = await htmlProjectStore.createProject({
        assistantId: 'a1',
        name: 'My Project',
        entryFile: 'index.html',
      });
      expect(project.entryFile).toBe('/index.html');
      expect(project.previewVersion).toBe(0);
      expect(project.status).toBe('draft');
      expect(project.id).toBeTruthy();
    });

    it('getProject 讀回專案', async () => {
      const project = await htmlProjectStore.createProject({
        assistantId: 'a1',
        name: 'P',
        entryFile: '/index.html',
      });
      expect(await htmlProjectStore.getProject(project.id)).toBeDefined();
      expect(await htmlProjectStore.getProject('nonexistent')).toBeUndefined();
    });
  });

  describe('project archive roundtrip', () => {
    it('exports/imports project metadata, todos, snapshots, git history and dirty files', async () => {
      const source = await htmlProjectStore.createProject({
        assistantId: 'archive-source-assistant',
        sessionId: 'archive-source-session',
        name: 'Archive source',
      });
      await htmlProjectStore.writeFiles(source.id, [
        { path: '/index.html', kind: 'html', content: '<html>v1</html>' },
        {
          path: '/assets/logo.bin',
          kind: 'asset',
          content: btoa(String.fromCharCode(0, 255, 1, 128)),
          encoding: 'base64',
        },
      ]);
      const snapshot = await htmlProjectStore.createSnapshot(source.id, 'source snapshot');
      await htmlProjectStore.writeFiles(source.id, [
        { path: '/draft.md', kind: 'md', content: 'uncommitted draft' },
      ]);
      await htmlProjectStore.replaceTodos(source.id, [
        { id: 'todo-1', title: 'Review archive', status: 'in_progress' },
      ]);

      const archive = await htmlProjectStore.exportProjectArchive(source.id);
      expect(archive.schemaVersion).toBe(1);
      expect(archive.repository.projectId).toBe(source.id);
      expect(archive.repository.entries.some(entry => entry.path === '.git/HEAD')).toBe(true);
      expect(archive.repository.entries.some(entry => entry.path === 'draft.md')).toBe(true);

      const imported = await htmlProjectStore.importProjectArchive(archive, {
        projectId: 'project-archive-copy',
        assistantId: 'archive-copy-assistant',
        sessionId: null,
      });
      expect(imported.id).toBe('project-archive-copy');
      expect(imported.assistantId).toBe('archive-copy-assistant');
      expect(imported.sessionId).toBeNull();
      expect(imported.name).toBe(source.name);

      const sourceFiles = await htmlProjectStore.listFiles(source.id);
      const importedFiles = await htmlProjectStore.listFiles(imported.id);
      expect(importedFiles).toEqual(sourceFiles);
      expect((await htmlProjectStore.readFile(imported.id, '/draft.md'))?.content).toBe(
        'uncommitted draft',
      );
      expect(await htmlProjectStore.listTodos(imported.id)).toEqual([
        expect.objectContaining({ projectId: imported.id, id: 'todo-1', title: 'Review archive' }),
      ]);

      const sourceSnapshots = await htmlProjectStore.listSnapshots(source.id);
      const importedSnapshots = await htmlProjectStore.listSnapshots(imported.id);
      expect(importedSnapshots.snapshots).toEqual(
        sourceSnapshots.snapshots.map(snapshotRecord => ({
          ...snapshotRecord,
          projectId: imported.id,
        })),
      );
      expect(importedSnapshots.snapshots[0].oid).toBe(snapshot.oid);
      expect(await gitService.log(imported.id)).toEqual(await gitService.log(source.id));
    });

    it('does not overwrite an existing project id', async () => {
      const source = await htmlProjectStore.createProject({
        assistantId: 'archive-source-assistant-2',
        name: 'Archive source',
      });
      await htmlProjectStore.writeFiles(source.id, [
        { path: '/index.html', kind: 'html', content: '<html></html>' },
      ]);
      const archive = await htmlProjectStore.exportProjectArchive(source.id);
      await expect(
        htmlProjectStore.importProjectArchive(archive, {
          projectId: 'project-archive-implicit-parent',
        }),
      ).rejects.toThrow(/explicit assistantId\/sessionId|preserveForeignKeys/i);
      const existing = await htmlProjectStore.createProject({
        assistantId: 'archive-existing-assistant',
        name: 'Existing',
      });

      await expect(
        htmlProjectStore.importProjectArchive(archive, {
          projectId: existing.id,
          preserveForeignKeys: true,
        }),
      ).rejects.toThrow(/already exists|overwrite/i);
      expect(await htmlProjectStore.getProject(existing.id)).toEqual(existing);
    });

    it('serializes concurrent imports and preserves only the winning metadata/repository', async () => {
      const source = await htmlProjectStore.createProject({
        assistantId: 'archive-concurrent-source-assistant',
        name: 'Concurrent archive source',
      });
      await htmlProjectStore.writeFiles(source.id, [
        { path: '/index.html', kind: 'html', content: '<html>concurrent</html>' },
      ]);
      await htmlProjectStore.replaceTodos(source.id, [
        { id: 'todo-concurrent', title: 'Keep winner', status: 'pending' },
      ]);
      const archive = await htmlProjectStore.exportProjectArchive(source.id);
      const targetId = 'project-archive-concurrent-copy';

      const results = await Promise.allSettled([
        htmlProjectStore.importProjectArchive(archive, {
          projectId: targetId,
          preserveForeignKeys: true,
        }),
        htmlProjectStore.importProjectArchive(archive, {
          projectId: targetId,
          preserveForeignKeys: true,
        }),
      ]);
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
      const imported = await htmlProjectStore.getProject(targetId);
      expect(imported?.id).toBe(targetId);
      expect(await htmlProjectStore.listTodos(targetId)).toEqual([
        expect.objectContaining({ projectId: targetId, id: 'todo-concurrent' }),
      ]);
      expect(await gitService.log(targetId)).toEqual(await gitService.log(source.id));
    });
  });

  describe('listProjectsByAssistant + renameProject', () => {
    it('只列出該助理專案,依 updatedAt 新到舊排序', async () => {
      const aid = uniqueId();
      const p1 = await htmlProjectStore.createProject({ assistantId: aid, name: 'p1' });
      await new Promise(r => setTimeout(r, 5));
      const p2 = await htmlProjectStore.createProject({ assistantId: aid, name: 'p2' });
      await htmlProjectStore.createProject({ assistantId: `${aid}-other`, name: 'other' });

      const list = await htmlProjectStore.listProjectsByAssistant(aid);
      expect(list).toHaveLength(2);
      expect(list.map(p => p.id)).toEqual([p2.id, p1.id]); // 新到舊
    });

    it('renameProject:trim 名稱 + 更新 updatedAt', async () => {
      const project = await htmlProjectStore.createProject({ assistantId: 'a1', name: 'old' });
      const renamed = await htmlProjectStore.renameProject(project.id, 'a1', '  new name  ');
      expect(renamed.name).toBe('new name');
      expect(renamed.updatedAt).toBeGreaterThanOrEqual(project.updatedAt);
    });

    it('renameProject 拒絕空白名稱', async () => {
      const project = await htmlProjectStore.createProject({ assistantId: 'a1', name: 'p' });
      await expect(htmlProjectStore.renameProject(project.id, 'a1', '   ')).rejects.toThrow(
        /required/i,
      );
    });
  });

  describe('normalizePath 驗證', () => {
    const expectPathError = async (fn: () => Promise<unknown>) => {
      await expect(fn()).rejects.toThrow(HtmlProjectPathValidationError);
    };

    it('正規化等價非穿越路徑', async () => {
      const project = await htmlProjectStore.createProject({ assistantId: 'a1', name: 'p' });
      await htmlProjectStore.writeFiles(project.id, [
        { path: 'src/./app.js', kind: 'js', content: 'x' },
      ]);
      const file = await htmlProjectStore.readFile(project.id, '/src/app.js');
      expect(file).toBeDefined();
    });

    it('拒絕控制字元路徑', async () => {
      const project = await htmlProjectStore.createProject({ assistantId: 'a1', name: 'p' });
      await expectPathError(() =>
        htmlProjectStore.writeFiles(project.id, [{ path: '/a\tb.js', kind: 'js', content: 'x' }]),
      );
    });

    it('拒絕 parent-traversal 路徑', async () => {
      const project = await htmlProjectStore.createProject({ assistantId: 'a1', name: 'p' });
      await expectPathError(() =>
        htmlProjectStore.writeFiles(project.id, [{ path: '/a/../b.js', kind: 'js', content: 'x' }]),
      );
    });

    it('拒絕 protocol-like / 外部路徑', async () => {
      const project = await htmlProjectStore.createProject({ assistantId: 'a1', name: 'p' });
      await expectPathError(() =>
        htmlProjectStore.writeFiles(project.id, [
          { path: 'http://evil.com/x.js', kind: 'js', content: 'x' },
        ]),
      );
    });

    it('拒絕空路徑', async () => {
      const project = await htmlProjectStore.createProject({ assistantId: 'a1', name: 'p' });
      await expectPathError(() =>
        htmlProjectStore.writeFiles(project.id, [{ path: '   ', kind: 'js', content: 'x' }]),
      );
    });

    it('拒絕 reserved-path (.git / .educare) 並回傳正確 code', async () => {
      const project = await htmlProjectStore.createProject({ assistantId: 'a1', name: 'p' });
      try {
        await htmlProjectStore.writeFiles(project.id, [
          { path: '/.git/x', kind: 'js', content: 'x' },
        ]);
        throw new Error('should throw');
      } catch (error) {
        expect(error).toBeInstanceOf(HtmlProjectPathValidationError);
        expect((error as HtmlProjectPathValidationError).code).toBe('reserved-path');
      }
    });
  });

  describe('dependency 推導', () => {
    it('推導 html/css/js 引用並跳過外部 scheme', async () => {
      const project = await htmlProjectStore.createProject({ assistantId: 'a1', name: 'p' });
      await htmlProjectStore.writeFiles(project.id, [
        {
          path: '/index.html',
          kind: 'html',
          content:
            '<link rel="stylesheet" href="/style.css"><script src="https://cdn.com/lib.js"></script><img src="/img/logo.png">',
        },
      ]);
      const files = await htmlProjectStore.listFiles(project.id);
      const html = files.find(f => f.path === '/index.html')!;
      expect(html.dependencies).toContain('/style.css');
      expect(html.dependencies).toContain('/img/logo.png');
      expect(html.dependencies).not.toContain('https://cdn.com/lib.js'); // 外部 scheme 跳過
    });
  });

  describe('todos', () => {
    it('replace/list/update/delete + summary', async () => {
      const project = await htmlProjectStore.createProject({ assistantId: 'a1', name: 'p' });
      const { summary } = await htmlProjectStore.replaceTodos(project.id, [
        { title: 'T1', status: 'completed' },
        { title: 'T2', status: 'in_progress' },
        { title: 'T3' },
      ]);
      expect(summary.total).toBe(3);
      expect(summary.completed).toBe(1);
      expect(summary.inProgress).toBe(1);
      expect(summary.pending).toBe(1);

      const todos = await htmlProjectStore.listTodos(project.id);
      expect(todos).toHaveLength(3);

      const updated = await htmlProjectStore.updateTodo(project.id, todos[0].id, {
        title: 'Renamed',
      });
      expect(updated.todo.title).toBe('Renamed');

      const afterDelete = await htmlProjectStore.deleteTodo(project.id, todos[2].id);
      expect(afterDelete.summary.total).toBe(2);
    });
  });

  describe('deleteProject + deleteProjectsByAssistant', () => {
    it('deleteProject:刪除專案 + 連帶檔案;不影響其他助理', async () => {
      const p1 = await htmlProjectStore.createProject({ assistantId: 'a1', name: 'p1' });
      const p2 = await htmlProjectStore.createProject({ assistantId: 'a2', name: 'p2' });
      await htmlProjectStore.writeFiles(p1.id, [
        { path: '/index.html', kind: 'html', content: 'x' },
      ]);
      await htmlProjectStore.writeFiles(p2.id, [
        { path: '/index.html', kind: 'html', content: 'y' },
      ]);

      await htmlProjectStore.deleteProject(p1.id, 'a1');
      expect(await htmlProjectStore.getProject(p1.id)).toBeUndefined();
      expect(await htmlProjectStore.getProject(p2.id)).toBeDefined();
    });

    it('deleteProject 拒絕非擁有者', async () => {
      const project = await htmlProjectStore.createProject({ assistantId: 'a1', name: 'p' });
      await expect(htmlProjectStore.deleteProject(project.id, 'a2')).rejects.toThrow(/not found/i);
    });

    it('deleteProject: storage cleanup failure rejects and preserves project metadata', async () => {
      const project = await htmlProjectStore.createProject({ assistantId: 'a1', name: 'p' });
      const cleanupSpy = vi
        .spyOn(gitService, 'deleteProjectDirUnsafe')
        .mockRejectedValue(new Error('flush failed'));
      try {
        await expect(htmlProjectStore.deleteProject(project.id, 'a1')).rejects.toThrow(
          'flush failed',
        );
        expect(await htmlProjectStore.getProject(project.id)).toEqual(project);
      } finally {
        cleanupSpy.mockRestore();
      }
    });

    it('deleteProjectsByAssistant:刪除該助理所有專案', async () => {
      const aid = uniqueId();
      await htmlProjectStore.createProject({ assistantId: aid, name: 'p1' });
      await htmlProjectStore.createProject({ assistantId: aid, name: 'p2' });
      const other = await htmlProjectStore.createProject({
        assistantId: `${aid}-other`,
        name: 'other',
      });

      const count = await htmlProjectStore.deleteProjectsByAssistant(aid);
      expect(count).toBe(2);
      expect(await htmlProjectStore.listProjectsByAssistant(aid)).toHaveLength(0);
      expect(await htmlProjectStore.getProject(other.id)).toBeDefined();
    });
  });

  describe('snapshot retention (上限 20)', () => {
    it('listSnapshots 回傳 ≤ 20 筆 (retainedLimit)', async () => {
      const project = await htmlProjectStore.createProject({ assistantId: 'a1', name: 'p' });
      // 建立 22 個 snapshot (每個變更內容以產生不同 commit)
      for (let i = 0; i < 22; i += 1) {
        await htmlProjectStore.writeFiles(project.id, [
          { path: '/index.html', kind: 'html', content: `<html>v${i}</html>` },
        ]);
        await htmlProjectStore.createSnapshot(project.id, `snap${i}`);
      }
      const list = await htmlProjectStore.listSnapshots(project.id);
      expect(list.retainedLimit).toBe(20);
      expect(list.snapshots.length).toBeLessThanOrEqual(20);
    });
  });
});
