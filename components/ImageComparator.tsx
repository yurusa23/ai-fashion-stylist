import React, { useState, useRef, useCallback, MouseEvent, TouchEvent } from 'react';
import { CompareHandleIcon } from './icons';

interface ImageComparatorProps {
  originalImageUrl: string;
  editedImageUrl: string;
}

const ImageComparator: React.FC<ImageComparatorProps> = ({ originalImageUrl, editedImageUrl }) => {
  const [sliderPosition, setSliderPosition] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMove = useCallback((clientX: number) => {
    if (!isDragging || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const percent = (x / rect.width) * 100;
    setSliderPosition(percent);
  }, [isDragging]);

  const handleMouseDown = (e: MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleTouchStart = (e: TouchEvent) => {
    setIsDragging(true);
  };

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);
  
  const handleTouchEnd = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    handleMove(e.clientX);
  }, [handleMove]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    handleMove(e.touches[0].clientX);
  }, [handleMove]);


  return (
    <div
      ref={containerRef}
      className="relative w-full h-full select-none overflow-hidden rounded-lg group cursor-ew-resize"
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onMouseMove={handleMouseMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      onTouchMove={handleTouchMove}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
    >
        <img
            src={originalImageUrl}
            alt="Original"
            className="absolute inset-0 w-full h-full object-contain pointer-events-none"
            draggable="false"
        />
        <div
            className="absolute inset-0 w-full h-full overflow-hidden pointer-events-none"
            style={{ clipPath: `inset(0 ${100 - sliderPosition}% 0 0)` }}
        >
            <img
                src={editedImageUrl}
                alt="Edited"
                className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                draggable="false"
            />
        </div>

        <div
            className="absolute top-0 bottom-0 w-0.5 bg-white/80 pointer-events-none shadow-md"
            style={{ left: `calc(${sliderPosition}% - 1px)` }}
        >
            <div
                className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-10 h-10 bg-white rounded-full flex items-center justify-center text-theme-gray-dark shadow-medium transition-transform group-hover:scale-110 pointer-events-none ring-1 ring-black/5"
            >
                <CompareHandleIcon className="w-5 h-5 rotate-90" />
            </div>
        </div>
        
        <div className="absolute top-2 left-2 bg-black/60 text-white text-xs font-bold uppercase px-2 py-1 rounded pointer-events-none">Original</div>
        <div 
            className="absolute top-2 right-2 bg-black/60 text-white text-xs font-bold uppercase px-2 py-1 rounded pointer-events-none"
            style={{ opacity: sliderPosition > 80 ? 1 : 0, transition: 'opacity 0.2s' }}
        >
            Edited
        </div>
    </div>
  );
};

export default ImageComparator;