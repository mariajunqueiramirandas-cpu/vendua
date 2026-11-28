import { useState } from 'react';
import type { CustomerDetail } from '@/lib/api.ts';
import { fmtDay } from '@/lib/format.ts';
import { Segmented } from '@/components/ui/controls.tsx';
import { Field, Input } from '@/components/ui/input.tsx';
import { ActionSheet, Effects, FromTo, NoteField } from './StoreBillingActions.tsx';

const MAX = 10_000;
const DAYS = [
  ['30', '30'],
  ['60', '60'],
  ['90', '90'],
  ['180', '180'],
  ['365', '365'],
] as const;
type DaysOpt = (typeof DAYS)[number][0];

const n = (v: number) => v.toLocaleString('pt-BR');

/** The team gives the store Duá conversations: they spend after the period's own, in a trial too. */
export function AiCreditsSheet({ d, onClose }: { d: CustomerDetail; onClose: () => void }) {
  const [raw, setRaw] = useState('100');
  const [days, setDays] = useState<DaysOpt>('30');
  const [note, setNote] = useState('');
  const count = /^\d{1,5}$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
  const ok = Number.isInteger(count) && count >= 1 && count <= MAX;
  const ai = d.ai;
  const until = new Date(Date.now() + Number(days) * 86_400_000).toISOString();
  return (
    <ActionSheet
      tenantId={d.store.id}
      title="dar conversas do Duá"
      description={d.store.name}
      call={
        ok
          ? {
              action: 'ai-credits',
              body: { conversations: count, days: Number(days), ...(note.trim() ? { note } : {}) },
            }
          : null
      }
      confirm={ok ? `dar ${n(count)} ${count === 1 ? 'conversa' : 'conversas'}` : 'dar conversas'}
      done={(r) =>
        `${n(count)} ${count === 1 ? 'conversa' : 'conversas'} para ${d.store.name}, até ${fmtDay(r.expiresAt ?? until)}`
      }
      onClose={onClose}
    >
      <Field
        label="conversas"
        htmlFor="staff-ai-count"
        hint={!ok && raw.trim() ? `de 1 a ${n(MAX)}` : undefined}
      >
        <Input
          id="staff-ai-count"
          inputMode="numeric"
          value={raw}
          onChange={(e) => setRaw(e.target.value.replace(/\D/g, '').slice(0, 5))}
          className="tnum"
          aria-invalid={!ok && raw.trim() !== ''}
        />
      </Field>
      <Field label="valem por quantos dias">
        <Segmented value={days} onChange={setDays} options={DAYS} label="valem por quantos dias" />
      </Field>
      {ok && <FromTo label="restantes agora" from={n(ai.remaining)} to={n(ai.remaining + count)} />}
      <Effects
        items={[
          {
            text: `saem depois das ${n(ai.limit)} conversas ${ai.period === 'trial' ? 'do teste' : 'do mês'}, junto com os pacotes`,
          },
          ai.period === 'trial' && {
            text: 'valem no teste grátis também (um pacote comprado não valeria)',
          },
          { text: `vencem em ${fmtDay(until)}; as que vencem primeiro saem primeiro` },
          { text: 'o lojista recebe um aviso no WhatsApp' },
        ]}
      />
      <NoteField id="staff-ai-note" value={note} onChange={setNote} />
    </ActionSheet>
  );
}
