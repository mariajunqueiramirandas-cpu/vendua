import { Pause, Play } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '../cn.ts';
import { IN, SELLER, YOU } from './tones.ts';
import type { Voice } from './Bubble.tsx';

const BARS = 30;

/** a stable waveform per message: the same note always draws the same bars */
function bars(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return Array.from({ length: BARS }, (_, i) => {
    h = Math.imul(h ^ (h >>> 13), 1274126177) ^ i;
    // speech: louder in the middle, a soft fall at the ends
    const env = Math.sin(((i + 0.5) / BARS) * Math.PI) * 0.6 + 0.4;
    return 0.2 + (((h >>> 0) % 1000) / 1000) * 0.8 * env;
  });
}

const dur = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/**
 * A voice note: play, waveform, duration and the transcript in italics. The transcript is its
 * accessible name. Without `src` (no audio kept, or not loaded) the play button is inert and
 * says so; the transcript carries the message.
 */
export function VoiceNote({
  seconds,
  transcript,
  src,
  voice = 'in',
  time,
  className,
}: {
  seconds: number | null;
  transcript: string | null;
  src?: string | null | undefined;
  voice?: Voice | undefined;
  /** "19:42" */
  time?: string | undefined;
  className?: string | undefined;
}) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  useEffect(() => () => audio.current?.pause(), []);
  const wave = bars(transcript ?? String(seconds ?? 0));
  const total = seconds ?? 0;
  const progress = total ? Math.min(1, at / total) : 0;
  const toggle = () => {
    if (!src) return;
    if (!audio.current) {
      const a = new Audio(src);
      a.ontimeupdate = () => setAt(a.currentTime);
      a.onended = () => {
        setPlaying(false);
        setAt(0);
      };
      audio.current = a;
    }
    if (playing) {
      audio.current.pause();
      setPlaying(false);
    } else {
      void audio.current.play().then(
        () => setPlaying(true),
        () => setPlaying(false),
      );
    }
  };
  const name = `áudio de ${dur(total)}${transcript ? `: ${transcript}` : ''}`;
  return (
    <figure
      aria-label={name}
      className={cn(
        'm-0 flex w-[min(100%,20rem)] flex-col gap-1 rounded-[18px] px-3 pb-1.5 pt-2.5',
        voice === 'in' && 'self-start rounded-bl-md',
        voice !== 'in' && 'self-end rounded-br-md',
        voice === 'in' ? IN : voice === 'seller' ? SELLER : YOU,
        className,
      )}
    >
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={toggle}
          aria-disabled={!src || undefined}
          aria-label={src ? (playing ? 'pausar o áudio' : 'ouvir o áudio') : 'áudio indisponível'}
          title={src ? undefined : 'só a transcrição ficou guardada'}
          className={cn(
            'press relative grid size-9 shrink-0 place-items-center rounded-full',
            // a 48 px target around the 36 px disc
            'after:absolute after:-inset-1.5 after:content-[""]',
            voice === 'you'
              ? 'bg-on-primary text-primary noite:bg-spark noite:text-on-spark'
              : 'bg-primary text-on-primary',
            !src && 'opacity-60',
          )}
        >
          {playing ? (
            <Pause weight="fill" className="size-4" aria-hidden />
          ) : (
            <Play weight="fill" className="size-4" aria-hidden />
          )}
        </button>
        <span aria-hidden className="flex h-7 min-w-0 flex-1 items-center gap-[2px]">
          {wave.map((v, i) => (
            <i
              key={i}
              className={cn(
                'block w-[3px] shrink-0 rounded-full',
                i / BARS < progress ? 'bg-current opacity-90' : 'bg-current opacity-45',
              )}
              style={{ height: `${Math.round(v * 100)}%` }}
            />
          ))}
        </span>
        <span className="tnum t-caption shrink-0 opacity-80">{dur(playing ? at : total)}</span>
      </div>
      {transcript ? (
        <figcaption
          className={cn(
            'mt-1 border-t pt-1.5 text-[0.875rem] italic leading-5',
            voice === 'you' ? 'border-current/20 opacity-85' : 'border-line text-muted',
          )}
        >
          “{transcript}”
        </figcaption>
      ) : null}
      {time ? (
        <p className="text-right text-[0.75rem] font-medium leading-4 opacity-75">
          <time>{time}</time>
        </p>
      ) : null}
    </figure>
  );
}
