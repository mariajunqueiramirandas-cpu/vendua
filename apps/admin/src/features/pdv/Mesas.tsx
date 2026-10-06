import { Check, PencilSimple, Plus, Receipt } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type PdvState, type PdvTable, type TabSummary } from '../../lib/api.ts';
import { haptic } from '../../lib/haptics.ts';
import { qk, useMutation } from '../../lib/query.ts';
import { isPlanRequired, useCan, useFeature } from '../../lib/session.ts';
import { Button } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { EmptyState, ErrorState } from '../../ui/feedback.tsx';
import { Field, SavedStepper, TextInput } from '../../ui/fields.tsx';
import { HoldButton } from '../../ui/HoldButton.tsx';
import { ArtStore } from '../../ui/illustrations.tsx';
import { LockedPage, PlanLocked, reasonOf } from '../../ui/PlanLocked.tsx';
import { TableTile } from '../../ui/pdv/TableTile.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { Bone } from '../../ui/skeletons.tsx';
import { toast } from '../../ui/Toast.tsx';
import { isCode, pdvError, usePdvState } from './data.ts';
import { PdvTop } from './parts.tsx';

// Mesas: the floor at a glance. A free table opens a comanda with one tap; a taken one shows its
// total (Core's), how long it's been open and its rounds. Comandas without a table ("Comanda 12",
// a name at the counter) sit below. Managers edit the tables and the service charge here.

function useNow(ms: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export default function Mesas() {
  return useFeature('pdv') ? <Floor /> : <LockedPage title="Mesas" feature="pdv" />;
}

function Floor() {
  const { data, error, refetch } = usePdvState();
  const manager = useCan('manager');
  const nav = useNavigate();
  const qc = useQueryClient();
  const now = useNow(30_000);
  const [editing, setEditing] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [edit, setEdit] = useState<PdvTable | null>(null);

  const tabs = data?.tabs ?? [];
  const tables = useMemo(() => [...(data?.tables ?? [])].sort((a, b) => a.sort - b.sort), [data]);
  const byTable = useMemo(() => {
    const m = new Map<string, TabSummary>();
    for (const t of tabs) if (t.tableId) m.set(t.tableId, t);
    return m;
  }, [tabs]);
  const loose = tabs.filter((t) => !t.tableId || !tables.some((x) => x.id === t.tableId));

  const open = useMutation({
    mutationFn: (p: { tableId?: string; label?: string; customerName?: string }) =>
      api.pdv.openTab(p),
    onSuccess: (r) => {
      haptic.commit();
      qc.setQueryData(qk.pdv.tab(r.tab.id), { tab: r.tab });
      void qc.invalidateQueries({ queryKey: qk.pdv.state });
      setNewOpen(false);
      nav(`/pdv/comanda/${r.tab.id}`);
    },
    onError: (e) => {
      // someone opened it a moment ago: go to that comanda
      const id = isCode(e, 'TABLE_BUSY') ? e.details?.tabId : undefined;
      if (typeof id === 'string') return nav(`/pdv/comanda/${id}`);
      toast.error(pdvError(e));
    },
  });

  const service = useMutation({
    mutationFn: (bps: number) => api.pdv.settings(bps),
    onSuccess: (r) =>
      qc.setQueryData<PdvState>(qk.pdv.state, (s) => (s ? { ...s, serviceBps: r.serviceBps } : s)),
    onError: (e) => toast.error(pdvError(e)),
  });

  if (isPlanRequired(error))
    return (
      <Body>
        <PdvTop title="Mesas" />
        <PlanLocked feature="pdv" reason={reasonOf(error)} refresh />
      </Body>
    );

  return (
    <Body>
      <PdvTop title="Mesas" />
      {error && !data ? (
        <ErrorState error={error} retry={() => void refetch()} />
      ) : !data ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-hidden>
          {Array.from({ length: 8 }, (_, i) => (
            <Bone key={i} className="h-28 rounded-lg" delay={i * 40} />
          ))}
        </div>
      ) : (
        <div className="space-y-8">
          <section aria-labelledby="mesas-t">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1">
              <h2 id="mesas-t" className="t-title-2">
                {editing ? 'Editar mesas' : 'Mesas'}
                {!editing && tables.length ? (
                  <span className="t-body ml-2 font-sans font-medium text-muted">
                    {byTable.size} de {tables.length} ocupadas
                  </span>
                ) : null}
              </h2>
              {manager ? (
                <Button
                  variant={editing ? 'primary' : 'ghost'}
                  size="sm"
                  icon={editing ? <Check /> : <PencilSimple />}
                  onClick={() => setEditing((v) => !v)}
                  className="min-h-11"
                >
                  {editing ? 'pronto' : 'editar mesas'}
                </Button>
              ) : null}
            </div>

            {editing ? (
              <Card className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">Taxa de serviço</p>
                  <p className="t-caption text-muted">
                    Entra nas comandas abertas daqui em diante. O cliente pode recusar.
                  </p>
                </div>
                <SavedStepper
                  label="taxa de serviço em porcentagem"
                  value={Math.round(data.serviceBps / 100)}
                  min={0}
                  max={20}
                  suffix="%"
                  onSave={(v) => service.mutateAsync(v * 100).catch(() => undefined)}
                />
              </Card>
            ) : null}

            {tables.length === 0 ? (
              <EmptyState
                art={<ArtStore />}
                title="Nenhuma mesa ainda"
                body={
                  manager
                    ? 'Crie as mesas do salão de uma vez, como Mesa 1 a Mesa 20.'
                    : 'Quem é gerente cria as mesas. Enquanto isso, abra comandas pelo nome.'
                }
                action={
                  manager ? (
                    <Button icon={<Plus />} onClick={() => setAddOpen(true)}>
                      criar mesas
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
                {tables.map((t) => {
                  const tab = byTable.get(t.id) ?? null;
                  return (
                    <li key={t.id}>
                      <TableTile
                        label={t.label}
                        tab={tab}
                        now={now}
                        editing={editing}
                        onClick={() =>
                          editing
                            ? setEdit(t)
                            : tab
                              ? nav(`/pdv/comanda/${tab.id}`)
                              : !open.isPending && open.mutate({ tableId: t.id })
                        }
                      />
                    </li>
                  );
                })}
                {editing ? (
                  <li>
                    <button
                      type="button"
                      onClick={() => setAddOpen(true)}
                      className="press t-label flex min-h-28 w-full flex-col items-center justify-center gap-1 rounded-lg bg-sunken text-muted hover:text-ink"
                    >
                      <Plus weight="bold" className="size-6" aria-hidden />
                      adicionar mesas
                    </button>
                  </li>
                ) : null}
              </ul>
            )}
          </section>

          {!editing ? (
            <section aria-labelledby="comandas-t">
              <div className="mb-3 px-1">
                <h2 id="comandas-t" className="t-title-2">
                  Comandas sem mesa
                </h2>
                <p className="t-body mt-0.5 text-muted">
                  Pelo número da ficha ou o nome do cliente.
                </p>
              </div>
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
                {loose.map((t) => (
                  <li key={t.id}>
                    <TableTile
                      label={t.label}
                      tab={t}
                      now={now}
                      onClick={() => nav(`/pdv/comanda/${t.id}`)}
                    />
                  </li>
                ))}
                <li>
                  <button
                    type="button"
                    onClick={() => setNewOpen(true)}
                    className="press t-label flex min-h-28 w-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-line-strong text-muted hover:bg-hover hover:text-ink"
                  >
                    <Receipt weight="duotone" className="size-7" aria-hidden />
                    nova comanda
                  </button>
                </li>
              </ul>
            </section>
          ) : null}
        </div>
      )}

      <NewTabSheet
        open={newOpen}
        onOpenChange={setNewOpen}
        suggestion={nextLabel(tabs)}
        busy={open.isPending}
        onOpen={(label, customerName) =>
          open.mutate({ label, ...(customerName ? { customerName } : {}) })
        }
      />
      {manager ? (
        <>
          <AddTablesSheet open={addOpen} onOpenChange={setAddOpen} tables={tables} />
          <EditTableSheet
            table={edit}
            busy={!!(edit && byTable.get(edit.id))}
            onClose={() => setEdit(null)}
          />
        </>
      ) : null}
    </Body>
  );
}

function Body({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[1320px] px-4 pb-32 pt-4 md:px-8 md:pb-16 md:pt-6">
      {children}
    </div>
  );
}

/** "Comanda 13" after the highest numbered one open (only a suggestion: the label is free). */
function nextLabel(tabs: TabSummary[]) {
  const n = Math.max(
    0,
    ...tabs.map((t) => Number(/^Comanda (\d+)$/i.exec(t.label.trim())?.[1] ?? 0)),
  );
  return `Comanda ${n + 1}`;
}

function NewTabSheet({
  open,
  onOpenChange,
  suggestion,
  busy,
  onOpen,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  suggestion: string;
  busy: boolean;
  onOpen: (label: string, customerName: string) => void;
}) {
  const [label, setLabel] = useState(suggestion);
  const [name, setName] = useState('');
  const labelId = useId();
  const nameId = useId();
  useEffect(() => {
    if (!open) return;
    setLabel(suggestion);
    setName('');
  }, [open, suggestion]);
  const ok = label.trim().length > 0;
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Nova comanda"
      description="Sem mesa: pelo número da ficha ou pelo nome de quem pediu."
      footer={
        <Button
          size="lg"
          block
          disabled={!ok}
          loading={busy}
          onClick={() => onOpen(label.trim().slice(0, 40), name.trim().slice(0, 80))}
        >
          abrir comanda
        </Button>
      }
    >
      <form
        className="space-y-5 pb-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (ok && !busy) onOpen(label.trim().slice(0, 40), name.trim().slice(0, 80));
        }}
      >
        <Field label="Nome da comanda" htmlFor={labelId}>
          <TextInput
            id={labelId}
            maxLength={40}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </Field>
        <Field label="Cliente" htmlFor={nameId} optional>
          <TextInput
            id={nameId}
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
      </form>
    </Sheet>
  );
}

function AddTablesSheet({
  open,
  onOpenChange,
  tables,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tables: PdvTable[];
}) {
  const qc = useQueryClient();
  const [prefix, setPrefix] = useState('Mesa');
  const [from, setFrom] = useState('1');
  const [to, setTo] = useState('10');
  const ids = { prefix: useId(), from: useId(), to: useId() };
  useEffect(() => {
    if (!open) return;
    const n = Math.max(0, ...tables.map((t) => Number(/(\d+)\s*$/.exec(t.label)?.[1] ?? 0)));
    setFrom(String(n + 1));
    setTo(String(n + (n ? 5 : 10)));
  }, [open, tables]);
  const a = Math.max(0, Math.floor(Number(from) || 0));
  const b = Math.max(0, Math.floor(Number(to) || 0));
  const count = b >= a && a > 0 ? b - a + 1 : 0;
  const labels =
    count > 0 && count <= 100
      ? Array.from({ length: count }, (_, i) => `${prefix.trim()} ${a + i}`.trim().slice(0, 40))
      : [];
  const add = useMutation({
    mutationFn: () => api.pdv.addTables(labels),
    onSuccess: (r) => {
      haptic.commit();
      qc.setQueryData<PdvState>(qk.pdv.state, (s) => (s ? { ...s, tables: r.tables } : s));
      void qc.invalidateQueries({ queryKey: qk.pdv.state });
      toast(`${labels.length === 1 ? 'Mesa criada' : `${labels.length} mesas criadas`}.`);
      onOpenChange(false);
    },
    onError: (e) => toast.error(pdvError(e)),
  });
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Adicionar mesas"
      description="Várias de uma vez. Um nome que já existe fica de fora."
      footer={
        <Button
          size="lg"
          block
          disabled={!labels.length}
          loading={add.isPending}
          onClick={() => add.mutate()}
        >
          {labels.length
            ? `criar ${labels.length === 1 ? '1 mesa' : `${labels.length} mesas`}`
            : 'criar mesas'}
        </Button>
      }
    >
      <div className="space-y-5 pb-2">
        <Field label="Nome" htmlFor={ids.prefix} helper="Mesa, Varanda, Balcão…">
          <TextInput
            id={ids.prefix}
            maxLength={30}
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Do número" htmlFor={ids.from}>
            <TextInput
              id={ids.from}
              inputMode="numeric"
              value={from}
              onChange={(e) => setFrom(e.target.value.replace(/\D/g, '').slice(0, 3))}
              className="tnum"
            />
          </Field>
          <Field label="Até o número" htmlFor={ids.to}>
            <TextInput
              id={ids.to}
              inputMode="numeric"
              value={to}
              onChange={(e) => setTo(e.target.value.replace(/\D/g, '').slice(0, 3))}
              className="tnum"
            />
          </Field>
        </div>
        <p className="t-body text-muted" role="status">
          {count > 100
            ? 'No máximo 100 mesas de uma vez.'
            : labels.length
              ? labels.length <= 3
                ? labels.join(', ')
                : `${labels[0]}, ${labels[1]} … ${labels[labels.length - 1]}`
              : 'Escolha de qual número até qual.'}
        </p>
      </div>
    </Sheet>
  );
}

function EditTableSheet({
  table,
  busy,
  onClose,
}: {
  table: PdvTable | null;
  busy: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [label, setLabel] = useState('');
  const id = useId();
  useEffect(() => {
    if (table) setLabel(table.label);
  }, [table]);
  const done = () => {
    void qc.invalidateQueries({ queryKey: qk.pdv.state });
    onClose();
  };
  const rename = useMutation({
    mutationFn: () => api.pdv.updateTable(table!.id, { label: label.trim().slice(0, 40) }),
    onSuccess: (r) => {
      qc.setQueryData<PdvState>(qk.pdv.state, (s) =>
        s ? { ...s, tables: s.tables.map((t) => (t.id === r.table.id ? r.table : t)) } : s,
      );
      done();
    },
    onError: (e) => toast.error(pdvError(e)),
  });
  const archive = useMutation({
    mutationFn: () => api.pdv.archiveTable(table!.id),
    onSuccess: (r) => {
      haptic.commit();
      qc.setQueryData<PdvState>(qk.pdv.state, (s) => (s ? { ...s, tables: r.tables } : s));
      toast(`${table?.label ?? 'A mesa'} saiu do salão.`);
      done();
    },
    onError: (e) => toast.error(pdvError(e)),
  });
  const ok = label.trim().length > 0 && label.trim() !== table?.label;
  return (
    <Sheet
      open={!!table}
      onOpenChange={(o) => !o && onClose()}
      title={table ? `Editar ${table.label}` : 'Editar mesa'}
      footer={
        <Button
          size="lg"
          block
          disabled={!ok}
          loading={rename.isPending}
          onClick={() => rename.mutate()}
        >
          salvar o nome
        </Button>
      }
    >
      <div className="space-y-6 pb-2">
        <Field label="Nome da mesa" htmlFor={id}>
          <TextInput
            id={id}
            maxLength={40}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </Field>
        <div className="space-y-2 border-t border-line pt-5">
          <p className="font-semibold">Tirar do salão</p>
          <p className="t-body text-muted">
            {busy
              ? 'Essa mesa tem uma comanda aberta. Feche a comanda antes de tirar a mesa.'
              : 'A mesa some daqui. As comandas antigas dela continuam no histórico.'}
          </p>
          <HoldButton disabled={busy || archive.isPending} onConfirm={() => archive.mutate()}>
            segure para tirar a mesa
          </HoldButton>
        </div>
      </div>
    </Sheet>
  );
}
