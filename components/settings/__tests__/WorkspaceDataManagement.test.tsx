/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import WorkspaceDataManagement from '../WorkspaceDataManagement';

const { archiveService, setupService } = vi.hoisted(() => ({
  archiveService: {
    exportWorkspaceArchive: vi.fn(),
    getWorkspaceArchiveMetadata: vi.fn(),
    importWorkspaceArchive: vi.fn(),
    listWorkspaceImportRecovery: vi.fn(),
    parseWorkspaceArchive: vi.fn(),
    previewWorkspaceArchive: vi.fn(),
    rollbackWorkspaceImport: vi.fn(),
    resumeWorkspaceImport: vi.fn(),
    WORKSPACE_ARCHIVE_MAX_BYTES: 50 * 1024 * 1024,
    WORKSPACE_ARCHIVE_MAX_ENTRIES: 5_000,
  },
  setupService: {
    prepareWorkspaceArchive: vi.fn(),
    workspaceArchiveImportOptions: { copy: true },
  },
}));

vi.mock('../../../services/workspaceArchiveService', () => archiveService);
vi.mock('../../../services/workspaceArchiveSetup', () => setupService);

const preview = () => ({
  archiveId: 'archive-fixture',
  exportedAt: 1_700_000_000_000,
  schemaVersion: 1,
  totalUncompressedBytes: 1_024,
  totalEntries: 3,
  categories: [
    {
      category: 'assistants',
      recordCount: 2,
      byteCount: 512,
      included: true,
    },
    {
      category: 'sessions',
      recordCount: 1,
      byteCount: 512,
      included: true,
    },
  ],
  includedCategories: ['assistants', 'sessions'],
  excludedCategories: [],
  excludedFields: ['apiKey'],
  excludedStores: ['providerSettings'],
  conflictCounts: {},
  warnings: [],
});

const recovery = (importId = 'import-failed-1') => ({
  importId,
  archiveId: 'archive-fixture',
  state: 'failed' as const,
  hidden: true,
  resumable: true,
  rollbackAvailable: true,
  error: 'provider write failed',
  updatedAt: 1_700_000_000_000,
});

const renderManagement = () => render(<WorkspaceDataManagement />);

// jsdom's File lacks arrayBuffer; keep this browser API local to the fixture.
const archiveFile = (name = 'workspace.zip'): File => {
  const file = new File(['archive'], name, { type: 'application/zip' });
  Object.defineProperty(file, 'arrayBuffer', {
    value: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer),
  });
  return file;
};

const waitForReady = async (): Promise<void> => {
  await waitFor(() => expect(setupService.prepareWorkspaceArchive).toHaveBeenCalled());
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '選擇工作區備份檔' })).not.toBeDisabled(),
  );
};

describe('WorkspaceDataManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupService.prepareWorkspaceArchive.mockResolvedValue(undefined);
    archiveService.getWorkspaceArchiveMetadata.mockResolvedValue({
      lastBackupAt: null,
      recoveryStatus: [],
    });
    archiveService.listWorkspaceImportRecovery.mockResolvedValue([]);
    archiveService.parseWorkspaceArchive.mockResolvedValue({});
    archiveService.previewWorkspaceArchive.mockResolvedValue(preview());
    archiveService.importWorkspaceArchive.mockResolvedValue({
      importId: 'import-success-1',
      archiveId: 'archive-fixture',
      state: 'published',
      idMap: {},
      created: { assistants: 2 },
      conflicts: {},
      skippedCategories: [],
      recoveryStatus: recovery('import-success-1'),
    });
    archiveService.rollbackWorkspaceImport.mockResolvedValue(recovery());
    archiveService.resumeWorkspaceImport.mockResolvedValue({
      importId: 'import-failed-1',
      archiveId: 'archive-fixture',
      state: 'published',
      idMap: {},
      created: { assistants: 1 },
      conflicts: {},
      skippedCategories: [],
      recoveryStatus: recovery('import-failed-1'),
    });

    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        estimate: vi.fn().mockResolvedValue({ usage: 1_024, quota: 8_192 }),
        persisted: vi.fn().mockResolvedValue(false),
        persist: vi.fn().mockResolvedValue(false),
      },
    });
  });

  it('does not write before confirmation and cancel preserves the existing workspace', async () => {
    renderManagement();
    await waitForReady();

    const file = archiveFile();
    fireEvent.change(screen.getByLabelText('選擇 EduCare 工作區備份檔'), {
      target: { files: [file] },
    });

    expect(await screen.findByTestId('workspace-import-preview')).toBeInTheDocument();
    expect(archiveService.importWorkspaceArchive).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '取消匯入' }));
    expect(screen.queryByTestId('workspace-import-preview')).not.toBeInTheDocument();
    expect(archiveService.importWorkspaceArchive).not.toHaveBeenCalled();
  });

  it('rejects an oversized file before reading its bytes', async () => {
    renderManagement();
    await waitForReady();

    const file = archiveFile('too-large.zip');
    Object.defineProperty(file, 'size', { configurable: true, value: 50 * 1024 * 1024 + 1 });
    const arrayBuffer = vi.mocked(file.arrayBuffer);

    fireEvent.change(screen.getByLabelText('選擇 EduCare 工作區備份檔'), {
      target: { files: [file] },
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('超過 50 MiB 上限');
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(archiveService.parseWorkspaceArchive).not.toHaveBeenCalled();
  });

  it('keeps a failed import recovery visible for the exact import id', async () => {
    const failed = Object.assign(new Error('provider write failed'), {
      importId: 'import-failed-1',
      recoveryStatus: recovery('import-failed-1'),
    });
    archiveService.importWorkspaceArchive.mockRejectedValueOnce(failed);
    archiveService.listWorkspaceImportRecovery
      .mockResolvedValueOnce([])
      .mockResolvedValue([recovery('import-failed-1')]);

    renderManagement();
    await waitForReady();
    const file = archiveFile();
    fireEvent.change(screen.getByLabelText('選擇 EduCare 工作區備份檔'), {
      target: { files: [file] },
    });
    await screen.findByTestId('workspace-import-preview');
    fireEvent.click(screen.getByRole('button', { name: '確認以副本匯入' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('匯入編號：import-failed-1');
    expect(await screen.findByTestId('workspace-recovery-import-failed-1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '繼續匯入 import-failed-1' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '回復並清理匯入 import-failed-1' }),
    ).toBeInTheDocument();
  });

  it('reports persistence denial without deleting or changing archive data', async () => {
    renderManagement();
    await waitForReady();

    fireEvent.click(screen.getByRole('button', { name: '請求持久儲存' }));

    expect(await screen.findByRole('status')).toHaveTextContent('瀏覽器拒絕持久儲存請求');
    expect(archiveService.importWorkspaceArchive).not.toHaveBeenCalled();
    expect(archiveService.rollbackWorkspaceImport).not.toHaveBeenCalled();
    expect(archiveService.resumeWorkspaceImport).not.toHaveBeenCalled();
  });
});
