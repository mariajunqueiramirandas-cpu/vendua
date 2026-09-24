import { useState } from 'react';

/** Shared bits for the settings surfaces (Config + Estúdio): the list
 *  editor, the raw-JSON escape hatch, and the coercion/validation helpers
 *  the cards use to mirror validateSetting. */

const TZ_SUGGESTIONS = [
  'America/Sao_Paulo',
  'America/Fortaleza',
  'America/Recife',
  'America/Bahia',
  'America/Manaus',
  'America/Belem',
  'America/Rio_Branco',
];

/** `<datalist id="tz-list">` for the timezone pickers (guardrails, meeting)
 *  — render once per view that mounts a `list="tz-list"` input. */
export function TzList() {
  return (
    <datalist id="tz-list">
      {TZ_SUGGESTIONS.map((t) => (
        <option key={t} value={t} />
      ))}
    </datalist>
  );
}

export const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
export const str = (v: unknown, d: string) => (typeof v === 'string' ? v : d);
// same check validateSetting applies server-side — saves a 422 round-trip
export const tzValid = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

export function ListEditor({
  items,
  placeholder,
  addLabel = 'adicionar',
  max,
  maxLen,
  onChange,
}: {
  items: string[];
  placeholder: string;
  addLabel?: string;
  /** item-count ceiling — matches the backend cap (hardRules 50, facts 100) */
  max?: number;
  /** per-item char cap — backend rejects longer strings */
  maxLen?: number;
  onChange: (items: string[]) => void;
}) {
  const [draft, setDraft] = useState('');
  // Settings come back as untyped jsonb — coerce non-string entries once so
  // they render instead of crashing, and a later save re-sends strings the
  // server-side validator accepts instead of raw jsonb it rejects.
  const norm = items.map((it) => (typeof it === 'string' ? it : JSON.stringify(it)));
  const atMax = max !== undefined && items.length >= max;
  const add = () => {
    const v = draft.trim();
    if (!v || atMax) return;
    onChange([...norm, v]);
    setDraft('');
  };
  return (
    <div>
      <div className="lst">
        {norm.length === 0 && <div className="none">nada por aqui ainda</div>}
        {norm.map((it, i) => (
          <div className="row" key={`${i}-${it.slice(0, 12)}`}>
            <span className="ix">{String(i + 1).padStart(2, '0')}</span>
            <span className="tx">{it}</span>
            <button
              className="x"
              title="remover"
              onClick={() => onChange(norm.filter((_, j) => j !== i))}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="lst-add">
        <input
          value={draft}
          placeholder={atMax && max !== undefined ? `máx ${max} — remova um item` : placeholder}
          maxLength={maxLen}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button
          className="btn"
          onClick={add}
          disabled={!draft.trim() || atMax}
          title={atMax && max !== undefined ? `máx ${max} itens` : undefined}
        >
          {addLabel}
        </button>
      </div>
    </div>
  );
}

/** Raw JSON escape hatch — the structured fields cover the known keys;
 *  this stays for anything else a future knob adds. */
export function RawJson({
  value,
  onSave,
}: {
  value: Record<string, unknown>;
  onSave: (v: Record<string, unknown>) => void;
}) {
  const [raw, setRaw] = useState('');
  const [err, setErr] = useState('');
  const save = () => {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setErr('precisa ser um objeto JSON');
        return;
      }
      setErr('');
      onSave(parsed as Record<string, unknown>);
    } catch {
      setErr('JSON inválido');
    }
  };
  return (
    <details
      className="raw"
      onToggle={(e) => {
        if ((e.target as HTMLDetailsElement).open) setRaw(JSON.stringify(value, null, 2));
      }}
    >
      <summary>json bruto</summary>
      <textarea value={raw} onChange={(e) => setRaw(e.target.value)} spellCheck={false} />
      {err && (
        <div className="hint" style={{ color: 'var(--red-400)' }}>
          {err}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <button className="btn" onClick={save}>
          salvar json
        </button>
      </div>
    </details>
  );
}
