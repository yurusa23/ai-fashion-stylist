



import React, { useCallback, ChangeEvent, useId, useState, DragEvent, KeyboardEvent, ClipboardEvent, useEffect, useRef } from 'react';
import { UploadedImageInfo, Base64String } from '../types';
import { UploadIcon, CloseIcon } from './icons';

// --- Web Worker Code as a string ---
// This avoids needing a separate file and build configuration for the worker.
const workerCode = `
  const fileToBase64 = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = (error) => reject(error);
    });
  };

  const resizeImage = async (file, maxSize) => {
    // createImageBitmap is the worker-friendly way to decode an image
    const imageBitmap = await createImageBitmap(file);
    
    let { width, height } = imageBitmap;

    if (width > height) {
      if (width > maxSize) {
        height *= maxSize / width;
        width = maxSize;
      }
    } else {
      if (height > maxSize) {
        width *= maxSize / height;
        height = maxSize;
      }
    }
    
    width = Math.round(width);
    height = Math.round(height);

    // OffscreenCanvas is the worker-friendly equivalent of <canvas>
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Could not get OffscreenCanvas context.');
    }

    ctx.drawImage(imageBitmap, 0, 0, width, height);
    
    // convertToBlob is the OffscreenCanvas equivalent to toBlob
    const blob = await canvas.convertToBlob({
      type: 'image/webp',
      quality: 0.85,
    });
    
    if (!blob) {
      throw new Error('Canvas to Blob conversion failed.');
    }

    return new File([blob], file.name, {
      type: 'image/webp',
      lastModified: Date.now(),
    });
  };

  self.onmessage = async (e) => {
    const { file } = e.data;
    try {
      const resizedFile = await resizeImage(file, 1024);
      const base64 = await fileToBase64(resizedFile);
      self.postMessage({ success: true, base64, mimeType: resizedFile.type });
    } catch (error) {
      // FIX: The 'error' object in a catch block is of type 'unknown'. We must check if it's an
      // Error instance before accessing properties like 'message' to avoid runtime errors.
      const errorMessage = error instanceof Error ? error.message : String(error);
      self.postMessage({ success: false, error: errorMessage });
    }
  };
`;


interface ImageUploaderProps {
  onImagesChange: (images: UploadedImageInfo[]) => void;
  currentImages: UploadedImageInfo[];
  maxImages?: number;
}

const ImageUploader: React.FC<ImageUploaderProps> = ({
  onImagesChange,
  currentImages,
  maxImages = 1,
}) => {
  const uploaderId = useId();
  const [isDragging, setIsDragging] = useState(false);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    // Create worker from blob URL
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    const worker = new Worker(URL.createObjectURL(blob));
    workerRef.current = worker;

    return () => {
      worker.terminate();
    };
  }, []);

  const processFiles = useCallback(async (files: File[]) => {
    if (!workerRef.current) return;

    const imageFiles = files.filter(file => file.type.startsWith('image/'));
    const results: UploadedImageInfo[] = [];
    let processedCount = 0;

    workerRef.current.onmessage = (e: MessageEvent) => {
        const { success, base64, mimeType, error } = e.data;
        if (success) {
            results.push({ base64: base64 as Base64String, mimeType });
        } else {
            console.error("Error processing file in worker:", error);
            // Optionally show an error to the user
        }
        
        processedCount++;
        if (processedCount === imageFiles.length) {
           if (results.length > 0) {
              onImagesChange([...currentImages, ...results].slice(0, maxImages));
           }
        }
    };

    imageFiles.forEach(file => {
      workerRef.current?.postMessage({ file });
    });

  }, [currentImages, maxImages, onImagesChange]);

  const handleFilesChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) {
        processFiles(Array.from(e.target.files));
      }
      e.target.value = ''; // Allow re-uploading the same file
    },
    [processFiles]
  );

  const handleDrop = useCallback((e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files) {
        processFiles(Array.from(e.dataTransfer.files));
    }
  }, [processFiles]);

  const handleDragEvents = (e: DragEvent<HTMLLabelElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.type === 'dragover' || e.type === 'dragenter') {
          setIsDragging(true);
      } else if (e.type === 'dragleave') {
          setIsDragging(false);
      }
  };

  const handlePaste = useCallback((e: ClipboardEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const pastedFiles = Array.from(e.clipboardData.files).filter(file => file.type.startsWith('image/'));
    if (pastedFiles.length > 0) {
      processFiles(pastedFiles);
    }
  }, [processFiles]);

  const handleKeyDown = (e: KeyboardEvent<HTMLLabelElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      document.getElementById(uploaderId)?.click();
    }
  };

  const handleRemoveImage = useCallback(
    (indexToRemove: number) => {
      onImagesChange(
        currentImages.filter((_, index) => index !== indexToRemove)
      );
    },
    [currentImages, onImagesChange]
  );

  const baseDropzoneClasses = "w-full h-full p-4 bg-black/5 rounded-lg border-2 border-dashed flex items-center justify-center transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-theme-bg focus:ring-theme-accent";
  const draggingDropzoneClasses = "border-theme-accent bg-theme-accent/10";
  const defaultDropzoneClasses = "border-theme-gray-light hover:border-theme-accent";
  
  // Single image uploader layout - DEPRECATED in favor of multi-uploader, but kept for potential future use
  if (maxImages === 1) {
    const image = currentImages[0];
    return (
        <div className="w-full h-full">
            <label
            htmlFor={uploaderId}
            onDrop={handleDrop}
            onDragOver={handleDragEvents}
            onDragEnter={handleDragEvents}
            onDragLeave={handleDragEvents}
            onPaste={handlePaste}
            onKeyDown={handleKeyDown}
            tabIndex={0}
            className={`${baseDropzoneClasses} ${isDragging ? draggingDropzoneClasses : defaultDropzoneClasses} cursor-pointer flex flex-col text-theme-gray-dark`}
            aria-label="인물 사진 업로드: 클릭, 드래그, 또는 붙여넣기로 패션 스타일링에 사용할 사진을 추가하세요"
            >
            {image ? (
                <div className="relative w-full h-full animate-scale-in">
                <img
                    src={`data:${image.mimeType};base64,${image.base64}`}
                    alt="Upload preview"
                    className="max-w-full max-h-full object-contain rounded-md"
                />
                <button
                    onClick={(e) => {
                    e.preventDefault();
                    handleRemoveImage(0);
                    }}
                    className="absolute top-2 right-2 bg-theme-text/60 text-white rounded-full p-1 hover:bg-theme-text transition-colors"
                    aria-label="Remove image"
                >
                    <CloseIcon className="w-4 h-4" />
                </button>
                </div>
            ) : (
                <div className="text-center pointer-events-none">
                <UploadIcon className="mx-auto h-12 w-12" />
                <p className="mt-2 text-base text-theme-text">클릭, 드래그, 또는 붙여넣기</p>
                <p className="text-sm text-theme-gray-dark">PNG, JPG, WEBP</p>
                </div>
            )}
            </label>
            <input
            id={uploaderId}
            name="file-upload"
            type="file"
            className="sr-only"
            accept="image/*"
            onChange={handleFilesChange}
            />
        </div>
    );
  }

  // Multi image uploader layout
  return (
    <div className="w-full h-full">
       <label 
         htmlFor={uploaderId} 
         className={`${baseDropzoneClasses} p-2 ${isDragging ? draggingDropzoneClasses : defaultDropzoneClasses} cursor-pointer`}
         onDrop={handleDrop}
         onDragOver={handleDragEvents}
         onDragEnter={handleDragEvents}
         onDragLeave={handleDragEvents}
         onPaste={handlePaste}
         onKeyDown={handleKeyDown}
         tabIndex={0}
         aria-label="인물 사진 업로드: 클릭, 드래그, 또는 붙여넣기로 패션 스타일링에 사용할 사진들을 추가하세요"
       >
        {currentImages.length === 0 ? (
          <div className="w-full h-full flex flex-col items-center justify-center text-theme-gray-dark">
            <div className="text-center pointer-events-none">
                <UploadIcon className="mx-auto h-12 w-12" />
                <p className="mt-2 text-base text-theme-text">클릭, 드래그, 또는 붙여넣기</p>
                <p className="text-sm">최대 5장 (PNG, JPG, WEBP)</p>
            </div>
          </div>
       ) : (
        <div className="w-full h-full grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 pointer-events-none">
            {currentImages.map((image, index) => (
                <div key={index} className="relative aspect-square rounded-md overflow-hidden group bg-theme-bg pointer-events-auto animate-scale-in">
                    <img src={`data:${image.mimeType};base64,${image.base64}`} alt={`Preview ${index + 1}`} className="w-full h-full object-cover" />
                    <button
                        onClick={(e) => {e.preventDefault(); handleRemoveImage(index);}}
                        className="absolute top-1 right-1 bg-theme-text/60 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 hover:bg-theme-text transition-all"
                        aria-label={`Remove image ${index + 1}`}
                    >
                        <CloseIcon className="w-4 h-4" />
                    </button>
                </div>
            ))}
            {currentImages.length < maxImages && (
                <div className="aspect-square pointer-events-auto">
                     <div className="w-full h-full flex flex-col items-center justify-center text-theme-gray-dark rounded-md border-2 border-dashed border-theme-gray-light hover:border-theme-accent hover:text-theme-accent transition-colors">
                        <UploadIcon className="h-8 w-8" />
                        <span className="text-sm mt-2 text-center">사진 추가 ({currentImages.length}/{maxImages})</span>
                    </div>
                </div>
            )}
        </div>
       )}
      </label>
      <input id={uploaderId} name="file-upload" type="file" multiple className="sr-only" accept="image/*" onChange={handleFilesChange} />
    </div>
  );
};

export default ImageUploader;