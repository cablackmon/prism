'use client';

import * as React from 'react';
import { useEffect, useCallback } from 'react';
import { X, ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useConfirmDialog } from '@/lib/hooks/useConfirmDialog';
import type { Photo, PhotoUsageTag } from '@/lib/hooks/usePhotos';
import { getResolutionQuality, parseUsageTags } from '@/lib/hooks/usePhotos';

interface PhotoLightboxProps {
  photos: Photo[];
  currentIndex: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
  onDelete: (photoId: string) => void;
  onUpdateUsage?: (photoId: string, usage: string) => void;
  autoOrientationEnabled?: boolean;
}

const qualityColors = { green: 'bg-green-500', yellow: 'bg-yellow-500', red: 'bg-red-500' };
const usageTags: { value: PhotoUsageTag; label: string }[] = [
  { value: 'wallpaper', label: 'Wallpaper' },
  { value: 'gallery', label: 'Gallery' },
  { value: 'screensaver', label: 'Screensaver' },
];

export function PhotoLightbox({
  photos,
  currentIndex,
  onClose,
  onNavigate,
  onDelete,
  onUpdateUsage,
  autoOrientationEnabled,
}: PhotoLightboxProps) {
  const { confirm, dialogProps: confirmDialogProps } = useConfirmDialog();
  const photo = photos[currentIndex];

  const goNext = useCallback(() => {
    onNavigate((currentIndex + 1) % photos.length);
  }, [currentIndex, photos.length, onNavigate]);

  const goPrev = useCallback(() => {
    onNavigate((currentIndex - 1 + photos.length) % photos.length);
  }, [currentIndex, photos.length, onNavigate]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') goNext();
      if (e.key === 'ArrowLeft') goPrev();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose, goNext, goPrev]);

  if (!photo) return null;

  const quality = getResolutionQuality(photo.width, photo.height);
  const dims = photo.width && photo.height ? `${photo.width}×${photo.height}` : 'Unknown';
  const orient =
    photo.orientation ??
    (photo.width && photo.height
      ? photo.width > photo.height
        ? 'landscape'
        : photo.width < photo.height
          ? 'portrait'
          : 'square'
      : null);

  const activeTags = parseUsageTags(photo.usage);

  const toggleTag = (tag: PhotoUsageTag) => {
    if (!onUpdateUsage) return;
    const current = new Set(activeTags);
    if (current.has(tag)) {
      current.delete(tag);
    } else {
      current.add(tag);
    }
    onUpdateUsage(photo.id, Array.from(current).join(','));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black">
      {/* Close */}
      <button
        onClick={onClose}
        className="absolute right-4 top-4 z-10 rounded-full bg-black/40 p-2 text-white hover:bg-black/60"
        aria-label="Close"
      >
        <X className="h-6 w-6" />
      </button>

      {/* Navigation arrows */}
      {photos.length > 1 && (
        <>
          <button
            onClick={goPrev}
            className="absolute left-4 z-10 rounded-full bg-black/40 p-2 text-white hover:bg-black/60"
            aria-label="Previous photo"
          >
            <ChevronLeft className="h-8 w-8" />
          </button>
          <button
            onClick={goNext}
            className="absolute right-4 z-10 rounded-full bg-black/40 p-2 text-white hover:bg-black/60"
            aria-label="Next photo"
          >
            <ChevronRight className="h-8 w-8" />
          </button>
        </>
      )}

      {/* Image */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/photos/${photo.id}/file`}
        alt={photo.originalFilename}
        className="max-h-[calc(100vh-100px)] max-w-full object-contain"
      />

      {/* Bottom bar - responsive layout */}
      <div className="absolute bottom-4 left-4 right-4 z-20 flex flex-col items-center gap-3">
        {/* Usage tags row - large touch-friendly buttons */}
        {onUpdateUsage && (
          <div className="flex flex-col items-center gap-3 rounded-2xl bg-black/70 px-6 py-4 backdrop-blur-sm">
            <span className="text-sm font-medium text-white/60">Tag for:</span>
            <div className="flex items-center gap-3">
              {usageTags.map((opt) => {
                const active = activeTags.includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      toggleTag(opt.value);
                    }}
                    onTouchEnd={(e) => {
                      e.preventDefault();
                      toggleTag(opt.value);
                    }}
                    className={`min-w-[120px] rounded-xl border-2 px-6 py-4 text-base font-semibold transition-all ${
                      active
                        ? 'border-primary bg-primary text-primary-foreground shadow-lg'
                        : 'border-white/20 bg-white/10 text-white/70 hover:border-white/40 hover:bg-white/20 hover:text-white'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            {autoOrientationEnabled && (
              <span className="text-xs text-white/40">Auto-orientation active</span>
            )}
          </div>
        )}

        {/* Info row */}
        <div className="flex items-center gap-4 rounded-xl bg-black/60 px-4 py-2.5 backdrop-blur-sm">
          <button
            onClick={async () => {
              if (await confirm('Delete this photo?', 'This action cannot be undone.')) {
                onDelete(photo.id);
                onClose();
              }
            }}
            className="rounded-full p-2 text-white hover:bg-white/10"
            aria-label="Delete photo"
          >
            <Trash2 className="h-5 w-5" />
          </button>

          <div className="h-6 w-px bg-white/20" />

          {/* Resolution info */}
          <div className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-full ${qualityColors[quality]}`} />
            <span className="text-sm text-white/80">{dims}</span>
          </div>

          {/* Orientation */}
          {orient && (
            <>
              <div className="h-6 w-px bg-white/20" />
              <span className="text-sm capitalize text-white/60">{orient}</span>
            </>
          )}

          <div className="h-6 w-px bg-white/20" />

          <span className="text-sm text-white/50">
            {currentIndex + 1} / {photos.length}
          </span>
        </div>
      </div>
      <ConfirmDialog {...confirmDialogProps} />
    </div>
  );
}
