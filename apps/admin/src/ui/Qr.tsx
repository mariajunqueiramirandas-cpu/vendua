import { qrSvg } from '@vendua/kernel/rules';
import { useMemo } from 'react';
import { cn } from './cn.ts';

const encode = (value: string, opts: Parameters<typeof qrSvg>[1]) => {
  try {
    return qrSvg(value, opts);
  } catch {
    // past the encoder's ~400 bytes: the text beside it still works
    return null;
  }
};

/** A QR from the Kernel's encoder, dark on the QR paper in either theme so a camera reads it. */
export function Qr({ value, alt, className }: { value: string; alt: string; className?: string }) {
  const svg = useMemo(
    () => encode(value, { dark: 'currentColor', light: 'none', margin: 1 }),
    [value],
  );
  if (!svg) return null;
  return (
    <span
      role="img"
      aria-label={alt}
      className={cn('block bg-qr-paper text-qr [&>svg]:block [&>svg]:size-full', className)}
      // our own markup: path data and sanitised colours only
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

/** The same QR as a PNG data URL to download or print, the theme tokens resolved. */
export async function qrPng(value: string, size = 1024): Promise<string | null> {
  const css = getComputedStyle(document.documentElement);
  const svg = encode(value, {
    dark: css.getPropertyValue('--qr-dark').trim(),
    light: css.getPropertyValue('--qr-light').trim(),
    margin: 2,
    size,
  });
  if (!svg) return null;
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  canvas.getContext('2d')!.drawImage(img, 0, 0, size, size);
  return canvas.toDataURL('image/png');
}
