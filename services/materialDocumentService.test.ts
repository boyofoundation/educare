import { describe, expect, it } from 'vitest';
import type { RagChunk } from '../types';
import {
  buildMaterialDocumentId,
  buildMaterialChunks,
  computeMaterialContentHash,
  createMaterialDocument,
  mergeMaterialChunks,
  migrateLegacyRagChunks,
  removeMaterialDocument,
  resolveMaterialUpload,
} from './materialDocumentService';

describe('materialDocumentService', () => {
  it('creates stable hashes and distinct ids for same-name different documents', () => {
    const firstHash = computeMaterialContentHash('same name, first source');
    expect(computeMaterialContentHash('same name, first source')).toBe(firstHash);
    expect(computeMaterialContentHash('same name, second source')).not.toBe(firstHash);
    expect(buildMaterialDocumentId('lesson.md', firstHash)).not.toBe(
      buildMaterialDocumentId('lesson.md', computeMaterialContentHash('other')),
    );
  });

  it('records source version and parser locations on stable chunk ids', () => {
    const document = createMaterialDocument({
      fileName: 'lesson.md',
      content: '第一段\n\n第二段',
      documentId: 'document-1',
      sourceVersion: 2,
    });
    const chunks = buildMaterialChunks(document, [
      { content: '第一段', sourceLocation: { paragraph: 1, startOffset: 0, endOffset: 3 } },
    ]);

    expect(chunks[0]).toMatchObject({
      documentId: 'document-1',
      contentHash: document.contentHash,
      sourceVersion: 2,
      sourceLocation: { paragraph: 1, startOffset: 0, endOffset: 3 },
    });
    expect(chunks[0]?.chunkId).toContain('document-1:v2:chunk-0-');
  });

  it('treats exact reuploads as duplicates and explicit ids as revisions', () => {
    const initial = resolveMaterialUpload(
      [],
      {
        fileName: 'lesson.md',
        content: 'old content',
      },
      [{ content: 'old content' }],
    );
    const duplicate = resolveMaterialUpload(
      initial.chunks,
      {
        fileName: 'lesson.md',
        content: 'old content',
      },
      [{ content: 'old content' }],
    );
    const revision = resolveMaterialUpload(
      initial.chunks,
      {
        fileName: 'lesson.md',
        content: 'new content',
        documentId: initial.document.documentId,
      },
      [{ content: 'new content' }],
    );

    expect(initial.status).toBe('created');
    expect(duplicate.status).toBe('duplicate');
    expect(revision.status).toBe('revision');
    expect(revision.document.documentId).toBe(initial.document.documentId);
    expect(revision.document.sourceVersion).toBe(2);
  });

  it('does not replace same-name sources and deletes by document id', () => {
    const first = resolveMaterialUpload(
      [],
      {
        fileName: 'shared.md',
        content: 'first',
      },
      [{ content: 'first' }],
    );
    const second = resolveMaterialUpload(
      first.chunks,
      {
        fileName: 'shared.md',
        content: 'second',
      },
      [{ content: 'second' }],
    );
    const merged = mergeMaterialChunks(first.chunks, second.chunks);

    expect(new Set(merged.map(chunk => chunk.documentId)).size).toBe(2);
    expect(removeMaterialDocument(merged, first.document.documentId)).toEqual(second.chunks);
  });

  it('migrates legacy chunks without inventing a page or paragraph', () => {
    const legacy: RagChunk[] = [
      { fileName: 'old.txt', content: 'legacy one' },
      { fileName: 'old.txt', content: 'legacy two' },
    ];
    const migrated = migrateLegacyRagChunks(legacy);

    expect(migrated).toHaveLength(2);
    expect(migrated[0]?.documentId).toBe(migrated[1]?.documentId);
    expect(migrated[0]?.sourceType).toBe('legacy-import');
    expect(migrated[0]?.sourceLocation).toBeUndefined();
  });
});
