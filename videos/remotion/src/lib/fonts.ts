import { loadFont } from '@remotion/fonts';
import { continueRender, delayRender, staticFile } from 'remotion';

// Variable fonts, one file each.
export const fontsReady = Promise.all([
  loadFont({
    family: 'Space Grotesk',
    url: staticFile('fonts/space-grotesk-latin-wght-normal.woff2'),
    weight: '300 700',
  }),
  loadFont({
    family: 'Figtree',
    url: staticFile('fonts/figtree-latin-wght-normal.woff2'),
    weight: '300 900',
  }),
]);

// Hold every render until both fonts are in, so no frame is set in a fallback face.
const handle = delayRender('fonts');
fontsReady.then(() => continueRender(handle));
