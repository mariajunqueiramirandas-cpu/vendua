import { readFileSync } from 'node:fs';
import pkg from '../package.json' with { type: 'json' };

// v.js is versioned on its own slow cadence, independent of the Kernel
// (05-system-surfaces.md#the-loader-vjs). Core (dev) and the CDN (prod) serve this string.
export const LOADER_VERSION: string = pkg.version;

export const LOADER_JS: string = readFileSync(new URL('./v.js', import.meta.url), 'utf8').replace(
  '__LOADER_VERSION__',
  LOADER_VERSION,
);
