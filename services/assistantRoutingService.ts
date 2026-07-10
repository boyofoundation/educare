import type { Assistant, RouteProposal } from '../types';

export const ROUTE_TOOL_NAME = 'routeToAssistant';
export type RoutableTarget = Pick<Assistant, 'id' | 'name' | 'description'>;
const clamp = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

export const buildRouteToAssistantTool = (targets: RoutableTarget[]) => ({
  name: ROUTE_TOOL_NAME,
  description:
    'Propose a user-confirmed handoff to a more suitable assistant. Do not switch assistants yourself.',
  parameters: {
    type: 'object',
    properties: {
      targetAssistantId: { type: 'string', enum: targets.map(t => t.id) },
      reason: { type: 'string' },
      handoffSummary: { type: 'string' },
    },
    required: ['targetAssistantId', 'reason', 'handoffSummary'],
  },
});

export const buildRoutingSystemPrompt = (targets: RoutableTarget[]): string =>
  `Use ${ROUTE_TOOL_NAME} only when the question is clearly outside your specialty. It creates a proposal; never claim the user has switched. Handoff summaries may include only the user's request and useful attempts. Available destinations: ${targets.map(t => `${t.name} (${t.description})`).join('; ')}.`;

export const validateRouteCall = (
  args: unknown,
  targets: RoutableTarget[],
  sourceAssistantId: string,
  sourceSessionId?: string | null,
):
  | { ok: true; proposal: RouteProposal }
  | { ok: false; recoverable: true; code: string; message: string } => {
  const input = (args ?? {}) as Record<string, unknown>;
  const targetAssistantId = clamp(input.targetAssistantId, 200);
  const target = targets.find(item => item.id === targetAssistantId);
  if (!target) {
    return {
      ok: false,
      recoverable: true,
      code: 'route-target-not-allowed',
      message: 'That assistant is not available for routing in this conversation.',
    };
  }
  const reason = clamp(input.reason, 200);
  const handoffSummary = clamp(input.handoffSummary, 2000);
  if (!reason || !handoffSummary) {
    return {
      ok: false,
      recoverable: true,
      code: 'route-invalid-arguments',
      message: 'A routing proposal requires a reason and handoff summary.',
    };
  }
  return {
    ok: true,
    proposal: {
      targetAssistantId,
      targetAssistantName: target.name,
      reason,
      handoffSummary,
      sourceAssistantId,
      sourceSessionId: sourceSessionId ?? '',
      status: 'pending',
      createdAt: Date.now(),
    },
  };
};

export const resolveRoutableTargets = (
  assistant: Assistant,
  assistants: Assistant[],
): RoutableTarget[] => {
  const ids = new Set(assistant.routableAssistantIds ?? []);
  return assistants
    .filter(item => item.id !== assistant.id && ids.has(item.id))
    .map(({ id, name, description }) => ({ id, name, description }));
};
