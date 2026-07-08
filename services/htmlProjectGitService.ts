/**
 * htmlProjectGitService — 本地 git 版控層 (isomorphic-git + LightningFS)。
 *
 * 設計依據：.omc/plans/2026-07-08-html-project-isomorphic-git.md
 * - D1: LightningFS('/projects/<id>/') 為檔案內容唯一真實來源；metadata 由 store 寫入 repo 內 /.educare/meta.json。
 * - D3: commit trailer 'Preview-Version: <n>' 對映數字 version；'Educare-Snapshot: true' 標記 snapshot commits。
 * - D4: commitAll 以 statusMatrix({ignored:true}) 暫存 add/modify/remove（.gitignore 符合檔案仍收錄）。
 * - D5: commit identity 固定 {name:'EduCare', email:'educare@local'}。
 * - D7: isomorphic-git / lightning-fs / diff 全程動態 import，獨立 vite chunk，不進首屏 bundle。
 *
 * 本檔僅處理 git 層；檔案 metadata、encoding 邊界、reserved-path 防護由 htmlProjectStore 负责。
 *
 * 已知限制 (2026-07-08 手動 e2e 一次性觀察,無法重現):LightningFS superblock 的 debounce
 * flush 與操作交錯可能產生持久化 race,使 branch ref 指向不存在的 commit object(repo 損壞)。
 * 此類損壞會由 log()/status()/restoreCommitTree() 以錯誤浮現(不靜默回空歷史);
 * 人工修復方式:把 ref 寫回最近一個有效 commit oid。
 */
import type { HtmlProjectFileKind } from '../types';

// --- 動態 import 型別 (避免把 isomorphic-git/lightning-fs 拉入靜態依賴圖) ---
type FsInstance = {
  promises: {
    mkdir(filepath: string, options?: { mode?: number }): Promise<void>;
    readdir(filepath: string): Promise<string[]>;
    writeFile(
      filepath: string,
      data: Uint8Array | string,
      options?: { mode?: number } | string,
    ): Promise<void>;
    readFile(filepath: string): Promise<Uint8Array>;
    readFile(filepath: string, options: 'utf8' | { encoding: 'utf8' }): Promise<string>;
    unlink(filepath: string): Promise<void>;
    rename(oldFilepath: string, newFilepath: string): Promise<void>;
    stat(
      filepath: string,
    ): Promise<{ type: 'file' | 'dir'; size: number; isDirectory(): boolean; isFile(): boolean }>;
    rmdir(filepath: string): Promise<void>;
  };
};

/** 將 WalkerEntry.content() (Uint8Array | void) 正規化為 Uint8Array (void → 空陣列)。 */
function toBytes(content: Uint8Array | void): Uint8Array {
  return content instanceof Uint8Array ? content : new Uint8Array(0);
}

type GitModule = typeof import('isomorphic-git');

const HTML_FS_NAME = 'educare-html-projects-fs';
const PROJECTS_ROOT = '/projects';
const META_DIR = '.educare';
const COMMIT_AUTHOR = { name: 'EduCare', email: 'educare@local' };

/** Trailer keys (D3)。附於 commit message 末段,供 listSnapshots/resolveVersion 解析。 */
const TRAILER_PREVIEW_VERSION = 'Preview-Version';
const TRAILER_SNAPSHOT = 'Educare-Snapshot';

const GIT_MOD_CACHE: { mod: Promise<GitModule> | null } = { mod: null };
const FS_CACHE: { fs: Promise<FsInstance> | null } = { fs: null };

/** 單檔 diff 內容上限 (沿用 store MAX_SEARCHABLE_FILE_SIZE),超過僅回狀態不產 unified diff。 */
const MAX_DIFF_CONTENT_SIZE = 250 * 1024;

/**
 * 瀏覽器環境缺少 Node 的 Buffer 全域,isomorphic-git 內部 (_GitIndex / hashBlob /
 * commit 等) 直接使用 Buffer 會拋 ReferenceError。在動態載入 isomorphic-git 前
 * 注入 buffer polyfill (lazy,僅在使用 git 時載入,不影響首屏 bundle — D7)。
 */
let bufferPolyfilled = false;
async function ensureBufferPolyfill(): Promise<void> {
  if (bufferPolyfilled) {
    return;
  }
  if (typeof globalThis.Buffer === 'undefined') {
    const { Buffer } = await import('buffer');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).Buffer = Buffer;
  }
  bufferPolyfilled = true;
}

async function getGit(): Promise<GitModule> {
  if (!GIT_MOD_CACHE.mod) {
    GIT_MOD_CACHE.mod = (async () => {
      await ensureBufferPolyfill();
      return import('isomorphic-git');
    })();
  }
  return GIT_MOD_CACHE.mod;
}

/**
 * 取得 LightningFS 單例 (D1)。生產環境使用 IndexedDB-backed 預設 backend。
 * 測試可經 __setFsInstanceForTesting 注入自訂/隔離的 FS (避免 superblock 跨測試污染)。
 */
async function getFs(): Promise<FsInstance> {
  if (!FS_CACHE.fs) {
    FS_CACHE.fs = (async () => {
      await ensureBufferPolyfill();
      const mod = await import('@isomorphic-git/lightning-fs');
      // `export = FS` → esModuleInterop 下掛於 default
      const LightningFS = (mod as unknown as { default: new (name: string) => FsInstance }).default;
      return new LightningFS(HTML_FS_NAME);
    })();
  }
  return FS_CACHE.fs;
}

/** 測試專用:注入隔離的 FS 實例 (獨立 name/避免 IndexedDB 跨測試污染)。 */
export function __setFsInstanceForTesting(fs: FsInstance | null): void {
  FS_CACHE.fs = fs ? Promise.resolve(fs) : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFs = any;

function dirFor(projectId: string): string {
  return `${PROJECTS_ROOT}/${projectId}`;
}

function gitdirFor(projectId: string): string {
  return `${dirFor(projectId)}/.git`;
}

/** LightningFS 無 recursive mkdir,需逐層建立。 */
async function mkdirp(promises: FsInstance['promises'], target: string): Promise<void> {
  const segments = target.split('/').filter(Boolean);
  let current = '';
  for (const segment of segments) {
    current += `/${segment}`;
    try {
      await promises.mkdir(current);
    } catch (error) {
      // EEXIST-like: 目錄已存在,忽略
      const message = error instanceof Error ? error.message : String(error);
      if (!/exists|EEXIST/i.test(message)) {
        throw error;
      }
    }
  }
}

async function pathExists(promises: FsInstance['promises'], target: string): Promise<boolean> {
  try {
    await promises.stat(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * 是否為使用者不可見的保留路徑 (.git / .educare) (D6)。
 * 用於「對外呈現」的檔案清單 (log files / status / diff 結果) 過濾。
 * 注意:.educare 仍需被 commit (隨 tree 版控),只是不對 agent/UI 顯示。
 */
function isReservedPath(filepath: string): boolean {
  const segments = filepath.split('/').filter(Boolean);
  return segments.some(segment => segment === '.git' || segment === '.educare');
}

/**
 * 是否為 git 內部路徑 (`.git` segment)。
 * isomorphic-git 的 statusMatrix/workdir walker 不會自動跳過 `.git`,
 * 會把 `.git/index`、`.git/HEAD` 等視為未追蹤檔案回傳 — 若 stage 這些會把
 * git 內部檔案 commit 進 tree,之後讀該 tree 時 isomorphic-git 拋 UnsafeFilepathError。
 * 因此 commitAll/status/diff 的工作樹處理必須顯式排除 `.git`(但保留 `.educare`)。
 */
function isGitInternalPath(filepath: string): boolean {
  const segments = filepath.split('/').filter(Boolean);
  return segments.some(segment => segment === '.git');
}

/**
 * 遞迴列舉工作目錄下的檔案 (相對於 dir 的 posix 路徑),僅排除 `.git`。
 * `.educare` 保留 (其 meta.json 需隨 commit 版控);`.git` 永不納入版控。
 * 回傳相對路徑陣列 (不含前導 /)。
 */
async function listWorkdirFiles(
  promises: FsInstance['promises'],
  base: string,
  relative = '',
): Promise<string[]> {
  const entries = await promises.readdir(base);
  const results: string[] = [];
  for (const entry of entries) {
    const rel = relative ? `${relative}/${entry}` : entry;
    if (isGitInternalPath(rel)) {
      continue;
    }
    const absolute = `${base}/${entry}`;
    const stat = await promises.stat(absolute);
    if (stat.isDirectory()) {
      const nested = await listWorkdirFiles(promises, absolute, rel);
      results.push(...nested);
    } else {
      results.push(rel);
    }
  }
  return results;
}

// --- commit message trailer 處理 (D3) ---

function buildCommitMessage(
  message: string,
  previewVersion: number | undefined,
  isSnapshot: boolean,
): string {
  const trimmed = message.trim() || '(no message)';
  const trailers: string[] = [];
  if (typeof previewVersion === 'number') {
    trailers.push(`${TRAILER_PREVIEW_VERSION}: ${previewVersion}`);
  }
  if (isSnapshot) {
    trailers.push(`${TRAILER_SNAPSHOT}: true`);
  }
  if (trailers.length === 0) {
    return trimmed;
  }
  // trailer block 與 body 以空行分隔,符合 git trailer 慣例
  return `${trimmed}\n\n${trailers.join('\n')}`;
}

/** 解析 message 中的指定 trailer (取最後一筆符合,避免 body 內同名行干擾)。 */
function parseTrailer(message: string, key: string): string | undefined {
  const pattern = new RegExp(`^${key}:\\s*(.+)$`, 'im');
  const matches = message.match(pattern);
  return matches ? matches[1].trim() : undefined;
}

function parsePreviewVersion(message: string): number | undefined {
  const raw = parseTrailer(message, TRAILER_PREVIEW_VERSION);
  if (raw === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function isSnapshotCommit(message: string): boolean {
  return parseTrailer(message, TRAILER_SNAPSHOT)?.toLowerCase() === 'true';
}

export interface GitCommitSummary {
  oid: string;
  shortOid: string;
  message: string;
  /** message 去除 trailer block 後的純文字 (即 note / commit subject-body)。 */
  note: string;
  previewVersion: number | undefined;
  timestamp: number;
  isSnapshot: boolean;
  /** 該 commit tree 內的使用者檔案路徑 (濾除 .educare)。 */
  files: string[];
}

export interface CommitAllOptions {
  /** 當下 previewVersion,附為 Preview-Version trailer。 */
  previewVersion?: number;
  /** 是否為 snapshot commit (createSnapshot 呼叫點)。 */
  isSnapshot?: boolean;
  /**
   * 允許產生空 commit (working tree 無變更時仍建立 commit)。
   * 預設 false — 無變更時回傳 null。run-start 快照語意需傳 true。
   */
  allowEmpty?: boolean;
  /** 覆寫 commit timestamp (遷移 replay 用,保留原 createdAt)。 */
  timestamp?: number;
}

// --- 對外 API ---

/**
 * 確保專案目錄與 git repo 存在 (D1)。冪等:已存在則跳過 init。
 * 回傳 { dir, gitdir, fs, promises, git } 共用 context 供內部鏈路使用。
 */
async function ensureContext(projectId: string) {
  const fs = await getFs();
  const promises = fs.promises;
  const git = await getGit();
  const dir = dirFor(projectId);
  const gitdir = gitdirFor(projectId);

  await mkdirp(promises, dir);

  const gitdirExists = await pathExists(promises, gitdir);
  if (!gitdirExists) {
    await git.init({ fs: fs as AnyFs, dir, gitdir, defaultBranch: 'main' });
  }

  return { fs, promises, git, dir, gitdir };
}

/** 確保 repo 存在 (公開入口,供 store createProject 呼叫)。 */
export async function ensureRepo(projectId: string): Promise<void> {
  await ensureContext(projectId);
}

/**
 * 是否為 unborn HEAD 訊號 (fresh repo 尚無任何 commit)。
 * isomorphic-git 對「branch ref 不存在 (unborn)」與「ref 指向的 object 不存在 (repo 損壞)」
 * 拋的都是 NotFoundError /「Could not find ...」,必須以「缺的目標」區分:
 * ref 名稱 (HEAD / refs/...) = unborn;40-hex oid = 損壞,不得吞掉。
 * 優先用結構化欄位 (code/data.what),訊息 regex 僅作 fallback。
 */
function isUnbornHeadError(error: unknown): boolean {
  const err = error as { code?: string; data?: { what?: string } };
  if (err?.code === 'NotFoundError' && typeof err.data?.what === 'string') {
    return err.data.what === 'HEAD' || err.data.what.startsWith('refs/');
  }
  const message = error instanceof Error ? error.message : String(error);
  return /unborn|could not find (?:HEAD|refs\/)/i.test(message);
}

/** repo 是否已有 commit (HEAD 已 born)。 */
async function hasCommits(
  git: GitModule,
  fs: FsInstance,
  dir: string,
  gitdir: string,
): Promise<boolean> {
  try {
    await git.log({ fs: fs as AnyFs, dir, gitdir, depth: 1 });
    return true;
  } catch (error) {
    if (isUnbornHeadError(error)) {
      return false;
    }
    // 其他錯誤 (如 ref 指向不存在的 object = repo 損壞) 不可誤判為「無 commit」,
    // 否則 log()/status() 會靜默回報空歷史/全 untracked,遮蔽損壞訊號 (Bug 2)。
    throw error;
  }
}

/**
 * 暫存所有變更並 commit (D4)。
 *
 * 變更偵測採 content-based (hashBlob 比對 HEAD tree blob oid),**不依賴 statusMatrix 的
 * stat-cache 快速路徑**。isomorphic-git 的 statusMatrix 對「同 size 且同一秒內覆寫」的檔案
 * 會因 mtimeSeconds/size/inode 命中快取而誤判為 unchanged (compareStats),造成實際內容變更
 * 漏 commit — 對本地版控是不可接受的靜默資料遺失。故此處顯式比對內容 SHA。
 *
 * - added: 工作樹檔案不在 HEAD。
 * - modified: 在兩處但 blob oid 不同。
 * - deleted: HEAD 檔案不在工作樹 (排除 .git)。
 * - 無變更時:allowEmpty=false 回傳 null;allowEmpty=true 以 HEAD tree 建立 commit (run-start 語意)。
 * - unborn HEAD: 全部工作樹檔案視為 added,建立 root commit。
 */
export async function commitAll(
  projectId: string,
  message: string,
  options: CommitAllOptions = {},
): Promise<string | null> {
  const { fs, promises, git, dir, gitdir } = await ensureContext(projectId);
  const { previewVersion, isSnapshot = false, timestamp } = options;
  // snapshot commit 一律記錄當前狀態 (createSnapshot 語意);其餘預設無變更即回傳 null。
  // run-start 去重 (D4) 由呼叫端 (store) 在呼叫前判斷。
  const allowEmpty = options.allowEmpty ?? Boolean(isSnapshot);
  // isomorphic-git 的 author/committer timestamp 規格為「Unix 秒」(非毫秒)。
  // 呼叫端傳毫秒 (Date.now);此處統一轉秒,log() 讀回時再 ×1000 還原毫秒。
  const commitTime = Math.floor((timestamp ?? now()) / 1000);
  const identity = {
    author: { ...COMMIT_AUTHOR, timestamp: commitTime, timezoneOffset: 0 },
    committer: { ...COMMIT_AUTHOR, timestamp: commitTime, timezoneOffset: 0 },
  };
  const builtMessage = buildCommitMessage(message, previewVersion, isSnapshot);

  const workdirFiles = await listWorkdirFiles(promises, dir);
  const workdirSet = new Set(workdirFiles);

  const born = await hasCommits(git, fs, dir, gitdir);
  let headOid: string | null = null;
  let headOids: Map<string, string> = new Map();
  if (born) {
    headOid = await git.resolveRef({ fs: fs as AnyFs, dir, gitdir, ref: 'HEAD' });
    headOids = await collectTreeOids(git, fs, dir, gitdir, headOid);
  }

  const toAdd: string[] = [];
  for (const filepath of workdirFiles) {
    const headBlobOid = headOids.get(filepath);
    if (headBlobOid === undefined) {
      toAdd.push(filepath); // added
      continue;
    }
    const bytes = await promises.readFile(`${dir}/${filepath}`);
    const { oid } = await git.hashBlob({ object: bytes });
    if (oid !== headBlobOid) {
      toAdd.push(filepath); // modified (content-based,不受 stat cache 影響)
    }
  }
  const toDelete = born
    ? Array.from(headOids.keys()).filter(
        filepath => !workdirSet.has(filepath) && !isGitInternalPath(filepath),
      )
    : [];

  const hasChanges = toAdd.length > 0 || toDelete.length > 0;

  if (!hasChanges && !allowEmpty) {
    return null;
  }

  for (const filepath of toAdd) {
    await git.add({ fs: fs as AnyFs, dir, gitdir, filepath, force: true }); // force 覆寫 .gitignore (D4)
  }
  for (const filepath of toDelete) {
    await git.remove({ fs: fs as AnyFs, dir, gitdir, filepath });
  }

  if (!hasChanges && allowEmpty && headOid) {
    // 以 HEAD tree 建立空 commit (run-start 快照邊界)
    const headCommit = await git.readCommit({ fs: fs as AnyFs, dir, gitdir, oid: headOid });
    return git.commit({
      fs: fs as AnyFs,
      dir,
      gitdir,
      message: builtMessage,
      ...identity,
      tree: headCommit.commit.tree,
      parent: [headOid],
    });
  }

  return git.commit({ fs: fs as AnyFs, dir, gitdir, message: builtMessage, ...identity });
}

/** 收集 commit tree 的 path → blob oid (供 content-based 變更比對;排除 .git/.educare)。 */
async function collectTreeOids(
  git: GitModule,
  fs: FsInstance,
  dir: string,
  gitdir: string,
  oid: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  await git.walk({
    fs: fs as AnyFs,
    dir,
    gitdir,
    trees: [git.TREE({ ref: oid })],
    map: async (filepath, [entry]) => {
      if (!entry) {
        return undefined;
      }
      if (isGitInternalPath(filepath)) {
        return undefined;
      } // .git 不應在 tree,防禦
      const type = await entry.type();
      if (type !== 'blob') {
        return undefined;
      }
      const blobOid = await entry.oid();
      map.set(filepath, blobOid);
      return undefined;
    },
  });
  return map;
}

/**
 * 列舉 commit tree 內的使用者檔案 (濾除 .educare),使用 git.walk。
 * 回傳 posix 相對路徑陣列。
 */
async function listCommitFiles(
  git: GitModule,
  fs: FsInstance,
  dir: string,
  gitdir: string,
  oid: string,
): Promise<string[]> {
  const results: string[] = [];
  await git.walk({
    fs: fs as AnyFs,
    dir,
    gitdir,
    trees: [git.TREE({ ref: oid })],
    map: async (filepath, [entry]) => {
      if (!entry) {
        return undefined;
      }
      if (isReservedPath(filepath)) {
        return undefined;
      }
      const type = await entry.type();
      if (type === 'blob') {
        results.push(filepath);
      }
      return undefined;
    },
  });
  return results.sort((a, b) => a.localeCompare(b));
}

function stripTrailers(message: string): string {
  // isomorphic-git commit message 常帶結尾換行;先剔除再分析 trailer block
  const trimmed = message.replace(/\n+$/, '');
  const lines = trimmed.split('\n');
  // 從尾端往前吃掉連續的 "Key: value" trailer 行
  let i = lines.length - 1;
  while (i >= 0 && /^[A-Za-z][A-Za-z0-9-]*:\s/.test(lines[i])) {
    i -= 1;
  }
  if (i === lines.length - 1) {
    // 無 trailer:整段即 body
    return trimmed.trim();
  }
  // i 指向 trailer block 前最後一行;其後(含分隔空行)全數切除
  return lines
    .slice(0, i + 1)
    .join('\n')
    .replace(/\n+$/, '')
    .trim();
}

/**
 * commit timestamp (Unix 秒) → 毫秒。
 * 向下相容 (Bug 1):2026-07-08 修復前的 commitAll 誤把毫秒值存進 commit 物件;
 * 合法秒值不可能 ≥ 1e11 (≈ 西元 5138 年),故 ≥ 1e11 視為 legacy 毫秒原樣回傳。
 * 所有含 legacy commits 的 repo 淘汰後可移除此 heuristic。
 */
function normalizeCommitTimestamp(raw: number): number {
  return raw >= 1e11 ? raw : raw * 1000;
}

/**
 * 取得 commit 歷史 (新到舊)。
 * files 欄位由 tree walk 取得 (濾除 .educare)。
 */
export async function log(
  projectId: string,
  options: { depth?: number } = {},
): Promise<GitCommitSummary[]> {
  const { fs, git, dir, gitdir } = await ensureContext(projectId);
  // unborn HEAD (fresh repo 無 commit):視為空歷史 (非錯誤)。
  // 注意:不可在此用寬鬆 try/catch 吞 git.log 的錯誤 — missing-object (repo 損壞)
  // 也會丟「Could not find...」訊息,會被誤判為空歷史而遮蔽真正的問題。
  // 故先以 hasCommits 明確區分 unborn,其餘錯誤一律往上拋。
  if (!(await hasCommits(git, fs, dir, gitdir))) {
    return [];
  }
  const commits = await git.log({ fs: fs as AnyFs, dir, gitdir, depth: options.depth });
  const summaries: GitCommitSummary[] = [];
  for (const entry of commits) {
    const message = entry.commit.message;
    const files = (await listCommitFiles(git, fs, dir, gitdir, entry.oid)).map(f => `/${f}`);
    summaries.push({
      oid: entry.oid,
      shortOid: entry.oid.slice(0, 7),
      message,
      note: stripTrailers(message),
      previewVersion: parsePreviewVersion(message),
      timestamp: normalizeCommitTimestamp(entry.commit.committer.timestamp),
      isSnapshot: isSnapshotCommit(message),
      files,
    });
  }
  return summaries;
}

/**
 * 以 Preview-Version trailer 解析目標 commit (最新優先)。
 * 找不到時回傳 undefined (由呼叫端 store 拋出與現行完全一致的錯誤訊息)。
 */
export async function resolveVersion(
  projectId: string,
  version: number,
): Promise<string | undefined> {
  const commits = await log(projectId);
  const matched = commits.find(entry => entry.previewVersion === version);
  return matched?.oid;
}

/**
 * 將指定 commit 的 tree 寫回工作目錄 (D3 revert 語意)。
 * - 寫入該 tree 的所有使用者檔案 (含 .educare/meta.json 以還原 metadata)。
 * - 刪除工作樹中不在該 tree 的多餘檔案。
 * - 不動 HEAD ref / 不建立新 commit (revert 由 store 層於寫回後再 commitAll)。
 */
export async function restoreCommitTree(
  projectId: string,
  oid: string,
): Promise<{ filesRestored: number }> {
  const { fs, promises, git, dir, gitdir } = await ensureContext(projectId);

  // 0. 先驗證目標 commit 物件存在可讀。LightningFS 持久化偶發 race 可能使 ref 指向
  // 不存在的 object — 此處明確報錯,避免後續 walk 靜默回空導致「還原成空專案」。
  try {
    await git.readCommit({ fs: fs as AnyFs, dir, gitdir, oid });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot restore commit ${oid} (object missing or corrupt): ${message}`);
  }

  // 1. 收集目標 tree 全部檔案 (含 .educare) 並寫回工作樹
  const targetFiles = new Set<string>();
  const writeTasks: Array<Promise<void>> = [];
  await git.walk({
    fs: fs as AnyFs,
    dir,
    gitdir,
    trees: [git.TREE({ ref: oid })],
    map: async (filepath, [entry]) => {
      if (!entry) {
        return undefined;
      }
      const type = await entry.type();
      if (type !== 'blob') {
        return undefined;
      }
      targetFiles.add(filepath);
      const absolute = `${dir}/${filepath}`;
      const parentSegments = filepath.split('/').slice(0, -1);
      if (parentSegments.length > 0) {
        await mkdirp(promises, `${dir}/${parentSegments.join('/')}`);
      }
      const content = await entry.content();
      writeTasks.push(promises.writeFile(absolute, toBytes(content)));
      return undefined;
    },
  });
  await Promise.all(writeTasks);

  // 2. 刪除工作樹中不在目標 tree 的多餘檔案 (排除 .git)
  const currentFiles = await listWorkdirFilesAll(promises, dir);
  for (const filepath of currentFiles) {
    if (!targetFiles.has(filepath)) {
      try {
        await promises.unlink(`${dir}/${filepath}`);
      } catch {
        // 已不存在,略過
      }
    }
  }

  // 使用者可見檔案數 (排除 .educare/.git)
  const filesRestored = Array.from(targetFiles).filter(f => !isReservedPath(f)).length;
  return { filesRestored };
}

/** 列舉工作樹所有檔案 (含 .educare,排除 .git) — restore 用。 */
async function listWorkdirFilesAll(
  promises: FsInstance['promises'],
  base: string,
  relative = '',
): Promise<string[]> {
  const entries = await promises.readdir(base);
  const results: string[] = [];
  for (const entry of entries) {
    if (entry === '.git') {
      continue;
    }
    const rel = relative ? `${relative}/${entry}` : entry;
    const absolute = `${base}/${entry}`;
    const stat = await promises.stat(absolute);
    if (stat.isDirectory()) {
      const nested = await listWorkdirFilesAll(promises, absolute, rel);
      results.push(...nested);
    } else {
      results.push(rel);
    }
  }
  return results;
}

export interface GitFileStatus {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'untracked';
}

export interface GitStatusResult {
  clean: boolean;
  added: string[];
  modified: string[];
  deleted: string[];
  untracked: string[];
  unchanged: number;
}

/**
 * 工作樹狀態摘要。content-based (hashBlob 比對 HEAD tree blob oid),
 * 不依賴 statusMatrix stat-cache (同 commitAll,避免同秒同 size 誤判)。
 */
export async function status(projectId: string): Promise<GitStatusResult> {
  const { fs, promises, git, dir, gitdir } = await ensureContext(projectId);
  const born = await hasCommits(git, fs, dir, gitdir);
  const result: GitStatusResult = {
    clean: true,
    added: [],
    modified: [],
    deleted: [],
    untracked: [],
    unchanged: 0,
  };
  const workdirFiles = (await listWorkdirFiles(promises, dir)).filter(f => !isReservedPath(f));
  const workdirSet = new Set(workdirFiles);

  if (!born) {
    result.untracked.push(...workdirFiles.map(f => `/${f}`));
    result.clean = workdirFiles.length === 0;
    return result;
  }

  const headOid = await git.resolveRef({ fs: fs as AnyFs, dir, gitdir, ref: 'HEAD' });
  const headOids = await collectTreeOids(git, fs, dir, gitdir, headOid);

  for (const filepath of workdirFiles) {
    const headBlobOid = headOids.get(filepath);
    if (headBlobOid === undefined) {
      result.added.push(`/${filepath}`);
      continue;
    }
    const bytes = await promises.readFile(`${dir}/${filepath}`);
    const { oid } = await git.hashBlob({ object: bytes });
    if (oid !== headBlobOid) {
      result.modified.push(`/${filepath}`);
    } else {
      result.unchanged += 1;
    }
  }
  for (const headFile of headOids.keys()) {
    if (isReservedPath(headFile)) {
      continue;
    }
    if (!workdirSet.has(headFile)) {
      result.deleted.push(`/${headFile}`);
    }
  }
  result.clean =
    result.added.length === 0 &&
    result.modified.length === 0 &&
    result.deleted.length === 0 &&
    result.untracked.length === 0;
  return result;
}

export interface GitDiffFileChange {
  path: string;
  status: 'added' | 'modified' | 'deleted';
  /** unified diff patch (文字檔且未超過 MAX_DIFF_CONTENT_SIZE);binary/超大檔為 null。 */
  patch: string | null;
  /** 是否因 binary/超大而略過內容 diff。 */
  binary: boolean;
}

export interface GitDiffResult {
  files: GitDiffFileChange[];
}

function decodeBlob(bytes: Uint8Array): { content: string | null; bytes: Uint8Array | null } {
  if (bytes.byteLength > MAX_DIFF_CONTENT_SIZE) {
    return { content: null, bytes };
  }
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { content: decoded, bytes };
  } catch {
    // 無法以 utf-8 解碼 → binary
    return { content: null, bytes };
  }
}

/**
 * 檔案級差異 + 文字 unified diff。
 * - 兩個 ref:比較兩個 commit tree。
 * - 無 ref:working tree vs HEAD (未提交變更)。
 * - binary / >250KB:僅列狀態,patch=null。
 */
export async function diff(
  projectId: string,
  options: { refA?: string; refB?: string } = {},
): Promise<GitDiffResult> {
  const { fs, promises, git, dir, gitdir } = await ensureContext(projectId);
  const { createPatch } = await import('diff');

  const refA = options.refA ?? 'HEAD';
  const refB = options.refB ?? null; // null 表示 working tree

  // 收集兩側檔案集合
  const filesA =
    refA === null
      ? new Map<string, Uint8Array>()
      : await collectTreeFiles(git, fs, dir, gitdir, refA);
  const filesB =
    refB === null
      ? await collectWorkdirFiles(promises, dir)
      : await collectTreeFiles(git, fs, dir, gitdir, refB);

  const allPaths = new Set<string>([...filesA.keys(), ...filesB.keys()]);
  const changes: GitDiffFileChange[] = [];

  for (const filepath of Array.from(allPaths).sort()) {
    if (isReservedPath(filepath)) {
      continue;
    }
    const bytesA = filesA.get(filepath) ?? null;
    const bytesB = filesB.get(filepath) ?? null;

    const aDecoded = bytesA ? decodeBlob(bytesA) : { content: null, bytes: null };
    const bDecoded = bytesB ? decodeBlob(bytesB) : { content: null, bytes: null };

    let statusValue: 'added' | 'modified' | 'deleted';
    if (bytesA === null && bytesB !== null) {
      statusValue = 'added';
    } else if (bytesA !== null && bytesB === null) {
      statusValue = 'deleted';
    } else if (bytesA !== null && bytesB !== null && bytesEqual(bytesA, bytesB)) {
      continue;
    } // 無變更
    else {
      statusValue = 'modified';
    }

    const binary = aDecoded.content === null || bDecoded.content === null;
    const apiPath = `/${filepath}`;
    let patch: string | null = null;
    if (!binary) {
      const oldStr = aDecoded.content ?? '';
      const newStr = bDecoded.content ?? '';
      patch = createPatch(
        apiPath,
        oldStr,
        newStr,
        refA ?? 'working',
        refB === null ? 'working' : refB,
        {
          context: 3,
        },
      );
    }

    changes.push({ path: apiPath, status: statusValue, patch, binary });
  }

  return { files: changes };
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) {
    return false;
  }
  for (let i = 0; i < a.byteLength; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

async function collectTreeFiles(
  git: GitModule,
  fs: FsInstance,
  dir: string,
  gitdir: string,
  ref: string,
): Promise<Map<string, Uint8Array>> {
  const map = new Map<string, Uint8Array>();
  await git.walk({
    fs: fs as AnyFs,
    dir,
    gitdir,
    trees: [git.TREE({ ref })],
    map: async (filepath, [entry]) => {
      if (!entry) {
        return undefined;
      }
      if (isReservedPath(filepath)) {
        return undefined;
      }
      const type = await entry.type();
      if (type !== 'blob') {
        return undefined;
      }
      const content = await entry.content();
      map.set(filepath, toBytes(content));
      return undefined;
    },
  });
  return map;
}

async function collectWorkdirFiles(
  promises: FsInstance['promises'],
  base: string,
): Promise<Map<string, Uint8Array>> {
  const map = new Map<string, Uint8Array>();
  const rels = await listWorkdirFiles(promises, base);
  for (const rel of rels) {
    map.set(rel, await promises.readFile(`${base}/${rel}`));
  }
  return map;
}

// --- branch 基礎 ---

export async function listBranches(projectId: string): Promise<string[]> {
  const { fs, git, dir, gitdir } = await ensureContext(projectId);
  return git.listBranches({ fs: fs as AnyFs, dir, gitdir });
}

export async function createBranch(projectId: string, ref: string): Promise<void> {
  const { fs, git, dir, gitdir } = await ensureContext(projectId);
  await git.branch({ fs: fs as AnyFs, dir, gitdir, ref, checkout: false });
}

/**
 * 切換分支。switch 前檢查 working tree clean,dirty 時拋錯要求先 commit (D 風險表)。
 */
export async function switchBranch(projectId: string, ref: string): Promise<void> {
  const current = await status(projectId);
  if (!current.clean) {
    throw new Error(
      `Cannot switch branch: working tree has uncommitted changes (commit them first). Added: ${current.added.length}, Modified: ${current.modified.length}, Deleted: ${current.deleted.length}.`,
    );
  }
  const { fs, git, dir, gitdir } = await ensureContext(projectId);
  await git.checkout({ fs: fs as AnyFs, dir, gitdir, ref });
}

export async function currentBranch(projectId: string): Promise<string | null> {
  const { fs, git, dir, gitdir } = await ensureContext(projectId);
  const branch = await git.currentBranch({ fs: fs as AnyFs, dir, gitdir, fullname: false });
  return branch ?? null;
}

/** 遞迴刪除專案目錄 (含 .git) — store deleteProjectRecords 共用路徑 (D9/驗收 10)。 */
export async function deleteProjectDir(projectId: string): Promise<void> {
  const fs = await getFs();
  const promises = fs.promises;
  const dir = dirFor(projectId);
  if (!(await pathExists(promises, dir))) {
    return;
  }
  await removeAllRecursive(promises, dir);
}

async function removeAllRecursive(promises: FsInstance['promises'], target: string): Promise<void> {
  let stat;
  try {
    stat = await promises.stat(target);
  } catch {
    return;
  }
  if (stat.isDirectory()) {
    const entries = await promises.readdir(target);
    for (const entry of entries) {
      await removeAllRecursive(promises, `${target}/${entry}`);
    }
    await promises.rmdir(target);
  } else {
    await promises.unlink(target);
  }
}

/**
 * 寫入單一檔案到專案工作樹 (供 store writeFiles 等使用),自動建立父目錄。
 * data 為 Uint8Array (二進位) 或 string (utf-8)。
 */
export async function writeProjectFile(
  projectId: string,
  filepath: string,
  data: Uint8Array | string,
): Promise<void> {
  const { promises, dir } = await ensureContext(projectId);
  const absolute = `${dir}/${filepath}`;
  const parentSegments = filepath.split('/').slice(0, -1);
  if (parentSegments.length > 0) {
    await mkdirp(promises, `${dir}/${parentSegments.join('/')}`);
  }
  await promises.writeFile(absolute, data);
}

/** 讀取專案工作樹檔案 (bytes)。不存在回傳 null。 */
export async function readProjectFile(
  projectId: string,
  filepath: string,
): Promise<Uint8Array | null> {
  const { promises, dir } = await ensureContext(projectId);
  try {
    return await promises.readFile(`${dir}/${filepath}`);
  } catch {
    return null;
  }
}

/** 刪除專案工作樹檔案。不存在視為成功 (回傳 false)。 */
export async function deleteProjectFile(projectId: string, filepath: string): Promise<boolean> {
  const { promises, dir } = await ensureContext(projectId);
  try {
    await promises.unlink(`${dir}/${filepath}`);
    return true;
  } catch {
    return false;
  }
}

/** 重新命名/移動專案工作樹檔案。 */
export async function renameProjectFile(
  projectId: string,
  oldFilepath: string,
  newFilepath: string,
): Promise<void> {
  const { promises, dir } = await ensureContext(projectId);
  const newParentSegments = newFilepath.split('/').slice(0, -1);
  if (newParentSegments.length > 0) {
    await mkdirp(promises, `${dir}/${newParentSegments.join('/')}`);
  }
  await promises.rename(`${dir}/${oldFilepath}`, `${dir}/${newFilepath}`);
}

// --- metadata (/.educare/meta.json) 讀寫 (D1) ---

export interface HtmlProjectFileMeta {
  kind: HtmlProjectFileKind;
  encoding: 'utf-8' | 'base64';
  dependencies?: string[];
  /** 檔案位元組數 (D2 size 語意)。 */
  size: number;
  /** 檔案最後更新時間 (epoch ms)。 */
  updatedAt: number;
}

export type HtmlProjectFileMetaMap = Record<string, HtmlProjectFileMeta>;

const META_FILE = `${META_DIR}/meta.json`;

function metaPath(): string {
  return META_FILE;
}

/** 讀取 /.educare/meta.json。不存在回傳空 map。 */
export async function readMeta(projectId: string): Promise<HtmlProjectFileMetaMap> {
  const { promises, dir } = await ensureContext(projectId);
  try {
    const raw = await promises.readFile(`${dir}/${metaPath()}`, 'utf8');
    return JSON.parse(raw) as HtmlProjectFileMetaMap;
  } catch {
    return {};
  }
}

/** 寫入 /.educare/meta.json (覆寫整份)。 */
export async function writeMeta(projectId: string, meta: HtmlProjectFileMetaMap): Promise<void> {
  const { promises, dir } = await ensureContext(projectId);
  await mkdirp(promises, `${dir}/${META_DIR}`);
  await promises.writeFile(`${dir}/${metaPath()}`, JSON.stringify(meta, null, 2), 'utf8');
}

// --- 測試 helper ---

/** 測試專用:重置所有模組級快取 (FS 單例、git 模組快取)。 */
export function __resetGitServiceForTesting(): void {
  FS_CACHE.fs = null;
  GIT_MOD_CACHE.mod = null;
}

/** 提供給 store 測試:以指定 name 建立 (隔離的) LightningFS 並回傳。 */
export async function createIsolatedFs(name: string): Promise<FsInstance> {
  const mod = await import('@isomorphic-git/lightning-fs');
  const LightningFS = (
    mod as unknown as { default: new (name: string, options?: { wipe?: boolean }) => FsInstance }
  ).default;
  return new LightningFS(name, { wipe: true });
}

const now = (): number => Date.now();
