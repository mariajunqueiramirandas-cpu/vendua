import type { AiModelsView } from '@/lib/api.ts';
import { Button } from '@/components/ui/button.tsx';
import type { BudgetsDraft } from './draft.ts';
import {
  FieldMsg,
  HintPanel,
  NumField,
  StoreName,
  StorePicker,
  useFieldError,
  useStoreLookup,
} from './bits.tsx';

const keyUsers = (key: string, agents: AiModelsView['agents']) =>
  agents.filter((a) => a.budgetKey === key).map((a) => a.label);

/** one agent: its name; several Duás sharing a cap: just "Duá" (the note says what it sums) */
function keyLabel(key: string, agents: AiModelsView['agents']) {
  const users = keyUsers(key, agents);
  if (users.length > 1 && users.every((l) => l.startsWith('Duá'))) return 'Duá';
  return users.length ? users.join(', ') : key;
}

function BudgetInput({
  path,
  label,
  value,
  placeholder,
  onChange,
}: {
  path: string;
  label: string;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
}) {
  return (
    <NumField
      label={label}
      prefix="US$"
      placeholder={placeholder}
      value={value}
      error={useFieldError('budgets', path)}
      onChange={onChange}
      className="w-full sm:w-72"
    />
  );
}

function PathError({ path }: { path: string }) {
  return <FieldMsg>{useFieldError('budgets', path)}</FieldMsg>;
}

/** USD per store per day, per budget key; empty means no cap. */
export function BudgetsPanel({
  keys,
  agents,
  draft,
  onChange,
}: {
  keys: string[];
  agents: AiModelsView['agents'];
  draft: BudgetsDraft;
  onChange: (next: BudgetsDraft) => void;
}) {
  const stores = useStoreLookup();
  const setTenant = (id: string, values: Record<string, string>) =>
    onChange({
      ...draft,
      tenants: draft.tenants.map((t) => (t.id === id ? { id, value: values } : t)),
    });
  const fallback = (k: string) =>
    draft.defaults[k]?.trim() ? `padrão: ${draft.defaults[k]}` : 'sem teto';

  return (
    <HintPanel title="orçamento diário" hint="gasto máximo de cada loja por dia, em US$" flush>
      <section className="flex flex-col gap-2 p-3">
        <h3 className="text-[13px] font-semibold">padrão para todas as lojas</h3>
        {keys.length ? (
          <div className="flex flex-wrap gap-3">
            {keys.map((k) => (
              <BudgetInput
                key={k}
                path={k}
                label={keyLabel(k, agents)}
                placeholder="sem teto"
                value={draft.defaults[k] ?? ''}
                onChange={(v) => onChange({ ...draft, defaults: { ...draft.defaults, [k]: v } })}
              />
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">nenhum agente tem orçamento</p>
        )}
        <p className="text-xs leading-relaxed text-muted-foreground">
          Vazio é sem teto. No limite, o Duá para de responder naquela loja até a meia-noite
          (horário de Brasília).
          {keys
            .map((k) => ({ k, users: keyUsers(k, agents) }))
            .filter((x) => x.users.length > 1)
            .map((x) => ` Vale um teto só para “${x.users.join('” e “')}”.`)
            .join('')}
        </p>
      </section>

      <section className="flex flex-col gap-2 border-t p-3">
        <div className="flex items-center gap-2">
          <h3 className="text-[13px] font-semibold">por loja</h3>
          <div className="ml-auto">
            <StorePicker
              exclude={new Set(draft.tenants.map((t) => t.id))}
              onPick={(id) =>
                onChange({ ...draft, tenants: [...draft.tenants, { id, value: {} }] })
              }
            />
          </div>
        </div>
        {draft.tenants.length ? (
          <ul className="flex flex-col divide-y rounded-md border">
            {draft.tenants.map((t) => (
              <li key={t.id} className="flex flex-col gap-2 p-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  <StoreName id={t.id} store={stores.get(t.id)} />
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto"
                    onClick={() =>
                      onChange({ ...draft, tenants: draft.tenants.filter((x) => x.id !== t.id) })
                    }
                  >
                    remover
                  </Button>
                </div>
                <div className="flex flex-wrap gap-3">
                  {keys.map((k) => (
                    <BudgetInput
                      key={k}
                      path={`tenants.${t.id}.${k}`}
                      label={keyLabel(k, agents)}
                      placeholder={fallback(k)}
                      value={t.value[k] ?? ''}
                      onChange={(v) => setTenant(t.id, { ...t.value, [k]: v })}
                    />
                  ))}
                </div>
                <PathError path={`tenants.${t.id}`} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">nenhuma loja com orçamento próprio</p>
        )}
        <PathError path="tenants" />
      </section>
    </HintPanel>
  );
}
