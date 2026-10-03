import { useQuery } from '@tanstack/react-query';
import { createContext, useContext } from 'react';
import { api, ApiError, type PlanFeature, type Role, type Session } from './api.ts';
import { qk } from './query.ts';

const RANK: Record<Role, number> = { attendant: 1, manager: 2, owner: 3 };
export const can = (role: Role | undefined, min: Role) => !!role && RANK[role] >= RANK[min];

export const ROLE_LABEL: Record<Role, string> = {
  owner: 'dono',
  manager: 'gerente',
  attendant: 'atendente',
};

export function useSessionQuery() {
  return useQuery({
    queryKey: qk.session,
    queryFn: api.session,
    staleTime: 30_000,
    // the restored copy (persist.ts) may outlive its cookie — a redeploy with fresh
    // volumes — so every boot checks it against Core instead of trusting its age
    refetchOnMount: 'always',
    // a 401 answers at once (sign-in); a blip (network, 5xx mid-deploy) gets a second try
    retry: (n, e) => n < 2 && !(e instanceof ApiError && e.status >= 400 && e.status < 500),
    // signed out there is nothing to refresh, and a refetch would reset the sign-in
    // halfway (the merchant switched to WhatsApp for the code and came back)
    refetchOnWindowFocus: (q) => q.state.data !== undefined,
    refetchOnReconnect: (q) => q.state.data !== undefined,
  });
}

export const SessionCtx = createContext<Session | null>(null);

export function useSession(): Session {
  const s = useContext(SessionCtx);
  if (!s) throw new Error('useSession outside the signed-in shell');
  return s;
}

export function useCan(min: Role) {
  return can(useSession().user.role, min);
}

/** Open right now (Core's session.plan). A cache from before Core said so counts as open:
 *  the gated endpoints still answer PLAN_REQUIRED, and the screen locks then. */
export const featureOpen = (s: Session, f: PlanFeature) => s.plan?.features?.[f] !== false;

export function useFeature(f: PlanFeature) {
  return featureOpen(useSession(), f);
}

/** Core's 403 for a feature the plan doesn't have (or hasn't paid for yet). */
export const isPlanRequired = (e: unknown): e is ApiError =>
  e instanceof ApiError && e.code === 'PLAN_REQUIRED';
