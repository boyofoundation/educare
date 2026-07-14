import {
  type GeometryDiagnostic,
  type GeometryDoc,
  type GeometryObject,
} from './geometryToolService';
import type { MathJsStatic } from 'mathjs';

export interface GeometryComputedPoint {
  id: string;
  x: number;
  y: number;
}

interface GeometryElement {
  coords?: { usrCoords?: [number, number, number] };
  dataX?: unknown[];
  dataY?: unknown[];
}

interface GeometryBoard {
  create: (
    kind: string,
    parents: unknown[],
    attributes?: Record<string, unknown>,
  ) => GeometryElement;
}

interface JSXGraphModule {
  JSXGraph: {
    initBoard: (container: HTMLElement, options: Record<string, unknown>) => GeometryBoard;
    freeBoard: (board: GeometryBoard) => void;
  };
}

export interface GeometryRenderResult {
  board: GeometryBoard;
  errors: GeometryDiagnostic[];
  warnings: GeometryDiagnostic[];
  computedPoints: GeometryComputedPoint[];
  destroy: () => void;
}

let mathPromise: Promise<MathJsStatic> | undefined;

const getMath = (): Promise<MathJsStatic> => {
  if (!mathPromise) {
    mathPromise = import('mathjs').then(({ all, create }) => {
      const math = create(all, {});
      const safeEvaluate = math.evaluate.bind(math);
      const safeParse = math.parse.bind(math);
      const blocked = (name: string): never => {
        throw new Error(`${name} is disabled in geometry expressions.`);
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
      return Object.assign(math, { __safeEvaluate: safeEvaluate, __safeParse: safeParse });
    });
  }

  return mathPromise;
};

type SandboxedMath = MathJsStatic & {
  __safeEvaluate(expression: string, scope: Record<string, number>): unknown;
  __safeParse(expression: string): {
    compile: () => { evaluate: (scope: Record<string, number>) => unknown };
  };
};

const evaluateExpression = async (
  expression: number | string,
  scope: Record<string, number> = {},
) => {
  if (typeof expression === 'number') {
    return expression;
  }
  const math = (await getMath()) as SandboxedMath;
  const value = math.__safeEvaluate(expression, scope);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Expression must resolve to a finite number: ${expression}`);
  }
  return value;
};

const evaluateExpressions = async (values: Array<number | string>): Promise<number[]> =>
  Promise.all(values.map(value => evaluateExpression(value)));

const requirePositive = (value: number, field: string): number => {
  if (value <= 0) {
    throw new Error(`${field} must resolve to a positive number.`);
  }
  return value;
};

const elementAttributes = (object: GeometryObject): Record<string, unknown> => ({
  name: object.kind === 'point' ? (object.label ?? '') : '',
  fixed: true,
  withLabel: object.kind === 'point' && Boolean(object.label),
});

const isOutOfView = (points: Array<[number, number]>, boundingbox: GeometryDoc['boundingbox']) => {
  const [xMin, yMax, xMax, yMin] = boundingbox;
  return points.every(([x, y]) => x < xMin || x > xMax || y < yMin || y > yMax);
};

export const renderGeometryDoc = async (
  container: HTMLElement,
  doc: GeometryDoc,
): Promise<GeometryRenderResult> => {
  const module = (await import('jsxgraph')) as unknown as { default: JSXGraphModule };
  const JXG = module.default;
  const board = JXG.JSXGraph.initBoard(container, {
    boundingbox: doc.boundingbox,
    axis: true,
    showCopyright: false,
    showNavigation: false,
    keepaspectratio: true,
  });
  const elements = new Map<string, GeometryElement>();
  const errors: GeometryDiagnostic[] = [];
  const warnings: GeometryDiagnostic[] = [];
  const computedPoints: GeometryComputedPoint[] = [];

  for (const [index, object] of doc.objects.entries()) {
    try {
      let element: GeometryElement;
      switch (object.kind) {
        case 'point':
          element = board.create(
            'point',
            [await evaluateExpression(object.x), await evaluateExpression(object.y)],
            elementAttributes(object),
          );
          break;
        case 'line':
        case 'segment':
          element = board.create(
            object.kind,
            object.points.map(pointId => elements.get(pointId)) as unknown[],
            elementAttributes(object),
          );
          break;
        case 'circle': {
          const center = elements.get(object.center);
          const parents = object.point
            ? [center, elements.get(object.point)]
            : [center, await evaluateExpression(object.radius ?? 0)];
          element = board.create('circle', parents, elementAttributes(object));
          break;
        }
        case 'functiongraph': {
          const sampledPoints: Array<[number, number]> = [];
          const math = (await getMath()) as SandboxedMath;
          const compiled = math.__safeParse(object.expr).compile();
          const graphSync = (x: number) => {
            const y = compiled.evaluate({ x });
            if (typeof y !== 'number' || !Number.isFinite(y)) {
              return Number.NaN;
            }
            sampledPoints.push([x, y]);
            return y;
          };
          element = board.create('functiongraph', [graphSync], elementAttributes(object));
          const [xMin, , xMax] = doc.boundingbox;
          for (let sample = 0; sample <= 24; sample += 1) {
            graphSync(xMin + ((xMax - xMin) * sample) / 24);
          }
          if (
            isOutOfView(
              sampledPoints.filter(([, y]) => Number.isFinite(y)),
              doc.boundingbox,
            )
          ) {
            warnings.push({
              index,
              field: 'expr',
              message: '函數圖形在目前視窗內沒有取樣點。',
            });
          }
          break;
        }
        case 'implicit': {
          const math = (await getMath()) as SandboxedMath;
          const compiled = math.__safeParse(object.expr).compile();
          const implicit = (x: number, y: number) => {
            const value = compiled.evaluate({ x, y });
            return typeof value === 'number' && Number.isFinite(value) ? value : Number.NaN;
          };
          element = board.create('implicitcurve', [implicit], elementAttributes(object));
          if ((element.dataX?.length ?? 0) === 0 && (element.dataY?.length ?? 0) === 0) {
            warnings.push({
              index,
              field: 'expr',
              message: 'F(x,y)=0 在目前視窗內沒有解。',
            });
          }
          break;
        }
        case 'polygon':
          element = board.create(
            'polygon',
            object.points.map(pointId => elements.get(pointId)) as unknown[],
            elementAttributes(object),
          );
          break;
        case 'text':
          element = board.create(
            'text',
            [await evaluateExpression(object.x), await evaluateExpression(object.y), object.text],
            elementAttributes(object),
          );
          break;
        case 'intersection': {
          const [first, second] = object.sources.map(source => elements.get(source));
          element = board.create('intersection', [first, second, 0], elementAttributes(object));
          const [, x, y] = element.coords?.usrCoords ?? [Number.NaN, Number.NaN, Number.NaN];
          if (!Number.isFinite(x) || !Number.isFinite(y)) {
            warnings.push({
              index,
              field: 'sources',
              message: '指定的交點不存在。',
            });
          } else if (object.id) {
            computedPoints.push({ id: object.id, x, y });
          }
          break;
        }
        case 'chart': {
          const values = await evaluateExpressions(object.values);
          const x = object.x ? await evaluateExpressions(object.x) : undefined;
          if (object.chartStyle === 'pie' && values.every(value => value >= 0) === false) {
            throw new Error('Pie chart values must be non-negative.');
          }
          if (object.chartStyle === 'pie' && values.every(value => value === 0)) {
            throw new Error('Pie chart values must contain at least one positive value.');
          }

          const chartAttributes: Record<string, unknown> = {
            ...elementAttributes(object),
            chartStyle: object.chartStyle === 'scatter' ? 'point' : object.chartStyle,
          };
          if (object.labels) {
            chartAttributes.labels = object.labels;
          }
          if (object.colors) {
            chartAttributes.colors = object.colors;
          }
          if (object.center) {
            chartAttributes.center = await evaluateExpressions(object.center);
          }
          if (object.radius !== undefined) {
            chartAttributes.radius = requirePositive(
              await evaluateExpression(object.radius),
              'radius',
            );
          }
          if (object.width !== undefined) {
            chartAttributes.width = object.width;
          }
          if (object.direction) {
            chartAttributes.dir = object.direction;
          }

          element = board.create('chart', x ? [x, values] : [values], chartAttributes);
          break;
        }
        case 'arrow':
          element = board.create(
            'arrow',
            object.points.map(pointId => elements.get(pointId)) as unknown[],
            elementAttributes(object),
          );
          break;
        case 'rectangle': {
          const x = await evaluateExpression(object.x);
          const y = await evaluateExpression(object.y);
          const width = requirePositive(await evaluateExpression(object.width), 'width');
          const height = requirePositive(await evaluateExpression(object.height), 'height');
          element = board.create(
            'polygon',
            [
              [x, y],
              [x + width, y],
              [x + width, y + height],
              [x, y + height],
            ],
            elementAttributes(object),
          );
          break;
        }
        case 'ellipse': {
          const x = await evaluateExpression(object.x);
          const y = await evaluateExpression(object.y);
          const radiusX = requirePositive(await evaluateExpression(object.radiusX), 'radiusX');
          const radiusY = requirePositive(await evaluateExpression(object.radiusY), 'radiusY');
          const [majorRadius, minorRadius] =
            radiusX >= radiusY ? [radiusX, radiusY] : [radiusY, radiusX];
          const focusDistance = Math.sqrt(majorRadius ** 2 - minorRadius ** 2);
          const parents =
            radiusX >= radiusY
              ? [
                  [x - focusDistance, y],
                  [x + focusDistance, y],
                  [x, y + radiusY],
                ]
              : [
                  [x, y - focusDistance],
                  [x, y + focusDistance],
                  [x + radiusX, y],
                ];
          element = board.create('ellipse', parents, elementAttributes(object));
          break;
        }
        case 'arc':
        case 'sector': {
          const x = await evaluateExpression(object.x);
          const y = await evaluateExpression(object.y);
          const radius = requirePositive(await evaluateExpression(object.radius), 'radius');
          const startAngle = await evaluateExpression(object.startAngle);
          const endAngle = await evaluateExpression(object.endAngle);
          const angleDifference = Math.abs(endAngle - startAngle);
          if (angleDifference === 0) {
            throw new Error('startAngle and endAngle must be different.');
          }
          const parents = [
            [x, y],
            [x + radius * Math.cos(startAngle), y + radius * Math.sin(startAngle)],
            [x + radius * Math.cos(endAngle), y + radius * Math.sin(endAngle)],
          ];
          element = board.create(object.kind, parents, {
            ...elementAttributes(object),
            selection: angleDifference > Math.PI ? 'major' : 'minor',
          });
          break;
        }
      }

      if (object.id) {
        elements.set(object.id, element);
      }
    } catch (error) {
      errors.push({
        index,
        field: 'object',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    board,
    errors,
    warnings,
    computedPoints,
    destroy: () => JXG.JSXGraph.freeBoard(board),
  };
};
