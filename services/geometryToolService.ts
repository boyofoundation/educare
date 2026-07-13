import type { MathJsStatic } from 'mathjs';

export const DRAW_GEOMETRY_TOOL_NAME = 'draw_geometry';

export const DRAW_GEOMETRY_TOOL_DESCRIPTION =
  'Validate and draw a self-contained declarative geometry board. Read coordinates only from computed_points in the result.';

export const DRAW_GEOMETRY_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Short title displayed above the board.' },
    boundingbox: {
      type: 'array',
      description: '[xMin, yMax, xMax, yMin]',
      minItems: 4,
      maxItems: 4,
      items: { type: 'number' },
    },
    objects: {
      type: 'array',
      minItems: 1,
      items: {
        oneOf: [
          {
            type: 'object',
            properties: { kind: { const: 'point' } },
            required: ['kind', 'x', 'y'],
          },
          { type: 'object', properties: { kind: { const: 'line' } }, required: ['kind', 'points'] },
          {
            type: 'object',
            properties: { kind: { const: 'segment' } },
            required: ['kind', 'points'],
          },
          {
            type: 'object',
            properties: { kind: { const: 'circle' } },
            required: ['kind', 'center'],
          },
          {
            type: 'object',
            properties: { kind: { const: 'functiongraph' } },
            required: ['kind', 'expr'],
          },
          {
            type: 'object',
            properties: { kind: { const: 'implicit' } },
            required: ['kind', 'expr'],
          },
          {
            type: 'object',
            properties: { kind: { const: 'polygon' } },
            required: ['kind', 'points'],
          },
          {
            type: 'object',
            properties: { kind: { const: 'text' } },
            required: ['kind', 'x', 'y', 'text'],
          },
          {
            type: 'object',
            properties: { kind: { const: 'intersection' } },
            required: ['kind', 'sources'],
          },
        ],
      },
    },
  },
  required: ['title', 'boundingbox', 'objects'],
  additionalProperties: false,
} as const;

export type GeometryExpression = number | string;

interface GeometryObjectBase {
  id?: string;
  kind: GeometryObject['kind'];
}

export interface GeometryPoint extends GeometryObjectBase {
  kind: 'point';
  x: GeometryExpression;
  y: GeometryExpression;
  label?: string;
}

export interface GeometryLine extends GeometryObjectBase {
  kind: 'line';
  points: [string, string];
}

export interface GeometrySegment extends GeometryObjectBase {
  kind: 'segment';
  points: [string, string];
}

export interface GeometryCircle extends GeometryObjectBase {
  kind: 'circle';
  center: string;
  point?: string;
  radius?: GeometryExpression;
}

export interface GeometryFunctionGraph extends GeometryObjectBase {
  kind: 'functiongraph';
  expr: string;
}

export interface GeometryImplicit extends GeometryObjectBase {
  kind: 'implicit';
  expr: string;
}

export interface GeometryPolygon extends GeometryObjectBase {
  kind: 'polygon';
  points: string[];
}

export interface GeometryText extends GeometryObjectBase {
  kind: 'text';
  x: GeometryExpression;
  y: GeometryExpression;
  text: string;
}

export interface GeometryIntersection extends GeometryObjectBase {
  kind: 'intersection';
  sources: [string, string];
}

export type GeometryObject =
  | GeometryPoint
  | GeometryLine
  | GeometrySegment
  | GeometryCircle
  | GeometryFunctionGraph
  | GeometryImplicit
  | GeometryPolygon
  | GeometryText
  | GeometryIntersection;

export interface GeometryDoc {
  title: string;
  boundingbox: [number, number, number, number];
  objects: GeometryObject[];
}

export interface GeometryDiagnostic {
  index: number;
  field: string;
  message: string;
}

export interface GeometryValidationResult {
  errors: GeometryDiagnostic[];
}

let mathPromise: Promise<MathJsStatic> | undefined;

const getMath = (): Promise<MathJsStatic> => {
  mathPromise ??= import('mathjs').then(({ all, create }) => create(all, {}));
  return mathPromise;
};

const hasOwn = (value: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const isExpression = (value: unknown): value is GeometryExpression =>
  typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));

const validateExpression = async (
  errors: GeometryDiagnostic[],
  index: number,
  field: string,
  value: unknown,
): Promise<void> => {
  if (!isExpression(value)) {
    errors.push({
      index,
      field,
      message: `${field} must be a finite number or math.js expression.`,
    });
    return;
  }

  if (typeof value === 'string') {
    try {
      (await getMath()).parse(value);
    } catch (error) {
      errors.push({
        index,
        field,
        message: error instanceof Error ? error.message : `${field} is not a valid expression.`,
      });
    }
  }
};

const validateReferences = (
  errors: GeometryDiagnostic[],
  index: number,
  field: string,
  references: unknown,
  declaredIds: Set<string>,
  expectedLength?: number,
): void => {
  if (
    !Array.isArray(references) ||
    (expectedLength !== undefined && references.length !== expectedLength)
  ) {
    errors.push({
      index,
      field,
      message: `${field} must contain ${expectedLength ?? 'the required'} object ids.`,
    });
    return;
  }

  references.forEach((reference, referenceIndex) => {
    if (typeof reference !== 'string' || !declaredIds.has(reference)) {
      errors.push({
        index,
        field: `${field}[${referenceIndex}]`,
        message: `Unknown or forward reference: ${String(reference)}. Declare it with an id first.`,
      });
    }
  });
};

const validateObject = async (
  object: Record<string, unknown>,
  index: number,
  declaredIds: Set<string>,
  errors: GeometryDiagnostic[],
): Promise<void> => {
  const kind = object.kind;
  const id = object.id;

  if (id !== undefined && (typeof id !== 'string' || id.trim().length === 0)) {
    errors.push({ index, field: 'id', message: 'id must be a non-empty string when provided.' });
  } else if (typeof id === 'string') {
    if (declaredIds.has(id)) {
      errors.push({ index, field: 'id', message: `Duplicate object id: ${id}.` });
    } else {
      declaredIds.add(id);
    }
  }

  switch (kind) {
    case 'point':
      await validateExpression(errors, index, 'x', object.x);
      await validateExpression(errors, index, 'y', object.y);
      break;
    case 'line':
    case 'segment':
      validateReferences(errors, index, 'points', object.points, declaredIds, 2);
      break;
    case 'circle':
      validateReferences(errors, index, 'center', [object.center], declaredIds, 1);
      if (hasOwn(object, 'point')) {
        validateReferences(errors, index, 'point', [object.point], declaredIds, 1);
      }
      if (hasOwn(object, 'radius')) {
        await validateExpression(errors, index, 'radius', object.radius);
      }
      if (!hasOwn(object, 'point') && !hasOwn(object, 'radius')) {
        errors.push({ index, field: 'circle', message: 'circle requires either point or radius.' });
      }
      break;
    case 'functiongraph':
    case 'implicit':
      await validateExpression(errors, index, 'expr', object.expr);
      break;
    case 'polygon':
      validateReferences(errors, index, 'points', object.points, declaredIds);
      if (!Array.isArray(object.points) || object.points.length < 3) {
        errors.push({
          index,
          field: 'points',
          message: 'polygon requires at least three point ids.',
        });
      }
      break;
    case 'text':
      await validateExpression(errors, index, 'x', object.x);
      await validateExpression(errors, index, 'y', object.y);
      if (typeof object.text !== 'string') {
        errors.push({ index, field: 'text', message: 'text must be a string.' });
      }
      break;
    case 'intersection':
      validateReferences(errors, index, 'sources', object.sources, declaredIds, 2);
      break;
    default:
      errors.push({
        index,
        field: 'kind',
        message: `Unsupported geometry object kind: ${String(kind)}.`,
      });
  }
};

export const validateGeometryDoc = async (doc: unknown): Promise<GeometryValidationResult> => {
  const errors: GeometryDiagnostic[] = [];
  const record = asRecord(doc);
  if (!record) {
    return {
      errors: [{ index: -1, field: 'document', message: 'Geometry document must be an object.' }],
    };
  }

  if (typeof record.title !== 'string' || record.title.trim().length === 0) {
    errors.push({ index: -1, field: 'title', message: 'title must be a non-empty string.' });
  }

  if (
    !Array.isArray(record.boundingbox) ||
    record.boundingbox.length !== 4 ||
    !record.boundingbox.every(value => typeof value === 'number' && Number.isFinite(value))
  ) {
    errors.push({
      index: -1,
      field: 'boundingbox',
      message: 'boundingbox must be [xMin, yMax, xMax, yMin] with four finite numbers.',
    });
  } else {
    const [xMin, yMax, xMax, yMin] = record.boundingbox;
    if (xMin >= xMax || yMax <= yMin) {
      errors.push({
        index: -1,
        field: 'boundingbox',
        message: 'boundingbox must satisfy xMin < xMax and yMax > yMin.',
      });
    }
  }

  if (!Array.isArray(record.objects)) {
    errors.push({ index: -1, field: 'objects', message: 'objects must be an array.' });
    return { errors };
  }
  if (record.objects.length === 0) {
    errors.push({
      index: -1,
      field: 'objects',
      message: 'objects must contain at least one geometry object.',
    });
    return { errors };
  }

  const declaredIds = new Set<string>();
  for (const [index, object] of record.objects.entries()) {
    const objectRecord = asRecord(object);
    if (!objectRecord) {
      errors.push({ index, field: 'object', message: 'Geometry object must be an object.' });
      continue;
    }
    await validateObject(objectRecord, index, declaredIds, errors);
  }

  return { errors };
};

export type DrawGeometryResult =
  | {
      ok: true;
      errors: [];
      warnings: GeometryDiagnostic[];
      computed_points: Array<{ id: string; x: number; y: number }>;
      summary: string;
    }
  | {
      ok: false;
      recoverable: true;
      code: 'geometry-validation-failed' | 'geometry-render-failed';
      errors: GeometryDiagnostic[];
      warnings: GeometryDiagnostic[];
      computed_points: Array<{ id: string; x: number; y: number }>;
      summary: string;
    };

export const executeDrawGeometry = async (args: unknown): Promise<DrawGeometryResult> => {
  const validation = await validateGeometryDoc(args);
  if (validation.errors.length > 0) {
    return {
      ok: false,
      recoverable: true,
      code: 'geometry-validation-failed',
      errors: validation.errors,
      warnings: [],
      computed_points: [],
      summary: `Geometry validation failed: ${validation.errors[0]?.message ?? 'invalid document'}`,
    };
  }

  if (typeof document === 'undefined') {
    return {
      ok: false,
      recoverable: true,
      code: 'geometry-render-failed',
      errors: [
        {
          index: -1,
          field: 'document',
          message: 'Geometry rendering requires a browser document.',
        },
      ],
      warnings: [],
      computed_points: [],
      summary: 'Geometry rendering requires a browser document.',
    };
  }

  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;visibility:hidden;left:-10000px;top:-10000px;width:640px;height:480px;';
  document.body.append(probe);

  let renderResult:
    | Awaited<ReturnType<(typeof import('./geometryRenderer'))['renderGeometryDoc']>>
    | undefined;
  try {
    const { renderGeometryDoc } = await import('./geometryRenderer');
    renderResult = await renderGeometryDoc(probe, args as GeometryDoc);
    if (renderResult.errors.length > 0) {
      return {
        ok: false,
        recoverable: true,
        code: 'geometry-render-failed',
        errors: renderResult.errors,
        warnings: renderResult.warnings,
        computed_points: renderResult.computedPoints,
        summary: `Geometry rendering failed: ${renderResult.errors[0]?.message ?? 'unknown error'}`,
      };
    }

    return {
      ok: true,
      errors: [],
      warnings: renderResult.warnings,
      computed_points: renderResult.computedPoints,
      summary:
        renderResult.warnings.length > 0
          ? `Geometry drawn with ${renderResult.warnings.length} warning(s).`
          : 'Geometry drawn successfully.',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      recoverable: true,
      code: 'geometry-render-failed',
      errors: [{ index: -1, field: 'renderer', message }],
      warnings: [],
      computed_points: [],
      summary: `Geometry rendering failed: ${message}`,
    };
  } finally {
    renderResult?.destroy();
    probe.remove();
  }
};
