import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildRouteToAssistantTool,
  buildRoutingSystemPrompt,
  clearSharedRoutingTargetCache,
  getCachedSharedRoutableTargets,
  resolveBundleRoutableTargets,
  resolveRoutableTargets,
  resolveSharedRoutableTargets,
  validateRouteCall,
} from './assistantRoutingService';
import { getAssistantMetaFromTurso } from './tursoService';
import type { Assistant } from '../types';

vi.mock('./tursoService', () => ({
  getAssistantMetaFromTurso: vi.fn(),
}));

const metaMock = vi.mocked(getAssistantMetaFromTurso);

const source: Assistant = {
  id: 'a',
  name: 'A',
  description: 'source',
  systemPrompt: '',
  createdAt: 1,
  routableAssistantIds: ['b'],
};
const target: Assistant = {
  id: 'b',
  name: 'B',
  description: 'target',
  systemPrompt: '',
  createdAt: 1,
};

describe('assistant routing', () => {
  it('uses the whitelist as the tool enum', () => {
    const targets = resolveRoutableTargets(source, [source, target]);
    expect(buildRouteToAssistantTool(targets).parameters.properties.targetAssistantId.enum).toEqual(
      ['b'],
    );
    expect(buildRoutingSystemPrompt(targets)).toContain('B');
  });

  it('rejects unknown targets and clamps persisted proposal fields', () => {
    expect(
      validateRouteCall(
        { targetAssistantId: 'nope', reason: 'x', handoffSummary: 'y' },
        [target],
        'a',
        's',
      ),
    ).toMatchObject({ ok: false, recoverable: true });
    const result = validateRouteCall(
      { targetAssistantId: 'b', reason: 'r'.repeat(300), handoffSummary: 's'.repeat(3000) },
      [target],
      'a',
      's',
    );
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.proposal.reason).toHaveLength(200);
      expect(result.proposal.handoffSummary).toHaveLength(2000);
    }
  });
});

describe('bundle routable targets', () => {
  it('keeps ordered outgoing targets, dropping self, duplicates, and unknown agents', () => {
    const bundle = {
      manifest: {
        format: 'educare-agent-bundle' as const,
        schemaVersion: 1 as const,
        name: 'Team',
        description: '',
        version: '1',
        exportedAt: 1,
        entryAgentId: 'math',
      },
      agents: [
        {
          id: 'math',
          name: 'Math',
          description: 'Math tutor',
          systemPrompt: '',
          starterPrompts: [],
          ragChunks: [],
        },
        {
          id: 'science',
          name: 'Science',
          description: 'Science tutor',
          systemPrompt: '',
          starterPrompts: [],
          ragChunks: [],
        },
      ],
      routes: [
        { fromAgentId: 'writing', toAgentId: 'science' },
        { fromAgentId: 'math', toAgentId: 'math' },
        { fromAgentId: 'math', toAgentId: 'science', condition: 'science questions' },
        { fromAgentId: 'math', toAgentId: 'science' },
        { fromAgentId: 'math', toAgentId: 'missing' },
      ],
    };

    expect(resolveBundleRoutableTargets(bundle, 'math')).toEqual([
      {
        id: 'science',
        name: 'Science',
        description: 'Science tutor Route condition: science questions',
      },
    ]);
  });
});

const makeAssistant = (id: string, routableAssistantIds?: string[]): Assistant => ({
  id,
  name: `Name-${id}`,
  description: `Desc-${id}`,
  systemPrompt: '',
  createdAt: 1,
  routableAssistantIds,
});

const makeMeta = (id: string) => ({
  id,
  name: `Name-${id}`,
  description: `Desc-${id}`,
  routableAssistantIds: undefined,
});

describe('shared routable targets', () => {
  beforeEach(() => {
    // Module-level caches are global; reset them and mock call counts per test.
    clearSharedRoutingTargetCache();
    vi.clearAllMocks();
  });

  it('resolves multiple targets and silently drops failed lookups', async () => {
    metaMock.mockImplementation(async id => (id === 'c' ? null : makeMeta(id)));
    const assistant = makeAssistant('a', ['b', 'c', 'd']);

    const targets = await resolveSharedRoutableTargets(assistant);

    expect(targets).toEqual([
      { id: 'b', name: 'Name-b', description: 'Desc-b', routableAssistantIds: undefined },
      { id: 'd', name: 'Name-d', description: 'Desc-d', routableAssistantIds: undefined },
    ]);
    expect(metaMock).toHaveBeenCalledTimes(3);
  });

  it('caches resolution per assistant and refetches after cache clear', async () => {
    metaMock.mockImplementation(async id => makeMeta(id));
    const assistant = makeAssistant('a', ['b', 'c']);

    const first = await resolveSharedRoutableTargets(assistant);
    const second = await resolveSharedRoutableTargets(assistant);

    // Assert: repeated call for the same id + routableAssistantIds hits the cache
    expect(first).toEqual(second);
    expect(metaMock).toHaveBeenCalledTimes(2);

    // Act: clearing the cache forces a fresh lookup
    clearSharedRoutingTargetCache();
    await resolveSharedRoutableTargets(assistant);

    expect(metaMock).toHaveBeenCalledTimes(4);
  });

  it('returns [] before resolution completes and the targets afterwards', async () => {
    metaMock.mockImplementation(async id => makeMeta(id));
    const assistant = makeAssistant('a', ['b']);

    // Act: nothing resolved yet, but this kicks off the background lookup
    const before = getCachedSharedRoutableTargets(assistant);

    expect(before).toEqual([]);
    expect(metaMock).toHaveBeenCalledWith('b');

    // Act: wait for the shared resolution to finish
    await resolveSharedRoutableTargets(assistant);
    const after = getCachedSharedRoutableTargets(assistant);

    expect(after).toEqual([makeMeta('b')]);
    expect(metaMock).toHaveBeenCalledTimes(1);
  });

  it('excludes the assistant itself and deduplicates ids', async () => {
    metaMock.mockImplementation(async id => makeMeta(id));
    const assistant = makeAssistant('a', ['a', 'b', 'b']);

    const targets = await resolveSharedRoutableTargets(assistant);

    expect(metaMock).toHaveBeenCalledTimes(1);
    expect(metaMock).toHaveBeenCalledWith('b');
    expect(targets.map(t => t.id)).toEqual(['b']);
  });

  it('resolves to [] without lookups when no other ids are routable', async () => {
    const targets = await resolveSharedRoutableTargets(makeAssistant('a', ['a']));

    expect(targets).toEqual([]);
    expect(metaMock).not.toHaveBeenCalled();
  });
});
