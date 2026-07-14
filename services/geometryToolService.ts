import type { MathJsStatic } from 'mathjs';

export const DRAW_GEOMETRY_TOOL_NAME = 'draw_geometry';

export const DRAW_GEOMETRY_TOOL_DESCRIPTION =
  'Validate and draw a self-contained declarative math visual board with geometry, charts, and basic shapes. Read intersection coordinates only from computed_points in the result.';

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
            properties: {
              id: { type: 'string' },
              kind: { enum: ['point'] },
              x: { anyOf: [{ type: 'number' }, { type: 'string' }] },
              y: { anyOf: [{ type: 'number' }, { type: 'string' }] },
              label: { type: 'string' },
            },
            required: ['kind', 'x', 'y'],
          },
          {
            type: 'object',
            properties: {
              id: { type: 'string' },
              kind: { enum: ['line'] },
              points: {
                type: 'array',
                items: { type: 'string' },
                minItems: 2,
                maxItems: 2,
              },
            },
            required: ['kind', 'points'],
          },
          {
            type: 'object',
            properties: {
              id: { type: 'string' },
              kind: { enum: ['segment'] },
              points: {
                type: 'array',
                items: { type: 'string' },
                minItems: 2,
                maxItems: 2,
              },
            },
            required: ['kind', 'points'],
          },
          {
            type: 'object',
            properties: {
              id: { type: 'string' },
              kind: { enum: ['circle'] },
              center: { type: 'string' },
              point: { type: 'string' },
              radius: { anyOf: [{ type: 'number' }, { type: 'string' }] },
            },
            required: ['kind', 'center'],
          },
          {
            type: 'object',
            properties: {
              id: { type: 'string' },
              kind: { enum: ['functiongraph'] },
              expr: { type: 'string' },
            },
            required: ['kind', 'expr'],
          },
          {
            type: 'object',
            properties: {
              id: { type: 'string' },
              kind: { enum: ['implicit'] },
              expr: { type: 'string' },
            },
            required: ['kind', 'expr'],
          },
          {
            type: 'object',
            properties: {
              id: { type: 'string' },
              kind: { enum: ['polygon'] },
              points: {
                type: 'array',
                items: { type: 'string' },
                minItems: 3,
              },
            },
            required: ['kind', 'points'],
          },
          {
            type: 'object',
            properties: {
              id: { type: 'string' },
              kind: { enum: ['text'] },
              x: { anyOf: [{ type: 'number' }, { type: 'string' }] },
              y: { anyOf: [{ type: 'number' }, { type: 'string' }] },
              text: { type: 'string' },
            },
            required: ['kind', 'x', 'y', 'text'],
          },
          {
            type: 'object',
            properties: {
              id: { type: 'string' },
              kind: { enum: ['intersection'] },
              sources: {
                type: 'array',
                items: { type: 'string' },
                minItems: 2,
                maxItems: 2,
              },
            },
            required: ['kind', 'sources'],
          },
          {
            type: 'object',
            properties: {
              id: { type: 'string' },
              kind: { enum: ['chart'] },
              chartStyle: { enum: ['bar', 'line', 'pie', 'scatter'] },
              values: {
                type: 'array',
                items: { anyOf: [{ type: 'number' }, { type: 'string' }] },
              },
              x: {
                type: 'array',
                items: { anyOf: [{ type: 'number' }, { type: 'string' }] },
              },
              labels: { type: 'array', items: { type: 'string' } },
              colors: { type: 'array', items: { type: 'string' } },
              center: {
                type: 'array',
                items: { anyOf: [{ type: 'number' }, { type: 'string' }] },
              },
              radius: { anyOf: [{ type: 'number' }, { type: 'string' }] },
              width: { type: 'number' },
              direction: { enum: ['horizontal', 'vertical'] },
            },
            required: ['kind', 'chartStyle', 'values'],
          },
          {
            type: 'object',
            properties: {
              id: { type: 'string' },
              kind: { enum: ['arrow'] },
              points: {
                type: 'array',
                items: { type: 'string' },
                minItems: 2,
                maxItems: 2,
              },
            },
            required: ['kind', 'points'],
          },
          {
            type: 'object',
            properties: {
              id: { type: 'string' },
              kind: { enum: ['rectangle'] },
              x: { anyOf: [{ type: 'number' }, { type: 'string' }] },
              y: { anyOf: [{ type: 'number' }, { type: 'string' }] },
              width: { anyOf: [{ type: 'number' }, { type: 'string' }] },
              height: { anyOf: [{ type: 'number' }, { type: 'string' }] },
            },
            required: ['kind', 'x', 'y', 'width', 'height'],
          },
          {
            type: 'object',
            properties: {
              id: { type: 'string' },
              kind: { enum: ['ellipse'] },
              x: { anyOf: [{ type: 'number' }, { type: 'string' }] },
              y: { anyOf: [{ type: 'number' }, { type: 'string' }] },
              radiusX: { anyOf: [{ type: 'number' }, { type: 'string' }] },
              radiusY: { anyOf: [{ type: 'number' }, { type: 'string' }] },
            },
            required: ['kind', 'x', 'y', 'radiusX', 'radiusY'],
          },
          {
            type: 'object',
            properties: {
              id: { type: 'string' },
              kind: { enum: ['arc', 'sector'] },
              x: { anyOf: [{ type: 'number' }, { type: 'string' }] },
              y: { anyOf: [{ type: 'number' }, { type: 'string' }] },
              radius: { anyOf: [{ type: 'number' }, { type: 'string' }] },
              startAngle: { anyOf: [{ type: 'number' }, { type: 'string' }] },
              endAngle: { anyOf: [{ type: 'number' }, { type: 'string' }] },
            },
            required: ['kind', 'x', 'y', 'radius', 'startAngle', 'endAngle'],
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

export type GeometryChartStyle = 'bar' | 'line' | 'pie' | 'scatter';

export interface GeometryChart extends GeometryObjectBase {
  kind: 'chart';
  chartStyle: GeometryChartStyle;
  values: GeometryExpression[];
  x?: GeometryExpression[];
  labels?: string[];
  colors?: string[];
  center?: [GeometryExpression, GeometryExpression];
  radius?: GeometryExpression;
  width?: number;
  direction?: 'horizontal' | 'vertical';
}

export interface GeometryArrow extends GeometryObjectBase {
  kind: 'arrow';
  points: [string, string];
}

export interface GeometryRectangle extends GeometryObjectBase {
  kind: 'rectangle';
  x: GeometryExpression;
  y: GeometryExpression;
  width: GeometryExpression;
  height: GeometryExpression;
}

export interface GeometryEllipse extends GeometryObjectBase {
  kind: 'ellipse';
  x: GeometryExpression;
  y: GeometryExpression;
  radiusX: GeometryExpression;
  radiusY: GeometryExpression;
}

export interface GeometryArc extends GeometryObjectBase {
  kind: 'arc' | 'sector';
  x: GeometryExpression;
  y: GeometryExpression;
  radius: GeometryExpression;
  startAngle: GeometryExpression;
  endAngle: GeometryExpression;
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
  | GeometryIntersection
  | GeometryChart
  | GeometryArrow
  | GeometryRectangle
  | GeometryEllipse
  | GeometryArc;

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

type GeometryReferenceKind = GeometryObject['kind'];

const POINT_REFERENCE_KINDS: readonly GeometryReferenceKind[] = ['point'];
const INTERSECTION_SOURCE_KINDS: readonly GeometryReferenceKind[] = [
  'line',
  'segment',
  'circle',
  'functiongraph',
  'implicit',
  'polygon',
  'rectangle',
  'ellipse',
  'arc',
  'sector',
];

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

const validateExpressionArray = async (
  errors: GeometryDiagnostic[],
  index: number,
  field: string,
  value: unknown,
): Promise<void> => {
  if (!Array.isArray(value) || value.length === 0 || value.length > 24) {
    errors.push({ index, field, message: `${field} must contain between 1 and 24 values.` });
    return;
  }

  for (const [valueIndex, item] of value.entries()) {
    await validateExpression(errors, index, `${field}[${valueIndex}]`, item);
  }
};

const validateStringArray = (
  errors: GeometryDiagnostic[],
  index: number,
  field: string,
  value: unknown,
): void => {
  if (!Array.isArray(value) || value.length === 0 || value.length > 24) {
    errors.push({ index, field, message: `${field} must contain between 1 and 24 values.` });
    return;
  }

  value.forEach((item, itemIndex) => {
    if (typeof item !== 'string' || item.trim().length === 0) {
      errors.push({
        index,
        field: `${field}[${itemIndex}]`,
        message: 'Value must be a non-empty string.',
      });
    }
  });
};


const validateNumericPieValues = (
  errors: GeometryDiagnostic[],
  index: number,
  values: unknown,
): void => {
  if (!Array.isArray(values)) {
    return;
  }

  const numericValues = values.filter((value): value is number => typeof value === 'number');
  values.forEach((value, valueIndex) => {
    if (typeof value === 'number' && value < 0) {
      errors.push({
        index,
        field: `values[${valueIndex}]`,
        message: 'Pie chart values must be non-negative.',
      });
    }
  });

  if (numericValues.length === values.length && numericValues.every(value => value === 0)) {
    errors.push({
      index,
      field: 'values',
      message: 'Pie chart values must contain at least one positive value.',
    });
  }
};

const formatReferenceKindList = (kinds: readonly GeometryReferenceKind[]): string =>
  kinds.length === 1 ? kinds[0] : kinds.join(', ');

const validateReferences = (
  errors: GeometryDiagnostic[],
  index: number,
  field: string,
  references: unknown,
  declaredObjects: Map<string, unknown>,
  expectedLength?: number,
  expectedKinds?: readonly GeometryReferenceKind[],
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
    const referenceField = `${field}[${referenceIndex}]`;
    if (typeof reference !== 'string' || !declaredObjects.has(reference)) {
      errors.push({
        index,
        field: referenceField,
        message: `Unknown or forward reference: ${String(reference)}. Declare it with an id first.`,
      });
      return;
    }

    const referencedKind = declaredObjects.get(reference);
    if (expectedKinds && !expectedKinds.includes(referencedKind as GeometryReferenceKind)) {
      errors.push({
        index,
        field: referenceField,
        message: `${referenceField} must reference ${formatReferenceKindList(
          expectedKinds,
        )} object ids; ${reference} is ${String(referencedKind)}.`,
      });
    }
  });
};

const validateObject = async (
  object: Record<string, unknown>,
  index: number,
  declaredObjects: Map<string, unknown>,
  errors: GeometryDiagnostic[],
): Promise<void> => {
  const kind = object.kind;
  const id = object.id;

  if (id !== undefined && (typeof id !== 'string' || id.trim().length === 0)) {
    errors.push({ index, field: 'id', message: 'id must be a non-empty string when provided.' });
  } else if (typeof id === 'string') {
    if (declaredObjects.has(id)) {
      errors.push({ index, field: 'id', message: `Duplicate object id: ${id}.` });
    } else {
      declaredObjects.set(id, kind);
    }
  }

  switch (kind) {
    case 'point':
      await validateExpression(errors, index, 'x', object.x);
      await validateExpression(errors, index, 'y', object.y);
      break;
    case 'line':
    case 'segment':
      validateReferences(
        errors,
        index,
        'points',
        object.points,
        declaredObjects,
        2,
        POINT_REFERENCE_KINDS,
      );
      break;
    case 'circle':
      validateReferences(
        errors,
        index,
        'center',
        [object.center],
        declaredObjects,
        1,
        POINT_REFERENCE_KINDS,
      );
      if (hasOwn(object, 'point')) {
        validateReferences(
          errors,
          index,
          'point',
          [object.point],
          declaredObjects,
          1,
          POINT_REFERENCE_KINDS,
        );
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
      validateReferences(
        errors,
        index,
        'points',
        object.points,
        declaredObjects,
        undefined,
        POINT_REFERENCE_KINDS,
      );
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
      validateReferences(
        errors,
        index,
        'sources',
        object.sources,
        declaredObjects,
        2,
        INTERSECTION_SOURCE_KINDS,
      );
      break;
    case 'chart': {
      if (!['bar', 'line', 'pie', 'scatter'].includes(String(object.chartStyle))) {
        errors.push({
          index,
          field: 'chartStyle',
          message: 'chartStyle must be bar, line, pie, or scatter.',
        });
      }
      await validateExpressionArray(errors, index, 'values', object.values);
      if (hasOwn(object, 'x')) {
        await validateExpressionArray(errors, index, 'x', object.x);
        if (
          Array.isArray(object.values) &&
          Array.isArray(object.x) &&
          object.values.length !== object.x.length
        ) {
          errors.push({
            index,
            field: 'x',
            message: 'x and values must contain the same number of values.',
          });
        }
      }
      if (hasOwn(object, 'labels')) {
        validateStringArray(errors, index, 'labels', object.labels);
        if (
          Array.isArray(object.values) &&
          Array.isArray(object.labels) &&
          object.labels.length > object.values.length
        ) {
          errors.push({
            index,
            field: 'labels',
            message: 'labels cannot contain more values than values.',
          });
        }
      }
      if (hasOwn(object, 'colors')) {
        validateStringArray(errors, index, 'colors', object.colors);
      }
      if (hasOwn(object, 'center')) {
        if (!Array.isArray(object.center) || object.center.length !== 2) {
          errors.push({
            index,
            field: 'center',
            message: 'center must contain exactly two coordinates.',
          });
        } else {
          await validateExpression(errors, index, 'center[0]', object.center[0]);
          await validateExpression(errors, index, 'center[1]', object.center[1]);
        }
      }
      if (hasOwn(object, 'radius')) {
        await validateExpression(errors, index, 'radius', object.radius);
      }
      if (
        object.width !== undefined &&
        (typeof object.width !== 'number' || !Number.isFinite(object.width) || object.width <= 0)
      ) {
        errors.push({ index, field: 'width', message: 'width must be a positive finite number.' });
      }
      if (
        object.direction !== undefined &&
        !['horizontal', 'vertical'].includes(String(object.direction))
      ) {
        errors.push({
          index,
          field: 'direction',
          message: 'direction must be horizontal or vertical.',
        });
      }
      if (object.chartStyle === 'pie') {
        validateNumericPieValues(errors, index, object.values);
      }
      if (object.chartStyle === 'pie' && hasOwn(object, 'x')) {
        errors.push({
          index,
          field: 'x',
          message: 'pie charts use values only and do not accept x.',
        });
      }
      if (object.chartStyle === 'pie' && hasOwn(object, 'direction')) {
        errors.push({ index, field: 'direction', message: 'pie charts do not accept direction.' });
      }
      break;
    }
    case 'arrow':
      validateReferences(
        errors,
        index,
        'points',
        object.points,
        declaredObjects,
        2,
        POINT_REFERENCE_KINDS,
      );
      break;
    case 'rectangle':
      await validateExpression(errors, index, 'x', object.x);
      await validateExpression(errors, index, 'y', object.y);
      await validateExpression(errors, index, 'width', object.width);
      await validateExpression(errors, index, 'height', object.height);
      break;
    case 'ellipse':
      await validateExpression(errors, index, 'x', object.x);
      await validateExpression(errors, index, 'y', object.y);
      await validateExpression(errors, index, 'radiusX', object.radiusX);
      await validateExpression(errors, index, 'radiusY', object.radiusY);
      break;
    case 'arc':
    case 'sector':
      await validateExpression(errors, index, 'x', object.x);
      await validateExpression(errors, index, 'y', object.y);
      await validateExpression(errors, index, 'radius', object.radius);
      await validateExpression(errors, index, 'startAngle', object.startAngle);
      await validateExpression(errors, index, 'endAngle', object.endAngle);
      break;
    default:
      errors.push({
        index,
        field: 'kind',
        message: `Unsupported geometry object kind: ${String(kind)}.`,
      });
  }
};

export const normalizeGeometryDoc = (doc: unknown): unknown => {
  const record = asRecord(doc);
  if (!record || !Array.isArray(record.objects)) {
    return doc;
  }

  return {
    ...record,
    objects: record.objects.map(object => {
      const objectRecord = asRecord(object);
      if (!objectRecord) {
        return object;
      }

      const kind =
        typeof objectRecord.kind === 'string'
          ? objectRecord.kind
          : typeof objectRecord.type === 'string'
            ? objectRecord.type
            : undefined;
      const name =
        typeof objectRecord.name === 'string' && objectRecord.name.trim().length > 0
          ? objectRecord.name
          : undefined;
      const id =
        typeof objectRecord.id === 'string' && objectRecord.id.trim().length > 0
          ? objectRecord.id
          : name;

      return {
        ...objectRecord,
        ...(kind ? { kind } : {}),
        ...(id ? { id } : {}),
        ...(kind === 'point' && name && typeof objectRecord.label !== 'string'
          ? { label: name }
          : {}),
      };
    }),
  };
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

  const declaredObjects = new Map<string, unknown>();
  for (const [index, object] of record.objects.entries()) {
    const objectRecord = asRecord(object);
    if (!objectRecord) {
      errors.push({ index, field: 'object', message: 'Geometry object must be an object.' });
      continue;
    }
    await validateObject(objectRecord, index, declaredObjects, errors);
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
  const normalizedArgs = normalizeGeometryDoc(args);
  const validation = await validateGeometryDoc(normalizedArgs);
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
    renderResult = await renderGeometryDoc(probe, normalizedArgs as GeometryDoc);
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
