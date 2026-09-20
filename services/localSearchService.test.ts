import { describe, expect, it } from 'vitest';
import {
  buildLocalSearchIndex,
  searchLocalSearchIndex,
  searchLocalWorkspace,
} from './localSearchService';
import type { Assistant, ChatSession, HtmlProject } from '../types';

const assistant: Assistant = {
  id: 'assistant-1',
  name: '數學導師',
  description: '協助處理高中數學問題',
  systemPrompt: 'Be helpful',
  createdAt: 1,
  ragChunks: [{ fileName: '三角函數.md', content: '正弦與餘弦的基本公式' }],
};

const session: ChatSession = {
  id: 'session-1',
  assistantId: assistant.id,
  title: '期末複習',
  messages: [
    { role: 'user', content: '請說明二次方程式的判別式', timestamp: 10 },
    { role: 'model', content: '判別式可以判斷根的個數。', timestamp: 20 },
  ],
  createdAt: 1,
  tokenCount: 0,
};

const project: HtmlProject = {
  id: 'project-1',
  assistantId: assistant.id,
  sessionId: session.id,
  name: '二次方程式互動教材',
  entryFile: '/index.html',
  status: 'ready',
  previewVersion: 1,
  assetPaths: [],
  createdAt: 1,
  updatedAt: 30,
};

describe('searchLocalWorkspace', () => {
  it('returns exact message indexes for navigation and includes local entity kinds', () => {
    const results = searchLocalWorkspace({
      query: '二次方程式',
      assistants: [assistant],
      sessions: [session],
      projects: [project],
    });

    expect(results.some(result => result.kind === 'message' && result.messageIndex === 0)).toBe(
      true,
    );
    expect(
      results.some(result => result.kind === 'project' && result.projectId === project.id),
    ).toBe(true);
  });

  it('normalizes full-width text and leaves empty queries quiet', () => {
    expect(
      searchLocalWorkspace({
        query: '  二次方程式  ',
        assistants: [assistant],
        sessions: [session],
      }),
    ).not.toHaveLength(0);
    expect(
      searchLocalWorkspace({ query: '   ', assistants: [assistant], sessions: [session] }),
    ).toEqual([]);
  });

  it('finds material content even when the assistant name does not match', () => {
    const results = searchLocalWorkspace({
      query: '正弦',
      assistants: [assistant],
      sessions: [],
    });

    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'material',
          title: '三角函數.md',
          assistantId: assistant.id,
        }),
      ]),
    );
  });

  it('keeps duplicate material file names addressable by chunk index', () => {
    const duplicateFileAssistant: Assistant = {
      ...assistant,
      ragChunks: [
        { fileName: 'common.md', content: '第一段共同素材' },
        { fileName: 'common.md', content: '第二段共同素材' },
      ],
    };

    const materialResults = searchLocalWorkspace({
      query: '共同素材',
      assistants: [duplicateFileAssistant],
      sessions: [],
    }).filter(result => result.kind === 'material');

    expect(materialResults).toHaveLength(2);
    expect(new Set(materialResults.map(result => result.id)).size).toBe(2);
    expect(materialResults.map(result => result.chunkIndex).sort()).toEqual([0, 1]);
  });

  it('returns exact global jump metadata and keeps search indexes scope-local', () => {
    const indexed = buildLocalSearchIndex({
      scopeId: 'workspace-a',
      query: '',
      assistants: [
        {
          ...assistant,
          ragChunks: [
            { fileName: 'first.md', content: 'intro' },
            {
              fileName: 'lesson.md',
              content: 'water cycle stages',
              documentId: 'document-water',
              contentHash: 'hash-water',
              sourceVersion: 2,
              sourceLocation: { paragraph: 4 },
              sourceType: 'file',
            },
          ],
        },
      ],
      sessions: [],
    });

    expect(searchLocalSearchIndex(indexed, 'water cycle', 10, 'workspace-b')).toEqual([]);
    expect(searchLocalSearchIndex(indexed, 'water cycle', 10, 'workspace-a')[0]).toMatchObject({
      kind: 'material',
      chunkIndex: 1,
      documentId: 'document-water',
      sourceChunkIndex: 0,
      sourceLocation: { paragraph: 4 },
    });
  });
});
