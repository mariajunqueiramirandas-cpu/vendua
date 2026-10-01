import {
  ArrowRight,
  CheckCircle,
  Clock,
  CreditCard,
  EyeSlash,
  ForkKnife,
  Images,
  LinkSimple,
  MinusCircle,
  Storefront,
} from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  api,
  ApiError,
  type ImportSection,
  type MenuImport,
  type ImportPreviewProduct,
} from '../../lib/api.ts';
import { money, num, phone as fmtPhone } from '../../lib/format.ts';
import { qk, useMutation } from '../../lib/query.ts';
import { Button } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { cn } from '../../ui/cn.ts';
import { Disclosure } from '../../ui/Disclosure.tsx';
import { messageOf } from '../../ui/feedback.tsx';
import { Field, Segmented, TextInput, Toggle } from '../../ui/fields.tsx';
import { NoPhoto } from '../../ui/illustrations.tsx';
import { Mascote } from '../../ui/Mascote.tsx';
import { Notice } from '../../ui/Notice.tsx';
import { availability } from '../../ui/ProductTile.tsx';
import { METHOD_LABEL } from '../../ui/PaymentChip.tsx';
import { Spinner } from '../../ui/Spinner.tsx';
import {
  hidesProduct,
  lostLine,
  platformName,
  readError,
  readableNames,
  startError,
} from './copy.ts';

// "Cole o link do seu cardápio" (docs/menu-import.md §2): paste → Core reads the old store in
// the background → the merchant sees what came and what didn't → one tap applies it, and the
// photos move over after. Used by the onboarding step and by Cardápio › Importar.

export type ImportWhere = 'onboarding' | 'catalog';

const SECTION_LABEL: Record<ImportSection, string> = {
  profile: 'Perfil e visual',
  hours: 'Horários',
  delivery: 'Entrega e retirada',
  payments: 'Pagamentos',
};

const DAY_MS = 24 * 60 * 60_000;

export function ImportFlow({
  where,
  owner,
  hasProducts,
  onApplied,
  onSkip,
  intro,
}: {
  where: ImportWhere;
  owner: boolean;
  /** Cardápio: the store already sells something, so "somar ou trocar" is a real choice */
  hasProducts: boolean;
  /** after "Importar" and the merchant's "continuar" */
  onApplied: (imp: MenuImport) => void;
  /** "Começar do zero" (onboarding) */
  onSkip?: () => void;
  /** title block above the paste field */
  intro?: ReactNode;
}) {
  const qc = useQueryClient();
  const [id, setId] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);

  // pick up where the merchant left: an import still being read, or a preview not applied yet
  const recent = useQuery({ queryKey: qk.imports, queryFn: api.imports, staleTime: 0 });
  const [resumed, setResumed] = useState(false);
  useEffect(() => {
    if (resumed || !recent.data) return;
    setResumed(true);
    const open = recent.data.imports.find(
      (i) =>
        (i.status === 'reading' || i.status === 'ready') &&
        Date.now() - Date.parse(i.createdAt) < DAY_MS,
    );
    if (open && !id) setId(open.id);
  }, [recent.data, resumed, id]);

  const imp = useQuery({
    queryKey: qk.importOf(id ?? ''),
    queryFn: () => api.importOf(id!),
    enabled: !!id,
    // the live stream pushes each change; polling covers a stream that's down
    refetchInterval: (q) => {
      const d = q.state.data;
      if (!d) return false;
      if (d.status === 'reading') return 1500;
      if (d.status === 'applied' && !d.images.finished) return 2500;
      return false;
    },
  });

  const start = useMutation({
    mutationFn: (link: string) => api.startImport(link),
    onMutate: () => setError(null),
    onSuccess: (r) => {
      setId(r.id);
      void qc.invalidateQueries({ queryKey: qk.imports });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'IMPORT_IN_PROGRESS' && e.details?.id) {
        setId(String(e.details.id));
        return;
      }
      const platform =
        e instanceof ApiError && typeof e.details?.platform === 'string'
          ? e.details.platform
          : null;
      setError(
        e instanceof ApiError ? (startError(e.code, platform) ?? messageOf(e)) : messageOf(e),
      );
    },
  });

  const discard = useMutation({
    mutationFn: (importId: string) => api.discardImport(importId),
    onSettled: () => {
      setId(null);
      void qc.invalidateQueries({ queryKey: qk.imports });
    },
  });

  const reset = () => {
    setId(null);
    setError(null);
  };

  const d = imp.data;
  if (id && !d)
    return imp.error ? (
      <Notice tone="danger" title="Não conseguimos abrir essa importação">
        {messageOf(imp.error)}
        <div className="mt-3">
          <Button variant="secondary" onClick={reset}>
            colar outro link
          </Button>
        </div>
      </Notice>
    ) : (
      <Reading platform={null} />
    );

  if (!d)
    return (
      <Paste
        intro={intro}
        url={url}
        setUrl={setUrl}
        error={error}
        busy={start.isPending}
        onSubmit={() => start.mutate(url.trim())}
        onSkip={onSkip}
      />
    );

  if (d.status === 'reading')
    return (
      <Reading
        platform={d.platform}
        onCancel={() => discard.mutate(d.id)}
        cancelling={discard.isPending}
      />
    );

  if (d.status === 'failed' || d.status === 'expired')
    return (
      <div className="animate-fade-up space-y-5">
        <Notice
          tone={d.status === 'failed' ? 'danger' : 'warning'}
          title={d.status === 'failed' ? 'Não deu para ler a loja' : 'Essa prévia venceu'}
          role="alert"
        >
          {d.status === 'failed'
            ? readError(d)
            : 'Faz mais de um dia que lemos a loja, e os preços podem ter mudado. Leia de novo.'}
        </Notice>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button
            size="lg"
            loading={start.isPending}
            onClick={() => {
              setId(null);
              start.mutate(d.sourceUrl);
            }}
          >
            ler de novo
          </Button>
          <Button variant="secondary" size="lg" onClick={reset}>
            colar outro link
          </Button>
          {onSkip ? (
            <Button variant="quiet" size="lg" onClick={onSkip}>
              começar do zero
            </Button>
          ) : null}
        </div>
        {error ? <p className="t-body text-danger">{error}</p> : null}
      </div>
    );

  if (d.status === 'applied' || d.status === 'applying')
    return <Done imp={d} where={where} onContinue={() => onApplied(d)} />;

  return (
    <Preview
      imp={d}
      where={where}
      owner={owner}
      hasProducts={hasProducts}
      onApplied={(n) => {
        qc.setQueryData(qk.importOf(n.id), n);
        // everything the import wrote shows elsewhere too
        for (const key of [qk.catalog, qk.store, qk.payments, qk.home, qk.session, qk.appearance])
          void qc.invalidateQueries({ queryKey: key });
        void qc.invalidateQueries({ queryKey: qk.imports });
      }}
      onDiscard={() => discard.mutate(d.id)}
      discarding={discard.isPending}
    />
  );
}

// ── paste ────────────────────────────────────────────────────────────────────

function Paste({
  intro,
  url,
  setUrl,
  error,
  busy,
  onSubmit,
  onSkip,
}: {
  intro?: ReactNode;
  url: string;
  setUrl: (v: string) => void;
  error: string | null;
  busy: boolean;
  onSubmit: () => void;
  onSkip?: (() => void) | undefined;
}) {
  const ok = url.trim().length >= 4;
  return (
    <form
      className="animate-fade-up space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok && !busy) onSubmit();
      }}
    >
      {intro}
      <Field
        label="Link do seu cardápio"
        htmlFor="import-url"
        error={error}
        helper="Abra a sua loja no celular e copie o link da barra de endereço."
      >
        <TextInput
          id="import-url"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          maxLength={500}
          lead={<LinkSimple className="size-5" />}
          placeholder="Link da sua loja"
          value={url}
          aria-invalid={error ? true : undefined}
          onChange={(e) => setUrl(e.target.value)}
        />
      </Field>
      <ul className="t-body space-y-2 text-muted">
        {[
          'Produtos, preços, fotos e opções',
          'Horários, entrega, retirada e pedido mínimo',
          'Formas de pagamento e a chave Pix',
        ].map((t) => (
          <li key={t} className="flex items-start gap-2">
            <CheckCircle
              weight="fill"
              className="mt-0.5 size-5 shrink-0 text-success"
              aria-hidden
            />
            {t}
          </li>
        ))}
      </ul>
      <p className="t-caption text-muted">
        Lemos lojas do {readableNames()}. Nada muda na sua loja até você tocar em “Importar”.
      </p>
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
        {onSkip ? (
          <Button variant="quiet" size="lg" onClick={onSkip}>
            começar do zero
          </Button>
        ) : null}
        <div className="hidden flex-1 sm:block" />
        <Button type="submit" size="lg" loading={busy} disabled={!ok}>
          Ler meu cardápio <ArrowRight />
        </Button>
      </div>
    </form>
  );
}

// ── reading ──────────────────────────────────────────────────────────────────

function Reading({
  platform,
  onCancel,
  cancelling,
}: {
  platform: string | null;
  onCancel?: () => void;
  cancelling?: boolean;
}) {
  return (
    <Card className="animate-fade-up flex flex-col items-center gap-4 px-6 py-8 text-center">
      <Mascote pose="carregando" size={120} className="w-28" />
      <div role="status" aria-live="polite" className="space-y-1">
        <p className="t-title-2 inline-flex items-center gap-2">
          <Spinner className="size-5" />
          Lendo o cardápio{platform ? ` no ${platformName(platform)}` : ''}…
        </p>
        <p className="t-body text-muted">
          {platform === 'goomer'
            ? 'O Goomer mostra um produto de cada vez: pode levar alguns minutos.'
            : 'Leva alguns segundos.'}{' '}
          Pode deixar esta tela aberta: a prévia aparece aqui.
        </p>
      </div>
      {onCancel ? (
        <Button variant="ghost" loading={!!cancelling} onClick={onCancel}>
          cancelar
        </Button>
      ) : null}
    </Card>
  );
}

// ── preview ──────────────────────────────────────────────────────────────────

function available(imp: MenuImport): Record<ImportSection, boolean> {
  const p = imp.preview!;
  const s = p.store;
  return {
    profile: !!(
      s.name ||
      s.logoUrl ||
      s.coverUrl ||
      s.brandColor ||
      s.whatsapp ||
      s.instagram ||
      s.tagline ||
      s.address
    ),
    hours: p.hours.length > 0,
    delivery: Object.keys(p.operations).length > 0 || p.zones.length > 0,
    payments: !!p.payments && (p.payments.methods.length > 0 || !!p.payments.pix),
  };
}

function daysCovered(hours: { days: number[] }[]) {
  const n = new Set(hours.flatMap((h) => h.days)).size;
  return n === 7 ? 'todos os dias' : `${n} ${n === 1 ? 'dia' : 'dias'} por semana`;
}

function summaries(imp: MenuImport): Record<ImportSection, string> {
  const p = imp.preview!;
  const s = p.store;
  const o = p.operations;
  const pay = p.payments;
  const join = (xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(' · ');
  return {
    profile: join([
      s.name,
      s.logoUrl && 'logo',
      s.coverUrl && 'capa',
      s.brandColor && 'cor',
      s.whatsapp && `WhatsApp ${fmtPhone(s.whatsapp)}`,
      s.instagram,
      s.announcement && 'boas-vindas',
    ]),
    hours: p.hours.length
      ? `${daysCovered(p.hours)}, ${p.hours.length} ${p.hours.length === 1 ? 'horário' : 'horários'}`
      : 'não veio',
    delivery:
      join([
        o.pickup && 'retirada',
        o.delivery &&
          `entrega${p.zones.length ? ` em ${p.zones.length} ${p.zones.length === 1 ? 'região' : 'regiões'}` : ''}`,
        o.minOrderCents ? `mínimo ${money(o.minOrderCents)}` : null,
        o.prepTimeMinutes ? `preparo ${o.prepTimeMinutes} min` : null,
      ]) || 'não veio',
    payments: pay
      ? join([
          pay.methods.map((m) => METHOD_LABEL[m]).join(', '),
          pay.pix && `chave Pix de ${pay.pix.beneficiary}`,
        ])
      : 'não veio',
  };
}

function Preview({
  imp,
  where,
  owner,
  hasProducts,
  onApplied,
  onDiscard,
  discarding,
}: {
  imp: MenuImport;
  where: ImportWhere;
  owner: boolean;
  hasProducts: boolean;
  onApplied: (imp: MenuImport) => void;
  onDiscard: () => void;
  discarding: boolean;
}) {
  const p = imp.preview!;
  const c = imp.counts!;
  const can = available(imp);
  const text = summaries(imp);
  const allowed = (k: ImportSection) => can[k] && (k !== 'payments' || owner);
  const [sections, setSections] = useState<Set<ImportSection>>(
    () =>
      new Set(
        where === 'onboarding'
          ? (['profile', 'hours', 'delivery', 'payments'] as const).filter(allowed)
          : [],
      ),
  );
  const [mode, setMode] = useState<'add' | 'replace'>('add');
  const [mine, setMine] = useState(false);
  const apply = useMutation({
    mutationFn: () =>
      api.applyImport(imp.id, { mode: hasProducts ? mode : 'add', sections: [...sections] }),
    onSuccess: onApplied,
  });

  const hidden = imp.lost.filter(hidesProduct);
  const notes = imp.lost.filter((l) => !hidesProduct(l));
  const from = platformName(imp.platform);

  return (
    <div className="animate-fade-up space-y-6">
      <Card className="space-y-4 p-5">
        <div className="flex items-start gap-3">
          <span className="grid size-12 shrink-0 place-items-center rounded-full bg-success-soft text-success">
            <CheckCircle weight="fill" className="size-7" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="t-title-2">
              Encontramos {num(c.products)} {c.products === 1 ? 'produto' : 'produtos'} em{' '}
              {c.categories} {c.categories === 1 ? 'categoria' : 'categorias'}
            </p>
            <p className="t-body text-muted">
              no {from}
              {p.store.name ? `, na loja ${p.store.name}` : ''}
            </p>
          </div>
        </div>
        <ul className="grid gap-2 sm:grid-cols-2">
          {c.photos ? <Found icon={<Images />}>{num(c.photos)} fotos</Found> : null}
          {c.optionGroups ? (
            <Found icon={<ForkKnife />}>
              {num(c.optionGroups)} {c.optionGroups === 1 ? 'grupo' : 'grupos'} de opções
            </Found>
          ) : null}
          {can.hours ? <Found icon={<Clock />}>horários: {daysCovered(p.hours)}</Found> : null}
          {p.operations.pickup || p.operations.delivery ? (
            <Found icon={<Storefront />}>
              {[p.operations.pickup && 'retirada', p.operations.delivery && 'entrega']
                .filter(Boolean)
                .join(' e ')}
            </Found>
          ) : null}
          {p.payments?.methods.length ? (
            <Found icon={<CreditCard />}>
              {p.payments.methods.length} {p.payments.methods.length === 1 ? 'forma' : 'formas'} de
              pagamento
              {p.payments.pix ? ' e Pix' : ''}
            </Found>
          ) : null}
          {p.store.logoUrl || p.store.coverUrl ? (
            <Found icon={<Images />}>
              {[p.store.logoUrl && 'logo', p.store.coverUrl && 'capa'].filter(Boolean).join(' e ')}{' '}
              da loja
            </Found>
          ) : null}
        </ul>
        {c.hidden ? (
          <Notice
            tone="warning"
            title={`${c.hidden} ${c.hidden === 1 ? 'produto vem oculto' : 'produtos vêm ocultos'}`}
          >
            O preço deles podia sair diferente do {from}, então chegam escondidos para você conferir
            e mostrar. Veja o porquê lá embaixo.
          </Notice>
        ) : null}
      </Card>

      <section aria-labelledby="import-menu-t" className="space-y-3">
        <h3 id="import-menu-t" className="t-title-2 px-1">
          O cardápio
        </h3>
        {p.categories.map((cat, i) => (
          <Disclosure
            key={cat.name}
            defaultOpen={i === 0}
            title={cat.name}
            summary={`${cat.products.length} ${cat.products.length === 1 ? 'produto' : 'produtos'}${cat.description ? ` · ${cat.description}` : ''}`}
          >
            <CategoryProducts products={cat.products} />
          </Disclosure>
        ))}
      </section>

      <section aria-labelledby="import-settings-t" className="space-y-3">
        <div className="px-1">
          <h3 id="import-settings-t" className="t-title-2">
            O que mais trazer
          </h3>
          <p className="t-body text-muted">
            {where === 'onboarding'
              ? 'Já vem marcado. Desmarque o que preferir preencher do zero.'
              : 'Marque só o que quer trocar: o resto da loja fica como está.'}
          </p>
        </div>
        <Card className="divide-y divide-line px-4">
          {(['profile', 'hours', 'delivery', 'payments'] as const).map((k) => (
            <Toggle
              key={k}
              id={`import-sec-${k}`}
              label={SECTION_LABEL[k]}
              description={
                k === 'payments' && !owner && can.payments
                  ? 'Só quem é dono da loja traz os pagamentos.'
                  : text[k]
              }
              checked={sections.has(k)}
              disabled={!allowed(k)}
              onChange={(v) =>
                setSections((cur) => {
                  const n = new Set(cur);
                  if (v) n.add(k);
                  else n.delete(k);
                  return n;
                })
              }
            />
          ))}
        </Card>
      </section>

      {hasProducts ? (
        <section aria-labelledby="import-mode-t" className="space-y-3">
          <h3 id="import-mode-t" className="t-title-2 px-1">
            E o cardápio de agora?
          </h3>
          <Segmented
            label="somar ou trocar"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'add', label: 'Somar' },
              { value: 'replace', label: 'Trocar' },
            ]}
          />
          <p className="t-body px-1 text-muted">
            {mode === 'add'
              ? 'Os produtos novos entram junto com os que você já tem. Categorias com o mesmo nome recebem os produtos.'
              : 'Os produtos de agora saem do cardápio e ficam arquivados: os pedidos antigos continuam certinhos.'}
          </p>
        </section>
      ) : null}

      {imp.lost.length ? (
        <section aria-labelledby="import-lost-t" className="space-y-3">
          <div className="px-1">
            <h3 id="import-lost-t" className="t-title-2">
              O que não vem igual
            </h3>
            <p className="t-body text-muted">Para você saber antes, e acertar depois se quiser.</p>
          </div>
          {hidden.length ? (
            <LostList
              title="Vêm ocultos, para você conferir"
              icon={<EyeSlash className="size-5" />}
              lines={hidden.map((l) => lostLine(l, imp.platform))}
            />
          ) : null}
          {notes.length ? (
            <LostList
              title="Não vem do jeito que estava"
              icon={<MinusCircle className="size-5" />}
              lines={notes.map((l) => lostLine(l, imp.platform))}
            />
          ) : null}
        </section>
      ) : null}

      <Card className="space-y-4 p-4">
        <Toggle
          id="import-mine"
          label="Essa loja é minha"
          description={`Só importe o cardápio da sua própria loja no ${from}.`}
          checked={mine}
          onChange={setMine}
        />
        {apply.error ? (
          <p className="t-body text-danger" role="alert">
            {messageOf(apply.error)}
          </p>
        ) : null}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
          <Button variant="ghost" size="lg" loading={discarding} onClick={onDiscard}>
            {where === 'onboarding' ? 'usar outro link' : 'cancelar'}
          </Button>
          <div className="hidden flex-1 sm:block" />
          <Button
            size="lg"
            disabled={!mine}
            loading={apply.isPending}
            onClick={() => apply.mutate()}
          >
            Importar {num(c.products)} {c.products === 1 ? 'produto' : 'produtos'} <ArrowRight />
          </Button>
        </div>
      </Card>
    </div>
  );
}

function Found({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="t-body flex min-h-11 items-center gap-2.5 rounded-md bg-sunken px-3 py-2">
      <span className="shrink-0 text-success [&_svg]:size-5" aria-hidden>
        {icon}
      </span>
      {children}
    </li>
  );
}

const FIRST = 5;

function CategoryProducts({ products }: { products: ImportPreviewProduct[] }) {
  const [all, setAll] = useState(products.length <= FIRST + 2);
  const shown = all ? products : products.slice(0, FIRST);
  return (
    <>
      <ul className="-mx-4 -my-2 divide-y divide-line">
        {shown.map((pr, j) => (
          <ProductLine key={`${pr.name}-${j}`} p={pr} />
        ))}
      </ul>
      {shown.length < products.length ? (
        <Button variant="ghost" size="sm" className="mt-3" onClick={() => setAll(true)}>
          ver todos os {products.length}
        </Button>
      ) : null}
    </>
  );
}

function ProductLine({ p }: { p: ImportPreviewProduct }) {
  const [broken, setBroken] = useState(false);
  const a = availability(p);
  const badge = a === 'hidden' ? 'oculto' : a === 'sold_out' ? 'esgotado' : null;
  return (
    <li className="flex min-h-16 items-center gap-3 px-4 py-2.5">
      <span className="size-12 shrink-0 overflow-hidden rounded-sm bg-sunken">
        {p.image && !broken ? (
          <img
            src={p.image}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setBroken(true)}
            className="size-full object-cover"
          />
        ) : (
          <NoPhoto className="text-muted" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{p.name}</span>
        <span className="t-caption block truncate text-muted">
          {[
            p.optionGroups.length
              ? `${p.optionGroups.length} ${p.optionGroups.length === 1 ? 'grupo' : 'grupos'} de opções`
              : null,
            p.stockQuantity !== null && p.stockQuantity > 0
              ? `${p.stockQuantity} em estoque`
              : null,
            ...p.tags,
          ]
            .filter(Boolean)
            .join(' · ') ||
            (p.description ?? '')}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className="tnum block font-semibold">{money(p.priceCents)}</span>
        {p.compareAtPriceCents ? (
          <s className="tnum t-caption block text-muted">{money(p.compareAtPriceCents)}</s>
        ) : badge ? (
          <span
            className={cn(
              't-caption block font-semibold',
              badge === 'oculto' ? 'text-warning' : 'text-muted',
            )}
          >
            {badge}
          </span>
        ) : null}
      </span>
    </li>
  );
}

function LostList({ title, icon, lines }: { title: string; icon: ReactNode; lines: string[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? lines : lines.slice(0, 6);
  return (
    <Card className="p-4">
      <p className="mb-2 flex items-center gap-2 font-semibold">
        <span className="text-muted" aria-hidden>
          {icon}
        </span>
        {title}
      </p>
      <ul className="t-body list-disc space-y-1.5 pl-6 marker:text-muted">
        {shown.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
      {lines.length > shown.length ? (
        <Button variant="ghost" size="sm" className="mt-2" onClick={() => setAll(true)}>
          ver mais {lines.length - shown.length}
        </Button>
      ) : null}
    </Card>
  );
}

// ── done ─────────────────────────────────────────────────────────────────────

function Done({
  imp,
  where,
  onContinue,
}: {
  imp: MenuImport;
  where: ImportWhere;
  onContinue: () => void;
}) {
  const r = imp.result;
  const imgs = imp.images;
  const pct = imgs.total ? Math.round((imgs.done / imgs.total) * 100) : 100;
  const notes = useMemo(
    () => imp.lost.filter((l) => l.code.endsWith('_failed') || l.code === 'cover_small'),
    [imp.lost],
  );
  return (
    <div className="animate-fade-up space-y-6">
      <Card className="flex flex-col items-center gap-3 px-6 py-7 text-center">
        <Mascote pose="sucesso" size={120} className="w-28" />
        <p className="t-title-1">
          Pronto!{' '}
          {r ? `${num(r.products)} ${r.products === 1 ? 'produto' : 'produtos'}` : 'O cardápio'} no
          seu cardápio
        </p>
        <p className="t-body text-muted">
          {r?.hidden
            ? `${r.hidden} ${r.hidden === 1 ? 'ficou oculto' : 'ficaram ocultos'} para você conferir.`
            : 'Confira os preços com calma: dá para mudar tudo depois.'}
          {r?.archived ? ` Os ${r.archived} produtos antigos foram arquivados.` : ''}
        </p>
      </Card>

      {imgs.total ? (
        <Card className="space-y-3 p-4" aria-live="polite">
          <p className="flex items-center gap-2 font-semibold">
            {imgs.finished ? (
              <CheckCircle weight="fill" className="size-5 text-success" aria-hidden />
            ) : (
              <Spinner className="size-5" />
            )}
            {imgs.finished ? 'Fotos prontas' : 'Trazendo as fotos'}
            <span className="tnum ml-auto t-caption text-muted">
              {num(imgs.done)} de {num(imgs.total)}
            </span>
          </p>
          <span
            className="block h-2 overflow-hidden rounded-full bg-line-strong"
            role="progressbar"
            aria-label="fotos"
            aria-valuemin={0}
            aria-valuemax={imgs.total}
            aria-valuenow={imgs.done}
          >
            <span
              className="block h-full rounded-full bg-[var(--chart)] transition-[width] duration-(--duration-smooth)"
              style={{ width: `${pct}%` }}
            />
          </span>
          {!imgs.finished ? (
            <p className="t-caption text-muted">
              Pode seguir: as fotos continuam chegando sozinhas.
            </p>
          ) : null}
          {notes.length ? (
            <ul className="t-body list-disc space-y-1 pl-6 marker:text-muted">
              {notes.slice(0, 6).map((l, i) => (
                <li key={i}>{lostLine(l, imp.platform)}</li>
              ))}
            </ul>
          ) : null}
        </Card>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
        <Button
          size="lg"
          onClick={onContinue}
          icon={where === 'onboarding' ? undefined : <Storefront />}
        >
          {where === 'onboarding' ? (
            <>
              Continuar <ArrowRight />
            </>
          ) : (
            'Ver o cardápio'
          )}
        </Button>
      </div>
      {where === 'onboarding' && imp.sections?.length ? (
        <p className="t-caption text-center text-muted sm:text-right">
          Nas próximas perguntas, o que veio já está preenchido: é só conferir.
        </p>
      ) : null}
    </div>
  );
}
