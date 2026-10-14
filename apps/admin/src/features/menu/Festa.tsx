import { ArrowSquareOut, Confetti, Plus, Trash, UsersThree } from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type PartyProfile, type PartyProfileIn } from '../../lib/api.ts';
import { num } from '../../lib/format.ts';
import { qk, useMutation } from '../../lib/query.ts';
import { useCan, useSession } from '../../lib/session.ts';
import { Button, IconButton } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { cn } from '../../ui/cn.ts';
import { DuaNote, ErrorState, messageOf } from '../../ui/feedback.tsx';
import {
  Field,
  Segmented,
  Select,
  Stepper,
  TextArea,
  TextInput,
  Toggle,
} from '../../ui/fields.tsx';
import { PageBody, PageHeader } from '../../ui/Page.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { RowsSkeleton } from '../../ui/skeletons.tsx';
import { toast } from '../../ui/Toast.tsx';

// Cardápio › Festa (0126, docs/features/festa-calculada.md): the party kinds the storefront's
// calculator (/festa) offers. Each group says how much goes per guest and which products fill it;
// Core does the arithmetic and the cart is an ordinary one at the store's prices.

type GroupDraft = PartyProfileIn['groups'][number] & { key: string; perGuestText: string };
type Draft = Omit<PartyProfileIn, 'groups'> & { groups: GroupDraft[] };

let seq = 0;
const newKey = () => `g${++seq}`;

const blankGroup = (name: string, perGuest: number): GroupDraft => ({
  key: newKey(),
  id: null,
  name,
  perGuest,
  perGuestText: String(perGuest).replace('.', ','),
  maxChoices: 3,
  required: true,
  dailyCapUnits: null,
  products: [],
});

/** a starting point a doceria or salgaderia recognises; every number is the owner's to change */
const STARTER: Draft = {
  name: 'Aniversário',
  description: null,
  childFactor: 0.5,
  minGuests: 10,
  maxGuests: 200,
  active: true,
  groups: [blankGroup('Salgados', 15), blankGroup('Docinhos', 4), blankGroup('Bolo', 1)],
};

function toDraft(p: PartyProfile): Draft {
  return {
    name: p.name,
    description: p.description,
    childFactor: p.childFactor,
    minGuests: p.minGuests,
    maxGuests: p.maxGuests,
    active: p.active,
    groups: p.groups.map((g) => ({
      key: g.id,
      id: g.id,
      name: g.name,
      perGuest: g.perGuest,
      perGuestText: String(g.perGuest).replace('.', ','),
      maxChoices: g.maxChoices,
      required: g.required,
      dailyCapUnits: g.dailyCapUnits,
      products: g.products.map((x) => ({ productId: x.productId, unitsPerSale: x.unitsPerSale })),
    })),
  };
}

const perGuestOf = (t: string) => {
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) && n > 0 && n <= 100 ? Math.round(n * 1000) / 1000 : null;
};

const CHILD: { value: string; label: string }[] = [
  { value: '0', label: 'não conta' },
  { value: '0.5', label: 'meia' },
  { value: '1', label: 'inteira' },
];

export default function Festa() {
  const manager = useCan('manager');
  const s = useSession();
  const { data, error, refetch } = useQuery({ queryKey: qk.party, queryFn: api.party });
  const [edit, setEdit] = useState<{ id: string | null; draft: Draft } | null>(null);
  const profiles = data?.profiles ?? [];
  return (
    <PageBody>
      <PageHeader
        title="Calculadora de festa"
        subtitle="O cliente diz quantas pessoas vêm e a loja calcula quanto de cada coisa. Vai para a sacola com os seus preços."
        back="/cardapio"
        actions={
          manager ? (
            <Button
              icon={<Plus />}
              onClick={() =>
                setEdit({
                  id: null,
                  draft: {
                    ...STARTER,
                    groups: STARTER.groups.map((g) => ({ ...g, key: newKey() })),
                  },
                })
              }
            >
              nova festa
            </Button>
          ) : null
        }
      />
      {error && !data ? (
        <ErrorState error={error} retry={() => void refetch()} />
      ) : !data ? (
        <RowsSkeleton rows={2} />
      ) : profiles.length === 0 ? (
        <DuaNote pose="avatar-feliz" title="Monte a primeira festa">
          Comece pelo modelo de aniversário: salgados, docinhos e bolo por pessoa. Você escolhe os
          produtos e ajusta as quantidades. Na loja, aparece em{' '}
          {s.store.url.replace('https://', '')}/festa.
        </DuaNote>
      ) : (
        <div className="space-y-3">
          {profiles.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={!manager}
              onClick={() => setEdit({ id: p.id, draft: toDraft(p) })}
              className="press block w-full rounded-lg bg-surface p-4 text-left ring-1 ring-line hover:bg-hover depth-1 disabled:pointer-events-none"
            >
              <span className="flex items-center gap-3">
                <span className="grid size-11 shrink-0 place-items-center rounded-full bg-sunken">
                  <Confetti weight="bold" className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">
                    {p.name}
                    {!p.active ? (
                      <span className="t-caption ml-2 text-muted">(pausada)</span>
                    ) : null}
                  </span>
                  <span className="t-caption block text-muted">
                    <UsersThree className="mr-1 inline size-4 align-[-3px]" />
                    {num(p.minGuests)} a {num(p.maxGuests)} pessoas
                  </span>
                </span>
              </span>
              <span className="t-caption mt-3 block text-muted">
                {p.groups
                  .map(
                    (g) =>
                      `${g.name}: ${g.perGuest.toLocaleString('pt-BR')} por pessoa, ${g.products.length} ${g.products.length === 1 ? 'opção' : 'opções'}`,
                  )
                  .join(' · ')}
              </span>
            </button>
          ))}
          <a
            href={`${s.store.url}/festa`}
            target="_blank"
            rel="noreferrer"
            className="t-label inline-flex min-h-11 items-center gap-1.5 px-1 text-muted underline underline-offset-2"
          >
            ver na loja <ArrowSquareOut className="size-4" />
          </a>
        </div>
      )}
      <PartySheet edit={edit} onClose={() => setEdit(null)} />
    </PageBody>
  );
}

function PartySheet({
  edit,
  onClose,
}: {
  edit: { id: string | null; draft: Draft } | null;
  onClose: () => void;
}) {
  return (
    <Sheet
      open={!!edit}
      onOpenChange={(v) => (v ? undefined : onClose())}
      title={edit?.id ? 'Editar festa' : 'Nova festa'}
      wide
    >
      {edit ? (
        <PartyForm key={edit.id ?? 'new'} id={edit.id} initial={edit.draft} onDone={onClose} />
      ) : null}
    </Sheet>
  );
}

function PartyForm({
  id,
  initial,
  onDone,
}: {
  id: string | null;
  initial: Draft;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [d, setD] = useState<Draft>(initial);
  const cat = useQuery({ queryKey: qk.catalog, queryFn: api.catalog });
  const party = useQuery({ queryKey: qk.party, queryFn: api.party });
  const asks = new Set(party.data?.needsChoices ?? []);
  const products = (cat.data?.categories ?? []).flatMap((c) =>
    c.products.filter((p) => p.status !== 'archived').map((p) => ({ id: p.id, name: p.name })),
  );
  const nameOf = (pid: string) => products.find((p) => p.id === pid)?.name ?? 'Produto';
  const used = new Set(d.groups.flatMap((g) => g.products.map((p) => p.productId)));
  const setGroup = (key: string, patch: Partial<GroupDraft>) =>
    setD((x) => ({ ...x, groups: x.groups.map((g) => (g.key === key ? { ...g, ...patch } : g)) }));

  const body = (): PartyProfileIn | string => {
    if (!d.name.trim()) return 'Dê um nome à festa.';
    if (d.minGuests > d.maxGuests) return 'O mínimo de pessoas passou do máximo.';
    if (!d.groups.length) return 'Adicione pelo menos um grupo.';
    const groups: PartyProfileIn['groups'] = [];
    for (const g of d.groups) {
      const per = perGuestOf(g.perGuestText);
      if (!g.name.trim()) return 'Todo grupo precisa de um nome.';
      if (per === null) return `${g.name}: quanto vai por pessoa?`;
      if (!g.products.length) return `${g.name}: escolha pelo menos um produto.`;
      groups.push({
        id: g.id,
        name: g.name.trim(),
        perGuest: per,
        maxChoices: g.maxChoices,
        required: g.required,
        dailyCapUnits: g.dailyCapUnits,
        products: g.products,
      });
    }
    return {
      name: d.name.trim(),
      description: d.description?.trim() || null,
      childFactor: d.childFactor,
      minGuests: d.minGuests,
      maxGuests: d.maxGuests,
      active: d.active,
      groups,
    };
  };

  const save = useMutation({
    mutationFn: (b: PartyProfileIn) => (id ? api.saveParty(id, b) : api.createParty(b)),
    onSuccess: (r) => {
      qc.setQueryData(qk.party, r);
      toast(id ? 'Festa salva' : 'Festa criada. Já aparece na loja.');
      onDone();
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  const remove = useMutation({
    mutationFn: () => api.deleteParty(id!),
    onSuccess: (r) => {
      qc.setQueryData(qk.party, r);
      toast('Festa apagada');
      onDone();
    },
    onError: (e) => toast.error(messageOf(e)),
  });

  return (
    <form
      className="space-y-6 pb-4"
      onSubmit={(e) => {
        e.preventDefault();
        const b = body();
        if (typeof b === 'string') toast.error(b);
        else save.mutate(b);
      }}
    >
      <div className="space-y-4">
        <Field label="Nome" htmlFor="party-name">
          <TextInput
            id="party-name"
            maxLength={60}
            value={d.name}
            placeholder="Ex.: Aniversário infantil"
            onChange={(e) => setD({ ...d, name: e.target.value })}
          />
        </Field>
        <Field label="Recado para o cliente" htmlFor="party-desc" optional>
          <TextArea
            id="party-desc"
            maxLength={200}
            rows={2}
            value={d.description ?? ''}
            placeholder="Ex.: Encomendas com 3 dias de antecedência."
            onChange={(e) => setD({ ...d, description: e.target.value })}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Mínimo de pessoas">
            <Stepper
              label="mínimo de pessoas"
              value={d.minGuests}
              min={1}
              max={1000}
              step={5}
              onChange={(v) => setD({ ...d, minGuests: v })}
            />
          </Field>
          <Field label="Máximo de pessoas">
            <Stepper
              label="máximo de pessoas"
              value={d.maxGuests}
              min={1}
              max={1000}
              step={10}
              onChange={(v) => setD({ ...d, maxGuests: v })}
            />
          </Field>
        </div>
        <Field label="Criança conta como" helper="Uma porção de adulto vale 1.">
          <Segmented
            label="criança conta como"
            value={String(d.childFactor)}
            options={
              CHILD.some((c) => c.value === String(d.childFactor))
                ? CHILD
                : [
                    ...CHILD,
                    { value: String(d.childFactor), label: `${Math.round(d.childFactor * 100)}%` },
                  ]
            }
            onChange={(v) => setD({ ...d, childFactor: Number(v) })}
          />
        </Field>
        <Toggle
          checked={d.active}
          onChange={(v) => setD({ ...d, active: v })}
          label="Aparece na loja"
          description={
            d.active ? 'O cliente encontra esta festa em /festa.' : 'Pausada: fica guardada aqui.'
          }
        />
      </div>

      <div className="space-y-4">
        <h3 className="t-label text-[1rem] font-semibold">O que vai na festa</h3>
        {d.groups.map((g) => {
          const free = products.filter((p) => !used.has(p.id) && !asks.has(p.id));
          return (
            <Card key={g.key} className="space-y-4 p-4">
              <div className="flex items-start gap-2">
                <Field label="Grupo" htmlFor={`gn-${g.key}`} className="min-w-0 flex-1">
                  <TextInput
                    id={`gn-${g.key}`}
                    maxLength={40}
                    value={g.name}
                    onChange={(e) => setGroup(g.key, { name: e.target.value })}
                  />
                </Field>
                <IconButton
                  label={`tirar ${g.name || 'grupo'}`}
                  variant="ghost"
                  className="mt-7"
                  onClick={() => setD({ ...d, groups: d.groups.filter((x) => x.key !== g.key) })}
                >
                  <Trash />
                </IconButton>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Por pessoa"
                  htmlFor={`gp-${g.key}`}
                  helper="Peças (ou fatias) por convidado. Aceita 1,5."
                  error={
                    g.perGuestText && perGuestOf(g.perGuestText) === null
                      ? 'Um número de 0,001 a 100.'
                      : null
                  }
                >
                  <TextInput
                    id={`gp-${g.key}`}
                    inputMode="decimal"
                    maxLength={7}
                    value={g.perGuestText}
                    onChange={(e) => setGroup(g.key, { perGuestText: e.target.value })}
                  />
                </Field>
                <Field label="O cliente escolhe até">
                  <Stepper
                    label={`escolhas em ${g.name}`}
                    value={g.maxChoices}
                    min={1}
                    max={10}
                    onChange={(v) => setGroup(g.key, { maxChoices: v })}
                  />
                </Field>
              </div>
              <div className="space-y-2">
                <p className="t-label">Produtos</p>
                {g.products.length ? (
                  <ul className="divide-y divide-line rounded-md ring-1 ring-line">
                    {g.products.map((x) => (
                      <li key={x.productId} className="flex flex-wrap items-center gap-3 px-3 py-2">
                        <span className="min-w-0 flex-1 basis-40">
                          <span className="block font-semibold">{nameOf(x.productId)}</span>
                          {asks.has(x.productId) ? (
                            <span className="t-caption block text-danger">
                              Pede uma escolha (sabor, tamanho): a calculadora não consegue colocar
                              na sacola. Tire daqui.
                            </span>
                          ) : null}
                        </span>
                        <label className="t-caption flex items-center gap-2 text-muted">
                          peças em cada um
                          <TextInput
                            className="w-20"
                            inputMode="numeric"
                            maxLength={4}
                            aria-label={`peças em cada ${nameOf(x.productId)}`}
                            value={String(x.unitsPerSale)}
                            onChange={(e) => {
                              const n = Math.max(
                                1,
                                Math.min(1000, Number(e.target.value.replace(/\D/g, '')) || 1),
                              );
                              setGroup(g.key, {
                                products: g.products.map((y) =>
                                  y.productId === x.productId ? { ...y, unitsPerSale: n } : y,
                                ),
                              });
                            }}
                          />
                        </label>
                        <IconButton
                          label={`tirar ${nameOf(x.productId)}`}
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setGroup(g.key, {
                              products: g.products.filter((y) => y.productId !== x.productId),
                            })
                          }
                        >
                          <Trash />
                        </IconButton>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="t-caption text-muted">
                    Nenhum ainda. Um cento conta 100 peças; um bolo para 25 pessoas, 25.
                  </p>
                )}
                {free.length ? (
                  <Select
                    label={`adicionar produto em ${g.name}`}
                    value=""
                    options={[
                      { value: '', label: '+ adicionar produto' },
                      ...free.map((p) => ({ value: p.id, label: p.name })),
                    ]}
                    onChange={(pid) =>
                      pid &&
                      setGroup(g.key, {
                        products: [
                          ...g.products,
                          { productId: pid, unitsPerSale: /cento/i.test(nameOf(pid)) ? 100 : 1 },
                        ],
                      })
                    }
                  />
                ) : null}
              </div>
              <div className="grid gap-x-4 border-t border-line pt-2 sm:grid-cols-2">
                <Toggle
                  checked={g.required}
                  onChange={(v) => setGroup(g.key, { required: v })}
                  label="Obrigatório"
                  description={
                    g.required ? 'Toda festa leva este grupo.' : 'O cliente pode deixar de fora.'
                  }
                />
                <Field
                  label="Limite por dia"
                  htmlFor={`gc-${g.key}`}
                  optional
                  helper="Peças que a cozinha faz por dia, somando as festas."
                  className="pt-2"
                >
                  <TextInput
                    id={`gc-${g.key}`}
                    inputMode="numeric"
                    maxLength={7}
                    placeholder="sem limite"
                    value={g.dailyCapUnits == null ? '' : String(g.dailyCapUnits)}
                    onChange={(e) => {
                      const v = e.target.value.replace(/\D/g, '');
                      setGroup(g.key, {
                        dailyCapUnits: v ? Math.min(1_000_000, Math.max(1, Number(v))) : null,
                      });
                    }}
                  />
                </Field>
              </div>
            </Card>
          );
        })}
        {d.groups.length < 8 ? (
          <Button
            variant="ghost"
            block
            icon={<Plus />}
            onClick={() => setD({ ...d, groups: [...d.groups, blankGroup('', 1)] })}
          >
            novo grupo
          </Button>
        ) : null}
      </div>

      <div
        className={cn(
          'flex flex-wrap gap-2 border-t border-line pt-4',
          id ? 'justify-between' : 'justify-end',
        )}
      >
        {id ? (
          <Button
            variant="ghost"
            icon={<Trash />}
            loading={remove.isPending}
            onClick={() => remove.mutate()}
          >
            apagar festa
          </Button>
        ) : null}
        <Button type="submit" loading={save.isPending}>
          {id ? 'salvar' : 'criar festa'}
        </Button>
      </div>
    </form>
  );
}
