import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getAssistantFromTurso,
  getAssistantMetaFromTurso,
  saveAssistantToTurso,
  type TursoAssistant,
} from './tursoService';

const { executeMock } = vi.hoisted(() => ({ executeMock: vi.fn() }));

vi.mock('@libsql/client', () => ({
  createClient: vi.fn(() => ({ execute: executeMock })),
}));

vi.mock('./apiKeyManager', () => ({
  ApiKeyManager: {
    getTursoWriteConfig: vi.fn(() => ({ url: 'libsql://test-db', authToken: 'write-token' })),
    getTursoReadConfig: vi.fn(() => ({ url: 'libsql://test-db', authToken: 'read-token' })),
    hasTursoWriteAccess: vi.fn(() => true),
  },
}));

type ExecuteArg = string | { sql: string; args: unknown[] };

const sqlOf = (call: unknown[]): string => {
  const query = call[0] as ExecuteArg;
  return typeof query === 'string' ? query : query.sql;
};

const argsOf = (call: unknown[]): unknown[] => {
  const query = call[0] as ExecuteArg;
  return typeof query === 'string' ? [] : query.args;
};

const sampleAssistant: TursoAssistant = {
  id: 'a1',
  name: 'Router',
  description: 'routes things',
  systemPrompt: 'be helpful',
  createdAt: 1234,
  routableAssistantIds: ['b1', 'c1'],
  starterPrompts: ['hello there'],
  subagentDelegationEnabled: true,
};

beforeEach(() => {
  executeMock.mockReset();
});

describe('saveAssistantToTurso', () => {
  it('updates an existing assistant with config_json carrying routing config', async () => {
    // Arrange: SELECT finds an existing row, then UPDATE succeeds
    executeMock.mockResolvedValueOnce({ rows: [{ id: 'a1' }] }).mockResolvedValueOnce({ rows: [] });

    await saveAssistantToTurso(sampleAssistant);

    expect(executeMock).toHaveBeenCalledTimes(2);
    expect(sqlOf(executeMock.mock.calls[0])).toContain('SELECT id FROM assistants');
    const updateSql = sqlOf(executeMock.mock.calls[1]);
    expect(updateSql).toContain('UPDATE assistants');
    expect(updateSql).toContain('config_json');
    const updateArgs = argsOf(executeMock.mock.calls[1]);
    expect(updateArgs[4]).toBe('a1');
    const config = JSON.parse(updateArgs[3] as string);
    expect(config.routableAssistantIds).toEqual(['b1', 'c1']);
    expect(config.starterPrompts).toEqual(['hello there']);
    expect(config.subagentDelegationEnabled).toBe(true);
  });

  it('inserts a new assistant with config_json carrying routing config', async () => {
    // Arrange: SELECT finds nothing, then INSERT succeeds
    executeMock.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });

    await saveAssistantToTurso(sampleAssistant);

    expect(executeMock).toHaveBeenCalledTimes(2);
    const insertSql = sqlOf(executeMock.mock.calls[1]);
    expect(insertSql).toContain('INSERT INTO assistants');
    expect(insertSql).toContain('config_json');
    const insertArgs = argsOf(executeMock.mock.calls[1]);
    expect(insertArgs.slice(0, 5)).toEqual(['a1', 'Router', 'routes things', 'be helpful', 1234]);
    const config = JSON.parse(insertArgs[5] as string);
    expect(config.routableAssistantIds).toEqual(['b1', 'c1']);
    expect(config.starterPrompts).toEqual(['hello there']);
    expect(config.subagentDelegationEnabled).toBe(true);
  });
});

describe('getAssistantFromTurso', () => {
  const mockAssistantRead = (configJson: unknown) => {
    executeMock.mockImplementation((query: ExecuteArg) => {
      const sql = typeof query === 'string' ? query : query.sql;
      if (sql.includes('FROM assistants')) {
        return Promise.resolve({
          rows: [
            {
              id: 'a1',
              name: 'Router',
              description: 'routes things',
              system_prompt: 'be helpful',
              created_at: 1234,
              config_json: configJson,
            },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });
  };

  it('round-trips config_json written by saveAssistantToTurso', async () => {
    // Arrange: capture the exact config_json the save path writes
    executeMock.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    await saveAssistantToTurso(sampleAssistant);
    const storedConfigJson = argsOf(executeMock.mock.calls[1])[5];
    executeMock.mockReset();
    mockAssistantRead(storedConfigJson);

    const loaded = await getAssistantFromTurso('a1');

    expect(loaded).not.toBeNull();
    expect(loaded?.routableAssistantIds).toEqual(sampleAssistant.routableAssistantIds);
    expect(loaded?.starterPrompts).toEqual(sampleAssistant.starterPrompts);
    expect(loaded?.subagentDelegationEnabled).toBe(sampleAssistant.subagentDelegationEnabled);
  });

  it('degrades gracefully when config_json is null', async () => {
    mockAssistantRead(null);

    const loaded = await getAssistantFromTurso('a1');

    expect(loaded).toMatchObject({ id: 'a1', name: 'Router' });
    expect(loaded?.routableAssistantIds).toBeUndefined();
    expect(loaded?.starterPrompts).toBeUndefined();
    expect(loaded?.subagentDelegationEnabled).toBeUndefined();
  });

  it('degrades gracefully when config_json is invalid JSON', async () => {
    mockAssistantRead('{not valid json');

    const loaded = await getAssistantFromTurso('a1');

    expect(loaded).toMatchObject({ id: 'a1', name: 'Router' });
    expect(loaded?.routableAssistantIds).toBeUndefined();
    expect(loaded?.starterPrompts).toBeUndefined();
    expect(loaded?.subagentDelegationEnabled).toBeUndefined();
  });
});

describe('getAssistantMetaFromTurso', () => {
  it('returns id/name/description/routableAssistantIds without touching rag_chunks', async () => {
    executeMock.mockResolvedValueOnce({
      rows: [
        {
          id: 'a1',
          name: 'Router',
          description: 'routes things',
          config_json: JSON.stringify({ routableAssistantIds: ['b1'] }),
        },
      ],
    });

    const meta = await getAssistantMetaFromTurso('a1');

    expect(meta).toEqual({
      id: 'a1',
      name: 'Router',
      description: 'routes things',
      routableAssistantIds: ['b1'],
    });
    for (const call of executeMock.mock.calls) {
      expect(sqlOf(call)).not.toContain('rag_chunks');
    }
    expect(argsOf(executeMock.mock.calls[0])).toEqual(['a1']);
  });

  it('returns null when the assistant is not found', async () => {
    executeMock.mockResolvedValueOnce({ rows: [] });

    await expect(getAssistantMetaFromTurso('missing')).resolves.toBeNull();
  });

  it('returns null when the query throws', async () => {
    executeMock.mockRejectedValueOnce(new Error('network down'));

    await expect(getAssistantMetaFromTurso('a1')).resolves.toBeNull();
  });
});
