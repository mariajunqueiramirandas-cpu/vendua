import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { AgentConfig } from '@/lib/api.ts';
import { useBottomBar } from '@/lib/bottomBar.ts';
import { cn } from '@/lib/cn.ts';
import { useAgentConfig } from '@/lib/queries.ts';
import { Page } from '@/components/Page.tsx';
import { Button } from '@/components/ui/button.tsx';
import { AgentStatusPill } from '../AgentStatusPill.tsx';
import { EndpointState, TzList, useDraft } from './bits.tsx';
import {
  obj,
  str,
  tzValid,
  useSaveSetting,
  useSettingsMap,
  type SettingsMap,
  type SettingWrite,
} from './settings.ts';
import { AGENT_TABS } from '../tabs.ts';
import { AutonomyPanel } from './AutonomyPanel.tsx';
import { guardrailsOf, LimitsPanel } from './LimitsPanel.tsx';
import { MemoryPanel } from './MemoryPanel.tsx';
import { ReadinessBar } from './ReadinessBar.tsx';
import { VoicePanel, type VoiceDraft } from './VoicePanel.tsx';

const ANCHORS = [
  { key: 'autonomia', label: 'autonomia', id: 'sec-autonomia' },
  { key: 'voz', label: 'voz e instruções', id: 'sec-voz' },
  { key: 'limites', label: 'limites e ritmo', id: 'sec-limites' },
  { key: 'descoberta', label: 'descoberta', id: 'sec-descoberta' },
  { key: 'memoria', label: 'memória', id: 'sec-memoria' },
] as const;

const LEGACY_SECTION: Record<string, string> = {
  agente: 'autonomia',
  playbooks: 'voz',
  regras: 'limites',
};

const voiceOf = (pitch: Record<string, unknown>): VoiceDraft => ({
  product: str(pitch.product, ''),
  offer: str(pitch.offer, ''),
  audience: str(pitch.audience, ''),
  tone: str(pitch.tone, ''),
  offerRange: str(pitch.offerRange, ''),
  goal: str(pitch.goal, ''),
});

/**
 * Agente → Configurar: single flat page (no nested tab bar) with sticky section outline
 * and one unified save bar across autonomy, voice/instructions, and limits.
 */
export default function ConfigPage() {
  const [sp, setSp] = useSearchParams();
  const settings = useSettingsMap();
  const agentQ = useAgentConfig();
  const { save, pending } = useSaveSetting();

  const rawSection = sp.get('s') ?? '';
  const targetKey = LEGACY_SECTION[rawSection] ?? rawSection;

  const jump = (key: string) => {
    const entry = ANCHORS.find((a) => a.key === key);
    if (!entry) return;
    document.getElementById(entry.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const next = new URLSearchParams(sp);
    if (key === 'autonomia') next.delete('s');
    else next.set('s', key);
    setSp(next, { replace: true });
  };

  useEffect(() => {
    if (!targetKey || !settings.data || !agentQ.data) return;
    const entry = ANCHORS.find((a) => a.key === targetKey);
    if (!entry) return;
    const t = setTimeout(
      () => document.getElementById(entry.id)?.scrollIntoView({ block: 'start' }),
      40,
    );
    return () => clearTimeout(t);
  }, [targetKey, settings.data, agentQ.data]);

  return (
    <Page title="Agente" tabs={AGENT_TABS} actions={<AgentStatusPill />}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-5">
        <nav
          aria-label="seções de configuração"
          className="no-scrollbar flex gap-1 overflow-x-auto pb-1 lg:sticky lg:top-0 lg:w-40 lg:shrink-0 lg:flex-col lg:overflow-visible lg:pb-0"
        >
          {ANCHORS.map((a) => (
            <button
              key={a.key}
              type="button"
              onClick={() => jump(a.key)}
              className={cn(
                'inline-flex h-8 shrink-0 items-center rounded-md px-2.5 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-hover hover:text-foreground',
                targetKey === a.key && 'bg-secondary text-foreground',
              )}
            >
              {a.label}
            </button>
          ))}
        </nav>

        <div className="flex min-w-0 flex-1 max-w-4xl flex-col gap-4">
          <ReadinessBar />

          {!settings.data ? (
            <EndpointState
              title="configurações do agente"
              error={settings.error}
              missing="GET /settings ainda não chegou neste servidor — editar sem ler antes apagaria o que já está salvo."
              onRetry={() => void settings.refetch()}
            />
          ) : !agentQ.data ? (
            <EndpointState
              title="autonomia do agente"
              error={agentQ.error}
              missing="GET /agent/config ainda não chegou neste servidor."
              onRetry={() => void agentQ.refetch()}
            />
          ) : (
            <ConfigForm config={agentQ.data} map={settings.data} save={save} pending={pending} />
          )}

          <section id="sec-memoria" className="scroll-mt-4">
            <MemoryPanel />
          </section>
        </div>
      </div>
      <TzList />
    </Page>
  );
}

function ConfigForm({
  config,
  map,
  save,
  pending,
}: {
  config: AgentConfig;
  map: SettingsMap;
  save: (key: string, v: SettingWrite) => Promise<boolean>;
  pending: boolean;
}) {
  const rawPitch = obj(map.pitch);
  const rawGuardrails = obj(map.guardrails);

  const agent = useDraft(config);
  const voice = useDraft(voiceOf(rawPitch));
  const limits = useDraft(guardrailsOf(rawGuardrails));

  const setAgent = (patch: Partial<AgentConfig>) => agent.setEdit({ ...agent.edit, ...patch });

  const tzOk = tzValid(limits.edit.timezone);
  const weeklyUsdBad =
    !Number.isFinite(agent.edit.weeklyDiscoveryUsd) ||
    agent.edit.weeklyDiscoveryUsd < 0 ||
    agent.edit.weeklyDiscoveryUsd > 50;
  const costCapBad =
    !Number.isFinite(limits.edit.leadLifetimeCostCapUsd) ||
    limits.edit.leadLifetimeCostCapUsd < 0 ||
    limits.edit.leadLifetimeCostCapUsd > 1000;
  const tooLong = agent.edit.instructions.length > 8000;
  const invalid = !tzOk || weeklyUsdBad || costCapBad || tooLong;

  const dirty = agent.dirty || voice.dirty || limits.dirty;
  const dirtyNames = [
    agent.dirty && 'autonomia',
    voice.dirty && 'voz',
    limits.dirty && 'limites',
  ].filter(Boolean) as string[];

  const saveAll = async () => {
    if (agent.dirty && !(await save('agent', { ...agent.edit }))) return;
    if (voice.dirty && !(await save('pitch', (c: unknown) => ({ ...obj(c), ...voice.edit }))))
      return;
    if (limits.dirty) await save('guardrails', (c: unknown) => ({ ...obj(c), ...limits.edit }));
  };

  const resetAll = () => {
    agent.reset();
    voice.reset();
    limits.reset();
  };

  return (
    <>
      <section id="sec-autonomia" className="scroll-mt-4">
        <AutonomyPanel liveLevel={config.level} value={agent.edit} onChange={setAgent} />
      </section>

      <section id="sec-voz" className="scroll-mt-4">
        <VoicePanel
          voice={voice.edit}
          onVoice={voice.setEdit}
          instructions={agent.edit.instructions}
          onInstructions={(instructions) => setAgent({ instructions })}
        />
      </section>

      <section id="sec-limites" className="scroll-mt-4">
        <LimitsPanel
          rawGuardrails={rawGuardrails}
          edit={limits.edit}
          onEdit={limits.setEdit}
          agent={agent.edit}
          onAgent={setAgent}
          onSaveRaw={(v) => void save('guardrails', v)}
        />
      </section>

      {dirty && (
        <StickySaveBar
          invalid={invalid}
          pending={pending}
          dirtyNames={dirtyNames}
          onSave={() => void saveAll()}
          onReset={resetAll}
        />
      )}
    </>
  );
}

function StickySaveBar({
  invalid,
  pending,
  dirtyNames,
  onSave,
  onReset,
}: {
  invalid: boolean;
  pending: boolean;
  dirtyNames: string[];
  onSave: () => void;
  onReset: () => void;
}) {
  useBottomBar();
  return (
    <div className="sticky bottom-3 z-20 flex flex-wrap items-center gap-2 rounded-lg border bg-popover px-3 py-2 shadow-pop">
      <Button disabled={invalid || pending} onClick={onSave}>
        {pending ? 'salvando…' : 'salvar alterações'}
      </Button>
      <Button variant="ghost" disabled={pending} onClick={onReset}>
        desfazer
      </Button>
      <span className="ml-auto text-xs text-muted-foreground">
        {invalid ? 'corrija os campos destacados' : `alterado: ${dirtyNames.join(', ')}`}
      </span>
    </div>
  );
}
