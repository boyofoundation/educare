import { describe, expect, it } from 'vitest';
import { F4_MATERIAL_FIXTURES, F4_QUERY_LABELS, F4_RETRIEVAL_CHUNKS } from './f4RetrievalFixtures';
import { evaluateF4Retrieval, measureF4Performance } from './f4RetrievalBenchmark';

describe('F4 retrieval fixtures', () => {
  it('contains the required bilingual material/query fixture sizes', () => {
    expect(F4_MATERIAL_FIXTURES).toHaveLength(20);
    expect(F4_QUERY_LABELS).toHaveLength(50);
    expect(F4_QUERY_LABELS.filter(label => !label.answerable)).toHaveLength(1);
  });

  it('records a reproducible lexical baseline without fabricating no-answer sources', () => {
    const evaluation = evaluateF4Retrieval(F4_RETRIEVAL_CHUNKS, F4_QUERY_LABELS);

    expect(evaluation.queryCount).toBe(50);
    expect(evaluation.answerableQueryCount).toBe(49);
    expect(evaluation.noAnswerFalsePositives).toBe(0);
    expect(evaluation.top5Accuracy).toBeGreaterThanOrEqual(evaluation.targetTop5Accuracy);
    expect(evaluation.meetsTarget).toBe(true);
  });

  it('exposes the fixed performance dimensions without requiring a large test pool', async () => {
    const measurement = await measureF4Performance({
      chunkCount: 100,
      sessionCount: 100,
      iterations: 5,
    });

    expect(measurement).toMatchObject({
      chunkCount: 100,
      sessionCount: 100,
      sessionMessageCount: 2_000,
      cancelP95Ms: expect.any(Number),
      targets: { coldP95Ms: 300, hotP95Ms: 300, cancelP95Ms: 1_000 },
    });
  });
});
