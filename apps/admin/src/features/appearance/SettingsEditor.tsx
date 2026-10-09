import { ArrowDown, ArrowUp, Plus, Trash } from '@phosphor-icons/react';
import { DEFAULT_PATHS } from '@vendua/kernel/rules';
import { useState } from 'react';
import { Button, IconButton } from '../../ui/Button.tsx';
import { Chips, Field, TextArea, TextInput, Toggle, Stepper } from '../../ui/fields.tsx';
import { PhotoField } from '../../ui/PhotoField.tsx';
import { groupFields, keepsUrl, optionName, type FieldSpec } from './fields.ts';

type Values = Record<string, unknown>;

const swap = <T,>(xs: T[], i: number, j: number) => {
  const n = [...xs];
  [n[i], n[j]] = [n[j]!, n[i]!];
  return n;
};

/** Every change lands in the preview as it's typed; "publicar" makes it real. */
export function SettingsEditor({
  fields,
  value,
  onChange,
  idPrefix,
  origin,
  grouped,
}: {
  fields: FieldSpec[];
  value: Values;
  onChange: (v: Values) => void;
  idPrefix: string;
  /** the store's own address: its relative images ("/images/…") live there */
  origin: string;
  /** headed chunks (textos, fotos, botões, opções) for a section's own form */
  grouped?: boolean;
}) {
  const show = (u: string) =>
    u.startsWith('/') && !u.startsWith('/v1/media/') && !u.startsWith('//') ? origin + u : u;
  const set = (k: string, v: unknown) => {
    const next = { ...value };
    if (v === '' || v === undefined) delete next[k];
    else next[k] = v;
    onChange(next);
  };
  const shown = fields.filter((f) => f.kind !== 'skip');
  if (!shown.length)
    return (
      <p className="t-body rounded-md bg-sunken p-4 text-muted">
        Esta parte se monta sozinha com os dados da loja: não tem textos para editar. Dá para mover
        ou esconder.
      </p>
    );
  if (grouped)
    return (
      <div className="space-y-7">
        {groupFields(shown).map((g, i) => (
          <section key={g.label ?? `g${i}`} aria-label={g.label ?? undefined}>
            {g.label ? (
              <h3 className="t-caption mb-3 font-semibold uppercase tracking-wide text-muted">
                {g.label}
              </h3>
            ) : null}
            <SettingsEditor
              fields={g.fields}
              value={value}
              onChange={onChange}
              idPrefix={idPrefix}
              origin={origin}
            />
          </section>
        ))}
      </div>
    );
  return (
    <div className="space-y-5">
      {shown.map((f) => {
        const id = `${idPrefix}-${f.key}`;
        const v = value[f.key];
        switch (f.kind) {
          case 'text':
            return (
              <Field key={f.key} label={f.label} htmlFor={id} helper={f.help}>
                {f.long ? (
                  <TextArea
                    id={id}
                    maxLength={f.max}
                    value={(v as string) ?? ''}
                    onChange={(e) => set(f.key, e.target.value)}
                    className="min-h-24"
                  />
                ) : (
                  <TextInput
                    id={id}
                    maxLength={f.max}
                    value={(v as string) ?? ''}
                    onChange={(e) => set(f.key, e.target.value)}
                  />
                )}
              </Field>
            );
          case 'url':
            return (
              <UrlField
                key={f.key}
                id={id}
                label={f.label}
                value={(v as string) ?? ''}
                onChange={(u) => set(f.key, u)}
              />
            );
          case 'number':
            return (
              <Field key={f.key} label={f.label}>
                <Stepper
                  label={f.label}
                  value={typeof v === 'number' ? v : (f.def ?? f.min)}
                  min={f.min}
                  max={f.max}
                  onChange={(n) => set(f.key, n)}
                />
              </Field>
            );
          case 'boolean':
            return (
              <Toggle
                key={f.key}
                checked={typeof v === 'boolean' ? v : (f.def ?? false)}
                onChange={(b) => set(f.key, b)}
                label={f.label}
                description={f.help}
              />
            );
          case 'select':
            return (
              <Field key={f.key} label={f.label} helper={f.help}>
                <Chips
                  label={f.label}
                  value={(v as string) ?? f.def ?? f.options[0] ?? ''}
                  onChange={(o) => set(f.key, o)}
                  options={f.options.map((o) => ({ value: o, label: optionName(o) }))}
                />
              </Field>
            );
          case 'image':
            return (
              <Field key={f.key} label={f.label}>
                <PhotoField
                  label={f.label}
                  max={1}
                  photos={typeof v === 'string' && v ? [{ url: show(v) }] : []}
                  onChange={(p) =>
                    set(f.key, p[0]?.url === show(String(v ?? '')) ? v : (p[0]?.url ?? ''))
                  }
                />
              </Field>
            );
          case 'list': {
            const items = Array.isArray(v) ? (v as Values[]) : [];
            return (
              <Field key={f.key} label={f.label}>
                <div className="space-y-3">
                  {items.map((it, i) => (
                    <div key={i} className="rounded-md bg-sunken p-3">
                      <div className="mb-2 flex items-center">
                        <span className="t-caption flex-1 font-semibold text-muted">
                          {i + 1}º item
                        </span>
                        <IconButton
                          label="subir item"
                          disabled={i === 0}
                          onClick={() => set(f.key, swap(items, i, i - 1))}
                        >
                          <ArrowUp />
                        </IconButton>
                        <IconButton
                          label="descer item"
                          disabled={i === items.length - 1}
                          onClick={() => set(f.key, swap(items, i, i + 1))}
                        >
                          <ArrowDown />
                        </IconButton>
                        <IconButton
                          label="tirar item"
                          onClick={() =>
                            set(
                              f.key,
                              items.filter((_, k) => k !== i),
                            )
                          }
                        >
                          <Trash />
                        </IconButton>
                      </div>
                      <SettingsEditor
                        origin={origin}
                        fields={f.of}
                        value={it}
                        idPrefix={`${id}-${i}`}
                        onChange={(nv) =>
                          set(
                            f.key,
                            items.map((x, k) => (k === i ? nv : x)),
                          )
                        }
                      />
                    </div>
                  ))}
                  {items.length < f.max ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<Plus />}
                      onClick={() => set(f.key, [...items, { ...(items.at(-1) ?? {}) }])}
                    >
                      mais um item
                    </Button>
                  ) : null}
                </div>
              </Field>
            );
          }
          default:
            return null;
        }
      })}
    </div>
  );
}

/** A link the storefront would drop (the Kernel keeps only its pages and https, mailto, tel)
 *  is flagged once the merchant leaves the field, not while typing. */
function UrlField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [left, setLeft] = useState(false);
  const dropped = left && !!value && !keepsUrl(value);
  return (
    <Field
      label={label}
      htmlFor={id}
      helper={`Uma página da loja (ex.: ${DEFAULT_PATHS.catalog}) ou um link completo, com https://.`}
      error={dropped ? 'A loja não usa esse link. Comece com / ou https://.' : null}
    >
      <TextInput
        id={id}
        maxLength={300}
        inputMode="url"
        value={value}
        aria-invalid={dropped || undefined}
        onFocus={() => setLeft(false)}
        onBlur={() => setLeft(true)}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}
