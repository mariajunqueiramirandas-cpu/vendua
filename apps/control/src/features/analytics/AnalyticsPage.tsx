import { useSearchParams } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import type { AnalyticsDays } from '@/lib/api.ts';
import { Page } from '@/components/Page.tsx';
import { Segmented } from '@/components/ui/controls.tsx';
import { PIPELINE_TABS } from '@/features/pipeline/tabs.ts';
import { StoresView } from './StoresView.tsx';
import { WebView } from './WebView.tsx';

type View = 'site' | 'painel' | 'lojas';

const VIEWS = [
  ['site', 'site'],
  ['painel', 'painel'],
  ['lojas', 'lojas'],
] as const;

const DAYS = [
  ['7', '7d'],
  ['30', '30d'],
  ['90', '90d'],
] as const;

const NOTE: Record<View, string> = {
  site: 'sem cookies e sem IP guardado: um visitante é um hash com chave trocada (e apagada) todo dia',
  painel:
    'sem cookies e sem saber quem está logado: ids, telefones e pedidos saem do endereço antes de enviar',
  lojas:
    'funil da loja por sessão da aba, sem cookies; nome e telefone de clientes nunca entram no evento',
};

export default function AnalyticsPage() {
  const [sp, setSp] = useSearchParams();
  const p = sp.get('p');
  const view: View = p === 'painel' || p === 'lojas' ? p : 'site';
  const d = Number(sp.get('dias'));
  const days: AnalyticsDays = d === 7 || d === 90 ? d : 30;
  const set = (k: string, v: string | null) =>
    setSp(
      (prev) => {
        const n = new URLSearchParams(prev);
        if (v == null) n.delete(k);
        else n.set(k, v);
        return n;
      },
      { replace: true },
    );

  const toolbar = (
    <div className="flex items-center gap-2">
      <Segmented
        size="sm"
        value={view}
        onChange={(v) => set('p', v === 'site' ? null : v)}
        options={VIEWS}
      />
      <Segmented
        size="sm"
        className="ml-auto"
        value={String(days) as '7' | '30' | '90'}
        onChange={(v) => set('dias', v === '30' ? null : v)}
        options={DAYS}
      />
    </div>
  );

  return (
    <Page title="Pipeline" tabs={PIPELINE_TABS} toolbar={toolbar}>
      <div className="flex flex-col gap-3">
        {view === 'lojas' ? (
          <StoresView days={days} />
        ) : (
          <WebView property={view === 'painel' ? 'admin' : 'site'} days={days} />
        )}
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="mt-px size-3.5 shrink-0" aria-hidden />
          {NOTE[view]}
        </p>
      </div>
    </Page>
  );
}
