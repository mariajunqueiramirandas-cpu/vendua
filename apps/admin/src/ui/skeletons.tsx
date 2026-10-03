import type { ReactNode } from 'react';
import { Card } from './Card.tsx';
import { cn } from './cn.ts';
import { Skeleton } from './feedback.tsx';

// Loading states shaped like the screen that's coming (§11): the same grid, cards and rows,
// so nothing jumps when the data lands. The page title is real text when it's known.

/** A line of text that hasn't arrived yet. */
export function Bone({ className, delay }: { className?: string; delay?: number }) {
  return (
    <Skeleton
      className={cn('h-4 rounded-full', className)}
      {...(delay === undefined ? {} : { delay })}
    />
  );
}

export function SkeletonGroup({
  children,
  className,
}: {
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <div role="status" aria-label="carregando" aria-busy className={className}>
      {children}
    </div>
  );
}

export function HeaderSkeleton({ title, subtitle = true }: { title?: string; subtitle?: boolean }) {
  return (
    <div className="mb-5 pt-1.5 md:mb-7">
      {title ? <p className="t-title-1">{title}</p> : <Bone className="h-8 w-48" delay={0} />}
      {subtitle ? <Bone className="mt-3 h-3.5 w-64 max-w-[70%]" /> : null}
    </div>
  );
}

function SectionTitle() {
  return (
    <div className="mb-3 space-y-2 px-1">
      <Bone className="h-5 w-36" />
      <Bone className="h-3 w-52 max-w-[70%]" />
    </div>
  );
}

/** Label + input, the shape of every settings field. */
function FieldBone() {
  return (
    <div className="space-y-2">
      <Bone className="h-3 w-24" />
      <Skeleton className="h-12 rounded-md" />
    </div>
  );
}

export function FormSectionSkeleton({ fields = 3 }: { fields?: number }) {
  return (
    <div>
      <SectionTitle />
      <Card className="space-y-5 p-5">
        {Array.from({ length: fields }, (_, i) => (
          <FieldBone key={i} />
        ))}
      </Card>
    </div>
  );
}

/** Settings-style pages (Loja, Pagamentos, Marketing, Conta): titled sections of fields. */
export function SectionsSkeleton({ columns = 1 }: { columns?: 1 | 2 }) {
  const col = (fields: number[]) => (
    <div className="space-y-8">
      {fields.map((f, i) => (
        <FormSectionSkeleton key={i} fields={f} />
      ))}
    </div>
  );
  return (
    <SkeletonGroup className={cn('grid gap-8 [&>*]:min-w-0', columns === 2 && 'lg:grid-cols-2')}>
      {col([3, 2])}
      {columns === 2 ? col([2, 3]) : null}
    </SkeletonGroup>
  );
}

function RowBone({ avatar, trailing }: { avatar: boolean; trailing: boolean }) {
  return (
    <div className="flex min-h-16 items-center gap-3 px-4 py-3">
      {avatar ? <Skeleton className="size-10 shrink-0 rounded-full" /> : null}
      <div className="min-w-0 flex-1 space-y-2">
        <Bone className="w-2/5" />
        <Bone className="h-3 w-3/5" />
      </div>
      {trailing ? <Bone className="w-16 shrink-0" /> : null}
    </div>
  );
}

/** Customers, history, team, activity: a card of rows. */
export function RowsSkeleton({
  rows = 6,
  avatar = true,
  trailing = true,
  className,
}: {
  rows?: number;
  avatar?: boolean;
  trailing?: boolean;
  className?: string;
}) {
  return (
    <SkeletonGroup className={className}>
      <Card className="divide-y divide-line overflow-hidden">
        {Array.from({ length: rows }, (_, i) => (
          <RowBone key={i} avatar={avatar} trailing={trailing} />
        ))}
      </Card>
    </SkeletonGroup>
  );
}

/** Filter chips / segmented control above a list. */
export function ChipsSkeleton({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div className={cn('flex gap-2 overflow-hidden', className)}>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-10 w-24 shrink-0 rounded-full" />
      ))}
    </div>
  );
}

export function StatTilesSkeleton({
  count = 3,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'grid gap-3',
        count === 4 ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-3',
        className,
      )}
    >
      {Array.from({ length: count }, (_, i) => (
        <Card key={i} className="space-y-2.5 p-4">
          <Bone className="h-7 w-16" />
          <Bone className="h-3 w-20 max-w-full" />
        </Card>
      ))}
    </div>
  );
}

/** The cardápio's photo grid (same columns as ReorderGrid). */
export function TilesSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
      {Array.from({ length: count }, (_, i) => (
        <Card key={i} className="overflow-hidden">
          <Skeleton className="aspect-[4/3] rounded-none" />
          <div className="space-y-2 p-3">
            <Bone className="w-4/5" />
            <Bone className="h-3 w-1/3" />
          </div>
        </Card>
      ))}
    </div>
  );
}

export function MenuSkeleton() {
  return (
    <SkeletonGroup className="space-y-8">
      <ChipsSkeleton count={5} />
      {[6, 4].map((n, i) => (
        <div key={i}>
          <Bone className="mb-3 ml-1 h-6 w-32" />
          <TilesSkeleton count={n} />
        </div>
      ))}
    </SkeletonGroup>
  );
}

export function OrderCardSkeleton({ compact }: { compact?: boolean }) {
  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center gap-3">
        <Bone className="h-6 w-12" />
        <Bone className="w-28" />
        <Bone className="ml-auto h-6 w-16" />
      </div>
      <Bone className="h-3 w-3/4" />
      {compact ? null : (
        <>
          <Bone className="h-3 w-1/2" />
          <Skeleton className="h-12 rounded-md" />
        </>
      )}
    </Card>
  );
}

/** Pedidos: one lane on phones, four on the desktop board. */
export function BoardSkeleton() {
  return (
    <SkeletonGroup>
      <div className="lg:hidden">
        <Skeleton className="mb-4 h-12 rounded-full" delay={0} />
        <div className="grid gap-3 md:grid-cols-2">
          <OrderCardSkeleton />
          <OrderCardSkeleton />
        </div>
      </div>
      <div className="hidden grid-cols-4 gap-4 lg:grid">
        {[2, 1, 1, 2].map((n, i) => (
          <div key={i} className="min-h-[60vh] space-y-3 rounded-lg bg-sunken/60 p-3">
            <div className="mb-3 flex items-center justify-between px-1">
              <Bone className="w-20" />
              <Bone className="h-5 w-7" />
            </div>
            {Array.from({ length: n }, (_, k) => (
              <OrderCardSkeleton key={k} compact={i === 3} />
            ))}
          </div>
        ))}
      </div>
    </SkeletonGroup>
  );
}

/** Cozinha: the top bar, then tickets (or the pickup display's two columns). */
export function KitchenSkeleton({ pickup }: { pickup?: boolean }) {
  return (
    <SkeletonGroup className="flex min-h-dvh flex-col gap-4 p-3 md:p-4">
      <div className="flex items-center gap-3">
        <Skeleton className="size-11 rounded-full" delay={0} />
        <Bone className="h-6 w-32" delay={0} />
        <Bone className="ml-auto h-8 w-24" delay={0} />
      </div>
      {pickup ? (
        <div className="grid flex-1 gap-4 md:grid-cols-2">
          <Skeleton className="rounded-xl" />
          <Skeleton className="rounded-xl" />
        </div>
      ) : (
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr))]">
          {[5, 3, 4, 2].map((n, i) => (
            <Card key={i} className="space-y-3 p-4">
              <div className="flex items-center gap-3">
                <Bone className="h-8 w-16" />
                <Bone className="ml-auto h-6 w-14" />
              </div>
              {Array.from({ length: n }, (_, k) => (
                <Bone key={k} className="h-5 w-4/5" />
              ))}
              <Skeleton className="h-14 rounded-md" />
            </Card>
          ))}
        </div>
      )}
    </SkeletonGroup>
  );
}

/** Início: the hero, then the "precisa de você" and feed cards. */
export function DashboardSkeleton() {
  return (
    <SkeletonGroup className="grid gap-5 lg:grid-cols-[2fr_1fr] lg:items-start lg:gap-6">
      <div className="space-y-5 lg:space-y-6">
        <Skeleton className="h-[340px] rounded-xl" delay={0} />
        <div>
          <SectionTitle />
          <RowsSkeleton rows={3} trailing={false} />
        </div>
      </div>
      <div className="space-y-5 lg:space-y-6">
        <div>
          <SectionTitle />
          <Card className="space-y-3 p-5">
            <Bone className="w-3/4" />
            <Bone className="h-3 w-1/2" />
            <Skeleton className="h-11 rounded-md" />
          </Card>
        </div>
        <div>
          <SectionTitle />
          <RowsSkeleton rows={3} avatar={false} />
        </div>
      </div>
    </SkeletonGroup>
  );
}

/** Relatórios: period chips, the KPI row, then chart cards. */
export function ReportsSkeleton({ chips = true }: { chips?: boolean }) {
  const chart = (
    <Card className="space-y-4 p-5">
      <Bone className="w-40" />
      <div className="flex h-48 items-end gap-2">
        {[40, 65, 50, 80, 35, 90, 60].map((h, i) => (
          <Skeleton
            key={i}
            className="flex-1 rounded-t-md rounded-b-none"
            style={{ height: `${h}%` }}
          />
        ))}
      </div>
    </Card>
  );
  return (
    <SkeletonGroup className="space-y-8">
      {chips ? <ChipsSkeleton count={4} /> : null}
      <StatTilesSkeleton count={4} />
      <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        {chart}
        <Card className="space-y-3 p-5">
          <Bone className="w-32" />
          {[100, 72, 48, 30].map((w, i) => (
            <Skeleton key={i} className="h-9 rounded-md" style={{ width: `${w}%` }} />
          ))}
        </Card>
      </div>
    </SkeletonGroup>
  );
}

/** One order / one customer: summary card, lines, then the next card. */
export function DetailSkeleton() {
  return (
    <SkeletonGroup className="space-y-4">
      <Card className="space-y-3 p-5">
        <div className="flex items-center gap-3">
          <Bone className="h-7 w-24" />
          <Bone className="ml-auto h-7 w-24" />
        </div>
        <Bone className="h-3 w-1/2" />
      </Card>
      <Card className="divide-y divide-line">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3 px-5 py-4">
            <Bone className="h-6 w-8" />
            <Bone className="w-1/2" />
            <Bone className="ml-auto w-16" />
          </div>
        ))}
      </Card>
      <Card className="space-y-3 p-5">
        <Bone className="w-1/3" />
        <Bone className="h-3 w-2/3" />
        <Skeleton className="h-12 rounded-md" />
      </Card>
    </SkeletonGroup>
  );
}

/** One product: photos on the left, its fields on the right. */
export function ProductSkeleton() {
  return (
    <SkeletonGroup className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
      <div className="space-y-3">
        <Skeleton className="aspect-[4/3] rounded-lg" delay={0} />
        <div className="flex gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="size-16 rounded-md" />
          ))}
        </div>
      </div>
      <div className="space-y-8">
        <FormSectionSkeleton fields={3} />
        <FormSectionSkeleton fields={2} />
      </div>
    </SkeletonGroup>
  );
}

/** Aparência: the list of what's on the page, the storefront preview, the settings panel. */
export function AppearanceSkeleton() {
  return (
    <SkeletonGroup>
      <div className="mb-4 flex gap-2">
        <Skeleton className="h-12 flex-1 rounded-full md:max-w-md" delay={0} />
        <Skeleton className="hidden h-12 w-24 rounded-full md:block" />
      </div>
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(320px,380px)] min-[1400px]:grid-cols-[288px_minmax(0,1fr)_380px]">
        <div className="space-y-2 max-[1399px]:hidden">
          {Array.from({ length: 7 }, (_, i) => (
            <Skeleton key={i} className="h-14 rounded-md" />
          ))}
        </div>
        <Skeleton
          className="mx-auto h-[56dvh] w-full rounded-lg md:aspect-[9/19] md:h-auto md:max-w-[340px] md:rounded-[44px]"
          delay={0}
        />
        <Card className="space-y-2 p-4 md:p-5">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-14 rounded-md" />
          ))}
        </Card>
      </div>
    </SkeletonGroup>
  );
}

/** The editor's full-width frame (Aparência, Pedidos use it too). */
export function EditorFrame({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 pb-40 pt-4 md:px-8 md:pb-10 md:pt-8">
      {children}
    </div>
  );
}

/** A search box or a single input. */
export function FieldSkeleton({ className }: { className?: string }) {
  return <Skeleton className={cn('h-12 rounded-md', className)} delay={0} />;
}

/** Encomendas: the month grid. */
export function CalendarSkeleton() {
  return (
    <SkeletonGroup>
      <Card className="p-4">
        <div className="mb-4 flex items-center justify-between">
          <Skeleton className="size-11 rounded-full" />
          <Bone className="h-6 w-36" />
          <Skeleton className="size-11 rounded-full" />
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {Array.from({ length: 35 }, (_, i) => (
            <Skeleton key={i} className="aspect-square rounded-md" />
          ))}
        </div>
      </Card>
    </SkeletonGroup>
  );
}
