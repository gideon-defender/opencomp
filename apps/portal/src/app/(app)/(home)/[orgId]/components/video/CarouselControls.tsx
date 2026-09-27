import { Button, Text } from '@trycompai/design-system';
import { ChevronLeft, ChevronRight } from '@trycompai/design-system/icons';
import { useTranslations } from 'next-intl';

interface CarouselControlsProps {
  currentIndex: number;
  total: number;
  onPrevious: () => void;
  onNext?: () => void;
}

export function CarouselControls({
  currentIndex,
  total,
  onPrevious,
  onNext,
}: CarouselControlsProps) {
  const isFirstVideo = currentIndex === 0;
  const t = useTranslations('training');

  return (
    <div className="flex items-center justify-between">
      <Button
        variant="outline"
        size="icon"
        onClick={onPrevious}
        disabled={isFirstVideo}
        aria-label={t('previousVideo')}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>

      <Text variant="muted" size="sm">
        {t('videoCount', { current: currentIndex + 1, total })}
      </Text>

      <Button
        variant="outline"
        size="icon"
        onClick={onNext}
        disabled={!onNext}
        aria-label={t('nextVideo')}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
