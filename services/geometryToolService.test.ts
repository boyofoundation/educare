import { describe, expect, it } from 'vitest';
import { normalizeGeometryDoc, validateGeometryDoc } from './geometryToolService';

const createDocument = (objects: unknown[], boundingbox: unknown = [-10, 10, 10, -10]) => ({
  title: 'Geometry validation fixture',
  boundingbox,
  objects,
});

describe('geometryToolService: validateGeometryDoc', () => {
  const validDocuments = [
    {
      name: 'point',
      document: createDocument([{ id: 'p', kind: 'point', x: '2 + 3', y: 4 }]),
    },
    {
      name: 'line',
      document: createDocument([
        { id: 'p1', kind: 'point', x: 0, y: 0 },
        { id: 'p2', kind: 'point', x: 1, y: 1 },
        { id: 'line', kind: 'line', points: ['p1', 'p2'] },
      ]),
    },
    {
      name: 'segment',
      document: createDocument([
        { id: 'p1', kind: 'point', x: 0, y: 0 },
        { id: 'p2', kind: 'point', x: 1, y: 1 },
        { id: 'segment', kind: 'segment', points: ['p1', 'p2'] },
      ]),
    },
    {
      name: 'circle',
      document: createDocument([
        { id: 'center', kind: 'point', x: 0, y: 0 },
        { id: 'circle', kind: 'circle', center: 'center', radius: 'sqrt(4)' },
      ]),
    },
    {
      name: 'functiongraph',
      document: createDocument([{ id: 'curve', kind: 'functiongraph', expr: 'sin(x)' }]),
    },
    {
      name: 'implicit',
      document: createDocument([{ id: 'curve', kind: 'implicit', expr: 'x^2 + y^2 - 1' }]),
    },
    {
      name: 'polygon',
      document: createDocument([
        { id: 'p1', kind: 'point', x: 0, y: 0 },
        { id: 'p2', kind: 'point', x: 1, y: 0 },
        { id: 'p3', kind: 'point', x: 0, y: 1 },
        { id: 'triangle', kind: 'polygon', points: ['p1', 'p2', 'p3'] },
      ]),
    },
    {
      name: 'text',
      document: createDocument([{ id: 'label', kind: 'text', x: '1 / 2', y: 3, text: 'Half' }]),
    },
    {
      name: 'intersection',
      document: createDocument([
        { id: 'p1', kind: 'point', x: 0, y: 0 },
        { id: 'p2', kind: 'point', x: 1, y: 1 },
        { id: 'line', kind: 'line', points: ['p1', 'p2'] },
        { id: 'circle', kind: 'circle', center: 'p1', radius: 1 },
        { id: 'crossing', kind: 'intersection', sources: ['line', 'circle'] },
      ]),
    },
    {
      name: 'bar chart',
      document: createDocument([
        {
          id: 'scores',
          kind: 'chart',
          chartStyle: 'bar',
          values: [3, '2 + 2'],
          labels: ['A', 'B'],
        },
      ]),
    },
    {
      name: 'scatter chart',
      document: createDocument([
        { id: 'scores', kind: 'chart', chartStyle: 'scatter', x: [1, 2], values: [2, 4] },
      ]),
    },
    {
      name: 'arrow',
      document: createDocument([
        { id: 'p1', kind: 'point', x: 0, y: 0 },
        { id: 'p2', kind: 'point', x: 2, y: 1 },
        { id: 'direction', kind: 'arrow', points: ['p1', 'p2'] },
      ]),
    },
    {
      name: 'rectangle',
      document: createDocument([{ id: 'box', kind: 'rectangle', x: 0, y: 0, width: 3, height: 2 }]),
    },
    {
      name: 'ellipse',
      document: createDocument([
        { id: 'oval', kind: 'ellipse', x: 0, y: 0, radiusX: 3, radiusY: 2 },
      ]),
    },
    {
      name: 'sector',
      document: createDocument([
        { id: 'slice', kind: 'sector', x: 0, y: 0, radius: 2, startAngle: 0, endAngle: 'pi / 2' },
      ]),
    },
  ];

  it.each(validDocuments)('accepts a valid $name document', async ({ document }) => {
    // Act
    const result = await validateGeometryDoc(document);

    // Assert
    expect(result.errors).toEqual([]);
  });

  it('normalizes common Gemini geometry aliases before validation', async () => {
    // Arrange
    const rawDocument = createDocument([
      { type: 'point', name: 'A', x: 0, y: 0 },
      { type: 'point', name: 'B', x: 2, y: 3 },
      { type: 'point', name: 'C', x: 0, y: 3 },
      { type: 'point', name: 'D', x: 2, y: 0 },
      { type: 'line', name: 'first', points: ['A', 'B'] },
      { type: 'line', name: 'second', points: ['C', 'D'] },
      { type: 'intersection', sources: ['first', 'second'] },
    ]);

    // Act
    const normalizedDocument = normalizeGeometryDoc(rawDocument);
    const result = await validateGeometryDoc(normalizedDocument);

    // Assert
    expect(result.errors).toEqual([]);
    expect(normalizedDocument).toMatchObject({
      objects: [
        { id: 'A', kind: 'point', label: 'A' },
        { id: 'B', kind: 'point', label: 'B' },
        { id: 'C', kind: 'point', label: 'C' },
        { id: 'D', kind: 'point', label: 'D' },
        { id: 'first', kind: 'line', points: ['A', 'B'] },
        { id: 'second', kind: 'line', points: ['C', 'D'] },
        { kind: 'intersection', sources: ['first', 'second'] },
      ],
    });
  });

  const invalidBoundingBoxes = [
    {
      name: 'is missing',
      document: {
        title: 'Geometry validation fixture',
        objects: [{ kind: 'point', x: 0, y: 0 }],
      },
      message: 'boundingbox must be [xMin, yMax, xMax, yMin] with four finite numbers.',
    },
    {
      name: 'does not contain four finite numbers',
      document: createDocument([{ kind: 'point', x: 0, y: 0 }], [-1, 1, Number.NaN, -1]),
      message: 'boundingbox must be [xMin, yMax, xMax, yMin] with four finite numbers.',
    },
    {
      name: 'has reversed bounds',
      document: createDocument([{ kind: 'point', x: 0, y: 0 }], [1, 1, -1, -1]),
      message: 'boundingbox must satisfy xMin < xMax and yMax > yMin.',
    },
  ];

  it.each(invalidBoundingBoxes)(
    'rejects a bounding box that $name',
    async ({ document, message }) => {
      // Arrange: document is supplied by the table.

      // Act
      const result = await validateGeometryDoc(document);

      // Assert
      expect(result.errors).toEqual([{ index: -1, field: 'boundingbox', message }]);
    },
  );

  it('rejects an invalid math.js expression', async () => {
    // Arrange
    const document = createDocument([{ kind: 'point', x: 'sin(', y: 0 }]);

    // Act
    const result = await validateGeometryDoc(document);

    // Assert
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ index: 0, field: 'x' });
  });

  it('rejects duplicate object ids', async () => {
    // Arrange
    const document = createDocument([
      { id: 'p', kind: 'point', x: 0, y: 0 },
      { id: 'p', kind: 'point', x: 1, y: 1 },
    ]);

    // Act
    const result = await validateGeometryDoc(document);

    // Assert
    expect(result.errors).toEqual([{ index: 1, field: 'id', message: 'Duplicate object id: p.' }]);
  });

  it('rejects chart data with mismatched x coordinates', async () => {
    // Arrange
    const document = createDocument([
      { kind: 'chart', chartStyle: 'line', x: [1, 2], values: [3] },
    ]);

    // Act
    const result = await validateGeometryDoc(document);

    // Assert
    expect(result.errors).toEqual([
      {
        index: 0,
        field: 'x',
        message: 'x and values must contain the same number of values.',
      },
    ]);
  });

  it('rejects pie charts that are configured with x coordinates', async () => {
    // Arrange
    const document = createDocument([
      { kind: 'chart', chartStyle: 'pie', x: [1, 2], values: [3, 4] },
    ]);

    // Act
    const result = await validateGeometryDoc(document);

    // Assert
    expect(result.errors).toEqual([
      {
        index: 0,
        field: 'x',
        message: 'pie charts use values only and do not accept x.',
      },
    ]);
  });

  const invalidReferenceCases = [
    {
      name: 'forward references',
      document: createDocument([
        { id: 'line', kind: 'line', points: ['p1', 'p2'] },
        { id: 'p1', kind: 'point', x: 0, y: 0 },
        { id: 'p2', kind: 'point', x: 1, y: 1 },
      ]),
      fields: ['points[0]', 'points[1]'],
    },
    {
      name: 'unknown references',
      document: createDocument([
        { id: 'p1', kind: 'point', x: 0, y: 0 },
        { id: 'line', kind: 'line', points: ['p1', 'missing'] },
      ]),
      fields: ['points[1]'],
    },
  ];

  it.each(invalidReferenceCases)('rejects $name', async ({ document, fields }) => {
    // Act
    const result = await validateGeometryDoc(document);

    // Assert
    expect(result.errors).toHaveLength(fields.length);
    expect(result.errors).toEqual(
      fields.map(field =>
        expect.objectContaining({
          field,
          message: expect.stringContaining('Unknown or forward reference'),
        }),
      ),
    );
  });
});
