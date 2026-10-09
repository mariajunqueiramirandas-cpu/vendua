import { useCallback, useEffect, useRef, useState } from 'react';
import { VOICE_MIN_S, type Voice } from './media.ts';

// A voice message, WhatsApp-style: tap to record, then send or throw away. Opus where the browser
// has it, Safari's mp4 otherwise; the mic is released as soon as it's over.

const MIMES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'];

function pickMime() {
  for (const m of MIMES) if (MediaRecorder.isTypeSupported?.(m)) return m;
  return undefined;
}

export type RecorderState = 'idle' | 'asking' | 'recording';

export function useRecorder({
  max,
  onDone,
}: {
  /** seconds; it stops and sends by itself here */
  max: number;
  /** a finished recording (never a mis-tap) */
  onDone: (v: Voice) => void;
}) {
  const [state, setState] = useState<RecorderState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const live = useRef<{
    rec: MediaRecorder;
    stream: MediaStream;
    started: number;
    keep: boolean;
    timer: ReturnType<typeof setInterval>;
  } | null>(null);
  const done = useRef(onDone);
  done.current = onDone;
  const mounted = useRef(true);
  // bumped by a cancel while the mic permission is still pending, so that take never starts
  const gen = useRef(0);

  const stop = useCallback((keep: boolean) => {
    const l = live.current;
    if (!l) {
      gen.current++;
      setState('idle');
      return;
    }
    l.keep = keep;
    clearInterval(l.timer);
    if (l.rec.state !== 'inactive') l.rec.stop();
    else l.stream.getTracks().forEach((t) => t.stop());
  }, []);

  const start = useCallback(async () => {
    if (live.current) return;
    setError(null);
    setState('asking');
    const mine = ++gen.current;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      if (!mounted.current || mine !== gen.current) return;
      const name = e instanceof DOMException ? e.name : '';
      setError(
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'Libere o microfone para gravar.'
          : name === 'NotFoundError'
            ? 'Não achei um microfone neste aparelho.'
            : 'Não deu para gravar agora.',
      );
      setState('idle');
      return;
    }
    if (!mounted.current || mine !== gen.current) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    let rec: MediaRecorder;
    try {
      const mimeType = pickMime();
      rec = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: 32_000,
      });
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      setError('Não deu para gravar neste navegador.');
      setState('idle');
      return;
    }
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    rec.onstop = () => {
      const l = live.current;
      live.current = null;
      stream.getTracks().forEach((t) => t.stop());
      setState('idle');
      setElapsed(0);
      if (!l?.keep) return;
      const seconds = (performance.now() - l.started) / 1000;
      if (seconds < VOICE_MIN_S || !chunks.length) return;
      const mime = (rec.mimeType || chunks[0]?.type || 'audio/webm').replace(/\s+/g, '');
      done.current({
        blob: new Blob(chunks, { type: mime }),
        mime,
        seconds: Math.round(seconds),
      });
    };
    const started = performance.now();
    const timer = setInterval(() => {
      const s = (performance.now() - started) / 1000;
      setElapsed(s);
      if (s >= max) stop(true);
    }, 250);
    live.current = { rec, stream, started, keep: false, timer };
    rec.start(1000);
    setElapsed(0);
    setState('recording');
  }, [max, stop]);

  // leaving the screen mid-recording throws it away and frees the mic
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stop(false);
    };
  }, [stop]);

  return {
    state,
    elapsed,
    error,
    clearError: () => setError(null),
    start: () => void start(),
    send: () => stop(true),
    cancel: () => stop(false),
  };
}
