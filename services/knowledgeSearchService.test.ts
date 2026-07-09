import { describe, expect, it } from 'vitest';
import {
  buildIndexedKnowledgeChunks,
  buildKnowledgeSearchResponse,
  searchKnowledgeBase,
} from './knowledgeSearchService';
import type { RagChunk } from '../types';

const knowledgeChunks: RagChunk[] = [
  {
    fileName: '員工手冊.pdf',
    content: '特休假規定：滿一年後享有特休假。',
  },
  {
    fileName: '員工手冊.pdf',
    content: '加班補休規則與申請流程。',
  },
  {
    fileName: 'leave-policy.md',
    content: 'Vacation policy for full-time employees.',
  },
];

describe('knowledgeSearchService', () => {
  it('builds deterministic chunk indexes and ids per file', () => {
    const indexed = buildIndexedKnowledgeChunks(knowledgeChunks);

    expect(
      indexed.map(chunk => ({
        fileName: chunk.fileName,
        chunkIndex: chunk.chunkIndex,
      })),
    ).toEqual([
      { fileName: '員工手冊.pdf', chunkIndex: 0 },
      { fileName: '員工手冊.pdf', chunkIndex: 1 },
      { fileName: 'leave-policy.md', chunkIndex: 0 },
    ]);
    expect(indexed[0]?.chunkId).toMatch(/^員工手冊\.pdf#0:\d+:[0-9a-f]+$/);
    expect(indexed[1]?.chunkId).toMatch(/^員工手冊\.pdf#1:\d+:[0-9a-f]+$/);
    expect(indexed[2]?.chunkId).toMatch(/^leave-policy\.md#0:\d+:[0-9a-f]+$/);
  });

  it('includes content fingerprint in chunk ids so same file names stay distinguishable', () => {
    const duplicateNameChunks: RagChunk[] = [
      { fileName: 'syllabus.pdf', content: 'First document content' },
      { fileName: 'syllabus.pdf', content: 'Second document content' },
    ];

    const indexed = buildIndexedKnowledgeChunks(duplicateNameChunks);

    expect(indexed[0]?.chunkId).not.toBe(indexed[1]?.chunkId);
    expect(indexed[0]?.chunkId).toContain('syllabus.pdf#0');
    expect(indexed[1]?.chunkId).toContain('syllabus.pdf#1');
  });

  it('matches Chinese paraphrase queries through CJK bigram tokenization', () => {
    const results = searchKnowledgeBase(knowledgeChunks, {
      query: '特休 規定',
      maxResults: 3,
    });

    expect(results[0]).toMatchObject({
      fileName: '員工手冊.pdf',
      chunkIndex: 0,
    });
    expect(results[0]?.chunkId).toMatch(/^員工手冊\.pdf#0:\d+:[0-9a-f]+$/);
    expect(results[0]?.content).toContain('特休假規定');
  });

  it('preserves English search behavior while returning anchor metadata', () => {
    const response = buildKnowledgeSearchResponse(knowledgeChunks, {
      query: 'vacation policy',
      maxResults: 2,
    });

    expect(response.totalMatches).toBeGreaterThan(0);
    expect(response.results[0]).toMatchObject({
      fileName: 'leave-policy.md',
      chunkIndex: 0,
    });
    expect(response.results[0]?.chunkId).toMatch(/^leave-policy\.md#0:\d+:[0-9a-f]+$/);
  });
});
