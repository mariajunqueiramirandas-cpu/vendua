import { Bell, Moon, Plus, Sun } from '@phosphor-icons/react';
import { useState, type ReactNode } from 'react';
import type { Order, Product } from '../../lib/api.ts';
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
import { ProductTile } from '../../ui/ProductTile.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { STATE_META, StateChip } from '../../ui/StateChip.tsx';
import { Toaster, toast } from '../../ui/Toast.tsx';

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
  status: 'active',
  kind: 'simple',
  stockQuantity: null,
  lowStockThreshold: null,
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
            p={product({ name: 'Bolo de pote', stockQuantity: 2, lowStockThreshold: 3 })}
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

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Section title={title}>
      <div>{children}</div>
    </Section>
  );
}
