import {
  ArrowCircleDown,
  ArrowCircleUp,
  CaretRight,
  CashRegister,
  LockSimple,
} from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  api,
  type ByMethod,
  type CaixaDetail,
  type CaixaHistoryRow,
  type PdvMethod,
} from '../../lib/api.ts';
import { clock, dateShort, money, when } from '../../lib/format.ts';
import { haptic } from '../../lib/haptics.ts';
import { qk, useMutation } from '../../lib/query.ts';
import { isPlanRequired, useCan, useFeature } from '../../lib/session.ts';
import { Button } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { cn } from '../../ui/cn.ts';
import { ErrorState } from '../../ui/feedback.tsx';
import { Field, MoneyField, Segmented, TextArea } from '../../ui/fields.tsx';
import { HoldButton } from '../../ui/HoldButton.tsx';
import { ActionBar } from '../../ui/Page.tsx';
import { PDV_METHOD_LABEL } from '../../ui/PaymentChip.tsx';
import { PDV_METHOD_ICON, PDV_METHODS } from '../../ui/pdv/methods.ts';
import { LockedPage, PlanLocked, reasonOf } from '../../ui/PlanLocked.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { Bone, RowsSkeleton } from '../../ui/skeletons.tsx';
import { toast } from '../../ui/Toast.tsx';
import { isCode, pdvError, putCaixa, useCaixa } from './data.ts';
import { PdvTop, ReasonField } from './parts.tsx';
import { PrintButton, usePdvPrint } from './print.tsx';

// O caixa: opened with the float in the drawer, it collects every counter payment, sangrias and
// suprimentos, and closes with a count per method. Managers see what Core expects; attendants
// count blind and see the differences on the closing report.

export default function Caixa() {
  return useFeature('pdv') ? <Drawer /> : <LockedPage title="Caixa" feature="pdv" />;
}

function Drawer() {
  const q = useCaixa();
  const caixa = q.data;
  const [sheet, setSheet] = useState<'sangria' | 'suprimento' | 'close' | null>(null);

  if (isPlanRequired(q.error))
    return (
      <Body>
        <PlanLocked feature="pdv" reason={reasonOf(q.error)} refresh />
      </Body>
    );

  return (
    <Body>
      <PdvTop title="Caixa" />
      {q.error && caixa === undefined ? (
        <ErrorState error={q.error} retry={() => void q.refetch()} />
      ) : caixa === undefined ? (
        <div className="space-y-3" aria-hidden>
          <Bone className="h-36 rounded-lg" />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {Array.from({ length: 5 }, (_, i) => (
              <Bone key={i} className="h-24 rounded-lg" delay={i * 40} />
            ))}
          </div>
        </div>
      ) : caixa ? (
        <OpenDrawer caixa={caixa} onSheet={setSheet} />
      ) : (
        <OpenForm />
      )}

      <History />

      {caixa ? (
        <>
          <MovementSheet
            kind={sheet === 'sangria' || sheet === 'suprimento' ? sheet : null}
            onClose={() => setSheet(null)}
          />
          <CloseSheet
            caixa={caixa}
            open={sheet === 'close'}
            onOpenChange={(o) => setSheet(o ? 'close' : null)}
          />
          <ActionBar>
            <Button
              variant="secondary"
              size="lg"
              className="flex-1"
              onClick={() => setSheet('sangria')}
            >
              sangria
            </Button>
            <Button size="lg" className="flex-1" onClick={() => setSheet('close')}>
              fechar caixa
            </Button>
          </ActionBar>
        </>
      ) : null}
    </Body>
  );
}

function Body({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 pb-36 pt-4 md:px-8 md:pb-16 md:pt-6">
      {children}
    </div>
  );
}

function OpenForm() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const loc = useLocation();
  const fromSale = !!(loc.state as { from?: string } | null)?.from;
  const [cents, setCents] = useState<number | null>(null);
  const id = useId();
  const open = useMutation({
    mutationFn: () => api.pdv.openCaixa(cents ?? 0),
    onSuccess: (r) => {
      haptic.commit();
      putCaixa(qc, r.caixa);
      toast(fromSale ? 'Caixa aberto. Agora é só cobrar.' : 'Caixa aberto. Boas vendas!');
      // opened from a charge: back to the ticket that was waiting
      if (fromSale) nav(-1);
    },
    onError: (e) => {
      if (isCode(e, 'CAIXA_OPEN')) void qc.invalidateQueries({ queryKey: ['pdv'] });
      toast.error(pdvError(e));
    },
  });
  return (
    <Card className="relative overflow-hidden p-5 md:p-8">
      <div
        aria-hidden
        className="absolute -right-14 -top-14 size-48 rounded-full bg-spark opacity-20 blur-3xl"
      />
      <form
        className="relative flex flex-col gap-5 md:flex-row md:items-end md:gap-8"
        onSubmit={(e) => {
          e.preventDefault();
          if (!open.isPending) open.mutate();
        }}
      >
        <div className="min-w-0 flex-1">
          <span className="mb-3 grid size-14 place-items-center rounded-2xl bg-warning-soft text-warning">
            <LockSimple weight="duotone" className="size-8" aria-hidden />
          </span>
          <h2 className="t-title-1">O caixa está fechado</h2>
          <p className="t-body mt-1 max-w-prose text-muted">
            Conte o troco que está na gaveta e abra o caixa. Sem caixa aberto não dá para receber no
            balcão nem nas mesas.
          </p>
        </div>
        <div className="w-full space-y-3 md:w-72">
          <Field label="Troco na gaveta" htmlFor={id} helper="Pode ser zero.">
            <MoneyField id={id} cents={cents} allowEmpty onCommit={setCents} />
          </Field>
          <Button type="submit" size="lg" block loading={open.isPending} icon={<CashRegister />}>
            abrir o caixa
          </Button>
        </div>
      </form>
    </Card>
  );
}

function OpenDrawer({
  caixa,
  onSheet,
}: {
  caixa: CaixaDetail;
  onSheet: (s: 'sangria' | 'suprimento' | 'close') => void;
}) {
  const manager = useCan('manager');
  const printing = usePdvPrint();
  // the partial shows what Core expects: managers only
  const print = manager ? (
    <PrintButton
      printing={printing}
      what={{ kind: 'caixa', id: caixa.id }}
      label="imprimir parcial"
    />
  ) : null;
  return (
    <div className="space-y-5">
      {printing.sheet}
      <Card className="flex flex-wrap items-center gap-x-6 gap-y-3 p-5">
        <div className="min-w-0 flex-1">
          <p className="t-caption text-muted">
            aberto {when(caixa.openedAt)} por {caixa.openedBy}
          </p>
          <p className="t-title-2 mt-0.5">
            {caixa.salesCount} {caixa.salesCount === 1 ? 'venda' : 'vendas'} neste caixa
          </p>
          <p className="t-body tnum mt-1 text-muted">
            Troco inicial {money(caixa.openingCents)}
            {caixa.changeCents ? ` · troco dado ${money(caixa.changeCents)}` : ''}
            {caixa.serviceCents ? ` · serviço ${money(caixa.serviceCents)}` : ''}
          </p>
        </div>
        {manager && caixa.expected ? (
          <div className="rounded-md bg-spark-soft px-4 py-3">
            <p className="t-caption">Esperado na gaveta</p>
            <p className="tnum t-title-2">{money(caixa.expected.cash)}</p>
          </div>
        ) : null}
        <div className="hidden w-full gap-2 md:flex">
          <Button variant="secondary" icon={<ArrowCircleUp />} onClick={() => onSheet('sangria')}>
            sangria
          </Button>
          <Button
            variant="secondary"
            icon={<ArrowCircleDown />}
            onClick={() => onSheet('suprimento')}
          >
            suprimento
          </Button>
          {print}
          <Button className="ml-auto" onClick={() => onSheet('close')}>
            fechar caixa
          </Button>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 md:hidden">
          <Button
            variant="ghost"
            size="sm"
            icon={<ArrowCircleDown />}
            className="min-h-11"
            onClick={() => onSheet('suprimento')}
          >
            suprimento
          </Button>
          {print}
        </div>
      </Card>

      <section aria-labelledby="formas-t">
        <h2 id="formas-t" className="t-title-2 mb-3 px-1">
          Recebido por forma
        </h2>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {PDV_METHODS.map((m) => {
            const Icon = PDV_METHOD_ICON[m];
            const v = caixa.byMethod[m];
            return (
              <li key={m}>
                <Card className="h-full p-4">
                  <p className="t-label flex items-center gap-1.5">
                    <Icon weight="duotone" className="size-5" aria-hidden />
                    {PDV_METHOD_LABEL[m]}
                  </p>
                  <p className="tnum t-title-2 mt-2">
                    {v?.cents == null ? (
                      <span className="text-muted" title="o gerente vê os valores no fechamento">
                        ——
                      </span>
                    ) : (
                      money(v.cents)
                    )}
                  </p>
                  <p className="t-caption tnum text-muted">
                    {v?.count ?? 0} {(v?.count ?? 0) === 1 ? 'pagamento' : 'pagamentos'}
                  </p>
                </Card>
              </li>
            );
          })}
        </ul>
      </section>

      <Movements movements={caixa.movements} />
    </div>
  );
}

export function Movements({ movements }: { movements: CaixaDetail['movements'] }) {
  if (!movements.length) return null;
  return (
    <section aria-labelledby="mov-t">
      <h2 id="mov-t" className="t-title-2 mb-3 px-1">
        Sangrias e suprimentos
      </h2>
      <Card className="divide-y divide-line">
        {movements.map((m) => {
          const out = m.kind === 'sangria';
          const Icon = out ? ArrowCircleUp : ArrowCircleDown;
          return (
            <div key={m.id} className="flex items-center gap-3 p-4">
              <Icon
                weight="duotone"
                className={cn('size-6 shrink-0', out ? 'text-warning' : 'text-success')}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{out ? 'Sangria' : 'Suprimento'}</p>
                <p className="t-caption text-muted">
                  {clock(m.at)} · {m.by} · {m.reason}
                </p>
              </div>
              <span className="tnum font-semibold">
                {out ? '−' : '+'}
                {money(m.amountCents)}
              </span>
            </div>
          );
        })}
      </Card>
    </section>
  );
}

function MovementSheet({
  kind: given,
  onClose,
}: {
  kind: 'sangria' | 'suprimento' | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<'sangria' | 'suprimento'>('sangria');
  const [cents, setCents] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const id = useId();
  useEffect(() => {
    if (!given) return;
    setKind(given);
    setCents(null);
    setReason('');
  }, [given]);
  const save = useMutation({
    mutationFn: () =>
      api.pdv.movement({ kind, amountCents: cents ?? 0, reason: reason.trim().slice(0, 140) }),
    onSuccess: (r) => {
      haptic.commit();
      putCaixa(qc, r.caixa);
      toast(kind === 'sangria' ? 'Sangria registrada.' : 'Suprimento registrado.');
      onClose();
    },
    onError: (e) => toast.error(pdvError(e)),
  });
  const ok = (cents ?? 0) > 0 && reason.trim().length > 0;
  return (
    <Sheet
      open={!!given}
      onOpenChange={(o) => !o && onClose()}
      title={kind === 'sangria' ? 'Sangria' : 'Suprimento'}
      description={
        kind === 'sangria'
          ? 'Dinheiro que sai da gaveta: um depósito, um pagamento a fornecedor.'
          : 'Dinheiro que entra na gaveta: mais troco, por exemplo.'
      }
      footer={
        <Button
          size="lg"
          block
          disabled={!ok}
          loading={save.isPending}
          onClick={() => save.mutate()}
        >
          registrar {kind}
        </Button>
      }
    >
      <div className="space-y-5 pb-2">
        <Segmented
          label="tipo"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'sangria', label: 'Sangria (sai)' },
            { value: 'suprimento', label: 'Suprimento (entra)' },
          ]}
        />
        <Field label="Valor" htmlFor={id}>
          <MoneyField id={id} cents={cents} min={1} allowEmpty onCommit={setCents} />
        </Field>
        <ReasonField
          value={reason}
          onChange={setReason}
          reasons={
            kind === 'sangria'
              ? ['Depósito no banco', 'Pagamento a fornecedor', 'Excesso na gaveta']
              : ['Mais troco', 'Troco do banco']
          }
        />
      </div>
    </Sheet>
  );
}

const COUNT_HINT: Record<PdvMethod, string> = {
  cash: 'Notas e moedas da gaveta, com o troco inicial.',
  pix: 'O que entrou no banco pelo Pix no balcão.',
  credit: 'O total de crédito no relatório da maquininha.',
  debit: 'O total de débito no relatório da maquininha.',
  voucher: 'O total de vale-refeição na maquininha.',
};

function CloseSheet({
  caixa,
  open,
  onOpenChange,
}: {
  caixa: CaixaDetail;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [counted, setCounted] = useState<Partial<ByMethod<number | null>>>({});
  const [notes, setNotes] = useState('');
  const notesId = useId();
  const baseId = useId();
  useEffect(() => {
    if (!open) return;
    setCounted({});
    setNotes('');
  }, [open]);
  const close = useMutation({
    mutationFn: () =>
      api.pdv.closeCaixa({
        counted: Object.fromEntries(
          PDV_METHODS.map((m) => [m, counted[m] ?? 0]),
        ) as ByMethod<number>,
        ...(notes.trim() ? { notes: notes.trim().slice(0, 500) } : {}),
      }),
    onSuccess: (r) => {
      haptic.commit();
      qc.setQueryData(qk.pdv.session(r.report.id), { report: r.report });
      putCaixa(qc, null);
      onOpenChange(false);
      nav(`/pdv/caixa/${r.report.id}`);
    },
    onError: (e) => toast.error(pdvError(e)),
  });
  // a method nothing came in by needs no count
  const used = PDV_METHODS.filter(
    (m) => m === 'cash' || (caixa.byMethod[m]?.count ?? 0) > 0 || (caixa.expected?.[m] ?? 0) > 0,
  );
  const ready = used.every((m) => counted[m] !== undefined && counted[m] !== null);
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Fechar o caixa"
      description={
        caixa.expected
          ? 'Conte cada forma e compare com o esperado.'
          : 'Conte cada forma. As diferenças aparecem no fechamento.'
      }
      footer={
        <HoldButton
          tone="primary"
          disabled={!ready || close.isPending}
          onConfirm={() => close.mutate()}
        >
          {ready ? 'segure para fechar o caixa' : 'conte cada forma para fechar'}
        </HoldButton>
      }
    >
      <div className="space-y-5 pb-2">
        {used.map((m) => {
          const Icon = PDV_METHOD_ICON[m];
          const exp = caixa.expected?.[m];
          return (
            <Field
              key={m}
              htmlFor={`${baseId}-${m}`}
              label={
                <span className="inline-flex items-center gap-1.5">
                  <Icon weight="duotone" className="size-5" aria-hidden />
                  {PDV_METHOD_LABEL[m]}
                </span>
              }
              helper={
                exp !== undefined ? (
                  <span className="tnum">
                    Esperado: <strong className="text-ink">{money(exp)}</strong>
                  </span>
                ) : (
                  COUNT_HINT[m]
                )
              }
            >
              <MoneyField
                id={`${baseId}-${m}`}
                cents={counted[m] ?? null}
                allowEmpty
                onCommit={(v) => setCounted((c) => ({ ...c, [m]: v }))}
              />
            </Field>
          );
        })}
        <Field label="Observação" htmlFor={notesId} optional>
          <TextArea
            id={notesId}
            maxLength={500}
            value={notes}
            className="min-h-20"
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
      </div>
    </Sheet>
  );
}

/** A closing's difference in a word: conferido, faltou, sobrou. */
export function Difference({ cents, className }: { cents: number; className?: string }) {
  return (
    <span
      className={cn(
        't-caption tnum inline-flex h-7 shrink-0 items-center whitespace-nowrap rounded-full px-2.5 font-semibold',
        cents === 0
          ? 'bg-success-soft text-success'
          : cents < 0
            ? 'bg-danger-soft text-danger'
            : 'bg-warning-soft text-warning',
        className,
      )}
    >
      {cents === 0 ? 'conferido' : cents < 0 ? `faltou ${money(-cents)}` : `sobrou ${money(cents)}`}
    </span>
  );
}

function History() {
  const q = useQuery({ queryKey: qk.pdv.history, queryFn: api.pdv.history });
  const rows = q.data?.sessions ?? [];
  return (
    <section aria-labelledby="hist-t" className="mt-8">
      <h2 id="hist-t" className="t-title-2 mb-3 px-1">
        Caixas fechados
      </h2>
      {q.isPending ? (
        <RowsSkeleton rows={3} avatar={false} />
      ) : q.error ? (
        <ErrorState error={q.error} retry={() => void q.refetch()} />
      ) : rows.length === 0 ? (
        <Card className="p-5">
          <p className="t-body text-muted">Os fechamentos aparecem aqui, com o que foi contado.</p>
        </Card>
      ) : (
        <Card as="section" className="divide-y divide-line overflow-hidden">
          {rows.map((r) => (
            <HistoryRow key={r.id} r={r} />
          ))}
        </Card>
      )}
    </section>
  );
}

function HistoryRow({ r }: { r: CaixaHistoryRow }) {
  return (
    <Link
      to={`/pdv/caixa/${r.id}`}
      className="press-row flex min-h-18 items-center gap-3 px-4 py-3 hover:bg-hover"
    >
      <div className="min-w-0 flex-1">
        <p className="font-semibold">
          {dateShort(r.closedAt)} · {clock(r.openedAt)}–{clock(r.closedAt)}
        </p>
        <p className="t-caption truncate text-muted">
          {r.openedBy === r.closedBy ? r.openedBy : `${r.openedBy} abriu, ${r.closedBy} fechou`}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="tnum font-semibold">{money(r.totalCents)}</span>
        <Difference cents={r.differenceCents} />
      </div>
      <CaretRight className="size-5 shrink-0 text-faint" aria-hidden />
    </Link>
  );
}
