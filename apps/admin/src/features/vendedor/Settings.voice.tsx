import { CheckCircle, Circle, Pause, Play, SpinnerGap } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { api, type SpeechVoice, type StoreAgentSettings } from '../../lib/api.ts';
import { haptic } from '../../lib/haptics.ts';
import { qk } from '../../lib/query.ts';
import { cn } from '../../ui/cn.ts';
import { Segmented, Toggle } from '../../ui/fields.tsx';
import { toast } from '../../ui/Toast.tsx';
import { Group, SaveStatus, useSettingsPatch } from './Settings.parts.tsx';

// "Respostas em áudio": Duá answers a voice note with one, in the voice the store picks (ADR
// 0048). The voices are Core's TTS sidecar's; each plays the store's own greeting before it's
// picked.

const AGE: Record<'female' | 'male', Record<string, string>> = {
  female: {
    young: 'jovem',
    young_adult: 'jovem adulta',
    adult: 'adulta',
    middle_age: 'madura',
    older: 'mais velha',
  },
  male: {
    young: 'jovem',
    young_adult: 'jovem adulto',
    adult: 'adulto',
    middle_age: 'maduro',
    older: 'mais velho',
  },
};

const ORDER = ['young', 'young_adult', 'adult', 'middle_age', 'older'];

function describe(v: SpeechVoice): string {
  if (!v.gender) return 'voz';
  const age = v.age ? AGE[v.gender][v.age] : null;
  return `${v.gender === 'female' ? 'feminina' : 'masculina'}${age ? ` · ${age}` : ''}`;
}

type Gender = 'female' | 'male';

export function VoiceReplies({ s }: { s: StoreAgentSettings }) {
  const { run, state, retry } = useSettingsPatch();
  const list = useQuery({ queryKey: qk.vendedor.voices, queryFn: api.vendedor.voices });
  const voices = list.data?.voices ?? [];
  const current = s.speechVoice || list.data?.default || '';
  const available = list.data?.available ?? true;
  return (
    <Group title="Respostas em áudio" status={<SaveStatus state={state} retry={retry} />}>
      <Toggle
        checked={s.voiceReplies}
        onChange={(voiceReplies) => void run({ voiceReplies })}
        label="Responder áudio com áudio"
        description={
          !available
            ? 'A voz está indisponível agora: até ela voltar, ele responde por escrito.'
            : s.voiceReplies
              ? 'Quem manda áudio no WhatsApp ou no chat do site ouve a resposta. Valores, Pix e links continuam por escrito.'
              : 'Ele responde sempre por escrito, mesmo a quem manda áudio.'
        }
      />
      {s.voiceReplies && voices.length ? (
        <VoicePicker
          voices={voices}
          value={current}
          fallback={list.data?.default ?? null}
          onChange={(speechVoice) => void run({ speechVoice })}
        />
      ) : null}
    </Group>
  );
}

function VoicePicker({
  voices,
  value,
  fallback,
  onChange,
}: {
  voices: SpeechVoice[];
  value: string;
  fallback: string | null;
  onChange: (id: string) => void;
}) {
  const picked = voices.find((v) => v.id === value);
  const [gender, setGender] = useState<Gender>(picked?.gender ?? 'female');
  const shown = voices
    .filter((v) => (v.gender ?? 'female') === gender)
    .sort((a, b) => ORDER.indexOf(a.age ?? '') - ORDER.indexOf(b.age ?? ''));
  // the radio the group's Tab stop lands on: the picked voice, or the first one shown
  const focusId = shown.some((v) => v.id === value) ? value : shown[0]?.id;
  const player = useSample();
  const group = useRef<HTMLDivElement>(null);

  const pick = (v: SpeechVoice) => {
    if (v.id === value) return;
    haptic.tick();
    onChange(v.id);
  };
  const onKey = (e: KeyboardEvent) => {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const at = shown.findIndex((v) => v.id === value);
    const next = shown[(at + step + shown.length) % shown.length];
    if (!next) return;
    pick(next);
    group.current?.querySelector<HTMLElement>(`[data-voice="${next.id}"]`)?.focus();
  };

  return (
    <div className="border-t border-line pt-3">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <span className="t-label">
          Voz{picked ? <span className="text-muted"> · {picked.name}</span> : null}
        </span>
        <Segmented
          label="tipo de voz"
          value={gender}
          onChange={setGender}
          options={[
            { value: 'female', label: 'femininas' },
            { value: 'male', label: 'masculinas' },
          ]}
          className="w-full sm:w-64"
        />
      </div>
      <div
        ref={group}
        role="radiogroup"
        aria-label="voz do Duá"
        onKeyDown={onKey}
        className="grid gap-2 md:grid-cols-2"
      >
        {shown.map((v) => {
          const on = v.id === value;
          const playing = player.id === v.id;
          return (
            <div
              key={v.id}
              className={cn(
                'flex min-h-16 items-stretch overflow-hidden rounded-md transition-[background-color,box-shadow] duration-(--duration-quick)',
                on ? 'bg-spark-soft ring-2 ring-primary' : 'bg-surface ring-1 ring-line',
              )}
            >
              <button
                type="button"
                role="radio"
                aria-checked={on}
                tabIndex={
                  on ||
                  (!picked?.gender || picked.gender !== gender ? v.id === shown[0]?.id : false)
                    ? 0
                    : -1
                }
                data-voice={v.id}
                onClick={() => pick(v)}
                className={cn(
                  'press-row flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left',
                  !on && 'hover:bg-hover',
                )}
              >
                {on ? (
                  <CheckCircle weight="fill" className="size-6 shrink-0 text-primary" aria-hidden />
                ) : (
                  <Circle className="size-6 shrink-0 text-faint" aria-hidden />
                )}
                <span className="min-w-0">
                  <span className="block truncate font-semibold">
                    {v.name}
                    {v.id === fallback ? (
                      <span className="t-caption ml-1.5 font-normal text-muted">padrão</span>
                    ) : null}
                  </span>
                  <span className="t-caption block text-muted">{describe(v)}</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => player.toggle(v.id)}
                aria-label={
                  playing && player.state === 'playing' ? `Parar ${v.name}` : `Ouvir ${v.name}`
                }
                className="flex w-14 shrink-0 items-center justify-center border-l border-line text-ink hover:bg-hover focus-visible:outline-offset-[-2px]"
              >
                {playing && player.state === 'loading' ? (
                  <SpinnerGap className="size-5 motion-safe:animate-spin" aria-hidden />
                ) : playing && player.state === 'playing' ? (
                  <Pause weight="fill" className="size-5" aria-hidden />
                ) : (
                  <Play weight="fill" className="size-5" aria-hidden />
                )}
              </button>
            </div>
          );
        })}
      </div>
      <p className="t-caption mt-3 text-muted">
        Toque em ▶ para ouvir a saudação da sua loja em cada voz.
      </p>
    </div>
  );
}

/** One sample at a time: a second tap stops it, another voice takes over. */
function useSample() {
  const [id, setId] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'playing'>('idle');
  const audio = useRef<HTMLAudioElement | null>(null);
  const made = useRef<string | null>(null);
  const turn = useRef(0);

  const stop = () => {
    audio.current?.pause();
    if (made.current) URL.revokeObjectURL(made.current);
    made.current = null;
    setId(null);
    setState('idle');
  };
  useEffect(() => () => stop(), []);

  const toggle = async (voice: string) => {
    if (id === voice) return stop();
    stop();
    const mine = ++turn.current;
    setId(voice);
    setState('loading');
    try {
      const src = await api.vendedor.voiceSample(voice);
      if (mine !== turn.current) {
        if (src.startsWith('blob:')) URL.revokeObjectURL(src);
        return;
      }
      if (src.startsWith('blob:')) made.current = src;
      const a = audio.current ?? (audio.current = new Audio());
      a.src = src;
      a.onended = () => mine === turn.current && stop();
      a.onerror = () => {
        if (mine !== turn.current) return;
        stop();
        toast.error('Não deu para tocar essa voz agora.');
      };
      await a.play();
      if (mine === turn.current) setState('playing');
    } catch {
      if (mine !== turn.current) return;
      stop();
      toast.error('Não deu para tocar essa voz agora.');
    }
  };
  return { id, state, toggle };
}
