import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api.ts';
import { qk } from '@/lib/query.ts';

export const useCustomersOverview = () =>
  useQuery({ queryKey: qk.customersOverview(), queryFn: api.customersOverview });
