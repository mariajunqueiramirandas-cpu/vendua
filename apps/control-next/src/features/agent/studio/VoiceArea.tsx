import type { ChangeEvent } from 'react';
import { Panel } from '@/components/ui/card.tsx';
import { Field, Input, Textarea } from '@/components/ui/input.tsx';
import { AreaIntro, RawJson, SaveBar, useDraft } from './bits.tsx';
import { obj, str, type SettingsMap, type SettingWrite } from './settings.ts';

export function VoiceArea({
  map,
  save,
  pending,
}: {
  map: SettingsMap;
  save: (key: string, v: SettingWrite) => Promise<boolean>;
  pending: boolean;
}) {
  const value = obj(map.pitch);
  // hardRules live in the same `pitch` setting but are edited under "regras"
  const cur = {
    product: str(value.product, ''),
    audience: str(value.audience, ''),
    tone: str(value.tone, ''),
    offerRange: str(value.offerRange, ''),
    offer: str(value.offer, ''),
    goal: str(value.goal, ''),
  };
  const { edit, setEdit, dirty, reset } = useDraft(cur);
  const set = (k: keyof typeof cur) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setEdit({ ...edit, [k]: e.target.value });

  return (
    <>
      <AreaIntro>o pitch inteiro que o modelo recebe no system prompt</AreaIntro>
      <Panel title="voz do agente">
        <div className="grid gap-3 lg:grid-cols-2">
          <Field label="produto" htmlFor="pitch-product">
            <Textarea
              id="pitch-product"
              rows={4}
              value={edit.product}
              maxLength={4000}
              onChange={set('product')}
            />
          </Field>
          <Field
            label="oferta concreta — fatos citáveis (preço, link de cadastro, loja exemplo)"
            htmlFor="pitch-offer"
          >
            <Textarea
              id="pitch-offer"
              rows={4}
              value={edit.offer}
              maxLength={4000}
              onChange={set('offer')}
              placeholder="ex.: plano R$149/mês, sem comissão; 7 dias grátis; cadastro: https://...; exemplo: https://..."
            />
          </Field>
          <Field label="público" htmlFor="pitch-audience">
            <Input
              id="pitch-audience"
              value={edit.audience}
              maxLength={4000}
              onChange={set('audience')}
            />
          </Field>
          <Field label="tom" htmlFor="pitch-tone">
            <Input id="pitch-tone" value={edit.tone} maxLength={4000} onChange={set('tone')} />
          </Field>
          <Field label="o que pode oferecer" htmlFor="pitch-range">
            <Textarea
              id="pitch-range"
              rows={2}
              value={edit.offerRange}
              maxLength={4000}
              onChange={set('offerRange')}
            />
          </Field>
          <Field label="objetivo da conversa" htmlFor="pitch-goal">
            <Input id="pitch-goal" value={edit.goal} maxLength={4000} onChange={set('goal')} />
          </Field>
        </div>
        <SaveBar
          label="salvar voz"
          dirty={dirty}
          pending={pending}
          onReset={reset}
          // PUT replaces the whole setting — merge over the stored value so hardRules/raw keys survive
          onSave={() => void save('pitch', (c: unknown) => ({ ...obj(c), ...edit }))}
        />
        <RawJson value={value} onSave={(v) => void save('pitch', v)} />
      </Panel>
    </>
  );
}
