import type { ReactNode } from 'react';
import type { AgentConfig, SpeechVoice } from '@/lib/api.ts';
import { Panel } from '@/components/ui/card.tsx';
import { Switch } from '@/components/ui/controls.tsx';
import { Field, Select } from '@/components/ui/input.tsx';
import { useAiVoice } from '../../ai/queries.ts';

// The sales agent's WhatsApp voice notes (ADR 0048): it hears every lead's voice note as its
// transcript; these switches say when it speaks, and in which of the speech server's voices.

const AGE: Record<string, [string, string]> = {
  young: ['jovem', 'jovem'],
  young_adult: ['jovem adulta', 'jovem adulto'],
  adult: ['adulta', 'adulto'],
  middle_age: ['madura', 'maduro'],
  older: ['mais velha', 'mais velho'],
};

function label(v: SpeechVoice): string {
  if (!v.gender) return v.name;
  const age = v.age ? AGE[v.age]?.[v.gender === 'female' ? 0 : 1] : null;
  return `${v.name} · ${v.gender === 'female' ? 'feminina' : 'masculina'}${age ? `, ${age}` : ''}`;
}

function Toggle({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="flex min-h-8 items-start gap-2 text-sm pointer-coarse:min-h-10">
      <Switch checked={checked} onCheckedChange={onChange} className="mt-0.5 shrink-0" />
      <span className="min-w-0">{children}</span>
    </label>
  );
}

export function AudioPanel({
  value,
  onChange,
}: {
  value: AgentConfig['voice'];
  onChange: (next: AgentConfig['voice']) => void;
}) {
  const view = useAiVoice();
  const tts = view.data?.tts;
  const voices = tts?.voices ?? [];
  const fallback = voices.find((v) => v.id === tts?.voice);
  const off = tts && !tts.reachable;
  return (
    <Panel title="áudio" aside="no WhatsApp">
      <div className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">
          O agente ouve todo áudio que o lead manda. Aqui você diz quando ele responde falando.
        </p>
        <Toggle checked={value.replies} onChange={(replies) => onChange({ ...value, replies })}>
          <span className="block">responder áudio com áudio</span>
          <span className="block text-xs text-muted-foreground">
            quem manda áudio ouve a resposta. Com link ou longa demais, ela vai por escrito.
          </span>
        </Toggle>
        <Toggle
          checked={value.proactive}
          onChange={(proactive) => onChange({ ...value, proactive })}
        >
          <span className="block">mandar um áudio de vez em quando</span>
          <span className="block text-xs text-muted-foreground">
            só para quem já escreveu, no máximo um por dia por lead, quando o agente achar que soa
            melhor falado
          </span>
        </Toggle>
        <Field label="voz">
          <Select
            value={value.speechVoice}
            onChange={(e) => onChange({ ...value, speechVoice: e.target.value })}
            disabled={!voices.length}
            className="w-full md:w-80"
          >
            <option value="">
              {fallback ? `padrão (${label(fallback)})` : 'padrão do servidor'}
            </option>
            {voices.map((v) => (
              <option key={v.id} value={v.id}>
                {label(v)}
              </option>
            ))}
            {value.speechVoice && !voices.some((v) => v.id === value.speechVoice) && (
              <option value={value.speechVoice}>{value.speechVoice} (fora do servidor)</option>
            )}
          </Select>
        </Field>
        {off && (
          <p className="text-xs text-muted-foreground">
            O servidor de fala não respondeu agora: até ele voltar, as respostas vão por escrito.
          </p>
        )}
        <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
          O áudio nunca muda quem o agente é: ele não diz ser uma pessoa e, se perguntarem se é robô
          ou IA, responde com transparência.
        </p>
      </div>
    </Panel>
  );
}
