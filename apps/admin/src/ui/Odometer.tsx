import { useEffect, useRef, useState } from 'react';
import { money } from '../lib/format.ts';
import { cn } from './cn.ts';

/**
 * The number that grows (§6.2): each digit rolls like an odometer when the value
 * changes, and a lime "+R$ 42,00" floats up. Screen readers get the plain value.
 */
export function Odometer({ cents, className }: { cents: number; className?: string }) {
  const text = money(cents);
  const prev = useRef(cents);
  const [delta, setDelta] = useState<{ v: number; k: number } | null>(null);
  useEffect(() => {
    if (cents > prev.current) setDelta({ v: cents - prev.current, k: Date.now() });
    prev.current = cents;
  }, [cents]);
  return (
    <span className={cn('relative inline-flex items-baseline', className)}>
      <span className="sr-only">{text}</span>
      <span aria-hidden className="inline-flex overflow-hidden">
        {text
          .split('')
          .map((ch, i) =>
            /\d/.test(ch) ? (
              <Digit key={`${text.length}-${i}`} d={Number(ch)} />
            ) : (
              <span key={`${text.length}-${i}`}>{ch === ' ' ? '\u00a0' : ch}</span>
            ),
          )}
      </span>
      {delta ? (
        <span
          key={delta.k}
          aria-hidden
          className="animate-float-up t-label pointer-events-none absolute -top-5 right-0 rounded-full bg-spark px-2 text-on-spark"
        >
          +{money(delta.v)}
        </span>
      ) : null}
    </span>
  );
}

function Digit({ d }: { d: number }) {
  return (
    <span
      className="relative inline-block h-[1em] overflow-hidden leading-none tnum"
      style={{ width: '0.62em' }}
    >
      <span
        className="absolute left-0 top-0 flex flex-col transition-transform duration-[600ms] ease-(--ease-soft)"
        style={{ transform: `translateY(-${d}em)` }}
      >
        {Array.from({ length: 10 }, (_, i) => (
          <span key={i} className="block h-[1em] leading-none">
            {i}
          </span>
        ))}
      </span>
    </span>
  );
}
