import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Assistant } from '../types';
import { getAllAssistants } from './db';
import { migrateIndexedDBToTurso } from './migrationService';
import { getRagChunkCount, saveAssistantToTurso } from './tursoService';

vi.mock('./db', () => ({
  getAllAssistants: vi.fn(),
}));

vi.mock('./tursoService', () => ({
  getRagChunkCount: vi.fn(),
  saveAssistantToTurso: vi.fn(),
  saveRagChunkToTurso: vi.fn(),
}));

const mathEnabledAssistant = (overrides: Partial<Assistant> = {}): Assistant => ({
  id: 'assistant-math',
  name: 'Math tutor',
  description: 'Helps with math.',
  systemPrompt: 'Teach math clearly.',
  createdAt: 1,
  mathToolsEnabled: true,
  ...overrides,
});

describe('migrateIndexedDBToTurso', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAllAssistants).mockResolvedValue([mathEnabledAssistant()]);
    vi.mocked(getRagChunkCount).mockResolvedValue(0);
    vi.mocked(saveAssistantToTurso).mockResolvedValue(undefined);
  });

  it('passes mathToolsEnabled when migrating an IndexedDB assistant to Turso', async () => {
    // Act
    const result = await migrateIndexedDBToTurso();

    // Assert
    expect(result.success).toBe(true);
    expect(saveAssistantToTurso).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'assistant-math',
        mathToolsEnabled: true,
      }),
    );
  });
});
