import { platform } from '../../platform/index.ts';

// The kitchen reads tickets out loud (and the pickup display calls numbers) with the device's own
// pt-BR voice: nothing to download, and nothing leaves the device.

export const voiceSupported = () => platform.speech.supported();

export function speak(text: string, opts: { rate?: number } = {}) {
  platform.speech.speak(text, opts.rate ?? 1.05);
}

export function hush() {
  platform.speech.hush();
}
