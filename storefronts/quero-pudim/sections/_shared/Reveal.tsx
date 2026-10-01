import { useEffect, useRef, type ElementType, type ReactNode } from 'react';
import { useReducedMotion } from '@vendua/kernel';

/** Fades a block in as it scrolls into view. Above-the-fold content is never hidden, and
 *  reduced-motion / no-IntersectionObserver leave everything visible. */
export function Reveal({
  as: Tag = 'div',
  className,
  delay = 0,
  children,
}: {
  as?: ElementType;
  className?: string;
  delay?: number;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    const el = ref.current;
    if (!el || reduced || typeof IntersectionObserver === 'undefined') return;
    if (el.dataset.reveal === 'in') return;
    if (el.getBoundingClientRect().top < window.innerHeight * 0.92) return;
    el.dataset.reveal = 'pending';
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e?.isIntersecting) return;
        el.dataset.reveal = 'in';
        io.disconnect();
      },
      { rootMargin: '0px 0px -8% 0px' },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      // reduced motion switched on mid-way: never leave a block hidden
      if (el.dataset.reveal === 'pending') delete el.dataset.reveal;
    };
  }, [reduced]);
  return (
    <Tag
      ref={ref}
      className={className}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Tag>
  );
}
