import { openDB, DBSchema, IDBPDatabase } from 'idb';
import {
  HtmlProject,
  HtmlProjectFile,
  HtmlProjectFileDescriptor,
  HtmlProjectFileKind,
  HtmlProjectGitCommitResult,
  HtmlProjectGitLogCommit,
  HtmlProjectGitStatusResult,
  HtmlProjectListSnapshotsResult,
  HtmlProjectRevertToSnapshotResult,
  HtmlProjectSnapshot,
  HtmlProjectTodo,
  HtmlProjectTodoStatus,
  HtmlProjectTodoSummary,
} from '../types';
import * as gitService from './htmlProjectGitService';
import type { HtmlProjectFileMeta, HtmlProjectFileMetaMap } from './htmlProjectGitService';

// --- encoding 邊界 (D2):API 維持 string,FS 存 bytes ---
// base64 ↔ Uint8Array (byte-exact, 供 asset 二進位資產);utf-8 ↔ Uint8Array (TextEncoder/Decoder)。
const base64ToBytes = (base64: string): Uint8Array => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  const chunkSize = 0x8000; // 避免超大字串 stack 溢出
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: false });

/** 將 API string content 依 encoding 編碼為 bytes 寫入 FS。回傳 byte 數 (size)。 */
const encodeContent = (content: string, encoding: 'utf-8' | 'base64'): Uint8Array =>
  encoding === 'base64' ? base64ToBytes(content) : textEncoder.encode(content);

/** 將 FS bytes 依 encoding 解碼回 API string。 */
const decodeContent = (bytes: Uint8Array, encoding: 'utf-8' | 'base64'): string =>
  encoding === 'base64' ? bytesToBase64(bytes) : textDecoder.decode(bytes);

const HTML_PROJECT_DB_NAME = 'educare-html-projects';
const HTML_PROJECT_DB_VERSION = 2;
const PROJECTS_STORE = 'htmlProjects';
const PROJECT_FILES_STORE = 'htmlProjectFiles';
const PROJECT_SNAPSHOTS_STORE = 'htmlProjectSnapshots';
const PROJECT_TODOS_STORE = 'htmlProjectTodos';
const SEARCHABLE_FILE_KINDS = new Set<HtmlProjectFileKind>([
  'html',
  'css',
  'js',
  'json',
  'svg',
  'md',
]);
const DEFAULT_SEARCH_RESULT_LIMIT = 20;
const MAX_SEARCH_RESULTS_PER_FILE = 5;
const MAX_SEARCHABLE_FILE_SIZE = 250 * 1024;
const SEARCH_SNIPPET_RADIUS = 120;
/**
 * G11 快照保留上限。每專案最多保留最近 20 份快照,超出按最舊淘汰。
 */
export const SNAPSHOT_RETENTION_LIMIT = 20;

interface HtmlProjectDB extends DBSchema {
  [PROJECTS_STORE]: {
    key: string;
    value: HtmlProject;
    indexes: {
      'by-assistant': string;
      'by-session': string;
      'by-updated-at': number;
    };
  };
  [PROJECT_FILES_STORE]: {
    key: [string, string];
    value: HtmlProjectFile;
    indexes: {
      'by-project': string;
      'by-project-updated-at': [string, number];
    };
  };
  [PROJECT_SNAPSHOTS_STORE]: {
    key: [string, number];
    value: HtmlProjectSnapshot;
    indexes: {
      'by-project': string;
    };
  };
  [PROJECT_TODOS_STORE]: {
    key: [string, string];
    value: HtmlProjectTodo;
    indexes: {
      'by-project': string;
      'by-project-order': [string, number];
    };
  };
}

export interface CreateHtmlProjectInput {
  assistantId: string;
  sessionId?: string | null;
  name: string;
  description?: string;
  entryFile?: string;
  lastPrompt?: string;
  tags?: string[];
}

export interface WriteHtmlProjectFileInput {
  path: string;
  kind: HtmlProjectFileKind;
  content: string;
  encoding?: 'utf-8' | 'base64';
}

export interface WriteHtmlProjectFilesResult {
  updated: string[];
  previewVersion: number;
}

export interface HtmlProjectSearchMatch {
  path: string;
  kind: HtmlProjectFileKind;
  line: number;
  column: number;
  snippet: string;
  matchCount: number;
}

export interface HtmlProjectSkippedFile {
  path: string;
  reason: 'unsupported-kind' | 'binary-encoding' | 'file-too-large';
}

/**
 * 內部快照檔案條目 (G11)。對應 HtmlProjectFile 的快照版本,用於還原。
 * 外部 API 回傳 HtmlProjectSnapshot (只含檔案路徑),但內部儲存含完整內容以支援還原。
 */
interface HtmlProjectSnapshotFileEntry {
  path: string;
  kind: HtmlProjectFileKind;
  content: string;
  encoding: 'utf-8' | 'base64';
  dependencies?: string[];
}

interface HtmlProjectSnapshotRecord extends HtmlProjectSnapshot {
  /** 內部欄位:完整檔案內容,用於 revertToSnapshot 還原。 */
  fileEntries?: HtmlProjectSnapshotFileEntry[];
}

export interface SearchHtmlProjectFilesInput {
  query: string;
  caseSensitive?: boolean;
  maxResults?: number;
}

export interface SearchHtmlProjectFilesResult {
  [key: string]: unknown;
  projectId: string;
  query: string;
  caseSensitive: boolean;
  scannedFiles: number;
  matches: HtmlProjectSearchMatch[];
  skippedFiles: HtmlProjectSkippedFile[];
  truncated: boolean;
}

export interface ReplaceHtmlProjectTodosInput {
  id?: string;
  title: string;
  description?: string;
  status?: HtmlProjectTodoStatus;
  order?: number;
}

export interface UpdateHtmlProjectTodoInput {
  title?: string;
  description?: string;
  status?: HtmlProjectTodoStatus;
  order?: number;
}

let dbPromise: Promise<IDBPDatabase<HtmlProjectDB>> | null = null;

const now = (): number => Date.now();
const HTML_PROJECT_PATH_GUIDANCE =
  'Use virtual project-root paths like /index.html, /src/app.js, or /data/ruby.js. Do not use host filesystem paths or URLs.';
const EXTERNAL_PROJECT_REFERENCE_PATTERN = /^([a-z][a-z\d+.-]*:|\/\/)/i;
const normalizeProjectPathSlashes = (path: string): string => path.replace(/\\/g, '/');
const isExternalProjectReference = (path: string): boolean =>
  EXTERNAL_PROJECT_REFERENCE_PATTERN.test(normalizeProjectPathSlashes(path));

export class HtmlProjectPathValidationError extends Error {
  readonly code: string;
  readonly guidance: string;
  readonly path: string;

  constructor(path: string, code: string, message: string, guidance = HTML_PROJECT_PATH_GUIDANCE) {
    super(message);
    this.name = 'HtmlProjectPathValidationError';
    this.code = code;
    this.guidance = guidance;
    this.path = path;
  }
}

export const normalizePath = (path: string): string => {
  if (
    Array.from(path).some(character => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    })
  ) {
    throw new HtmlProjectPathValidationError(
      path,
      'invalid-control-characters',
      `Project file path contains invalid control characters: ${path}`,
    );
  }

  const trimmedPath = path.trim();
  if (!trimmedPath) {
    throw new HtmlProjectPathValidationError(
      path,
      'missing-path',
      'Project file path is required.',
    );
  }

  const slashNormalizedPath = normalizeProjectPathSlashes(trimmedPath);
  if (isExternalProjectReference(slashNormalizedPath)) {
    throw new HtmlProjectPathValidationError(
      path,
      'path-outside-project-root',
      `Project file path must stay inside the virtual project root: ${path}`,
    );
  }

  const normalizedPath = (
    slashNormalizedPath.startsWith('/') ? slashNormalizedPath : `/${slashNormalizedPath}`
  ).replace(/\/+/g, '/');
  const resolvedSegments: string[] = [];

  for (const segment of normalizedPath.split('/')) {
    if (!segment || segment === '.') {
      continue;
    }
    if (segment === '..') {
      throw new HtmlProjectPathValidationError(
        path,
        'path-parent-traversal',
        `Project file path must not use parent-directory traversal: ${path}`,
      );
    }
    // D6 reserved-path 防護:任一路徑 segment 等於 .git 或 .educare 即拒絕
    // (擋 /assets/.git/config 等繞法;覆蓋 agent 工具 / UI / ZIP 匯入所有入口)。
    if (segment === '.git' || segment === '.educare') {
      throw new HtmlProjectPathValidationError(
        path,
        'reserved-path',
        `Project file path must not target reserved directory (.git or .educare): ${path}`,
      );
    }
    resolvedSegments.push(segment);
  }

  if (resolvedSegments.length === 0) {
    throw new HtmlProjectPathValidationError(
      path,
      'path-resolved-to-root',
      `Project file path must include a file inside the virtual project root: ${path}`,
    );
  }

  return `/${resolvedSegments.join('/')}`;
};

const inferDependencies = (kind: HtmlProjectFileKind, content: string): string[] => {
  const dependencies = new Set<string>();
  const add = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      return;
    }

    if (isExternalProjectReference(trimmed)) {
      return;
    }
    dependencies.add(normalizePath(trimmed));
  };

  if (kind === 'html') {
    const htmlRefPattern = /(?:href|src)=['"]([^'"]+)['"]/g;
    for (const match of content.matchAll(htmlRefPattern)) {
      add(match[1]);
    }
  }

  if (kind === 'css') {
    const cssRefPattern = /url\(['"]?([^'")]+)['"]?\)|@import\s+['"]([^'"]+)['"]/g;
    for (const match of content.matchAll(cssRefPattern)) {
      add(match[1] || match[2]);
    }
  }

  if (kind === 'js') {
    const jsRefPattern = /import\s+(?:[^'";]+\s+from\s+)?['"]([^'"]+)['"]/g;
    for (const match of content.matchAll(jsRefPattern)) {
      add(match[1]);
    }
  }

  return Array.from(dependencies);
};

const getDb = () => {
  if (!dbPromise) {
    dbPromise = openDB<HtmlProjectDB>(HTML_PROJECT_DB_NAME, HTML_PROJECT_DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(PROJECTS_STORE)) {
          const projectStore = db.createObjectStore(PROJECTS_STORE, { keyPath: 'id' });
          projectStore.createIndex('by-assistant', 'assistantId');
          projectStore.createIndex('by-session', 'sessionId');
          projectStore.createIndex('by-updated-at', 'updatedAt');
        }

        if (!db.objectStoreNames.contains(PROJECT_FILES_STORE)) {
          const fileStore = db.createObjectStore(PROJECT_FILES_STORE, {
            keyPath: ['projectId', 'path'],
          });
          fileStore.createIndex('by-project', 'projectId');
          fileStore.createIndex('by-project-updated-at', ['projectId', 'updatedAt']);
        }

        if (!db.objectStoreNames.contains(PROJECT_SNAPSHOTS_STORE)) {
          const snapshotStore = db.createObjectStore(PROJECT_SNAPSHOTS_STORE, {
            keyPath: ['projectId', 'version'],
          });
          snapshotStore.createIndex('by-project', 'projectId');
        }

        if (!db.objectStoreNames.contains(PROJECT_TODOS_STORE)) {
          const todoStore = db.createObjectStore(PROJECT_TODOS_STORE, {
            keyPath: ['projectId', 'id'],
          });
          todoStore.createIndex('by-project', 'projectId');
          todoStore.createIndex('by-project-order', ['projectId', 'order']);
        }
      },
    });
  }

  return dbPromise;
};

const requireProject = async (
  db: IDBPDatabase<HtmlProjectDB>,
  projectId: string,
): Promise<HtmlProject> => {
  const project = await db.get(PROJECTS_STORE, projectId);
  if (!project) {
    throw new Error(`HTML project ${projectId} not found.`);
  }
  return project;
};

const updateProjectRecord = async (
  db: IDBPDatabase<HtmlProjectDB>,
  project: HtmlProject,
): Promise<HtmlProject> => {
  await db.put(PROJECTS_STORE, project);
  return project;
};

const normalizeTodoStatus = (status?: HtmlProjectTodoStatus): HtmlProjectTodoStatus => {
  return status ?? 'pending';
};

const buildTodoSummary = (projectId: string, todos: HtmlProjectTodo[]): HtmlProjectTodoSummary => {
  const summary = todos.reduce(
    (accumulator, todo) => {
      if (todo.status === 'completed') {
        accumulator.completed += 1;
      } else if (todo.status === 'in_progress') {
        accumulator.inProgress += 1;
      } else {
        accumulator.pending += 1;
      }
      return accumulator;
    },
    {
      projectId,
      total: todos.length,
      pending: 0,
      inProgress: 0,
      completed: 0,
      allComplete: false,
    },
  );

  summary.allComplete = summary.total > 0 && summary.completed === summary.total;
  return summary;
};

/** meta.json 內的保留路徑 (.git / .educare) — 對外不可見 (D6)。 */
const isReservedMetaPath = (path: string): boolean =>
  path
    .split('/')
    .filter(Boolean)
    .some(segment => segment === '.git' || segment === '.educare');

/** 由 meta entry 建構 descriptor (避免逐檔讀 FS)。 */
const buildDescriptorFromMeta = (
  path: string,
  entry: HtmlProjectFileMeta,
): HtmlProjectFileDescriptor => ({
  path,
  kind: entry.kind,
  size: entry.size,
  updatedAt: entry.updatedAt,
  dependencies: entry.dependencies,
});

const buildSearchSnippet = (content: string, matchIndex: number, queryLength: number): string => {
  const start = Math.max(0, matchIndex - SEARCH_SNIPPET_RADIUS);
  const end = Math.min(content.length, matchIndex + queryLength + SEARCH_SNIPPET_RADIUS);
  return content.slice(start, end).replace(/\s+/g, ' ').trim();
};

const getLineAndColumn = (
  content: string,
  matchIndex: number,
): { line: number; column: number } => {
  const previousContent = content.slice(0, matchIndex);
  const line = previousContent.split('\n').length;
  const lastNewlineIndex = previousContent.lastIndexOf('\n');
  const column = matchIndex - lastNewlineIndex;
  return { line, column };
};

class HtmlProjectStore {
  async createProject(input: CreateHtmlProjectInput): Promise<HtmlProject> {
    const db = await getDb();
    const timestamp = now();
    const project: HtmlProject = {
      id: `project-${timestamp}`,
      assistantId: input.assistantId,
      sessionId: input.sessionId ?? null,
      name: input.name,
      description: input.description,
      entryFile: normalizePath(input.entryFile || '/index.html'),
      status: 'draft',
      previewVersion: 0,
      assetPaths: [],
      createdAt: timestamp,
      updatedAt: timestamp,
      lastPrompt: input.lastPrompt,
      lastBuildError: null,
      tags: input.tags,
    };

    await db.put(PROJECTS_STORE, project);

    // D1: 專案目錄 + git repo 就地 init (檔案內容存 LightningFS /projects/<id>/)。
    // initial commit 由首次寫入後或 run-start/createSnapshot 觸發 (D4)。
    await gitService.ensureRepo(project.id).catch(error => {
      // best-effort:repo 初始化失敗不阻斷專案建立 (後續寫入會重試 ensureContext)。
      console.warn(`[htmlProjectStore] ensureRepo failed for ${project.id}:`, error);
    });
    return project;
  }

  async getProject(projectId: string): Promise<HtmlProject | undefined> {
    const db = await getDb();
    return db.get(PROJECTS_STORE, projectId);
  }

  async assertProjectOwnership(projectId: string, assistantId: string): Promise<HtmlProject> {
    const db = await getDb();
    const project = await db.get(PROJECTS_STORE, projectId);

    if (!project || project.assistantId !== assistantId) {
      throw new Error(`HTML project ${projectId} not found.`);
    }

    return project;
  }

  async renameProject(projectId: string, assistantId: string, name: string): Promise<HtmlProject> {
    const db = await getDb();
    const project = await this.assertProjectOwnership(projectId, assistantId);
    const trimmedName = name.trim();

    if (!trimmedName) {
      throw new Error('Project name is required.');
    }

    const nextProject: HtmlProject = {
      ...project,
      name: trimmedName,
      updatedAt: now(),
    };

    await updateProjectRecord(db, nextProject);
    return nextProject;
  }

  async listProjectsByAssistant(assistantId: string): Promise<HtmlProject[]> {
    const db = await getDb();
    const projects = await db.getAllFromIndex(PROJECTS_STORE, 'by-assistant', assistantId);
    return projects.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async listFiles(projectId: string): Promise<HtmlProjectFileDescriptor[]> {
    await this.ensureMigrated(projectId);
    const meta = await gitService.readMeta(projectId);
    return Object.entries(meta)
      .filter(([path]) => !isReservedMetaPath(path))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, entry]) => buildDescriptorFromMeta(path, entry));
  }

  async listProjectFiles(projectId: string): Promise<HtmlProjectFile[]> {
    await this.ensureMigrated(projectId);
    const meta = await gitService.readMeta(projectId);
    const entries = Object.entries(meta).filter(([path]) => !isReservedMetaPath(path));
    const files: HtmlProjectFile[] = [];
    for (const [path, entry] of entries.sort(([a], [b]) => a.localeCompare(b))) {
      const bytes = await gitService.readProjectFile(projectId, path);
      if (!bytes) {
        continue; // meta 有記錄但 FS 缺檔 (不一致),略過
      }
      files.push({
        projectId,
        path,
        kind: entry.kind,
        content: decodeContent(bytes, entry.encoding),
        encoding: entry.encoding,
        dependencies: entry.dependencies,
        size: entry.size,
        updatedAt: entry.updatedAt,
      });
    }
    return files;
  }

  async readFile(projectId: string, path: string): Promise<HtmlProjectFile | undefined> {
    const normalizedPath = normalizePath(path);
    await this.ensureMigrated(projectId);
    const meta = await gitService.readMeta(projectId);
    const entry = meta[normalizedPath];
    if (!entry) {
      return undefined;
    }
    const bytes = await gitService.readProjectFile(projectId, normalizedPath);
    if (!bytes) {
      return undefined;
    }
    return {
      projectId,
      path: normalizedPath,
      kind: entry.kind,
      content: decodeContent(bytes, entry.encoding),
      encoding: entry.encoding,
      dependencies: entry.dependencies,
      size: entry.size,
      updatedAt: entry.updatedAt,
    };
  }

  async writeFile(
    projectId: string,
    file: WriteHtmlProjectFileInput,
  ): Promise<WriteHtmlProjectFilesResult> {
    return this.writeFiles(projectId, [file]);
  }

  async writeFiles(
    projectId: string,
    files: WriteHtmlProjectFileInput[],
  ): Promise<WriteHtmlProjectFilesResult> {
    if (!Array.isArray(files) || files.length === 0) {
      throw new Error('writeFiles requires a non-empty files array.');
    }

    const db = await getDb();
    const project = await requireProject(db, projectId);
    await this.ensureMigrated(projectId);
    const timestamp = now();
    const updatedPaths: string[] = [];
    const assetPaths = new Set(project.assetPaths);
    const meta = await gitService.readMeta(projectId);

    for (const file of files) {
      const normalizedPath = normalizePath(file.path); // 含 reserved-path 防護 (D6)
      const encoding = file.encoding || 'utf-8';
      const bytes = encodeContent(file.content, encoding); // D2: string → bytes

      await gitService.writeProjectFile(projectId, normalizedPath, bytes);
      meta[normalizedPath] = {
        kind: file.kind,
        encoding,
        dependencies: inferDependencies(file.kind, file.content),
        size: bytes.length, // D2: 位元組數
        updatedAt: timestamp,
      };
      updatedPaths.push(normalizedPath);

      if (file.kind === 'asset') {
        assetPaths.add(normalizedPath);
      } else {
        assetPaths.delete(normalizedPath);
      }
    }

    await gitService.writeMeta(projectId, meta);

    const nextProject: HtmlProject = {
      ...project,
      assetPaths: Array.from(assetPaths).sort(),
      updatedAt: timestamp,
      previewVersion: project.previewVersion + 1,
      status: 'draft',
      lastBuildError: null,
    };

    await updateProjectRecord(db, nextProject);

    return {
      updated: updatedPaths,
      previewVersion: nextProject.previewVersion,
    };
  }

  async copyFile(
    projectId: string,
    sourcePath: string,
    destinationPath: string,
  ): Promise<{ sourcePath: string; destinationPath: string; previewVersion: number }> {
    const db = await getDb();
    const project = await requireProject(db, projectId);
    await this.ensureMigrated(projectId);
    const normalizedSourcePath = normalizePath(sourcePath);
    const normalizedDestinationPath = normalizePath(destinationPath);

    if (normalizedSourcePath === normalizedDestinationPath) {
      throw new Error('Source and destination paths must be different.');
    }

    const meta = await gitService.readMeta(projectId);
    const sourceMeta = meta[normalizedSourcePath];
    if (!sourceMeta) {
      throw new Error(`Project file ${normalizedSourcePath} not found.`);
    }
    if (meta[normalizedDestinationPath]) {
      throw new Error(`Project file ${normalizedDestinationPath} already exists.`);
    }

    const sourceBytes = await gitService.readProjectFile(projectId, normalizedSourcePath);
    if (!sourceBytes) {
      throw new Error(`Project file ${normalizedSourcePath} not found.`);
    }

    const timestamp = now();
    await gitService.writeProjectFile(projectId, normalizedDestinationPath, sourceBytes);
    meta[normalizedDestinationPath] = {
      ...sourceMeta,
      updatedAt: timestamp,
    };
    await gitService.writeMeta(projectId, meta);

    const assetPaths = new Set(project.assetPaths);
    if (sourceMeta.kind === 'asset') {
      assetPaths.add(normalizedDestinationPath);
    }

    const nextProject: HtmlProject = {
      ...project,
      assetPaths: Array.from(assetPaths).sort(),
      updatedAt: timestamp,
      previewVersion: project.previewVersion + 1,
      status: 'draft',
      lastBuildError: null,
    };

    await updateProjectRecord(db, nextProject);

    return {
      sourcePath: normalizedSourcePath,
      destinationPath: normalizedDestinationPath,
      previewVersion: nextProject.previewVersion,
    };
  }

  async renameFile(
    projectId: string,
    sourcePath: string,
    destinationPath: string,
  ): Promise<{ sourcePath: string; destinationPath: string; previewVersion: number }> {
    const db = await getDb();
    const project = await requireProject(db, projectId);
    await this.ensureMigrated(projectId);
    const normalizedSourcePath = normalizePath(sourcePath);
    const normalizedDestinationPath = normalizePath(destinationPath);

    if (normalizedSourcePath === normalizedDestinationPath) {
      throw new Error('Source and destination paths must be different.');
    }

    const meta = await gitService.readMeta(projectId);
    const sourceMeta = meta[normalizedSourcePath];
    if (!sourceMeta) {
      throw new Error(`Project file ${normalizedSourcePath} not found.`);
    }
    if (meta[normalizedDestinationPath]) {
      throw new Error(`Project file ${normalizedDestinationPath} already exists.`);
    }

    const timestamp = now();
    await gitService.renameProjectFile(projectId, normalizedSourcePath, normalizedDestinationPath);
    meta[normalizedDestinationPath] = { ...sourceMeta, updatedAt: timestamp };
    delete meta[normalizedSourcePath];
    await gitService.writeMeta(projectId, meta);

    const assetPaths = new Set(project.assetPaths);
    if (sourceMeta.kind === 'asset') {
      assetPaths.delete(normalizedSourcePath);
      assetPaths.add(normalizedDestinationPath);
    }

    const nextProject: HtmlProject = {
      ...project,
      entryFile:
        project.entryFile === normalizedSourcePath ? normalizedDestinationPath : project.entryFile,
      assetPaths: Array.from(assetPaths).sort(),
      updatedAt: timestamp,
      previewVersion: project.previewVersion + 1,
      status: 'draft',
      lastBuildError: null,
    };

    await updateProjectRecord(db, nextProject);

    return {
      sourcePath: normalizedSourcePath,
      destinationPath: normalizedDestinationPath,
      previewVersion: nextProject.previewVersion,
    };
  }

  async searchFiles(
    projectId: string,
    input: SearchHtmlProjectFilesInput,
  ): Promise<SearchHtmlProjectFilesResult> {
    const query = input.query.trim();
    if (!query) {
      throw new Error('searchFiles query is required.');
    }

    const db = await getDb();
    await requireProject(db, projectId);
    await this.ensureMigrated(projectId);

    const meta = await gitService.readMeta(projectId);
    const entries = Object.entries(meta)
      .filter(([path]) => !isReservedMetaPath(path))
      .sort(([a], [b]) => a.localeCompare(b));

    const normalizedQuery = input.caseSensitive ? query : query.toLowerCase();
    const maxResults = Math.max(1, input.maxResults ?? DEFAULT_SEARCH_RESULT_LIMIT);
    const matches: HtmlProjectSearchMatch[] = [];
    const skippedFiles: HtmlProjectSkippedFile[] = [];
    let truncated = false;
    let scannedFiles = 0;

    for (const [path, entry] of entries) {
      if (!SEARCHABLE_FILE_KINDS.has(entry.kind)) {
        skippedFiles.push({ path, reason: 'unsupported-kind' });
        continue;
      }

      if (entry.encoding === 'base64') {
        skippedFiles.push({ path, reason: 'binary-encoding' });
        continue;
      }

      if (entry.size > MAX_SEARCHABLE_FILE_SIZE) {
        skippedFiles.push({ path, reason: 'file-too-large' });
        continue;
      }

      const bytes = await gitService.readProjectFile(projectId, path);
      if (!bytes) {
        continue;
      }
      const content = decodeContent(bytes, entry.encoding);

      scannedFiles += 1;
      const haystack = input.caseSensitive ? content : content.toLowerCase();
      let searchIndex = 0;
      let fileMatchCount = 0;

      while (searchIndex <= haystack.length - normalizedQuery.length) {
        const matchIndex = haystack.indexOf(normalizedQuery, searchIndex);
        if (matchIndex === -1) {
          break;
        }

        fileMatchCount += 1;

        if (fileMatchCount <= MAX_SEARCH_RESULTS_PER_FILE && matches.length < maxResults) {
          const { line, column } = getLineAndColumn(content, matchIndex);
          matches.push({
            path,
            kind: entry.kind,
            line,
            column,
            snippet: buildSearchSnippet(content, matchIndex, query.length),
            matchCount: fileMatchCount,
          });
        }

        if (matches.length >= maxResults) {
          truncated = true;
          break;
        }

        searchIndex = matchIndex + normalizedQuery.length;
      }

      if (truncated) {
        break;
      }
    }

    return {
      projectId,
      query,
      caseSensitive: Boolean(input.caseSensitive),
      scannedFiles,
      matches,
      skippedFiles,
      truncated,
    };
  }

  async deleteFile(
    projectId: string,
    path: string,
  ): Promise<{ deleted: boolean; previewVersion: number }> {
    const db = await getDb();
    const project = await requireProject(db, projectId);
    await this.ensureMigrated(projectId);
    const normalizedPath = normalizePath(path);
    const meta = await gitService.readMeta(projectId);
    const existingMeta = meta[normalizedPath];

    if (!existingMeta) {
      return {
        deleted: false,
        previewVersion: project.previewVersion,
      };
    }

    await gitService.deleteProjectFile(projectId, normalizedPath);
    delete meta[normalizedPath];
    await gitService.writeMeta(projectId, meta);

    const nextProject: HtmlProject = {
      ...project,
      assetPaths: project.assetPaths.filter(assetPath => assetPath !== normalizedPath),
      updatedAt: now(),
      previewVersion: project.previewVersion + 1,
      status: normalizedPath === project.entryFile ? 'error' : 'draft',
      lastBuildError:
        normalizedPath === project.entryFile
          ? 'Entrypoint file was deleted.'
          : project.lastBuildError,
    };

    await updateProjectRecord(db, nextProject);

    return {
      deleted: true,
      previewVersion: nextProject.previewVersion,
    };
  }

  async setEntrypoint(projectId: string, path: string): Promise<HtmlProject> {
    const db = await getDb();
    const project = await requireProject(db, projectId);
    const normalizedPath = normalizePath(path);

    const nextProject: HtmlProject = {
      ...project,
      entryFile: normalizedPath,
      updatedAt: now(),
      previewVersion: project.previewVersion + 1,
      status: 'draft',
      lastBuildError: null,
    };

    await updateProjectRecord(db, nextProject);
    return nextProject;
  }

  /**
   * D3:createSnapshot = git commit (附 Preview-Version + Educare-Snapshot:true trailer)。
   * 回傳型別 HtmlProjectSnapshot 不變;version = 當下 previewVersion。
   * isSnapshot:true 隱含 allowEmpty (快照一律記錄當前狀態)。
   */
  /**
   * D4 run-start 快照 (含去重)。工作樹乾淨「且」已存在同 previewVersion 的 snapshot
   * commit 時跳過 (回傳 null),避免每次 run 疊一筆空 run-start commit 造成歷史膨脹。
   * 其餘情況 (工作樹有變更,或尚無此 version 的 snapshot) 照常建立 snapshot。
   * 供 agentRunController run-start 呼叫;回傳 null 時呼叫端不應更新 snapshotVersion。
   */
  async createRunStartSnapshot(
    projectId: string,
    note: string,
  ): Promise<HtmlProjectSnapshot | null> {
    const db = await getDb();
    await this.ensureMigrated(projectId);
    const project = await requireProject(db, projectId);
    const treeStatus = await gitService.status(projectId);
    if (treeStatus.clean) {
      const existing = await this.listSnapshots(projectId);
      if (existing.snapshots.some(snap => snap.version === project.previewVersion)) {
        return null; // D4 去重:clean + 同 version snapshot 已存在 → 跳過
      }
    }
    return this.createSnapshot(projectId, note);
  }

  async createSnapshot(projectId: string, note?: string): Promise<HtmlProjectSnapshot> {
    const db = await getDb();
    await this.ensureMigrated(projectId);
    const project = await requireProject(db, projectId);
    const timestamp = now();
    await gitService.commitAll(projectId, note?.trim() || 'Snapshot', {
      previewVersion: project.previewVersion,
      isSnapshot: true,
      timestamp,
    });
    const [latest] = await gitService.log(projectId, { depth: 1 });
    return {
      projectId,
      version: project.previewVersion,
      files: latest?.files ?? [],
      createdAt: timestamp,
      note,
      oid: latest?.shortOid,
    };
  }

  /**
   * D3:listSnapshots = git log 過濾 Educare-Snapshot:true commits。
   * 以 trailer 還原 version,同 version 取最新 (commits 已新到舊),上限 20,每筆含 oid。
   * initial/run-end/ZIP/revert/gitCommit commit (無 snapshot trailer) 不會漏入。
   */
  async listSnapshots(projectId: string): Promise<HtmlProjectListSnapshotsResult> {
    const db = await getDb();
    await requireProject(db, projectId);
    await this.ensureMigrated(projectId);
    const commits = await gitService.log(projectId);
    const byVersion = new Map<number, gitService.GitCommitSummary>();
    for (const commit of commits) {
      if (!commit.isSnapshot || commit.previewVersion === undefined) {
        continue;
      }
      if (!byVersion.has(commit.previewVersion)) {
        byVersion.set(commit.previewVersion, commit); // 新到舊,首筆為最新
      }
    }
    const snapshots: HtmlProjectSnapshot[] = Array.from(byVersion.values())
      .sort((a, b) => (b.previewVersion ?? 0) - (a.previewVersion ?? 0))
      .slice(0, SNAPSHOT_RETENTION_LIMIT)
      .map(commit => ({
        projectId,
        version: commit.previewVersion as number,
        files: commit.files,
        createdAt: commit.timestamp,
        note: commit.note,
        oid: commit.shortOid,
      }));
    return {
      projectId,
      snapshots,
      retainedLimit: SNAPSHOT_RETENTION_LIMIT,
    };
  }

  /**
   * D3:revertToSnapshot = 以 trailer 解析目標 commit → restoreCommitTree 寫回工作樹
   * → 新建 revert commit (不帶 snapshot trailer,線性歷史) → previewVersion +1。
   * runtime 診斷清理由呼叫端 (T4 工具) 透過 previewRuntimeDiagnostics.clear() 處理。
   */
  async revertToSnapshot(
    projectId: string,
    version: number,
  ): Promise<HtmlProjectRevertToSnapshotResult> {
    const db = await getDb();
    await this.ensureMigrated(projectId);
    const project = await requireProject(db, projectId);
    const oid = await gitService.resolveVersion(projectId, version);
    if (!oid) {
      throw new Error(`Project snapshot version ${version} not found.`);
    }

    const { filesRestored } = await gitService.restoreCommitTree(projectId, oid);
    const nextPreviewVersion = project.previewVersion + 1;
    await gitService.commitAll(projectId, `Revert to version ${version}`, {
      previewVersion: nextPreviewVersion,
      allowEmpty: true,
    });

    // 從還原後的 meta 重建 assetPaths (restoreCommitTree 已還原 .educare/meta.json)
    const meta = await gitService.readMeta(projectId);
    const assetPaths = Object.entries(meta)
      .filter(([path, entry]) => !isReservedMetaPath(path) && entry.kind === 'asset')
      .map(([path]) => path)
      .sort();

    const nextProject: HtmlProject = {
      ...project,
      assetPaths,
      updatedAt: now(),
      previewVersion: nextPreviewVersion,
      status: 'draft',
      lastBuildError: null,
    };

    await updateProjectRecord(db, nextProject);

    return {
      projectId,
      revertedToVersion: version,
      previewVersion: nextProject.previewVersion,
      runtimeDiagnosticsCleared: true,
      filesRestored,
    };
  }

  // --- Phase 3/4 git 版本歷史 (供 AgentRunPanel UI) ---

  /**
   * 取得完整 commit 歷史 (新到舊,不設 20 筆上限)。
   * 供版本歷史面板顯示 (區別 listSnapshots 只回 snapshot commits 且上限 20)。
   */
  async getHistory(projectId: string): Promise<HtmlProjectGitLogCommit[]> {
    const db = await getDb();
    await requireProject(db, projectId);
    await this.ensureMigrated(projectId);
    return (await gitService.log(projectId)) as HtmlProjectGitLogCommit[];
  }

  /** 工作樹狀態 (dirty 偵測,供「提交變更」按鈕亮起)。 */
  async getWorkingTreeStatus(projectId: string): Promise<HtmlProjectGitStatusResult> {
    const db = await getDb();
    await requireProject(db, projectId);
    await this.ensureMigrated(projectId);
    const result = await gitService.status(projectId);
    return { projectId, ...result };
  }

  /**
   * 提交目前工作樹的未提交變更 (供 UI「提交變更」按鈕)。
   * 成功後 previewVersion +1 (維持單調遞增)。無變更時 committed=false。
   */
  async commitChanges(projectId: string, message: string): Promise<HtmlProjectGitCommitResult> {
    const db = await getDb();
    await this.ensureMigrated(projectId);
    const project = await requireProject(db, projectId);
    const trimmed = (message ?? '').trim();
    if (!trimmed) {
      throw new Error('Commit message is required.');
    }
    const oid = await gitService.commitAll(projectId, trimmed, {
      previewVersion: project.previewVersion,
    });
    if (oid) {
      const nextProject: HtmlProject = {
        ...project,
        updatedAt: now(),
        previewVersion: project.previewVersion + 1,
      };
      await updateProjectRecord(db, nextProject);
    }
    return { projectId, committed: oid !== null, oid, message: trimmed };
  }

  /**
   * 一次性懶遷移 (D1/F1/F5/F6/F7):把 idb 的舊 file/snapshot 記錄 replay 成 git commits。
   * - 完成訊號 = idb 無 file 且無 snapshot 記錄 (非「FS 有 .git」)。
   * - 觸發條件 = idb 有 file 或 snapshot 記錄 (只看 file 會漏 snapshot-only legacy)。
   * - replay 冪等 (先清 /projects/<id>);驗證後才刪 idb;Web Locks 跨分頁互斥 + 取鎖後重查。
   * 所有觸碰檔案/快照的 store 入口皆先行呼叫 (含 listSnapshots — AgentRunPanel 掛載即呼叫)。
   */
  private migrationPromises = new Map<string, Promise<void>>();

  async ensureMigrated(projectId: string): Promise<void> {
    const existing = this.migrationPromises.get(projectId);
    if (existing) {
      return existing;
    }
    const promise = this.runMigrationLocked(projectId).finally(() => {
      this.migrationPromises.delete(projectId);
    });
    this.migrationPromises.set(projectId, promise);
    return promise;
  }

  private async runMigrationLocked(projectId: string): Promise<void> {
    const hasWebLocks =
      typeof navigator !== 'undefined' && typeof navigator.locks?.request === 'function';
    if (!hasWebLocks) {
      // jsdom/無 Web Locks fallback:in-context dedup (migrationPromises) 已足夠 (單 context)。
      return this.doMigrate(projectId);
    }
    return new Promise<void>((resolve, reject) => {
      navigator.locks.request(`educare-migrate-${projectId}`, async () => {
        try {
          await this.doMigrate(projectId); // 取鎖後重查完成訊號 (doMigrate 開頭即查)
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  private async doMigrate(projectId: string): Promise<void> {
    const db = await getDb();
    const legacyFiles = await db.getAllFromIndex(PROJECT_FILES_STORE, 'by-project', projectId);
    const legacySnapshots = (await db.getAllFromIndex(
      PROJECT_SNAPSHOTS_STORE,
      'by-project',
      projectId,
    )) as HtmlProjectSnapshotRecord[];

    // 完成訊號/觸發條件
    if (legacyFiles.length === 0 && legacySnapshots.length === 0) {
      return;
    }

    // replay 冪等:先清空 /projects/<id> 再重建 (中斷重試不會產生重複/交錯 commits)
    await gitService.deleteProjectDir(projectId).catch(error => {
      console.warn(`[htmlProjectStore] migrate: clear dir failed for ${projectId}:`, error);
    });
    await gitService.ensureRepo(projectId);

    // 依 createdAt 升序 replay 舊 snapshots (fileEntries undefined → 空 tree commit)
    const sortedSnapshots = [...legacySnapshots].sort((a, b) => a.createdAt - b.createdAt);
    for (const snapshot of sortedSnapshots) {
      const entries = snapshot.fileEntries ?? [];
      const meta: HtmlProjectFileMetaMap = {};
      for (const entry of entries) {
        const bytes = encodeContent(entry.content, entry.encoding);
        await gitService.writeProjectFile(projectId, entry.path, bytes);
        meta[entry.path] = {
          kind: entry.kind,
          encoding: entry.encoding,
          dependencies: entry.dependencies,
          size: bytes.length,
          updatedAt: snapshot.createdAt,
        };
      }
      await gitService.writeMeta(projectId, meta);
      await gitService.commitAll(projectId, snapshot.note?.trim() || 'Snapshot', {
        previewVersion: snapshot.version,
        isSnapshot: true,
        allowEmpty: true,
        timestamp: snapshot.createdAt,
      });
    }

    // 寫入當前檔案 (legacyFiles = 最新狀態) + migration commit
    const currentMeta: HtmlProjectFileMetaMap = {};
    for (const file of legacyFiles) {
      const encoding = file.encoding || 'utf-8';
      const bytes = encodeContent(file.content, encoding);
      await gitService.writeProjectFile(projectId, file.path, bytes);
      currentMeta[file.path] = {
        kind: file.kind,
        encoding,
        dependencies: file.dependencies,
        size: bytes.length,
        updatedAt: file.updatedAt,
      };
    }
    await gitService.writeMeta(projectId, currentMeta);
    await gitService.commitAll(projectId, 'Migrated to git storage', { allowEmpty: true });

    // 驗證 (F1):replay 應產出 ≥ (N snapshot + 1 migration) 個 commit,且 snapshot commit
    // 數量相符。若 replay 中途部分失敗仍可能通過單純「log 非空」檢查,導致刪 idb 後資料
    // 永久遺失 — 故嚴格校驗數量 + 抽樣比對當前檔案內容,失敗則保留 idb 供下次重試。
    const expectedMinCommits = sortedSnapshots.length + 1; // N snapshot + 1 migration
    const verifyLog = await gitService.log(projectId);
    const verifySnapshotCommits = verifyLog.filter(commit => commit.isSnapshot);
    if (
      verifyLog.length < expectedMinCommits ||
      verifySnapshotCommits.length < sortedSnapshots.length
    ) {
      throw new Error(
        `Migration verification failed for ${projectId}: expected >= ${expectedMinCommits} commits (${sortedSnapshots.length} snapshots + migration), got ${verifyLog.length} commits / ${verifySnapshotCommits.length} snapshots.`,
      );
    }
    if (legacyFiles.length > 0) {
      const sample = legacyFiles[0];
      const sampleBytes = await gitService.readProjectFile(projectId, sample.path);
      const expectedBytes = encodeContent(sample.content, sample.encoding || 'utf-8');
      if (!sampleBytes || sampleBytes.length !== expectedBytes.length) {
        throw new Error(
          `Migration verification failed for ${projectId}: current file ${sample.path} content mismatch.`,
        );
      }
    }

    // 驗證後才刪 idb legacy 記錄 (失敗則保留 idb,下次重試)
    for (const file of legacyFiles) {
      await db.delete(PROJECT_FILES_STORE, [projectId, file.path]);
    }
    for (const snapshot of legacySnapshots) {
      await db.delete(PROJECT_SNAPSHOTS_STORE, [projectId, snapshot.version]);
    }
  }

  async listTodos(projectId: string): Promise<HtmlProjectTodo[]> {
    const db = await getDb();
    await requireProject(db, projectId);
    const todos = await db.getAllFromIndex(PROJECT_TODOS_STORE, 'by-project', projectId);
    return todos.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
  }

  async getTodoSummary(projectId: string): Promise<HtmlProjectTodoSummary> {
    return buildTodoSummary(projectId, await this.listTodos(projectId));
  }

  async replaceTodos(
    projectId: string,
    items: ReplaceHtmlProjectTodosInput[],
  ): Promise<{ todos: HtmlProjectTodo[]; summary: HtmlProjectTodoSummary }> {
    const db = await getDb();
    await requireProject(db, projectId);
    const existingTodos = await db.getAllFromIndex(PROJECT_TODOS_STORE, 'by-project', projectId);
    for (const todo of existingTodos) {
      await db.delete(PROJECT_TODOS_STORE, [projectId, todo.id]);
    }

    const timestamp = now();
    const todos: HtmlProjectTodo[] = [];
    for (const [index, item] of items.entries()) {
      const todo: HtmlProjectTodo = {
        projectId,
        id: item.id?.trim() || `todo-${timestamp}-${index}`,
        title: item.title,
        description: item.description,
        status: normalizeTodoStatus(item.status),
        order: item.order ?? index,
        createdAt: timestamp,
        updatedAt: timestamp,
        completedAt: normalizeTodoStatus(item.status) === 'completed' ? timestamp : null,
      };
      await db.put(PROJECT_TODOS_STORE, todo);
      todos.push(todo);
    }

    const normalizedTodos = todos.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
    return {
      todos: normalizedTodos,
      summary: buildTodoSummary(projectId, normalizedTodos),
    };
  }

  async updateTodo(
    projectId: string,
    todoId: string,
    patch: UpdateHtmlProjectTodoInput,
  ): Promise<{ todo: HtmlProjectTodo; summary: HtmlProjectTodoSummary }> {
    const db = await getDb();
    await requireProject(db, projectId);
    const todo = await db.get(PROJECT_TODOS_STORE, [projectId, todoId]);
    if (!todo) {
      throw new Error(`Project todo ${todoId} not found.`);
    }

    const timestamp = now();
    const nextStatus = patch.status ?? todo.status;
    const nextTodo: HtmlProjectTodo = {
      ...todo,
      title: typeof patch.title === 'undefined' ? todo.title : patch.title,
      description: typeof patch.description === 'undefined' ? todo.description : patch.description,
      status: nextStatus,
      order: typeof patch.order === 'undefined' ? todo.order : patch.order,
      updatedAt: timestamp,
      completedAt:
        nextStatus === 'completed'
          ? todo.status === 'completed' && todo.completedAt
            ? todo.completedAt
            : timestamp
          : null,
    };

    await db.put(PROJECT_TODOS_STORE, nextTodo);
    return {
      todo: nextTodo,
      summary: await this.getTodoSummary(projectId),
    };
  }

  async deleteTodo(
    projectId: string,
    todoId: string,
  ): Promise<{ deleted: string; summary: HtmlProjectTodoSummary }> {
    const db = await getDb();
    await requireProject(db, projectId);
    const todo = await db.get(PROJECT_TODOS_STORE, [projectId, todoId]);
    if (!todo) {
      throw new Error(`Project todo ${todoId} not found.`);
    }

    await db.delete(PROJECT_TODOS_STORE, [projectId, todoId]);
    return {
      deleted: todoId,
      summary: await this.getTodoSummary(projectId),
    };
  }

  private async deleteProjectRecords(projectId: string): Promise<void> {
    const db = await getDb();
    const files = await db.getAllFromIndex(PROJECT_FILES_STORE, 'by-project', projectId);
    for (const file of files) {
      await db.delete(PROJECT_FILES_STORE, [projectId, file.path]);
    }

    const snapshots = await db.getAllFromIndex(PROJECT_SNAPSHOTS_STORE, 'by-project', projectId);
    for (const snapshot of snapshots) {
      await db.delete(PROJECT_SNAPSHOTS_STORE, [projectId, snapshot.version]);
    }

    const todos = await db.getAllFromIndex(PROJECT_TODOS_STORE, 'by-project', projectId);
    for (const todo of todos) {
      await db.delete(PROJECT_TODOS_STORE, [projectId, todo.id]);
    }

    await db.delete(PROJECTS_STORE, projectId);

    // D9: 遞迴刪除 LightningFS 專案目錄 (含 .git 歷史與 base64 assets)。
    // 與 deleteProject / deleteProjectsByAssistant 共用此路徑,確保刪助理時不留殘留。
    await gitService.deleteProjectDir(projectId).catch(error => {
      console.warn(`[htmlProjectStore] deleteProjectDir failed for ${projectId}:`, error);
    });
  }

  async deleteProject(projectId: string, assistantId: string): Promise<HtmlProject> {
    const project = await this.assertProjectOwnership(projectId, assistantId);
    await this.deleteProjectRecords(project.id);
    return project;
  }

  async deleteProjectsByAssistant(assistantId: string): Promise<number> {
    const projects = await this.listProjectsByAssistant(assistantId);

    for (const project of projects) {
      await this.deleteProjectRecords(project.id);
    }

    return projects.length;
  }
}

export const htmlProjectStore = new HtmlProjectStore();
