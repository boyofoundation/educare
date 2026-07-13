import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GeometryBoardRecord } from '../../../types';
import GeometryBoard from '../GeometryBoard';

const { renderGeometryDocMock } = vi.hoisted(() => ({
  renderGeometryDocMock: vi.fn(),
}));

vi.mock('../../../services/geometryRenderer', () => ({
  renderGeometryDoc: renderGeometryDocMock,
}));

const geometryBoard: GeometryBoardRecord = {
  id: 'geometry-1',
  title: 'Triangle ABC',
  doc: {
    title: 'Triangle ABC',
    boundingbox: [-5, 5, 5, -5],
    objects: [],
  },
  computedPoints: [],
};

describe('GeometryBoard', () => {
  beforeEach(() => {
    renderGeometryDocMock.mockReset();
  });

  it('renders a geometry board and destroys its renderer on unmount', async () => {
    // Arrange
    const destroy = vi.fn();
    renderGeometryDocMock.mockResolvedValue({
      board: {},
      errors: [],
      warnings: [],
      computedPoints: [],
      destroy,
    });

    // Act
    const { unmount } = render(<GeometryBoard board={geometryBoard} />);

    // Assert
    const container = screen.getByLabelText('Triangle ABC 幾何圖');
    expect(screen.getByRole('heading', { name: 'Triangle ABC' })).toBeInTheDocument();
    await waitFor(() => {
      expect(renderGeometryDocMock).toHaveBeenCalledWith(container, geometryBoard.doc);
    });

    // Act
    unmount();

    // Assert
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
