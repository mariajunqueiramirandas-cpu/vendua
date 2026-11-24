import type { ChangeEvent } from 'react';
import { RotateCcw } from 'lucide-react';
import { ConfirmButton } from '@/components/common.tsx';
import { Panel } from '@/components/ui/card.tsx';
import { Field, Input, Textarea } from '@/components/ui/input.tsx';
import { FieldError } from './bits.tsx';

export interface VoiceDraft {
  product: string;
  offer: string;
  audience: string;
  tone: string;
  offerRange: string;
  goal: string;
}

export function VoicePanel({
  voice,
  onVoice,
  instructions,
  onInstructions,
  onReset,
  resetting,
  busy,
}: {
  voice: VoiceDraft;
  onVoice: (next: VoiceDraft) => void;
  instructions: string;
  onInstructions: (v: string) => void;
  onReset?: (() => void) | undefined;
  resetting?: boolean | undefined;
  busy?: boolean | undefined;
}) {
  const setV = (k: keyof VoiceDraft) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    onVoice({ ...voice, [k]: e.target.value });
  const tooLong = instructions.length > 8000;

  return (
    <div className="flex flex-col gap-3">
      <Panel title="voz e oferta" aside="o que você vende e como o agente fala">
        <div className="grid gap-3 lg:grid-cols-2">
          <Field label="produto" htmlFor="pitch-product">
            <Textarea
              id="pitch-product"
              rows={3}
              maxLength={4000}
              value={voice.product}
              onChange={setV('product')}
            />
          </Field>
          <Field
            label="oferta e materiais aprovados pela equipe"
            htmlFor="pitch-offer"
            hint="preços, testes e cadastro vêm dos planos vigentes"
          >
            <Textarea
              id="pitch-offer"
              rows={3}
              maxLength={4000}
              value={voice.offer}
              onChange={setV('offer')}
              placeholder="link de uma loja de exemplo autorizada"
            />
          </Field>
          <Field label="público" htmlFor="pitch-audience">
            <Input
              id="pitch-audience"
              maxLength={4000}
              value={voice.audience}
              onChange={setV('audience')}
            />
          </Field>
          <Field label="tom" htmlFor="pitch-tone">
            <Input id="pitch-tone" maxLength={4000} value={voice.tone} onChange={setV('tone')} />
          </Field>
          <Field
            label="margem de negociação"
            htmlFor="pitch-range"
            hint="o que pode conceder sozinho e quando chamar a equipe"
          >
            <Textarea
              id="pitch-range"
              rows={2}
              maxLength={4000}
              value={voice.offerRange}
              onChange={setV('offerRange')}
            />
          </Field>
          <Field label="objetivo da conversa" htmlFor="pitch-goal">
            <Input id="pitch-goal" maxLength={4000} value={voice.goal} onChange={setV('goal')} />
          </Field>
        </div>
      </Panel>

      <Panel
        title="instruções fixas"
        aside={`${instructions.length}/8000 · valem em toda execução`}
      >
        <Textarea
          aria-label="instruções do agente"
          rows={7}
          value={instructions}
          onChange={(e) => onInstructions(e.target.value)}
          placeholder={
            '- nunca prometa data de lançamento ou desconto sem confirmar com a equipe\n- em confeitarias, puxe conversa sobre encomendas com data marcada antes de falar de plano'
          }
        />
        {tooLong && <FieldError>no máximo 8000 caracteres</FieldError>}
        <p className="mt-1.5 text-xs text-muted-foreground">
          regras permanentes da equipe — entram no prompt de toda conversa, busca e revisão. Para
          aprendizados acumulados por nicho ou conversa, use a seção Memória abaixo.
        </p>
      </Panel>

      {onReset && (
        <div className="flex flex-col gap-2.5 rounded-lg border bg-card px-3 py-2.5 shadow-card sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-medium text-foreground">restaurar instruções padrão</p>
            <p className="text-xs text-muted-foreground">
              redefine voz, oferta e instruções fixas para o padrão da Venduá — mantém memória,
              leads e autonomia intactos.
            </p>
          </div>
          <ConfirmButton
            size="sm"
            variant="outline"
            confirm="confirmar restauração?"
            disabled={resetting || busy}
            onConfirm={onReset}
            className="self-start sm:self-auto"
          >
            <RotateCcw /> {resetting ? 'restaurando…' : 'restaurar padrão'}
          </ConfirmButton>
        </div>
      )}
    </div>
  );
}
