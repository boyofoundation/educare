import React from 'react';
import type { MessageImage } from '../../types';

interface GeneratedImageGridProps {
  images: MessageImage[];
}

const GeneratedImageGrid: React.FC<GeneratedImageGridProps> = ({ images }) => {
  if (images.length === 0) {
    return null;
  }

  return (
    <div className='mb-3 flex flex-wrap gap-2' aria-label='模型生成圖片'>
      {images.map((image, index) => (
        <img
          key={`generated-image-${image.index ?? index}-${index}`}
          src={image.url}
          alt={`模型生成圖片 ${index + 1}`}
          loading='lazy'
          className='max-h-[28rem] max-w-full rounded-xl border border-white/20 object-contain'
        />
      ))}
    </div>
  );
};

export default GeneratedImageGrid;
