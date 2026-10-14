import { useState } from 'react';
import type { ShopperPlan } from '../api.ts';
import { errorCopy, showError, showInfo } from '../errors.ts';
import { usePageTitle } from '../head.ts';
import { useCart, useCopy, useStore } from '../hooks.ts';
import { useNavigateTo } from '../primitives.tsx';
import { useKernel, useQuery } from '../provider.tsx';
import { KERNEL_PATHS } from '../config.ts';
import { formatCents } from '../rules/format.ts';
import { KLink } from '../sdk/sections.tsx';

// Kernel 1.26 — Plano semanal: the store's weekly baskets. Picking one fills the bag with it; the
// yes is given at checkout (`subscribe`), and the store's WhatsApp confirms it. The sum shown is
// Core's at today's prices; each week is priced when Core places it.

/** where the plans live; a store page of the same name wins (router.tsx) */
export const PLANS_PATH = '/planos';

const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

/** "toda sexta", "todo sábado"; null = "toda semana" */
export function everyWeekday(w: number | null): string {
  if (w === null || !WEEKDAYS[w]) return 'toda semana';
  return `${w === 0 || w === 6 ? 'todo' : 'toda'} ${WEEKDAYS[w]}`;
}

export function useShopperPlans() {
  const { api } = useKernel();
  const q = useQuery('plans', () => api.plans().then((r) => r.plans));
  return { plans: q.data ?? [], loading: q.loading && !q.data };
}

export function PlansPage() {
  usePageTitle('Planos semanais');
  const { plans, loading } = useShopperPlans();
  return (
    <main id="main" className="v-page v-plans" data-vendua-page="plans">
      <h1 className="v-page-title">Planos semanais</h1>
      <p className="v-muted v-plans-intro">
        Escolha uma cesta e receba toda semana, no mesmo dia. Pule uma semana ou encerre quando
        quiser, pelo WhatsApp da loja.
      </p>
      {loading ? (
        <div className="v-skeleton-page" aria-busy="true" />
      ) : plans.length === 0 ? (
        <div className="v-panel v-empty" data-part="empty">
          <p>Esta loja ainda não tem planos semanais.</p>
          <KLink href="/" className="v-link-btn">
            Ver o cardápio
          </KLink>
        </div>
      ) : (
        <>
          <ul className="v-plans-list">
            {plans.map((p) => (
              <li key={p.id}>
                <PlanCard plan={p} />
              </li>
            ))}
          </ul>
          <p className="v-muted v-plan-note v-plans-foot">
            O total de cada semana sai com os preços do dia, mais a entrega, e é pago por Pix: o
            código chega pelo WhatsApp com o pedido. Você escolhe a primeira data ao finalizar.
          </p>
        </>
      )}
    </main>
  );
}

function PlanCard({ plan }: { plan: ShopperPlan }) {
  const { cart, mutations } = useCart();
  const { store } = useStore();
  const { vocabulary } = useCopy();
  const go = useNavigateTo();
  const [busy, setBusy] = useState(false);
  const currency = store?.currency ?? 'BRL';
  const bagHasOther = !!cart?.items.length && cart.plan?.id !== plan.id;

  const pick = async () => {
    setBusy(true);
    try {
      const { report } = await mutations.buildPlan(plan.id);
      if (report.skipped.length)
        showInfo(
          'plan',
          report.added ? 'Parte do plano foi para a sacola' : 'Nada disso está disponível agora',
          report.skipped.map((s) => errorCopy(s.code).title).join(' · '),
        );
      go(KERNEL_PATHS.cart);
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="v-panel v-plan" data-part="plan">
      <div className="v-plan-head">
        <h2 className="v-panel-title">{plan.name}</h2>
        <span className="v-plan-day" data-part="day">
          {plan.weekday === null ? 'Toda semana' : everyWeekday(plan.weekday).replace(/^t/, 'T')}
        </span>
      </div>
      {plan.description ? <p className="v-muted">{plan.description}</p> : null}
      <ul className="v-plan-lines">
        {plan.lines.map((l) => (
          <li key={l.productId} className="v-plan-line">
            <strong className="v-num">{l.qty}×</strong> {l.name}
          </li>
        ))}
      </ul>
      <p className="v-plan-total">
        <span className="v-muted">Hoje, por semana</span>{' '}
        <strong className="v-num" data-part="total">
          {formatCents(plan.subtotalCents, currency)}
        </strong>
      </p>
      {bagHasOther ? (
        <p className="v-muted v-plan-note">
          O que já está {vocabulary.inBag} sai para dar lugar ao plano.
        </p>
      ) : null}
      <button
        type="button"
        className="v-btn v-btn-accent v-btn-block"
        data-part="pick"
        disabled={busy}
        onClick={() => void pick()}
      >
        {busy ? 'Montando…' : 'Quero este plano'}
      </button>
    </section>
  );
}
