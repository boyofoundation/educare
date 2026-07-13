import { describe, expect, it } from 'vitest';
import { validateGeometryDoc } from './geometryToolService';

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
  ];

  it.each(validDocuments)('accepts a valid $name document', async ({ document }) => {
    // Act
    const result = await validateGeometryDoc(document);

    // Assert
    expect(result.errors).toEqual([]);
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
