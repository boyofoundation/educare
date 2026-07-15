import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BundleImportPage from './BundleImportPage';
import type { AgentBundle, BundleIssue, BundleRecord, BundleValidationResult } from '../../types';

const { bundleService, db, locationStub } = vi.hoisted(() => ({
  bundleService: {
    parseBundleText: vi.fn(),
    parseBundleFile: vi.fn(),
    buildImportedBundle: vi.fn(),
    estimateBundleSize: vi.fn(() => 512),
    AGENT_BUNDLE_LARGE_FILE_BYTES: 2 * 1024 * 1024,
  },
  db: {
    listBundles: vi.fn(),
    saveBundle: vi.fn(),
    deleteBundle: vi.fn(),
  },
  locationStub: new URL('http://localhost/?import=bundle'),
}));

vi.mock('../../services/agentBundleService', () => bundleService);
vi.mock('../../services/db', () => db);

const validBundle = (): AgentBundle => ({
  manifest: {
    format: 'educare-agent-bundle',
    schemaVersion: 1,
    name: 'STEM 小組',
    description: '跨領域教學團隊',
    version: '1.2.0',
    exportedAt: 5,
    entryAgentId: 'entry',
  },
  agents: [
    {
      id: 'entry',
      name: '接待助理',
      description: '負責分流問題。',
      systemPrompt: 'SECRET-PROMPT-ENTRY',
      starterPrompts: [],
      ragChunks: [{ fileName: 'intro.md', content: '歡迎光臨' }],
      icon: '🚪',
    },
    {
      id: 'math',
      name: '數學助理',
      description: '講解數學觀念。',
      systemPrompt: 'SECRET-PROMPT-MATH',
      starterPrompts: [],
      ragChunks: [
        { fileName: 'a.md', content: '一加一等於二' },
        { fileName: 'b.md', content: '畢氏定理' },
      ],
    },
  ],
  routes: [{ fromAgentId: 'entry', toAgentId: 'math' }],
});

const resultWith = (
  bundle: AgentBundle | null,
  errors: BundleIssue[],
  warnings: BundleIssue[] = [],
): BundleValidationResult => ({
  bundle,
  errors,
  warnings,
});

describe('BundleImportPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.listBundles.mockResolvedValue([]);
    db.saveBundle.mockResolvedValue(undefined);
    db.deleteBundle.mockResolvedValue(undefined);
    locationStub.href = 'http://localhost/?import=bundle';
    Object.defineProperty(window, 'location', {
      value: locationStub,
      configurable: true,
      writable: true,
    });
  });

  const pasteAndParse = async (text: string) => {
    fireEvent.change(screen.getByRole('textbox'), { target: { value: text } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '解析貼上內容' }));
    });
  };

  it('shows a typed corrupted-json error with next-step guidance and no preview', async () => {
    bundleService.parseBundleText.mockReturnValue(
      resultWith(null, [
        {
          code: 'corrupted-json',
          message: 'JSON 無法解析。',
          nextStep: '請重新向創作者索取檔案。',
        },
      ]),
    );

    render(<BundleImportPage onClose={() => undefined} onOpenBundle={() => undefined} />);
    await pasteAndParse('{ not json');

    expect(screen.getByText('JSON 無法解析。')).toBeInTheDocument();
    expect(screen.getByText('請重新向創作者索取檔案。')).toBeInTheDocument();
    expect(screen.queryByLabelText('協作包預覽')).not.toBeInTheDocument();
  });

  it('shows a schema-too-new error for a future schema version', async () => {
    bundleService.parseBundleText.mockReturnValue(
      resultWith(null, [
        { code: 'schema-too-new', message: '協作包版本過新。', nextStep: '請更新 EduCare。' },
      ]),
    );

    render(<BundleImportPage onClose={() => undefined} onOpenBundle={() => undefined} />);
    await pasteAndParse('{"manifest":{"schemaVersion":2}}');

    expect(screen.getByText('協作包版本過新。')).toBeInTheDocument();
    expect(screen.getByText('請更新 EduCare。')).toBeInTheDocument();
  });

  it('shows a missing-field error when entryAgentId is absent', async () => {
    bundleService.parseBundleText.mockReturnValue(
      resultWith(null, [
        { code: 'missing-field', message: '缺少接待入口助理。', nextStep: '請修正後重新匯出。' },
      ]),
    );

    render(<BundleImportPage onClose={() => undefined} onOpenBundle={() => undefined} />);
    await pasteAndParse('{}');

    expect(screen.getByText('缺少接待入口助理。')).toBeInTheDocument();
  });

  it('parses a file dropped via the file input and renders the preview', async () => {
    bundleService.parseBundleFile.mockResolvedValue(resultWith(validBundle(), []));

    render(<BundleImportPage onClose={() => undefined} onOpenBundle={() => undefined} />);
    const input = screen.getByLabelText('協作包檔案拖放區').querySelector('input[type="file"]');
    await act(async () => {
      fireEvent.change(input!, {
        target: { files: [new File(['{}'], 'team.educare-bundle.json')] },
      });
    });

    await waitFor(() => expect(screen.getByLabelText('協作包預覽')).toBeInTheDocument());
    expect(bundleService.parseBundleFile).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'team.educare-bundle.json' }),
    );
  });

  it('preview shows metadata, agent count, icons, knowledge size, and descriptions without exposing prompts', async () => {
    bundleService.parseBundleText.mockReturnValue(resultWith(validBundle(), []));

    render(<BundleImportPage onClose={() => undefined} onOpenBundle={() => undefined} />);
    await pasteAndParse('valid');

    const preview = screen.getByLabelText('協作包預覽');
    expect(preview).toHaveTextContent('STEM 小組');
    expect(preview).toHaveTextContent('v1.2.0');
    expect(preview).toHaveTextContent('Agent 數');
    expect(preview).toHaveTextContent('2');
    expect(preview).toHaveTextContent('接待助理');
    expect(preview).toHaveTextContent('數學助理');
    expect(preview).toHaveTextContent('🚪');
    expect(preview).toHaveTextContent('接待入口');
    // Agent descriptions are shown...
    expect(preview).toHaveTextContent('負責分流問題。');
    // ...but system prompts must never leak into the import preview.
    expect(preview).not.toHaveTextContent('SECRET-PROMPT-ENTRY');
    expect(preview).not.toHaveTextContent('SECRET-PROMPT-MATH');
  });

  it('shows only protected-state messaging for a v2 bundle without prompting for credentials', async () => {
    const encryptedBundle: AgentBundle = {
      ...validBundle(),
      manifest: { ...validBundle().manifest, schemaVersion: 2 },
      encryptedProviderSettings: {
        v: 1,
        algorithm: 'AES-GCM',
        kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 100000 },
        salt: 'abcdefghijklmnopqrstuv',
        iv: 'abcdefghijklmnop',
        ciphertext: 'encrypted-settings',
      },
    };
    bundleService.parseBundleText.mockReturnValue(resultWith(encryptedBundle, []));

    render(<BundleImportPage onClose={() => undefined} onOpenBundle={() => undefined} />);
    await pasteAndParse('protected');

    expect(screen.getByText(/包含受密碼保護的 AI 服務商設定/)).toBeInTheDocument();
    expect(screen.queryByLabelText('協作包密碼')).not.toBeInTheDocument();
  });

  it('activates a validated bundle by saving a namespaced record and navigating to ?bundle=', async () => {
    bundleService.parseBundleText.mockReturnValue(resultWith(validBundle(), []));
    const record: BundleRecord = {
      id: 'rec-1',
      bundle: validBundle(),
      importedAt: 99,
      sizeBytes: 512,
    };
    bundleService.buildImportedBundle.mockReturnValue(record);

    render(<BundleImportPage onClose={() => undefined} onOpenBundle={() => undefined} />);
    await pasteAndParse('valid');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '啟用協作包' }));
    });

    expect(bundleService.buildImportedBundle).toHaveBeenCalledWith(validBundle());
    expect(db.saveBundle).toHaveBeenCalledWith(record);
    expect(locationStub.href).toContain('bundle=rec-1');
    expect(locationStub.href).not.toContain('import=bundle');
  });

  it('shows local storage cleanup guidance and does not navigate when bundle saving exceeds quota', async () => {
    bundleService.parseBundleText.mockReturnValue(resultWith(validBundle(), []));
    const record: BundleRecord = {
      id: 'rec-quota',
      bundle: validBundle(),
      importedAt: 99,
      sizeBytes: 512,
    };
    bundleService.buildImportedBundle.mockReturnValue(record);
    const quotaError = new Error('Storage quota exceeded');
    quotaError.name = 'QuotaExceededError';
    db.saveBundle.mockRejectedValue(quotaError);

    render(<BundleImportPage onClose={() => undefined} onOpenBundle={() => undefined} />);
    await pasteAndParse('valid');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '啟用協作包' }));
    });

    await waitFor(() =>
      expect(
        screen.getByText(/瀏覽器儲存空間不足。請刪除不需要的協作包或對話紀錄後重試/),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText(/請創作者縮小知識庫/)).toBeInTheDocument();
    expect(locationStub.href).toContain('import=bundle');
    expect(locationStub.href).not.toContain('bundle=rec-quota');
  });

  it('lists imported bundles, discloses conversation cleanup, and deletes on confirm', async () => {
    const existing: BundleRecord = {
      id: 'rec-old',
      bundle: validBundle(),
      importedAt: 1,
      sizeBytes: 512,
    };
    db.listBundles.mockResolvedValue([existing]);
    db.deleteBundle.mockResolvedValue(undefined);

    render(<BundleImportPage onClose={() => undefined} onOpenBundle={() => undefined} />);
    await waitFor(() => expect(screen.getByText('STEM 小組')).toBeInTheDocument());

    const deleteButton = screen.getByLabelText('刪除協作包 STEM 小組');
    await act(async () => {
      fireEvent.click(deleteButton);
    });

    expect(screen.getByText(/將一併刪除對話紀錄/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '確定刪除' }));
    });

    expect(db.deleteBundle).toHaveBeenCalledWith('rec-old');
  });

  it('opens an existing bundle from the list and navigates to its bundle URL', async () => {
    const existing: BundleRecord = {
      id: 'rec-old',
      bundle: validBundle(),
      importedAt: 1,
      sizeBytes: 512,
    };
    db.listBundles.mockResolvedValue([existing]);

    render(<BundleImportPage onClose={() => undefined} onOpenBundle={() => undefined} />);
    await waitFor(() => expect(screen.getByText('STEM 小組')).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '開啟' }));
    });

    expect(locationStub.href).toContain('bundle=rec-old');
  });
});
