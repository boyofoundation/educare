import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GeometryDoc } from './geometryToolService';
import { renderGeometryDoc } from './geometryRenderer';

const jsxGraph = vi.hoisted(() => {
  const board = { create: vi.fn() };
  const initBoard = vi.fn(() => board);
  const freeBoard = vi.fn();

  return { board, freeBoard, initBoard };
});

vi.mock('jsxgraph', () => ({
  default: {
    JSXGraph: {
      initBoard: jsxGraph.initBoard,
      freeBoard: jsxGraph.freeBoard,
    },
  },
}));

const createDocument = (
  objects: GeometryDoc['objects'],
  boundingbox: GeometryDoc['boundingbox'] = [-10, 10, 10, -10],
): GeometryDoc => ({
  title: 'Geometry renderer fixture',
  boundingbox,
  objects,
});

describe('geometryRenderer: renderGeometryDoc', () => {
  beforeEach(() => {
    jsxGraph.board.create.mockReset();
    jsxGraph.board.create.mockImplementation(kind => ({ kind }));
    jsxGraph.initBoard.mockClear();
    jsxGraph.initBoard.mockReturnValue(jsxGraph.board);
    jsxGraph.freeBoard.mockClear();
  });

  it('translates basic geometry objects to JSXGraph elements and frees the board on destroy', async () => {
    // Arrange
    const container = document.createElement('div');
    const documentModel = createDocument([
      { id: 'p1', kind: 'point', x: '1 + 1', y: 3, label: 'A' },
      { id: 'p2', kind: 'point', x: 4, y: 5 },
      { id: 'p3', kind: 'point', x: 6, y: 7 },
      { id: 'line', kind: 'line', points: ['p1', 'p2'] },
      { id: 'segment', kind: 'segment', points: ['p2', 'p3'] },
      { id: 'radius-circle', kind: 'circle', center: 'p1', radius: 'sqrt(4)' },
      { id: 'point-circle', kind: 'circle', center: 'p1', point: 'p2' },
      { id: 'polygon', kind: 'polygon', points: ['p1', 'p2', 'p3'] },
      { id: 'caption', kind: 'text', x: '1 / 2', y: 8, text: 'Hello' },
    ]);

    // Act
    const result = await renderGeometryDoc(container, documentModel);

    // Assert
    expect(jsxGraph.initBoard).toHaveBeenCalledWith(container, {
      boundingbox: [-10, 10, 10, -10],
      axis: true,
      showCopyright: false,
      showNavigation: false,
      keepaspectratio: true,
    });
    expect(jsxGraph.board.create).toHaveBeenNthCalledWith(1, 'point', [2, 3], {
      name: 'A',
      fixed: true,
      withLabel: true,
    });
    expect(jsxGraph.board.create).toHaveBeenNthCalledWith(
      4,
      'line',
      [jsxGraph.board.create.mock.results[0]?.value, jsxGraph.board.create.mock.results[1]?.value],
      { name: '', fixed: true, withLabel: false },
    );
    expect(jsxGraph.board.create).toHaveBeenNthCalledWith(
      5,
      'segment',
      [jsxGraph.board.create.mock.results[1]?.value, jsxGraph.board.create.mock.results[2]?.value],
      { name: '', fixed: true, withLabel: false },
    );
    expect(jsxGraph.board.create).toHaveBeenNthCalledWith(
      6,
      'circle',
      [jsxGraph.board.create.mock.results[0]?.value, 2],
      { name: '', fixed: true, withLabel: false },
    );
    expect(jsxGraph.board.create).toHaveBeenNthCalledWith(
      7,
      'circle',
      [jsxGraph.board.create.mock.results[0]?.value, jsxGraph.board.create.mock.results[1]?.value],
      { name: '', fixed: true, withLabel: false },
    );
    expect(jsxGraph.board.create).toHaveBeenNthCalledWith(
      8,
      'polygon',
      [
        jsxGraph.board.create.mock.results[0]?.value,
        jsxGraph.board.create.mock.results[1]?.value,
        jsxGraph.board.create.mock.results[2]?.value,
      ],
      { name: '', fixed: true, withLabel: false },
    );
    expect(jsxGraph.board.create).toHaveBeenNthCalledWith(9, 'text', [0.5, 8, 'Hello'], {
      name: '',
      fixed: true,
      withLabel: false,
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);

    result.destroy();

    expect(jsxGraph.freeBoard).toHaveBeenCalledWith(jsxGraph.board);
  });

  it('translates charts and basic visual shapes to JSXGraph elements', async () => {
    // Arrange
    const documentModel = createDocument([
      {
        id: 'bar-chart',
        kind: 'chart',
        chartStyle: 'bar',
        values: ['1 + 1', 3],
        labels: ['A', 'B'],
        colors: ['#f97316'],
        width: 0.6,
        direction: 'vertical',
      },
      {
        id: 'scatter-chart',
        kind: 'chart',
        chartStyle: 'scatter',
        x: [1, 2],
        values: [2, 4],
      },
      { id: 'p1', kind: 'point', x: 0, y: 0 },
      { id: 'p2', kind: 'point', x: 2, y: 1 },
      { id: 'vector', kind: 'arrow', points: ['p1', 'p2'] },
      { id: 'box', kind: 'rectangle', x: -3, y: -2, width: 2, height: 1 },
      { id: 'oval', kind: 'ellipse', x: 3, y: 2, radiusX: 3, radiusY: 2 },
      { id: 'slice', kind: 'sector', x: 0, y: 0, radius: 2, startAngle: 0, endAngle: 'pi / 2' },
      { id: 'curve', kind: 'arc', x: 0, y: 0, radius: 2, startAngle: 0, endAngle: 'pi' },
    ]);

    // Act
    const result = await renderGeometryDoc(document.createElement('div'), documentModel);

    // Assert
    expect(jsxGraph.board.create).toHaveBeenNthCalledWith(1, 'chart', [[2, 3]], {
      name: '',
      fixed: true,
      withLabel: false,
      chartStyle: 'bar',
      labels: ['A', 'B'],
      colors: ['#f97316'],
      width: 0.6,
      dir: 'vertical',
    });
    expect(jsxGraph.board.create).toHaveBeenNthCalledWith(
      2,
      'chart',
      [
        [1, 2],
        [2, 4],
      ],
      { name: '', fixed: true, withLabel: false, chartStyle: 'point' },
    );
    expect(jsxGraph.board.create).toHaveBeenNthCalledWith(
      5,
      'arrow',
      [jsxGraph.board.create.mock.results[2]?.value, jsxGraph.board.create.mock.results[3]?.value],
      { name: '', fixed: true, withLabel: false },
    );
    expect(jsxGraph.board.create).toHaveBeenNthCalledWith(
      6,
      'polygon',
      [
        [-3, -2],
        [-1, -2],
        [-1, -1],
        [-3, -1],
      ],
      { name: '', fixed: true, withLabel: false },
    );
    expect(jsxGraph.board.create).toHaveBeenNthCalledWith(
      7,
      'ellipse',
      [
        [3 - Math.sqrt(5), 2],
        [3 + Math.sqrt(5), 2],
        [3, 4],
      ],
      { name: '', fixed: true, withLabel: false },
    );
    expect(jsxGraph.board.create).toHaveBeenNthCalledWith(8, 'sector', expect.any(Array), {
      name: '',
      fixed: true,
      withLabel: false,
      selection: 'minor',
    });
    expect(jsxGraph.board.create).toHaveBeenNthCalledWith(9, 'arc', expect.any(Array), {
      name: '',
      fixed: true,
      withLabel: false,
      selection: 'minor',
    });
    expect(result.errors).toEqual([]);
  });

  it('returns a render error for a pie chart with negative values', async () => {
    // Arrange
    const documentModel = createDocument([
      { id: 'invalid-pie', kind: 'chart', chartStyle: 'pie', values: [-1, 2] },
    ]);

    // Act
    const result = await renderGeometryDoc(document.createElement('div'), documentModel);

    // Assert
    expect(result.errors).toEqual([
      { index: 0, field: 'object', message: 'Pie chart values must be non-negative.' },
    ]);
  });

  it('returns the coordinates of an existing intersection', async () => {
    // Arrange
    jsxGraph.board.create.mockImplementation(kind =>
      kind === 'intersection' ? { coords: { usrCoords: [1, 2.5, -4] } } : { kind },
    );
    const documentModel = createDocument([
      { id: 'p1', kind: 'point', x: 0, y: 0 },
      { id: 'p2', kind: 'point', x: 1, y: 1 },
      { id: 'line', kind: 'line', points: ['p1', 'p2'] },
      { id: 'circle', kind: 'circle', center: 'p1', radius: 1 },
      { id: 'crossing', kind: 'intersection', sources: ['line', 'circle'] },
    ]);

    // Act
    const result = await renderGeometryDoc(document.createElement('div'), documentModel);

    // Assert
    expect(jsxGraph.board.create).toHaveBeenLastCalledWith(
      'intersection',
      [
        jsxGraph.board.create.mock.results[2]?.value,
        jsxGraph.board.create.mock.results[3]?.value,
        0,
      ],
      { name: '', fixed: true, withLabel: false },
    );
    expect(result.computedPoints).toEqual([{ id: 'crossing', x: 2.5, y: -4 }]);
    expect(result.warnings).toEqual([]);
  });

  it('warns when the requested intersection does not exist', async () => {
    // Arrange
    jsxGraph.board.create.mockImplementation(kind =>
      kind === 'intersection' ? { coords: { usrCoords: [1, Number.NaN, Number.NaN] } } : { kind },
    );
    const documentModel = createDocument([
      { id: 'p1', kind: 'point', x: 0, y: 0 },
      { id: 'p2', kind: 'point', x: 1, y: 1 },
      { id: 'line', kind: 'line', points: ['p1', 'p2'] },
      { id: 'circle', kind: 'circle', center: 'p1', radius: 1 },
      { id: 'crossing', kind: 'intersection', sources: ['line', 'circle'] },
    ]);

    // Act
    const result = await renderGeometryDoc(document.createElement('div'), documentModel);

    // Assert
    expect(result.computedPoints).toEqual([]);
    expect(result.warnings).toEqual([
      {
        index: 4,
        field: 'sources',
        message: '指定的交點不存在。',
      },
    ]);
  });

  it('warns when a function graph has no sampled point inside the bounding box', async () => {
    // Arrange
    const documentModel = createDocument(
      [{ id: 'outside', kind: 'functiongraph', expr: '10' }],
      [-1, 1, 1, -1],
    );

    // Act
    const result = await renderGeometryDoc(document.createElement('div'), documentModel);

    // Assert
    expect(jsxGraph.board.create).toHaveBeenCalledWith('functiongraph', [expect.any(Function)], {
      name: '',
      fixed: true,
      withLabel: false,
    });
    expect(result.warnings).toEqual([
      {
        index: 0,
        field: 'expr',
        message: '函數圖形在目前視窗內沒有取樣點。',
      },
    ]);
  });
});

describe('geometryToolService: executeDrawGeometry cleanup', () => {
  afterEach(() => {
    vi.doUnmock('./geometryRenderer');
    vi.resetModules();
  });

  it('destroys the offscreen render result and removes its probe', async () => {
    // Arrange
    const destroy = vi.fn();
    const renderGeometryDoc = vi.fn().mockResolvedValue({
      errors: [],
      warnings: [],
      computedPoints: [],
      destroy,
    });
    vi.resetModules();
    vi.doMock('./geometryRenderer', () => ({ renderGeometryDoc }));
    const { executeDrawGeometry } = await import('./geometryToolService');
    const documentModel = createDocument([{ id: 'point', kind: 'point', x: 0, y: 0 }]);

    // Act
    const result = await executeDrawGeometry(documentModel);

    // Assert
    expect(result).toMatchObject({ ok: true, warnings: [], computed_points: [] });
    expect(renderGeometryDoc).toHaveBeenCalledWith(expect.any(HTMLDivElement), documentModel);
    const probe = renderGeometryDoc.mock.calls[0]?.[0];
    expect(document.body.contains(probe)).toBe(false);
    expect(destroy).toHaveBeenCalledOnce();
  });
});
