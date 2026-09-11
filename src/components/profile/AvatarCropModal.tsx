'use client';

import React, { useState, useRef, useEffect } from 'react';
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
  const [rotation, setRotation] = useState(0);
  const [flipH, setFlipH] = useState(false);
  const [imgDimensions, setImgDimensions] = useState<{ width: number; height: number } | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');

  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const initialPanRef = useRef({ x: 0, y: 0 });
  const imageRef = useRef<HTMLImageElement | null>(null);

  // Reset transform whenever modal opens or imageSrc changes
  useEffect(() => {
    if (isOpen) {
      setZoom(1);
      setPan({ x: 0, y: 0 });
      setRotation(0);
      setFlipH(false);
      setError('');
      setImgDimensions(null);
    }
  }, [isOpen, imageSrc]);

  // Pointer drag handlers (smooth on mouse, touch, and stylus)
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    isDraggingRef.current = true;
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    initialPanRef.current = { ...pan };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch (_) {}
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setPan({
      x: initialPanRef.current.x + dx,
      y: initialPanRef.current.y + dy,
    });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    isDraggingRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch (_) {}
  };

  const handleRotateLeft = () => setRotation((prev) => (prev - 90 + 360) % 360);
  const handleRotateRight = () => setRotation((prev) => (prev + 90) % 360);
  const handleFlipHorizontal = () => setFlipH((prev) => !prev);
  const handleReset = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setRotation(0);
    setFlipH(false);
  };

  // Base sizing to cover the viewport cleanly
  const boxSize = 280; // Viewport container size
  const circleDiameter = 240; // Diameter of circular crop frame

  let baseWidth = boxSize;
  let baseHeight = boxSize;

  if (imgDimensions && imgDimensions.width > 0 && imgDimensions.height > 0) {
    const isRotated90 = rotation === 90 || rotation === 270;
    const effectiveWidth = isRotated90 ? imgDimensions.height : imgDimensions.width;
    const effectiveHeight = isRotated90 ? imgDimensions.width : imgDimensions.height;

    const baseScale = Math.max(circleDiameter / effectiveWidth, circleDiameter / effectiveHeight);
    baseWidth = imgDimensions.width * baseScale;
    baseHeight = imgDimensions.height * baseScale;
  }

  const handleCropAndUpload = async () => {
    if (!imageRef.current) return;
    setProcessing(true);
    setError('');

    try {
      const img = imageRef.current;
      const C = 512; // High-resolution output canvas (512x512)
      const canvas = document.createElement('canvas');
      canvas.width = C;
      canvas.height = C;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas rendering context unavailable');

      // 1. Circular clipping mask
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.beginPath();
      ctx.arc(C / 2, C / 2, C / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();

      // 2. Scale factor from screen preview (circleDiameter = 240px) to output canvas (512px)
      const F = C / circleDiameter;

      ctx.save();
      // Move to canvas center + scaled user pan offset
      ctx.translate(C / 2 + pan.x * F, C / 2 + pan.y * F);
      ctx.rotate((rotation * Math.PI) / 180);
      if (flipH) ctx.scale(-1, 1);

      // Draw the image centered at translation point
      const drawW = baseWidth * zoom * F;
      const drawH = baseHeight * zoom * F;
      ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
      ctx.restore();

      // 3. Compress to ensure strictly <= 5MB
      const maxSizeBytes = 5 * 1024 * 1024;
      let quality = 0.92;

      const exportBlob = (q: number): Promise<Blob | null> => {
        return new Promise((resolve) => {
          canvas.toBlob(resolve, 'image/jpeg', q);
        });
      };

      let blob: Blob | null = await exportBlob(quality);

      while (blob && blob.size > maxSizeBytes && quality > 0.2) {
        quality -= 0.05;
        blob = await exportBlob(quality);
      }

      if (!blob) throw new Error('Failed to process image');

      // 4. Upload to Supabase Storage 'avatars' bucket
      const filePath = `${userId}/${Date.now()}.jpg`;
      let finalAvatarUrl: string = '';

      try {
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
          if (publicUrlData?.publicUrl) {
            finalAvatarUrl = publicUrlData.publicUrl;
          }
        }
      } catch (storageErr) {
        console.warn('Storage upload error, falling back to base64:', storageErr);
      }

      // Fallback to high-quality base64 if storage bucket is not provisioned
      if (!finalAvatarUrl) {
        finalAvatarUrl = canvas.toDataURL('image/jpeg', Math.min(quality, 0.85));
      }

      // 5. Persist directly to Supabase profile immediately
      const { error: profileError } = await supabase
        .from('profiles')
        .update({ avatar_url: finalAvatarUrl })
        .eq('id', userId);

      if (profileError) {
        console.warn('Profile direct update notice:', profileError.message);
      }

      // 6. Notify application components in real-time
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('debtsync:user_updated', {
            detail: { avatarUrl: finalAvatarUrl },
          })
        );
      }

      onAvatarSaved(finalAvatarUrl);
      onClose();
    } catch (err: any) {
      console.error('Crop & Save Error:', err);
      setError(err.message || 'Failed to crop and save avatar');
    } finally {
      setProcessing(false);
    }
  };

  if (!isOpen || !imageSrc) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Edit & Crop Profile Picture"
      subtitle="Drag to reposition, use the slider to zoom, and rotate or flip as needed. Compressed under 5MB."
      maxWidth="max-w-md"
    >
      <div className="flex flex-col items-center gap-4">
        {error && (
          <div className="w-full p-3 rounded-xl bg-red-50 dark:bg-red-900/20 text-error text-xs font-mono border border-error/30">
            {error}
          </div>
        )}

        {/* Viewport Crop Box */}
        <div
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className="relative w-[280px] h-[280px] rounded-2xl overflow-hidden bg-surface-container-highest flex items-center justify-center select-none touch-none cursor-grab active:cursor-grabbing border-2 border-primary/40 shadow-inner"
        >
          {/* Image */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imageRef}
            src={imageSrc}
            alt="Crop target"
            draggable={false}
            crossOrigin="anonymous"
            onLoad={(e) => {
              const img = e.currentTarget;
              setImgDimensions({
                width: img.naturalWidth || 500,
                height: img.naturalHeight || 500,
              });
            }}
            style={{
              width: `${baseWidth * zoom}px`,
              height: `${baseHeight * zoom}px`,
              maxWidth: 'none',
              maxHeight: 'none',
              transform: `translate(${pan.x}px, ${pan.y}px) rotate(${rotation}deg) scaleX(${flipH ? -1 : 1})`,
              transformOrigin: 'center center',
              transition: isDraggingRef.current ? 'none' : 'transform 0.05s ease-out',
              pointerEvents: 'none',
              userSelect: 'none',
            }}
            className="shrink-0"
          />

          {/* Circular Cutout Mask Overlay with 65% outer dimming */}
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div className="w-[240px] h-[240px] rounded-full border-2 border-dashed border-primary shadow-[0_0_0_9999px_rgba(0,0,0,0.65)]" />
          </div>

          <span className="absolute bottom-2.5 left-1/2 -translate-x-1/2 text-[10px] font-mono uppercase tracking-wider text-white/80 bg-black/60 px-2.5 py-0.5 rounded-full pointer-events-none backdrop-blur-xs flex items-center gap-1">
            <span className="material-symbols-outlined text-[13px]">drag_pan</span>
            <span>Drag to Reposition</span>
          </span>
        </div>

        {/* Quick Transform Controls (Rotate Left, Rotate Right, Flip, Reset) */}
        <div className="flex items-center justify-center gap-2 w-full">
          <button
            type="button"
            onClick={handleRotateLeft}
            className="p-2 rounded-xl bg-surface-container-low hover:bg-surface-container border border-outline-variant/30 text-on-surface text-xs font-mono transition-colors flex items-center gap-1 cursor-pointer"
            title="Rotate 90° Left"
          >
            <span className="material-symbols-outlined text-[16px]">rotate_left</span>
            <span className="text-[11px]">-90°</span>
          </button>
          <button
            type="button"
            onClick={handleRotateRight}
            className="p-2 rounded-xl bg-surface-container-low hover:bg-surface-container border border-outline-variant/30 text-on-surface text-xs font-mono transition-colors flex items-center gap-1 cursor-pointer"
            title="Rotate 90° Right"
          >
            <span className="material-symbols-outlined text-[16px]">rotate_right</span>
            <span className="text-[11px]">+90°</span>
          </button>
          <button
            type="button"
            onClick={handleFlipHorizontal}
            className={`p-2 rounded-xl border text-xs font-mono transition-colors flex items-center gap-1 cursor-pointer ${
              flipH
                ? 'bg-primary/15 border-primary text-primary font-bold'
                : 'bg-surface-container-low hover:bg-surface-container border-outline-variant/30 text-on-surface'
            }`}
            title="Flip Horizontal"
          >
            <span className="material-symbols-outlined text-[16px]">flip</span>
            <span className="text-[11px]">Flip</span>
          </button>
          <button
            type="button"
            onClick={handleReset}
            className="p-2 rounded-xl bg-surface-container-low hover:bg-surface-container border border-outline-variant/30 text-on-surface text-xs font-mono transition-colors flex items-center gap-1 cursor-pointer"
            title="Reset to Center"
          >
            <span className="material-symbols-outlined text-[16px]">refresh</span>
            <span className="text-[11px]">Reset</span>
          </button>
        </div>

        {/* Zoom Slider */}
        <div className="w-full space-y-1.5 px-2">
          <div className="flex justify-between items-center text-xs font-mono text-on-surface-variant">
            <span className="flex items-center gap-1 font-semibold">
              <span className="material-symbols-outlined text-[16px]">zoom_in</span>
              <span>Zoom</span>
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(1, +(z - 0.1).toFixed(2)))}
                disabled={zoom <= 1}
                className="w-6 h-6 rounded-md bg-surface-container border border-outline-variant/30 text-on-surface hover:bg-surface-container-high flex items-center justify-center text-sm disabled:opacity-40 cursor-pointer"
              >
                -
              </button>
              <span className="w-12 text-center font-bold text-on-surface">{Math.round(zoom * 100)}%</span>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(3.5, +(z + 0.1).toFixed(2)))}
                disabled={zoom >= 3.5}
                className="w-6 h-6 rounded-md bg-surface-container border border-outline-variant/30 text-on-surface hover:bg-surface-container-high flex items-center justify-center text-sm disabled:opacity-40 cursor-pointer"
              >
                +
              </button>
            </div>
          </div>
          <input
            type="range"
            min="1"
            max="3.5"
            step="0.05"
            value={zoom}
            onChange={(e) => setZoom(parseFloat(e.target.value))}
            className="w-full accent-primary cursor-pointer h-2 bg-surface-container rounded-lg"
          />
        </div>

        {/* Actions */}
        <div className="flex gap-3 w-full pt-3 border-t border-outline-variant/20">
          <button
            type="button"
            onClick={onClose}
            disabled={processing}
            className="flex-1 py-2.5 rounded-xl border border-outline-variant/40 font-mono text-xs font-bold text-on-surface hover:bg-surface-container transition-colors disabled:opacity-50 cursor-pointer"
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
                <span>Saving Avatar...</span>
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-[16px]">check</span>
                <span>Apply &amp; Save Avatar</span>
              </>
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}
