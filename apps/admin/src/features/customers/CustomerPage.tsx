import {
  DownloadSimple,
  Gift,
  Plus,
  ShieldCheck,
  Tag,
  WhatsappLogo,
  X,
} from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { whatsappUrl } from '@vendua/kernel/rules';
import { useAutosave } from '../../lib/autosave.ts';
import { api, type CustomerDetail, type CustomerNotes } from '../../lib/api.ts';
import { ago, dateShort, money, phone, plural } from '../../lib/format.ts';
import { qk, useMutation } from '../../lib/query.ts';
import { useCan, useSession } from '../../lib/session.ts';
import { Button } from '../../ui/Button.tsx';
import { Card, Section } from '../../ui/Card.tsx';
import { cn } from '../../ui/cn.ts';
import { ErrorState, messageOf } from '../../ui/feedback.tsx';
import { Field, SaveMark, TextArea, TextInput } from '../../ui/fields.tsx';
import { HoldButton } from '../../ui/HoldButton.tsx';
import { PageBody, PageHeader } from '../../ui/Page.tsx';
import { DetailSkeleton } from '../../ui/skeletons.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { toast } from '../../ui/Toast.tsx';
import { OrderRowView } from '../orders/OrderRowView.tsx';
import { CustomerFacts } from '../vendedor/CustomerFacts.tsx';

export default function CustomerPage() {
  const { phone: ph = '' } = useParams();
  const s = useSession();
  const owner = useCan('owner');
  const { data, error, refetch } = useQuery({
    queryKey: qk.customer(ph),
    queryFn: () => api.customer(ph),
  });
  const [forget, setForget] = useState(false);
  if (error && !data)
    return (
      <PageBody>
        <PageHeader title="Cliente" back="/clientes" />
        <ErrorState error={error} retry={() => void refetch()} />
      </PageBody>
    );
  if (!data)
    return (
      <PageBody>
        <PageHeader title="Cliente" back="/clientes" />
        <DetailSkeleton />
      </PageBody>
    );
  const c = data.customer;
  const l = data.loyalty;
  const exportJson = async () => {
    try {
      const body = await api.exportCustomer(ph);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' }),
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = `cliente-${ph}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(messageOf(e));
    }
  };
  return (
    <PageBody>
      <div data-vt-dst={`customer:${c.phone}`}>
        <PageHeader title={c.name} subtitle={phone(c.phone)} back="/clientes" />
      </div>
      <div className="mb-5 flex flex-wrap gap-2">
        <a
          href={
            whatsappUrl(c.phone, `Oi, ${c.name.split(' ')[0]}! Aqui é da ${s.store.name}.`) ??
            undefined
          }
          target="_blank"
          rel="noreferrer"
          className="press t-label inline-flex min-h-12 items-center gap-2 rounded-md bg-whatsapp px-4 text-on-whatsapp"
        >
          <WhatsappLogo weight="fill" className="size-5" /> conversar no WhatsApp
        </a>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['pedidos', String(c.orders)],
          ['gastou no total', money(c.spentCents)],
          ['ticket médio', c.orders ? money(c.avgTicketCents) : '—'],
          ['cliente desde', dateShort(c.firstAt)],
        ].map(([k, v]) => (
          <Card key={k} className="p-4">
            <p className="tnum font-display text-xl font-semibold">{v}</p>
            <p className="t-caption text-muted">{k}</p>
          </Card>
        ))}
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-2 [&>*]:min-w-0">
        <div className="space-y-8">
          <NotesSection phone={ph} notes={data.notes} known={data.knownTags} />
          {l.enabled ? (
            <Section title="Cartão fidelidade">
              <Card className="p-5">
                <div
                  className="flex flex-wrap gap-2"
                  role="img"
                  aria-label={`${l.stamps} de ${l.stampsRequired} selos`}
                >
                  {Array.from({ length: l.stampsRequired }, (_, i) => (
                    <span
                      key={i}
                      className={cn(
                        'grid size-10 place-items-center rounded-full ring-2',
                        i < l.stamps
                          ? 'bg-spark text-on-spark ring-spark'
                          : 'ring-line-strong text-faint',
                      )}
                    >
                      {i < l.stamps ? '★' : i + 1}
                    </span>
                  ))}
                </div>
                <p className="t-body mt-3 text-muted">
                  Faltam {Math.max(0, l.stampsRequired - l.stamps)} para ganhar {l.rewardLabel}.
                </p>
                {l.rewards.length ? (
                  <ul className="mt-3 space-y-1">
                    {l.rewards.map((r) => (
                      <li key={r.code} className="t-body flex items-center gap-2">
                        <Gift className="size-5 text-success" /> <strong>{r.code}</strong> ·{' '}
                        {r.label}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </Card>
            </Section>
          ) : null}
          {data.favorites.length ? (
            <Section title="O que mais pede">
              <Card className="divide-y divide-line">
                {data.favorites.map((f) => (
                  <div key={f.name} className="flex min-h-14 items-center justify-between px-4">
                    <span>{f.name}</span>
                    <span className="tnum font-semibold">{f.qty}×</span>
                  </div>
                ))}
              </Card>
            </Section>
          ) : null}
          <CustomerFacts phone={ph} customer={c.name} />
          {data.lastAddress ? (
            <Section title="Último endereço">
              <Card className="p-4">
                <p>
                  {[data.lastAddress.address, data.lastAddress.neighborhood]
                    .filter(Boolean)
                    .join(' — ')}
                </p>
              </Card>
            </Section>
          ) : null}
          {owner ? (
            <Section
              title="Dados pessoais (LGPD)"
              hint="Quando o cliente pedir uma cópia dos dados ou para apagar."
            >
              <Card className="flex flex-wrap gap-2 p-4">
                <Button
                  variant="secondary"
                  icon={<DownloadSimple />}
                  onClick={() => void exportJson()}
                >
                  baixar dados
                </Button>
                <Button
                  variant="ghost"
                  className="text-danger"
                  icon={<ShieldCheck />}
                  onClick={() => setForget(true)}
                >
                  apagar dados do cliente
                </Button>
              </Card>
            </Section>
          ) : null}
        </div>
        <Section title="Pedidos">
          <Card className="overflow-hidden">
            <ul>
              {data.orders.map((o) => (
                <OrderRowView key={o.id} o={o} />
              ))}
            </ul>
          </Card>
        </Section>
      </div>
      <ForgetSheet open={forget} onOpenChange={setForget} phone={c.phone} name={c.name} />
    </PageBody>
  );
}

// same rules as Core (routes-customers.ts): lowercase, one space, ≤ 24 characters, ≤ 10 tags
const TAG_MAX = 24;
const TAGS_MAX = 10;
const NOTE_MAX = 2000;
const tagOf = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase().slice(0, TAG_MAX);

type Draft = { note: string; tags: string[] };

/** What the store writes down about this customer: saved as it's typed, no button (§2.2.5). */
function NotesSection({
  phone: ph,
  notes,
  known,
}: {
  phone: string;
  notes: CustomerNotes;
  known: string[];
}) {
  const qc = useQueryClient();
  const initial = useMemo(() => ({ note: notes.note, tags: notes.tags }), [notes.note, notes.tags]);
  const { draft, setDraft, state } = useAutosave<Draft>(initial, async (v) => {
    const r = await api.saveCustomerNotes(ph, v);
    // Core trims the note; the draft keeps what's typed, so a pause after a space loses nothing
    qc.setQueryData<CustomerDetail>(qk.customer(ph), (old) =>
      old ? { ...old, notes: { ...r.notes, note: v.note }, knownTags: r.knownTags } : old,
    );
    void qc.invalidateQueries({ queryKey: ['customers'], exact: false, refetchType: 'none' });
    return v;
  });
  const [tag, setTag] = useState('');
  const add = (raw: string) => {
    const t = tagOf(raw);
    setTag('');
    if (!t) return;
    setDraft((d) =>
      d.tags.includes(t) || d.tags.length >= TAGS_MAX ? d : { ...d, tags: [...d.tags, t] },
    );
  };
  const remove = (t: string) => setDraft((d) => ({ ...d, tags: d.tags.filter((x) => x !== t) }));
  const suggestions = known.filter((t) => !draft.tags.includes(t)).slice(0, 6);
  const full = draft.tags.length >= TAGS_MAX;
  return (
    <Section
      title="Anotações"
      hint="Só a equipe vê. Apagar os dados do cliente apaga isto também."
      action={<SaveMark state={state} />}
    >
      <Card className="space-y-5 p-4">
        <Field
          label="Etiquetas"
          htmlFor="customer-tag"
          helper={
            full
              ? `Até ${TAGS_MAX} etiquetas por cliente.`
              : 'Separe clientes por grupo, como "vip" ou "atacado". Dá para filtrar a lista por elas.'
          }
        >
          {draft.tags.length ? (
            <ul className="flex flex-wrap gap-2" aria-label="etiquetas do cliente">
              {draft.tags.map((t) => (
                <li
                  key={t}
                  className="t-label inline-flex h-10 items-center gap-1.5 rounded-full bg-sunken pl-3 ring-1 ring-line"
                >
                  <Tag className="size-4 shrink-0 text-muted" aria-hidden />
                  {t}
                  <button
                    type="button"
                    aria-label={`tirar a etiqueta ${t}`}
                    onClick={() => remove(t)}
                    className="press grid size-10 place-items-center rounded-full text-muted hover:bg-hover hover:text-ink"
                  >
                    <X weight="bold" className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {full ? null : (
            <TextInput
              id="customer-tag"
              placeholder="Nova etiqueta"
              enterKeyHint="done"
              maxLength={TAG_MAX}
              value={tag}
              onChange={(e) => {
                const v = e.target.value;
                // a comma (pasted lists, phone keyboards) closes the tag like Enter
                if (v.includes(',')) v.split(',').forEach(add);
                else setTag(v);
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                add(tag);
              }}
              onBlur={() => add(tag)}
            />
          )}
          {suggestions.length && !full ? (
            <div className="flex flex-wrap gap-2">
              {suggestions.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => add(t)}
                  className="press t-caption inline-flex h-9 items-center gap-1 rounded-full px-3 text-muted ring-1 ring-line-strong hover:bg-hover hover:text-ink"
                >
                  <Plus weight="bold" className="size-3.5" aria-hidden />
                  {t}
                </button>
              ))}
            </div>
          ) : null}
        </Field>
        <Field
          label="Anotação"
          htmlFor="customer-note"
          helper={
            notes.updatedBy && notes.updatedAt
              ? `Última mudança: ${notes.updatedBy}, ${ago(notes.updatedAt)}.`
              : undefined
          }
        >
          <TextArea
            id="customer-note"
            placeholder="Ex.: prefere sem açúcar, entregar no portão lateral"
            maxLength={NOTE_MAX}
            value={draft.note}
            onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
          />
        </Field>
      </Card>
    </Section>
  );
}

function ForgetSheet({
  open,
  onOpenChange,
  phone: ph,
  name,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  phone: string;
  name: string;
}) {
  const [confirm, setConfirm] = useState('');
  const qc = useQueryClient();
  const nav = useNavigate();
  const run = useMutation({
    mutationFn: () => api.forgetCustomer(ph, confirm),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['customers'] });
      void qc.invalidateQueries({ queryKey: ['orders'] });
      toast(
        `Dados apagados. ${plural(r.anonymized, 'pedido ficou', 'pedidos ficaram')} sem nome e telefone.`,
      );
      nav('/clientes');
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  const ok = confirm === ph.slice(-4);
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Apagar os dados de ${name}?`}
      description="Os pedidos continuam nos seus relatórios, mas sem nome, telefone e endereço. Não dá para desfazer."
      footer={
        <HoldButton disabled={!ok || run.isPending} onConfirm={() => run.mutate()}>
          {run.isPending ? 'apagando…' : 'segure para apagar'}
        </HoldButton>
      }
    >
      <Field
        label="Para confirmar, digite os 4 últimos números do telefone"
        htmlFor="forget-confirm"
        className="pt-2"
      >
        <TextInput
          id="forget-confirm"
          inputMode="numeric"
          maxLength={4}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ''))}
          className="tnum w-32 text-center"
        />
      </Field>
    </Sheet>
  );
}
