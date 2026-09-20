import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildChatDraftOwnerId,
  buildOriginalHistoryMetadata,
  clearWorkspaceDraft,
  ensureOriginalHistoryMetadata,
  exportWorkspaceDrafts,
  importWorkspaceDrafts,
  LEGACY_CHAT_DRAFT_STORAGE_KEY,
  readWorkspaceDraft,
  resetWorkspaceDraftMemory,
  WORKSPACE_DRAFT_STORAGE_KEY,
  writeWorkspaceDraft,
} from './workspaceDraftService';
import type { ChatSession } from '../types';

describe('workspaceDraftService', () => {
  const values = new Map<string, string>();
  const assistantDraft = {
    id: 'assistant-a',
    name: 'Draft assistant',
    description: 'A valid local draft',
    systemPrompt: 'Be useful.',
    ragChunks: [],
    starterPrompts: [],
    createdAt: 1,
  };

  beforeEach(() => {
    values.clear();
    resetWorkspaceDraftMemory();
    vi.mocked(window.localStorage.getItem).mockImplementation(key => values.get(key) ?? null);
    vi.mocked(window.localStorage.setItem).mockImplementation((key, value) => {
      values.set(key, value);
    });
    vi.mocked(window.localStorage.removeItem).mockImplementation(key => {
      values.delete(key);
    });
  });

  it('isolates chat drafts by assistant and session and persists them after the debounce caller flushes', () => {
    const firstOwner = buildChatDraftOwnerId('assistant-a', 'session-a');
    const secondOwner = buildChatDraftOwnerId('assistant-b', 'session-a');

    expect(writeWorkspaceDraft('chat', firstOwner, 'first')).toBe('persistent');
    expect(writeWorkspaceDraft('chat', secondOwner, 'second')).toBe('persistent');

    expect(readWorkspaceDraft<string>('chat', firstOwner).value).toBe('first');
    expect(readWorkspaceDraft<string>('chat', secondOwner).value).toBe('second');
    expect(readWorkspaceDraft<string>('chat', firstOwner).mode).toBe('persistent');
  });

  it('keeps a session fallback and tombstone when storage writes or clears fail', () => {
    const owner = buildChatDraftOwnerId('assistant-a', 'session-a');
    vi.mocked(window.localStorage.setItem).mockImplementation(() => {
      throw new Error('quota exceeded');
    });

    expect(writeWorkspaceDraft('chat', owner, 'memory draft')).toBe('session');
    expect(readWorkspaceDraft<string>('chat', owner)).toEqual(
      expect.objectContaining({ value: 'memory draft', mode: 'session' }),
    );

    values.set(
      LEGACY_CHAT_DRAFT_STORAGE_KEY,
      JSON.stringify({ [owner]: 'durable draft that must not resurrect' }),
    );
    vi.mocked(window.localStorage.removeItem).mockImplementation(() => {
      throw new Error('storage blocked');
    });
    expect(clearWorkspaceDraft('chat', owner)).toBe('session');
    expect(readWorkspaceDraft<string>('chat', owner).value).toBeUndefined();
  });

  it('reads the pre-service chat draft format during migration', () => {
    const owner = buildChatDraftOwnerId('assistant-a', 'session-a');
    values.set(LEGACY_CHAT_DRAFT_STORAGE_KEY, JSON.stringify({ [owner]: 'legacy draft' }));

    expect(readWorkspaceDraft<string>('chat', owner)).toEqual(
      expect.objectContaining({ value: 'legacy draft', mode: 'persistent' }),
    );
  });

  it('exports and imports versioned structured entries', () => {
    const chatOwner = buildChatDraftOwnerId('assistant-a', 'session-a');
    writeWorkspaceDraft('chat', chatOwner, 'chat draft', 10);
    writeWorkspaceDraft('assistant', 'assistant-a', assistantDraft, 20);

    const archive = exportWorkspaceDrafts();
    expect(archive).toMatchObject({
      format: 'educare-workspace-drafts',
      schemaVersion: 1,
    });
    expect(archive.entries).toHaveLength(2);

    values.clear();
    resetWorkspaceDraftMemory();
    expect(importWorkspaceDrafts(archive)).toEqual({
      imported: 2,
      skipped: 0,
      mode: 'persistent',
    });
    expect(readWorkspaceDraft<string>('chat', chatOwner).value).toBe('chat draft');
    expect(readWorkspaceDraft<{ name: string }>('assistant', 'assistant-a').value).toEqual(
      expect.objectContaining({ name: 'Draft assistant' }),
    );
    expect(values.has(WORKSPACE_DRAFT_STORAGE_KEY)).toBe(true);
  });

  it('rejects malformed archives before writing', () => {
    expect(() =>
      importWorkspaceDrafts({ format: 'educare-workspace-drafts', entries: [] }),
    ).toThrow(/Invalid workspace draft archive/);
    expect(values.has(WORKSPACE_DRAFT_STORAGE_KEY)).toBe(false);
  });

  it('skips malformed values by kind without exposing them to callers', () => {
    const chatOwner = buildChatDraftOwnerId('assistant-a', 'invalid-chat');
    const assistantOwner = 'assistant-a';
    const malformedEntries = [
      {
        schemaVersion: 1,
        kind: 'chat',
        ownerId: chatOwner,
        value: { not: 'a string' },
        updatedAt: 1,
      },
      {
        schemaVersion: 1,
        kind: 'assistant',
        ownerId: assistantOwner,
        value: { name: 'missing required fields' },
        updatedAt: 2,
      },
    ];
    values.set(
      WORKSPACE_DRAFT_STORAGE_KEY,
      JSON.stringify({ schemaVersion: 1, entries: malformedEntries }),
    );

    expect(() => readWorkspaceDraft('chat', chatOwner)).not.toThrow();
    expect(readWorkspaceDraft('chat', chatOwner).value).toBeUndefined();
    expect(readWorkspaceDraft('assistant', assistantOwner).value).toBeUndefined();

    const result = importWorkspaceDrafts({
      format: 'educare-workspace-drafts',
      schemaVersion: 1,
      exportedAt: 3,
      entries: [
        ...malformedEntries,
        {
          schemaVersion: 1,
          kind: 'assistant',
          ownerId: 'new',
          value: assistantDraft,
          updatedAt: 3,
        },
      ],
    });
    expect(result).toEqual({ imported: 1, skipped: 2, mode: 'persistent' });
  });

  it('replaces legacy and memory-only owners, including failed-write tombstones', () => {
    const oldChatOwner = buildChatDraftOwnerId('assistant-a', 'old-chat');
    const oldMemoryOwner = 'assistant-old-memory';
    const newChatOwner = buildChatDraftOwnerId('assistant-a', 'new-chat');
    writeWorkspaceDraft('chat', oldChatOwner, 'old durable');
    values.set(LEGACY_CHAT_DRAFT_STORAGE_KEY, JSON.stringify({ [oldChatOwner]: 'old legacy' }));

    vi.mocked(window.localStorage.setItem).mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    expect(writeWorkspaceDraft('assistant', oldMemoryOwner, assistantDraft)).toBe('session');

    const result = importWorkspaceDrafts(
      {
        format: 'educare-workspace-drafts',
        schemaVersion: 1,
        exportedAt: 4,
        entries: [
          {
            schemaVersion: 1,
            kind: 'chat',
            ownerId: newChatOwner,
            value: 'new draft',
            updatedAt: 4,
          },
        ],
      },
      { replace: true },
    );

    expect(result.mode).toBe('session');
    expect(readWorkspaceDraft('chat', oldChatOwner).value).toBeUndefined();
    expect(readWorkspaceDraft('assistant', oldMemoryOwner).value).toBeUndefined();
    expect(readWorkspaceDraft('chat', newChatOwner).value).toBe('new draft');
  });

  it('preserves repeated legacy messages and marks compacted legacy history unrecoverable', () => {
    const repeatedMessage = { role: 'user' as const, content: 'repeat' };
    const baseSession: ChatSession = {
      id: 'history-session',
      assistantId: 'assistant-a',
      title: 'History',
      messages: [repeatedMessage, repeatedMessage],
      createdAt: 1,
      tokenCount: 0,
    };

    const originalHistory = buildOriginalHistoryMetadata(baseSession);
    expect(originalHistory.messages).toHaveLength(2);

    const nextHistory = buildOriginalHistoryMetadata({
      ...baseSession,
      originalHistory,
      messages: [repeatedMessage, repeatedMessage, repeatedMessage],
    });
    expect(nextHistory.messages).toHaveLength(3);

    const migrated = ensureOriginalHistoryMetadata({
      ...baseSession,
      messages: [{ role: 'model', content: 'retained tail' }],
      compactContext: {
        type: 'compact',
        content: 'legacy summary',
        tokenCount: 10,
        compressedFromRounds: 2,
        compressedFromMessages: 4,
        createdAt: new Date(1).toISOString(),
        version: '1.0',
      },
    });
    expect(migrated.originalHistory).toMatchObject({
      completeness: 'unrecoverable',
      unrecoverableMessageCount: 4,
      messages: [{ role: 'model', content: 'retained tail' }],
    });
  });
});
