import {
  CaretDown,
  ChatCircleDots,
  Check,
  CheckCircle,
  PaintBrush,
  PencilSimpleLine,
} from '@phosphor-icons/react';
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePreload } from '../../app/routes.ts';
import {
  api,
  type Account as AccountData,
  type DesignSpec,
  type SiteRequest as SiteReq,
} from '../../lib/api.ts';
import { dateShort, until } from '../../lib/format.ts';
import { Button } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { cn } from '../../ui/cn.ts';
import { Field, TextArea } from '../../ui/fields.tsx';
import { Mascote } from '../../ui/Mascote.tsx';
import { toast } from '../../ui/Toast.tsx';
import { Chip, hostOf, useAccountWrite } from '../account/domain/kit.tsx';

// Loja › Site e endereço: the site sob medida (ADR 0039), the owner's from the plan.

// The owner's way in is a conversation: Duá writes the brief with them and proposes it as a card,
// and confirming that card is the only approval they give (Core: site.build / site.revise).
const SITE_PROMPT = {
  build: 'Quero montar meu site sob medida.',
  revise: 'Quero pedir o ajuste do meu site.',
};

function useAskDua() {
  const nav = useNavigate();
  const preload = usePreload();
  return {
    go: (prompt: string) => nav('/copiloto', { state: { from: '/loja/site', prompt } }),
    preload: preload('/copiloto'),
  };
}

export function SiteRequest({ a }: { a: AccountData }) {
  const r = a.siteRequest;
  // a plan with the site but not the Copilot (older plans) sends the brief to the team as before
  const viaDua = a.plan.features.copilot;
  if (r?.status === 'in_progress') return <SiteBuilding r={r} />;
  if (r?.status === 'delivered') return <SiteDelivered r={r} viaDua={viaDua} />;
  return <SiteStart r={r} viaDua={viaDua} />;
}

/** Before the build: what happens, and the conversation with Duá that starts it. */
function SiteStart({ r, viaDua }: { r: SiteReq | null; viaDua: boolean }) {
  const dua = useAskDua();
  // a request is open (Core opens one with the plan): Duá's card needs it, so the ideas are optional
  const open = r?.status === 'requested';
  const [writing, setWriting] = useState(false);
  const [brief, setBrief] = useState(r?.brief ?? '');
  useEffect(() => setBrief(r?.brief ?? ''), [r?.brief]);
  const saved = r?.brief?.trim() ?? '';
  const ask = useAccountWrite(
    (b: string) => (open ? api.updateSiteRequest(b) : api.requestSite(b)),
    () => {
      setWriting(false);
      toast(viaDua ? 'Ideias guardadas ✓ O Duá vai ler.' : 'Pedido enviado ✓');
    },
  );
  // no open request (none yet, or the last one was cancelled): the ideas open it, then Duá
  const start = useAccountWrite(
    (b: string) => api.requestSite(b),
    () => dua.go(SITE_PROMPT.build),
  );

  if (!viaDua)
    return (
      <Card className="space-y-4 p-5">
        {r?.status === 'cancelled' ? <Cancelled /> : null}
        {open && saved && !writing ? (
          <SavedIdeas text={saved} title="O que você pediu" onEdit={() => setWriting(true)} />
        ) : (
          <BriefForm
            value={brief}
            onChange={setBrief}
            busy={ask.isPending}
            label={open ? 'salvar pedido' : 'pedir meu site'}
            onSend={(b) => ask.mutate(b)}
            onCancel={open && saved ? () => setWriting(false) : undefined}
          />
        )}
      </Card>
    );

  return (
    <Card className="overflow-hidden">
      <div className="space-y-5 p-5">
        {r?.status === 'cancelled' ? <Cancelled /> : null}
        <div className="flex items-center gap-4">
          <span className="dua-disc grid size-16 shrink-0 place-items-center overflow-hidden bg-spark-soft">
            <Mascote pose="avatar-ola" size={64} />
          </span>
          <p className="t-title-2 min-w-0">Começa numa conversa com o Duá</p>
        </div>
        <ol className="grid gap-3 md:grid-cols-3 md:gap-4" aria-label="como funciona">
          {[
            ['O Duá monta o briefing com você', 'cores, fotos, o jeito da loja'],
            ['Você aprova o cartão dele', 'é a sua única aprovação'],
            ['O site fica pronto em 1 dia', 'fim de semana também'],
          ].map(([t, sub], i) => (
            <li key={t} className="flex min-w-0 items-start gap-3">
              <span
                aria-hidden
                className="tnum t-label grid size-7 shrink-0 place-items-center rounded-full bg-sunken text-ink"
              >
                {i + 1}
              </span>
              <span className="min-w-0 pt-0.5">
                <span className="block font-semibold leading-6">{t}</span>
                <span className="t-caption block text-muted">{sub}</span>
              </span>
            </li>
          ))}
        </ol>
        {open ? (
          <Button
            size="lg"
            icon={<ChatCircleDots weight="bold" />}
            className="max-sm:w-full"
            onClick={() => dua.go(SITE_PROMPT.build)}
            {...dua.preload}
          >
            Montar meu site com o Duá
          </Button>
        ) : null}
      </div>
      {open ? (
        <div className="border-t border-line px-5 py-4">
          {writing ? (
            <BriefForm
              value={brief}
              onChange={setBrief}
              busy={ask.isPending}
              label="guardar ideias"
              title="Suas ideias para o site"
              autoFocus
              onSend={(b) => ask.mutate(b)}
              onCancel={() => {
                setWriting(false);
                setBrief(r?.brief ?? '');
              }}
            />
          ) : saved ? (
            <SavedIdeas text={saved} title="Suas ideias" onEdit={() => setWriting(true)} />
          ) : (
            <button
              type="button"
              onClick={() => setWriting(true)}
              className="press-row -mx-2 flex min-h-12 w-[calc(100%+1rem)] items-center gap-3 rounded-md px-2 text-left"
            >
              <PencilSimpleLine weight="bold" className="size-5 shrink-0 text-muted" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">Já tem ideias? Escreva aqui</span>
                <span className="t-caption block text-muted">
                  Opcional. O Duá lê antes de conversar com você.
                </span>
              </span>
            </button>
          )}
        </div>
      ) : (
        <div className="border-t border-line px-5 py-4">
          <BriefForm
            value={brief}
            onChange={setBrief}
            busy={start.isPending}
            label="Montar meu site com o Duá"
            title="Para começar, conte como você imagina o site"
            onSend={(b) => start.mutate(b)}
          />
        </div>
      )}
    </Card>
  );
}

function Cancelled() {
  return (
    <p className="t-body rounded-md bg-sunken p-3 text-muted">
      O pedido anterior foi cancelado. Quando quiser, é só pedir de novo.
    </p>
  );
}

function SavedIdeas({ text, title, onEdit }: { text: string; title: string; onEdit: () => void }) {
  return (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <p className="t-caption text-muted">{title}</p>
        <p className="t-body mt-1 line-clamp-4 whitespace-pre-line break-words">{text}</p>
      </div>
      <Button variant="ghost" size="sm" className="-mr-2 shrink-0" onClick={onEdit}>
        editar
      </Button>
    </div>
  );
}

function BriefForm({
  value,
  onChange,
  onSend,
  onCancel,
  busy,
  label,
  title = 'Como você imagina o site?',
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: (b: string) => void;
  onCancel?: (() => void) | undefined;
  busy: boolean;
  label: string;
  title?: string;
  /** opened by a tap: the cursor goes in */
  autoFocus?: boolean;
}) {
  const ok = value.trim().length >= 10;
  return (
    <form
      noValidate
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) onSend(value.trim());
      }}
    >
      <Field
        label={title}
        htmlFor="site-brief"
        helper="Cores, fotos, o que não pode faltar, sites de que você gosta."
      >
        <TextArea
          id="site-brief"
          maxLength={2000}
          rows={4}
          autoFocus={autoFocus}
          placeholder="Ex.: cores da logo (vinho e creme), fotos grandes dos bolos, uma parte contando a história da confeitaria…"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={busy} disabled={!ok} className="max-sm:flex-1">
          {label}
        </Button>
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel}>
            cancelar
          </Button>
        ) : null}
      </div>
    </form>
  );
}

const STAGES = [
  { id: 'fila', label: 'Na fila', now: 'Entrou na fila de produção.' },
  { id: 'construindo', label: 'Construindo', now: 'Sendo feito a partir do seu briefing.' },
  {
    id: 'revisao',
    label: 'Revisão final da equipe',
    now: 'A equipe da Venduá confere tudo antes de publicar.',
  },
  {
    id: 'publicando',
    label: 'Publicando',
    now: 'Falta pouco: o visual novo está entrando na loja.',
  },
] as const;

/** Approved and being built (or the adjustment): where it stands and when it's ready. */
function SiteBuilding({ r }: { r: SiteReq }) {
  const b = r.building;
  const revision = b?.kind === 'revision';
  const late = !!r.dueAt && new Date(r.dueAt).getTime() < Date.now();
  return (
    <Card className="space-y-6 p-5">
      <div className="flex items-start gap-4">
        <span className="dua-disc grid size-16 shrink-0 place-items-center overflow-hidden bg-spark-soft">
          <Mascote pose="avatar-pensando" size={64} />
        </span>
        <div className="min-w-0 pt-0.5">
          <p className="t-caption font-semibold text-muted">
            {revision ? 'Ajuste em produção' : 'Em produção'}
          </p>
          <p className="t-title-2 mt-0.5">
            {!r.dueAt
              ? revision
                ? 'O ajuste está sendo feito'
                : 'O seu site está sendo feito'
              : late
                ? 'Está levando um pouco mais'
                : `Fica pronto até ${until(r.dueAt)}`}
          </p>
          <p className="t-body mt-1 text-muted">
            {late
              ? 'Passou do prazo combinado, e a equipe da Venduá já foi avisada.'
              : revision
                ? 'É o ajuste incluído no seu site, e você já aprovou: não precisa aprovar mais nada.'
                : 'Você já aprovou o briefing, não precisa aprovar mais nada.'}{' '}
            Quando ficar pronto, o visual novo entra sozinho na sua loja.
          </p>
        </div>
      </div>
      <div className="grid gap-6 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] md:gap-8">
        {b ? <Stages stage={b.stage} revision={revision} /> : null}
        {r.spec ? (
          <div className={cn('min-w-0', !b && 'md:col-span-2')}>
            <p className="t-caption font-semibold text-muted">
              {revision ? 'O briefing, já com o ajuste' : 'O briefing que você aprovou'}
            </p>
            <SpecSummary spec={r.spec} className="mt-2" />
          </div>
        ) : r.brief ? (
          <div className={cn('min-w-0 rounded-md bg-sunken p-4', !b && 'md:col-span-2')}>
            <p className="t-caption text-muted">O que você pediu</p>
            <p className="t-body mt-1 whitespace-pre-line break-words">{r.brief}</p>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function Stages({
  stage,
  revision,
}: {
  stage: NonNullable<SiteReq['building']>['stage'];
  revision: boolean;
}) {
  const at = Math.max(
    0,
    STAGES.findIndex((s) => s.id === stage),
  );
  return (
    <ol aria-label={revision ? 'andamento do ajuste' : 'andamento do site'}>
      {STAGES.map((s, i) => {
        const done = i < at;
        const now = i === at;
        return (
          <li
            key={s.id}
            className="relative flex gap-3 pb-5 last:pb-0"
            aria-current={now ? 'step' : undefined}
          >
            {i < STAGES.length - 1 ? (
              <span
                aria-hidden
                className={cn(
                  'absolute bottom-0 left-[11px] top-7 w-0.5 rounded-full',
                  done ? 'bg-success' : 'bg-line-strong',
                )}
              />
            ) : null}
            <span
              aria-hidden
              className={cn(
                'relative mt-0.5 grid size-6 shrink-0 place-items-center rounded-full',
                done
                  ? 'bg-success text-surface'
                  : now
                    ? 'bg-spark-soft ring-2 ring-inset ring-[var(--chart)]'
                    : 'bg-surface ring-2 ring-inset ring-line-strong',
              )}
            >
              {done ? (
                <Check weight="bold" className="size-3.5" />
              ) : now ? (
                <span className="animate-pulse-dot size-2.5 rounded-full bg-[var(--chart)]" />
              ) : null}
            </span>
            <span className="min-w-0">
              <span
                className={cn('block leading-7', now ? 'font-semibold' : done ? '' : 'text-muted')}
              >
                {s.label}
                {done ? <span className="sr-only"> (feito)</span> : null}
                {now ? <span className="sr-only"> (agora)</span> : null}
              </span>
              {now ? <span className="t-caption block text-muted">{s.now}</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Delivered: when, and the one adjustment the plan includes (asked through Duá, too). */
function SiteDelivered({ r, viaDua }: { r: SiteReq; viaDua: boolean }) {
  const dua = useAskDua();
  const used = r.revisionsUsed >= r.revisionsIncluded;
  return (
    <Card className="overflow-hidden">
      <div className="flex items-start gap-4 p-5">
        <span className="dua-disc grid size-16 shrink-0 place-items-center overflow-hidden bg-spark-soft">
          <Mascote pose="avatar-feliz" size={64} />
        </span>
        <div className="min-w-0 pt-0.5">
          <p className="t-caption font-semibold text-success">
            <CheckCircle weight="fill" className="-mt-0.5 mr-1 inline size-4" aria-hidden />
            Site no ar
          </p>
          <p className="t-title-2 mt-0.5">Entregue em {dateShort(r.deliveredAt ?? r.updatedAt)}</p>
          <p className="t-body mt-1 text-muted">O visual novo já está na sua loja.</p>
        </div>
      </div>
      {viaDua ? (
        <div className="flex flex-col gap-3 border-t border-line px-5 py-4 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <Chip tone={used ? 'neutral' : 'success'} icon={used ? CheckCircle : PaintBrush}>
              {used ? 'Ajuste já usado' : '1 ajuste incluído'}
            </Chip>
            <p className="t-body mt-2 text-muted">
              {used
                ? 'O ajuste incluído já foi feito neste site.'
                : 'Quer mudar alguma coisa? Conte ao Duá o que ajustar. O ajuste também fica pronto em 1 dia.'}
            </p>
          </div>
          {used ? null : (
            <Button
              icon={<ChatCircleDots weight="bold" />}
              className="shrink-0 max-sm:w-full"
              onClick={() => dua.go(SITE_PROMPT.revise)}
              {...dua.preload}
            >
              Pedir um ajuste ao Duá
            </Button>
          )}
        </div>
      ) : null}
      {r.spec ? (
        <details className="group border-t border-line">
          <summary className="press-row flex min-h-14 cursor-pointer list-none items-center gap-2 px-5 font-semibold [&::-webkit-details-marker]:hidden">
            <span className="min-w-0 flex-1">Ver o briefing aprovado</span>
            <CaretDown
              weight="bold"
              className="size-4 shrink-0 text-muted transition-transform group-open:rotate-180"
              aria-hidden
            />
          </summary>
          <div className="px-5 pb-5">
            <SpecSummary spec={r.spec} />
          </div>
        </details>
      ) : null}
    </Card>
  );
}

const MOTION_LABEL = { none: 'Nenhum', subtle: 'Discreto', expressive: 'Marcante' } as const;

/** The DesignSpec as the owner said it: words, colours as colours, lists as lists. */
function SpecSummary({ spec, className }: { spec: DesignSpec; className?: string }) {
  const colors = [spec.brand.palette.primary, ...spec.brand.palette.accents].filter(
    (c): c is string => !!c && /^#[0-9a-f]{6}$/i.test(c),
  );
  const list = (xs: string[]) =>
    xs.length === 1 ? (
      xs[0]
    ) : (
      <ul className="list-disc space-y-0.5 pl-5 marker:text-faint">
        {xs.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    );
  const rows: [string, ReactNode][] = [];
  if (spec.brand.personality.length)
    rows.push([
      'Jeito',
      <span className="flex flex-wrap gap-1.5">
        {spec.brand.personality.map((p) => (
          <span
            key={p}
            className="t-caption rounded-full bg-surface px-2.5 py-1 font-semibold ring-1 ring-inset ring-line noite:bg-raised"
          >
            {p}
          </span>
        ))}
      </span>,
    ]);
  if (colors.length || spec.brand.palette.notes)
    rows.push([
      'Cores',
      <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {colors.length ? (
          <span className="flex gap-1.5">
            {colors.map((c) => (
              <span
                key={c}
                role="img"
                aria-label={`cor ${c}`}
                title={c}
                className="size-7 rounded-full ring-1 ring-inset ring-line-strong"
                style={{ background: c }}
              />
            ))}
          </span>
        ) : null}
        {spec.brand.palette.notes ? (
          <span className="min-w-0">{spec.brand.palette.notes}</span>
        ) : null}
      </span>,
    ]);
  if (spec.brand.typography) rows.push(['Letras', spec.brand.typography]);
  rows.push(['Movimento', MOTION_LABEL[spec.experience.motion] ?? spec.experience.motion]);
  if (spec.copy.tone) rows.push(['Tom', spec.copy.tone]);
  if (spec.experience.mustHave.length)
    rows.push(['Não pode faltar', list(spec.experience.mustHave)]);
  if (spec.experience.differentials.length)
    rows.push(['Diferenciais', list(spec.experience.differentials)]);
  if (spec.experience.avoid.length) rows.push(['Evitar', list(spec.experience.avoid)]);
  if (spec.brand.references.length)
    rows.push([
      'Referências',
      <ul className="space-y-0.5">
        {spec.brand.references.map((ref) => (
          <li key={ref.url}>
            <a
              href={ref.url}
              target="_blank"
              rel="noreferrer noopener"
              className="font-semibold underline underline-offset-2"
            >
              {hostOf(ref.url)}
            </a>
            {ref.note ? <span className="text-muted"> · {ref.note}</span> : null}
          </li>
        ))}
      </ul>,
    ]);
  return (
    <div className={cn('rounded-md bg-sunken p-4', className)}>
      {spec.summary ? <p className="t-body-lg break-words font-medium">“{spec.summary}”</p> : null}
      <dl className="mt-3 divide-y divide-line [overflow-wrap:anywhere]">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="grid gap-0.5 py-2.5 sm:grid-cols-[8.5rem_minmax(0,1fr)] sm:gap-4"
          >
            <dt className="t-caption pt-0.5 text-muted">{label}</dt>
            <dd className="t-body min-w-0">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
