import { ArrowsClockwise, Copy, ShareNetwork, Sparkle, WarningCircle } from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, type StatusDoDia as Data, type StatusPostState } from '../../lib/api.ts';
import { dateShort, money, num } from '../../lib/format.ts';
import { qk, useMutation } from '../../lib/query.ts';
import { Button } from '../../ui/Button.tsx';
import { Card, Section } from '../../ui/Card.tsx';
import { cn } from '../../ui/cn.ts';
import { ErrorState, messageOf } from '../../ui/feedback.tsx';
import { Chips, Field, TextArea, TimeInput, Toggle } from '../../ui/fields.tsx';
import { NoPhoto } from '../../ui/illustrations.tsx';
import { PageBody, PageHeader } from '../../ui/Page.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { SectionsSkeleton } from '../../ui/skeletons.tsx';
import { toast } from '../../ui/Toast.tsx';
import { renderStatusImage } from './statusImage.ts';
import { mediaUrl } from '../../lib/media.ts';
import { platform } from '../../platform/index.ts';

// Marketing › Status do dia (0124, docs/features/status-do-dia.md S1): every day at the owner's
// hour Core prepares the store's Status — products available now, prices from the catalog, a
// link that counts the orders it brings. The images are drawn here in the store's look and
// posted from the phone's share sheet ("Meu status"). Nothing is sent from the store's number.

const DAYS = [
  { value: '1', label: 'seg' },
  { value: '2', label: 'ter' },
  { value: '3', label: 'qua' },
  { value: '4', label: 'qui' },
  { value: '5', label: 'sex' },
  { value: '6', label: 'sáb' },
  { value: '0', label: 'dom' },
];

const STATE: Record<StatusPostState, { label: string; cls: string }> = {
  ready: { label: 'pronto', cls: 'bg-info-soft text-ink' },
  shared: { label: 'postado', cls: 'bg-success-soft text-ink' },
  skipped: { label: 'pulado', cls: 'bg-sunken text-muted' },
};

const brought = (orders: number, cents: number) =>
  orders
    ? `${num(orders)} ${orders === 1 ? 'pedido' : 'pedidos'} · ${money(cents)}`
    : 'nenhum pedido ainda';

export default function StatusDoDia() {
  const qc = useQueryClient();
  const { data, error, refetch } = useQuery({ queryKey: qk.statusDoDia, queryFn: api.statusDoDia });
  const { data: look } = useQuery({ queryKey: qk.appearance, queryFn: api.appearance });
  const set = (d: Data) => qc.setQueryData(qk.statusDoDia, d);
  const onError = (e: unknown) => toast.error(messageOf(e));
  const plan = useMutation({
    mutationFn: (p: Partial<Data['plan']>) => api.saveStatusPlan(p),
    onSuccess: set,
    onError,
  });
  const prepare = useMutation({ mutationFn: api.prepareStatus, onSuccess: set, onError });
  const post = useMutation({
    mutationFn: (p: { id: string; state?: StatusPostState; productIds?: string[] }) =>
      api.updateStatusPost(p.id, {
        ...(p.state ? { state: p.state } : {}),
        ...(p.productIds ? { productIds: p.productIds } : {}),
      }),
    onSuccess: set,
    onError,
  });

  if (error && !data)
    return (
      <PageBody>
        <ErrorState error={error} retry={() => void refetch()} />
      </PageBody>
    );
  return (
    <PageBody wide>
      <PageHeader
        title="Status do dia"
        back="/marketing/divulgar"
        subtitle="Todo dia, o status da loja pronto no seu visual, com o link para pedir. Você posta do celular em dois toques."
      />
      {!data ? (
        <SectionsSkeleton columns={2} />
      ) : (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start [&>*]:min-w-0">
          <Section title="Hoje">
            {data.today ? (
              <Today
                data={data}
                tokens={look?.tokens?.tokens ?? null}
                busy={post.isPending}
                onState={(state) => post.mutate({ id: data.today!.id, state })}
                onProducts={(productIds) => post.mutate({ id: data.today!.id, productIds })}
              />
            ) : (
              <Card className="space-y-4 p-5">
                <p className="t-body">
                  {data.plan.enabled
                    ? `O status de hoje fica pronto às ${data.plan.postAt}, com um aviso no seu celular.`
                    : 'Ainda não tem status hoje.'}
                </p>
                <Button
                  icon={<Sparkle />}
                  loading={prepare.isPending}
                  onClick={() => prepare.mutate()}
                >
                  preparar agora
                </Button>
              </Card>
            )}
          </Section>
          <div className="space-y-8">
            <Section
              title="Todo dia"
              hint="A Venduá escolhe o que está vendendo bem nesse dia da semana e tem foto."
            >
              <Card className="px-4">
                <Toggle
                  checked={data.plan.enabled}
                  onChange={(enabled) => plan.mutate({ enabled })}
                  label="Preparar o status todo dia"
                  description="Com um aviso no celular na hora de postar."
                />
                <div className="space-y-5 border-t border-line py-4">
                  <div className="flex items-center justify-between gap-3">
                    <label htmlFor="status-hora" className="t-label">
                      Hora
                    </label>
                    <div className="w-28">
                      <TimeInput
                        id="status-hora"
                        label="hora do status"
                        value={data.plan.postAt}
                        onCommit={(postAt) => plan.mutate({ postAt })}
                      />
                    </div>
                  </div>
                  <div>
                    <p className="t-label mb-2">Dias</p>
                    <Chips
                      multi
                      label="dias do status"
                      value={data.plan.days.map(String)}
                      onChange={(d) => {
                        const n = Number(d);
                        const days = data.plan.days.includes(n)
                          ? data.plan.days.filter((x) => x !== n)
                          : [...data.plan.days, n];
                        plan.mutate({ days });
                      }}
                      options={DAYS}
                    />
                  </div>
                  <CaptionField
                    value={data.plan.caption}
                    onSave={(caption) => plan.mutate({ caption })}
                  />
                </div>
              </Card>
            </Section>
            {data.recent.length ? (
              <Section title="Últimos dias" hint="Pedidos que chegaram pelo link de cada status.">
                <Card as="section" className="divide-y divide-line">
                  {data.recent.map((r) => (
                    <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-3">
                      <span className="min-w-0">
                        <span className="t-label block capitalize">{dateShort(r.day)}</span>
                        <span className="t-caption text-muted">
                          {brought(r.orders, r.revenueCents)}
                        </span>
                      </span>
                      <span
                        className={cn(
                          't-caption shrink-0 rounded-full px-2.5 py-1',
                          STATE[r.state].cls,
                        )}
                      >
                        {STATE[r.state].label}
                      </span>
                    </div>
                  ))}
                </Card>
              </Section>
            ) : null}
          </div>
        </div>
      )}
    </PageBody>
  );
}

function CaptionField({
  value,
  onSave,
}: {
  value: string | null;
  onSave: (v: string | null) => void;
}) {
  const [draft, setDraft] = useState(value ?? '');
  useEffect(() => setDraft(value ?? ''), [value]);
  return (
    <Field
      label="Legenda"
      htmlFor="status-legenda"
      helper="Vazia, a Venduá escreve “Hoje tem …”. O link da loja vai sempre no fim."
    >
      <TextArea
        id="status-legenda"
        rows={2}
        maxLength={300}
        value={draft}
        placeholder="Hoje tem pão de queijo quentinho 😋 Peça pelo link:"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const v = draft.trim() || null;
          if (v !== value) onSave(v);
        }}
      />
    </Field>
  );
}

function Today({
  data,
  tokens,
  busy,
  onState,
  onProducts,
}: {
  data: Data;
  tokens: Parameters<typeof renderStatusImage>[0]['tokens'];
  busy: boolean;
  onState: (s: StatusPostState) => void;
  onProducts: (ids: string[]) => void;
}) {
  const today = data.today!;
  const host = data.store.url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const [images, setImages] = useState<{ id: string; blob: Blob; url: string }[]>([]);
  const [drawing, setDrawing] = useState(true);
  const [swap, setSwap] = useState(false);
  const key = today.products.map((p) => `${p.id}:${p.priceLabel}`).join('|');

  useEffect(() => {
    let live = true;
    const made: { id: string; blob: Blob; url: string }[] = [];
    setDrawing(true);
    void (async () => {
      for (const p of today.products) {
        try {
          const blob = await renderStatusImage({
            tokens,
            storeName: data.store.name,
            host,
            item: p,
          });
          made.push({ id: p.id, blob, url: URL.createObjectURL(blob) });
        } catch {
          /* that product goes without its image */
        }
      }
      if (live) {
        setImages(made);
        setDrawing(false);
      } else made.forEach((m) => URL.revokeObjectURL(m.url));
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tokens, host]);
  useEffect(() => () => images.forEach((m) => URL.revokeObjectURL(m.url)), [images]);

  const files = images.map(
    (m, i) => new File([m.blob], `status-${today.day}-${i + 1}.png`, { type: 'image/png' }),
  );
  const copyCaption = () =>
    navigator.clipboard?.writeText(today.caption).then(
      () => true,
      () => false,
    ) ?? Promise.resolve(false);

  const share = async () => {
    // iOS may drop the text with files: the caption is on the clipboard first
    const copied = await copyCaption();
    const r = files.length ? await platform.share.files(files, today.caption) : 'unsupported';
    if (r === 'shared') {
      onState('shared');
      if (copied) toast('Se a legenda não aparecer, ela está copiada: é só colar.');
    }
    if (r !== 'unsupported') return;
    for (const [i, m] of images.entries()) await platform.share.save(m.blob, files[i]!.name);
    toast('Imagens baixadas e legenda copiada. Poste no status pelo WhatsApp.');
  };

  const off = today.products.filter((p) => !p.available);
  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <span className={cn('t-caption rounded-full px-2.5 py-1', STATE[today.state].cls)}>
            {STATE[today.state].label}
          </span>
          <span className="t-caption text-muted">
            {today.orders
              ? `Trouxe ${brought(today.orders, today.revenueCents)}`
              : 'Ainda não trouxe pedidos'}
          </span>
        </div>
        <ul
          aria-label="imagens do status"
          className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0"
        >
          {today.products.map((p) => {
            const img = images.find((m) => m.id === p.id);
            return (
              <li key={p.id} className="w-40 shrink-0 snap-start sm:w-auto sm:min-w-0">
                <div className="aspect-[9/16] overflow-hidden rounded-md bg-sunken ring-1 ring-line">
                  {img ? (
                    <img
                      src={mediaUrl(img.url)}
                      alt={`status de ${p.name}`}
                      className="size-full object-cover"
                    />
                  ) : drawing ? (
                    <div className="size-full animate-pulse" />
                  ) : (
                    <NoPhoto />
                  )}
                </div>
                <p className="t-caption mt-1.5 truncate">{p.name}</p>
                {!p.available ? (
                  <p className="t-caption inline-flex items-center gap-1 text-danger">
                    <WarningCircle className="size-3.5" /> não está à venda agora
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
        <div className="rounded-md bg-sunken px-3 py-2.5">
          <p className="t-body break-words">{today.caption}</p>
        </div>
        {off.length ? (
          <p className="t-body text-danger">
            {off.length === 1 ? 'Um produto saiu de venda' : 'Alguns produtos saíram de venda'}{' '}
            desde que o status ficou pronto. Troque antes de postar.
          </p>
        ) : null}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button
            size="lg"
            icon={<ShareNetwork />}
            disabled={drawing || !images.length || off.length > 0}
            onClick={() => void share()}
          >
            postar no status
          </Button>
          <Button
            variant="secondary"
            icon={<Copy />}
            onClick={() => void copyCaption().then((ok) => ok && toast('Legenda copiada'))}
          >
            copiar legenda
          </Button>
          <Button variant="secondary" icon={<ArrowsClockwise />} onClick={() => setSwap(true)}>
            trocar produtos
          </Button>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-line pt-3">
          {today.state !== 'shared' ? (
            <Button variant="quiet" size="sm" loading={busy} onClick={() => onState('shared')}>
              já postei
            </Button>
          ) : null}
          {today.state === 'ready' ? (
            <Button variant="quiet" size="sm" loading={busy} onClick={() => onState('skipped')}>
              pular hoje
            </Button>
          ) : today.state === 'skipped' ? (
            <Button variant="quiet" size="sm" loading={busy} onClick={() => onState('ready')}>
              voltar a postar hoje
            </Button>
          ) : null}
        </div>
      </Card>
      <p className="t-caption text-muted">
        No WhatsApp, escolha “Meu status”. Os pedidos que vierem pelo link aparecem aqui.
      </p>
      <SwapSheet
        open={swap}
        onOpenChange={setSwap}
        current={today.products.map((p) => p.id)}
        onSave={(ids) => {
          onProducts(ids);
          setSwap(false);
        }}
      />
    </div>
  );
}

function SwapSheet({
  open,
  onOpenChange,
  current,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  current: string[];
  onSave: (ids: string[]) => void;
}) {
  const { data } = useQuery({ queryKey: qk.share, queryFn: api.share, enabled: open });
  const [picked, setPicked] = useState<string[]>(current);
  useEffect(() => {
    if (open) setPicked(current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < 3 ? [...p, id] : p));
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Produtos do status"
      description="Escolha até 3. Só entram os que estão à venda agora."
      footer={
        <Button size="lg" block disabled={!picked.length} onClick={() => onSave(picked)}>
          usar {picked.length} {picked.length === 1 ? 'produto' : 'produtos'}
        </Button>
      }
    >
      <ul className="divide-y divide-line pt-2">
        {(data?.products ?? []).map((p) => {
          const on = picked.includes(p.id);
          return (
            <li key={p.id}>
              <label className="flex min-h-14 cursor-pointer items-center gap-3 py-2">
                <input
                  type="checkbox"
                  className="size-5 accent-[var(--color-primary)]"
                  checked={on}
                  disabled={!on && picked.length >= 3}
                  onChange={() => toggle(p.id)}
                />
                <span className="size-11 shrink-0 overflow-hidden rounded-sm bg-sunken">
                  {p.imageUrl ? (
                    <img
                      src={mediaUrl(p.imageUrl)}
                      alt=""
                      className="size-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <NoPhoto />
                  )}
                </span>
                <span className="t-body min-w-0 flex-1 truncate">{p.name}</span>
              </label>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
