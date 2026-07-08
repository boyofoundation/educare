import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  __resetGitServiceForTesting,
  __setFsInstanceForTesting,
  createBranch,
  createIsolatedFs,
} from './htmlProjectGitService';
import {
  executeHtmlProjectToolCall,
  getHtmlProjectToolDefinitionsForPacks,
  getHtmlProjectToolNamesForPacks,
} from './htmlProjectToolService';
import { buildSubagentTools } from './subagentService';
import { htmlProjectStore } from './htmlProjectStore';
import type { SubagentTaskSpec } from '../types';

/**
 * US-004 驗證:6 個 agent git 工具的 pack 歸屬、handler schema、subagent 排除。
 */
describe('html project git tools (US-004)', () => {
  let counter = 0;
  const uniqueId = () => `git-tools-${Date.now()}-${counter++}`;

  beforeEach(async () => {
    __resetGitServiceForTesting();
    __setFsInstanceForTesting(await createIsolatedFs(uniqueId()));
  });

  afterEach(() => {
    __resetGitServiceForTesting();
    __setFsInstanceForTesting(null);
  });

  describe('pack 歸屬', () => {
    it('inspect pack 含唯讀 git 工具,不含 gitCommit/gitSwitchBranch', () => {
      const names = getHtmlProjectToolNamesForPacks(['inspect']);
      expect(names).toEqual(
        expect.arrayContaining(['gitStatus', 'gitLog', 'gitDiff', 'gitListBranches']),
      );
      expect(names).not.toContain('gitCommit');
      expect(names).not.toContain('gitSwitchBranch');
    });

    it('edit pack 含 gitCommit/gitSwitchBranch', () => {
      const names = getHtmlProjectToolNamesForPacks(['edit']);
      expect(names).toEqual(expect.arrayContaining(['gitCommit', 'gitSwitchBranch']));
    });

    it('6 個 git 工具定義存在且 required 參數正確', () => {
      const defs = getHtmlProjectToolDefinitionsForPacks(['inspect', 'edit']);
      const byName = new Map(defs.map(d => [d.name, d]));
      expect(byName.get('gitCommit')?.parameters.required).toEqual(['message']);
      expect(byName.get('gitSwitchBranch')?.parameters.required).toEqual(['ref']);
      expect(byName.has('gitStatus')).toBe(true);
      expect(byName.has('gitLog')).toBe(true);
      expect(byName.has('gitDiff')).toBe(true);
      expect(byName.has('gitListBranches')).toBe(true);
    });
  });

  describe('subagent 排除 (SUBAGENT_HTML_TOOL_EXCLUSIONS)', () => {
    const baseSpec: SubagentTaskSpec = {
      name: 'sub',
      systemPrompt: 'x',
      task: 'do something',
    };

    it('edit pack 授權 subagent 仍拿不到 gitCommit/gitSwitchBranch', () => {
      const built = buildSubagentTools(
        { ...baseSpec, htmlPacks: ['edit'] },
        { assistantId: 'a1', activeProjectId: null },
      );
      const names = built.tools.map(t => t.name);
      expect(names).not.toContain('gitCommit');
      expect(names).not.toContain('gitSwitchBranch');
      // 但其他 edit 工具仍可用
      expect(names).toContain('writeFiles');
    });

    it('inspect pack 授權 subagent 可用唯讀 git 工具', () => {
      const built = buildSubagentTools(
        { ...baseSpec, htmlPacks: ['inspect'] },
        { assistantId: 'a1', activeProjectId: null },
      );
      const names = built.tools.map(t => t.name);
      expect(names).toContain('gitStatus');
      expect(names).toContain('gitLog');
      expect(names).toContain('gitDiff');
      expect(names).toContain('gitListBranches');
    });
  });

  describe('handler 行為 (整合:真 gitService + store)', () => {
    const setupProject = async (assistantId = 'a1') => {
      const project = await htmlProjectStore.createProject({
        assistantId,
        name: 'Git Project',
        entryFile: '/index.html',
      });
      await htmlProjectStore.writeFiles(project.id, [
        { path: '/index.html', kind: 'html', content: '<html>v1</html>' },
      ]);
      await htmlProjectStore.createSnapshot(project.id, 'snap1');
      return project;
    };

    it('gitStatus:回傳 clean 狀態與正確 schema', async () => {
      const project = await setupProject();
      const result = await executeHtmlProjectToolCall(
        { name: 'gitStatus', args: { projectId: project.id } },
        { assistantId: 'a1', activeProjectId: project.id },
      );
      expect(result.toolName).toBe('gitStatus');
      expect(result.result.clean).toBe(true);
      expect(result.result).toHaveProperty('added');
      expect(result.result).toHaveProperty('modified');
    });

    it('gitLog:回傳 commits 陣列', async () => {
      const project = await setupProject();
      const result = await executeHtmlProjectToolCall(
        { name: 'gitLog', args: { projectId: project.id } },
        { assistantId: 'a1', activeProjectId: project.id },
      );
      expect(result.toolName).toBe('gitLog');
      const commits = result.result.commits as Array<{ shortOid: string; note: string }>;
      expect(Array.isArray(commits)).toBe(true);
      expect(commits.length).toBeGreaterThan(0);
      expect(commits[0]).toHaveProperty('shortOid');
      expect(commits[0]).toHaveProperty('note');
    });

    it('gitDiff:回傳 files 陣列 (working tree vs HEAD)', async () => {
      const project = await setupProject();
      // 製造未提交變更
      await htmlProjectStore.writeFiles(project.id, [
        { path: '/index.html', kind: 'html', content: '<html>v2</html>' },
      ]);
      const result = await executeHtmlProjectToolCall(
        { name: 'gitDiff', args: { projectId: project.id } },
        { assistantId: 'a1', activeProjectId: project.id },
      );
      expect(result.toolName).toBe('gitDiff');
      const diffFiles = result.result.files as Array<{ path: string }>;
      expect(Array.isArray(diffFiles)).toBe(true);
      expect(diffFiles.some(f => f.path === '/index.html')).toBe(true);
    });

    it('gitCommit:提交變更並回傳 oid', async () => {
      const project = await setupProject();
      await htmlProjectStore.writeFiles(project.id, [
        { path: '/index.html', kind: 'html', content: '<html>v3</html>' },
      ]);
      const result = await executeHtmlProjectToolCall(
        { name: 'gitCommit', args: { projectId: project.id, message: 'manual edit' } },
        { assistantId: 'a1', activeProjectId: project.id },
      );
      expect(result.toolName).toBe('gitCommit');
      expect(result.result.committed).toBe(true);
      expect(result.result.oid).toBeTruthy();
    });

    it('gitCommit:空白 message → recoverable 錯誤', async () => {
      const project = await setupProject();
      const result = await executeHtmlProjectToolCall(
        { name: 'gitCommit', args: { projectId: project.id, message: '   ' } },
        { assistantId: 'a1', activeProjectId: project.id },
      );
      expect(result.result.ok).toBe(false);
    });

    it('gitListBranches:回傳分支與 current', async () => {
      const project = await setupProject();
      const result = await executeHtmlProjectToolCall(
        { name: 'gitListBranches', args: { projectId: project.id } },
        { assistantId: 'a1', activeProjectId: project.id },
      );
      expect(result.toolName).toBe('gitListBranches');
      expect(Array.isArray(result.result.branches)).toBe(true);
      expect(result.result.branches).toContain('main');
      expect(result.result.current).toBe('main');
    });

    it('gitSwitchBranch:切換至已存在分支', async () => {
      const project = await setupProject();
      await createBranch(project.id, 'feature');
      const result = await executeHtmlProjectToolCall(
        { name: 'gitSwitchBranch', args: { projectId: project.id, ref: 'feature' } },
        { assistantId: 'a1', activeProjectId: project.id },
      );
      expect(result.toolName).toBe('gitSwitchBranch');
      expect(result.result.switchedTo).toBe('feature');
    });

    it('gitSwitchBranch:dirty tree 時回傳 recoverable 錯誤', async () => {
      const project = await setupProject();
      await createBranch(project.id, 'feature');
      await htmlProjectStore.writeFiles(project.id, [
        { path: '/index.html', kind: 'html', content: '<html>dirty</html>' },
      ]);
      const result = await executeHtmlProjectToolCall(
        { name: 'gitSwitchBranch', args: { projectId: project.id, ref: 'feature' } },
        { assistantId: 'a1', activeProjectId: project.id },
      );
      // switchBranch 拋錯被 executeHtmlProjectToolCall 轉為 recoverable 結果
      expect(result.result.ok).not.toBe(true);
    });
  });
});
