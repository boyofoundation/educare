import type { MockInstance } from 'vitest';
import type { FinishReason } from '../../types';

/**
 * Shared mock surface that each provider's contract-case setup consumes.
 * T1 (OpenAI-compatible) wires `fetch` (vi.spyOn(globalThis, 'fetch')) and
 * `executeTool` (vi.fn()) directly. T2 (anthropic/gemini) wraps their own
 * provider-specific transport inside an adapter exposing the same shape so
 * the same contract cases can drive their suites.
 *
 * Typed as `MockInstance` (not the generic `Mock<Procedure>`) so that both
 * `vi.fn()` (returns `MockInstance<Procedure>`) and `vi.spyOn(globalThis,'fetch')`
 * (returns a fetch-signature `MockInstance`) satisfy the field without casts.
 */
export interface ToolLoopContractMock {
  fetch: MockInstance;
  executeTool: MockInstance;
}

/**
 * A single shared tool-loop termination contract case.
 *
 * T1 owns this table; T2 mirrors it by reproducing each `id` / `scenario` /
 * `expectedFinishReason` with a provider-specific `setup`. The shared shape
 * lets the wave-gate assert that every provider converges on the same
 * FinishReason semantics (G13/G17).
 */
export interface ToolLoopContractCase {
  id: string;
  scenario: string;
  /** Configure the provider mocks (fetch + executeTool) to reproduce the case. */
  setup: (mock: ToolLoopContractMock) => void;
  expectedFinishReason: FinishReason;
  expectedToolRoundCount?: number;
  chatParamsOverride?: {
    maxToolRounds?: number;
  };
  requiresProviderDefaultRoundAssertion?: boolean;
  /** Always false today; the harness must never throw on these terminals (G13). */
  shouldThrow?: false;
}

const createJsonResponse = (payload: unknown) =>
  new globalThis.Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const buildToolCallResponse = (
  toolCallId: string,
  toolName: string,
  args: Record<string, unknown>,
) => ({
  choices: [
    {
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: toolCallId,
            type: 'function',
            function: {
              name: toolName,
              arguments: JSON.stringify(args),
            },
          },
        ],
      },
    },
  ],
  usage: { prompt_tokens: 1, completion_tokens: 1 },
});

const buildTextResponse = (text: string) => ({
  choices: [{ message: { role: 'assistant', content: text } }],
  usage: { prompt_tokens: 1, completion_tokens: 1 },
});

const RECOVERABLE_SEARCH_ERROR = {
  ok: false,
  recoverable: true,
  code: 'search-temporary-unavailable',
  message: 'Search index is warming up.',
  guidance: 'Retry the same search in a moment.',
};

/**
 * Shared contract cases. Add provider-agnostic cases here; mirror the ids in
 * T2 (anthropic/gemini) suites. See T1 task spec ①.
 */
export const TOOL_LOOP_CONTRACT_CASES: ToolLoopContractCase[] = [
  {
    id: 'budget-exhausted-no-throw',
    scenario:
      'Model keeps issuing tool calls past the round budget; harness must yield finishReason=tool-budget-exhausted and NOT throw (G13).',
    setup: ({ fetch }) => {
      fetch.mockImplementation(() =>
        Promise.resolve(
          createJsonResponse(buildToolCallResponse('loop-call', 'search_docs', { query: 'loop' })),
        ),
      );
    },
    expectedFinishReason: 'tool-budget-exhausted',
    shouldThrow: false,
  },
  {
    id: 'per-call-max-tool-rounds-override',
    scenario:
      'Nested callers can clamp the tool budget per request; maxToolRounds=2 must stop at round 2 even when provider defaults are higher.',
    setup: ({ fetch }) => {
      fetch.mockImplementation(() =>
        Promise.resolve(
          createJsonResponse(
            buildToolCallResponse('loop-call', 'search_docs', { query: 'override' }),
          ),
        ),
      );
    },
    expectedFinishReason: 'tool-budget-exhausted',
    expectedToolRoundCount: 2,
    chatParamsOverride: {
      maxToolRounds: 2,
    },
    shouldThrow: false,
  },
  {
    id: 'provider-default-max-tool-rounds',
    scenario:
      'When maxToolRounds is omitted, the tool loop must fall back to the provider default/configured round budget instead of silently using the nested override path.',
    setup: ({ fetch }) => {
      fetch.mockImplementation(() =>
        Promise.resolve(
          createJsonResponse(
            buildToolCallResponse('loop-call', 'search_docs', { query: 'default-budget' }),
          ),
        ),
      );
    },
    expectedFinishReason: 'tool-budget-exhausted',
    requiresProviderDefaultRoundAssertion: true,
    shouldThrow: false,
  },
  {
    id: 'pure-text-complete',
    scenario:
      'Model responds with pure text (no tool calls); harness must yield finishReason=complete (G13).',
    setup: ({ fetch }) => {
      fetch.mockResolvedValue(createJsonResponse(buildTextResponse('done')));
    },
    expectedFinishReason: 'complete',
    shouldThrow: false,
  },
  {
    id: 'stop-route',
    scenario:
      'Recoverable tool error escalates to stop-route after 3 repeated attempts; harness must yield finishReason=stop-route.',
    setup: ({ fetch, executeTool }) => {
      // Each fetch returns a tool call so the loop keeps engaging the tool.
      fetch.mockImplementation(() =>
        Promise.resolve(
          createJsonResponse(buildToolCallResponse('call-1', 'search_docs', { query: 'q' })),
        ),
      );
      // Tool always fails with the same recoverable error; escalation kicks in
      // at attempt >= 3 (buildEscalatedToolResult → loopAction='stop-route').
      executeTool.mockResolvedValue(RECOVERABLE_SEARCH_ERROR);
    },
    expectedFinishReason: 'stop-route',
    shouldThrow: false,
  },
];
