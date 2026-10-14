import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../lib/api.ts';
import { money, num } from '../../lib/format.ts';
import { qk, useMutation } from '../../lib/query.ts';
import { useCan } from '../../lib/session.ts';
import { Button } from '../../ui/Button.tsx';
import { Card, Section } from '../../ui/Card.tsx';
import { messageOf } from '../../ui/feedback.tsx';
import { TextInput } from '../../ui/fields.tsx';
import { toast } from '../../ui/Toast.tsx';

// Início › "Comissão que você não pagou" (0123): the store's own-site orders against the
// commission the owner says their delivery app charges. Core sums it per order; this only shows
// it. Nothing here names a price of ours: it's the app's cut on the store's own sales.

const monthYear = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(
    new Date(`${iso}T12:00:00`),
  );

function parsePercent(v: string): number | null {
  const n = Number(v.replace('%', '').replace(',', '.').trim());
  return Number.isFinite(n) && n >= 1 && n <= 50 ? Math.round(n * 10) / 10 : null;
}

export function SavingsCard({ className = '' }: { className?: string }) {
  const manager = useCan('manager');
  const owner = useCan('owner');
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: qk.homeSavings,
    queryFn: api.homeSavings,
    enabled: manager,
  });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const save = useMutation({
    mutationFn: (p: number | null) => api.setMarketplaceFee(p),
    onSuccess: (d) => {
      qc.setQueryData(qk.homeSavings, d);
      setEditing(false);
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  if (!manager || !data || data.feePercent === 0) return null;
  // a manager can't set it: until the owner does, there's nothing to show them
  if (data.feePercent === null && !owner) return null;

  const percent = parsePercent(draft);
  const form = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (percent !== null) save.mutate(percent);
      }}
    >
      <label htmlFor="marketplace-fee" className="t-caption mb-1 block text-muted">
        Comissão do app, em %
      </label>
      <div className="flex items-stretch gap-2">
        <TextInput
          id="marketplace-fee"
          className="min-w-0 flex-1"
          inputMode="decimal"
          placeholder="27"
          maxLength={5}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-invalid={draft.trim() !== '' && percent === null ? true : undefined}
        />
        <Button
          type="submit"
          className="h-auto"
          disabled={percent === null}
          loading={save.isPending}
        >
          mostrar
        </Button>
      </div>
    </form>
  );

  if (data.feePercent === null || editing)
    return (
      <Section title="Comissão que você não pagou" className={className}>
        <Card className="space-y-4 p-5">
          <p className="t-body text-muted">
            Vende também num app de delivery? Diga quanto ele cobra de comissão e a gente mostra
            quanto ela custaria nos pedidos que chegaram pelo seu site.
          </p>
          {form}
          <div className="flex gap-2">
            {editing ? (
              <Button variant="quiet" size="sm" onClick={() => setEditing(false)}>
                cancelar
              </Button>
            ) : null}
            <Button
              variant="quiet"
              size="sm"
              loading={save.isPending}
              onClick={() => save.mutate(0)}
            >
              não uso app de delivery
            </Button>
          </div>
        </Card>
      </Section>
    );

  const pct = data.feePercent.toLocaleString('pt-BR');
  return (
    <Section title="Comissão que você não pagou" className={className}>
      <Card className="space-y-3 p-5">
        <div>
          <p className="tnum font-display text-[2rem] font-semibold leading-none">
            {money(data.month.feeCents)}
          </p>
          <p className="t-caption mt-1.5 text-muted">neste mês</p>
        </div>
        <p className="t-body">
          {data.month.orders
            ? `${num(data.month.orders)} ${data.month.orders === 1 ? 'pedido' : 'pedidos'} pelo seu site, ${money(data.month.salesCents)}. Num app com ${pct}% de comissão, esse valor ficaria com ele.`
            : `Nenhum pedido pelo seu site neste mês ainda. Cada um que chegar mostra aqui o que os ${pct}% do app levariam.`}
        </p>
        {data.since && data.all.feeCents > data.month.feeCents ? (
          <p className="t-caption text-muted">
            Desde {monthYear(data.since)}: {money(data.all.feeCents)} em {num(data.all.orders)}{' '}
            pedidos.
          </p>
        ) : null}
        {owner ? (
          <button
            type="button"
            className="t-caption text-muted underline underline-offset-2"
            onClick={() => {
              setDraft(pct);
              setEditing(true);
            }}
          >
            mudar a comissão ({pct}%)
          </button>
        ) : null}
      </Card>
    </Section>
  );
}
