import { WarningCircle } from '@phosphor-icons/react';
import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { maskPhone, parsePhone } from '../../lib/parse.ts';
import { cn } from '../../ui/cn.ts';
import { LineInput } from '../../ui/fields.tsx';

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
