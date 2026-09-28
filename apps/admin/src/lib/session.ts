import { useQuery } from '@tanstack/react-query';
import { createContext, useContext } from 'react';
import { api, type Role, type Session } from './api.ts';
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
    staleTime: 5 * 60_000,
    retry: false,
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
