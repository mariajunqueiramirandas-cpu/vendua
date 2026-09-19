import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

/** Formatting only — every cent value rendered comes straight from Core. */
export const brl = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

export function cents(v: number): string {
  return brl.format(v / 100);
}

const DAYS = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];

interface Window {
  days: number[];
  open: string;
  close: string;
}

/** "TER–DOM · 18:00–23:30" from Core's hours.windows — display formatting. */
export function windowLines(windows: Window[]): string[] {
  return windows.map((w) => {
    const days = [...w.days].sort((a, b) => a - b);
    // compress contiguous runs (incl. Sun-wrap like [2,3,4,5,6,0])
    const set = new Set(days);
    const label =
      set.size === 7
        ? 'TODO DIA'
        : runs(days)
            .map((r) => (r.length > 1 ? `${DAYS[r[0]!]}–${DAYS[r[r.length - 1]!]}` : DAYS[r[0]!]))
            .join(' ');
    return `${label} · ${w.open}–${w.close}`;
  });
}

function runs(days: number[]): number[][] {
  if (days.length === 0) return [];
  // treat Sun..Sat as a ring so [2..6,0] collapses into "TER–DOM"
  const ring = [...days];
  if (ring.includes(0) && ring.includes(6)) {
    // rotate so the run starting after the gap leads
    const sorted = ring.filter((d) => d !== 0).concat(7); // 7 ≡ DOM
    const out: number[][] = [];
    let cur = [sorted[0]!];
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] === cur[cur.length - 1]! + 1) cur.push(sorted[i]!);
      else {
        out.push(cur);
        cur = [sorted[i]!];
      }
    }
    out.push(cur);
    return out.map((r) => r.map((d) => d % 7));
  }
  const out: number[][] = [];
  let cur = [ring[0]!];
  for (let i = 1; i < ring.length; i++) {
    if (ring[i] === cur[cur.length - 1]! + 1) cur.push(ring[i]!);
    else {
      out.push(cur);
      cur = [ring[i]!];
    }
  }
  out.push(cur);
  return out;
}

/** Days with no service at all → "SEG" style labels. */
export function closedDays(windows: Window[]): string[] {
  const open = new Set(windows.flatMap((w) => w.days));
  return [0, 1, 2, 3, 4, 5, 6].filter((d) => !open.has(d)).map((d) => DAYS[d]!);
}

/** Manifest code: cargo-style line number, e.g. BR·1.02 */
export function ManifestCode({ cat, idx }: { cat: number; idx: number }) {
  return (
    <span className="code mono">
      BR·{cat}.{String(idx + 1).padStart(2, '0')}
    </span>
  );
}

/** Ember-level meter — 1..3 bars lit. */
export function EmberBars({ level }: { level: 1 | 2 | 3 }) {
  return (
    <span className="ember-bars" data-level={level} aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

/** Error plate — maps Core's typed error codes to counter speak. */
export function ErrorPlate({
  error,
  onRetry,
  children,
}: {
  error: { code: string; message: string; details?: Record<string, unknown> } | undefined;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  if (!error) return null;
  const detail = error.details?.minOrderCents;
  const copy: Record<string, string> = {
    ORDER_MIN_NOT_MET:
      typeof detail === 'number'
        ? `pedido mínimo ${cents(detail)} — bota mais carne na chapa`
        : 'pedido abaixo do mínimo',
    OUT_OF_ZONE: 'fora da área de entrega — troca o bairro ou retira na chapa',
    STORE_PAUSED: 'a chapa tá pausada — volta já já',
    STORE_CLOSED: 'a chapa apagou — pedidos só quando reabrir',
    EMPTY_CART: 'comanda vazia — escolhe algo no cardápio',
    MODIFIER_REQUIRED: 'falta marcar o ponto da carne',
    MODIFIER_LIMIT: 'passou do limite de adicionais',
    SOLD_OUT: 'acabou na chapa — esgotado por hoje',
    SESSION_REQUIRED: 'sua sessão caiu — recarrega a página',
    INVALID_CUSTOMER: 'confere nome e telefone',
    INVALID_DELIVERY: 'entrega precisa de bairro e endereço',
    INVALID_PAYMENT: 'escolhe a forma de pagamento',
  };
  const msg = copy[error.code] ?? error.message;
  return (
    <div className="errplate" role="alert">
      <h3>Sem saída da chapa</h3>
      <p>
        {msg} <span className="dim mono">[{error.code}]</span>
      </p>
      {onRetry ? (
        <button type="button" className="retry" onClick={onRetry}>
          Tentar de novo
        </button>
      ) : null}
      {children}
    </div>
  );
}

export function SkeletonRows({ n = 5 }: { n?: number }) {
  return (
    <div aria-busy="true" aria-label="carregando cardápio">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="sk sk-row" style={{ animationDelay: `${i * 120}ms` }} />
      ))}
    </div>
  );
}

/** Error surface for whole-block failures — distinct from inline ErrorPlate. */
export function BoardError({ error }: { error: { code: string; message: string } | undefined }) {
  return (
    <ErrorPlate error={error} onRetry={() => window.location.reload()}>
      {!error ? <Link to="/">voltar ao quadro</Link> : null}
    </ErrorPlate>
  );
}
