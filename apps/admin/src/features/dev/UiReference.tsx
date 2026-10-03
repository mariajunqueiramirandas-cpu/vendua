import {
  Bell,
  BookOpen,
  ChatText,
  Lightning,
  CaretLeft,
  EnvelopeSimple,
  Moon,
  Plus,
  Sun,
  WhatsappLogo,
} from '@phosphor-icons/react';
import { useState, type ReactNode } from 'react';
import type { Order, Plan, Product, Session } from '../../lib/api.ts';
import { setTheme } from '../../lib/theme.ts';
import { Button, IconButton } from '../../ui/Button.tsx';
import { Card, Section } from '../../ui/Card.tsx';
import { ColumnChart, Funnel, Heatmap, RankBars, Sparkline } from '../../ui/charts.tsx';
import { DuaNote, EmptyState, Hint, Skeleton } from '../../ui/feedback.tsx';
import {
  FormSectionSkeleton,
  OrderCardSkeleton,
  RowsSkeleton,
  StatTilesSkeleton,
  TilesSkeleton,
} from '../../ui/skeletons.tsx';
import {
  Chips,
  Field,
  MoneyField,
  PhoneInput,
  SaveMark,
  Segmented,
  Stepper,
  TextInput,
  TimeInput,
  Toggle,
} from '../../ui/fields.tsx';
import { HeroCard, type DayPhase } from '../../ui/HeroCard.tsx';
import { HoldButton } from '../../ui/HoldButton.tsx';
import * as Art from '../../ui/illustrations.tsx';
import { Odometer } from '../../ui/Odometer.tsx';
import { OrderCard } from '../../ui/OrderCard.tsx';
import { Ticket } from '../kitchen/Ticket.tsx';
import type { KitchenTicket } from '../../lib/api.ts';
import { ProductTile } from '../../ui/ProductTile.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { STATE_META, StateChip } from '../../ui/StateChip.tsx';
import { Toaster, toast } from '../../ui/Toast.tsx';
import { Notice } from '../../ui/Notice.tsx';
import { CodeInput } from '../../ui/CodeInput.tsx';
import { CopyValue } from '../../ui/CopyValue.tsx';
import { PaymentChip } from '../../ui/PaymentChip.tsx';
import { PixCode } from '../../ui/PixCode.tsx';
import { PlanCardSkeleton } from '../../ui/PlanCard.tsx';
import { PlanCards, PlanCompare, PlanTrialStrip } from '../../ui/PlanPicker.tsx';
import { PlanLocked } from '../../ui/PlanLocked.tsx';
import { SessionCtx } from '../../lib/session.ts';
import { StepFrame } from '../../ui/StepFrame.tsx';
import { OutcomeList, OutcomeRow } from '../../ui/Outcome.tsx';
import { HelpButton } from '../../ui/Page.tsx';
import { PlatformStatus } from '../help/status.tsx';
import type { SummaryCardData } from '../../lib/api.ts';
import {
  ActionReceipt,
  AgentGuide,
  AgentJourney,
  Bubble,
  ChecklistRow,
  CoreReceipt,
  DayMark,
  Discordance,
  EventChip,
  Floor,
  FloorChip,
  GuaranteeChip,
  MiniChat,
  PersonaAvatar,
  ProposalCard,
  ReasonChip,
  SacolaBar,
  SalesFunnel,
  ScoreRing,
  VoiceNote,
} from '../../ui/vendedor/index.ts';

const kitchenTicket = (
  n: number,
  minsAgo: number,
  over: Partial<KitchenTicket> = {},
): KitchenTicket => ({
  id: `k${n}`,
  number: n,
  state: 'preparing',
  mode: 'pickup',
  name: 'Ana',
  notes: null,
  scheduledFor: null,
  placedAt: new Date(now - (minsAgo + 1) * 60_000).toISOString(),
  acceptedAt: new Date(now - minsAgo * 60_000).toISOString(),
  startedAt: new Date(now - minsAgo * 60_000).toISOString(),
  readyAt: null,
  prepMinutes: 25,
  rush: false,
  paid: true,
  payMethod: 'pix',
  version: 3,
  items: [
    {
      id: `k${n}a`,
      name: 'Pudim tradicional',
      qty: 2,
      modifiers: [
        { name: 'Calda extra', qty: 1 },
        { name: 'Sem granulado', qty: 1 },
      ],
      combo: [],
      categoryId: null,
      stationId: null,
      doneAt: null,
    },
    {
      id: `k${n}b`,
      name: 'Kit festa',
      qty: 1,
      modifiers: [],
      combo: [
        { slotName: 'Pudim', name: 'Pudim de coco', qty: 1 },
        { slotName: 'Sacolés', name: 'Sacolé de morango', qty: 4 },
      ],
      categoryId: null,
      stationId: null,
      doneAt: new Date(now - 2 * 60_000).toISOString(),
    },
  ],
  ...over,
});

// The living style reference (/admin/_ui, design spec §7): every component in its
// states over realistic data. It needs no session, so CI screenshots it.

const now = Date.now();
const order = (
  n: number,
  state: Order['state'],
  minsAgo: number,
  over: Partial<Order> = {},
): Order => ({
  id: `o${n}`,
  number: n,
  state,
  customer: { name: 'Ana Paula Ribeiro', phone: '22998761234' },
  delivery: {
    mode: 'delivery',
    neighborhood: 'Centro',
    address: 'Rua das Flores, 120',
    feeCents: 500,
  },
  payment: { provider: 'sandbox', method: 'pix', status: 'pending' },
  items: [
    {
      productId: 'p1',
      slug: 'pudim',
      name: 'Pudim tradicional',
      qty: 2,
      unitPriceCents: 2500,
      modifiers: [{ name: 'Calda de caramelo', priceDeltaCents: 0 }],
      combo: [],
      lineTotalCents: 5000,
    },
    {
      productId: 'p2',
      slug: 'sacole',
      name: 'Sacolé de coco',
      qty: 3,
      unitPriceCents: 600,
      modifiers: [],
      combo: [],
      lineTotalCents: 1800,
    },
  ],
  notes: n % 2 ? 'Sem granulado, por favor' : null,
  scheduledFor: null,
  subtotalCents: 6800,
  deliveryFeeCents: 500,
  discountCents: 0,
  coupon: null,
  totalCents: 7300,
  placedAt: new Date(now - minsAgo * 60_000).toISOString(),
  updatedAt: new Date(now).toISOString(),
  version: 1,
  timeline: [],
  ...over,
});

const product = (over: Partial<Product>): Product => ({
  id: 'p',
  categoryId: 'c',
  slug: 'p',
  name: 'Pudim de leite condensado tradicional',
  description: null,
  priceCents: 2500,
  compareAtPriceCents: null,
  status: 'active',
  // Core serves these; the fixture follows its status
  liveStatus: over.status ?? 'active',
  kind: 'simple',
  stockQuantity: null,
  lowStockThreshold: null,
  lowStock: false,
  requiresPreorder: false,
  preorderLeadDays: 0,
  sort: 0,
  soldOutUntil: null,
  tags: [],
  imageUrl: null,
  dominant: '#e9c98f',
  mediaCount: 0,
  groupCount: 0,
  waiting: 0,
  ...over,
});

export default function UiReference() {
  const [seg, setSeg] = useState('novos');
  const [chip, setChip] = useState('30');
  const [on, setOn] = useState(true);
  const [step, setStep] = useState(30);
  const [cents, setCents] = useState<number | null>(1250);
  const [ph, setPh] = useState('');
  const [sheet, setSheet] = useState(false);
  const [sales, setSales] = useState(34890);
  const [phase, setPhase] = useState<DayPhase>('open');
  const [code, setCode] = useState('12');
  const [plan, setPlan] = useState('bandeira');
  return (
    <div className="mx-auto max-w-6xl space-y-12 px-4 py-8 md:px-8">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <p className="t-caption font-semibold uppercase tracking-widest text-muted">
            venduá · painel da loja
          </p>
          <h1 className="t-title-1">Referência de componentes</h1>
        </div>
        <Button variant="secondary" icon={<Sun />} onClick={() => setTheme('creme')}>
          Creme
        </Button>
        <Button variant="secondary" icon={<Moon />} onClick={() => setTheme('noite')}>
          Noite
        </Button>
      </header>

      <Block title="Tipografia">
        <p className="t-hero">R$ 1.234,56</p>
        <p className="t-display">#128</p>
        <p className="t-title-1">Título de página</p>
        <p className="t-title-2">Título de seção</p>
        <p className="t-moment">Bom dia, Maria</p>
        <p className="t-body-lg">Corpo no celular — 17/26, Figtree.</p>
        <p className="t-body">Corpo no computador — 15/22.</p>
        <p className="t-label">rótulo de botão</p>
        <p className="t-caption text-muted">legenda · há 3 min</p>
      </Block>

      <Block title="Cores">
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          {[
            'bg',
            'surface',
            'sunken',
            'ink',
            'muted',
            'primary',
            'spark',
            'success',
            'warning',
            'danger',
            'info',
            'line-strong',
          ].map((c) => (
            <div key={c} className="overflow-hidden rounded-md ring-1 ring-line">
              <div
                className="h-14"
                style={{ background: `var(--color-${c === 'sunken' ? 'sunken' : c})` }}
              />
              <p className="t-caption p-2">{c}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {(Object.keys(STATE_META) as Order['state'][]).map((s) => (
            <StateChip key={s} state={s} />
          ))}
        </div>
      </Block>

      <Block title="Botões">
        <div className="flex flex-wrap items-center gap-3">
          <Button>aceitar</Button>
          <Button variant="secondary">secundário</Button>
          <Button variant="spark">compartilhar</Button>
          <Button variant="quiet">calmo</Button>
          <Button variant="ghost">fantasma</Button>
          <Button variant="danger">cancelar</Button>
          <Button loading>salvando</Button>
          <Button disabled>desativado</Button>
          <Button size="lg" icon={<Plus weight="bold" />}>
            grande
          </Button>
          <IconButton label="notificações">
            <Bell />
          </IconButton>
        </div>
        <div className="mt-4 max-w-sm">
          <HoldButton onConfirm={() => toast('Confirmado')}>segure para cancelar</HoldButton>
        </div>
      </Block>

      <Block title="Toque e navegação">
        <p className="t-body mb-4 max-w-prose text-muted">
          Sem depender de hover: <code>press</code> encolhe o que é tocado (cards, ícones, botões
          soltos); <code>press-row</code> escurece linhas de lista. No celular, uma tela um nível
          abaixo troca a foto da loja no topo por “voltar”.
        </p>
        <div className="grid gap-4 md:grid-cols-3">
          <button
            type="button"
            className="press t-label rounded-md bg-surface p-5 text-left depth-1"
          >
            press · card
          </button>
          <ul className="overflow-hidden rounded-md bg-surface depth-1">
            {['press-row · linha', 'segunda linha'].map((t) => (
              <li key={t} className="border-b border-line last:border-0">
                <button type="button" className="press-row t-body w-full px-4 py-3 text-left">
                  {t}
                </button>
              </li>
            ))}
          </ul>
          <div className="flex items-center rounded-md bg-bg px-2 ring-1 ring-line">
            <button
              type="button"
              className="press flex h-12 items-center gap-0.5 rounded-full pl-1 pr-3"
            >
              <CaretLeft weight="bold" className="size-6" aria-hidden />
              <span className="t-label">Pedidos</span>
            </button>
          </div>
        </div>
      </Block>

      <Block title="Campos">
        <div className="grid gap-6 md:grid-cols-2">
          <Field
            label="Nome do produto"
            htmlFor="u-name"
            helper="Como aparece no cardápio."
            state="saved"
          >
            <TextInput id="u-name" defaultValue="Pudim de leite" />
          </Field>
          <Field label="Preço" htmlFor="u-price" helper="Aceita 12, 12,5, 12.50 ou R$ 12,50.">
            <MoneyField id="u-price" cents={cents} onCommit={setCents} />
          </Field>
          <Field label="Celular" htmlFor="u-ph">
            <PhoneInput id="u-ph" value={ph} onChange={(v) => setPh(v)} />
          </Field>
          <Field label="Com erro" htmlFor="u-err" error="O preço precisa ser maior que zero.">
            <TextInput id="u-err" aria-invalid defaultValue="0" />
          </Field>
          <Field label="Horário">
            <div className="flex items-center gap-2">
              <TimeInput label="abre" value="09:00" onCommit={() => undefined} />
              <span className="text-muted">às</span>
              <TimeInput label="fecha" value="18:30" onCommit={() => undefined} />
            </div>
          </Field>
          <Field label="Tempo de preparo">
            <Stepper label="tempo" value={step} onChange={setStep} step={5} suffix=" min" />
          </Field>
        </div>
        <div className="mt-6 max-w-md space-y-4">
          <Toggle
            checked={on}
            onChange={setOn}
            label="Entrega"
            description="Nos bairros configurados."
          />
          <Segmented
            label="etapa"
            value={seg}
            onChange={setSeg}
            options={[
              { value: 'novos', label: 'Novos', count: 2 },
              { value: 'preparo', label: 'Em preparo', count: 3 },
              { value: 'prontos', label: 'Prontos', count: 0 },
            ]}
          />
          <Chips
            label="tempo"
            value={chip}
            onChange={setChip}
            options={['15', '30', '45'].map((v) => ({ value: v, label: `${v} min` }))}
          />
          <p className="flex gap-4">
            <SaveMark state="saving" />
            <SaveMark state="saved" />
            <SaveMark state="error" />
          </p>
        </div>
      </Block>

      <Block title="Início: o card vivo">
        <div className="mb-3 flex flex-wrap gap-2">
          <Chips
            label="fase"
            value={phase}
            onChange={setPhase}
            options={(['dawn', 'open', 'paused', 'dusk'] as DayPhase[]).map((p) => ({
              value: p,
              label: p,
            }))}
          />
          <Button variant="secondary" onClick={() => setSales((v) => v + 4200)}>
            + pedido pago
          </Button>
        </div>
        <HeroCard phase={phase}>
          <p className="t-moment">Boa tarde, Maria</p>
          <p
            className={phase === 'dusk' ? 't-label mt-8 text-[#c9d3cd]' : 't-label mt-8 text-muted'}
          >
            Vendas de hoje
          </p>
          <p className="t-hero mt-1">
            <Odometer cents={sales} />
          </p>
          <Sparkline
            values={[12000, 18000, 9000, 22000, 17000, 26000, sales]}
            label="7 dias"
            className="mt-4"
          />
        </HeroCard>
      </Block>

      <Block title="Pedidos">
        <div className="grid gap-4 md:grid-cols-3">
          <OrderCard
            order={order(128, 'placed', 2)}
            now={now}
            acceptTarget={5}
            onAdvance={() => toast('Aceito')}
            onMore={() => undefined}
            onOpen={() => undefined}
            arriving
          />
          <OrderCard
            order={order(127, 'placed', 9)}
            now={now}
            acceptTarget={5}
            onAdvance={() => undefined}
            onMore={() => undefined}
            onOpen={() => undefined}
          />
          <OrderCard
            order={order(126, 'preparing', 18, { delivery: { mode: 'pickup' } })}
            now={now}
            acceptTarget={5}
            onAdvance={() => undefined}
            onMore={() => undefined}
            onOpen={() => undefined}
          />
        </div>
      </Block>

      <Block title="Cozinha">
        <div className="grid items-start gap-4 md:grid-cols-3">
          <Ticket
            ticket={kitchenTicket(131, 6, { state: 'confirmed', startedAt: null })}
            station="all"
            stationName={() => 'Bar'}
            now={now}
            arriving
            onToggle={() => undefined}
            onAction={() => toast('Começou')}
            onMore={() => undefined}
            onUndo={() => undefined}
          />
          <Ticket
            ticket={kitchenTicket(129, 31, {
              rush: true,
              mode: 'delivery',
              name: 'Carlos',
              notes: 'Alergia a amendoim, por favor.',
            })}
            station="all"
            stationName={() => 'Bar'}
            now={now}
            onToggle={() => undefined}
            onAction={() => undefined}
            onMore={() => undefined}
            onUndo={() => undefined}
          />
          <Ticket
            ticket={kitchenTicket(127, 18)}
            station="all"
            stationName={() => 'Bar'}
            now={now}
            bumpAt={now + 3_000}
            onToggle={() => undefined}
            onAction={() => undefined}
            onMore={() => undefined}
            onUndo={() => toast('Voltou para a fila')}
          />
        </div>
      </Block>

      <Block title="Cardápio">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <ProductTile p={product({ name: 'Pudim de leite' })} />
          <ProductTile
            p={product({
              name: 'Pudim de coco',
              status: 'sold_out',
              soldOutUntil: new Date().toISOString(),
            })}
          />
          <ProductTile p={product({ name: 'Kit festa com 4 pudins', kind: 'combo' })} />
          <ProductTile
            p={product({
              name: 'Bolo de pote',
              stockQuantity: 2,
              lowStockThreshold: 3,
              lowStock: true,
            })}
          />
          <ProductTile
            p={product({ name: 'Sacolé de uva', status: 'archived' })}
            selecting
            selected
          />
        </div>
      </Block>

      <Block title="Gráficos">
        <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
          <Card className="p-5">
            <ColumnChart
              title="Vendas por dia"
              summary="R$ 2.340 em 14 dias; melhor dia sábado."
              format={(v) => `R$ ${(v / 100).toFixed(0)}`}
              highlightLast
              data={Array.from({ length: 14 }, (_, i) => ({
                label: `dia ${i + 1}`,
                short: String(i + 1),
                value: [80, 120, 60, 200, 150, 260, 310, 90, 110, 70, 240, 180, 290, 150][i]! * 100,
              }))}
            />
          </Card>
          <Card className="p-5">
            <Funnel
              title="Do olhar ao pedido"
              summary="3,2% de quem visitou fez pedido."
              steps={[
                { label: 'Visitaram', value: 900 },
                { label: 'Viram produto', value: 540 },
                { label: 'Sacola', value: 270 },
                { label: 'Pagamento', value: 180 },
                { label: 'Pediram', value: 29 },
              ]}
            />
          </Card>
          <Card className="p-5">
            <RankBars
              title="Mais vendidos"
              summary="Pudim tradicional lidera."
              format={(v) => `${v}×`}
              rows={[
                { key: 'a', label: 'Pudim tradicional', value: 42, image: null },
                { key: 'b', label: 'Sacolé de coco', value: 30, image: null },
                { key: 'c', label: 'Kit festa', value: 12, image: null },
              ]}
            />
          </Card>
          <Card className="p-5">
            <Heatmap
              title="Horários de pico"
              summary="Sexta às 19h é o horário mais movimentado."
              days={['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']}
              cells={Array.from({ length: 7 * 12 }, (_, i) => ({
                dow: i % 7,
                hour: 10 + Math.floor(i / 7),
                value: Math.round(Math.abs(Math.sin(i * 1.7)) * 9),
              }))}
            />
          </Card>
        </div>
      </Block>

      <Block title="Estados vazios e ilustrações">
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <EmptyState
              art={<Art.ArtBell />}
              title="Nenhum pedido novo agora"
              body="Quando chegar, você ouve o sino."
              action={<Button variant="secondary">divulgar a loja</Button>}
            />
          </Card>
          <Card>
            <EmptyState art={<Art.ArtBox />} title="Seu cardápio está vazio" />
          </Card>
          <Card>
            <EmptyState
              art={<Art.ArtCloudOff />}
              title="Sem conexão"
              body="Mostrando o que já tinha carregado."
            />
          </Card>
        </div>
        <div className="mt-4 grid grid-cols-4 gap-3 text-ink sm:grid-cols-8">
          {Object.entries(Art).map(([k, A]) => (
            <div key={k} className="rounded-md bg-surface p-2 depth-1">
              <A title={k} />
            </div>
          ))}
        </div>
      </Block>

      <Block title="Duá numa nota: estados calmos dentro da tela">
        <div className="grid gap-3 lg:grid-cols-2">
          <DuaNote pose="avatar-feliz" title="Tudo em dia">
            Nada esperando por você agora.
          </DuaNote>
          <DuaNote pose="seguranca">
            Só entra quem tem o código no WhatsApp. Não reconhece um aparelho? Toque em sair nele.
          </DuaNote>
        </div>
      </Block>

      <Block title="Carregando: esqueletos com a forma da tela">
        <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
          <OrderCardSkeleton />
          <RowsSkeleton rows={3} />
          <StatTilesSkeleton count={3} />
          <FormSectionSkeleton fields={2} />
        </div>
        <div className="mt-6">
          <TilesSkeleton count={6} />
        </div>
      </Block>

      <Block title="Carregando, dica, avisos">
        <div className="grid gap-3 md:grid-cols-3">
          <Skeleton className="h-24" delay={0} />
          <Skeleton className="h-24" delay={0} />
          <Skeleton className="h-24" delay={0} />
        </div>
        <Hint id="ui-demo" className="mt-4">
          Segure uma foto para arrastar e mudar a ordem.
        </Hint>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() =>
              toast('Pudim marcado como esgotado hoje', { undo: () => toast('Desfeito') })
            }
          >
            aviso com desfazer
          </Button>
          <Button
            variant="secondary"
            onClick={() => toast.error('Não conseguimos salvar. Tente de novo.')}
          >
            aviso de erro
          </Button>
          <Button variant="secondary" onClick={() => setSheet(true)}>
            abrir folha
          </Button>
        </div>
      </Block>
      <Block title="Pagamento, Pix e cadastro">
        <div className="flex flex-wrap gap-2">
          <PaymentChip payment={{ method: 'pix', status: 'paid', online: true }} />
          <PaymentChip payment={{ method: 'pix', status: 'pending', online: true }} />
          <PaymentChip payment={{ method: 'pix', status: 'pending', online: false }} />
          <PaymentChip payment={{ method: 'card_online', status: 'pending', online: true }} />
          <PaymentChip payment={{ method: 'cash', status: 'pending' }} />
          <PaymentChip payment={{ method: 'card_online', status: 'refunded', online: true }} />
          <PaymentChip payment={{ method: 'pix', status: 'failed', online: true }} />
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Card className="p-5">
            <PixCode
              copyPaste={SAMPLE_PIX}
              amountCents={3990}
              expiresAt={new Date(Date.now() + 25 * 60_000).toISOString()}
            />
          </Card>
          <div className="space-y-4">
            <CopyValue label="Link da loja" value="https://quero-pudim.vendua.com.br" />
            <CopyValue label="Pix copia e cola" value={SAMPLE_PIX} lines={2} />
            <Card className="p-5">
              <p className="t-label mb-3">Código de 6 dígitos</p>
              <CodeInput
                value={code}
                onChange={setCode}
                onComplete={() => toast('Código completo')}
              />
            </Card>
          </div>
        </div>
        <div className="mt-6 space-y-6">
          <PlanTrialStrip
            plan={SAMPLE_PLANS[1]!}
            selected={plan === 'bandeira'}
            onPick={() => setPlan('bandeira')}
          />
          <PlanCards
            plans={SAMPLE_PLANS}
            selected={plan}
            onSelect={setPlan}
            address="sualoja.vendua.com.br"
            badge={(p) => (p.id === 'mirim' ? 'seu plano' : undefined)}
            trial
            wide
            className="pt-2"
          />
          <PlanCompare plans={SAMPLE_PLANS} trial current="mirim" />
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <SessionCtx.Provider value={SAMPLE_SESSION}>
            <PlanLocked feature="kds" plans={SAMPLE_PLANS} />
            <PlanLocked feature="loyalty" plans={SAMPLE_PLANS} compact />
          </SessionCtx.Provider>
          <PlanCardSkeleton />
        </div>
        <Card className="mt-4 p-5 [&_.sticky]:static">
          <StepFrame
            title="Como se chama a sua loja?"
            hint="Aparece no topo da loja e nas mensagens."
            onSubmit={() => toast('Continuar')}
            back={() => undefined}
            focusTitle={false}
          >
            <TextInput aria-label="nome da loja" defaultValue="Quero Pudim" />
          </StepFrame>
        </Card>
      </Block>

      <Block title="Recados na tela e para onde foi">
        <div className="grid gap-3 md:grid-cols-2">
          <Notice tone="danger" title="Ninguém consegue pedir">
            Com retirada e entrega desligadas, a loja não aceita pedidos.
          </Notice>
          <Notice
            tone="warning"
            title="Falta pagar o plano"
            action={
              <Button size="sm" onClick={() => undefined}>
                ver o plano e pagar
              </Button>
            }
          >
            Sua loja abre para pedidos assim que o primeiro pagamento do plano for confirmado.
          </Notice>
          <Notice tone="success" title="Aviso enviado">
            Chegou nos seus 2 aparelhos.
          </Notice>
          <Notice tone="info" title="Sem WhatsApp de reserva por enquanto">
            Hoje os avisos chegam só pelo celular.
          </Notice>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="self-start">
            <OutcomeList label="para onde foi o convite">
              <OutcomeRow
                channel="WhatsApp"
                icon={<WhatsappLogo weight="duotone" />}
                detail={'(22)\u00a098179-5040'}
                state="ok"
                word="enviado"
              />
              <OutcomeRow
                channel="E-mail"
                icon={<EnvelopeSimple weight="duotone" />}
                detail="ana@exemplo.com"
                state="failed"
                word="falhou"
              />
            </OutcomeList>
          </div>
          <div className="space-y-3">
            <PlatformStatus incidents={[]} />
            <PlatformStatus
              incidents={[
                {
                  id: 'i1',
                  title: 'Pagamentos com cartão lentos',
                  body: 'O Mercado Pago está demorando para confirmar. Pix segue normal.',
                  severity: 'degraded',
                  startedAt: new Date(Date.now() - 40 * 60_000).toISOString(),
                  resolvedAt: null,
                },
                {
                  id: 'i2',
                  title: 'Avisos de pedido atrasados',
                  body: null,
                  severity: 'outage',
                  startedAt: new Date(Date.now() - 26 * 3600_000).toISOString(),
                  resolvedAt: new Date(Date.now() - 25 * 3600_000).toISOString(),
                },
              ]}
            />
            <div className="flex items-center gap-2">
              <HelpButton />
              <span className="t-caption text-muted">no topo de cada tela; “?” no teclado</span>
            </div>
          </div>
        </div>
      </Block>
      <VendedorReference />
      <Sheet
        open={sheet}
        onOpenChange={setSheet}
        title="Pausar a loja"
        description="Folha de baixo no celular, painel lateral no computador."
      >
        <p className="t-body py-4">Conteúdo da folha.</p>
      </Sheet>
      <Toaster />
    </div>
  );
}

const SAMPLE_PIX =
  '00020126580014BR.GOV.BCB.PIX0136a1b2c3d4-e5f6-7890-abcd-ef1234567890520400005303986540539.905802BR5920QUERO PUDIM GOURMET6009SAO PAULO62070503***6304ABCD';

const NONE = {
  customDomain: false,
  customSite: false,
  kds: false,
  printing: false,
  loyalty: false,
  vendedor: false,
};
const SAMPLE_PLANS: Plan[] = [
  {
    id: 'mirim',
    name: 'Venduá Mirim',
    priceCents: 6990,
    feeBps: 0,
    features: NONE,
    trialDays: 0,
    recommended: false,
    aiConversations: 0,
    aiTrialConversations: 0,
    available: true,
  },
  {
    id: 'bandeira',
    name: 'Venduá Bandeira',
    priceCents: 16900,
    feeBps: 0,
    features: { ...NONE, kds: true, printing: true, loyalty: true, vendedor: true },
    trialDays: 14,
    recommended: true,
    aiConversations: 250,
    aiTrialConversations: 50,
    available: true,
  },
  {
    id: 'pangolim',
    name: 'Venduá Pangolim',
    priceCents: 44900,
    feeBps: 0,
    features: {
      customDomain: true,
      customSite: true,
      kds: true,
      printing: true,
      loyalty: true,
      vendedor: true,
    },
    trialDays: 0,
    recommended: false,
    aiConversations: 1000,
    aiTrialConversations: 0,
    available: false,
  },
];

// PlanLocked reads the role and the plan from the session; the reference has none
const SAMPLE_SESSION = {
  user: { id: 'u', name: 'Vinícius', phone: '', role: 'owner', email: null, prefs: {} },
  store: { id: 's', slug: 'quero-pudim', name: 'Quero Pudim', logoUrl: null, url: '' },
  stores: [],
  push: { publicKey: null },
  support: { whatsapp: null },
  plan: { id: 'mirim', name: 'Venduá Mirim', features: NONE },
} satisfies Session;

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Section title={title}>
      <div>{children}</div>
    </Section>
  );
}

// Forno da Vila, a fictional pizzeria where Duá sells (sales-agent-ux)
const SUMMARY: SummaryCardData = {
  id: 's1',
  lines: [
    { text: '1× Pizza G ½ Calabresa ½ Frango c/ Catupiry', totalCents: 6200 },
    { text: '1× Coca-Cola 2 L', totalCents: 1400 },
  ],
  subtotalCents: 7600,
  feeCents: 700,
  discountCents: 0,
  discountLabel: null,
  adjustmentCents: 0,
  totalCents: 8300,
  mode: 'delivery',
  address: 'Rua das Acácias, 120',
  eta: '~40 min',
  payment: 'Pix',
  changeForCents: null,
  scheduledFor: null,
  unusual: [],
  test: false,
};
const LONG: SummaryCardData = {
  ...SUMMARY,
  id: 's2',
  lines: Array.from({ length: 58 }, (_, i) => ({
    text: `${(i % 3) + 1}× ${['Pizza G Margherita', 'Esfiha de carne', 'Guaraná lata'][i % 3]}`,
    totalCents: 1290 * ((i % 3) + 1),
  })),
  totalCents: 1_000_000,
  test: true,
};

function VendedorReference() {
  const [owner, setOwner] = useState(false);
  return (
    <>
      <Block title="Duá: as três vozes">
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="flex flex-col gap-1.5 rounded-lg bg-bg p-3 ring-1 ring-line">
            <SacolaBar
              count={2}
              totalCents={8300}
              step="confirmar"
              onOpen={() => toast('a sacola')}
            />
            <DayMark>hoje</DayMark>
            <VoiceNote
              seconds={9}
              time="19:42"
              transcript="Oi, boa noite, queria uma pizza grande metade calabresa metade frango com catupiry e uma coca de dois litros"
            />
            <ActionReceipt onWhy={() => toast('por quê')}>anotou 2 itens na sacola</ActionReceipt>
            <Bubble voice="seller" time="19:42" status="read">
              Boa noite, Carla! Anotei a pizza G meio calabresa, meio frango com catupiry, e a Coca
              2 L. Entrego na Rua das Acácias, 120, como da última vez?
            </Bubble>
            <Bubble voice="in" author="Carla" time="19:43">
              isso
            </Bubble>
            <ActionReceipt onWhy={() => toast('por quê')}>entrega: R$ 7,00 · ~40 min</ActionReceipt>
            <Bubble voice="seller" signed={false} tag="sugestão" time="19:43" status="delivered">
              Quer borda recheada de catupiry por mais R$ 9,00? É a que mais sai com essa pizza.
            </Bubble>
            <Bubble voice="in" author="Carla" time="19:44">
              não, só isso
            </Bubble>
            <CoreReceipt data={SUMMARY} />
            <Bubble voice="you" author="você" time="19:44" status="sent">
              Fecho no Pix, como da outra vez?
            </Bubble>
            <EventChip to="/pedidos/o1284">
              Pedido #1284 feito · Pix enviado · aguardando pagamento
            </EventChip>
            <Bubble voice="seller" draft time="19:45">
              Aqui é uma forma de pagamento por pedido. Prefere Pix ou cartão?
            </Bubble>
            <Bubble voice="you" status="failed" time="19:46">
              Já sai!
            </Bubble>
          </div>
          <div className="flex flex-col gap-4">
            <div className="overflow-hidden rounded-lg ring-1 ring-line">
              {owner ? (
                <Floor
                  variant="owner"
                  onRelease={() => setOwner(false)}
                  suggestions={[
                    'Já sai em 40 min!',
                    'Pode ser no cartão também',
                    'Obrigado, Carla!',
                  ]}
                  onSend={(t) => toast(`enviado: ${t}`)}
                  silenceMin={30}
                  keys
                />
              ) : (
                <Floor variant="agent" onTake={() => setOwner(true)} keys />
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ReasonChip reason="alergia" />
              <ReasonChip reason="reclamação: atraso" />
              <ReasonChip reason="pedido grande" />
              <ReasonChip reason="o cliente pediu uma pessoa" />
              <FloorChip floor="agent" />
              <FloorChip floor="rehearsal" />
              <FloorChip floor="store" />
              <FloorChip floor="agent" waiting />
              <FloorChip floor="muted" />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <GuaranteeChip guaranteed />
              <GuaranteeChip guaranteed={false} />
              <GuaranteeChip guaranteed={false} short />
            </div>
            <div className="flex items-center gap-4">
              <PersonaAvatar size="lg" answering label="Duá está atendendo" />
              <PersonaAvatar size="md" />
              <PersonaAvatar size="md" pose="avatar-feliz" />
              <PersonaAvatar size="md" pose="avatar-ajuda" />
              <PersonaAvatar size="sm" />
              <PersonaAvatar size="xs" />
            </div>
            <CoreReceipt data={LONG} title="Pedido de teste" align="stretch" />
          </div>
        </div>
      </Block>

      <Block title="Duá: provas e resultados">
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="p-4">
            <div className="flex items-center gap-4">
              <ScoreRing value={19} total={20} />
              <div className="min-w-0">
                <p className="font-semibold">pedidos saíram certos</p>
                <p className="t-caption text-muted">
                  Cada cliente de teste tinha um pedido escondido. Comparamos item por item com o
                  que o Duá fechou.
                </p>
              </div>
            </div>
            <div className="mt-3">
              <ChecklistRow state="done" title="Preço certo em todos os pedidos" value="20/20" />
              <ChecklistRow state="done" title="Pedidos por áudio" value="4/4" />
              <ChecklistRow state="done" title="Chamou você quando pediram" value="3/3" />
              <ChecklistRow state="miss" title="Pizza broto" value="0/1" />
              <ChecklistRow state="now" title="Pagando em dinheiro, com troco" value="agora" />
            </div>
          </Card>
          <div className="space-y-2.5">
            <ChecklistRow
              card
              state="done"
              eyebrow="Parte 1"
              title="Conhecer"
              detail="Jeito de falar e o WhatsApp da loja"
              value="pronto"
            />
            <ChecklistRow
              card
              state="now"
              eyebrow="Parte 2 · agora"
              title="Ensinar"
              icon={BookOpen}
              detail="Li sua loja ✓ · falta a entrevista"
              value="3 de 7"
            />
            <ChecklistRow
              card
              state="todo"
              eyebrow="Parte 3"
              title="Testar"
              icon={ChatText}
              detail="Peça para mim e cliente oculto"
              value="a fazer"
            />
            <ChecklistRow
              card
              state="optional"
              eyebrow="Parte 4"
              title="Começar"
              icon={Lightning}
              detail="Quando ele atende e como começa"
              value="a fazer"
            />
          </div>
          <Card className="p-4">
            <p className="t-label mb-3">Da conversa ao pedido</p>
            <SalesFunnel
              steps={[
                { label: 'Conversas', value: 268 },
                { label: 'Montaram sacola', value: 171 },
                { label: 'Viram o resumo', value: 128 },
                { label: 'Fecharam', value: 103 },
              ]}
            />
            <div className="mt-5 flex items-center gap-4">
              <ScoreRing value={12} total={20} size={96} running />
              <p className="t-caption text-muted">rodando: testando 12 de 20…</p>
            </div>
          </Card>
          <Card className="p-4">
            <Discordance
              who="Bruno Lima"
              when="ontem, 20h14"
              shopper="dá pra pagar metade no pix e metade no cartão?"
              draft="Aqui é uma forma de pagamento por pedido. Prefere Pix ou cartão?"
              merchant="Dá sim! Me fala quanto vai em cada um."
              onTeach={() => toast('ensinar')}
              onDismiss={() => toast('ele estava certo')}
            />
          </Card>
        </div>
      </Block>

      <Block title="Duá: o treino">
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-4 overflow-hidden rounded-lg bg-bg pb-4 ring-1 ring-line">
            <AgentJourney
              part="ensinar"
              progress={3 / 7}
              status="3 de 7"
              exit={
                <Button variant="ghost" size="sm" className="min-h-12 text-muted">
                  continuar depois
                </Button>
              }
            />
            <div className="space-y-4 px-4">
              <AgentGuide turn="entrevista-3">
                Anotado! Agora: dá pra pedir pizza com 3 sabores?
              </AgentGuide>
              <ProposalCard
                kind="answer"
                source="Da sua resposta anterior"
                question="Tem estacionamento?"
                answer="Tem, na rua lateral, de graça."
                onAccept={() => toast('ensinado')}
                onEdit={() => toast('editar')}
              />
              <ProposalCard
                kind="rule"
                source="Da entrevista"
                question="Pedidos com mais de 10 pizzas: passe para mim."
                guaranteed
                onAccept={() => toast('ensinado')}
                onEdit={() => toast('editar')}
              />
            </div>
          </div>
          <div className="space-y-4">
            <MiniChat
              label="prévia no WhatsApp"
              lines={[
                { voice: 'in', text: 'oi, vocês entregam?' },
                {
                  voice: 'seller',
                  text: 'Oi, boa tarde! Sou o Duá, assistente virtual da Forno da Vila. Entregamos sim, em 6 bairros. Qual é o seu?',
                },
              ]}
            />
            <MiniChat
              owner
              label="teste · só você vê"
              typing
              lines={[
                { voice: 'you', text: 'oi, entregam no Centro?', time: '16:07' },
                {
                  voice: 'seller',
                  text: 'Oi, boa tarde! Sou o Duá, assistente virtual da Forno da Vila. Entregamos no Centro, sim. O que vai ser?',
                  time: '16:07',
                },
                {
                  voice: 'you',
                  text: 'uma G de calabresa e uma coca 2 L, no pix. rua XV, 210',
                  time: '16:08',
                },
              ]}
            />
          </div>
        </div>
      </Block>
    </>
  );
}
