import { existsSync, readdirSync } from 'node:fs';

// The Chromium every script renders with. REMOTION_BROWSER wins; cloud containers ship
// Playwright's headless shell (and can't always download Remotion's); on a laptop this returns
// null and Remotion fetches its own (the audio script then uses the installed Chrome).
export const browserPath = () => {
  if (process.env.REMOTION_BROWSER) return process.env.REMOTION_BROWSER;
  const root = '/opt/pw-browsers';
  if (!existsSync(root)) return null;
  const dir = readdirSync(root).find((d) => d.startsWith('chromium_headless_shell-'));
  const bin = dir && `${root}/${dir}/chrome-linux/headless_shell`;
  return bin && existsSync(bin) ? bin : null;
};

// WebGL scenes: ANGLE on a GPU machine, SwiftShader (software) where there is none.
export const glRenderer = () => process.env.REMOTION_GL ?? 'swangle';
