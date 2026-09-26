import { useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/cn.ts';
import { Page } from '@/components/Page.tsx';
import { tabTriggerClass } from '@/components/ui/controls.tsx';
import { AGENT_TABS } from '../tabs.ts';
import { AgendaArea } from './AgendaArea.tsx';
import { AgentArea, useAgentConfig } from './AgentArea.tsx';
import { EndpointState, TzList } from './bits.tsx';
import { LimitsArea } from './LimitsArea.tsx';
import { MemoryArea } from './MemoryArea.tsx';
import { obj, str, useSaveSetting, useSettingsMap } from './settings.ts';

const SECTIONS = [
  { key: 'agente', label: 'agente', sub: 'autonomia, voz e instruções' },
  { key: 'limites', label: 'limites', sub: 'o que o código impõe' },
  { key: 'memoria', label: 'memória', sub: 'o que ele lembra' },
  { key: 'agenda', label: 'agenda', sub: 'rotinas e retornos marcados' },
] as const;
type SectionKey = (typeof SECTIONS)[number]['key'];
// pre-ADR-0015 links (?s=autonomia|voz|playbooks|regras) land on their new home
const LEGACY: Record<string, SectionKey> = {
  autonomia: 'agente',
  voz: 'agente',
  playbooks: 'agente',
  regras: 'limites',
};

export default function StudioPage() {
  const [sp, setSp] = useSearchParams();
  const raw = sp.get('s') ?? '';
  const section: SectionKey = SECTIONS.find((s) => s.key === raw)?.key ?? LEGACY[raw] ?? 'agente';
  const go = (s: SectionKey) => {
    const next = new URLSearchParams(sp);
    if (s === 'agente') next.delete('s');
    else next.set('s', s);
    setSp(next);
  };

  // areas mount on first visit and stay mounted (hidden) so unsaved edits survive tab switches
  const [seen, setSeen] = useState<ReadonlySet<SectionKey>>(() => new Set([section]));
  if (!seen.has(section)) setSeen(new Set([...seen, section]));

  const settings = useSettingsMap();
  const { save, pending } = useSaveSetting();
  const autonomyLevel = useAgentConfig().data?.level;
  const map = settings.data;

  const marks: Partial<Record<SectionKey, 'off' | 'warn'>> = {};
  if (autonomyLevel === 'off') marks.agente = 'off';
  if (autonomyLevel === 'autopilot' || (map && !str(obj(map.pitch).product, '')))
    marks.agente = 'warn';

  // PUT sends the whole setting — forms render only once the map is live, or a save erases stored data
  const gated = (title: string, body: (m: NonNullable<typeof map>) => ReactNode) =>
    map ? (
      body(map)
    ) : (
      <EndpointState
        title={title}
        error={settings.error}
        missing="GET /settings ainda não chegou neste servidor — mexer aqui sem ler antes apagaria o que já está salvo."
        onRetry={() => void settings.refetch()}
      />
    );

  const areas: Record<SectionKey, () => ReactNode> = {
    agente: () => gated('agente', (m) => <AgentArea map={m} save={save} pending={pending} />),
    limites: () => gated('limites', (m) => <LimitsArea map={m} save={save} pending={pending} />),
    memoria: () => (
      <MemoryArea
        map={map}
        gate={gated('memória clássica', () => null)}
        save={save}
        active={section === 'memoria'}
      />
    ),
    agenda: () => <AgendaArea active={section === 'agenda'} />,
  };

  return (
    <Page title="Agente" tabs={AGENT_TABS}>
      <nav
        aria-label="áreas do estúdio"
        className="no-scrollbar sticky top-0 z-20 -mx-3 -mt-3 mb-3 flex items-center gap-1 overflow-x-auto border-b bg-background px-1.5 md:-mx-4 md:-mt-4 md:px-2.5"
      >
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            type="button"
            title={s.sub}
            aria-current={section === s.key ? 'page' : undefined}
            data-state={section === s.key ? 'active' : 'inactive'}
            onClick={() => go(s.key)}
            className={tabTriggerClass}
          >
            {s.label}
            {marks[s.key] && (
              <span
                aria-label={marks[s.key] === 'warn' ? 'pede atenção' : 'desligado'}
                className={cn(
                  'size-1.5 rounded-full',
                  marks[s.key] === 'warn' ? 'bg-warning' : 'bg-border-strong',
                )}
              />
            )}
          </button>
        ))}
        <Link
          to="/config"
          className="ml-auto inline-flex h-9 shrink-0 items-center gap-1 px-2.5 text-xs text-muted-foreground hover:text-foreground"
        >
          config <ArrowUpRight className="size-3.5" />
        </Link>
      </nav>
      {SECTIONS.map(
        (s) =>
          seen.has(s.key) && (
            <section key={s.key} hidden={section !== s.key} aria-label={s.label}>
              {areas[s.key]()}
            </section>
          ),
      )}
      {/* the timezone picker in "limites" reads this datalist */}
      <TzList />
    </Page>
  );
}
