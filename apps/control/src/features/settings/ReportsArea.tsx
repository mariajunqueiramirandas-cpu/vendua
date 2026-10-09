import { useEffect, useState } from 'react';
import { LEAD_STATES, type LeadState } from '@/lib/labels.ts';
import { Button } from '@/components/ui/button.tsx';
import { Panel } from '@/components/ui/card.tsx';
import { Field, Input } from '@/components/ui/input.tsx';
import { ErrorHint, RawJson, SaveBar, SectionHead } from './bits.tsx';
import { num } from './queries.ts';

type Save = (v: Record<string, unknown>) => void;

export function ReportsArea({
  forecast,
  saveForecast,
  saving,
}: {
  forecast: Record<string, unknown>;
  saveForecast: Save;
  saving: string | null;
}) {
  return (
    <section className="max-w-2xl">
      <SectionHead
        title="previsão do pipeline"
        sub="probabilidade de fechar por estágio — multiplica o valor do lead na previsão de relatórios"
      />
      <ForecastForm value={forecast} onSave={saveForecast} saving={saving === 'forecast'} />
    </section>
  );
}

/** Percent defaults mirrored from DEFAULT_FORECAST_PROBABILITIES (core). */
const FORECAST_DEFAULT_PCT: Record<LeadState, number> = {
  lead: 5,
  contacted: 20,
  invited: 60,
  live: 100,
};

function ForecastForm({
  value,
  onSave,
  saving,
}: {
  value: Record<string, unknown>;
  onSave: Save;
  saving: boolean;
}) {
  const stored = (value.probabilities ?? {}) as Record<string, unknown>;
  // stored as 0..1 fractions, edited as %; ×10000/100 keeps decimals through a save round-trip
  const cur = Object.fromEntries(
    LEAD_STATES.map(([k]) => [
      k,
      Math.round(num(stored[k], FORECAST_DEFAULT_PCT[k] / 100) * 10000) / 100,
    ]),
  ) as Record<LeadState, number>;
  const curKey = JSON.stringify(cur);
  const [edit, setEdit] = useState(cur);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setEdit(cur), [curKey]);
  const dirty = JSON.stringify(edit) !== curKey;
  const invalid = LEAD_STATES.some(
    ([k]) => !Number.isFinite(edit[k]) || edit[k] < 0 || edit[k] > 100,
  );

  return (
    <Panel>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {LEAD_STATES.map(([k, label]) => (
          <Field key={k} label={label} htmlFor={`fc-${k}`}>
            <div className="relative">
              <Input
                id={`fc-${k}`}
                type="number"
                inputMode="decimal"
                min={0}
                max={100}
                step="any"
                value={edit[k]}
                className="pr-7 tnum"
                onChange={(e) => setEdit({ ...edit, [k]: Number(e.target.value) })}
              />
              <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-muted-foreground">
                %
              </span>
            </div>
          </Field>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        valor ponderado = valor em aberto no estágio × probabilidade — relatórios
      </p>
      {invalid && <ErrorHint>probabilidades precisam ficar entre 0 e 100%</ErrorHint>}
      <RawJson value={value} onSave={onSave} />
      <SaveBar inCard pinned={dirty}>
        <Button
          disabled={!dirty || invalid || saving}
          onClick={() =>
            onSave({
              ...value,
              probabilities: Object.fromEntries(LEAD_STATES.map(([k]) => [k, edit[k] / 100])),
            })
          }
        >
          salvar previsão
        </Button>
        {dirty && (
          <Button variant="ghost" onClick={() => setEdit(cur)}>
            desfazer
          </Button>
        )}
      </SaveBar>
    </Panel>
  );
}
