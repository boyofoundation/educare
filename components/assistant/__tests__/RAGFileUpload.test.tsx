/// <reference types="vitest/globals" />
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RAGFileUpload } from '../RAGFileUpload';
import type { RAGFileUploadProps } from '../types';

const chunkTextMock = vi.fn();
const isSupportedFileMock = vi.fn();
const getFileTypeNameMock = vi.fn();
const parseDocumentMock = vi.fn();

vi.mock('../../../services/textChunkingService', () => ({
  DEFAULT_CHUNKING_OPTIONS: {},
  chunkText: (...args: unknown[]) => chunkTextMock(...args),
}));

vi.mock('../../../services/documentParserService', () => ({
  DocumentParserService: {
    isSupportedFile: (...args: unknown[]) => isSupportedFileMock(...args),
    getFileTypeName: (...args: unknown[]) => getFileTypeNameMock(...args),
    parseDocument: (...args: unknown[]) => parseDocumentMock(...args),
  },
}));

const createMockFile = (name: string, type: string, content = 'test content') =>
  new File([content], name, { type });

describe('RAGFileUpload', () => {
  let mockProps: RAGFileUploadProps;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockProps = {
      ragChunks: [],
      onRagChunksChange: vi.fn(),
      disabled: false,
    };

    chunkTextMock.mockReturnValue({ chunks: ['Chunk 1', 'Chunk 2'] });
    isSupportedFileMock.mockReturnValue(true);
    getFileTypeNameMock.mockReturnValue('PDF');
    parseDocumentMock.mockResolvedValue({
      content: 'Mocked document content for testing purposes.',
      metadata: {},
    });

    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the upload section with current supported file types', () => {
    render(<RAGFileUpload {...mockProps} />);

    expect(screen.getByText('知識檔案 (RAG)')).toBeInTheDocument();
    expect(screen.getByText('📄 TXT')).toBeInTheDocument();
    expect(screen.getByText('📝 MD')).toBeInTheDocument();
    expect(screen.getByText('📕 PDF')).toBeInTheDocument();
    expect(screen.getByText('📘 DOCX')).toBeInTheDocument();

    const fileInput = document.querySelector('input[type="file"]');
    expect(fileInput).toHaveAttribute('accept', '.txt,.md,.markdown,.pdf,.docx');
  });

  it('creates local rag chunks for a supported upload', async () => {
    render(<RAGFileUpload {...mockProps} />);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = createMockFile('test.pdf', 'application/pdf');

    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(mockProps.onRagChunksChange).toHaveBeenCalledWith([
        { fileName: 'test.pdf', content: 'Chunk 1' },
        { fileName: 'test.pdf', content: 'Chunk 2' },
      ]);
    });

    expect(parseDocumentMock).toHaveBeenCalledWith(file);
    expect(screen.getByText(/已解析，尚未儲存/)).toBeInTheDocument();
  });

  it('shows processing status and disables input while upload is in progress', async () => {
    let resolveParse:
      | ((value: { content: string; metadata: Record<string, never> }) => void)
      | undefined;
    parseDocumentMock.mockReturnValue(
      new Promise(resolve => {
        resolveParse = resolve;
      }),
    );

    render(<RAGFileUpload {...mockProps} />);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = createMockFile('pending.pdf', 'application/pdf');

    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText(/解析 PDF: pending\.pdf/)).toBeInTheDocument();
      expect(fileInput).toBeDisabled();
    });

    resolveParse?.({ content: 'Pending document content', metadata: {} });

    await waitFor(() => {
      expect(screen.queryByText(/解析 PDF: pending\.pdf/)).not.toBeInTheDocument();
    });
  });

  it('skips unsupported files and keeps chunks unchanged', async () => {
    isSupportedFileMock.mockReturnValue(false);

    render(<RAGFileUpload {...mockProps} />);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = createMockFile('test.xyz', 'application/octet-stream');

    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(mockProps.onRagChunksChange).toHaveBeenCalledWith([]);
    });

    expect(parseDocumentMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith('不支援的文件格式: test.xyz');
  });

  it('reports parse failures without adding chunks', async () => {
    parseDocumentMock.mockRejectedValueOnce(new Error('parse failed'));

    render(<RAGFileUpload {...mockProps} />);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = createMockFile('broken.pdf', 'application/pdf');

    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(errorSpy).toHaveBeenCalled();
      expect(screen.getByText(/broken\.pdf 處理失敗: parse failed/)).toBeInTheDocument();
    });

    expect(mockProps.onRagChunksChange).not.toHaveBeenCalled();
  });

  it('renders uploaded file names and removes a document by filename', () => {
    const ragChunks = [
      { fileName: 'alpha.pdf', content: 'A' },
      { fileName: 'alpha.pdf', content: 'B' },
      { fileName: 'beta.md', content: 'C' },
    ];

    render(<RAGFileUpload {...mockProps} ragChunks={ragChunks} />);

    expect(screen.getByText('alpha.pdf')).toBeInTheDocument();
    expect(screen.getByText('beta.md')).toBeInTheDocument();

    const removeButtons = screen.getAllByRole('button');
    fireEvent.click(removeButtons[0]);

    expect(mockProps.onRagChunksChange).toHaveBeenCalledWith([
      { fileName: 'beta.md', content: 'C' },
    ]);
  });

  it('respects disabled mode for file input and remove buttons', () => {
    const ragChunks = [{ fileName: 'alpha.pdf', content: 'A' }];

    render(<RAGFileUpload {...mockProps} ragChunks={ragChunks} disabled={true} />);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).toBeDisabled();
    expect(screen.getByRole('button')).toBeDisabled();
  });
});
