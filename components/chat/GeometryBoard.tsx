import { useEffect, useRef, useState } from 'react';
import type { GeometryBoardRecord } from '../../types';
import type { GeometryDiagnostic } from '../../services/geometryToolService';
import { renderGeometryDoc } from '../../services/geometryRenderer';

interface GeometryBoardProps {
  board: GeometryBoardRecord;
}

const GeometryBoard = ({ board }: GeometryBoardProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [diagnostics, setDiagnostics] = useState<GeometryDiagnostic[]>([]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    let active = true;
    let destroy: (() => void) | undefined;

    void renderGeometryDoc(container, board.doc)
      .then(result => {
        destroy = result.destroy;
        if (active) {
          setDiagnostics([...result.errors, ...result.warnings]);
        } else {
          destroy();
        }
      })
      .catch(error => {
        if (active) {
          setDiagnostics([
            {
              index: -1,
              field: 'renderer',
              message: error instanceof Error ? error.message : String(error),
            },
          ]);
        }
      });

    return () => {
      active = false;
      destroy?.();
    };
  }, [board]);

  return (
    <section className='w-full max-w-[90%] rounded-2xl border border-cyan-500/20 bg-gray-900/70 p-4 md:max-w-[70ch]'>
      <h3 className='mb-3 text-sm font-semibold text-cyan-100'>{board.title}</h3>
      <div
        ref={containerRef}
        className='aspect-[4/3] w-full overflow-hidden rounded-xl bg-white'
        aria-label={`${board.title} 幾何圖`}
      />
      {diagnostics.length > 0 && (
        <ul className='mt-3 space-y-1 text-xs text-amber-100'>
          {diagnostics.map((diagnostic, index) => (
            <li key={`${diagnostic.index}-${diagnostic.field}-${index}`}>{diagnostic.message}</li>
          ))}
        </ul>
      )}
    </section>
  );
};

export default GeometryBoard;
