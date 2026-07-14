import type { MathJsStatic } from 'mathjs';

export const MATH_COMPUTE_TOOL_NAME = 'compute';

export const MATH_COMPUTE_TOOL_DESCRIPTION =
  'Evaluate a mathematical expression precisely. Use standard math.js syntax such as 2*x, ^ for powers, and explicit function calls.';

export const MATH_COMPUTE_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    expr: {
      type: 'string',
      description: 'A mathematical expression written with math.js syntax.',
    },
    scope: {
      type: 'object',
      description: 'Optional numeric variable values used by the expression.',
      additionalProperties: { type: 'number' },
    },
  },
  required: ['expr'],
  additionalProperties: false,
} as const;

export const MATH_TOOLS_SYSTEM_PROMPT = `
When math tools are available, use compute before stating any concrete numeric result. Write multiplication explicitly: use 2*x, not 2x; use ^ for powers; and state logarithm bases explicitly. The draw_geometry tool creates a self-contained visual math board, including geometry, charts, and basic shapes. For implicit geometry, expr represents F(x,y)=0. Charts use kind:'chart' with chartStyle:'bar'|'line'|'pie'|'scatter', values, and optional x, labels, colors, center, radius, width, or direction. Use equal-length x and values for line/scatter charts; pie values must be non-negative with at least one positive value. Basic visual shapes include arrow (point references), rectangle (x/y are the lower-left corner), ellipse (x/y are the center), and arc/sector (angles are in radians). If a compute or draw_geometry result reports an error or warning, correct the declaration and retry instead of continuing with unsupported claims. Prefer several small diagrams, each with its own explanation, over one crowded diagram. Read intersection coordinates only from computed_points; do not calculate them mentally. Every draw_geometry call must be self-contained: fully declare every object needed for that board, including objects repeated from an earlier board. For each object, use the exact property 'kind' (never 'type') and use 'id' for references; point annotations belong in 'label' (never 'name').
`.trim();

export interface ComputeArgs {
  expr?: unknown;
  scope?: unknown;
}

export type ComputeResult =
  | { ok: true; result: string; summary: string }
  | {
      ok: false;
      recoverable: true;
      code: 'compute-invalid-input' | 'compute-evaluation-failed';
      error: string;
      summary: string;
    };

let mathPromise: Promise<MathJsStatic> | undefined;

const getMath = (): Promise<MathJsStatic> => {
  if (!mathPromise) {
    mathPromise = import('mathjs').then(({ all, create }) => {
      const math = create(all, {});
      const safeEvaluate = math.evaluate.bind(math);
      const safeParse = math.parse.bind(math);
      const blocked = (name: string): never => {
        throw new Error(`${name} is disabled in the compute sandbox.`);
      };

      math.import(
        {
          import: () => blocked('import'),
          createUnit: () => blocked('createUnit'),
          evaluate: () => blocked('evaluate'),
          parse: () => blocked('parse'),
          simplify: () => blocked('simplify'),
        },
        { override: true },
      );

      // Retain the private evaluator captured before public escape hatches were disabled.
      return Object.assign(math, { __safeEvaluate: safeEvaluate, __safeParse: safeParse });
    });
  }

  return mathPromise;
};

type SandboxedMath = MathJsStatic & {
  __safeEvaluate(expression: string, scope?: Record<string, number>): unknown;
  __safeParse(expression: string): unknown;
};

const invalidInput = (error: string): Extract<ComputeResult, { ok: false }> => ({
  ok: false,
  recoverable: true,
  code: 'compute-invalid-input',
  error,
  summary: error,
});

const isComputeFailure = (
  value: Record<string, number> | ComputeResult,
): value is Extract<ComputeResult, { ok: false }> => 'ok' in value && value.ok === false;

const validateScope = (
  scope: unknown,
): Record<string, number> | Extract<ComputeResult, { ok: false }> => {
  if (scope === undefined) {
    return {};
  }

  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
    return invalidInput('scope must be an object containing finite numeric values.');
  }

  const numericScope: Record<string, number> = {};
  for (const [name, value] of Object.entries(scope)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return invalidInput(`scope.${name} must be a finite number.`);
    }
    numericScope[name] = value;
  }

  return numericScope;
};

const hasImplicitMultiplication = (value: unknown, seen = new WeakSet<object>()): boolean => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  if (seen.has(value)) {
    return false;
  }
  seen.add(value);

  const node = value as { type?: unknown; implicit?: unknown };
  if (node.type === 'OperatorNode' && node.implicit === true) {
    return true;
  }

  return Object.values(value as Record<string, unknown>).some(child =>
    hasImplicitMultiplication(child, seen),
  );
};

export const executeCompute = async (args: ComputeArgs): Promise<ComputeResult> => {
  if (typeof args.expr !== 'string' || args.expr.trim().length === 0) {
    return invalidInput('expr must be a non-empty string.');
  }

  const scope = validateScope(args.scope);
  if (isComputeFailure(scope)) {
    return scope;
  }

  try {
    const math = (await getMath()) as SandboxedMath;
    if (hasImplicitMultiplication(math.__safeParse(args.expr))) {
      return {
        ok: false,
        recoverable: true,
        code: 'compute-evaluation-failed',
        error: 'Implicit multiplication is not supported; use * explicitly (for example, 2*x).',
        summary: 'Implicit multiplication is not supported; use * explicitly (for example, 2*x).',
      };
    }

    const result = math.__safeEvaluate(args.expr, scope);
    const formatted = math.format(result, { precision: 14 });

    return {
      ok: true,
      result: formatted,
      summary: `Computed ${formatted}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      recoverable: true,
      code: 'compute-evaluation-failed',
      error: message,
      summary: message,
    };
  }
};
