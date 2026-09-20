import fs from 'node:fs';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import git from 'isomorphic-git';
import type { AgentRunCheckpoint, Assistant, BundleRecord, ChatSession } from '../../../types';
import type { WorkspaceProjectArchiveRecord } from '../../../services/workspaceProjectArchiveProvider';
import {
  createPracticeLessonDraft,
  gradePracticeQuestion,
} from '../../../services/practiceWorkspaceService';
import { buildWorkspaceDraftArchiveEntryId } from '../../../services/workspaceDraftService';
import {
  buildWorkspaceArchive,
  type WorkspaceArchiveSource,
} from '../../../services/workspaceArchiveService';

export const ARCHIVE_SECRET_MARKER = 'E2E-EXCLUDED-PROVIDER-SECRET-20260920';
export const hashBytes = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');

async function repositoryFixture(
  projectId: string,
  assistantId: string,
  sessionId: string,
  now: number,
): Promise<WorkspaceProjectArchiveRecord> {
  const dir = await mkdtemp(path.join(tmpdir(), 'educare-archive-repository-'));
  try {
    await git.init({ fs, dir, defaultBranch: 'main' });
    await mkdir(path.join(dir, '.educare'));
    await writeFile(
      path.join(dir, '.educare/meta.json'),
      JSON.stringify({
        '/index.html': { kind: 'html', encoding: 'utf-8', size: 30, updatedAt: now },
      }),
    );
    await writeFile(path.join(dir, 'index.html'), `<main>${projectId} original</main>`);
    await git.add({ fs, dir, filepath: '.' });
    const author = {
      name: 'EduCare Fixture',
      email: 'fixture@local',
      timestamp: Math.floor(now / 1000),
      timezoneOffset: 0,
    };
    const parent = await git.commit({
      fs,
      dir,
      author,
      message: 'Initial lesson\n\nPreview-Version: 1\nEducare-Snapshot: true',
    });
    await git.branch({ fs, dir, ref: 'teacher-review' });
    await writeFile(path.join(dir, 'index.html'), `<main>${projectId} revised</main>`);
    await git.add({ fs, dir, filepath: '.' });
    const head = await git.commit({
      fs,
      dir,
      author: { ...author, timestamp: author.timestamp + 1 },
      message: 'Revise lesson\n\nPreview-Version: 2\nEducare-Snapshot: true',
    });
    const entries: Array<{ path: string; data: Uint8Array }> = [];
    const collect = async (relative = ''): Promise<void> => {
      for (const entry of await readdir(path.join(dir, relative), { withFileTypes: true })) {
        const name = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          await collect(name);
        } else {
          entries.push({ path: name, data: new Uint8Array(await readFile(path.join(dir, name))) });
        }
      }
    };
    await collect();
    entries.sort((a, b) => a.path.localeCompare(b.path));
    return {
      id: projectId,
      schemaVersion: 1,
      project: {
        id: projectId,
        assistantId,
        sessionId,
        name: `作品 ${projectId}`,
        entryFile: '/index.html',
        status: 'ready',
        previewVersion: 2,
        assetPaths: [],
        createdAt: now,
        updatedAt: now,
      },
      repository: {
        schemaVersion: 1,
        projectId,
        entries,
        currentBranch: 'main',
        headOid: head,
        byteCount: entries.reduce((sum, entry) => sum + entry.data.length, 0),
      },
      todos: [
        {
          projectId,
          id: `todo-${projectId}`,
          title: '檢查教案',
          status: 'completed',
          order: 0,
          createdAt: now,
          updatedAt: now,
        },
      ],
      snapshots: [
        {
          projectId,
          version: 1,
          createdAt: now,
          files: ['/index.html'],
          note: 'Initial lesson',
          oid: parent,
        },
        {
          projectId,
          version: 2,
          createdAt: now + 1000,
          files: ['/index.html'],
          note: 'Revise lesson',
          oid: head,
        },
      ],
      counts: { git: entries.length, snapshots: 2, todos: 1 },
    };
  } finally {
    // Only this test's mkdtemp-owned repository is removed.
    await rm(dir, { recursive: true, force: true });
  }
}

export async function createWorkspaceAcceptanceFixture() {
  const now = Date.now();
  const assistants: Assistant[] = Array.from({ length: 3 }, (_, index) => ({
    id: `fixture-assistant-${index}`,
    name: `驗收助理 ${index}`,
    description: '離線備份 fixture',
    systemPrompt: `Teach subject ${index}.`,
    starterPrompts: [],
    createdAt: now + index,
    routableAssistantIds: [`fixture-assistant-${(index + 1) % 3}`],
    ragChunks: Array.from({ length: index === 0 ? 8 : 6 }, (_, material) => ({
      fileName: `教材-${index}-${material}.txt`,
      content: `Source ${index}-${material}: bilingual 教學內容。`,
    })),
  }));
  const sessions: ChatSession[] = Array.from({ length: 100 }, (_, index) => ({
    id: `fixture-session-${index}`,
    assistantId: assistants[index % 3].id,
    title: `驗收會話 ${index}`,
    createdAt: now + index,
    updatedAt: now + index,
    tokenCount: 0,
    messages: [
      { role: 'user', content: `Original question ${index}`, timestamp: now + index },
      { role: 'model', content: `Original answer ${index}`, timestamp: now + index + 1 },
    ],
  }));
  sessions[0].messages[0].attachments = [
    {
      kind: 'image',
      name: '筆記.png',
      mimeType: 'image/png',
      data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE5kAAAAASUVORK5CYII=',
    },
  ];
  const bundles: BundleRecord[] = Array.from({ length: 2 }, (_, index) => ({
    id: `fixture-bundle-${index}`,
    importedAt: now,
    sizeBytes: 0,
    bundle: {
      manifest: {
        format: 'educare-agent-bundle',
        schemaVersion: 1,
        name: `協作包 ${index}`,
        description: '檔案交接',
        version: '1.0.0',
        exportedAt: now,
        entryAgentId: `bundle-agent-${index}`,
      },
      agents: [
        {
          id: `bundle-agent-${index}`,
          name: `包助理 ${index}`,
          description: 'fixture',
          systemPrompt: 'Teach.',
          starterPrompts: [],
          ragChunks: [],
        },
      ],
      routes: [],
      encryptedProviderSettings: {
        v: 1,
        algorithm: 'AES-GCM',
        kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 100_000 },
        salt: 'abcdefghijklmnopqrstuv==',
        iv: 'abcdefghijklmnop',
        ciphertext: ARCHIVE_SECRET_MARKER,
      },
    },
  }));
  const projects = await Promise.all(
    Array.from({ length: 5 }, (_, index) =>
      repositoryFixture(
        `fixture-project-${index}`,
        sessions[index].assistantId,
        sessions[index].id,
        now,
      ),
    ),
  );
  projects.forEach((project, index) => {
    sessions[index].activeProjectId = project.id;
  });
  const checkpoints: AgentRunCheckpoint[] = [
    {
      schemaVersion: 1,
      runId: 'fixture-run',
      sessionId: sessions[10].id,
      assistantId: sessions[10].assistantId,
      projectId: null,
      status: 'stopped',
      turnIndex: 0,
      maxTurns: 3,
      originalMessage: 'saved request',
      committedHistoryDelta: [],
      toolTrace: [],
      tokenTotals: { promptTokenCount: 0, candidatesTokenCount: 0 },
      agentHarnessEnabled: false,
      sharedMode: false,
      createdAt: now,
      updatedAt: now,
      heartbeatAt: now,
    },
  ];
  const profile = {
    id: 'fixture-profile',
    displayName: '備份練習者',
    anonymous: true,
    createdAt: now,
    updatedAt: now,
  };
  const lesson = createPracticeLessonDraft({
    subject: 'math',
    gradeLevel: '五年級',
    topic: '備份數學',
    learningObjectives: ['分數'],
    profileId: profile.id,
    now,
  });
  const question = lesson.questions[0];
  const attempt = {
    id: 'fixture-attempt',
    schemaVersion: 1,
    profileId: profile.id,
    lessonId: lesson.id,
    lessonVersion: lesson.version,
    questionId: question.id,
    response: question.answer!,
    result: gradePracticeQuestion(question, question.answer!, now),
    submittedAt: now,
  };
  const bookmark = {
    id: 'fixture-bookmark',
    schemaVersion: 1,
    profileId: profile.id,
    lessonId: lesson.id,
    questionId: question.id,
    createdAt: now,
  };
  const draft = {
    schemaVersion: 1 as const,
    kind: 'chat' as const,
    ownerId: `${assistants[0].id}:${sessions[0].id}`,
    value: 'fixture-unsent-draft',
    updatedAt: now,
  };
  const source: WorkspaceArchiveSource = {
    assistants,
    sessions,
    bundles,
    projects,
    checkpoints,
    drafts: [{ ...draft, id: buildWorkspaceDraftArchiveEntryId(draft) }],
    practice: [
      { id: profile.id, sourceId: profile.id, kind: 'profile', value: profile },
      { id: lesson.id, sourceId: lesson.id, kind: 'lesson', value: lesson },
      { id: attempt.id, sourceId: attempt.id, kind: 'attempt', value: attempt },
      { id: bookmark.id, sourceId: bookmark.id, kind: 'bookmark', value: bookmark },
    ],
    preferences: { sidebarCollapsed: false },
    snapshots: [],
    git: [],
  };
  const archive = await buildWorkspaceArchive(source, {
    archiveId: 'acceptance-3-100-20-5-2',
    now,
    categories: [
      'assistants',
      'sessions',
      'bundles',
      'projects',
      'checkpoints',
      'drafts',
      'practice',
      'preferences',
    ],
  });
  return { ...archive, source, projects };
}
