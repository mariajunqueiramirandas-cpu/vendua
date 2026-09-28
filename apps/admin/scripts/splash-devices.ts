// iOS ignores the manifest's splash: it wants one apple-touch-startup-image per
// screen (CSS px + pixel ratio, portrait). vite.config.ts writes the <link>s,
// scripts/pwa-assets.ts draws the images, both from this list.
export const SPLASH_DEVICES: [w: number, h: number, dpr: number][] = [
  [440, 956, 3], // iPhone 16 Pro Max
  [402, 874, 3], // iPhone 16 Pro
  [430, 932, 3], // iPhone 15/14 Pro Max, 15/16 Plus
  [393, 852, 3], // iPhone 16, 15, 15 Pro, 14 Pro
  [428, 926, 3], // iPhone 14 Plus, 13/12 Pro Max
  [390, 844, 3], // iPhone 14, 13, 12
  [375, 812, 3], // iPhone 13 mini, 12 mini, 11 Pro, XS, X
  [414, 896, 3], // iPhone 11 Pro Max, XS Max
  [414, 896, 2], // iPhone 11, XR
  [375, 667, 2], // iPhone SE, 8
  [1032, 1376, 2], // iPad Pro 13" (M4)
  [1024, 1366, 2], // iPad Pro 12.9"
  [834, 1210, 2], // iPad Pro 11" (M4)
  [834, 1194, 2], // iPad Pro 11"
  [820, 1180, 2], // iPad Air, iPad 10th gen
  [810, 1080, 2], // iPad 9th gen
  [744, 1133, 2], // iPad mini
];

export const splashName = (w: number, h: number, dpr: number, dark: boolean) =>
  `splash/${w * dpr}x${h * dpr}${dark ? '-noite' : ''}.png`;
