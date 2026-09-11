'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Modal } from '../ui/Modal';
import { createClient } from '@/lib/supabase/client';
import { manageCustomAvatarsOnUpload, getLocalRecentAvatars } from '@/lib/utils/avatar-storage';

interface AvatarCropModalProps {
  isOpen: boolean;
  onClose: () => void;
  imageSrc: string | null;
  userId: string;
  currentRecent?: string[];
  onAvatarSaved: (newUrl: string, updatedRecent?: string[]) => void;
}

export function AvatarCropModal({
  isOpen,
  onClose,
  imageSrc,
  userId,
  currentRecent,
  onAvatarSaved,
}: AvatarCropModalProps) {
  const supabase = createClient();

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [imgDimensions, setImgDimensions] = useState<{ width: number; height: number } | null>(null);
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(null);
  const [loadingImage, setLoadingImage] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');

  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const initialPanRef = useRef({ x: 0, y: 0 });
  const imageRef = useRef<HTMLImageElement | null>(null);

  // Viewport circle diameter in px
  const circleDiameter = 240;

  // Prepare image source and measure natural dimensions safely
  useEffect(() => {
    let active = true;
    let localBlobUrl: string | null = null;

    async function prepareImage() {
      if (!imageSrc) {
        setResolvedSrc(null);
        setImgDimensions(null);
        return;
      }

      setLoadingImage(true);
      setError('');
      setZoom(1);
      setPan({ x: 0, y: 0 });

      try {
        let srcToMeasure = imageSrc;

        // Remote images (e.g. DiceBear preset SVGs or external URLs):
        // Fetch to local blob URL to bypass CORS/tainted canvas issues and ensure SVG dimensions
        if (imageSrc.startsWith('http://') || imageSrc.startsWith('https://')) {
          try {
            const res = await fetch(imageSrc);
            if (!res.ok) throw new Error(`Failed to fetch image (${res.status})`);
            const contentType = res.headers.get('content-type') || '';

            if (contentType.includes('svg') || imageSrc.includes('/svg')) {
              let svgText = await res.text();
              // Inject explicit dimensions if missing so SVG naturalWidth/Height is guaranteed
              if (!svgText.includes('width=') || !svgText.includes('height=')) {
                svgText = svgText.replace(/<svg\b([^>]*)>/i, '<svg width="512" height="512" $1>');
              }
              const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
              localBlobUrl = URL.createObjectURL(blob);
              srcToMeasure = localBlobUrl;
            } else {
              const blob = await res.blob();
              localBlobUrl = URL.createObjectURL(blob);
              srcToMeasure = localBlobUrl;
            }
          } catch (fetchErr) {
            console.warn('Could not proxy remote image to local blob, falling back to direct URL:', fetchErr);
            srcToMeasure = imageSrc;
          }
        }

        // Measure true intrinsic dimensions
        const testImg = new Image();
        testImg.crossOrigin = 'anonymous';

        testImg.onload = () => {
          if (!active) return;
          const w = testImg.naturalWidth > 0 ? testImg.naturalWidth : 512;
          const h = testImg.naturalHeight > 0 ? testImg.naturalHeight : 512;
          setImgDimensions({ width: w, height: h });
          setResolvedSrc(srcToMeasure);
          setLoadingImage(false);
        };

        testImg.onerror = () => {
          if (!active) return;
          // Fallback square if natural dimensions couldn't be loaded
          setImgDimensions({ width: 512, height: 512 });
          setResolvedSrc(srcToMeasure);
          setLoadingImage(false);
        };

        testImg.src = srcToMeasure;
      } catch (err: any) {
        if (!active) return;
        console.error('Error preparing image for crop:', err);
        setResolvedSrc(imageSrc);
        setLoadingImage(false);
      }
    }

    if (isOpen) {
      prepareImage();
    }

    return () => {
      active = false;
      if (localBlobUrl) {
        URL.revokeObjectURL(localBlobUrl);
      }
    };
  }, [isOpen, imageSrc]);

  // Pointer drag handlers (mouse, touch, and stylus)
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

  const handleReset = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  // Base sizing strictly locking the natural aspect ratio R = W / H
  // Never deform or widen the photo
  let baseWidth = circleDiameter;
  let baseHeight = circleDiameter;

  if (imgDimensions && imgDimensions.width > 0 && imgDimensions.height > 0) {
    const W = imgDimensions.width;
    const H = imgDimensions.height;
    const aspect = W / H;

    if (aspect >= 1) {
      // Landscape or square: lock height to circle diameter, width scales proportionally
      baseHeight = circleDiameter;
      baseWidth = circleDiameter * aspect;
    } else {
      // Portrait: lock width to circle diameter, height scales proportionally
      baseWidth = circleDiameter;
      baseHeight = circleDiameter / aspect;
    }
  }

  const handleCropAndUpload = async () => {
    if (!imageRef.current || !imgDimensions) return;
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

      // Draw the image centered at translation point preserving exact aspect ratio
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

      // Fallback to high-quality data URL if storage bucket is not provisioned
      if (!finalAvatarUrl) {
        finalAvatarUrl = canvas.toDataURL('image/jpeg', Math.min(quality, 0.85));
      }

      // 5. Enforce strictly max 2 recent custom photos; delete older ones from server storage
      const existingList = currentRecent && currentRecent.length > 0
        ? currentRecent
        : getLocalRecentAvatars(userId);

      const updatedRecent = await manageCustomAvatarsOnUpload(
        supabase,
        userId,
        finalAvatarUrl,
        existingList
      );

      // Persist directly to Supabase profile immediately
      try {
        const { error: profileError } = await supabase
          .from('profiles')
          .update({
            avatar_url: finalAvatarUrl,
            recent_custom_avatars: updatedRecent,
          })
          .eq('id', userId);

        if (profileError) {
          // If recent_custom_avatars column does not exist in DB yet, fallback gracefully
          await supabase
            .from('profiles')
            .update({ avatar_url: finalAvatarUrl })
            .eq('id', userId);
        }
      } catch (profileErr) {
        console.warn('Profile direct update notice:', profileErr);
      }

      // 6. Notify application components in real-time
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('debtsync:user_updated', {
            detail: {
              avatarUrl: finalAvatarUrl,
              recentCustomAvatars: updatedRecent,
            },
          })
        );
      }

      onAvatarSaved(finalAvatarUrl, updatedRecent);
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
      title="Edit &amp; Crop Profile Picture"
      subtitle="Drag to reposition and use the zoom slider to frame your picture. Automatically compressed under 5MB."
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
          {loadingImage ? (
            <div className="flex flex-col items-center justify-center gap-2 text-on-surface-variant">
              <span className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              <span className="font-mono text-xs">Loading image...</span>
            </div>
          ) : resolvedSrc ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              ref={imageRef}
              src={resolvedSrc}
              alt="Crop target"
              draggable={false}
              crossOrigin="anonymous"
              style={{
                width: `${baseWidth * zoom}px`,
                height: `${baseHeight * zoom}px`,
                maxWidth: 'none',
                maxHeight: 'none',
                aspectRatio: imgDimensions ? `${imgDimensions.width} / ${imgDimensions.height}` : 'auto',
                transform: `translate(${pan.x}px, ${pan.y}px)`,
                transformOrigin: 'center center',
                transition: isDraggingRef.current ? 'none' : 'transform 0.05s ease-out',
                pointerEvents: 'none',
                userSelect: 'none',
              }}
              className="shrink-0"
            />
          ) : null}

          {/* Circular Cutout Mask Overlay with 65% outer dimming */}
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div className="w-[240px] h-[240px] rounded-full border-2 border-dashed border-primary shadow-[0_0_0_9999px_rgba(0,0,0,0.65)]" />
          </div>

          <span className="absolute bottom-2.5 left-1/2 -translate-x-1/2 text-[10px] font-mono uppercase tracking-wider text-white/90 bg-black/70 px-2.5 py-0.5 rounded-full pointer-events-none backdrop-blur-xs flex items-center gap-1 shadow-sm">
            <span className="material-symbols-outlined text-[13px]">drag_pan</span>
            <span>Drag to Reposition</span>
          </span>
        </div>

        {/* Zoom Controls & Reset */}
        <div className="w-full space-y-2 px-1">
          <div className="flex justify-between items-center text-xs font-mono text-on-surface-variant">
            <span className="flex items-center gap-1 font-semibold text-on-surface">
              <span className="material-symbols-outlined text-[16px] text-primary">zoom_in</span>
              <span>Zoom</span>
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(1, +(z - 0.1).toFixed(2)))}
                disabled={zoom <= 1}
                className="w-6 h-6 rounded-md bg-surface-container border border-outline-variant/30 text-on-surface hover:bg-surface-container-high flex items-center justify-center text-sm disabled:opacity-40 cursor-pointer transition-colors"
                title="Zoom Out"
              >
                -
              </button>
              <span className="w-12 text-center font-bold text-on-surface">{Math.round(zoom * 100)}%</span>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(3, +(z + 0.1).toFixed(2)))}
                disabled={zoom >= 3}
                className="w-6 h-6 rounded-md bg-surface-container border border-outline-variant/30 text-on-surface hover:bg-surface-container-high flex items-center justify-center text-sm disabled:opacity-40 cursor-pointer transition-colors"
                title="Zoom In"
              >
                +
              </button>
              <button
                type="button"
                onClick={handleReset}
                className="ml-2 px-2 py-1 rounded-md bg-surface-container border border-outline-variant/30 text-on-surface hover:bg-surface-container-high text-[11px] font-mono flex items-center gap-1 cursor-pointer transition-colors"
                title="Reset zoom and position"
              >
                <span className="material-symbols-outlined text-[14px]">refresh</span>
                <span>Reset</span>
              </button>
            </div>
          </div>
          <input
            type="range"
            min="1"
            max="3"
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
            disabled={processing || loadingImage}
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
