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
        chunkId: chunk.chunkId,
      })),
    ).toEqual([
      { fileName: '員工手冊.pdf', chunkIndex: 0, chunkId: '員工手冊.pdf#0' },
      { fileName: '員工手冊.pdf', chunkIndex: 1, chunkId: '員工手冊.pdf#1' },
      { fileName: 'leave-policy.md', chunkIndex: 0, chunkId: 'leave-policy.md#0' },
    ]);
  });

  it('matches Chinese paraphrase queries through CJK bigram tokenization', () => {
    const results = searchKnowledgeBase(knowledgeChunks, {
      query: '特休 規定',
      maxResults: 3,
    });

    expect(results[0]).toMatchObject({
      fileName: '員工手冊.pdf',
      chunkId: '員工手冊.pdf#0',
      chunkIndex: 0,
    });
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
      chunkId: 'leave-policy.md#0',
      chunkIndex: 0,
    });
  });
});
