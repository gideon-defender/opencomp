'use client';

import { useState } from 'react';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@gideon-defender/ui/dialog';
import { useTranslations } from 'next-intl';
import Image from 'next/image';
import { CarouselControls } from '../video/CarouselControls';

interface PolicyImagePreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  images: string[];
}

export function PolicyImagePreviewModal({
  open,
  images,
  onOpenChange,
}: PolicyImagePreviewModalProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const t = useTranslations('modals');

  // Reset to the first image when the modal opens or the list changes.
  // Replaces the equivalent effect; the guard mirrors `[open, images.length]`.
  const [prevOpen, setPrevOpen] = useState(open);
  const [prevLength, setPrevLength] = useState(images.length);
  if (open && (prevOpen !== open || prevLength !== images.length)) {
    setPrevOpen(open);
    setPrevLength(images.length);
    setCurrentIndex(0);
  }

  const hasImages = images.length > 0;

  const goPrevious = () => {
    setCurrentIndex((prev) => (prev === 0 ? images.length - 1 : prev - 1));
  };

  const goNext = () => {
    setCurrentIndex((prev) => (prev === images.length - 1 ? 0 : prev + 1));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('previewTitle')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {!hasImages && <p className="text-sm text-muted-foreground">{t('noImages')}</p>}

          {hasImages && currentIndex >= 0 && currentIndex < images.length && (
            <>
              <div className="h-[55vh] min-h-[280px] w-full overflow-hidden md:min-h-[420px]">
                <Image
                  key={images[currentIndex]}
                  src={images[currentIndex]}
                  alt={`Policy image ${currentIndex + 1}`}
                  width={800}
                  height={600}
                  className="h-full w-full object-contain"
                />
              </div>
              <CarouselControls
                currentIndex={currentIndex}
                total={images.length}
                onPrevious={goPrevious}
                onNext={goNext}
              />
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
