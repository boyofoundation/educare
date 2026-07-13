import { describe, expect, it } from 'vitest';
import {
  executeCompute,
  MATH_COMPUTE_TOOL_NAME,
  MATH_COMPUTE_TOOL_SCHEMA,
} from './mathComputeService';

describe('mathComputeService', () => {
  it('publishes the documented compute schema', () => {
    // Arrange

    // Act
    const schema = MATH_COMPUTE_TOOL_SCHEMA;

    // Assert
    expect(MATH_COMPUTE_TOOL_NAME).toBe('compute');
    expect(schema).toMatchObject({
      type: 'object',
      required: ['expr'],
      properties: {
        expr: { type: 'string' },
        scope: {
          type: 'object',
          additionalProperties: { type: 'number' },
        },
      },
    });
  });

  it('evaluates a valid expression and formats the numeric result', async () => {
    // Arrange
    const args = { expr: 'sqrt(3^2 + 4^2)' };

    // Act
    const result = await executeCompute(args);

    // Assert
    expect(result).toMatchObject({ ok: true, result: '5' });
  });

  it('substitutes a numeric scope into the expression', async () => {
    // Arrange
    const args = { expr: 'x^2 + y', scope: { x: 3, y: 1 } };

    // Act
    const result = await executeCompute(args);

    // Assert
    expect(result).toMatchObject({ ok: true, result: '10' });
  });

  it('accepts scientific notation without treating it as implicit multiplication', async () => {
    // Act
    const result = await executeCompute({ expr: '2e3' });

    // Assert
    expect(result).toMatchObject({ ok: true, result: '2000' });
  });

  it.each([
    ['2x + 1', { x: 3 }],
    ['sqrt(4)x', { x: 3 }],
    ['(x + 1)(x - 1)', { x: 3 }],
    ['sin(x) cos(x)', { x: 1 }],
    ['x 2', { x: 3 }],
    ['(x + 1)2', { x: 3 }],
  ])(
    'returns a recoverable error instead of accepting implicit multiplication: %s',
    async (expr, scope) => {
      // Act
      const result = await executeCompute({ expr, scope });

      // Assert
      expect(result).toMatchObject({
        ok: false,
        recoverable: true,
        code: 'compute-evaluation-failed',
      });
      expect(result).toHaveProperty('error', expect.stringContaining('use * explicitly'));
    },
  );

  it.each([
    ['an empty expression', { expr: '' }],
    ['a non-string expression', { expr: 42 }],
    ['a non-numeric scope value', { expr: 'x + 1', scope: { x: '3' } }],
    ['a non-finite scope value', { expr: 'x + 1', scope: { x: Number.POSITIVE_INFINITY } }],
  ])('returns a recoverable error for %s', async (_caseName, args) => {
    // Arrange

    // Act
    const result = await executeCompute(args);

    // Assert
    expect(result).toMatchObject({ ok: false, recoverable: true });
    expect(result).toHaveProperty('error', expect.any(String));
  });

  it.each([
    ['import', { expr: 'import("evil", {})' }],
    ['createUnit', { expr: 'createUnit("evil", "1 m")' }],
  ])('rejects the %s sandbox escape without executing it', async (_name, args) => {
    // Arrange

    // Act
    const result = await executeCompute(args);

    // Assert
    expect(result).toMatchObject({ ok: false, recoverable: true });
    expect(result).toHaveProperty('error', expect.any(String));
  });
});
