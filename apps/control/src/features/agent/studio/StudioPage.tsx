import { useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/cn.ts';
import { Page } from '@/components/Page.tsx';
import { tabTriggerClass } from '@/components/ui/controls.tsx';
import { AGENT_TABS } from '../tabs.ts';
import { AgendaArea } from './AgendaArea.tsx';
import { AutonomyArea, useAutonomy } from './AutonomyArea.tsx';
import { EndpointState, TzList } from './bits.tsx';
import { MemoryArea } from './MemoryArea.tsx';
import { PlaybooksArea } from './PlaybooksArea.tsx';
import { RulesArea } from './RulesArea.tsx';
import { obj, str, useSaveSetting, useSettingsMap } from './settings.ts';
import { VoiceArea } from './VoiceArea.tsx';

const SECTIONS = [
  { key: 'autonomia', label: 'autonomia', sub: 'o que ele decide' },
  { key: 'voz', label: 'voz', sub: 'o pitch' },
  { key: 'playbooks', label: 'playbooks', sub: 'modos de trabalho' },
  { key: 'memoria', label: 'memória', sub: 'o que ele lembra' },
  { key: 'agenda', label: 'agenda', sub: 'retornos marcados' },
  { key: 'regras', label: 'regras', sub: 'limites' },
] as const;
type SectionKey = (typeof SECTIONS)[number]['key'];

export default function StudioPage() {
  const [sp, setSp] = useSearchParams();
  const section: SectionKey = SECTIONS.find((s) => s.key === sp.get('s'))?.key ?? 'autonomia';
  const go = (s: SectionKey) => {
    const next = new URLSearchParams(sp);
    if (s === 'autonomia') next.delete('s');
    else next.set('s', s);
    setSp(next);
  };

  // areas mount on first visit and stay mounted (hidden) so unsaved edits survive tab switches
  const [seen, setSeen] = useState<ReadonlySet<SectionKey>>(() => new Set([section]));
  if (!seen.has(section)) setSeen(new Set([...seen, section]));

  const settings = useSettingsMap();
  const { save, pending } = useSaveSetting();
  const autonomyLevel = useAutonomy().data?.level;
  const map = settings.data;

  const marks: Partial<Record<SectionKey, 'off' | 'warn'>> = {};
  if (autonomyLevel === 'off') marks.autonomia = 'off';
  if (autonomyLevel === 'autopilot') marks.autonomia = 'warn';
  if (map && !str(obj(map.pitch).product, '')) marks.voz = 'warn';

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
    autonomia: () =>
      gated('autonomia', (m) => <AutonomyArea map={m} save={save} pending={pending} />),
    voz: () => gated('voz', (m) => <VoiceArea map={m} save={save} pending={pending} />),
    playbooks: () =>
      gated('playbooks', (m) => (
        <PlaybooksArea map={m} save={save} active={section === 'playbooks'} />
      )),
    memoria: () => (
      <MemoryArea
        map={map}
        gate={gated('memória clássica', () => null)}
        save={save}
        active={section === 'memoria'}
      />
    ),
    agenda: () => <AgendaArea active={section === 'agenda'} />,
    regras: () => gated('guardrails', (m) => <RulesArea map={m} save={save} pending={pending} />),
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
      {/* the timezone picker in "regras" reads this datalist */}
      <TzList />
    </Page>
  );
}
