import { CaretDown, WarningCircle } from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type OrderMode, type ProductDetail, type ProductFicha } from '../../../lib/api.ts';
import { money } from '../../../lib/format.ts';
import { haptic } from '../../../lib/haptics.ts';
import { qk, useMutation } from '../../../lib/query.ts';
import { Button } from '../../../ui/Button.tsx';
import { cn } from '../../../ui/cn.ts';
import { messageOf } from '../../../ui/feedback.tsx';
import { Toggle } from '../../../ui/fields.tsx';
import { RowsSkeleton } from '../../../ui/skeletons.tsx';
import { toast } from '../../../ui/Toast.tsx';
import { draftOf, draftsCost, FichaEditor, linesOf, type Draft } from './FichaEditor.tsx';
import { MODE_LABEL } from './units.ts';

// A product's ficha técnica on its page: what one unit uses (packaging per kind of order) and
// what each option adds. One save sends the product's lines and the options that changed.

const MODES: OrderMode[] = ['delivery', 'pickup', 'dine_in'];

type OptDraft = { drafts: Draft[]; sameName: boolean; dirty: boolean };

export function FichaSection({ p }: { p: ProductDetail }) {
  const qc = useQueryClient();
  const ficha = useQuery({ queryKey: qk.ficha(p.id), queryFn: () => api.productFicha(p.id) });
  const list = useQuery({ queryKey: qk.insumos, queryFn: api.insumos });
  const f = ficha.data?.ficha;
  const insumos = useMemo(() => list.data?.insumos ?? [], [list.data]);

  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [dirty, setDirty] = useState(false);
  const [opts, setOpts] = useState<Record<string, OptDraft>>({});
  const [openOpt, setOpenOpt] = useState<string | null>(null);
  const [bad, setBad] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Core's ficha fills the editor until something is typed: a refetch never wipes a draft
  useEffect(() => {
    if (!f || !list.data || dirty) return;
    setDrafts(f.lines.map((l) => draftOf(l, list.data.insumos)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f, list.data]);
  const optOf = (o: ProductFicha['options'][number]): OptDraft =>
    opts[o.id] ?? {
      drafts: o.lines.map((l) => draftOf(l, insumos)),
      sameName: false,
      dirty: false,
    };
  const anyDirty = dirty || Object.values(opts).some((o) => o.dirty);

  const save = useMutation({
    mutationFn: () => {
      const body: Parameters<typeof api.setProductFicha>[1] = {};
      if (dirty) {
        const l = linesOf(drafts);
        if ('bad' in l) {
          setBad(l.bad);
          throw new Error('Digite quanto vai de cada insumo.');
        }
        body.lines = l.lines;
      }
      const changed = Object.entries(opts).filter(([, o]) => o.dirty);
      if (changed.length)
        body.options = changed.map(([id, o]) => {
          const l = linesOf(o.drafts);
          if ('bad' in l) {
            setBad(l.bad);
            setOpenOpt(id);
            throw new Error('Digite quanto vai de cada insumo nas opções.');
          }
          return { id, lines: l.lines, ...(o.sameName ? { sameName: true } : {}) };
        });
      return api.setProductFicha(p.id, body);
    },
    onSuccess: (r) => {
      haptic.commit();
      qc.setQueryData(qk.ficha(p.id), r);
      setDirty(false);
      setOpts({});
      setDrafts(r.ficha.lines.map((l) => draftOf(l, insumos)));
      // the product's cost and margin, the catalog's and every insumo's uses move with it
      void qc.invalidateQueries({ queryKey: ['catalog'] });
      toast('Ficha técnica salva');
    },
    onError: (e) => setErr(messageOf(e)),
  });

  if (ficha.isPending || list.isPending) return <RowsSkeleton rows={3} avatar={false} />;
  if (!f)
    return (
      <p className="t-body text-muted">
        Não deu para abrir a ficha.{' '}
        <button
          type="button"
          className="font-semibold text-primary"
          onClick={() => void ficha.refetch()}
        >
          tentar de novo
        </button>
      </p>
    );

  // the preview while editing; Core's own figure once saved
  const byMode = Object.fromEntries(
    MODES.map((m) => [m, dirty ? draftsCost(drafts, insumos, m) : (f.cost?.byMode[m] ?? 0)]),
  ) as Record<OrderMode, number>;
  const differs = new Set(MODES.map((m) => byMode[m])).size > 1;
  const groups = [...new Set(f.options.map((o) => o.groupName))];
  const others = p.pricing?.lines.length ? p.pricing.lines : null;

  return (
    <div className="space-y-5">
      <p className="t-body text-muted">
        O que vai em uma unidade. Cada venda desconta esses insumos do estoque, e o custo entra na
        margem e no CMV dos relatórios.
      </p>
      <FichaEditor
        drafts={drafts}
        onChange={(d) => {
          setDrafts(d);
          setDirty(true);
          setBad(null);
          setErr(null);
        }}
        insumos={insumos}
        modes
        bad={bad}
        empty="Nenhum insumo ainda. Adicione o pão, a carne, a caixa: o que vai em um."
      />

      {drafts.length ? (
        <div className="rounded-md bg-sunken px-4 py-3">
          {differs ? (
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {MODES.map((m) => (
                <p key={m} className="t-caption text-muted">
                  {MODE_LABEL[m]}{' '}
                  <span className="tnum font-bold text-ink">{money(byMode[m])}</span>
                </p>
              ))}
            </div>
          ) : (
            <p className="flex items-baseline justify-between gap-2">
              <span className="t-caption text-muted">Custa para fazer</span>
              <span className="tnum font-bold">{money(byMode.delivery)}</span>
            </p>
          )}
          {p.priceCents > 0 ? (
            <p className="t-caption mt-1 text-muted">
              No preço de {money(p.priceCents)}, a ficha é{' '}
              <span className="tnum font-semibold text-ink">
                {Math.round((Math.max(...MODES.map((m) => byMode[m])) * 100) / p.priceCents)}%
              </span>{' '}
              do preço{differs ? ', no pedido que mais gasta' : ''}.
            </p>
          ) : null}
        </div>
      ) : null}

      {f.missingCost.length ? (
        <p className="t-caption flex items-start gap-1.5 text-warning">
          <WarningCircle weight="fill" className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Sem custo: {f.missingCost.join(', ')}. Entram como R$ 0 até você pôr o custo em{' '}
            <Link to="/cardapio/insumos" className="font-semibold underline underline-offset-4">
              Insumos
            </Link>
            .
          </span>
        </p>
      ) : null}
      {others && drafts.length ? (
        <p className="t-caption text-muted">
          O cálculo de preço ainda soma {others.map((l) => l.label).join(', ')} como outros custos.
          Tire de lá o que a ficha já conta.
        </p>
      ) : null}
      {f.kind === 'combo' ? (
        <p className="t-caption text-muted">
          Num kit, cada item escolhido soma a ficha dele. Aqui vai só o que é do kit, como a caixa.
        </p>
      ) : null}

      {f.options.length ? (
        <section aria-label="opções" className="space-y-2">
          <p className="t-label">Opções</p>
          <p className="t-caption text-muted">
            O que cada opção acrescenta quando o cliente escolhe. Um tamanho pode levar tudo, com a
            ficha do produto vazia.
          </p>
          {groups.map((g) => (
            <div key={g} className="overflow-hidden rounded-md ring-1 ring-line">
              <p className="t-caption bg-sunken px-3 py-1.5 font-semibold text-muted">{g}</p>
              <ul className="divide-y divide-line">
                {f.options
                  .filter((o) => o.groupName === g)
                  .map((o) => {
                    const d = optOf(o);
                    const open = openOpt === o.id;
                    const cost = d.dirty ? draftsCost(d.drafts, insumos) : o.costCents;
                    return (
                      <li key={o.id}>
                        <button
                          type="button"
                          aria-expanded={open}
                          onClick={() => setOpenOpt(open ? null : o.id)}
                          className="press-row flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left hover:bg-hover"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-semibold">{o.name}</span>
                            <span className="t-caption block text-muted">
                              {o.priceDeltaCents ? `+${money(o.priceDeltaCents)} · ` : ''}
                              {cost != null && (d.dirty ? d.drafts.length : o.lines.length) ? (
                                <>
                                  custa{' '}
                                  <span className="tnum font-semibold text-ink">{money(cost)}</span>
                                </>
                              ) : (
                                'sem ficha'
                              )}
                              {d.dirty ? (
                                <span className="font-semibold text-primary"> · alterada</span>
                              ) : null}
                            </span>
                          </span>
                          <CaretDown
                            className={cn(
                              'size-5 shrink-0 text-muted transition-transform',
                              open && 'rotate-180',
                            )}
                            aria-hidden
                          />
                        </button>
                        {open ? (
                          <div className="space-y-3 border-t border-line px-3 pb-3 pt-3">
                            <FichaEditor
                              drafts={d.drafts}
                              onChange={(x) => {
                                setOpts((s) => ({
                                  ...s,
                                  [o.id]: { ...d, drafts: x, dirty: true },
                                }));
                                setBad(null);
                                setErr(null);
                              }}
                              insumos={insumos}
                              modes
                              bad={bad}
                              empty="Nada a mais com esta opção."
                            />
                            {o.sameName > 1 ? (
                              <Toggle
                                checked={d.sameName}
                                onChange={(v) =>
                                  setOpts((s) => ({
                                    ...s,
                                    [o.id]: { ...d, sameName: v, dirty: true },
                                  }))
                                }
                                label={`Usar em todas as opções “${o.name}”`}
                                description={`São ${o.sameName} no cardápio, em outros produtos também.`}
                              />
                            ) : null}
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
              </ul>
            </div>
          ))}
        </section>
      ) : null}

      {err ? (
        <p className="t-caption text-danger" role="alert">
          {err}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button loading={save.isPending} disabled={!anyDirty} onClick={() => save.mutate()}>
          salvar ficha
        </Button>
        <Link to="/cardapio/insumos" className="t-label text-primary">
          ver insumos
        </Link>
      </div>
    </div>
  );
}

/** the Disclosure's summary: what the ficha costs, or how to start one */
export function fichaSummary(p: ProductDetail) {
  return p.fichaCostCents != null
    ? `Custa ${money(p.fichaCostCents)} para fazer`
    : 'Sem ficha: diga o que vai e quanto, e o estoque desconta sozinho';
}
