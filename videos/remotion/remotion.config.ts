import { Config } from '@remotion/cli/config';
import { browserPath, glRenderer } from './scripts/browser.mjs';

const browser = browserPath();
if (browser) Config.setBrowserExecutable(browser);
Config.setChromiumOpenGlRenderer(glRenderer() as 'angle' | 'swangle');
Config.setVideoImageFormat('jpeg');
Config.setJpegQuality(92);
Config.setCodec('h264');
Config.setCrf(16);
Config.setPixelFormat('yuv420p');
