import { ArrowRight, Check, Copy, WhatsappLogo, X } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api, type StoreView } from '../../lib/api.ts';
import { hhmm, money, WEEKDAYS } from '../../lib/format.ts';
import { qk } from '../../lib/query.ts';
import { can, useSession } from '../../lib/session.ts';
import { Button } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { Confetti } from '../../ui/Celebration.tsx';
import { cn } from '../../ui/cn.ts';
import { Loading, messageOf } from '../../ui/feedback.tsx';
import { Chips, CommitInput, Field, MoneyField, TextInput, Toggle } from '../../ui/fields.tsx';
import { PhotoField } from '../../ui/PhotoField.tsx';
import { fromWeek, TimeRangeField, toWeek, type WeekModel } from '../../ui/TimeRangeField.tsx';
import { toast } from '../../ui/Toast.tsx';

// The store builds itself (§6.8): one scroll, each answer visibly assembles the
// store in the phone beside it (below the questions on phones). Everything saves
// as it's answered, so leaving halfway loses nothing.

export default function Onboarding() {
  const store = useQuery({ queryKey: qk.store, queryFn: api.store });
  const cat = useQuery({ queryKey: qk.catalog, queryFn: api.catalog });
  const pay = useQuery({ queryKey: qk.payments, queryFn: api.payments });
  if (!store.data || !cat.data)
    return (
      <div className="mx-auto max-w-lg p-6">
        <Loading />
      </div>
    );
  return (
    <Flow
      s={store.data}
      products={cat.data.categories.flatMap((c) => c.products)}
      firstCategory={cat.data.categories[0]?.id ?? null}
      hasPix={!!pay.data?.pix}
    />
  );
}

function Flow({
  s,
  products,
  firstCategory,
  hasPix,
}: {
  s: StoreView;
  products: { id: string; name: string; priceCents: number; imageUrl: string | null }[];
  firstCategory: string | null;
  hasPix: boolean;
}) {
  const session = useSession();
  const owner = can(session.user.role, 'owner');
  const qc = useQueryClient();
  const save = (body: Record<string, unknown>) =>
    api.updateStore(body).then(
      (n) => {
        qc.setQueryData(qk.store, n);
        void qc.invalidateQueries({ queryKey: qk.home });
        void qc.invalidateQueries({ queryKey: qk.session });
      },
      (e) => toast.error(messageOf(e)),
    );
  const [week, setWeek] = useState<WeekModel>(() => toWeek(s.hours.windows));
  useEffect(() => {
    const t = setTimeout(() => {
      if (JSON.stringify(fromWeek(week)) !== JSON.stringify(s.hours.windows))
        void save({ hours: fromWeek(week) });
    }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week]);

  const steps = [
    { id: 'perfil', done: !!s.profile.logoUrl && !!s.profile.whatsapp },
    { id: 'horarios', done: s.hours.windows.length > 0 },
    { id: 'entrega', done: s.operations.pickupEnabled || s.zones.length > 0 },
    { id: 'pix', done: hasPix || !owner },
    { id: 'produtos', done: products.length >= 3 },
  ];
  const ready = steps.every((x) => x.done);

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-bg/95 px-4 py-3 backdrop-blur-sm md:px-8">
        <p className="font-display text-lg font-semibold">venduá</p>
        <div
          className="flex flex-1 justify-center gap-1.5"
          aria-label={`${steps.filter((x) => x.done).length} de ${steps.length} passos`}
        >
          {steps.map((x) => (
            <span
              key={x.id}
              className={cn(
                'h-1.5 w-8 rounded-full',
                x.done ? 'bg-[var(--chart)]' : 'bg-line-strong',
              )}
            />
          ))}
        </div>
        <Link
          to="/"
          className="t-label inline-flex min-h-11 items-center gap-1 rounded-md px-3 text-muted hover:bg-hover"
          aria-label="sair e continuar depois"
        >
          <X className="size-5" /> <span className="hidden sm:inline">continuar depois</span>
        </Link>
      </header>
      <div className="mx-auto grid max-w-6xl gap-10 px-4 pb-24 pt-8 md:px-8 lg:grid-cols-[1fr_380px]">
        <div className="space-y-12">
          <div>
            <p className="t-moment">Vamos deixar sua loja pronta.</p>
            <p className="t-body-lg mt-2 text-muted">
              Leva uns 10 minutos. Tudo salva sozinho, e você acompanha a loja se montando ao lado.
            </p>
          </div>

          <Step n={1} title="A cara da loja" done={steps[0]!.done}>
            <div className="flex flex-wrap items-start gap-5">
              <div className="w-32">
                <PhotoField
                  label="logo"
                  aspect="1:1"
                  max={1}
                  photos={s.profile.logoUrl ? [{ url: s.profile.logoUrl }] : []}
                  onChange={(p) => save({ profile: { logoUrl: p[0]?.url ?? null } })}
                />
              </div>
              <div className="min-w-60 flex-1 space-y-4">
                <Field label="Nome da loja" htmlFor="ob-name">
                  <CommitInput
                    id="ob-name"
                    maxLength={80}
                    value={s.profile.name}
                    onCommit={(v) => void save({ profile: { name: v } })}
                  />
                </Field>
                <Field label="WhatsApp para os clientes" htmlFor="ob-wa">
                  <CommitInput
                    id="ob-wa"
                    type="tel"
                    inputMode="tel"
                    maxLength={20}
                    value={s.profile.whatsapp ?? ''}
                    placeholder="(22) 99999-0000"
                    onCommit={(v) =>
                      void save({ profile: { whatsapp: v.replace(/\D/g, '') || null } })
                    }
                  />
                </Field>
                <Field label="Uma frase sobre a loja" optional htmlFor="ob-tag">
                  <CommitInput
                    id="ob-tag"
                    maxLength={120}
                    value={s.profile.tagline ?? ''}
                    placeholder="Ex.: Pudins sem furinhos"
                    onCommit={(v) => void save({ profile: { tagline: v || null } })}
                  />
                </Field>
              </div>
            </div>
          </Step>

          <Step n={2} title="Quando a loja abre" done={steps[1]!.done}>
            <Card className="px-4 py-1">
              <TimeRangeField value={week} onChange={setWeek} />
            </Card>
          </Step>

          <Step n={3} title="Entrega e retirada" done={steps[2]!.done}>
            <Card className="space-y-1 p-4">
              <Toggle
                checked={s.operations.pickupEnabled}
                onChange={(v) => void save({ operations: { pickupEnabled: v } })}
                label="O cliente pode retirar na loja"
              />
              <Toggle
                checked={s.operations.deliveryEnabled}
                onChange={(v) => void save({ operations: { deliveryEnabled: v } })}
                label="Eu entrego"
              />
              {s.operations.deliveryEnabled ? (
                <p className="t-body pt-2 text-muted">
                  {s.zones.length
                    ? `${s.zones.length} ${s.zones.length === 1 ? 'área de entrega' : 'áreas de entrega'} configurada${s.zones.length === 1 ? '' : 's'}.`
                    : 'Falta dizer para onde entrega.'}{' '}
                  <Link to="/loja#entrega" className="font-semibold underline underline-offset-2">
                    {s.zones.length ? 'ajustar áreas' : 'configurar bairros ou raio'}
                  </Link>
                </p>
              ) : null}
            </Card>
          </Step>

          {owner ? (
            <Step n={4} title="Receber pelo Pix" done={steps[3]!.done}>
              <QuickPix done={hasPix} />
            </Step>
          ) : null}

          <Step n={owner ? 5 : 4} title="Os primeiros produtos" done={steps[4]!.done}>
            <QuickProducts firstCategory={firstCategory} count={products.length} />
          </Step>

          {ready ? <Live url={session.store.url} name={s.profile.name} /> : null}
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start" aria-label="prévia da sua loja">
          <MiniStore s={s} products={products} week={week} />
        </aside>
      </div>
    </div>
  );
}

function Step({
  n,
  title,
  done,
  children,
}: {
  n: number;
  title: string;
  done: boolean;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={`ob-${n}`} className="animate-fade-up">
      <h2 id={`ob-${n}`} className="t-title-2 mb-4 flex items-center gap-3">
        <span
          className={cn(
            'grid size-9 shrink-0 place-items-center rounded-full font-display text-base',
            done ? 'bg-[var(--chart)] text-surface' : 'bg-sunken',
          )}
        >
          {done ? <Check weight="bold" className="size-5" /> : n}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function QuickPix({ done }: { done: boolean }) {
  const qc = useQueryClient();
  const [type, setType] = useState('phone');
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const m = useMutation({
    mutationFn: () => api.updatePayments({ pix: { keyType: type, key, beneficiary: name } }),
    onSuccess: (d) => {
      qc.setQueryData(qk.payments, d);
      toast('Pix pronto ✓');
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  if (done)
    return (
      <Card className="p-4">
        <p className="t-body">
          Chave Pix cadastrada. Os clientes veem o Pix com o valor já preenchido.
        </p>
      </Card>
    );
  return (
    <Card className="space-y-4 p-4">
      <Chips
        label="tipo de chave"
        value={type}
        onChange={setType}
        options={[
          { value: 'phone', label: 'celular' },
          { value: 'cpf', label: 'CPF' },
          { value: 'cnpj', label: 'CNPJ' },
          { value: 'email', label: 'e-mail' },
          { value: 'random', label: 'aleatória' },
        ]}
      />
      <Field label="Chave" htmlFor="ob-pix">
        <TextInput id="ob-pix" value={key} onChange={(e) => setKey(e.target.value)} />
      </Field>
      <Field label="Nome de quem recebe" htmlFor="ob-pixname">
        <TextInput
          id="ob-pixname"
          maxLength={25}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Button loading={m.isPending} disabled={!key || name.length < 2} onClick={() => m.mutate()}>
        salvar Pix
      </Button>
    </Card>
  );
}

function QuickProducts({ firstCategory, count }: { firstCategory: string | null; count: number }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [price, setPrice] = useState<number | null>(null);
  const add = useMutation({
    mutationFn: async () => {
      const categoryId = firstCategory ?? (await api.createCategory('Cardápio')).category.id;
      return api.createProduct({ name: name.trim(), priceCents: price ?? 0, categoryId });
    },
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: qk.catalog });
      toast(`${r.product.name} no cardápio ✓`);
      setName('');
      setPrice(null);
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  return (
    <Card className="space-y-4 p-4">
      <p className="t-body text-muted">
        {count ? `${count} no cardápio. ` : ''}Comece com os 3 que mais vendem. Fotos e detalhes
        você coloca depois, com calma.
      </p>
      <div className="grid gap-3 sm:grid-cols-[1fr_160px_auto] sm:items-end">
        <Field label="Produto" htmlFor="ob-p">
          <TextInput
            id="ob-p"
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Pudim de leite"
          />
        </Field>
        <Field label="Preço" htmlFor="ob-price">
          <MoneyField id="ob-price" cents={price} onCommit={setPrice} />
        </Field>
        <Button
          loading={add.isPending}
          disabled={name.trim().length < 2 || price === null}
          onClick={() => add.mutate()}
        >
          adicionar
        </Button>
      </div>
      <Link
        to="/cardapio"
        className="t-label inline-flex items-center gap-1 text-muted underline underline-offset-2"
      >
        tem uma lista no WhatsApp? cole no Cardápio <ArrowRight className="size-4" />
      </Link>
    </Card>
  );
}

/** The store assembling itself: logo → colours, hours → status, products → the grid. */
function MiniStore({
  s,
  products,
  week,
}: {
  s: StoreView;
  products: { id: string; name: string; priceCents: number; imageUrl: string | null }[];
  week: WeekModel;
}) {
  const today = new Date().getDay();
  const hours = week[today] ?? [];
  return (
    <div className="mx-auto max-w-[340px] rounded-[40px] bg-[#0c1410] p-3 depth-3">
      <div className="aspect-[9/17] overflow-hidden rounded-[30px] bg-[#fcfbf8] text-[#1a1714]">
        <div className="flex items-center gap-2 border-b border-black/5 px-4 py-3">
          <span className="grid size-9 place-items-center overflow-hidden rounded-full bg-[#123c32] text-sm font-semibold text-white transition-all">
            {s.profile.logoUrl ? (
              <img src={s.profile.logoUrl} alt="" className="size-full object-cover" />
            ) : (
              s.profile.name.slice(0, 1)
            )}
          </span>
          <span className="min-w-0 flex-1 truncate font-semibold">{s.profile.name}</span>
          <span className="rounded-full bg-black/5 px-2 py-0.5 text-[11px]">sacola</span>
        </div>
        <div className="px-4 py-4">
          {s.profile.tagline ? (
            <p className="animate-fade-up font-display text-xl leading-tight">
              {s.profile.tagline}
            </p>
          ) : (
            <div className="h-6 w-3/4 rounded bg-black/5" />
          )}
          <p
            className={cn(
              'mt-2 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold',
              hours.length ? 'bg-[#e8f5dd] text-[#2f4a00]' : 'bg-black/5 text-black/50',
            )}
          >
            <span
              className={cn('size-1.5 rounded-full', hours.length ? 'bg-[#1f7a4d]' : 'bg-black/30')}
            />
            {hours.length
              ? `Hoje: ${hours.map((h) => `${hhmm(h.open)}–${hhmm(h.close)}`).join(', ')}`
              : `${WEEKDAYS[today]}: fechado`}
          </p>
          <p className="mt-1 text-[11px] text-black/50">
            {[s.operations.pickupEnabled && 'retirada', s.operations.deliveryEnabled && 'entrega']
              .filter(Boolean)
              .join(' · ')}
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {(products.length ? products.slice(0, 6) : Array.from({ length: 4 }, () => null)).map(
              (p, i) =>
                p ? (
                  <div
                    key={p.id}
                    className="animate-fade-up overflow-hidden rounded-lg bg-white shadow-sm"
                  >
                    <div className="aspect-[4/3] bg-[#efe9d8]">
                      {p.imageUrl ? (
                        <img src={p.imageUrl} alt="" className="size-full object-cover" />
                      ) : null}
                    </div>
                    <div className="p-1.5">
                      <p className="truncate text-[11px] font-semibold">{p.name}</p>
                      <p className="text-[11px] text-black/60">{money(p.priceCents)}</p>
                    </div>
                  </div>
                ) : (
                  <div
                    key={i}
                    className="aspect-[4/5] rounded-lg border border-dashed border-black/10"
                  />
                ),
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Live({ url, name }: { url: string; name: string }) {
  const [qr, setQr] = useState<string | null>(null);
  const text = useMemo(() => `A ${name} agora tem loja online! Peça por aqui: ${url}`, [name, url]);
  useEffect(() => {
    void QRCode.toDataURL(url, {
      margin: 1,
      width: 400,
      color: { dark: '#123c32', light: '#fffdf8' },
    }).then(setQr);
  }, [url]);
  return (
    <section className="relative overflow-visible rounded-xl bg-primary p-6 text-on-primary depth-2 md:p-8">
      <Confetti />
      <p className="t-moment">Sua loja está no ar.</p>
      <p className="t-body-lg mt-2 opacity-85">Agora é só contar para todo mundo.</p>
      <div className="mt-6 flex flex-col gap-6 sm:flex-row sm:items-center">
        {qr ? <img src={qr} alt={`QR code para ${url}`} className="size-40 rounded-md" /> : null}
        <div className="min-w-0 flex-1 space-y-3">
          <p className="tnum break-all font-display text-xl font-semibold">
            {url.replace('https://', '')}
          </p>
          <div className="flex flex-wrap gap-2">
            <a
              href={`https://wa.me/?text=${encodeURIComponent(text)}`}
              target="_blank"
              rel="noreferrer"
              className="t-label inline-flex min-h-12 items-center gap-2 rounded-md bg-spark px-4 text-on-spark"
            >
              <WhatsappLogo weight="fill" className="size-5" /> compartilhar no WhatsApp
            </a>
            <Button
              variant="ghost"
              className="text-on-primary"
              icon={<Copy />}
              onClick={() =>
                void navigator.clipboard.writeText(url).then(() => toast('Link copiado'))
              }
            >
              copiar link
            </Button>
          </div>
          <Link
            to="/"
            className="t-label inline-flex min-h-11 items-center gap-1 underline underline-offset-2"
          >
            ir para o painel <ArrowRight className="size-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
