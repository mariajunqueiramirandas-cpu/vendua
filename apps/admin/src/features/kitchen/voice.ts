// The kitchen reads tickets out loud (and the pickup display calls numbers) with the device's own
// pt-BR voice: nothing to download, and nothing leaves the device.

export const voiceSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

function ptVoice(): SpeechSynthesisVoice | null {
  const all = speechSynthesis.getVoices();
  return (
    all.find((v) => v.lang === 'pt-BR' && v.localService) ??
    all.find((v) => /^pt[-_]BR$/i.test(v.lang)) ??
    all.find((v) => /^pt/i.test(v.lang)) ??
    null
  );
}

export function speak(text: string, opts: { rate?: number } = {}) {
  if (!voiceSupported()) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'pt-BR';
  const v = ptVoice();
  if (v) u.voice = v;
  u.rate = opts.rate ?? 1.05;
  speechSynthesis.speak(u);
}

export function hush() {
  if (voiceSupported()) speechSynthesis.cancel();
}
