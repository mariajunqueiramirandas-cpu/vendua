import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import type { DiscordLevel, DiscordOverview, DiscordSetting } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { Button } from '@/components/ui/button.tsx';
import { Panel } from '@/components/ui/card.tsx';
import { Switch } from '@/components/ui/controls.tsx';
import { Label, Select } from '@/components/ui/input.tsx';
import { SaveBar } from '../bits.tsx';
import { useSaveDiscordSetting } from './queries.ts';

const LEVEL_LABEL: Record<DiscordLevel, string> = {
  off: 'desligado',
  silent: 'silencioso',
  normal: 'normal',
  ping: 'com menção',
};

const HOURS = Array.from({ length: 24 }, (_, h) => h);

/** What each event does in Discord: off, silent, a normal message, or a mention of the team. */
export function EventsPanel({ d }: { d: DiscordOverview }) {
  const save = useSaveDiscordSetting();
  const base = {
    levels: d.setting.levels,
    excerpts: d.setting.excerpts,
    digest: d.setting.digest,
  };
  const baseKey = JSON.stringify(base);
  const [edit, setEdit] = useState(base);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setEdit(base), [baseKey]);
  const dirty = JSON.stringify(edit) !== baseKey;

  const levelOf = (kind: string, fallback: DiscordLevel) => edit.levels[kind] ?? fallback;
  const setLevel = (kind: string, def: DiscordLevel, level: DiscordLevel) => {
    const levels = { ...edit.levels };
    // the default is not stored: a later catalog change of the default still applies
    if (level === def) delete levels[kind];
    else levels[kind] = level;
    setEdit({ ...edit, levels });
  };

  const submit = () => {
    const next: DiscordSetting = { ...d.setting, ...edit };
    save.mutate(next);
  };

  return (
    <Panel title="o que avisar" aside="cada evento, do mais urgente ao resumo">
      <div className="flex flex-col gap-2.5 border-b pb-3">
        <div className="flex items-start gap-2.5">
          <Switch
            id="dc-digest"
            checked={edit.digest.enabled}
            onCheckedChange={(on) => setEdit({ ...edit, digest: { ...edit.digest, enabled: on } })}
          />
          <Label htmlFor="dc-digest" className="flex flex-1 flex-col text-sm">
            <span className="text-foreground">resumo diário no canal resumo</span>
            <span className="text-xs font-normal text-muted-foreground">
              crm, agente, vendas, assinaturas, frota e sistema das últimas 24h
            </span>
          </Label>
          <Select
            aria-label="hora do resumo"
            className="w-24 shrink-0"
            disabled={!edit.digest.enabled}
            value={String(edit.digest.hour)}
            onChange={(e) =>
              setEdit({ ...edit, digest: { ...edit.digest, hour: Number(e.target.value) } })
            }
          >
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, '0')}:00
              </option>
            ))}
          </Select>
        </div>
        <div className="flex items-start gap-2.5">
          <Switch
            id="dc-excerpts"
            checked={edit.excerpts}
            onCheckedChange={(on) => setEdit({ ...edit, excerpts: on })}
          />
          <Label htmlFor="dc-excerpts" className="flex flex-col text-sm">
            <span className="text-foreground">mostrar trechos das conversas</span>
            <span className="text-xs font-normal text-muted-foreground">
              respostas de leads e rascunhos do agente aparecem no Discord; desligado, o aviso só
              diz quem e onde
            </span>
          </Label>
        </div>
      </div>

      <div className="grid gap-x-6 md:grid-cols-2">
        {d.catalog.categories.map((cat) => {
          const kinds = d.catalog.kinds.filter((k) => k.category === cat.key);
          if (!kinds.length) return null;
          return (
            <section key={cat.key} className="min-w-0 pt-3" aria-label={cat.label}>
              <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold">
                <span aria-hidden>{cat.emoji}</span> {cat.label}
              </h3>
              <ul className="flex flex-col">
                {kinds.map((k) => {
                  const level = levelOf(k.kind, k.level);
                  const changed = level !== k.level;
                  return (
                    <li
                      key={k.kind}
                      className="flex items-center gap-2 border-b py-1.5 last:border-0"
                    >
                      <div className="min-w-0 flex-1">
                        <div
                          className={cn(
                            'truncate text-sm',
                            level === 'off' && 'text-muted-foreground',
                          )}
                        >
                          {k.label}
                        </div>
                        {(k.hint || k.follows) && (
                          <p
                            className="truncate text-xs text-muted-foreground"
                            title={k.hint ?? ''}
                          >
                            {k.follows
                              ? 'atualiza o cartão; o nível vale para o aviso extra'
                              : k.hint}
                          </p>
                        )}
                      </div>
                      {changed && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          title={`voltar ao padrão (${LEVEL_LABEL[k.level]})`}
                          aria-label={`voltar ${k.label} ao padrão`}
                          onClick={() => setLevel(k.kind, k.level, k.level)}
                        >
                          <RotateCcw />
                        </Button>
                      )}
                      <Select
                        aria-label={`nível de ${k.label}`}
                        className={cn('w-36 shrink-0', changed && '[&_select]:border-primary/50')}
                        value={level}
                        onChange={(e) => setLevel(k.kind, k.level, e.target.value as DiscordLevel)}
                      >
                        {d.catalog.levels.map((l) => (
                          <option key={l} value={l}>
                            {LEVEL_LABEL[l]}
                          </option>
                        ))}
                      </Select>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        críticos (incidente crítico, canal caído, chargeback) mencionam o cargo mesmo em “normal”.
        Silenciar uma categoria por um tempo: <code className="text-[11px]">/silenciar</code> no
        Discord.
      </p>

      <SaveBar inCard pinned={dirty}>
        <Button disabled={!dirty || save.isPending} onClick={submit}>
          salvar avisos
        </Button>
        {dirty && (
          <Button variant="ghost" onClick={() => setEdit(base)}>
            desfazer
          </Button>
        )}
      </SaveBar>
    </Panel>
  );
}
