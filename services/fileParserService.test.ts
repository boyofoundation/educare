import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FileParserError,
  chunkParsedFile,
  parseFile,
  parseFileToChunks,
} from './fileParserService';

const parseDocumentMock = vi.fn();
const isSupportedFileMock = vi.fn();

vi.mock('./documentParserService', () => ({
  DocumentParserService: {
    parseDocument: (...args: unknown[]) => parseDocumentMock(...args),
    isSupportedFile: (...args: unknown[]) => isSupportedFileMock(...args),
    getFileTypeName: vi.fn(() => '純文字文件'),
  },
}));

const createFile = (name: string, content: string, type = 'text/plain'): File =>
  new File([content], name, { type });

describe('fileParserService', () => {
  beforeEach(() => {
    parseDocumentMock.mockReset();
    isSupportedFileMock.mockReset();
    isSupportedFileMock.mockReturnValue(true);
  });

  it('retains real paragraph anchors for text material', async () => {
    const file = createFile('lesson.txt', '第一段\n\n第二段');
    parseDocumentMock.mockResolvedValue({ content: '第一段\n\n第二段', metadata: {} });

    const parsed = await parseFile(file);

    expect(parsed.segments).toEqual([
      expect.objectContaining({
        content: '第一段',
        sourceLocation: expect.objectContaining({ paragraph: 1 }),
      }),
      expect.objectContaining({
        content: '第二段',
        sourceLocation: expect.objectContaining({ paragraph: 2 }),
      }),
    ]);
  });

  it('retains PDF page markers and never invents a page for plain text', async () => {
    const pdf = createFile('lesson.pdf', '\n\n[第 2 頁]\n第二頁內容', 'application/pdf');
    parseDocumentMock.mockResolvedValue({
      content: '\n\n[第 2 頁]\n第二頁內容',
      metadata: { pages: 2 },
    });

    const parsed = await parseFile(pdf);

    expect(parsed.segments[0]).toMatchObject({
      content: '第二頁內容',
      sourceLocation: { page: 2 },
    });
    expect(parsed.pages).toBe(2);
  });

  it('supports cancellation before and during parsing', async () => {
    const file = createFile('slow.txt', 'content');
    const controller = new AbortController();
    controller.abort();

    await expect(parseFile(file, { signal: controller.signal })).rejects.toMatchObject({
      code: 'cancelled',
      fileName: 'slow.txt',
    });
    expect(parseDocumentMock).not.toHaveBeenCalled();

    const pendingController = new AbortController();
    parseDocumentMock.mockReturnValue(new Promise(() => {}));
    const parsing = parseFile(file, { signal: pendingController.signal });
    pendingController.abort();

    await expect(parsing).rejects.toBeInstanceOf(FileParserError);
  });

  it('keeps page/paragraph provenance on chunks and yields a stable document identity', async () => {
    const file = createFile('lesson.txt', '第一段\n\n第二段');
    parseDocumentMock.mockResolvedValue({ content: '第一段\n\n第二段', metadata: {} });

    const first = await parseFileToChunks(file);
    const second = await parseFileToChunks(file);

    expect(first.chunks.length).toBeGreaterThan(0);
    expect(first.chunks[0]?.documentId).toBe(second.chunks[0]?.documentId);
    expect(first.chunks[0]?.contentHash).toBe(second.chunks[0]?.contentHash);
    expect(first.chunks[0]?.sourceLocation?.paragraph).toBe(1);
    expect(first.chunks[0]?.chunkId).toBe(second.chunks[0]?.chunkId);
  });

  it('can chunk a parsed source without fabricating an anchor', async () => {
    const chunks = await chunkParsedFile({
      fileName: 'legacy.txt',
      mimeType: 'text/plain',
      byteLength: 6,
      parser: 'unknown',
      content: 'legacy',
      segments: [{ content: 'legacy' }],
    });

    expect(chunks[0]?.sourceLocation).toBeUndefined();
  });
});
