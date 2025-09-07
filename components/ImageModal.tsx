import React, { useEffect, useCallback, useState } from 'react';
import { CloseIcon, CompareIcon } from './icons';
import ImageComparator from './ImageComparator';

interface ImageModalProps {
  imageUrl: string;
  originalImageUrl: string | null;
  onClose: () => void;
}

const ImageModal: React.FC<ImageModalProps> = ({ imageUrl, originalImageUrl, onClose }) => {
  // Default to showing the comparator if an original image is available.
  const [showComparator, setShowComparator] = useState(!!originalImageUrl);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    // When the modal content changes, reset the view to default (comparator if possible)
    setShowComparator(!!originalImageUrl);

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown, imageUrl, originalImageUrl]);

  return (
    <div
      className="fixed inset-0 bg-theme-text/90 flex flex-col items-center justify-center z-50 p-4 transition-opacity duration-300 animate-fadeIn"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Fullscreen image view"
    >
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .animate-fadeIn {
          animation: fadeIn 0.2s ease-out;
        }
      `}</style>
      
      <div className="absolute top-4 right-4 flex gap-3 z-10">
        {originalImageUrl && (
           <button
             onClick={(e) => {
               e.stopPropagation();
               setShowComparator(prev => !prev);
             }}
             className="text-white bg-black/50 rounded-full p-2 hover:bg-black/70 transition-colors focus:outline-none focus:ring-2 focus:ring-white"
             aria-label={showComparator ? "Hide comparison" : "Compare with original"}
           >
             <CompareIcon className="h-6 w-6" />
           </button>
        )}
        <button
          onClick={onClose}
          className="text-white bg-theme-accent/80 rounded-full p-2 hover:bg-theme-accent transition-colors focus:outline-none focus:ring-2 focus:ring-white"
          aria-label="Close fullscreen view"
        >
          <CloseIcon className="h-6 w-6" />
        </button>
      </div>

      <div
        className="relative w-full h-full max-w-screen-lg max-h-[90vh] flex items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        {showComparator && originalImageUrl ? (
            <ImageComparator originalImageUrl={originalImageUrl} editedImageUrl={imageUrl} />
        ) : (
            <img
                src={imageUrl}
                alt="Generated result in fullscreen"
                className="w-auto h-auto max-w-full max-h-full object-contain rounded-lg shadow-2xl"
            />
        )}
      </div>
    </div>
  );
};

export default ImageModal;