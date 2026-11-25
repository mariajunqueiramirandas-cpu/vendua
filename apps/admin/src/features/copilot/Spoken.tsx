import { Pause, SpeakerHigh, SpeakerSlash, SpinnerGap } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { platform } from '../../platform/index.ts';
import { cn } from '../../ui/cn.ts';

// Duá's reply to a voice message, said out loud (ADR 0048). Core makes the sound the first time
// it's asked for, so nothing is fetched until it's played: by a tap, or by itself when it's the
// answer to a voice message just sent from this screen.

let voiceSentAt = 0;
const autoPlayed = new Set<string>();

/** The composer sent a voice message: Duá's answer to it plays by itself when it arrives. */
export function markVoiceSent() {
  voiceSentAt = Date.now();
}

type State = 'idle' | 'loading' | 'playing' | 'failed';

export function SpokenReply({
  id,
  src,
  at,
  latest,
}: {
  id: string;
  /** /admin/v1/copilot/messages/:id/audio */
  src: string;
  /** the reply's time: an answer from before the voice message never plays by itself */
  at: string;
  /** the newest of Duá's spoken replies */
  latest: boolean;
}) {
  const [state, setState] = useState<State>('idle');
  const audio = useRef<HTMLAudioElement | null>(null);
  const made = useRef<string | null>(null);

  useEffect(
    () => () => {
      audio.current?.pause();
      if (made.current) URL.revokeObjectURL(made.current);
    },
    [],
  );

  const play = async (auto: boolean) => {
    if (state === 'playing') {
      audio.current?.pause();
      setState('idle');
      return;
    }
    try {
      if (!audio.current) {
        setState('loading');
        const url = await platform.http.privateMedia(src);
        if (url.startsWith('blob:')) made.current = url;
        const a = new Audio(url);
        a.onended = () => setState('idle');
        a.onpause = () => setState((s) => (s === 'playing' ? 'idle' : s));
        audio.current = a;
      }
      await audio.current.play();
      setState('playing');
    } catch (err) {
      // a browser that won't play without a tap: the button is there for it. Anything else is
      // Core without a voice right now: say so, and a tap tries again
      if ((err as { name?: string })?.name === 'NotAllowedError' && auto) {
        setState('idle');
        return;
      }
      audio.current = null;
      setState('failed');
    }
  };

  useEffect(() => {
    if (!latest || autoPlayed.has(id) || !voiceSentAt) return;
    // the server's clock and this one may disagree by a little
    if (Date.parse(at) < voiceSentAt - 5_000) return;
    autoPlayed.add(id);
    void play(true);
  }, [id, latest, at]);

  const label =
    state === 'playing'
      ? 'Pausar a resposta do Duá'
      : state === 'failed'
        ? 'A voz do Duá não está disponível agora. Tentar de novo'
        : 'Ouvir a resposta do Duá';
  return (
    <button
      type="button"
      onClick={() => void play(false)}
      aria-label={label}
      aria-pressed={state === 'playing'}
      className={cn(
        'press mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-full bg-surface px-3 text-[0.8125rem] font-semibold text-ink ring-1 ring-line',
        'hover:bg-hover',
      )}
    >
      {state === 'loading' ? (
        <SpinnerGap className="size-4 motion-safe:animate-spin" aria-hidden />
      ) : state === 'playing' ? (
        <Pause weight="fill" className="size-4" aria-hidden />
      ) : state === 'failed' ? (
        <SpeakerSlash weight="fill" className="size-4 text-muted" aria-hidden />
      ) : (
        <SpeakerHigh weight="fill" className="size-4" aria-hidden />
      )}
      {state === 'playing' ? 'pausar' : state === 'failed' ? 'sem voz agora' : 'ouvir'}
    </button>
  );
}
