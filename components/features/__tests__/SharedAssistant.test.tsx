import { render, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import React from 'react';
import SharedAssistant from '../SharedAssistant';
import { AppContext } from '../../core/useAppContext';
import type { AppContextValue, AppState } from '../../core/AppContext.types';
import type { Assistant, ChatSession } from '../../../types';

const mockTurso = vi.hoisted(() => ({
  getAssistantFromTurso: vi.fn(),
}));
const mockProviderRegistry = vi.hoisted(() => ({
  initializeProviders: vi.fn().mockResolvedValue(undefined),
  isLLMAvailable: vi.fn().mockReturnValue(true),
}));

vi.mock('../../../services/tursoService', () => mockTurso);
vi.mock('../../../services/providerRegistry', () => mockProviderRegistry);

const createTursoAssistant = (id: string): Assistant => ({
  id,
  name: `Assistant ${id}`,
  description: 'Shared assistant',
  systemPrompt: 'You are a shared assistant.',
  ragChunks: [],
  createdAt: 1000,
});

const createPendingHandoffSession = (assistantId: string): ChatSession => ({
  id: 'shared_handoff-1',
  assistantId,
  title: '與 目標助理 聊天',
  messages: [],
  createdAt: 1700000000000,
  tokenCount: 0,
  handoffContext: {
    fromAssistantId: 'assistant-source',
    fromAssistantName: '來源助理',
    reason: '使用者需要微積分協助',
    summary: '使用者詢問微積分極限問題',
    sourceSessionId: 'session-source',
    createdAt: 1700000000000,
  },
});

let logSpy: ReturnType<typeof vi.spyOn>;

beforeAll(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

beforeEach(() => {
  vi.clearAllMocks();
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  mockTurso.getAssistantFromTurso.mockImplementation(async (id: string) =>
    createTursoAssistant(id),
  );
  mockProviderRegistry.initializeProviders.mockResolvedValue(undefined);
  mockProviderRegistry.isLLMAvailable.mockReturnValue(true);
});

// Renders SharedAssistant inside a stubbed AppContext provider.
const setup = (assistantId: string, pendingHandoffSession: ChatSession | null = null) => {
  const dispatch = vi.fn();
  const contextValue = {
    state: { pendingHandoffSession } as AppState,
    dispatch,
    actions: {},
  } as unknown as AppContextValue;

  const ui = (id: string) => (
    <AppContext.Provider value={contextValue}>
      <SharedAssistant assistantId={id} />
    </AppContext.Provider>
  );

  const renderResult = render(ui(assistantId));
  return { dispatch, renderResult, ui };
};

const getDispatchedSession = (dispatch: ReturnType<typeof vi.fn>): ChatSession => {
  const call = dispatch.mock.calls.find(([action]) => action.type === 'SET_CURRENT_SESSION');
  expect(call).toBeDefined();
  return call![0].payload as ChatSession;
};

describe('SharedAssistant', () => {
  describe('pending handoff session adoption', () => {
    it('adopts the pending handoff session when its assistantId matches and clears it', async () => {
      const pending = createPendingHandoffSession('assistant-a');
      const { dispatch } = setup('assistant-a', pending);

      await waitFor(() => {
        expect(dispatch).toHaveBeenCalledWith({
          type: 'SET_CURRENT_SESSION',
          payload: pending,
        });
      });

      // The adopted session is the pending one, handoff context intact
      const session = getDispatchedSession(dispatch);
      expect(session.id).toBe('shared_handoff-1');
      expect(session.handoffContext).toEqual(pending.handoffContext);

      // Pending handoff session was cleared after adoption
      expect(dispatch).toHaveBeenCalledWith({
        type: 'SET_PENDING_HANDOFF_SESSION',
        payload: null,
      });
    });

    it('creates a fresh shared session when the pending handoff targets a different assistant', async () => {
      const pending = createPendingHandoffSession('assistant-other');
      const { dispatch } = setup('assistant-a', pending);

      await waitFor(() => {
        expect(dispatch).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'SET_CURRENT_SESSION' }),
        );
      });

      const session = getDispatchedSession(dispatch);
      expect(session.id).toMatch(/^shared_/);
      expect(session.id).not.toBe(pending.id);
      expect(session.assistantId).toBe('assistant-a');
      expect(session.messages).toEqual([]);
      expect(session.handoffContext).toBeUndefined();

      // The unrelated pending session is left untouched
      expect(dispatch).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'SET_PENDING_HANDOFF_SESSION' }),
      );
    });
  });

  describe('assistantId change without remount (regression)', () => {
    it('reloads from Turso when assistantId changes instead of skipping as duplicate', async () => {
      const { dispatch, renderResult, ui } = setup('assistant-a');

      // Wait for the first load to fully complete
      await waitFor(() => {
        expect(mockTurso.getAssistantFromTurso).toHaveBeenCalledTimes(1);
        expect(dispatch).toHaveBeenCalledWith({ type: 'SET_LOADING', payload: false });
      });
      expect(mockTurso.getAssistantFromTurso).toHaveBeenNthCalledWith(1, 'assistant-a');

      // Route change: same mounted component, new assistantId
      renderResult.rerender(ui('assistant-b'));

      await waitFor(() => {
        expect(mockTurso.getAssistantFromTurso).toHaveBeenCalledTimes(2);
      });
      expect(mockTurso.getAssistantFromTurso).toHaveBeenNthCalledWith(2, 'assistant-b');

      // The second assistant was actually applied
      await waitFor(() => {
        expect(dispatch).toHaveBeenCalledWith({
          type: 'SET_CURRENT_ASSISTANT',
          payload: expect.objectContaining({ id: 'assistant-b' }),
        });
      });

      // The guard must not have short-circuited the reload
      const skippedDuplicate = logSpy.mock.calls.some(args =>
        String(args[0]).includes('Skipping duplicate load'),
      );
      expect(skippedDuplicate).toBe(false);
    });
  });
});
