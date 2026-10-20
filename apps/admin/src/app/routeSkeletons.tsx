import type { ReactNode } from 'react';
import { cn } from '../ui/cn.ts';
import { PlanCardSkeleton } from '../ui/PlanCard.tsx';
import {
  AppearanceSkeleton,
  CalendarSkeleton,
  FieldSkeleton,
  BoardSkeleton,
  ChatSkeleton,
  KitchenSkeleton,
  ChipsSkeleton,
  DashboardSkeleton,
  DetailSkeleton,
  EditorFrame,
  HeaderSkeleton,
  MenuSkeleton,
  ProductSkeleton,
  ReportsSkeleton,
  RowsSkeleton,
  SectionsSkeleton,
  StatTilesSkeleton,
  TabsSkeleton,
  TilesSkeleton,
} from '../ui/skeletons.tsx';
import { TABS, type Area } from './tabs.ts';

import { matchRoute, type RouteId } from './routes.ts';

// The stand-in while a screen's code loads: that screen's shape, with its real title. Its own
// chunk, fetched as the shell starts (Shell), so the skeletons don't weigh on the first paint.

// PageBody's box, without pulling Page.tsx (and its icons) into the shell
const Body = ({ wide, children }: { wide?: boolean; children: ReactNode }) => (
  <div
    className={cn(
      'mx-auto w-full px-4 pb-32 pt-4 md:px-8 md:pb-16 md:pt-8',
      wide ? 'max-w-[1320px]' : 'max-w-[880px]',
    )}
  >
    {children}
  </div>
);

const page = (
  title: string,
  body: ReactNode,
  opts: { wide?: boolean; subtitle?: boolean; tabs?: [Area, number] } = {},
) => (
  <Body {...(opts.wide ? { wide: true } : {})}>
    <HeaderSkeleton title={title} subtitle={opts.subtitle ?? true} />
    {opts.tabs ? (
      <TabsSkeleton labels={TABS[opts.tabs[0]].map((t) => t.label)} active={opts.tabs[1]} />
    ) : null}
    {body}
  </Body>
);

const SKELETONS: Record<RouteId, () => ReactNode> = {
  home: () => (
    <div className="mx-auto w-full max-w-[1320px] px-4 pb-32 pt-3 md:px-8 md:pb-12 md:pt-8">
      <DashboardSkeleton />
    </div>
  ),
  history: () =>
    page(
      'Pedidos',
      <div className="space-y-4">
        <FieldSkeleton />
        <ChipsSkeleton count={4} />
        <RowsSkeleton rows={7} avatar={false} />
      </div>,
      { subtitle: false, tabs: ['pedidos', 2] },
    ),
  scheduled: () =>
    page(
      'Pedidos',
      <div className="grid gap-5 lg:grid-cols-2">
        <CalendarSkeleton />
        <RowsSkeleton rows={3} avatar={false} />
      </div>,
      { subtitle: false, tabs: ['pedidos', 1] },
    ),
  order: () => page('Pedido', <DetailSkeleton />, { subtitle: false }),
  orders: () => (
    <div className="mx-auto w-full max-w-[1600px] px-4 pb-32 pt-4 md:px-8 md:pb-10 md:pt-8">
      <p className="t-title-1 mb-4 md:mb-6">Pedidos</p>
      <BoardSkeleton />
    </div>
  ),
  kitchen: () => <KitchenSkeleton />,
  pdv: () => (
    <div className="mx-auto w-full max-w-[1600px] px-4 pb-32 pt-4 md:px-6 md:pt-6 lg:px-8">
      <ChipsSkeleton count={3} className="mb-5" />
      <div className="md:grid md:grid-cols-[minmax(0,1fr)_300px] md:gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <FieldSkeleton />
          <ChipsSkeleton count={5} />
          <TilesSkeleton count={8} />
        </div>
        <div className="hidden md:block">
          <SectionsSkeleton />
        </div>
      </div>
    </div>
  ),
  pdvMesas: () => page('Mesas', <TilesSkeleton count={8} />, { wide: true, subtitle: false }),
  pdvQr: () => page('QR das mesas', <TilesSkeleton count={3} />),
  pdvComanda: () => page('Comanda', <DetailSkeleton />, { subtitle: false }),
  pdvCaixa: () =>
    page(
      'Caixa',
      <div className="space-y-4">
        <StatTilesSkeleton count={4} />
        <RowsSkeleton rows={3} avatar={false} />
      </div>,
      { subtitle: false },
    ),
  pdvReport: () => page('Fechamento do caixa', <DetailSkeleton />),
  pickup: () => <KitchenSkeleton pickup />,
  product: () => page('Produto', <ProductSkeleton />, { subtitle: false }),
  menu: () =>
    page('Cardápio', <MenuSkeleton />, { wide: true, subtitle: false, tabs: ['cardapio', 0] }),
  importMenu: () => page('Importar cardápio', <FieldSkeleton />),
  festa: () =>
    page('Cardápio', <RowsSkeleton rows={2} />, {
      wide: true,
      subtitle: false,
      tabs: ['cardapio', 3],
    }),
  planos: () =>
    page('Cardápio', <RowsSkeleton rows={3} />, {
      wide: true,
      subtitle: false,
      tabs: ['cardapio', 4],
    }),
  stock: () =>
    page(
      'Cardápio',
      <div className="space-y-4">
        <ChipsSkeleton count={3} />
        <RowsSkeleton rows={6} />
      </div>,
      { wide: true, subtitle: false, tabs: ['cardapio', 1] },
    ),
  insumos: () =>
    page(
      'Cardápio',
      <div className="space-y-4">
        <ChipsSkeleton count={3} />
        <RowsSkeleton rows={6} avatar={false} />
      </div>,
      { wide: true, subtitle: false, tabs: ['cardapio', 2] },
    ),
  store: () => page('Loja', <RowsSkeleton rows={6} />, { wide: true }),
  storeProfile: () => page('Perfil da loja', <SectionsSkeleton />),
  storeHours: () => page('Horários', <SectionsSkeleton />),
  storeDelivery: () => page('Entrega e retirada', <SectionsSkeleton />),
  storePrep: () => page('Tempo de preparo', <SectionsSkeleton />),
  storeEncomendas: () => page('Encomendas', <SectionsSkeleton />),
  storeSite: () => page('Site e endereço', <SectionsSkeleton />),
  payments: () => page('Pagamentos', <SectionsSkeleton columns={2} />, { wide: true }),
  paymentMethods: () =>
    page('Formas de pagamento', <SectionsSkeleton columns={2} />, { wide: true }),
  whatsapp: () => page('WhatsApp', <SectionsSkeleton columns={2} />, { wide: true }),
  printers: () => page('Impressoras', <SectionsSkeleton columns={2} />, { wide: true }),
  customer: () => page('Cliente', <DetailSkeleton />),
  customers: () =>
    page(
      'Clientes',
      <div className="space-y-4">
        <StatTilesSkeleton count={3} className="mb-1" />
        <FieldSkeleton />
        <RowsSkeleton rows={6} />
      </div>,
    ),
  marketing: () =>
    page('Marketing', <SectionsSkeleton />, { subtitle: false, tabs: ['marketing', 0] }),
  marketingShare: () =>
    page('Marketing', <SectionsSkeleton />, { subtitle: false, tabs: ['marketing', 1] }),
  marketingReminders: () =>
    page('Marketing', <SectionsSkeleton />, { subtitle: false, tabs: ['marketing', 2] }),
  bagCard: () => page('Cartão da sacola', <TilesSkeleton count={1} />),
  statusDoDia: () => page('Status do dia', <SectionsSkeleton columns={2} />, { wide: true }),
  appearance: () => (
    <EditorFrame>
      <HeaderSkeleton title="Aparência" subtitle={false} />
      <AppearanceSkeleton />
    </EditorFrame>
  ),
  reports: () => page('Relatórios', <ReportsSkeleton />, { wide: true }),
  team: () => page('Equipe', <RowsSkeleton rows={3} />, { subtitle: false, tabs: ['equipe', 0] }),
  teamActivity: () =>
    page(
      'Equipe',
      <div className="space-y-4">
        <ChipsSkeleton count={4} />
        <RowsSkeleton rows={6} avatar={false} />
      </div>,
      { subtitle: false, tabs: ['equipe', 1] },
    ),
  account: () => page('Conta e plano', <PlanCardSkeleton />, { subtitle: false }),
  profile: () => page('Meu perfil', <SectionsSkeleton />, { subtitle: false, tabs: ['perfil', 0] }),
  profileAlerts: () =>
    page('Meu perfil', <SectionsSkeleton />, { subtitle: false, tabs: ['perfil', 1] }),
  profileDevices: () =>
    page('Meu perfil', <RowsSkeleton rows={3} />, { subtitle: false, tabs: ['perfil', 2] }),
  help: () => page('Ajuda', <RowsSkeleton rows={5} avatar={false} trailing={false} />),
  vendedorHome: () =>
    page(
      'Duá',
      <div className="space-y-4">
        <StatTilesSkeleton count={3} />
        <RowsSkeleton rows={3} />
      </div>,
    ),
  // a journey without the shell's bars, like /bem-vindo
  vendedorTrain: () => page('Treinar', <SectionsSkeleton />, { subtitle: false }),
  vendedorConversations: () =>
    page(
      'Conversas',
      <div className="space-y-4">
        <ChipsSkeleton count={4} />
        <RowsSkeleton rows={7} />
      </div>,
      { wide: true, subtitle: false },
    ),
  vendedorConversation: () => page('Conversa', <DetailSkeleton />, { subtitle: false }),
  vendedorTeach: () =>
    page(
      'Ensinar',
      <div className="space-y-4">
        <FieldSkeleton />
        <RowsSkeleton rows={5} avatar={false} />
      </div>,
    ),
  vendedorEnsaio: () => page('Ensaio', <SectionsSkeleton />),
  vendedorClienteOculto: () => page('Cliente oculto', <SectionsSkeleton />),
  vendedorResults: () => page('Resultados', <ReportsSkeleton />),
  vendedorSettings: () => page('Configurar', <SectionsSkeleton />),
  vendedorTest: () => page('Testar como cliente', <DetailSkeleton />, { subtitle: false }),
  copilot: () => page('Copiloto', <ChatSkeleton />),
};

export default function RouteSkeleton({ pathname }: { pathname: string }) {
  const hit = matchRoute(pathname);
  return hit ? (
    <>{SKELETONS[hit.r.id]()}</>
  ) : (
    <Body>
      <HeaderSkeleton />
      <SectionsSkeleton />
    </Body>
  );
}
