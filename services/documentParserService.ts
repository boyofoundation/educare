/// <reference types="vite/client" />
import { cleanChineseSpacing } from './textChunkingService';

type PdfjsModule = typeof import('pdfjs-dist');

// PDF.js type interfaces
interface PdfInfo {
  Title?: string;
  Author?: string;
  Subject?: string;
  Keywords?: string;
  Creator?: string;
  Producer?: string;
  CreationDate?: string;
  ModDate?: string;
}

interface PdfMetadataInfo {
  info: PdfInfo;
}

interface PdfTextItem {
  str: string;
  dir: string;
  width: number;
  height: number;
  transform: number[];
  fontName: string;
}

interface PdfTextContent {
  items: PdfTextItem[];
  styles: Record<string, unknown>;
}

// 配置 PDF.js worker - 動態設定
function setupPdfWorker(pdfjsLib: PdfjsModule) {
  // 如果已經設定過，就不重複設定
  if (pdfjsLib.GlobalWorkerOptions.workerSrc) {
    return;
  }

  // 獲取 Vite 的 base 路徑
  const base = import.meta.env.BASE_URL || '/';
  const basePath = base.endsWith('/') ? base : `${base}/`;

  // 嘗試本地 worker 文件，然後是 CDN
  const workerUrls = [
    `${basePath}js/pdf.worker.js`, // 本地文件，考慮 base path
    'https://unpkg.com/pdfjs-dist@5.4.149/build/pdf.worker.min.js',
    'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.149/build/pdf.worker.min.js',
  ];

  // 使用第一個 URL 作為預設
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrls[0];
}

// 動態載入 pdfjs-dist，並在首次使用前完成 worker 設定（setupPdfWorker 具冪等性）
async function loadPdfjs(): Promise<PdfjsModule> {
  const pdfjsLib = await import('pdfjs-dist');
  setupPdfWorker(pdfjsLib);
  return pdfjsLib;
}

export interface ParsedDocument {
  content: string;
  metadata?: {
    pages?: number;
    title?: string;
    author?: string;
  };
}

export class DocumentParserService {
  /**
   * 解析 PDF 文件
   */
  static async parsePdf(file: File): Promise<ParsedDocument> {
    try {
      const arrayBuffer = await file.arrayBuffer();

      // 動態載入 pdfjs 並確保 worker 已設定
      const pdfjsLib = await loadPdfjs();

      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

      let fullText = '';
      const metadata = {
        pages: pdf.numPages,
        title: '',
        author: '',
      };

      // 獲取文件信息
      try {
        const info = (await pdf.getMetadata()) as PdfMetadataInfo;
        metadata.title = info.info?.Title || '';
        metadata.author = info.info?.Author || '';
      } catch (err) {
        console.warn('無法獲取 PDF 元數據:', err);
      }

      // 逐頁解析文字
      for (let i = 1; i <= pdf.numPages; i++) {
        try {
          const page = await pdf.getPage(i);
          const textContent = (await page.getTextContent()) as PdfTextContent;

          const rawPageText = textContent.items
            .filter((item: PdfTextItem) => item.str && typeof item.str === 'string')
            .map((item: PdfTextItem) => item.str)
            .join(' ');

          // Clean Chinese spacing for better token calculation accuracy
          const pageText = cleanChineseSpacing(rawPageText);

          if (pageText.trim()) {
            fullText += `\n\n[第 ${i} 頁]\n${pageText.trim()}`;
          }
        } catch (pageErr) {
          console.warn(`解析 PDF 第 ${i} 頁時出錯:`, pageErr);
          fullText += `\n\n[第 ${i} 頁 - 無法解析]`;
        }
      }

      if (!fullText.trim()) {
        throw new Error('PDF 文件不包含可提取的文字內容，可能是圖片式 PDF 或受密碼保護');
      }

      return {
        content: fullText.trim(),
        metadata,
      };
    } catch (error) {
      console.error('PDF 解析失敗:', error);

      // 提供更友善的錯誤信息
      let errorMessage = 'PDF 解析失敗';
      if (error instanceof Error) {
        if (error.message.includes('worker')) {
          errorMessage = 'PDF 處理器載入失敗，請嘗試重新整理頁面';
        } else if (error.message.includes('Invalid PDF')) {
          errorMessage = 'PDF 文件格式不正確或已損壞';
        } else if (error.message.includes('Password')) {
          errorMessage = 'PDF 文件受密碼保護，無法讀取';
        } else {
          errorMessage = `PDF 解析失敗: ${error.message}`;
        }
      }

      throw new Error(errorMessage);
    }
  }

  /**
   * 解析 DOCX 文件
   */
  static async parseDocx(file: File): Promise<ParsedDocument> {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const { default: mammoth } = await import('mammoth');
      const result = await mammoth.extractRawText({ arrayBuffer });

      if (!result.value?.trim()) {
        throw new Error('DOCX 文件不包含可提取的文字內容');
      }

      // 處理警告信息
      if (result.messages && result.messages.length > 0) {
        const warnings = result.messages
          .filter(msg => msg.type === 'warning')
          .map(msg => msg.message);

        if (warnings.length > 0) {
          console.warn('DOCX 解析警告:', warnings);
        }
      }

      return {
        content: cleanChineseSpacing(result.value.trim()),
        metadata: {
          // DOCX 解析器不直接提供元數據，但可以根據需要擴展
        },
      };
    } catch (error) {
      console.error('DOCX 解析失敗:', error);
      throw new Error(`DOCX 解析失敗: ${error instanceof Error ? error.message : '未知錯誤'}`);
    }
  }

  /**
   * 解析 Markdown 文件
   */
  static async parseMarkdown(file: File): Promise<ParsedDocument> {
    try {
      const content = await file.text();

      if (!content.trim()) {
        throw new Error('Markdown 文件為空');
      }

      return {
        content: cleanChineseSpacing(content.trim()),
        metadata: {
          // 可以根據需要添加 Markdown 特定的元數據解析
        },
      };
    } catch (error) {
      console.error('Markdown 解析失敗:', error);
      throw new Error(`Markdown 解析失敗: ${error instanceof Error ? error.message : '未知錯誤'}`);
    }
  }

  /**
   * 解析純文字文件
   */
  static async parseText(file: File): Promise<ParsedDocument> {
    try {
      const content = await file.text();

      if (!content.trim()) {
        throw new Error('文字文件為空');
      }

      return {
        content: cleanChineseSpacing(content.trim()),
        metadata: {},
      };
    } catch (error) {
      console.error('文字文件解析失敗:', error);
      throw new Error(`文字文件解析失敗: ${error instanceof Error ? error.message : '未知錯誤'}`);
    }
  }

  /**
   * 根據文件類型自動選擇解析方法
   */
  static async parseDocument(file: File): Promise<ParsedDocument> {
    const fileName = file.name.toLowerCase();
    const fileType = file.type.toLowerCase();

    // 根據文件擴展名和 MIME 類型判斷文件格式
    if (fileName.endsWith('.pdf') || fileType === 'application/pdf') {
      return this.parsePdf(file);
    } else if (
      fileName.endsWith('.docx') ||
      fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      return this.parseDocx(file);
    } else if (fileName.endsWith('.md') || fileName.endsWith('.markdown')) {
      return this.parseMarkdown(file);
    } else if (fileName.endsWith('.txt') || fileType === 'text/plain') {
      return this.parseText(file);
    } else {
      throw new Error(`不支援的文件格式: ${fileName}。支援的格式：.txt, .md, .pdf, .docx`);
    }
  }

  /**
   * 檢查文件是否為支援的格式
   */
  static isSupportedFile(file: File): boolean {
    const fileName = file.name.toLowerCase();
    const fileType = file.type.toLowerCase();

    const supportedExtensions = ['.txt', '.md', '.markdown', '.pdf', '.docx'];
    const supportedMimeTypes = [
      'text/plain',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];

    return (
      supportedExtensions.some(ext => fileName.endsWith(ext)) ||
      supportedMimeTypes.includes(fileType)
    );
  }

  /**
   * 獲取支援的文件格式列表（用於文件選擇器）
   */
  static getSupportedFileTypes(): string {
    return '.txt,.md,.markdown,.pdf,.docx';
  }

  /**
   * 獲取文件格式的友好名稱
   */
  static getFileTypeName(file: File): string {
    const fileName = file.name.toLowerCase();
    const fileType = file.type.toLowerCase();

    if (fileName.endsWith('.pdf') || fileType === 'application/pdf') {
      return 'PDF 文件';
    } else if (
      fileName.endsWith('.docx') ||
      fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      return 'Word 文件';
    } else if (fileName.endsWith('.md') || fileName.endsWith('.markdown')) {
      return 'Markdown 文件';
    } else if (fileName.endsWith('.txt') || fileType === 'text/plain') {
      return '純文字文件';
    } else {
      return '未知格式';
    }
  }
}
