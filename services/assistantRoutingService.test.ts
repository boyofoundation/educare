import { describe, expect, it } from 'vitest';
import {
  buildRouteToAssistantTool,
  buildRoutingSystemPrompt,
  resolveRoutableTargets,
  validateRouteCall,
} from './assistantRoutingService';
import type { Assistant } from '../types';

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
