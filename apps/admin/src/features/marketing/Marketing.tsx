import {
  Copy,
  Gift,
  Megaphone,
  Plus,
  QrCode,
  ShareNetwork,
  Ticket,
  UsersThree,
  WhatsappLogo,
} from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { whatsappUrl } from '@vendua/kernel/rules';
import { api, type Coupon, type LoyaltyProgram, type Marketing as M } from '../../lib/api.ts';
import { dateShort, money, phone } from '../../lib/format.ts';
import { optimistic, qk, useMutation } from '../../lib/query.ts';
import { useSession } from '../../lib/session.ts';
import { Button } from '../../ui/Button.tsx';
import { Card, Section } from '../../ui/Card.tsx';
import { cn } from '../../ui/cn.ts';
import { EmptyState, ErrorState, messageOf, DuaNote } from '../../ui/feedback.tsx';
import {
  Chips,
  Field,
  MoneyField,
  SaveMark,
  SavedStepper,
  Stepper,
  TextInput,
  Toggle,
  useSaveState,
} from '../../ui/fields.tsx';
import { Mascote } from '../../ui/Mascote.tsx';
import { NoPhoto } from '../../ui/illustrations.tsx';
import { PageBody, PageHeader } from '../../ui/Page.tsx';
import { availability } from '../../ui/ProductTile.tsx';
import { Qr, qrPng } from '../../ui/Qr.tsx';
import { SectionsSkeleton } from '../../ui/skeletons.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { PlanLocked } from '../../ui/PlanLocked.tsx';
import { isPlanRequired, useFeature } from '../../lib/session.ts';
import { toast } from '../../ui/Toast.tsx';
import { shareCard } from './shareCard.ts';

export default function Marketing() {
  const { data, error, refetch } = useQuery({ queryKey: qk.marketing, queryFn: api.marketing });
  if (error && !data)
    return (
      <PageBody>
        <ErrorState error={error} retry={() => void refetch()} />
      </PageBody>
    );
  return (
    <PageBody wide>
      <PageHeader title="Marketing" subtitle="Traga gente nova e faça quem já comprou voltar." />
      {!data ? (
        <SectionsSkeleton columns={2} />
      ) : (
        <div className="grid gap-8 lg:grid-cols-2 [&>*]:min-w-0">
          <div className="space-y-8">
            <Share />
            <Coupons coupons={data.coupons} />
          </div>
          <div className="space-y-8">
            <Loyalty data={data} />
            <Waitlist data={data} />
            <Announcement data={data} />
          </div>
        </div>
      )}
    </PageBody>
  );
}

function Share() {
  const s = useSession();
  const { data } = useQuery({ queryKey: qk.share, queryFn: api.share });
  const [qrOpen, setQrOpen] = useState(false);
  const [png, setPng] = useState<string | null>(null);
  const url = data?.store.url ?? s.store.url;
  useEffect(() => {
    if (!qrOpen) return;
    let live = true;
    qrPng(url).then(
      (u) => live && setPng(u),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [qrOpen, url]);
  const text = `Peça na ${s.store.name} pelo site: ${url}`;
  return (
    <Section
      id="compartilhar"
      title="Compartilhar a loja"
      hint="O link, o QR code para o balcão e cartões prontos para o WhatsApp."
    >
      <Card className="space-y-4 p-5">
        <div className="flex items-center gap-2 rounded-md bg-sunken p-2 pl-4">
          <span className="tnum min-w-0 flex-1 truncate font-semibold">
            {url.replace('https://', '')}
          </span>
          <Button
            size="sm"
            variant="secondary"
            icon={<Copy />}
            onClick={() =>
              void navigator.clipboard.writeText(url).then(() => toast('Link copiado'))
            }
          >
            copiar
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={`https://wa.me/?text=${encodeURIComponent(text)}`}
            target="_blank"
            rel="noreferrer"
            className="t-label inline-flex min-h-12 items-center gap-2 rounded-md bg-whatsapp px-4 text-on-whatsapp"
          >
            <WhatsappLogo weight="fill" className="size-5" /> mandar no WhatsApp
          </a>
          <Button variant="secondary" icon={<QrCode />} onClick={() => setQrOpen(true)}>
            QR code
          </Button>
        </div>
      </Card>
      {data?.products.length ? (
        <div className="mt-4">
          <p className="t-label mb-2 px-1">Cartões de produto</p>
          <ul className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2 md:-mx-0 md:px-0">
            {data.products.slice(0, 12).map((p) => (
              <li key={p.id} className="w-40 shrink-0">
                <button
                  type="button"
                  onClick={() =>
                    void shareCard({
                      storeName: s.store.name,
                      name: p.name,
                      priceCents: p.priceCents,
                      imageUrl: p.imageUrl,
                      url: p.url,
                    })
                  }
                  className="block w-full overflow-hidden rounded-md bg-surface text-left depth-1 hover:depth-2"
                  aria-label={`compartilhar ${p.name}`}
                >
                  <span className="block aspect-square bg-sunken">
                    {p.imageUrl ? (
                      <img
                        src={p.imageUrl}
                        alt=""
                        className="size-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <NoPhoto />
                    )}
                  </span>
                  <span className="block p-2">
                    <span className="t-caption block truncate font-semibold">{p.name}</span>
                    <span className="t-caption inline-flex items-center gap-1 text-muted">
                      <ShareNetwork className="size-3.5" /> compartilhar
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <Sheet
        open={qrOpen}
        onOpenChange={setQrOpen}
        title="QR code da loja"
        description="Imprima e deixe no balcão, na embalagem ou no cardápio."
      >
        <div className="flex flex-col items-center gap-4 pt-2">
          <Qr value={url} alt={`QR code para ${url}`} className="size-64 rounded-md" />
          <a
            href={png ?? undefined}
            download={`qr-${s.store.slug}.png`}
            aria-disabled={!png || undefined}
            className="t-label inline-flex min-h-12 items-center rounded-md bg-primary px-5 text-on-primary aria-disabled:opacity-60"
          >
            baixar imagem
          </a>
        </div>
      </Sheet>
    </Section>
  );
}

function Coupons({ coupons }: { coupons: Coupon[] }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const toggle = useMutation({
    mutationFn: (c: Coupon) => api.updateCoupon(c.id, { active: !c.active }),
    onMutate: (c) =>
      optimistic<M>(qc, qk.marketing, (m) => ({
        ...m,
        coupons: m.coupons.map((x) => (x.id === c.id ? { ...x, active: !c.active } : x)),
      })),
    onSuccess: (r, c) => {
      qc.setQueryData(qk.marketing, (m: M | undefined) => (m ? { ...m, coupons: r.coupons } : m));
      toast(c.active ? `${c.code} desativado` : `${c.code} ativo de novo`, {
        undo: () => toggle.mutate({ ...c, active: !c.active }),
      });
    },
    onError: (e, _c, ctx) => {
      ctx?.restore();
      toast.error(messageOf(e));
    },
  });
  return (
    <Section
      title="Cupons"
      action={
        <Button size="sm" icon={<Plus />} onClick={() => setOpen(true)}>
          novo cupom
        </Button>
      }
    >
      {coupons.length ? (
        <Card className="divide-y divide-line">
          {coupons.map((c) => {
            const expired = c.endsAt && new Date(c.endsAt) < new Date();
            return (
              <div
                key={c.id}
                className={cn(
                  'flex items-center gap-3 px-4 py-3',
                  (!c.active || expired) && 'opacity-60',
                )}
              >
                <Ticket weight="duotone" className="size-8 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="tnum font-display font-semibold tracking-wide">{c.code}</p>
                  <p className="t-caption text-muted">
                    {c.displayLabel}
                    {c.minSubtotalCents ? ` · mínimo ${money(c.minSubtotalCents)}` : ''}
                    {c.firstOrderOnly ? ' · só no 1º pedido' : ''}
                    {c.endsAt ? ` · ${expired ? 'venceu' : 'até'} ${dateShort(c.endsAt)}` : ''}
                  </p>
                  <p className="t-caption mt-0.5">
                    <strong>{c.redemptions}</strong> usos
                    {c.maxRedemptions ? ` de ${c.maxRedemptions}` : ''} ·{' '}
                    <strong>{money(c.revenueCents)}</strong> em pedidos
                  </p>
                </div>
                <Toggle
                  checked={c.active}
                  onChange={() => toggle.mutate(c)}
                  label={<span className="sr-only">cupom {c.code} ativo</span>}
                />
              </div>
            );
          })}
        </Card>
      ) : (
        <Card>
          <EmptyState
            art={<Mascote pose="pagamento" />}
            title="Nenhum cupom ainda"
            body="Um cupom de primeira compra é um bom começo: “BEMVINDO” com 10% off."
            action={<Button onClick={() => setOpen(true)}>criar cupom</Button>}
          />
        </Card>
      )}
      <CouponSheet open={open} onOpenChange={setOpen} />
    </Section>
  );
}

function CouponSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const [kind, setKind] = useState<Coupon['kind']>('percent');
  const [pct, setPct] = useState(10);
  const [fixed, setFixed] = useState<number | null>(1000);
  const [min, setMin] = useState<number | null>(null);
  const [first, setFirst] = useState(false);
  const [once, setOnce] = useState(true);
  const [until, setUntil] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () =>
      api.createCoupon({
        code,
        kind,
        ...(kind === 'percent' ? { value: pct } : kind === 'fixed' ? { value: fixed ?? 0 } : {}),
        ...(min ? { minSubtotalCents: min } : {}),
        firstOrderOnly: first,
        ...(once ? { perPhoneLimit: 1 } : {}),
        ...(until ? { endsAt: new Date(`${until}T23:59:59`).toISOString() } : {}),
      }),
    onSuccess: (r) => {
      qc.setQueryData(qk.marketing, (m: M | undefined) => (m ? { ...m, coupons: r.coupons } : m));
      toast(`Cupom ${code.toUpperCase()} criado. Compartilhe!`);
      onOpenChange(false);
      setCode('');
      setErr(null);
    },
    onError: (e) => setErr(messageOf(e)),
  });
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Novo cupom"
      footer={
        <Button
          size="lg"
          block
          loading={create.isPending}
          disabled={code.trim().length < 3}
          onClick={() => create.mutate()}
        >
          criar cupom
        </Button>
      }
    >
      <div className="space-y-5 pt-2">
        <Field
          label="Código"
          htmlFor="cp-code"
          helper="O que o cliente digita. Letras e números."
          error={err}
        >
          <TextInput
            id="cp-code"
            autoCapitalize="characters"
            maxLength={32}
            value={code}
            placeholder="BEMVINDO"
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''))}
            className="font-display tracking-wide"
          />
        </Field>
        <Chips
          label="tipo de desconto"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'percent', label: '% de desconto' },
            { value: 'fixed', label: 'valor fixo' },
            { value: 'free_delivery', label: 'entrega grátis' },
          ]}
        />
        {kind === 'percent' ? (
          <Field label="Desconto">
            <Stepper
              label="porcentagem"
              value={pct}
              min={1}
              max={100}
              step={5}
              suffix="%"
              onChange={setPct}
            />
          </Field>
        ) : kind === 'fixed' ? (
          <Field label="Desconto" htmlFor="cp-fixed">
            <MoneyField id="cp-fixed" cents={fixed} onCommit={setFixed} min={1} />
          </Field>
        ) : null}
        <Field label="Pedido mínimo" optional htmlFor="cp-min">
          <MoneyField id="cp-min" allowEmpty cents={min} onCommit={setMin} />
        </Field>
        <Field label="Vale até" optional htmlFor="cp-until">
          <TextInput
            id="cp-until"
            type="date"
            value={until}
            onChange={(e) => setUntil(e.target.value)}
          />
        </Field>
        <div className="divide-y divide-line">
          <Toggle checked={first} onChange={setFirst} label="Só no primeiro pedido" />
          <Toggle checked={once} onChange={setOnce} label="Uma vez por cliente" />
        </div>
      </div>
    </Sheet>
  );
}

function Loyalty({ data }: { data: M }) {
  return useFeature('loyalty') ? (
    <LoyaltyCard data={data} />
  ) : (
    <Section title="Cartão fidelidade">
      <PlanLocked feature="loyalty" compact />
    </Section>
  );
}

function LoyaltyCard({ data }: { data: M }) {
  const qc = useQueryClient();
  const saveState = useSaveState();
  const cur = data.loyalty.program;
  const [on, setOn] = useState(!!cur);
  const [stamps, setStamps] = useState(cur?.stampsRequired ?? 10);
  const [kind, setKind] = useState<LoyaltyProgram['reward']['kind']>(cur?.reward.kind ?? 'fixed');
  const [value, setValue] = useState(cur?.reward.value ?? 1500);
  // Core names the reward; words someone gave it stay only while they still describe it
  const rewardOf = (k: typeof kind, v: number): LoyaltyProgram['reward'] =>
    cur?.reward.label && cur.reward.kind === k && cur.reward.value === v
      ? { kind: k, value: v, label: cur.reward.label }
      : { kind: k, value: v };
  const save = (next: { on: boolean; stamps: number; kind: typeof kind; value: number }) => {
    const program: LoyaltyProgram | null = next.on
      ? {
          stampsRequired: next.stamps,
          minOrderCents: 0,
          reward: rewardOf(next.kind, next.kind === 'free_delivery' ? 0 : next.value),
          rewardValidDays: 60,
        }
      : null;
    return saveState
      .track(api.setLoyalty(program))
      .then((r) => {
        qc.setQueryData<M>(qk.marketing, (m) =>
          m ? { ...m, loyalty: { ...m.loyalty, program: r.program } } : m,
        );
        return qc.invalidateQueries({ queryKey: qk.marketing });
      })
      .catch((e) => {
        // back to what the store actually has, not a card that looks saved
        setOn(!!cur);
        setStamps(cur?.stampsRequired ?? 10);
        setKind(cur?.reward.kind ?? 'fixed');
        setValue(cur?.reward.value ?? 1500);
        toast.error(messageOf(e));
        // the plan changed under the screen: the session says so, and the lock shows
        if (isPlanRequired(e)) void qc.invalidateQueries({ queryKey: qk.session });
      });
  };
  return (
    <Section
      title="Cartão fidelidade"
      hint="A cada pedido entregue, o cliente ganha um selo."
      action={<SaveMark state={saveState.state} />}
    >
      <Card className="space-y-4 p-5">
        <Toggle
          checked={on}
          onChange={(v) => {
            setOn(v);
            void save({ on: v, stamps, kind, value });
          }}
          label={
            <span className="inline-flex items-center gap-2">
              <Gift weight="duotone" className="size-6" /> Cartão fidelidade
            </span>
          }
          description={
            !on
              ? 'Desligado.'
              : cur
                ? `Junte ${stamps} selos, ganhe ${cur.reward.displayLabel}.`
                : `Junte ${stamps} selos.`
          }
        />
        {on ? (
          <>
            <Field label="Selos para ganhar">
              <SavedStepper
                label="selos"
                value={stamps}
                min={2}
                max={50}
                onDraft={setStamps}
                onSave={async (v) => save({ on, stamps: v, kind, value })}
              />
            </Field>
            <Chips
              label="prêmio"
              value={kind}
              onChange={(k) => {
                // cents and percent don't convert: R$ 15,00 is not 1500%
                const v = k === kind ? value : k === 'percent' ? 10 : 1500;
                setKind(k);
                setValue(v);
                void save({ on, stamps, kind: k, value: v });
              }}
              options={[
                { value: 'fixed', label: 'valor' },
                { value: 'percent', label: '%' },
                { value: 'free_delivery', label: 'entrega grátis' },
              ]}
            />
            {kind === 'fixed' ? (
              <Field label="Valor do prêmio" htmlFor="ly-val">
                <MoneyField
                  id="ly-val"
                  cents={value}
                  min={100}
                  onCommit={(v) => {
                    setValue(v ?? 0);
                    void save({ on, stamps, kind, value: v ?? 0 });
                  }}
                />
              </Field>
            ) : kind === 'percent' ? (
              <Field label="Desconto do prêmio">
                <SavedStepper
                  label="porcentagem do prêmio"
                  value={Math.min(100, value)}
                  min={5}
                  max={100}
                  step={5}
                  suffix="%"
                  onDraft={setValue}
                  onSave={async (v) => save({ on, stamps, kind, value: v })}
                />
              </Field>
            ) : null}
            <p className="t-caption text-muted">
              {data.loyalty.issued} prêmios ganhos · {data.loyalty.redeemed} usados
            </p>
          </>
        ) : null}
      </Card>
    </Section>
  );
}

function Waitlist({ data }: { data: M }) {
  const s = useSession();
  const qc = useQueryClient();
  const done = useMutation({
    mutationFn: (id: string) => api.waitlistNotified(id),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: qk.marketing });
      void qc.invalidateQueries({ queryKey: qk.home });
      toast(`${r.notified} pessoas marcadas como avisadas`);
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  return (
    <Section title="Lista de espera" hint="Quem pediu para ser avisado quando um produto voltar.">
      {data.waitlist.length ? (
        <div className="space-y-3">
          {data.waitlist.map((w) => {
            const back = availability(w) === 'available';
            return (
              <Card key={w.productId} className="p-4">
                <div className="flex items-center gap-3">
                  <span className="size-12 shrink-0 overflow-hidden rounded-sm bg-sunken">
                    {w.imageUrl ? (
                      <img src={w.imageUrl} alt="" className="size-full object-cover" />
                    ) : (
                      <NoPhoto />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{w.name}</p>
                    <p className="t-caption text-muted">
                      <UsersThree className="mr-1 inline size-4" />
                      {w.waiting} esperando · {back ? 'já voltou!' : 'ainda esgotado'}
                    </p>
                  </div>
                </div>
                <ul className="mt-3 space-y-1">
                  {w.contacts.slice(0, 6).map((c) => (
                    <li key={c.contact} className="flex items-center justify-between gap-2">
                      <span className="tnum t-body">{phone(c.contact)}</span>
                      <a
                        href={
                          whatsappUrl(
                            c.contact,
                            `Oi! Aqui é da ${s.store.name}. ${w.name} voltou! Corre que é por pouco tempo: ${s.store.url}`,
                          ) ?? undefined
                        }
                        target="_blank"
                        rel="noreferrer"
                        className="t-label inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 text-success hover:bg-hover"
                      >
                        <WhatsappLogo weight="fill" className="size-5" /> avisar
                      </a>
                    </li>
                  ))}
                </ul>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2"
                  loading={done.isPending}
                  onClick={() => done.mutate(w.productId)}
                >
                  já avisei todo mundo
                </Button>
              </Card>
            );
          })}
        </div>
      ) : (
        <DuaNote pose="avatar-pensando" title="Ninguém esperando agora">
          Quando um produto esgota, a loja oferece “me avise quando voltar”.
        </DuaNote>
      )}
    </Section>
  );
}

function Announcement({ data }: { data: M }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(data.announcement?.title ?? '');
  const [body, setBody] = useState(data.announcement?.body ?? '');
  const save = useMutation({
    mutationFn: (a: { title: string; body?: string } | null) => api.setAnnouncement(a),
    onSuccess: (_r, a) => {
      void qc.invalidateQueries({ queryKey: qk.marketing });
      toast(a ? 'Aviso publicado na loja ✓' : 'Aviso retirado');
      if (!a) {
        setTitle('');
        setBody('');
      }
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  return (
    <Section title="Aviso na loja" hint="Uma faixa no topo da loja: promoção, novidade, recado.">
      <Card className="space-y-4 p-5">
        <Field label="Título" htmlFor="an-title">
          <TextInput
            id="an-title"
            maxLength={80}
            placeholder="Ex.: Frete grátis neste fim de semana"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <Field label="Detalhe" optional htmlFor="an-body">
          <TextInput
            id="an-body"
            maxLength={200}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </Field>
        {title.trim() ? (
          <div>
            <p className="t-caption mb-2 font-semibold text-muted">Como fica na loja</p>
            <div className="flex items-start gap-3 rounded-md bg-spark-soft p-3">
              <Megaphone weight="duotone" className="size-6 shrink-0" />
              <div>
                <p className="font-semibold">{title}</p>
                {body ? <p className="t-body text-muted">{body}</p> : null}
              </div>
            </div>
          </div>
        ) : null}
        <div className="flex gap-2">
          {data.announcement ? (
            <Button variant="ghost" onClick={() => save.mutate(null)}>
              tirar da loja
            </Button>
          ) : null}
          <Button
            block
            loading={save.isPending}
            disabled={title.trim().length < 2}
            onClick={() =>
              save.mutate({ title: title.trim(), ...(body.trim() ? { body: body.trim() } : {}) })
            }
          >
            publicar aviso
          </Button>
        </div>
      </Card>
    </Section>
  );
}
