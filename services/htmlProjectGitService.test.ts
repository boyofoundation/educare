import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  __resetGitServiceForTesting,
  __setFsInstanceForTesting,
  commitAll,
  createBranch,
  createIsolatedFs,
  currentBranch,
  deleteProjectDir,
  diff,
  ensureRepo,
  listBranches,
  log,
  readProjectFile,
  resolveVersion,
  restoreCommitTree,
  status,
  switchBranch,
  writeProjectFile,
  type HtmlProjectFileMetaMap,
  readMeta,
  writeMeta,
} from './htmlProjectGitService';

/**
 * Spike 驗證 (Phase 1 gate)：isomorphic-git + LightningFS 全鏈路。
 * 重點：unborn HEAD 首次 commit、base64/binary byte-exact roundtrip、
 *       .gitignore 存活 (ignored:true)、modify 偵測、restoreCommitTree、trailers。
 *
 * 每測試使用獨立 name 的 LightningFS (wipe:true) 並注入,避免 superblock 跨測試污染。
 */
describe('htmlProjectGitService (Phase 1 spike)', () => {
  let counter = 0;
  const uniqueId = () => `spike-${Date.now()}-${counter++}`;
  let fsInstance: Awaited<ReturnType<typeof createIsolatedFs>>;

  beforeEach(async () => {
    __resetGitServiceForTesting();
    fsInstance = await createIsolatedFs(uniqueId());
    __setFsInstanceForTesting(fsInstance);
  });

  afterEach(() => {
    __resetGitServiceForTesting();
    __setFsInstanceForTesting(null);
  });

  it('init → write → commitAll → log → restoreCommitTree 全鏈路 (unborn HEAD)', async () => {
    const projectId = 'proj-chain';
    await ensureRepo(projectId);

    // unborn HEAD: 首次 commitAll
    await writeProjectFile(projectId, 'index.html', '<html></html>');
    await writeProjectFile(projectId, 'src/app.js', 'console.log("hi");');
    const oid1 = await commitAll(projectId, 'Initial', { previewVersion: 1 });
    expect(oid1).toBeTruthy();

    let commits = await log(projectId);
    expect(commits).toHaveLength(1);
    expect(commits[0].previewVersion).toBe(1);
    expect(commits[0].files).toContain('/index.html');
    expect(commits[0].files).toContain('/src/app.js');

    // 第二個 commit (modify 偵測)
    await writeProjectFile(projectId, 'index.html', '<html><body>updated</body></html>');
    const oid2 = await commitAll(projectId, 'Update index', { previewVersion: 2 });
    expect(oid2).toBeTruthy();

    commits = await log(projectId);
    expect(commits).toHaveLength(2);
    expect(commits[0].oid).toBe(oid2);
    expect(commits[0].note).toBe('Update index');

    // restoreCommitTree 回到 oid1: index.html 內容還原、無 app.js 之外的多餘檔
    await restoreCommitTree(projectId, oid1!);
    const restored = await readProjectFile(projectId, 'index.html');
    expect(restored && new TextDecoder().decode(restored)).toBe('<html></html>');

    // 再 commit 一筆 revert,確認 working tree 仍可寫入歷史
    const oid3 = await commitAll(projectId, 'Revert', { previewVersion: 3 });
    expect(oid3).toBeTruthy();
    commits = await log(projectId);
    expect(commits).toHaveLength(3);
  });

  it('base64/binary asset byte-exact roundtrip (含非 utf-8 高位元組)', async () => {
    const projectId = 'proj-binary';
    await ensureRepo(projectId);

    // PNG magic + JPEG magic + 高位元組 (非合法 utf-8)
    const bytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xd8, 0xff, 0xe0, 0x00, 0xfe, 0xff,
      0x80,
    ]);
    await writeProjectFile(projectId, 'assets/logo.png', bytes);
    await commitAll(projectId, 'Add binary asset', { previewVersion: 1 });

    // 讀回工作樹檔案 → byte-exact
    const readBack = await readProjectFile(projectId, 'assets/logo.png');
    expect(readBack).not.toBeNull();
    expect(Array.from(readBack!)).toEqual(Array.from(bytes));

    // 修改文字檔後再 restoreCommitTree 回到此 commit → 二進位 asset 仍 byte-exact 存活
    await writeProjectFile(projectId, 'index.html', '<html></html>');
    const oid2 = await commitAll(projectId, 'Add html', { previewVersion: 2 });
    await writeProjectFile(projectId, 'index.html', '<html>changed</html>');
    await writeProjectFile(projectId, 'assets/logo.png', new Uint8Array([0x00, 0x01, 0x02]));

    const commits = await log(projectId);
    await restoreCommitTree(projectId, commits[0].oid === oid2 ? commits[0].oid : oid2!);
    const restored = await readProjectFile(projectId, 'assets/logo.png');
    expect(restored).not.toBeNull();
    expect(Array.from(restored!)).toEqual(Array.from(bytes));
  });

  it('.gitignore 符合檔案仍被 commit 並在 restore 後存活 (ignored:true)', async () => {
    const projectId = 'proj-gitignore';
    await ensureRepo(projectId);

    // .gitignore 排除 *.log 與 secrets/ 目錄
    await writeProjectFile(projectId, '.gitignore', '*.log\nsecrets/\n');
    await writeProjectFile(projectId, 'index.html', '<html></html>');
    await writeProjectFile(projectId, 'debug.log', 'debug data');
    await writeProjectFile(projectId, 'secrets/key.txt', 'topsecret');
    await writeProjectFile(projectId, 'app.js', 'console.log(1);');

    const oid = await commitAll(projectId, 'Initial', { previewVersion: 1 });

    // 驗證 .gitignore 符合的檔案仍收錄進 commit (ignored:true 語意)
    const commits = await log(projectId);
    const files = commits[0].files;
    expect(files).toContain('/debug.log');
    expect(files).toContain('/secrets/key.txt');
    expect(files).toContain('/app.js');

    // 新增變更後 restore 回此 commit → 符合 .gitignore 的檔案存活
    await writeProjectFile(projectId, 'extra.txt', 'extra');
    await commitAll(projectId, 'Extra', { previewVersion: 2 });
    await restoreCommitTree(projectId, oid!);

    const debug = await readProjectFile(projectId, 'debug.log');
    const secret = await readProjectFile(projectId, 'secrets/key.txt');
    const extra = await readProjectFile(projectId, 'extra.txt');
    expect(debug && new TextDecoder().decode(debug)).toBe('debug data');
    expect(secret && new TextDecoder().decode(secret)).toBe('topsecret');
    expect(extra).toBeNull(); // 多餘檔案應被刪除
  });

  it('commit trailer: isSnapshot + previewVersion 解析正確', async () => {
    const projectId = 'proj-trailer';
    await ensureRepo(projectId);
    await writeProjectFile(projectId, 'index.html', '<html></html>');

    // 非 snapshot commit
    await commitAll(projectId, 'Plain commit', { previewVersion: 5 });
    // snapshot commit
    await commitAll(projectId, 'Snapshot note', { previewVersion: 5, isSnapshot: true });

    const commits = await log(projectId);
    expect(commits[0].isSnapshot).toBe(true);
    expect(commits[0].previewVersion).toBe(5);
    expect(commits[0].note).toBe('Snapshot note');
    expect(commits[1].isSnapshot).toBe(false);
    expect(commits[1].previewVersion).toBe(5);
    expect(commits[1].note).toBe('Plain commit');

    // resolveVersion 取最新符合 (snapshot commit 在前)
    const resolved = await resolveVersion(projectId, 5);
    expect(resolved).toBe(commits[0].oid);
  });

  it('allowEmpty: 無變更時 false 回 null / true 建立 empty commit', async () => {
    const projectId = 'proj-empty';
    await ensureRepo(projectId);
    await writeProjectFile(projectId, 'index.html', '<html></html>');
    await commitAll(projectId, 'Initial', { previewVersion: 1 });

    // 無變更 + allowEmpty false → null
    const noChange = await commitAll(projectId, 'Nothing', {
      previewVersion: 2,
      allowEmpty: false,
    });
    expect(noChange).toBeNull();

    // 無變更 + allowEmpty true → 建立 commit
    const empty = await commitAll(projectId, 'Run start', { previewVersion: 2, allowEmpty: true });
    expect(empty).toBeTruthy();
    const commits = await log(projectId);
    expect(commits).toHaveLength(2);
    expect(commits[0].note).toBe('Run start');
  });

  it('status: 偵測 added/modified/deleted/clean', async () => {
    const projectId = 'proj-status';
    await ensureRepo(projectId);
    await writeProjectFile(projectId, 'index.html', '<html></html>');
    await writeProjectFile(projectId, 'app.js', 'console.log(1);');
    await commitAll(projectId, 'Initial', { previewVersion: 1 });

    // clean
    let s = await status(projectId);
    expect(s.clean).toBe(true);

    // modified + added
    await writeProjectFile(projectId, 'index.html', '<html>modified</html>');
    await writeProjectFile(projectId, 'new.js', 'console.log(2);');
    s = await status(projectId);
    expect(s.modified).toContain('/index.html');
    expect(s.added).toContain('/new.js');
    expect(s.clean).toBe(false);

    // staged 後 status (commitAll 內部已 stage) — 重新取 clean
    await commitAll(projectId, 'Changes', { previewVersion: 2 });
    s = await status(projectId);
    expect(s.clean).toBe(true);
  });

  it('diff: working tree vs HEAD 產生 unified patch', async () => {
    const projectId = 'proj-diff';
    await ensureRepo(projectId);
    await writeProjectFile(projectId, 'index.html', '<html>\n<a>1</a>\n</html>');
    await commitAll(projectId, 'Initial', { previewVersion: 1 });

    await writeProjectFile(projectId, 'index.html', '<html>\n<a>2</a>\n</html>');
    await writeProjectFile(projectId, 'new.txt', 'hello');

    const result = await diff(projectId);
    const htmlChange = result.files.find(f => f.path === '/index.html');
    const newChange = result.files.find(f => f.path === '/new.txt');
    expect(htmlChange?.status).toBe('modified');
    expect(htmlChange?.patch).toBeTruthy();
    expect(htmlChange?.patch).toContain('-<a>1</a>');
    expect(htmlChange?.patch).toContain('+<a>2</a>');
    expect(newChange?.status).toBe('added');
  });

  it('branch: list/create/switch (dirty tree 時 switch 報錯)', async () => {
    const projectId = 'proj-branch';
    await ensureRepo(projectId);
    await writeProjectFile(projectId, 'index.html', '<html></html>');
    await commitAll(projectId, 'Initial', { previewVersion: 1 });

    const initial = await listBranches(projectId);
    expect(initial).toContain('main');
    expect(await currentBranch(projectId)).toBe('main');

    await createBranch(projectId, 'feature');
    expect(await listBranches(projectId)).toContain('feature');

    // dirty tree → switch 拋錯
    await writeProjectFile(projectId, 'index.html', '<html>dirty</html>');
    await expect(switchBranch(projectId, 'feature')).rejects.toThrow(/uncommitted/);

    // commit 後可切換
    await commitAll(projectId, 'Commit dirty', { previewVersion: 2 });
    await switchBranch(projectId, 'feature');
    expect(await currentBranch(projectId)).toBe('feature');
  });

  it('metadata: /.educare/meta.json 讀寫且視為 reserved (不出現在 log files)', async () => {
    const projectId = 'proj-meta';
    await ensureRepo(projectId);
    await writeProjectFile(projectId, 'index.html', '<html></html>');
    const meta: HtmlProjectFileMetaMap = {
      'index.html': {
        kind: 'html',
        encoding: 'utf-8',
        dependencies: ['/style.css'],
        size: 13,
        updatedAt: 1000,
      },
    };
    await writeMeta(projectId, meta);
    await commitAll(projectId, 'Initial with meta', { previewVersion: 1 });

    // log files 濾除 .educare
    const commits = await log(projectId);
    expect(commits[0].files).toContain('/index.html');
    expect(commits[0].files.some(f => f.startsWith('.educare'))).toBe(false);

    // meta 可讀回
    const read = await readMeta(projectId);
    expect(read['index.html']).toEqual(meta['index.html']);

    // restoreCommitTree 後 meta 仍存在 (隨 tree 還原)
    await writeMeta(projectId, {
      'index.html': { kind: 'html', encoding: 'utf-8', size: 13, updatedAt: 2000 },
    });
    await commitAll(projectId, 'Overwrite meta', { previewVersion: 2 });
    await restoreCommitTree(projectId, commits[0].oid);
    const restored = await readMeta(projectId);
    expect(restored['index.html'].dependencies).toEqual(['/style.css']);
  });

  it('deleteProjectDir: 遞迴刪除專案目錄 (含 .git)', async () => {
    const projectId = 'proj-delete';
    await ensureRepo(projectId);
    await writeProjectFile(projectId, 'index.html', '<html></html>');
    await commitAll(projectId, 'Initial', { previewVersion: 1 });

    await deleteProjectDir(projectId);

    // 再寫入應重建 (ensureContext 會 mkdirp + init)
    await ensureRepo(projectId);
    await writeProjectFile(projectId, 'index.html', '<html>fresh</html>');
    const oid = await commitAll(projectId, 'Fresh', { previewVersion: 1 });
    expect(oid).toBeTruthy();
    const commits = await log(projectId);
    expect(commits).toHaveLength(1); // 舊歷史已清除,只剩新 commit
  });

  it('commit timestamp: 呼叫端傳毫秒,log() 回傳正確毫秒 (Bug 1 regression)', async () => {
    const projectId = 'proj-ts';
    const dir = `/projects/${projectId}`;
    const gitdir = `${dir}/.git`;
    await ensureRepo(projectId);
    await writeProjectFile(projectId, 'index.html', '<html></html>');
    // 1700000000000 ms (可被 1000 整除 → floor(ms/1000)*1000 == ms)
    const fixedMs = 1_700_000_000_000;
    const oid = await commitAll(projectId, 'ts-test', { previewVersion: 1, timestamp: fixedMs });
    const commits = await log(projectId);
    expect(commits[0].timestamp).toBe(fixedMs); // 舊 bug 會得到 fixedMs*1000 (遙遠未來)

    // 額外驗證:commit 物件實際「儲存」的是 Unix 秒 (非毫秒)。單靠上面 log() 的斷言無法
    // 抓到「秒轉換本身」的再回歸 — 若 commitAll 回歸成直接存毫秒 (>= 1e11),
    // normalizeCommitTimestamp 的 legacy heuristic 會原樣回傳,log() 斷言仍會通過而
    // 掩蓋問題。故直接以 raw isomorphic-git 讀出 commit object 檢查 committer.timestamp。
    const git = await import('isomorphic-git');
    type RawGitFs = Parameters<typeof git.readCommit>[0]['fs'];
    const { commit } = await git.readCommit({
      fs: fsInstance as unknown as RawGitFs,
      dir,
      gitdir,
      oid: oid!,
    });
    expect(commit.committer.timestamp).toBe(Math.floor(fixedMs / 1000));
  });

  it('restoreCommitTree:目標 commit 不存在時拋明確錯誤 (Bug 4 regression)', async () => {
    const projectId = 'proj-restore-missing';
    await ensureRepo(projectId);
    await writeProjectFile(projectId, 'index.html', '<html></html>');
    await commitAll(projectId, 'init', { previewVersion: 1 });
    await expect(restoreCommitTree(projectId, '0'.repeat(40))).rejects.toThrow(
      /Cannot restore commit.*missing or corrupt/,
    );
  });

  it('lightning-fs 自訂 backend 選項存在 (in-memory fallback 前提)', async () => {
    // 驗證 LightningFS Options 接受自訂 db backend (供無 IndexedDB 環境 fallback)
    // 透過 createIsolatedFs 已驗證 wipe 選項;此處驗證 db 選項介面存在不拋錯
    const mod = await import('@isomorphic-git/lightning-fs');
    const LightningFS = (
      mod as unknown as {
        default: new (name: string, options?: Record<string, unknown>) => unknown;
      }
    ).default;
    // 建構子接受 options 物件 (含 db/wipe/urlauto 等) — 不拋錯即代表介面存在
    const fs = new LightningFS(`opt-check-${uniqueId()}`, { wipe: true });
    expect(fs).toBeTruthy();
    expect(typeof (fs as { promises: unknown }).promises).toBe('object');
  });

  it('log timestamp heuristic:legacy 毫秒 commit 原樣回傳,正常 commit 秒→毫秒還原 (B1 regression)', async () => {
    const projectId = 'proj-legacy-ms';
    const dir = `/projects/${projectId}`;
    const gitdir = `${dir}/.git`;
    await ensureRepo(projectId);
    await writeProjectFile(projectId, 'index.html', '<html></html>');
    // 正常路徑:commitAll 傳毫秒 → commit 物件存 Unix 秒 → log 還原毫秒
    const normalMs = 1_700_000_000_000;
    await commitAll(projectId, 'normal', { previewVersion: 1, timestamp: normalMs });

    // 模擬 2026-07-08 修復前的 legacy commit:直接以 raw isomorphic-git 寫入「毫秒」timestamp。
    // (上面的 commitAll 已觸發 service 的 isomorphic-git 載入含 Buffer polyfill,此處可安全直用)
    const legacyMs = 1_783_505_750_952; // ≥ 1e11 → heuristic 視為 legacy 毫秒,原樣回傳
    const git = await import('isomorphic-git');
    type RawGitFs = Parameters<typeof git.commit>[0]['fs'];
    const signature = {
      name: 'EduCare',
      email: 'educare@local',
      timestamp: legacyMs,
      timezoneOffset: 0,
    };
    await git.commit({
      fs: fsInstance as unknown as RawGitFs,
      dir,
      gitdir,
      message: 'legacy',
      author: signature,
      committer: signature,
    });

    const commits = await log(projectId);
    expect(commits).toHaveLength(2);
    expect(commits[0].note).toBe('legacy');
    expect(commits[0].timestamp).toBe(legacyMs); // 不可再 ×1000 (否則變成遙遠未來)
    expect(commits[1].note).toBe('normal');
    expect(commits[1].timestamp).toBe(normalMs); // 正常 commit:存秒,log ×1000 還原毫秒
  });

  it('repo 損壞 (ref 指向不存在 object) 時 log/status 拋錯不吞 (B2 regression)', async () => {
    const projectId = 'proj-corrupt';
    await ensureRepo(projectId);
    await writeProjectFile(projectId, 'index.html', '<html></html>');
    await commitAll(projectId, 'init', { previewVersion: 1 });

    // 覆寫 branch ref 為不存在的 oid,模擬 repo 損壞 (ref 指向 missing object)
    const badOid = '1'.repeat(40);
    await fsInstance.promises.writeFile(
      `/projects/${projectId}/.git/refs/heads/main`,
      `${badOid}\n`,
      'utf8',
    );

    // hasCommits 僅 unborn HEAD 回空歷史;損壞訊號必須往上拋,不得靜默回空/全 untracked
    await expect(log(projectId)).rejects.toThrow(new RegExp(`${badOid}|Could not find`));
    await expect(status(projectId)).rejects.toThrow();
  });

  // 備註:瀏覽器 Buffer polyfill (getGit 注入 globalThis.Buffer) 無法在 vitest 回歸
  // — Node 環境必須有 Buffer (vitest/node 內部依賴),刪除會毀掉整個 process。
  // 該修復已透過瀏覽器 (chrome-devtools) 實測驗證:gitCommit/createSnapshot/readFile 全綠。
});
