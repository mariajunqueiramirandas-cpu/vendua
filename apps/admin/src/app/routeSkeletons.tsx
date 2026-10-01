import type { ReactNode } from 'react';
import { cn } from '../ui/cn.ts';
import { PlanCardSkeleton } from '../ui/PlanCard.tsx';
import {
  AppearanceSkeleton,
  CalendarSkeleton,
  FieldSkeleton,
  BoardSkeleton,
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
} from '../ui/skeletons.tsx';

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
  opts: { wide?: boolean; subtitle?: boolean } = {},
) => (
  <Body {...(opts.wide ? { wide: true } : {})}>
    <HeaderSkeleton title={title} subtitle={opts.subtitle ?? true} />
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
      'Histórico de pedidos',
      <div className="space-y-4">
        <FieldSkeleton />
        <ChipsSkeleton count={4} />
        <RowsSkeleton rows={7} avatar={false} />
      </div>,
      { subtitle: false },
    ),
  scheduled: () =>
    page(
      'Encomendas',
      <div className="grid gap-5 lg:grid-cols-2">
        <CalendarSkeleton />
        <RowsSkeleton rows={3} avatar={false} />
      </div>,
    ),
  order: () => page('Pedido', <DetailSkeleton />, { subtitle: false }),
  orders: () => (
    <div className="mx-auto w-full max-w-[1600px] px-4 pb-32 pt-4 md:px-8 md:pb-10 md:pt-8">
      <p className="t-title-1 mb-4 md:mb-6">Pedidos</p>
      <BoardSkeleton />
    </div>
  ),
  product: () => page('Produto', <ProductSkeleton />, { subtitle: false }),
  menu: () => page('Cardápio', <MenuSkeleton />, { wide: true, subtitle: false }),
  importMenu: () => page('Importar cardápio', <FieldSkeleton />),
  store: () => page('Loja', <SectionsSkeleton columns={2} />, { wide: true }),
  payments: () => page('Pagamentos', <SectionsSkeleton columns={2} />, { wide: true }),
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
  marketing: () => page('Marketing', <SectionsSkeleton columns={2} />, { wide: true }),
  appearance: () => (
    <EditorFrame>
      <HeaderSkeleton title="Aparência" subtitle={false} />
      <AppearanceSkeleton />
    </EditorFrame>
  ),
  reports: () => page('Relatórios', <ReportsSkeleton />, { wide: true }),
  team: () =>
    page(
      'Equipe',
      <div className="grid gap-8 lg:grid-cols-2 [&>*]:min-w-0">
        <RowsSkeleton rows={3} />
        <RowsSkeleton rows={5} avatar={false} />
      </div>,
      { wide: true },
    ),
  account: () => page('Conta e plano', <PlanCardSkeleton />, { subtitle: false }),
  profile: () => page('Meu perfil', <SectionsSkeleton />, { subtitle: false }),
  help: () => page('Ajuda', <RowsSkeleton rows={5} avatar={false} trailing={false} />),
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
