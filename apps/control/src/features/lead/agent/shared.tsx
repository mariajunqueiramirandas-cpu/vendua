import { RotateCw } from 'lucide-react';
import { ApiError } from '@/lib/api.ts';
import { Button } from '@/components/ui/button.tsx';
import { Hint } from '../Section.tsx';

/** 404 = the API route doesn't exist yet — a real state, not an error. */
export const isMissing = (e: unknown) => e instanceof ApiError && e.status === 404;

export function FetchErr({ what, retry }: { what: string; retry: () => void }) {
  return (
    <Hint className="flex items-center gap-1">
      falha ao ler {what}
      <Button size="sm" variant="ghost" onClick={retry}>
        <RotateCw /> tentar de novo
      </Button>
    </Hint>
  );
}
