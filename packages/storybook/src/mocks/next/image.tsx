/** Browser-safe stand-in for `next/image`: renders a plain img. */
import { forwardRef } from 'react';
import type { ImgHTMLAttributes } from 'react';

type ImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  src: string | { src: string };
  alt: string;
  fill?: boolean;
  priority?: boolean;
  quality?: number;
  unoptimized?: boolean;
  placeholder?: string;
  blurDataURL?: string;
  loader?: unknown;
};

const Image = forwardRef<HTMLImageElement, ImageProps>(function Image(
  { src, alt, fill, priority, quality, unoptimized, placeholder, blurDataURL, loader, style, ...rest },
  ref,
) {
  const resolved = typeof src === 'string' ? src : src.src;
  return (
    <img
      ref={ref}
      src={resolved}
      alt={alt}
      style={fill ? { position: 'absolute', inset: 0, width: '100%', height: '100%', ...style } : style}
      {...rest}
    />
  );
});

export default Image;
