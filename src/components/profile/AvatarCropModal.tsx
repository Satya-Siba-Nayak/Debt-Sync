'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Modal } from '../ui/Modal';
import { createClient } from '@/lib/supabase/client';

interface AvatarCropModalProps {
  isOpen: boolean;
  onClose: () => void;
  imageSrc: string | null;
  userId: string;
  onAvatarSaved: (newUrl: string) => void;
}

export function AvatarCropModal({
  isOpen,
  onClose,
  imageSrc,
  userId,
  onAvatarSaved,
}: AvatarCropModalProps) {
  const supabase = createClient();

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');

  const imageRef = useRef<HTMLImageElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Reset transform when new image loads
  useEffect(() => {
    if (isOpen) {
      setZoom(1);
      setPan({ x: 0, y: 0 });
      setError('');
    }
  }, [isOpen, imageSrc]);

  // Pan handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  };

  const handleMouseUp = () => setIsDragging(false);

  // Touch handlers for mobile
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      setIsDragging(true);
      setDragStart({ x: e.touches[0].clientX - pan.x, y: e.touches[0].clientY - pan.y });
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging || e.touches.length !== 1) return;
    setPan({ x: e.touches[0].clientX - dragStart.x, y: e.touches[0].clientY - dragStart.y });
  };

  const handleTouchEnd = () => setIsDragging(false);

  const handleCropAndUpload = async () => {
    if (!imageRef.current || !containerRef.current) return;
    setProcessing(true);
    setError('');

    try {
      const img = imageRef.current;
      const cropSize = 512; // High-resolution avatar
      const canvas = document.createElement('canvas');
      canvas.width = cropSize;
      canvas.height = cropSize;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas not available');

      // Visual box size
      const boxSize = 260;
      const naturalWidth = img.naturalWidth;
      const naturalHeight = img.naturalHeight;

      // Base displayed dimensions of image at zoom=1 (contained in box)
      const baseScale = Math.max(boxSize / naturalWidth, boxSize / naturalHeight);
      const displayedWidth = naturalWidth * baseScale * zoom;
      const displayedHeight = naturalHeight * baseScale * zoom;

      // Center offset of displayed image relative to box center
      const imgCenterX = boxSize / 2 + pan.x;
      const imgCenterY = boxSize / 2 + pan.y;

      const imgLeftInBox = imgCenterX - displayedWidth / 2;
      const imgTopInBox = imgCenterY - displayedHeight / 2;

      // Map [0, boxSize] back to image pixel coordinates
      const scaleX = naturalWidth / displayedWidth;
      const scaleY = naturalHeight / displayedHeight;

      const sx = Math.max(0, -imgLeftInBox * scaleX);
      const sy = Math.max(0, -imgTopInBox * scaleY);
      const sWidth = Math.min(naturalWidth - sx, boxSize * scaleX);
      const sHeight = Math.min(naturalHeight - sy, boxSize * scaleY);

      // Render circular clipped avatar onto canvas
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, cropSize, cropSize);

      // Compress to ensure <= 5MB (5,242,880 bytes)
      const maxSizeBytes = 5 * 1024 * 1024;
      let quality = 0.92;
      let blob: Blob | null = null;

      // Helper to export blob
      const getBlob = (q: number): Promise<Blob | null> => {
        return new Promise((resolve) => {
          canvas.toBlob((b) => resolve(b), 'image/jpeg', q);
        });
      };

      blob = await getBlob(quality);

      // If larger than 5MB, reduce quality progressively
      while (blob && blob.size > maxSizeBytes && quality > 0.2) {
        quality -= 0.1;
        blob = await getBlob(quality);
      }

      if (!blob) throw new Error('Could not process image');

      // Upload to Supabase Storage 'avatars' bucket
      const filePath = `${userId}/${Date.now()}.jpg`;
      let finalAvatarUrl: string = '';

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, blob, {
          contentType: 'image/jpeg',
          upsert: true,
        });

      if (!uploadError && uploadData) {
        const { data: publicUrlData } = supabase.storage
          .from('avatars')
          .getPublicUrl(filePath);
        finalAvatarUrl = publicUrlData.publicUrl;
      } else {
        // Fallback to compressed base64 data URL if bucket is not yet active
        console.warn('Storage upload fallback to base64:', uploadError?.message);
        finalAvatarUrl = canvas.toDataURL('image/jpeg', Math.min(quality, 0.8));
      }

      onAvatarSaved(finalAvatarUrl);
      onClose();
    } catch (err: any) {
      console.error('Crop & Upload Error:', err);
      setError(err.message || 'Failed to process and upload avatar');
    } finally {
      setProcessing(false);
    }
  };

  if (!isOpen || !imageSrc) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Crop Profile Picture"
      subtitle="Drag to reposition and use the slider to zoom. Image will be compressed under 5MB."
      maxWidth="max-w-md"
    >
      <div className="flex flex-col items-center gap-5">
        {error && (
          <div className="w-full p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-error text-xs font-mono border border-error/30">
            {error}
          </div>
        )}

        {/* Viewport Crop Box */}
        <div
          ref={containerRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          className="relative w-[260px] h-[260px] rounded-2xl overflow-hidden bg-black/80 cursor-grab active:cursor-grabbing select-none border-2 border-primary/40 shadow-inner flex items-center justify-center"
        >
          {/* Image */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imageRef}
            src={imageSrc}
            alt="Crop target"
            draggable={false}
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: 'center center',
              transition: isDragging ? 'none' : 'transform 0.05s ease-out',
            }}
            className="max-w-none pointer-events-none"
          />

          {/* Circular Mask Overlay */}
          <div className="absolute inset-0 pointer-events-none rounded-2xl border-[20px] border-black/60">
            <div className="w-full h-full rounded-full border-2 border-dashed border-primary/70" />
          </div>

          <span className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[10px] font-mono uppercase tracking-wider text-white/70 bg-black/60 px-2 py-0.5 rounded-full pointer-events-none">
            Drag to Reposition
          </span>
        </div>

        {/* Zoom Slider */}
        <div className="w-full space-y-1.5 px-2">
          <div className="flex justify-between text-xs font-mono text-on-surface-variant">
            <span className="flex items-center gap-1">
              <span className="material-symbols-outlined text-[15px]">zoom_out</span>
              <span>Zoom</span>
            </span>
            <span>{Math.round(zoom * 100)}%</span>
          </div>
          <input
            type="range"
            min="1"
            max="3"
            step="0.05"
            value={zoom}
            onChange={(e) => setZoom(parseFloat(e.target.value))}
            className="w-full accent-primary cursor-pointer"
          />
        </div>

        {/* Actions */}
        <div className="flex gap-3 w-full pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={processing}
            className="flex-1 py-2.5 rounded-xl border border-outline-variant/40 font-mono text-xs font-bold text-on-surface hover:bg-surface-container transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCropAndUpload}
            disabled={processing}
            className="flex-1 py-2.5 rounded-xl bg-primary text-on-primary font-mono text-xs font-bold hover:opacity-90 transition-opacity shadow-sm flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
          >
            {processing ? (
              <>
                <span className="w-3.5 h-3.5 rounded-full border-2 border-on-primary border-t-transparent animate-spin" />
                <span>Processing...</span>
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-[16px]">crop</span>
                <span>Save Avatar</span>
              </>
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}
