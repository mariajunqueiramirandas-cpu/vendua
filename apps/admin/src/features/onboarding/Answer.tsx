import { Camera, Trash, WarningCircle } from '@phosphor-icons/react';
import { forwardRef, useRef, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { maskPhone, parsePhone } from '../../lib/parse.ts';
import { Button } from '../../ui/Button.tsx';
import { cn } from '../../ui/cn.ts';
import { LineInput } from '../../ui/fields.tsx';
import { CropSheet } from '../../ui/PhotoField.tsx';

// A question with one answer in words (the name, the phrase, the WhatsApp) is answered on a
// line, not in a box: the title is the label, the answer is set in the display face, big, over a
// rule that turns forest as it's typed on, with the lime under it. Nothing else to read.

const lineCls =
  'w-full rounded-none border-0 border-b-2 border-line-strong bg-transparent px-0 font-display text-[1.5rem] font-semibold tracking-[-0.02em] text-ink transition-[border-color,box-shadow] duration-(--duration-quick) ' +
  'placeholder:font-sans placeholder:font-normal placeholder:tracking-normal placeholder:text-faint hover:border-faint ' +
  'focus:border-primary focus:shadow-[0_2px_0_0_var(--spark)] focus-visible:outline-none focus-visible:shadow-[0_2px_0_0_var(--spark)] ' +
  'aria-invalid:border-danger disabled:opacity-50 md:text-[1.75rem]';

export const AnswerLine = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'> & {
    id: string;
    /** the answer's name for assistive tech; the title on screen is the question */
    label: string;
    /** an icon or a word at the line's start */
    lead?: ReactNode;
    helper?: ReactNode;
    error?: ReactNode;
  }
>(function AnswerLine({ id, label, lead, helper, error, className, ...rest }, ref) {
  const note = error ? `${id}-error` : helper ? `${id}-helper` : undefined;
  return (
    <div>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <div className="relative">
        {lead ? (
          <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center text-muted [&_svg]:size-7">
            {lead}
          </span>
        ) : null}
        <LineInput
          ref={ref}
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={note}
          className={cn(lineCls, lead && 'pl-10', className)}
          // the line input centres its text by padding for a 52 px box; a bigger face needs its own
          style={{ paddingBlock: '0.5rem', lineHeight: '2.25rem' }}
          {...rest}
        />
      </div>
      {error ? (
        <p
          id={`${id}-error`}
          role="alert"
          className="t-caption mt-2 flex items-center gap-1.5 text-danger"
        >
          <WarningCircle weight="fill" className="size-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : helper ? (
        <p id={`${id}-helper`} className="t-caption mt-2 text-muted">
          {helper}
        </p>
      ) : null}
    </div>
  );
});

/** The WhatsApp line: masked as it's typed, like `PhoneInput`, in the answer's face. */
export function AnswerPhone({
  id,
  label,
  value,
  onChange,
  lead,
  helper,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string, digits: string | null) => void;
  lead?: ReactNode;
  helper?: ReactNode;
  error?: ReactNode;
}) {
  return (
    <AnswerLine
      id={id}
      label={label}
      type="tel"
      inputMode="tel"
      autoComplete="off"
      placeholder="(22) 99999-0000"
      value={value}
      lead={lead}
      helper={helper}
      error={error}
      className="tnum"
      onChange={(e) => {
        const m = maskPhone(e.target.value);
        onChange(m, parsePhone(m));
      }}
    />
  );
}

/**
 * The logo's answer: one row the width of the column, like every other answer, with the slot
 * the photo lands in (the app icon's square, as the store's card wears it) and the words beside
 * it. A square tile alone would sit in a corner of the column. The crop is the photo field's.
 */
export function AnswerLogo({
  url,
  onChange,
}: {
  url: string | null;
  onChange: (url: string | null) => Promise<unknown> | void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const pick = () => input.current?.click();
  return (
    <div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="sr-only"
        aria-label="logo"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) setFile(f);
          e.target.value = '';
        }}
      />
      {url ? (
        <div className="flex items-center gap-4 rounded-lg bg-surface p-3 depth-1">
          <img
            src={url}
            alt="logo da loja"
            className="size-20 shrink-0 rounded-[22%] bg-sunken object-cover ring-1 ring-line"
          />
          <div className="min-w-0 flex-1">
            <p className="t-body font-semibold">Esse é o ícone da loja.</p>
            <div className="-ml-3.5 mt-1 flex flex-wrap items-center">
              <Button variant="ghost" size="sm" icon={<Camera />} onClick={pick}>
                trocar
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon={<Trash />}
                className="text-muted"
                onClick={() => void onChange(null)}
              >
                tirar
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={pick}
          className="flex w-full items-center gap-4 rounded-lg border-2 border-dashed border-line-strong bg-sunken p-3 text-left hover:bg-press"
        >
          <span
            aria-hidden
            className="grid size-20 shrink-0 place-items-center rounded-[22%] bg-surface text-muted ring-1 ring-line"
          >
            <Camera weight="duotone" className="size-8" />
          </span>
          <span className="min-w-0">
            <span className="t-body block font-semibold text-ink">adicionar foto</span>
            <span className="t-caption mt-0.5 block text-muted">
              Da câmera ou da galeria. A gente corta no quadrado.
            </span>
          </span>
        </button>
      )}
      <CropSheet
        file={file}
        aspect="1:1"
        onClose={() => setFile(null)}
        onDone={async (p) => {
          setFile(null);
          await onChange(p.url);
        }}
      />
    </div>
  );
}
