import { useQueryClient } from '@tanstack/react-query';
import { NavLink } from 'react-router-dom';
import { api, type Incident } from '../lib/api.ts';
import { qk } from '../lib/query.ts';
import { ROLE_LABEL, useSession } from '../lib/session.ts';
import { Sheet } from '../ui/Sheet.tsx';
import type { NAV } from './nav.ts';
import { intent } from './routes.ts';
import { UserMenu } from './Shell.tsx';
import { resetClient } from '../lib/persist.ts';

export /** "Mais": large tiles with a live hint each (§3.1). */
function MoreSheet({
  open,
  onOpenChange,
  items,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  items: typeof NAV;
}) {
  const qc = useQueryClient();
  const hint = (to: string): string | null => {
    const mk = qc.getQueryData<{ coupons: { active: boolean }[] }>(qk.marketing);
    const pay = qc.getQueryData<{ pix: unknown }>(qk.payments);
    if (to === '/marketing' && mk) {
      const n = mk.coupons.filter((c) => c.active).length;
      return n ? `${n} ${n === 1 ? 'cupom ativo' : 'cupons ativos'}` : 'crie um cupom';
    }
    if (to === '/pagamentos' && pay) return pay.pix ? 'Pix configurado' : 'configure seu Pix';
    const wa = qc.getQueryData<{ state: string }>(qk.whatsapp);
    if (to === '/whatsapp' && wa)
      return wa.state === 'open'
        ? 'avisando seus clientes'
        : ['logged_out', 'banned', 'error'].includes(wa.state)
          ? 'precisa de você'
          : 'avise seus clientes';
    const status = qc.getQueryData<{ incidents: Incident[] }>(qk.helpStatus);
    if (to === '/ajuda' && status?.incidents.some((i) => !i.resolvedAt && i.severity !== 'info'))
      return 'um problema na Venduá agora';
    return HINTS[to] ?? null;
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Mais">
      <ul className="grid grid-cols-2 gap-3 pb-2 pt-1">
        {items.map((n) => (
          <li key={n.to}>
            <NavLink
              to={n.to}
              {...intent(qc, n.to)}
              className="press flex min-h-28 flex-col justify-between rounded-lg bg-sunken p-4 hover:bg-press active:bg-press"
            >
              <n.Icon weight="duotone" className="size-8" />
              <span>
                <span className="block font-semibold">{n.label}</span>
                {hint(n.to) ? (
                  <span className="t-caption block text-muted">{hint(n.to)}</span>
                ) : null}
              </span>
            </NavLink>
          </li>
        ))}
      </ul>
      <div className="mt-3 border-t border-line pt-3">
        <UserMenu />
      </div>
    </Sheet>
  );
}

const HINTS: Record<string, string> = {
  '/clientes': 'quem compra de você',
  '/whatsapp': 'avisos aos clientes',
  '/impressoras': 'comanda na cozinha',
  '/aparencia': 'página e cores',
  '/relatorios': 'vendas e horários',
  '/equipe': 'quem ajuda na loja',
  '/conta': 'plano e endereço',
  '/ajuda': 'fale com a Venduá',
};

export function SwitchStoreSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const s = useSession();
  const qc = useQueryClient();
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Trocar de loja">
      <ul className="space-y-2 pt-1">
        {s.stores.map((st) => (
          <li key={st.id}>
            <button
              type="button"
              disabled={st.id === s.store.id}
              onClick={async () => {
                await api.switchStore(st.id);
                await resetClient(qc);
                window.location.assign('/admin/');
              }}
              className="press-row flex min-h-16 w-full items-center gap-3 rounded-md px-4 text-left ring-1 ring-line hover:bg-hover disabled:bg-spark-soft disabled:ring-spark"
            >
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{st.name}</span>
                <span className="t-caption text-muted">{ROLE_LABEL[st.role]}</span>
              </span>
              {st.id === s.store.id ? (
                <span className="t-caption font-semibold">aberta agora</span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
