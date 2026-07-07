/// <reference types="vitest/globals" />
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectPicker } from '../ProjectPicker';
import { htmlProjectStore } from '../../../services/htmlProjectStore';
import { htmlProjectZipService } from '../../../services/htmlProjectZipService';

vi.mock('../../../services/htmlProjectStore', () => ({
  htmlProjectStore: {
    listProjectsByAssistant: vi.fn(),
  },
}));

vi.mock('../../../services/htmlProjectZipService', () => ({
  htmlProjectZipService: {
    downloadProjectZip: vi.fn(),
  },
}));

const TEST_PROJECT = {
  id: 'project-1',
  assistantId: 'assistant-1',
  sessionId: 'session-1',
  name: 'Landing Page',
  description: 'Marketing microsite',
  entryFile: '/index.html',
  status: 'ready' as const,
  previewVersion: 2,
  assetPaths: [],
  createdAt: 1700000000000,
  updatedAt: 1700000001000,
};

const makeProject = (overrides: Partial<typeof TEST_PROJECT>) => ({
  ...TEST_PROJECT,
  ...overrides,
});

describe('ProjectPicker', () => {
  const onCreateProject = vi.fn();
  const onOpenProject = vi.fn();
  const onRenameProject = vi.fn();
  const onUploadProjectFiles = vi.fn();
  const onImportProjectZip = vi.fn();
  const onDeleteProject = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(htmlProjectStore.listProjectsByAssistant).mockResolvedValue([{ ...TEST_PROJECT }]);
    vi.mocked(htmlProjectZipService.downloadProjectZip).mockResolvedValue({
      fileCount: 1,
      fileName: 'landing-page.zip',
      projectId: TEST_PROJECT.id,
      projectName: TEST_PROJECT.name,
    });
  });

  const renderPicker = () =>
    render(
      <ProjectPicker
        assistantId='assistant-1'
        activeProjectId='project-1'
        onCreateProject={onCreateProject}
        onOpenProject={onOpenProject}
        onRenameProject={onRenameProject}
        onUploadProjectFiles={onUploadProjectFiles}
        onImportProjectZip={onImportProjectZip}
        onDeleteProject={onDeleteProject}
      />,
    );

  const openModal = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'HTML Projects' }));

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText('Landing Page')).toBeInTheDocument();
    });
  };

  const openCardMenu = async (cardIndex = 0) => {
    const menuButtons = screen.getAllByRole('button', { name: '專案動作選單' });
    fireEvent.click(menuButtons[cardIndex]);

    await waitFor(() => {
      expect(screen.getByRole('menu')).toBeInTheDocument();
    });

    return screen.getByRole('menu');
  };

  it('opens a project when the card body or the open button is clicked', async () => {
    renderPicker();

    await openModal();

    fireEvent.click(screen.getByTestId('project-card-project-1'));

    await waitFor(() => {
      expect(onOpenProject).toHaveBeenCalledWith('project-1');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('exposes card actions behind an accessible kebab menu', async () => {
    renderPicker();

    await openModal();

    const menuButton = screen.getByRole('button', { name: '專案動作選單' });
    expect(menuButton).toHaveAttribute('aria-haspopup', 'menu');
    expect(menuButton).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(menuButton);

    expect(menuButton).toHaveAttribute('aria-expanded', 'true');
    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Upload files' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Upload folder' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Download ZIP' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Delete project' })).toBeInTheDocument();
  });

  it('renames a project inline and submits the trimmed name with Enter', async () => {
    renderPicker();

    await openModal();

    const menu = await openCardMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Rename' }));

    const input = screen.getByRole('textbox', { name: '專案名稱' });
    expect(input).toHaveValue('Landing Page');

    fireEvent.change(input, { target: { value: '  Renamed Landing Page  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(onRenameProject).toHaveBeenCalledWith('project-1', 'Renamed Landing Page');
    });
  });

  it('cancels inline rename with Escape and keeps the modal open', async () => {
    renderPicker();

    await openModal();

    const menu = await openCardMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Rename' }));

    const input = screen.getByRole('textbox', { name: '專案名稱' });
    fireEvent.change(input, { target: { value: 'Never Saved' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(screen.queryByRole('textbox', { name: '專案名稱' })).not.toBeInTheDocument();
    expect(onRenameProject).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Landing Page')).toBeInTheDocument();
  });

  it('triggers file upload for both files and folders from the kebab menu', async () => {
    renderPicker();

    await openModal();

    const fileInput = document.body.querySelector(
      'input[type="file"][multiple]:not([webkitdirectory])',
    ) as HTMLInputElement;
    const folderInput = document.body.querySelector(
      'input[type="file"][webkitdirectory]',
    ) as HTMLInputElement;

    const fileInputClickSpy = vi.spyOn(fileInput, 'click');
    const folderInputClickSpy = vi.spyOn(folderInput, 'click');

    let menu = await openCardMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Upload files' }));
    expect(fileInputClickSpy).toHaveBeenCalledTimes(1);
    expect(folderInputClickSpy).not.toHaveBeenCalled();

    const uploadedFile = new File(['<main>Upload</main>'], 'index.html', { type: 'text/html' });
    fireEvent.change(fileInput, { target: { files: [uploadedFile] } });

    await waitFor(() => {
      expect(onUploadProjectFiles).toHaveBeenCalledWith('project-1', [uploadedFile]);
    });

    menu = await openCardMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Upload folder' }));
    expect(folderInputClickSpy).toHaveBeenCalledTimes(1);

    const folderFile = new File(['body { color: red; }'], 'app.css', { type: 'text/css' });
    fireEvent.change(folderInput, { target: { files: [folderFile] } });

    await waitFor(() => {
      expect(onUploadProjectFiles).toHaveBeenCalledWith('project-1', [folderFile]);
    });
  });

  it('downloads the project ZIP from the kebab menu', async () => {
    renderPicker();

    await openModal();

    const menu = await openCardMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Download ZIP' }));

    await waitFor(() => {
      expect(htmlProjectZipService.downloadProjectZip).toHaveBeenCalledWith(
        'project-1',
        'assistant-1',
      );
    });
  });

  it('deletes a project only after confirming inside the card', async () => {
    renderPicker();

    await openModal();

    const menu = await openCardMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Delete project' }));

    expect(screen.getByText('此動作無法復原。')).toBeInTheDocument();
    expect(onDeleteProject).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '永久刪除' }));

    await waitFor(() => {
      expect(onDeleteProject).toHaveBeenCalledWith('project-1');
    });
  });

  it('cancels the in-card delete confirmation without deleting', async () => {
    renderPicker();

    await openModal();

    const menu = await openCardMenu();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Delete project' }));

    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    expect(screen.queryByText('此動作無法復原。')).not.toBeInTheDocument();
    expect(onDeleteProject).not.toHaveBeenCalled();
  });

  it('triggers zip import and forwards the selected archive file', async () => {
    renderPicker();

    await openModal();

    const zipInput = document.body.querySelector(
      'input[type="file"][accept=".zip,application/zip"]',
    ) as HTMLInputElement;
    const zipInputClickSpy = vi.spyOn(zipInput, 'click');

    fireEvent.click(screen.getByRole('button', { name: 'Import ZIP' }));
    expect(zipInputClickSpy).toHaveBeenCalledTimes(1);

    const zipFile = new File(['zip-binary'], 'landing-page.zip', { type: 'application/zip' });
    fireEvent.change(zipInput, { target: { files: [zipFile] } });

    await waitFor(() => {
      expect(onImportProjectZip).toHaveBeenCalledWith(zipFile);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('sorts projects by updatedAt descending and filters them via the search box', async () => {
    const projects = [
      makeProject({ id: 'p-alpha', name: 'Alpha Site', description: 'first', updatedAt: 1000 }),
      makeProject({ id: 'p-beta', name: 'Beta Blog', description: 'second', updatedAt: 6000 }),
      makeProject({ id: 'p-gamma', name: 'Gamma Game', description: 'third', updatedAt: 3000 }),
      makeProject({ id: 'p-delta', name: 'Delta Docs', description: 'fourth', updatedAt: 5000 }),
      makeProject({ id: 'p-epsilon', name: 'Epsilon App', description: 'fifth', updatedAt: 2000 }),
      makeProject({ id: 'p-zeta', name: 'Zeta Zone', description: 'sixth', updatedAt: 4000 }),
    ];
    vi.mocked(htmlProjectStore.listProjectsByAssistant).mockResolvedValue(projects);

    renderPicker();

    fireEvent.click(screen.getByRole('button', { name: 'HTML Projects' }));
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText('Alpha Site')).toBeInTheDocument();
    });

    const cards = screen.getAllByTestId(/^project-card-/);
    expect(cards).toHaveLength(6);
    expect(cards[0]).toHaveTextContent('Beta Blog');
    expect(cards[1]).toHaveTextContent('Delta Docs');
    expect(cards[5]).toHaveTextContent('Alpha Site');

    const searchInput = screen.getByRole('searchbox', { name: '搜尋專案' });
    fireEvent.change(searchInput, { target: { value: 'gamma' } });

    expect(screen.getByText('Gamma Game')).toBeInTheDocument();
    expect(screen.queryByText('Beta Blog')).not.toBeInTheDocument();
    expect(screen.getAllByTestId(/^project-card-/)).toHaveLength(1);

    fireEvent.change(searchInput, { target: { value: 'no-such-project' } });
    expect(screen.getByText(/找不到符合/)).toBeInTheDocument();
  });

  it('hides the search box when there are five or fewer projects', async () => {
    renderPicker();

    await openModal();

    expect(screen.queryByRole('searchbox', { name: '搜尋專案' })).not.toBeInTheDocument();
  });
});
