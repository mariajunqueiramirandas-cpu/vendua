import { Check, Minus, Plus, WarningCircle } from '@phosphor-icons/react';
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type ComponentProps,
  type KeyboardEvent,
  type Ref,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { money } from '../lib/format.ts';
import { haptic } from '../lib/haptics.ts';
import {
  maskDocument,
  maskPhone,
  moneyInput,
  parseDocument,
  parseMoney,
  parsePhone,
  parseTime,
} from '../lib/parse.ts';
import { cn } from './cn.ts';
import { Spinner } from './Spinner.tsx';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/** Label above, helper below, inline validation after blur, per-field "salvo" (§7). */
export function Field({
  label,
  helper,
  error,
  state,
  children,
  htmlFor,
  className,
  optional,
}: {
  label: ReactNode;
  helper?: ReactNode;
  error?: string | null;
  state?: SaveState;
  children: ReactNode;
  htmlFor?: string;
  className?: string;
  optional?: boolean;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={htmlFor} className="t-label">
          {label}
          {optional ? <span className="ml-1 font-medium text-muted">(opcional)</span> : null}
        </label>
        <SaveMark state={state} />
      </div>
      {children}
      {error ? (
        <p className="t-caption flex items-center gap-1.5 text-danger" role="alert">
          <WarningCircle weight="fill" className="size-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : helper ? (
        <p className="t-caption text-muted">{helper}</p>
      ) : null}
    </div>
  );
}

export function SaveMark({ state }: { state?: SaveState | undefined }) {
  if (!state || state === 'idle') return null;
  return (
    <span className="t-caption inline-flex items-center gap-1 text-muted" aria-live="polite">
      {state === 'saving' ? (
        <>
          <Spinner className="size-3.5" /> salvando
        </>
      ) : state === 'saved' ? (
        <>
          <Check weight="bold" className="size-3.5 text-success" /> salvo
        </>
      ) : (
        <span className="text-danger">não salvou</span>
      )}
    </span>
  );
}

export const inputCls =
  'h-13 w-full rounded-sm bg-sunken px-4 t-body-lg text-ink ring-1 ring-transparent transition-[box-shadow,background-color] ' +
  'hover:ring-line-strong focus:bg-surface focus:ring-2 focus:ring-primary focus:outline-none ' +
  'aria-invalid:ring-2 aria-invalid:ring-danger disabled:opacity-50 lg:h-12 lg:text-[0.9375rem]';

const LINE_TYPES = new Set(['text', 'email', 'tel', 'search', 'url']);
const MODE: Record<string, InputHTMLAttributes<HTMLInputElement>['inputMode']> = {
  email: 'email',
  tel: 'tel',
  search: 'search',
  url: 'url',
};

type LineProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'>;

/**
 * Chrome on Android shows its passwords/cards/addresses bar above the keyboard on every
 * <input>, ignoring autocomplete="off", but never on a <textarea>. So text-like fields are a
 * one-line textarea that behaves as an input: Enter submits the form, line breaks become spaces.
 */
export const LineInput = forwardRef<HTMLInputElement, LineProps>(function LineInput(
  { type = 'text', className, onChange, onKeyDown, inputMode, enterKeyHint, ...rest },
  ref,
) {
  if (!LINE_TYPES.has(type))
    return (
      <input
        ref={ref}
        type={type}
        autoComplete="off"
        inputMode={inputMode}
        enterKeyHint={enterKeyHint}
        onChange={onChange}
        onKeyDown={onKeyDown}
        className={className}
        {...rest}
      />
    );
  const {
    size: _size,
    multiple: _m,
    accept: _a,
    list: _l,
    pattern: _p,
    min: _min,
    max: _max,
    step: _s,
    ...ta
  } = rest;
  return (
    <textarea
      ref={ref as unknown as Ref<HTMLTextAreaElement>}
      rows={1}
      wrap="off"
      autoComplete="off"
      autoCorrect={type === 'text' ? undefined : 'off'}
      autoCapitalize={type === 'text' ? undefined : 'none'}
      spellCheck={type === 'text' ? undefined : false}
      inputMode={inputMode ?? MODE[type]}
      enterKeyHint={enterKeyHint ?? (type === 'search' ? 'search' : undefined)}
      {...(ta as TextareaHTMLAttributes<HTMLTextAreaElement>)}
      className={cn(
        'resize-none overflow-hidden whitespace-pre py-3.5 leading-6 lg:py-3',
        className,
      )}
      onChange={(e) => {
        const v = e.target.value;
        if (/[\r\n]/.test(v)) e.target.value = v.replace(/\r?\n|\r/g, ' ');
        onChange?.(e as unknown as ChangeEvent<HTMLInputElement>);
      }}
      onKeyDown={(e) => {
        onKeyDown?.(e as unknown as KeyboardEvent<HTMLInputElement>);
        if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
        const handled = e.defaultPrevented;
        e.preventDefault();
        if (!handled) e.currentTarget.form?.requestSubmit();
      }}
    />
  );
});

/** a one-line textarea needs its text centred by padding: (h-13 − leading-6) / 2 */
const lineCls = 'py-3.5 leading-6 lg:py-3';

export const TextInput = forwardRef<
  HTMLInputElement,
  LineProps & { lead?: ReactNode; trail?: ReactNode }
>(function TextInput({ className, lead, trail, ...rest }, ref) {
  if (!lead && !trail)
    return <LineInput ref={ref} className={cn(inputCls, lineCls, className)} {...rest} />;
  return (
    <div className="relative">
      {lead ? (
        <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center font-semibold text-muted">
          {lead}
        </span>
      ) : null}
      <LineInput
        ref={ref}
        className={cn(inputCls, lineCls, lead ? 'pl-12' : '', trail ? 'pr-14' : '', className)}
        {...rest}
      />
      {trail ? (
        <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-muted">
          {trail}
        </span>
      ) : null}
    </div>
  );
});

export const TextArea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function TextArea({ className, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      autoComplete="off"
      className={cn(inputCls, 'h-auto min-h-28 resize-y py-3', className)}
      {...rest}
    />
  );
});

/** Controlled-on-commit text field: edits locally, commits on blur/Enter (autosave). */
export function CommitInput({
  value,
  onCommit,
  validate,
  multiline,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: string;
  onCommit: (v: string) => void;
  validate?: (v: string) => string | null;
  multiline?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const e = validate?.(draft) ?? null;
    setErr(e);
    if (!e && draft.trim() !== value.trim()) onCommit(draft.trim());
  };
  const common = {
    value: draft,
    'aria-invalid': err ? true : undefined,
    onBlur: commit,
  };
  return (
    <>
      {multiline ? (
        <TextArea
          {...(common as object)}
          id={rest.id}
          placeholder={rest.placeholder}
          maxLength={rest.maxLength}
          onChange={(e) => setDraft(e.target.value)}
        />
      ) : (
        <TextInput
          {...rest}
          {...common}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
      )}
      {err ? <p className="t-caption text-danger">{err}</p> : null}
    </>
  );
}

/** Money: "12", "12,5", "R$ 12,50" all work; numeric keypad; commits cents. */
export function MoneyField({
  cents,
  onCommit,
  id,
  min = 0,
  placeholder = '0,00',
  allowEmpty,
  validate,
  className,
  ...rest
}: {
  cents: number | null;
  onCommit: (cents: number | null) => void;
  id?: string;
  min?: number;
  placeholder?: string;
  allowEmpty?: boolean;
  /** a rule beyond "is money": the message, or null when the value is fine */
  validate?: (cents: number) => string | null;
  className?: string;
  'aria-describedby'?: string;
  autoFocus?: boolean;
}) {
  const [draft, setDraft] = useState(moneyInput(cents));
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setDraft(moneyInput(cents)), [cents]);
  const commit = () => {
    if (!draft.trim() && allowEmpty) {
      setErr(null);
      if (cents !== null) onCommit(null);
      return;
    }
    const v = parseMoney(draft);
    if (v === null) return setErr('Digite um valor, como 12,50.');
    if (v < min) return setErr(`O valor precisa ser pelo menos ${money(min)}.`);
    const bad = validate?.(v) ?? null;
    if (bad) return setErr(bad);
    setErr(null);
    setDraft(moneyInput(v));
    if (v !== cents) onCommit(v);
  };
  return (
    <>
      <TextInput
        id={id}
        lead="R$"
        inputMode="decimal"
        autoComplete="off"
        value={draft}
        placeholder={placeholder}
        aria-invalid={err ? true : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        className={cn('tnum', className)}
        {...rest}
      />
      {err ? <p className="t-caption text-danger">{err}</p> : null}
    </>
  );
}

export function PhoneInput({
  value,
  onChange,
  id,
  autoFocus,
}: {
  value: string;
  onChange: (v: string, digits: string | null) => void;
  id?: string;
  autoFocus?: boolean;
}) {
  return (
    <TextInput
      id={id}
      type="tel"
      inputMode="tel"
      autoComplete="off"
      placeholder="(22) 99999-0000"
      value={value}
      autoFocus={autoFocus}
      onChange={(e) => {
        const m = maskPhone(e.target.value);
        onChange(m, parsePhone(m));
      }}
      className="tnum"
    />
  );
}

/** CPF or CNPJ, masked as it's typed; a CNPJ may carry letters, so the keyboard stays full. */
export function DocumentInput({
  value,
  onChange,
  onBlur,
  id,
  invalid,
}: {
  value: string;
  onChange: (v: string, doc: string | null) => void;
  onBlur?: () => void;
  id?: string;
  invalid?: boolean;
}) {
  return (
    <TextInput
      id={id}
      autoComplete="off"
      autoCapitalize="characters"
      autoCorrect="off"
      spellCheck={false}
      maxLength={18}
      placeholder="000.000.000-00"
      value={value}
      aria-invalid={invalid || undefined}
      onBlur={onBlur}
      onChange={(e) => {
        const m = maskDocument(e.target.value);
        onChange(m, parseDocument(m));
      }}
      className="tnum"
    />
  );
}

/** Times as people say them: "9", "9h", "18h30", "09:00". */
export function TimeInput({
  value,
  onCommit,
  id,
  label,
}: {
  value: string;
  onCommit: (hhmm: string) => void;
  id?: string;
  label: string;
}) {
  const [draft, setDraft] = useState(value);
  const [bad, setBad] = useState(false);
  useEffect(() => setDraft(value), [value]);
  return (
    <LineInput
      id={id}
      aria-label={label}
      autoComplete="off"
      inputMode="numeric"
      value={draft}
      aria-invalid={bad || undefined}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const t = parseTime(draft);
        setBad(!t);
        if (t) {
          setDraft(t);
          if (t !== value) onCommit(t);
        }
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      className={cn(inputCls, 'tnum h-12 w-24 px-3 py-3 text-center leading-6')}
    />
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
  id,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  id?: string;
}) {
  const auto = useId();
  const tid = id ?? auto;
  return (
    <div className="flex min-h-14 items-center justify-between gap-4 py-1">
      <label htmlFor={tid} className="min-w-0 cursor-pointer">
        <span className="block font-semibold">{label}</span>
        {description ? <span className="t-caption block text-muted">{description}</span> : null}
      </label>
      <span className="relative inline-flex shrink-0">
        {/* a real switch input under the finger: iOS only gives web haptics for a tapped one */}
        <input
          id={tid}
          type="checkbox"
          role="switch"
          {...{ switch: '' }}
          checked={checked}
          disabled={disabled}
          onChange={(e) => {
            haptic.tick();
            onChange(e.target.checked);
          }}
          className="peer absolute -inset-x-1 -inset-y-2 z-10 m-0 cursor-pointer appearance-none opacity-0 disabled:cursor-not-allowed"
        />
        <span
          aria-hidden
          className={cn(
            'inline-flex h-8 w-13 items-center rounded-full p-1 transition-[background-color,scale] duration-(--duration-quick) peer-active:scale-[0.96]',
            'peer-focus-visible:shadow-[0_0_0_4px_var(--primary)] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-spark noite:peer-focus-visible:shadow-[0_0_0_4px_var(--bg)]',
            checked ? 'bg-primary' : 'bg-line-strong',
            disabled && 'opacity-45',
          )}
        >
          <span
            className={cn(
              'size-6 rounded-full shadow-sm transition-transform duration-(--duration-quick) ease-(--ease-soft)',
              checked ? 'translate-x-5 bg-on-primary' : 'translate-x-0 bg-surface',
            )}
          />
        </span>
      </span>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; count?: number }[];
  label: string;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('flex gap-1 rounded-md bg-sunken p-1', className)}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => {
              haptic.tick();
              onChange(o.value);
            }}
            className={cn(
              'press t-label flex min-h-11 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[12px] px-1.5 transition-[color,background-color,box-shadow,scale] duration-(--duration-quick)',
              // with counts, phones stack label over count so four lanes fit 375px
              o.count !== undefined && 'max-sm:min-h-14 max-sm:flex-col max-sm:gap-0.5',
              on ? 'bg-surface text-ink depth-1' : 'text-muted hover:text-ink',
            )}
          >
            <span className="line-clamp-2 text-center leading-tight">{o.label}</span>
            {o.count !== undefined ? (
              <span
                className={cn(
                  'tnum min-w-6 rounded-full px-1.5 text-[0.75rem] leading-6',
                  on && o.count > 0 ? 'bg-spark text-on-spark' : 'bg-line text-muted',
                )}
              >
                {o.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function Chips<T extends string>({
  value,
  onChange,
  options,
  label,
  multi,
  className,
}: {
  value: T | T[];
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  label: string;
  multi?: boolean;
  className?: string;
}) {
  const sel = (v: T) => (Array.isArray(value) ? value.includes(v) : value === v);
  return (
    <div
      role={multi ? 'group' : 'radiogroup'}
      aria-label={label}
      className={cn('flex flex-wrap gap-2', className)}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role={multi ? 'checkbox' : 'radio'}
          aria-checked={sel(o.value)}
          onClick={() => {
            haptic.tick();
            onChange(o.value);
          }}
          className={cn(
            'press t-label min-h-12 rounded-full px-4 ring-1 transition-[color,background-color,scale] duration-(--duration-quick)',
            sel(o.value)
              ? 'bg-primary text-on-primary ring-primary'
              : 'bg-surface text-ink ring-line-strong hover:bg-hover',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Stepper({
  value,
  onChange,
  min = 0,
  max = 9999,
  step = 1,
  label,
  suffix,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label: string;
  suffix?: string;
}) {
  const set = (v: number) => {
    haptic.tick();
    onChange(Math.max(min, Math.min(max, v)));
  };
  return (
    <div
      className="inline-flex items-center gap-1 rounded-full bg-sunken p-1"
      role="group"
      aria-label={label}
    >
      <button
        type="button"
        aria-label={`menos ${step}`}
        disabled={value <= min}
        onClick={() => set(value - step)}
        className="press grid size-11 place-items-center rounded-full hover:bg-press active:bg-press disabled:opacity-35"
      >
        <Minus weight="bold" className="size-5" />
      </button>
      <output className="tnum min-w-14 text-center font-semibold" aria-live="polite">
        {value}
        {suffix ? <span className="ml-0.5 text-muted">{suffix}</span> : null}
      </output>
      <button
        type="button"
        aria-label={`mais ${step}`}
        disabled={value >= max}
        onClick={() => set(value + step)}
        className="press grid size-11 place-items-center rounded-full hover:bg-press active:bg-press disabled:opacity-35"
      >
        <Plus weight="bold" className="size-5" />
      </button>
    </div>
  );
}

export function Select({
  value,
  onChange,
  options,
  id,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  id?: string;
  label?: string;
}) {
  return (
    <select
      id={id}
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        inputCls,
        'appearance-none bg-[length:20px] bg-[right_14px_center] bg-no-repeat pr-11',
      )}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 256 256'%3E%3Cpath fill='none' stroke='%236b8177' stroke-width='20' stroke-linecap='round' stroke-linejoin='round' d='M208 96l-80 80-80-80'/%3E%3C/svg%3E\")",
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** A tiny autosave helper: run the save, show saving → salvo, fall back on error. */
/** Optimistic stepper: taps update the number instantly and one PATCH goes out once they pause. */
export function SavedStepper({
  value,
  onSave,
  onDraft,
  ...rest
}: {
  value: number;
  onSave: (v: number) => Promise<unknown>;
  onDraft?: (v: number) => void;
} & Omit<ComponentProps<typeof Stepper>, 'value' | 'onChange'>) {
  const [draft, setDraft] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const pending = useRef<number | null>(null);
  const save = useRef(onSave);
  save.current = onSave;
  const flush = () => {
    clearTimeout(timer.current);
    const v = pending.current;
    if (v === null) return;
    pending.current = null;
    void save.current(v).finally(() => setDraft((d) => (d === v ? null : d)));
  };
  useEffect(() => flush, []);
  return (
    <Stepper
      {...rest}
      value={draft ?? value}
      onChange={(v) => {
        setDraft(v);
        onDraft?.(v);
        pending.current = v;
        clearTimeout(timer.current);
        timer.current = setTimeout(flush, 600);
      }}
    />
  );
}

export function useSaveState() {
  const [state, setState] = useState<SaveState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const track = async <T,>(p: Promise<T>): Promise<T> => {
    clearTimeout(timer.current);
    setState('saving');
    try {
      const out = await p;
      setState('saved');
      timer.current = setTimeout(() => setState('idle'), 2400);
      return out;
    } catch (e) {
      setState('error');
      throw e;
    }
  };
  return { state, track };
}
