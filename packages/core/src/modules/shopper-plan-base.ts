import type { Sql } from '../platform/db.ts';

// Plano semanal (0127): what the cart reads, apart from shopper-plans.ts (which reads the cart).

/** The cart's plan, while it holds one: its checkout offers the subscription. */
export interface CartPlan {
  id: string;
  name: string;
  weekday: number | null;
}

export const dayOfWeek = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
export const addDays = (date: string, n: number) =>
  new Date(new Date(`${date}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
/** carts.plan_id → the plan, while it is still offered */
export async function cartPlanTx(
  tx: Sql,
  tenantId: string,
  planId: string | null | undefined,
): Promise<CartPlan | null> {
  if (!planId) return null;
  const [p] = await tx<CartPlan[]>`
    select id, name, weekday from shopper_plans
    where tenant_id = ${tenantId} and id = ${planId} and active`;
  return p ?? null;
}
